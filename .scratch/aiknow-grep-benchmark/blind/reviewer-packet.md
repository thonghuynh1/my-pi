# Blinded reviewer packet

# Blinded answer-quality rubric (10 points)

Score each anonymized final answer before seeing method labels or usage/cost data. Use five dimensions worth 0–2 points each.

1. **Factual correctness (0–2)**
   - 0: materially wrong or unsafe.
   - 1: mostly correct with one meaningful error or unsupported claim.
   - 2: correct, precise, and no material contradictions.
2. **Scenario completeness (0–2)**
   - 0: misses most requested parts.
   - 1: covers the main path but misses at least one important requested branch/invariant.
   - 2: covers every explicit part of the question at useful depth.
3. **Evidence and traceability (0–2)**
   - 0: little/no verifiable repository evidence.
   - 1: useful symbols/files but some broad, inaccurate, or missing locations.
   - 2: claims consistently tied to accurate symbols and file:line evidence.
4. **Cross-boundary reasoning (0–2)**
   - 0: isolated file summary with no coherent relationships.
   - 1: generally coherent flow/impact with some weak transitions.
   - 2: accurately explains ordering, ownership, data flow, invariants, and conditional branches.
5. **Tests, safety, and actionable guidance (0–2)**
   - 0: omits relevant tests/safety consequences or gives unusable guidance.
   - 1: identifies major tests/risks but misses meaningful coverage.
   - 2: identifies relevant existing/new tests, failure/safety behavior, and concrete guidance appropriate to the scenario.

Record one integer per dimension and a total out of 10. Add a short justification. Do not infer or guess the discovery method.


---

# Answer A01

**Scenario:** impact


## 1. Executive summary

`UsageTotals` is defined in `src/core/loop-run/state.ts:244-254` and aggregated by `buildUsageSummary` in `src/core/loop-run/usage.ts:67-94`.

Required changes:

- Add `executionCount: number` to `UsageTotals`.
- Increment it once per ledger entry in run, issue, and phase buckets.
- Keep streaming usage at count `0`; it is explicitly ephemeral and not ledger-backed.
- Update UI formatting to show total cost and average cost per execution.
- Update exact-object tests and add count/streaming regression tests.

## 2. Detailed flow / architecture / impact analysis

1. `LoopRun.recordUsage` creates exactly one `UsageLedgerEntry` after each execution and recomputes the summary from the complete ledger (`src/core/loop-run/loop-run.ts:484-535`).
2. `buildUsageSummary` initializes run, issue, and phase buckets with `zeroTotals`, then calls `accumulateInto` for each ledger entry (`src/core/loop-run/usage.ts:27-38`, `41-59`, `67-94`).
3. Add `executionCount: 0` in `usage.ts:27-38`; increment it in `accumulateInto` at `src/core/loop-run/usage.ts:41-59`. This automatically counts every ledger entry, including entries with unknown usage and failed executions.
4. Issue buckets are only created when `entry.issueId != null` (`src/core/loop-run/usage.ts:83-89`), so issue counts naturally include only executions attributed to that issue.
5. Phase buckets are always updated through `accumulateInto(byPhase[entry.phase], entry)` (`src/core/loop-run/usage.ts:91`).
6. The Ink projection separately accumulates committed ledger events through `accumulateUsage` (`src/core/loop-run/ink-worker-projection.ts:52-64`). It must increment `executionCount` there.
7. Streaming updates use `accumulateStreamingUsage` (`src/core/loop-run/ink-worker-projection.ts:66-78`) and `displayRunUsage` (`src/core/loop-run/ink-worker-projection.ts:253-263`). Do **not** increment the count there; streaming usage must remain count `0`.
8. `UsageTotals` is also created by `zeroUsageTotals` (`src/core/loop-run/ink-worker-projection.ts:29-41`), which must initialize the new field.
9. The run summary currently displays only total cost (`src/core/loop-run/ink-view.ts:87-103`). Add average-cost formatting based on `costUsd / executionCount`, returning `unknown` when `hasUnknownCost` is true and a suitable zero-execution value when count is zero.
10. The selected-worker usage display also shows only total cost (`src/core/loop-run/ink-view.ts:356-362`). Add the average there if the UI is intended to expose per-issue execution cost.
11. The existing `formatUsageCost` helper handles unknown total cost (`src/core/loop-run/ink-state.ts:262-265`); add a companion average formatter or extend this helper without allowing streaming totals to affect the denominator.

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| `UsageTotals` contains aggregate token/cost fields and unknown flags | `UsageTotals` | `src/core/loop-run/state.ts:244-254` |
| `UsageSummary` has run, issue, and phase buckets | `UsageSummary` | `src/core/loop-run/state.ts:256-260` |
| Ledger entries represent executions | `UsageLedgerEntry` | `src/core/loop-run/state.ts:233-242` |
| Summaries are recomputed from the full ledger | `buildUsageSummary` | `src/core/loop-run/usage.ts:67-94` |
| Each ledger entry is accumulated into run totals | `accumulateInto` | `src/core/loop-run/usage.ts:41-59`, `81` |
| Issue attribution is conditional on `issueId` | `buildUsageSummary` | `src/core/loop-run/usage.ts:83-89` |
| Phase attribution is performed for every entry | `buildUsageSummary` | `src/core/loop-run/usage.ts:91` |
| Each execution appends one ledger entry | `LoopRun.recordUsage` | `src/core/loop-run/loop-run.ts:506-534` |
| Committed UI usage is accumulated from ledger events | `accumulateUsage` | `src/core/loop-run/ink-worker-projection.ts:52-64` |
| Streaming usage is accumulated separately | `accumulateStreamingUsage` | `src/core/loop-run/ink-worker-projection.ts:66-78` |
| Streaming usage is ephemeral and not persisted | `StreamingUsageEvent` | `src/core/loop-run/events.ts:40-47` |
| Run display includes total cost | `renderRunUsageLines` | `src/core/loop-run/ink-view.ts:87-103` |
| Worker display includes total cost | selected-worker render | `src/core/loop-run/ink-view.ts:356-362` |
| Empty tracker state derives its summary from an empty ledger | `LoopRunTracker.create` | `src/core/utils/loop-run-tracker.ts:102-105` |

## 4. Tests and documentation

Tests that will break due to exact `UsageTotals` object equality or manually constructed summaries:

- `test/usage.test.ts:23-37` — expected zero totals.
- `test/loop-run-tracker.test.ts:58-` — exact initial summary.
- `test/loop-run-tracker.test.ts:152-` and `264-` — manually constructed persisted summaries.
- Any other compile-time `UsageTotals` literals found in those tracker fixtures.

New tests:

- `test/usage.test.ts`
  - Empty summary has `executionCount: 0` in run and every phase.
  - Multiple ledger entries count once in run and phase buckets.
  - Issue counts include only entries with that issue ID.
  - Entries with null usage still increment the count.
  - An entry contributes to run and phase counts, but not `byIssue` without `issueId`.
- `test/loop-run.test.ts:563-572`
  - `recordUsage` produces counts of one and two after successive executions.
  - Failed/missing-usage executions still count.
- `test/ink-state.test.ts:302-334`
  - Streaming usage leaves execution count at zero.
  - After `usageRecorded`, count becomes one and streaming count remains excluded.
- `test/ink-ui.test.ts:121-147`
  - Run UI shows total and average cost.
  - In-progress usage does not produce or inflate average execution count.
- Worker display tests near `test/ink-state.test.ts:250-300`
  - Per-issue total and average cost use committed execution count only.

Documentation likely needing amendment:

- `docs/adr/0009-inline-usage-ledger-in-loop-run-tracker.md:24-30` — document `executionCount` and that it counts ledger entries, not streaming updates.
- `docs/adr/0014-single-terminal-writer-and-pinned-status-bar.md:35-37` — document total versus average cost presentation if the status UI is covered by this ADR.

## 5. Uncertainties

- The request does not specify the zero-execution display; use `unknown`, `n/a`, or `$0.00` consistently and test it.
- It is unclear whether average cost is required only for the run summary or also selected issue/phase views. The data model supports all three; the worker UI currently exposes issue-level totals but not phase-level totals.
- Persisted old snapshots will lack `executionCount`; readers may need migration/defaulting if runtime loading does not already normalize missing fields.



---

# Answer A02

**Scenario:** impact


## 1. Executive summary

`UsageTotals` is defined in `src/core/loop-run/state.ts:244-253` and is produced by both the durable ledger summary and Ink’s UI projection.

Required changes:

- Add `executionCount: number` to `UsageTotals`.
- Increment it once per `UsageLedgerEntry` in:
  - run totals,
  - issue totals when `issueId` exists,
  - phase totals.
- Do not increment it in streaming accumulation; streaming usage is explicitly ephemeral.
- Update the UI run summary to show average cost as `costUsd / executionCount`, while preserving unknown-cost behavior.
- Add compatibility normalization for old persisted snapshots, unless old tracker files are explicitly unsupported.

## 2. Detailed flow / architecture / impact analysis

### Durable ledger and summaries

1. `LoopRun.recordUsage` creates exactly one `UsageLedgerEntry` per completed agent execution and appends it to the ledger at `src/core/loop-run/loop-run.ts:506-533`.
2. It recomputes `usageSummary` through `buildUsageSummary(usageLedger)` at `src/core/loop-run/loop-run.ts:531-533`.
3. `buildUsageSummary` initializes run, issue, and phase buckets with `zeroTotals()` at `src/core/loop-run/usage.ts:27-38` and `src/core/loop-run/usage.ts:67-74`.
4. `accumulateInto` is the correct place to increment `executionCount`, because every ledger-backed bucket passes through it at `src/core/loop-run/usage.ts:41-63`.
5. The count must be incremented independently of token/cost nullability. Failed executions and executions with unknown usage still contribute one ledger record; this is directly supported by `recordUsage` at `src/core/loop-run/loop-run.ts:506-529` and ADR-0009 at `docs/adr/0009-inline-usage-ledger-in-loop-run-tracker.md:26-30`.

Recommended implementation:

```ts
function zeroTotals(): UsageTotals {
  return {
    executionCount: 0,
    // existing fields
  };
}

function accumulateInto(target: UsageTotals, entry: UsageLedgerEntry): void {
  target.executionCount += 1;
  // existing accumulation
}
```

This automatically counts:

- `run`: every ledger entry,
- `byIssue`: only entries with `issueId`,
- `byPhase`: every ledger entry in that phase.

### Ink/UI projection

`UsageTotals` is also used by the live dashboard:

- `zeroUsageTotals` initializes UI totals at `src/core/loop-run/ink-worker-projection.ts:29-40`.
- `accumulateUsage` processes committed ledger entries at `src/core/loop-run/ink-worker-projection.ts:52-64`.
- `accumulateStreamingUsage` processes ephemeral usage at `src/core/loop-run/ink-worker-projection.ts:66-78`.
- `displayRunUsage` combines streaming usage at `src/core/loop-run/ink-worker-projection.ts:253-264`.

Required changes:

- Add `executionCount: 0` to `zeroUsageTotals`.
- Add `executionCount: target.executionCount + 1` to `accumulateUsage`.
- Leave `accumulateStreamingUsage`’s count unchanged. It should return the existing count, or explicitly set `executionCount: target.executionCount`.
- `displayRunUsage` will therefore show `executionCount: 0` for streaming-only usage and will not inflate committed execution counts.

### UI average cost

The committed run summary is rendered by `renderRunUsageLines` in `src/core/loop-run/ink-view.ts:87-103`. It currently displays total cost only.

Required UI guidance:

- Add a formatter near `formatUsageCost` in `src/core/loop-run/ink-state.ts:262-265`, for example `formatAverageUsageCost`.
- Return `"unknown"` when `hasUnknownCost` is true.
- Return `"n/a"` or an equivalent non-numeric value when `executionCount === 0`.
- Otherwise format `costUsd / executionCount`.
- Add `average cost ...` beside or after total `cost ...` in `renderRunUsageLines`.
- Do not calculate an average for streaming-only usage because streaming counts must remain zero.

Worker cost rendering at `src/core/loop-run/ink-worker-projection.ts:292-295` is currently total-cost-only. If worker rows are also intended to show average cost, add a separate formatter there using the committed worker `usage.executionCount`; this is not currently required by any existing UI path.

### Persistence and compatibility

`LoopRunTracker.create` initializes summaries through `buildUsageSummary([])` at `src/core/utils/loop-run-tracker.ts:84-105`.

`read()` parses persisted JSON and only normalizes task fields at `src/core/utils/loop-run-tracker.ts:47-60` and `112-117`. Existing persisted snapshots may lack `executionCount`.

Recommended compatibility change:

- Extend `normalizeRunSnapshot` to rebuild or backfill `usageSummary` from `usageLedger`, ensuring old tracker files receive correct counts.
- This preserves the ledger as the source of truth and avoids undefined counts in archived or resumed runs.

### Files requiring edits

| File | Symbols/functions | Required change |
|---|---|---|
| `src/core/loop-run/state.ts` | `UsageTotals` | Add required `executionCount: number`. |
| `src/core/loop-run/usage.ts` | `zeroTotals`, `accumulateInto`, `buildUsageSummary` | Initialize count and increment once per ledger entry. Existing bucket routing already provides run/issue/phase semantics. |
| `src/core/loop-run/ink-worker-projection.ts` | `zeroUsageTotals`, `accumulateUsage`, `accumulateStreamingUsage` | Count committed entries only; explicitly exclude streaming usage. |
| `src/core/loop-run/ink-state.ts` | `formatUsageCost`; new average formatter | Format average cost with unknown and zero-count handling. |
| `src/core/loop-run/ink-view.ts` | `renderRunUsageLines` | Display average cost alongside total cost; omit or mark streaming-only average as unavailable. |
| `src/core/utils/loop-run-tracker.ts` | `normalizeRunSnapshot` | Recommended: migrate old summaries by rebuilding from `usageLedger`. |
| `docs/adr/0009-inline-usage-ledger-in-loop-run-tracker.md` | Usage Summary description | Document that counts represent ledger entries, including unknown/failed executions, and exclude ephemeral streaming usage. |

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| `UsageTotals` is the shared totals contract | `UsageTotals` | `src/core/loop-run/state.ts:244-253` |
| Summaries contain run, issue, and phase buckets | `UsageSummary` | `src/core/loop-run/state.ts:256-260` |
| One ledger entry is created per recorded execution | `recordUsage` | `src/core/loop-run/loop-run.ts:506-529` |
| Summary is recomputed from the full ledger | `recordUsage` | `src/core/loop-run/loop-run.ts:531-533` |
| Run totals accumulate every ledger entry | `buildUsageSummary` | `src/core/loop-run/usage.ts:67-82` |
| Issue totals only receive entries with `issueId` | `buildUsageSummary` | `src/core/loop-run/usage.ts:83-89` |
| Phase totals receive each ledger entry | `buildUsageSummary` | `src/core/loop-run/usage.ts:90` |
| Shared aggregation logic handles all durable buckets | `accumulateInto` | `src/core/loop-run/usage.ts:41-63` |
| UI committed totals accumulate ledger entries | `accumulateUsage` | `src/core/loop-run/ink-worker-projection.ts:52-64` |
| Streaming usage is not persisted | `accumulateStreamingUsage`, `emitStreamingUsage` | `src/core/loop-run/ink-worker-projection.ts:66-78`; `src/core/loop-run/loop-run.ts:545-550` |
| Streaming totals are displayed separately | `displayRunUsage` | `src/core/loop-run/ink-worker-projection.ts:253-264` |
| Run summary currently displays total cost | `renderRunUsageLines` | `src/core/loop-run/ink-view.ts:87-103` |
| Cost formatting currently handles unknown cost only | `formatUsageCost` | `src/core/loop-run/ink-state.ts:262-265` |
| Tracker initialization derives an empty summary | `create` | `src/core/utils/loop-run-tracker.ts:84-105` |
| Persisted snapshots are parsed without usage migration | `normalizeRunSnapshot`, `read` | `src/core/utils/loop-run-tracker.ts:47-60, 112-117` |
| Existing ADR defines ledger-backed summary semantics | ADR-0009 | `docs/adr/0009-inline-usage-ledger-in-loop-run-tracker.md:26-30` |

## 4. Tests and documentation

### Tests that will break

- `test/usage.test.ts:25-35` — exact equality for the empty `UsageTotals` object will fail without `executionCount`.
- `test/loop-run-tracker.test.ts:68-` — exact equality for the initialized summary will fail for every run/phase bucket.
- `test/loop-run-tracker.test.ts:167-` and `264-` — manually constructed `UsageSummary` objects will require `executionCount` to satisfy the `UsageTotals` type and expected persisted shape.

### New tests to add

- `test/usage.test.ts`
  - Empty ledger yields count `0` in run and all phase buckets.
  - Two ledger entries produce run count `2`.
  - Entries with the same issue produce that issue count.
  - Entries without `issueId` do not create an issue bucket.
  - Phase counts are independent.
  - Entries with null usage/cost and failed outcomes still count.
- `test/ink-state.test.ts` or `test/ink-ui.test.ts`
  - Committed usage displays average cost as total cost divided by execution count.
  - Unknown cost displays `"unknown"` for the average.
  - Zero executions do not divide by zero.
  - Streaming-only usage leaves execution count at zero and does not display a misleading average.
- `test/ink-state.test.ts`
  - `usageRecorded` increments worker and run counts.
  - `streamingUsage` does not increment either count.
- `test/loop-run.test.ts:568-572`
  - Assert run, issue, and phase execution counts after two recorded executions.
- `test/loop-run-tracker.test.ts`
  - Verify old persisted summaries are normalized correctly if compatibility migration is implemented.

## 5. Uncertainties

- The request says “the UI” but current UI rendering exposes total run cost in `ink-view.ts`; it does not currently render persisted `byIssue` or `byPhase` summaries. Average display scope should be confirmed.
- Backward compatibility for existing tracker JSON is not explicitly specified. Without normalization, old snapshots parse but have `undefined` execution counts.
- The desired zero-execution presentation is unspecified; `"n/a"` is safer than `$0.00` because no execution occurred.



---

# Answer A03

**Scenario:** impact


## 1. Executive summary

Add `executionCount: number` to `UsageTotals`. Count each ledger entry exactly once in run, issue, and phase buckets. Streaming usage must preserve the existing count because it is ephemeral and not ledger-backed.

Required production changes:

- `src/core/loop-run/state.ts:244-254` — extend `UsageTotals`.
- `src/core/loop-run/usage.ts:27-63` — initialize and increment counts while rebuilding summaries.
- `src/core/loop-run/ink-worker-projection.ts:29-77` — initialize and increment committed counts; streaming accumulation must not increment them.
- `src/core/loop-run/ink-state.ts:262-265` and `src/core/loop-run/ink-view.ts:87-103, 356-362` — expose average cost per execution in the UI.
- `docs/adr/0009-inline-usage-ledger-in-loop-run-tracker.md:20-34` — document the persisted summary field and counting semantics.

## 2. Detailed flow / architecture / impact analysis

- `UsageLedgerEntry` is the durable execution record and includes one `executionId` per returned execution (`src/core/loop-run/state.ts:233-242`).
- `LoopRun.recordUsage` appends one entry, then recomputes `usageSummary` from the complete ledger (`src/core/loop-run/loop-run.ts:483-536`). No change to ledger shape or recording flow is required.
- `buildUsageSummary` creates run, issue, and phase buckets and calls `accumulateInto` for each ledger entry (`src/core/loop-run/usage.ts:67-96`). Add `target.executionCount += 1` there. This naturally counts entries with null usage fields too.
- Entries without `issueId` must increment only run and phase counts; they must not create an issue bucket (`src/core/loop-run/usage.ts:83-94`).
- `zeroTotals` must set `executionCount: 0`, including empty summaries and unused phases (`src/core/loop-run/usage.ts:27-39`).
- The Ink projection independently maintains committed UI totals. `accumulateUsage` should increment `executionCount` for ledger entries (`src/core/loop-run/ink-worker-projection.ts:52-64`).
- `accumulateStreamingUsage` must return the existing `executionCount` unchanged (`src/core/loop-run/ink-worker-projection.ts:66-77`). Otherwise in-progress usage would inflate execution counts.
- `displayRunUsage` combines only ephemeral streaming values into a fresh zero total (`src/core/loop-run/ink-worker-projection.ts:253-264`). Its count should remain zero while streaming and should not be shown as an execution average.
- Add a formatter such as `formatAverageUsageCost(totals)` beside `formatUsageCost` (`src/core/loop-run/ink-state.ts:262-265`). It should return `unknown` when cost is unknown, and otherwise divide `costUsd` by `executionCount`; zero executions should produce a suitable non-numeric value such as `—`.
- Update the committed run summary and selected-worker usage display to show total cost and average cost (`src/core/loop-run/ink-view.ts:87-103, 356-362`). Do not show an average for in-progress streaming totals unless the UI explicitly labels it as unavailable.
- The worker projection has no separate phase-bucket totals; its `worker.usage` is the issue’s committed total. The persisted `UsageSummary.byPhase` remains handled exclusively by `buildUsageSummary`.

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| `UsageTotals` currently has no execution count | `UsageTotals` | `src/core/loop-run/state.ts:244-254` |
| Ledger entries represent executions and have monotonic IDs | `UsageLedgerEntry` | `src/core/loop-run/state.ts:233-242` |
| Summaries contain run, issue, and phase buckets | `UsageSummary` | `src/core/loop-run/state.ts:256-260` |
| Ledger append triggers full summary recomputation | `LoopRun.recordUsage` | `src/core/loop-run/loop-run.ts:483-536` |
| Summary buckets are initialized by `zeroTotals` | `zeroTotals` | `src/core/loop-run/usage.ts:27-39` |
| Each ledger entry is accumulated into run, issue, and phase totals | `buildUsageSummary`, `accumulateInto` | `src/core/loop-run/usage.ts:41-96` |
| Entries without issue IDs are excluded from issue buckets | `buildUsageSummary` | `src/core/loop-run/usage.ts:83-94` |
| UI projection accumulates committed ledger entries | `accumulateUsage` | `src/core/loop-run/ink-worker-projection.ts:52-64` |
| Streaming accumulation currently copies usage fields into display totals | `accumulateStreamingUsage` | `src/core/loop-run/ink-worker-projection.ts:66-77` |
| Streaming usage is ephemeral and cleared after recording | `applyUsageRecordedToWorkerProjection` | `src/core/loop-run/ink-worker-projection.ts:191-221` |
| In-progress totals are built separately from committed totals | `displayRunUsage` | `src/core/loop-run/ink-worker-projection.ts:253-264` |
| Run summary currently displays only total cost | `renderRunUsageLines` | `src/core/loop-run/ink-view.ts:87-103` |
| Worker details currently display only total cost | selected-worker render | `src/core/loop-run/ink-view.ts:356-362` |
| Existing cost formatting handles unknown cost | `formatUsageCost` | `src/core/loop-run/ink-state.ts:262-265` |
| ADR defines the ledger as source of truth and summary buckets | Usage Ledger/Usage Summary decision | `docs/adr/0009-inline-usage-ledger-in-loop-run-tracker.md:20-34` |

## 4. Tests and documentation

Tests expected to break because they use exact object equality without `executionCount`:

- `test/usage.test.ts:23-38` — empty summary exact equality.
- `test/loop-run-tracker.test.ts:58-149` — initial persisted summary exact equality for every bucket.

Tests that should be updated:

- `test/usage.test.ts:40-50` — assert run count equals 2.
- `test/usage.test.ts:78-87` — assert issue counts (`42 = 2`, `99 = 1`).
- `test/usage.test.ts:89-100` — assert phase counts and zero counts for unused phases.
- `test/usage.test.ts:102-108` — verify no issue bucket is created, while run/phase counts still increment.
- `test/usage.test.ts:110-121` — verify null-usage entries still count.
- `test/ink-state.test.ts:309-348` — verify streaming totals retain count zero and committed entries increment count.
- `test/ink-state.test.ts:230-301` — verify worker committed count increments and streaming updates do not.
- `test/ink-ui.test.ts:121-147` — assert rendered average cost for committed usage and no misleading average for in-progress usage.

Documentation:

- Update `docs/adr/0009-inline-usage-ledger-in-loop-run-tracker.md:30` to state that each summary bucket includes the number of contributing ledger entries, including entries with unknown usage values.
- Document that streaming usage never contributes to `executionCount`.

## 5. Uncertainties

- The request does not specify the desired zero-execution or unknown-cost display. `—` for zero executions and `unknown` for unknown cost are reasonable inferred behavior.
- It is unclear whether average cost should appear for worker totals, run totals, or both. The existing UI renders both, so both are the safest impact scope.
- Existing persisted tracker JSON may contain older summaries without `executionCount`; compatibility/defaulting behavior is not visible in the inspected type and tracker initialization paths. A migration or read-time default may be required if historical runs are loaded.

