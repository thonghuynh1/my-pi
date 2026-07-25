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

## 1. Executive summary

The implemented pipeline is complete through parsing and durable tracker persistence, but **not through criterion fact emission or criterion-specific dashboard projection**:

`runAgentExecution()` stdout → `runVerification()` parses criteria → `TaskPipeline` calls `LoopRun.recordCriterionVerdicts()` → tracker persists criteria and evidence.

`recordCriterionVerdicts()` emits no event. `LoopRunEvent` has no criterion-verdict event, and the Ink dashboard projection has no criterion-verdict field or reducer. Only subsequent task phase/meta events reach the dashboard.

## 2. Detailed flow / architecture / impact analysis

1. **Raw verifier stdout**
   - `runVerification()` receives `execResult.output` from `runAgentExecution()` and assigns it to `raw`.
   - It parses `<criterion>` blocks with `parseCriterionVerdicts()`, normalizing statuses to `met`, `unmet`, or `regressed`; malformed statuses become `unmet`.
   - The overall `<verdict>` tag independently controls `passed`.

2. **Task-pipeline boundary**
   - `TaskPipeline.executeTask()` calls `runVerification()`, stores `v.criteria`, then invokes `loopRun.recordCriterionVerdicts(issue.id, v.criteria)`.

3. **Stable criterion identity**
   - Explicit `id` values are preserved.
   - Missing IDs receive positional IDs such as `criterion-1`.
   - `LoopRun.resolveCriterionIdentity()` stores identities in `criterionIdentities`; later attempts reuse the stored ordinal identity, even if wording changes.
   - This is ordinal persistence, not text hashing.

4. **Durable Loop Run Tracker**
   - `recordCriterionVerdicts()` creates evidence artifacts for captured stdout, then writes `criteria`, `criterionIdentities`, and `evidenceRef` into the task record.
   - `LoopRunTracker.update()` increments the revision and performs an atomic write.
   - This satisfies write-before-observation only insofar as persistence is concerned.

5. **Fact-event boundary**
   - No criterion-verdict fact is emitted. `recordCriterionVerdicts()` ends after `tracker.update()`.
   - ADR-0007's write-then-emit discipline is implemented for task phase/meta methods, but not for criterion verdicts because there is no corresponding event or emit call.
   - The available event union contains `taskPhaseChanged` and `taskMetaChanged`, but no criterion-verdict event.

6. **Live Dashboard**
   - Ink state handles `taskPhaseChanged`, `taskMetaChanged`, usage, streaming usage, and run completion.
   - `WorkerDashboardRow` contains phase, metadata, and usage only; it has no criteria/verdict projection.
   - Therefore criterion verdicts are not reflected directly in the Live Dashboard. The dashboard may show the later `failed` or `done` phase, but not the per-criterion verdict.

7. **Protection against false completion**
   - Missing `<verdict>` produces `inconclusive` and `passed: false`.
   - Verifier execution errors produce `errored` and `passed: false`; after a retry, the task remains unverified and is marked failed.
   - Task completion requires both `taskResult.success` and `taskResult.verified`; only then is the issue marked done.
   - However, a verifier output containing `<verdict>PASS</verdict>` with malformed or missing criterion blocks can still set `passed: true`. The parser defaults malformed statuses to `unmet`, but completion does not independently require all persisted criteria to be `met`. This is a remaining correctness gap.

## 3. Evidence table

| Claim | Symbol | File:line |
|---|---|---|
| Verifier stdout becomes `raw` and is parsed into criteria | `runVerification`, `parseCriterionVerdicts` | `src/core/actions/verifier.ts:234-281` |
| Malformed criterion statuses normalize to `unmet` | `normalizeCriterionStatus` | `src/core/actions/verifier.ts:83-88` |
| Missing overall verdict is inconclusive and not passed | `runVerification` | `src/core/actions/verifier.ts:283-300` |
| Pipeline forwards parsed criteria to the Loop Run | `executeTask` | `src/core/utils/task-pipeline.ts:371-379` |
| Explicit IDs are preserved; omitted IDs use frozen ordinals | `recordCriterionVerdicts`, `resolveCriterionIdentity` | `src/core/loop-run/loop-run.ts:314-345; 620-636` |
| Evidence stdout is written and referenced from tracker state | `recordCriterionVerdicts` | `src/core/loop-run/loop-run.ts:346-365` |
| Tracker update increments revision and atomically writes | `LoopRunTracker.update` | `src/core/utils/loop-run-tracker.ts:132-140` |
| Criterion persistence emits no fact event | `recordCriterionVerdicts` | `src/core/loop-run/loop-run.ts:322-365` |
| Event union has no criterion-verdict event | `LoopRunEvent` | `src/core/loop-run/events.ts:99-124` |
| Dashboard reducer handles phases/meta, not criteria | `applyLoopRunEventToInkState` | `src/core/loop-run/ink-state.ts:158-202` |
| Worker projection has no criterion verdict fields | `WorkerDashboardRow` | `src/core/loop-run/ink-worker-projection.ts:8-19` |
| Done requires successful, verified task | `handleTaskCompletion` | `src/core/ralph-loop.ts:135-148` |
| ADR-0007 requires durable write before synchronous fact emission | ADR-0007 decision | `docs/adr/0007-loop-run-coordinator-and-fact-events.md:17-20` |

## 4. Tests and documentation

- Verifier parsing, malformed status fallback, missing verdict handling, and explicit IDs: `test/verifier.test.ts:98-179`.
- Positional identity freezing and evidence persistence: `test/loop-run.test.ts:400-489`.
- Legacy tracker compatibility: `test/loop-run-tracker.test.ts:27-56`.
- ADR-0007 defines the sole-writer and write-then-emit architecture: `docs/adr/0007-loop-run-coordinator-and-fact-events.md:17-20`.

No cited test establishes a criterion-verdict fact event or dashboard criterion projection.

## 5. Uncertainties

- The dashboard may intentionally expose only aggregate task phase rather than individual criteria; the current source provides no criterion-specific projection contract.
- The malformed-`PASS` completion gap is directly implied by the control flow, but no test was found covering that exact combination.


---

# Answer A02

## 1. Executive summary

`UsageTotals` is defined in `src/core/loop-run/state.ts:244-254` and aggregated from ledger entries by `buildUsageSummary`. Add `executionCount: number` to the type and initialize/increment it only for ledger-backed entries.

Required changes:

- `src/core/loop-run/state.ts` — add the field to `UsageTotals`.
- `src/core/loop-run/usage.ts` — initialize count to zero and increment once in `accumulateInto`.
- `src/core/loop-run/ink-worker-projection.ts` — update all `UsageTotals` constructors and ledger accumulation; leave streaming accumulation count unchanged.
- `src/core/loop-run/ink-view.ts` — display average cost using run-level `executionCount`.
- `test/usage.test.ts` — update expected totals and add count/isolation tests.

`loop-run.ts` already records exactly one ledger entry per execution and recomputes the summary, so its recording logic does not require a behavioral change.

## 2. Detailed flow / architecture / impact analysis

1. `UsageLedgerEntry` extends `AgentExecutionUsage` and represents one completed execution (`state.ts:233-242`).
2. `LoopRun.recordUsage` allocates an execution ID, appends one entry, and recomputes `usageSummary` from the complete ledger (`loop-run.ts:482-489`, `504-536`).
3. `buildUsageSummary` creates run, issue, and phase buckets, then calls `accumulateInto` for each ledger entry (`usage.ts:67-94`).
4. `accumulateInto` is therefore the authoritative place to increment `executionCount`; increment once before or after numeric aggregation (`usage.ts:41-58`).
5. The Ink projection separately maintains ledger-backed totals through `accumulateUsage`, used for run totals and worker/issue totals (`ink-worker-projection.ts:52-64`, `191-221`).
6. Streaming updates use `accumulateStreamingUsage`, which intentionally combines ephemeral usage into display totals (`ink-worker-projection.ts:66-78`, `253-263`). This function must not increment `executionCount`.
7. The run summary UI renders `state.runUsage` and currently displays total cost (`ink-view.ts:87-104`, `294-315`). Add average cost there as `costUsd / executionCount`, with an appropriate zero-count/unknown-cost guard.
8. Worker detail totals are ledger-backed plus ephemeral display state (`ink-view.ts:351-362`). If average cost is also shown there, it must use the worker’s ledger-backed `usage.executionCount`, not `streamingUsage`.

Concrete edit guidance:

- **`src/core/loop-run/state.ts`**
  - Symbol: `UsageTotals`
  - Add `executionCount: number`, documenting that it counts ledger entries only.

- **`src/core/loop-run/usage.ts`**
  - Symbols: `zeroTotals`, `accumulateInto`
  - Set `executionCount: 0` in `zeroTotals`.
  - Increment `target.executionCount` exactly once in `accumulateInto`.
  - This automatically counts run, issue, and phase buckets because each receives the same ledger entry at `buildUsageSummary:80-92`.

- **`src/core/loop-run/ink-worker-projection.ts`**
  - Symbols: `zeroUsageTotals`, `accumulateUsage`, `accumulateStreamingUsage`
  - Initialize the field to zero.
  - Increment it in `accumulateUsage`.
  - Preserve the target count in `accumulateStreamingUsage`; do not count streaming updates.
  - `displayRunUsage` will consequently retain the ledger count while adding ephemeral numeric usage.

- **`src/core/loop-run/ink-view.ts`**
  - Symbol: `renderRunUsageLines`
  - Add an average-cost line derived from `state.runUsage.costUsd` and `state.runUsage.executionCount`.
  - Do not calculate an average from in-progress streaming usage.

- **`test/usage.test.ts`**
  - Update exact zero-object assertions.
  - Add run, issue, and phase count assertions.
  - Add empty-ledger, issue-less, mixed-phase, and null-usage cases.
  - Add projection tests for streaming usage not changing count if projection tests exist; otherwise add them alongside projection coverage.

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| `UsageTotals` contains aggregate numeric and unknown-value fields | `UsageTotals` | `src/core/loop-run/state.ts:244-254` |
| Ledger entries represent executions and include execution metadata | `UsageLedgerEntry` | `src/core/loop-run/state.ts:233-242` |
| Each recorded execution appends one ledger entry | `recordUsage` | `src/core/loop-run/loop-run.ts:482-489`, `504-536` |
| Summary contains run, issue, and phase buckets | `UsageSummary`, `buildUsageSummary` | `src/core/loop-run/state.ts:256-260`; `src/core/loop-run/usage.ts:67-94` |
| Every ledger entry is accumulated into the run bucket | `buildUsageSummary` | `src/core/loop-run/usage.ts:80-82` |
| Issue buckets receive only entries with an issue ID | `buildUsageSummary` | `src/core/loop-run/usage.ts:83-89` |
| Phase buckets receive every ledger entry | `buildUsageSummary` | `src/core/loop-run/usage.ts:91` |
| Numeric and unknown-value aggregation is centralized | `accumulateInto` | `src/core/loop-run/usage.ts:41-58` |
| Ink projection accumulates ledger-backed worker/run usage | `accumulateUsage`, `applyUsageRecordedToWorkerProjection` | `src/core/loop-run/ink-worker-projection.ts:52-64`, `191-221` |
| Streaming usage is ephemeral and not ledger-backed | `emitStreamingUsage` | `src/core/loop-run/loop-run.ts:542-549` |
| Streaming totals are accumulated separately | `accumulateStreamingUsage`, `displayRunUsage` | `src/core/loop-run/ink-worker-projection.ts:66-78`, `253-263` |
| Run Summary currently displays total cost | `renderRunUsageLines` | `src/core/loop-run/ink-view.ts:87-104` |
| Existing tests assert the exact zero-total shape | `buildUsageSummary` tests | `test/usage.test.ts:22-38` |
| Existing tests cover numeric aggregation and grouping | `buildUsageSummary` tests | `test/usage.test.ts:40-100` |

## 4. Tests and documentation

Tests that will break:

- `test/usage.test.ts:23-35` — exact `summary.run` equality must include `executionCount`.
- `test/usage.test.ts:134-143` — phase zero-total matching should include the new field if made exact.

New tests:

- Empty ledger: run and every phase have count `0`.
- Two ledger entries: run count is `2`.
- Issue grouping: counts are independent per issue; entries without `issueId` do not affect `byIssue`.
- Phase grouping: counts are independent per phase.
- Entries with null token/cost fields still count as executions.
- Streaming projection updates do not change count.
- Ledger-backed projection updates increment count once per `UsageLedgerEntry`.
- UI rendering shows average cost only when execution count is nonzero and cost is known.

No documentation changes are strictly required based on the inspected code. The `UsageTotals` field comment should document ledger-only semantics.

## 5. Uncertainties

- The inspected UI renders run-level projected totals, not the persisted `UsageSummary.byIssue` or `byPhase`; average-cost UI placement should therefore be confirmed against the intended product design.
- No dedicated projection test file was surfaced by the indexed search, so new streaming-count tests may need to be added to an existing Ink/projection test suite.


---

# Answer A03

## 1. Executive summary

`UsageTotals` is defined in `src/core/loop-run/state.ts:244-253` and is produced by two separate accumulation paths:

- Durable ledger summaries: `src/core/loop-run/usage.ts:27-84`
- Ephemeral Ink dashboard projections: `src/core/loop-run/ink-worker-projection.ts:29-76`

Add `executionCount: number` to both zero-value constructors and increment it only in ledger-entry accumulation. Do not increment it in `accumulateStreamingUsage`.

The UI currently renders committed and in-progress cost in `src/core/loop-run/ink-view.ts:87-103` and worker cost in `src/core/loop-run/ink-view.ts:356-362`. Add average-cost formatting using `costUsd / executionCount`, returning `"unknown"` when cost is unknown or the count is zero.

## 2. Detailed flow / architecture / impact analysis

1. `UsageLedgerEntry` represents one completed execution and is persisted in `RunSnapshot.usageLedger` (`src/core/loop-run/state.ts:233-242`, `:298-299`).
2. `LoopRun.recordUsage` appends one entry, then recomputes the entire summary with `buildUsageSummary` (`src/core/loop-run/loop-run.ts:506-533`).
3. `buildUsageSummary` initializes run, issue, and phase buckets with `zeroTotals`, then calls `accumulateInto` once for each ledger entry (`src/core/loop-run/usage.ts:27-64`, `:67-84`).
4. `executionCount` must therefore be incremented in `accumulateInto`; this automatically updates run, issue, and phase buckets.
5. The Ink projection separately accumulates committed entries through `accumulateUsage` (`src/core/loop-run/ink-worker-projection.ts:52-64`).
6. Streaming updates use `accumulateStreamingUsage` (`src/core/loop-run/ink-worker-projection.ts:66-78`) and are not ledger-backed. That function must preserve `executionCount` unchanged.
7. `displayRunUsage` starts from zero totals and adds only streaming usage (`src/core/loop-run/ink-worker-projection.ts:253-263`), so its count should remain zero for ephemeral usage.
8. Required implementation files:
   - **`src/core/loop-run/state.ts:244-253`** — add `executionCount: number` to `UsageTotals`.
   - **`src/core/loop-run/usage.ts:27-39`** — initialize `executionCount: 0` in `zeroTotals`.
   - **`src/core/loop-run/usage.ts:41-64`** — increment `target.executionCount` once per ledger entry.
   - **`src/core/loop-run/ink-worker-projection.ts:29-43`** — initialize the field in `zeroUsageTotals`.
   - **`src/core/loop-run/ink-worker-projection.ts:52-64`** — increment count for committed ledger entries.
   - **`src/core/loop-run/ink-worker-projection.ts:66-78`** — carry the existing count forward; do not increment it for streaming usage.
   - **`src/core/loop-run/ink-state.ts:262-265`** — add a formatter for average cost, or extend the existing cost-formatting helpers.
   - **`src/core/loop-run/ink-view.ts:87-103`** — render average cost alongside committed and in-progress cost. In-progress totals have no count, so average should be unavailable unless explicitly based on committed count.
   - **`src/core/loop-run/ink-view.ts:356-362`** — render worker average cost alongside worker total cost.
   - **`src/core/utils/loop-run-tracker.ts:47-54`** — consider normalizing or rebuilding legacy persisted summaries missing `executionCount`; current normalization only repairs task fields.
9. `src/core/loop-run/index.ts:25-31` already exports `UsageTotals`, so no export change is required.

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| `UsageTotals` contains all aggregate fields | `UsageTotals` | `src/core/loop-run/state.ts:244-253` |
| Ledger entries identify one execution | `UsageLedgerEntry` | `src/core/loop-run/state.ts:233-242` |
| Run, issue, and phase buckets share `UsageTotals` | `UsageSummary` | `src/core/loop-run/state.ts:255-259` |
| Durable summaries are initialized with zero totals | `zeroTotals` | `src/core/loop-run/usage.ts:27-39` |
| Each ledger entry is accumulated into buckets | `accumulateInto`, `buildUsageSummary` | `src/core/loop-run/usage.ts:41-84` |
| Recording usage appends to the ledger and recomputes summary | `recordUsage` | `src/core/loop-run/loop-run.ts:506-533` |
| Ink committed usage accumulates ledger entries | `accumulateUsage` | `src/core/loop-run/ink-worker-projection.ts:52-64` |
| Streaming usage is accumulated separately | `accumulateStreamingUsage` | `src/core/loop-run/ink-worker-projection.ts:66-78` |
| Streaming display starts from zero and only includes ephemeral values | `displayRunUsage` | `src/core/loop-run/ink-worker-projection.ts:253-263` |
| Run summary renders total cost | `renderRunUsageLines` | `src/core/loop-run/ink-view.ts:87-103` |
| Worker dashboard renders total cost | worker cost render | `src/core/loop-run/ink-view.ts:356-362` |
| Persisted snapshots are read without usage-summary normalization | `normalizeRunSnapshot`, `read` | `src/core/utils/loop-run-tracker.ts:47-54`, `:112-116` |

## 4. Tests and documentation

Tests requiring expected-object updates:

- `test/usage.test.ts:23-37` — add `executionCount: 0` to the empty summary expectation.
- `test/loop-run-tracker.test.ts:58-158` — add the field to every zeroed bucket in the initialization expectation.
- `test/loop-run-tracker.test.ts:160-229` and `:264-318` — update manually constructed `UsageTotals` fixtures.

New tests should cover:

- Empty ledger gives count `0`.
- Two ledger entries produce run count `2`.
- Counts are independently correct in `byIssue` and `byPhase`.
- Entries with null token/cost fields still count as executions.
- Streaming usage changes cost/tokens but leaves `executionCount` unchanged.
- Average cost is correct for known cost and positive count.
- Average cost is `"unknown"` when cost is unknown or count is zero.
- Legacy persisted snapshots either normalize or rebuild missing counts.

Existing projection/UI coverage is in `test/ink-state.test.ts:233-340` and `test/ink-ui.test.ts:116-146`; extend those tests for count preservation and average-cost rendering.

No documentation currently surfaced by the relevant symbols requires modification.

## 5. Uncertainties

- The request does not specify whether an in-progress average should use committed executions only or remain unavailable. The safer interpretation is that streaming usage contributes no count, so an in-progress-only average is unavailable.
- Persisted old snapshots may lack the new field. Because `normalizeRunSnapshot` currently does not normalize usage summaries, backward compatibility requires an explicit migration or recomputation from `usageLedger`.


---

# Answer A04

## 1. Executive summary

`UsageTotals` is defined in `src/core/loop-run/state.ts:244-253` and is produced by both durable ledger aggregation and the Ink UI projection.

Required changes:

- Add `executionCount: number` to `UsageTotals`.
- Increment it exactly once per `UsageLedgerEntry` in `buildUsageSummary`.
- Increment it for committed UI usage, but not streaming usage.
- Add average-cost formatting/display to the run summary.
- Update persisted-summary fixtures, projection tests, tracker normalization, and ADR documentation.

`LoopRun.recordUsage` already appends one ledger entry and rebuilds the summary, so its control flow does not need modification (`src/core/loop-run/loop-run.ts:506-538`).

## 2. Detailed flow / architecture / impact analysis

### Durable summary path

1. `LoopRun.recordUsage` creates one `UsageLedgerEntry`, appends it to `usageLedger`, and calls `buildUsageSummary` (`src/core/loop-run/loop-run.ts:506-538`).
2. `buildUsageSummary` initializes run, issue, and phase buckets and calls `accumulateInto` for each ledger entry (`src/core/loop-run/usage.ts:27-87`).
3. Add `executionCount: 0` in `zeroTotals`, then increment it in `accumulateInto`. This automatically counts each ledger entry in:
   - `run`
   - the matching `byIssue` bucket
   - the matching `byPhase` bucket
4. Entries without an `issueId` must still increment run and phase counts, but not create a `byIssue` bucket (`src/core/loop-run/usage.ts:75-84`).

### UI projection path

- `zeroUsageTotals` and `accumulateUsage` in `src/core/loop-run/ink-worker-projection.ts:29-63` must gain and update `executionCount`.
- `applyUsageRecordedToWorkerProjection` uses `accumulateUsage` for run and worker totals (`src/core/loop-run/ink-worker-projection.ts:193-221`), so committed entries will be counted.
- `accumulateStreamingUsage` must preserve `target.executionCount` rather than incrementing it (`src/core/loop-run/ink-worker-projection.ts:66-80`).
- `displayRunUsage` currently builds totals only from ephemeral streaming usage (`src/core/loop-run/ink-worker-projection.ts:253-263`). Its returned count must remain zero for streaming-only usage.
- Add average-cost formatting near `formatUsageCost` (`src/core/loop-run/ink-state.ts:262-265`). Average should use `costUsd / executionCount`; zero-count and unknown-cost cases need an explicit display policy.
- Add the average to `renderRunUsageLines` (`src/core/loop-run/ink-view.ts:87-104`). The in-progress line should not report a ledger execution count or let streaming usage inflate the average.

### Persistence and compatibility

- New runs already initialize their summary through `buildUsageSummary([])` (`src/core/utils/loop-run-tracker.ts:95-105`).
- `normalizeRunSnapshot` currently only normalizes task fields (`src/core/utils/loop-run-tracker.ts:38-47`). It should migrate/recompute summaries from `usageLedger` when reading older JSON, otherwise old snapshots lack `executionCount`.
- The source of truth remains the ledger, consistent with ADR-0009 (`docs/adr/0009-inline-usage-ledger-in-loop-run-tracker.md:38-49`).

### Files that must change

- `src/core/loop-run/state.ts`
  - `UsageTotals`: add `executionCount`.
- `src/core/loop-run/usage.ts`
  - `zeroTotals`: initialize count to `0`.
  - `accumulateInto`: increment once per ledger entry.
  - `buildUsageSummary`: no structural change beyond using updated totals.
- `src/core/loop-run/ink-worker-projection.ts`
  - `zeroUsageTotals`: initialize count.
  - `accumulateUsage`: increment count.
  - `accumulateStreamingUsage`: preserve count.
  - `displayRunUsage`: retain zero count for streaming-only totals.
- `src/core/loop-run/ink-state.ts`
  - Add average-cost formatter beside `formatUsageCost`.
- `src/core/loop-run/ink-view.ts`
  - `renderRunUsageLines`: display total cost and average cost per execution.
- `src/core/utils/loop-run-tracker.ts`
  - `normalizeRunSnapshot`: backfill/recompute summaries for older persisted snapshots.
- `test/usage.test.ts`
  - Update exact zero-total expectations and add count/grouping tests.
- `test/loop-run-tracker.test.ts`
  - Update persisted summary fixtures and add read/migration coverage.
- `test/ink-state.test.ts`
  - Assert committed count increments and streaming count remains zero.
- `test/ink-ui.test.ts`
  - Update summary expectations and test average-cost rendering.
- `docs/adr/0009-inline-usage-ledger-in-loop-run-tracker.md`
  - Document `executionCount` as the ledger-entry count and explicitly exclude streaming usage.

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| `UsageTotals` is the shared totals contract | `UsageTotals` | `src/core/loop-run/state.ts:244-253` |
| Summary contains run, issue, and phase buckets | `UsageSummary` | `src/core/loop-run/state.ts:255-259` |
| Ledger entries have execution identity and attribution | `UsageLedgerEntry` | `src/core/loop-run/state.ts:233-242` |
| Durable summary is recomputed from the full ledger | `buildUsageSummary` | `src/core/loop-run/usage.ts:67-87` |
| Every ledger entry contributes to run totals | `accumulateInto` call | `src/core/loop-run/usage.ts:75` |
| Issue totals exclude entries without `issueId` | `byIssue` branch | `src/core/loop-run/usage.ts:77-83` |
| Phase totals are accumulated independently | `byPhase` call | `src/core/loop-run/usage.ts:85` |
| LoopRun appends one ledger entry and rebuilds summary | `recordUsage` | `src/core/loop-run/loop-run.ts:506-538` |
| Streaming usage is explicitly non-persistent | `emitStreamingUsage` | `src/core/loop-run/loop-run.ts:540-550` |
| UI committed totals use ledger entries | `accumulateUsage` | `src/core/loop-run/ink-worker-projection.ts:52-63` |
| UI streaming totals use a separate accumulator | `accumulateStreamingUsage` | `src/core/loop-run/ink-worker-projection.ts:66-80` |
| Streaming usage is cleared after recording | `applyUsageRecordedToWorkerProjection` | `src/core/loop-run/ink-worker-projection.ts:193-221` |
| Run summary renders total cost | `renderRunUsageLines` | `src/core/loop-run/ink-view.ts:87-104` |
| Cost formatting currently has no average support | `formatUsageCost` | `src/core/loop-run/ink-state.ts:262-265` |
| Tracker initializes an empty durable summary | `LoopRunTracker.create` | `src/core/utils/loop-run-tracker.ts:95-105` |
| Existing tests assert exact totals object shapes | `buildUsageSummary` tests | `test/usage.test.ts:23-39` |
| Existing tracker fixtures assert exact summary shapes | tracker initialization test | `test/loop-run-tracker.test.ts:58-163` |
| Existing UI test verifies summary cost output | run summary test | `test/ink-ui.test.ts:126-147` |

## 4. Tests and documentation

Tests that will break or require updates:

- `test/usage.test.ts:23-39` — exact `UsageTotals` object lacks `executionCount`.
- `test/loop-run-tracker.test.ts:58-163` and `:167-318` — handcrafted persisted summaries lack the new field.
- `test/ink-ui.test.ts:126-147` — expected summary output must include average cost.
- `test/ink-state.test.ts:300-339` — add assertions for committed versus streaming counts.

New cases:

- Empty ledger yields `executionCount: 0` in every phase-independent zero bucket.
- Two ledger entries produce run count `2`.
- Issue counts include only entries for that issue.
- Phase counts include only entries for that phase.
- Entries without `issueId` count in run/phase but not `byIssue`.
- Entries with unknown cost still increment the count.
- Streaming-only usage leaves `executionCount` at `0`.
- Recorded usage followed by streaming usage does not increase the committed count.
- Average cost is total known cost divided by ledger execution count.
- Older persisted snapshots are migrated/recomputed with counts.

ADR-0009 should document that the count is based on ledger-backed agent executions and excludes ephemeral streaming updates (`docs/adr/0009-inline-usage-ledger-in-loop-run-tracker.md:38-49`).

## 5. Uncertainties

- The exact UI label and formatting for average cost are not established; existing UI only renders `cost $X.XX` (`src/core/loop-run/ink-view.ts:89-102`).
- Whether average cost should display `unknown`, `$0.00`, or `n/a` when count is zero or any cost is unknown requires a product decision.
- Recomputing summaries during snapshot normalization is the safest backward-compatible migration, but the repository currently has no explicit schema-version migration mechanism.


---

# Answer A05

## 1. Executive summary

On startup, `handleStaleRun` reads the active tracker, rejects a live owner, and otherwise treats a dead/expired owner as recoverable. It normalizes crash-sensitive steering state, computes permitted actions, and executes the selected recovery.

For ordinary stale runs, resume prepares safe task boundaries, adopts the existing tracker ownership, reconstructs scheduler state through `buildResumePlan`, and starts the resumed `LoopRun`. The coordinator then becomes the sole tracker writer: each durable revision is written atomically before ordered subscriber events are emitted.

A partial Force-Kill Undo is a separate safety state: normal resume is forbidden. Finish Rollback is offered only after durable process drainage and a recorded rollback snapshot. Merge recovery refuses to reset the primary workspace while it contains uncommitted edits.

## 2. Detailed flow / architecture / impact analysis

### Startup detection and action availability

1. `handleStaleRun`:
   - No tracker: proceed.
   - Tracker exists but owner is alive and heartbeat is recent: abort; a second loop cannot start.
   - Dead owner or expired heartbeat: continue stale recovery.
   - Non-interactive default startup aborts rather than selecting a recovery action implicitly.  
   (`src/core/utils/stale-run-recovery.ts:391-424`; `src/core/utils/loop-run-tracker.ts:145-166`)

2. `normalizeCrashRules()` runs before the action menu. It scans every task for live-steering records still marked `submitted`; if any exist, it persists those records as `unknown-after-crash`, then refreshes the in-memory state. If none exist, it does nothing.  
   (`src/core/utils/stale-run-recovery.ts:157-169`; `src/core/utils/state.ts:92-100`)

3. Ordinary stale run actions:
   - **resume**: always available; preserves workflow state and retries/restarts recoverable work.
   - **rollback**: available only when `rollbackSnapshotId` exists; restores the loop-start repository state and starts fresh.
   - **abandon**: archives the stale tracker and starts fresh without recovery.
   - **cancel**: aborts startup.
   (`src/core/utils/stale-run-recovery.ts:124-154`)

4. Partial panic-undo actions:
   - Detected when `panicUndo` exists and is not `rollback-completed`.
   - **resume** is deliberately unavailable.
   - **finishRollback** is available only when phase is `processes-drained` and a rollback snapshot ID exists.
   - **abandon** and **cancel** remain available.
   (`src/core/utils/stale-run-recovery.ts:112-140`; `docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:27-32`)

### Recovery execution

- **Rollback** adopts the saved snapshot, performs rollback, archives the tracker on success, cleans up, and releases the workspace lock. A failed rollback leaves recovery aborted and preserves failure details.  
  (`src/core/utils/stale-run-recovery.ts:184-224`)

- **Finish Rollback** requires a fresh confirmation, then performs the same destructive rollback. On success it records `rollback-completed` and archives the run as `interrupted` with terminal reason `panic-undo`. On failure it records `rollback-failed` and keeps the tracker active for another attempt.  
  (`src/core/utils/stale-run-recovery.ts:226-286`)

- **Resume** first prepares every task:
  - `implementing`: removes the task worktree/branch boundary so implementation restarts cleanly.
  - `merge-pending`/`merging`: aborts an in-progress merge, requires a clean primary tree, then resets to `preMergeHead`.
  - verification, completion marking, and interrupted review are safely rerunnable.
  - completed tasks with an unreachable `integratedHead` require an explicit restart/trust decision.
  
  After preparation succeeds, `adoptOwnership()` assigns the current PID, refreshes the heartbeat, sets status to `running`, and increments the tracker revision.  
  (`src/core/utils/stale-run-recovery.ts:299-344`; `src/core/utils/stale-run-recovery.ts:461-524`; `src/core/utils/loop-run-tracker.ts:145-157`)

### Resume plan and scheduler reconstruction

`ralphLoop` constructs the `LoopRun`, calls `startOrResume`, then calls `buildResumePlan`.

`buildResumePlan`:

1. Reads the persisted task table.
2. Initially treats only `done` tasks as terminal.
3. For every `mark-done-pending` task:
   - calls optional `issueSource.isDone`;
   - retries `markDone` when necessary, using the persisted ID, title, and body;
   - records the durable transition to `done`;
   - adds the issue to `terminalIds`.
4. Re-reads the tracker after those writes.
5. Builds `replayQueue` from every non-terminal task except `mark-done-pending`.
6. Restores `scheduler.iterationsStarted` and `scheduler.skippedIds`.

Thus interrupted implementation, verification, merge, or scheduled work is replayed, while completed work is not.  
(`src/core/loop-run/resume-plan.ts:35-83`; `src/core/ralph-loop.ts:350-387`)

### Sole authoritative tracker ownership

The new process takes ownership before normal loop execution through `StaleRun.execute("resume")` → `tracker.adoptOwnership()`. `ralphLoop` then creates a `LoopRun` over that tracker. If a rollback snapshot already exists, `startOrResume` adopts it and returns the existing state rather than creating a new run.  
(`src/core/utils/stale-run-recovery.ts:299-320`; `src/core/ralph-loop.ts:334-386`; `src/core/loop-run/loop-run.ts:117-152`)

The tracker’s `update()` reads the current state, increments `revision` by one, and performs an atomic temporary-file write followed by rename. The coordinator’s lifecycle methods write through the tracker first and emit facts only after the write succeeds. Subscribers run synchronously in registration order.  
(`src/core/utils/loop-run-tracker.ts:119-143`; `src/core/utils/loop-run-tracker.ts:369-388`; `src/core/loop-run/loop-run.ts:275-310`; `src/core/loop-run/loop-run.ts:607-610`; `docs/adr/0007-loop-run-coordinator-and-fact-events.md:18-20`)

### Why partial Force-Kill Undo is special

A stale PID only proves the prior process is gone; it does not prove all writer subprocesses exited before rollback. Therefore the tracker persists panic-undo phases, and startup permits Finish Rollback only after `processes-drained` plus a snapshot handle. Normal resume is blocked because continuing workflow work could occur against a partially destructive transaction.  
(`src/core/loop-run/loop-run.ts:205-264`; `src/core/utils/stale-run-recovery.ts:112-140`; `docs/adr/0005-git-backed-force-kill-undo.md:53-57`)

Finish Rollback also requires a new explicit confirmation. A successful operation records rollback completion and archives the run as interrupted; a failure leaves the tracker active.  
(`src/core/utils/stale-run-recovery.ts:226-286`)

### Merge-phase safety check

For interrupted merge recovery, the code aborts any merge, then repeatedly checks `git.isDirty()`. If the primary workspace has uncommitted edits, recovery pauses for the developer to clean it or abandon; non-interactive recovery throws. This prevents `resetHard(preMergeHead)` from overwriting manual changes.  
(`src/core/utils/stale-run-recovery.ts:500-524`; `docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:15`)

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| Staleness is based on owner liveness or heartbeat age | `isStale` | `src/core/utils/loop-run-tracker.ts:145-166` |
| Non-interactive stale startup does not choose a default | `handleStaleRun` | `src/core/utils/stale-run-recovery.ts:405-424` |
| Crash normalization converts submitted steering to unknown | `normalizeCrashRules` | `src/core/utils/stale-run-recovery.ts:157-169` |
| Ordinary action availability depends on snapshot presence | `getAvailableActions` | `src/core/utils/stale-run-recovery.ts:124-154` |
| Partial undo blocks resume | `isPartialPanicUndo`, `getAvailableActions` | `src/core/utils/stale-run-recovery.ts:112-140` |
| Finish Rollback requires drained writers and snapshot ID | `canFinishRollback` | `src/core/utils/stale-run-recovery.ts:116-123` |
| Resume cleans interrupted implementation worktrees | `prepareImplementingResume` | `src/core/utils/stale-run-recovery.ts:461-469` |
| Resume protects merge reset from dirty edits | `prepareMergingResume` | `src/core/utils/stale-run-recovery.ts:471-524` |
| Resume adopts current process ownership | `execute("resume")` | `src/core/utils/stale-run-recovery.ts:299-320` |
| Mark-done-pending tasks are retried and advanced | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:48-70` |
| Replay queue excludes terminal and mark-done-pending tasks | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:72-83` |
| Scheduler iterations and skipped IDs are restored | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:78-83` |
| Tracker revisions are monotonic | `LoopRunTracker.update` | `src/core/utils/loop-run-tracker.ts:119-133` |
| Writes are atomic | `atomicWrite` | `src/core/utils/loop-run-tracker.ts:369-388` |
| LoopRun is the sole writer and emits after persistence | `LoopRunOptions`, coordinator methods | `src/core/loop-run/loop-run.ts:44-50`, `275-310` |
| Subscribers receive ordered synchronous facts | `subscribe`, `emit` | `src/core/loop-run/loop-run.ts:78-94`, `607-610` |
| Partial undo state is durable | `requestPanicUndo`, `rollback` | `src/core/loop-run/loop-run.ts:205-264`, `165-201` |

## 4. Tests and documentation

- `test/stale-run-recovery.test.ts:75-104` covers ordinary action availability.
- `test/stale-run-recovery.test.ts:1213-1372` covers partial panic-undo gating.
- `test/stale-run-recovery.test.ts:1387-1489` covers Finish Rollback confirmation and failure retention.
- `test/recovery-integration.test.ts:230-300` covers dirty merge protection and clean merge replay.
- `test/resume-plan.test.ts:16-99` covers `mark-done-pending`, including body propagation and idempotent completion.
- `docs/adr/0005-git-backed-force-kill-undo.md` defines rollback and partial-undo safety.
- `docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md` defines stale recovery and resume policy.
- `docs/adr/0007-loop-run-coordinator-and-fact-events.md` defines sole ownership and write-then-emit ordering.

## 5. Uncertainties

- The ADR requires Finish Rollback to validate snapshot readability and branch/workspace context, but `canFinishRollback()` currently checks only panic phase and snapshot ID (`src/core/utils/stale-run-recovery.ts:116-123`).
- The ADR says startup-finished partial undo should first adopt a `LoopRun`; the current `finishRollback` branch writes directly through `LoopRunTracker` before archiving (`src/core/utils/stale-run-recovery.ts:226-286`). Ordinary resume does reach a coordinator-owned `LoopRun`.
- Abandon currently calls `markCompletedAndArchive()` even for partial panic-undo (`src/core/utils/stale-run-recovery.ts:174-181`), whereas ADR-0006 specifies archival as `interrupted` with retained panic-undo state.


---

# Answer A06

## 1. Executive summary

The implemented pipeline is:

`verifier stdout → runVerification → TaskPipeline → LoopRun.recordCriterionVerdicts → LoopRunTracker`

Criterion identity and status are stabilized and persisted, but the requested final two stages do **not** exist for per-criterion verdicts:

- No `criterionVerdictsRecorded` fact event is defined or emitted.
- The Live Dashboard worker projection has no criterion-verdict fields or reducer.

Only the related task lifecycle phases (`verifying`, `mark-done-pending`, `done`, `failed`) reach fact subscribers and the dashboard.

## 2. Detailed flow / architecture / impact analysis

1. **Raw stdout parsing — `runVerification`**
   - `runAgentExecution` returns verifier stdout, which is assigned to `raw`.
   - `parseCriterionVerdicts(raw)` extracts `<criterion>` blocks, ordinal position, optional explicit ID, normalized status, prose, and fenced stdout evidence.
   - Missing or malformed criterion status becomes `unmet`; missing `<verdict>` produces `inconclusive` and `passed: false`.
   - Evidence: `src/core/actions/verifier.ts:237-281`, `src/core/actions/verifier.ts:114-137`, `src/core/actions/verifier.ts:283-302`.

2. **Task-pipeline boundary**
   - `TaskPipeline.executeTask` invokes `runVerification`, then passes `v.criteria` to `loopRun.recordCriterionVerdicts`.
   - Verifier execution errors are retried once; two errors break the loop and do not set `verified`.
   - Only `v.passed`—which requires an explicit `PASS` verdict—sets `verified = true`.
   - Evidence: `src/core/utils/task-pipeline.ts:371-387`.

3. **Stable criterion identity**
   - `LoopRun.recordCriterionVerdicts` preserves explicit IDs.
   - For omitted IDs, `resolveCriterionIdentity` reuses the identity already stored at that ordinal; otherwise it generates `criterion-N`.
   - This freezes positional identity across retries, even when verifier wording changes.
   - Evidence: `src/core/loop-run/loop-run.ts:314-320`, `src/core/loop-run/loop-run.ts:343-365`, `src/core/loop-run/loop-run.ts:619-636`.

4. **Durable persistence**
   - Each criterion is normalized and stored inline under `tasks[issueId].criteria`.
   - Fenced stdout is written to a run-scoped hashed artifact; only its `evidenceRef` is stored in the tracker.
   - `LoopRunTracker.update` increments the revision and calls `atomicWrite`; `atomicWrite` writes a temporary JSON file and renames it into place.
   - Evidence: `src/core/loop-run/loop-run.ts:346-365`, `src/core/loop-run/loop-run.ts:639-667`, `src/core/utils/loop-run-tracker.ts:132-140`, `src/core/utils/loop-run-tracker.ts:371-378`.

5. **Fact-event boundary: missing for verdicts**
   - `recordCriterionVerdicts` performs the tracker update but never calls `emit`.
   - `events.ts` defines lifecycle, usage, steering, and run events, but no criterion-verdict event.
   - Therefore ADR-0007’s write-then-emit discipline is enforced for phase/meta methods, not for criterion verdicts: there is no verdict fact to emit.
   - Evidence: `src/core/loop-run/loop-run.ts:322-365`, `src/core/loop-run/events.ts:12-75`, `src/core/loop-run/loop-run.ts:275-310`.

6. **Live Dashboard projection: only lifecycle status**
   - `applyLoopRunEventToInkState` handles `taskPhaseChanged` and `taskMetaChanged`.
   - `applyTaskPhaseToWorkerProjection` updates the worker’s phase, phase history, title, ordering, and timestamp.
   - `WorkerDashboardRow` contains no criterion collection, verdict, or evidence fields.
   - Thus the dashboard reflects `verifying`, `done`, or `failed`, but not individual verdicts.
   - Evidence: `src/core/loop-run/ink-state.ts:161-182`, `src/core/loop-run/ink-worker-projection.ts:9-20`, `src/core/loop-run/ink-worker-projection.ts:154-175`.

7. **Completion safety**
   - `ralphLoop` marks an issue `done` only when both `taskResult.success` and `taskResult.verified` are true.
   - Otherwise it records `failed` and leaves the issue open.
   - `mark-done-pending` is persisted before `issueSource.markDone`; `done` is recorded only after that operation returns.
   - Evidence: `src/core/ralph-loop.ts:526-546`.

## 3. Evidence table

| Claim | Symbol | File:line |
|---|---|---|
| Verifier stdout becomes `raw` and is parsed into criteria | `runVerification`, `parseCriterionVerdicts` | `src/core/actions/verifier.ts:237-281` |
| Criterion blocks receive ordinal IDs and normalized statuses | `parseCriterionVerdicts` | `src/core/actions/verifier.ts:114-137` |
| Missing overall verdict is inconclusive and cannot pass | `runVerification` | `src/core/actions/verifier.ts:283-302` |
| Criteria cross into orchestration | `executeTask` | `src/core/utils/task-pipeline.ts:371-387` |
| Explicit IDs are preserved; positional IDs are frozen | `resolveCriterionIdentity` | `src/core/loop-run/loop-run.ts:619-636` |
| Criteria are persisted inline | `recordCriterionVerdicts` | `src/core/loop-run/loop-run.ts:322-365` |
| Stdout evidence is stored as a hashed artifact reference | `writeCriterionEvidenceArtifact` | `src/core/loop-run/loop-run.ts:639-667` |
| Tracker writes are revisioned and atomic | `LoopRunTracker.update`, `atomicWrite` | `src/core/utils/loop-run-tracker.ts:132-140, 371-378` |
| Lifecycle events are emitted after writes | `recordTaskPhase`, `recordTaskMeta` | `src/core/loop-run/loop-run.ts:275-310` |
| No criterion fact event exists | `LoopRunEvent` union | `src/core/loop-run/events.ts:12-75` |
| Dashboard projects lifecycle phase changes | `applyTaskPhaseToWorkerProjection` | `src/core/loop-run/ink-worker-projection.ts:154-175` |
| `done` requires successful explicit verification | `ralphLoop` completion branch | `src/core/ralph-loop.ts:526-546` |

## 4. Tests and documentation

- Positional identity stability and evidence persistence: `test/loop-run.test.ts:400-490`.
- Malformed criterion status and missing verdict behavior: `test/verifier.test.ts:121-186`.
- Legacy tracker compatibility: `test/loop-run-tracker.test.ts:44-56`.
- ADR-0007 specifies sole-writer and write-then-emit semantics: `docs/adr/0007-loop-run-coordinator-and-fact-events.md:20-35`.
- Verifier output grammar requires criterion blocks followed by exactly one verdict: `src/instruction/verify.md:29-54`.

## 5. Uncertainties

- The code may intentionally treat lifecycle phase events as sufficient dashboard visibility; however, no repository evidence shows per-criterion verdict projection.
- “Emitted as a fact event” and “reflected in the Live Dashboard worker projection” are not currently satisfied for the criterion record itself.
- Malformed criterion blocks are retained as `unmet`, but malformed or crashed verifier execution produces no criteria and cannot mark the task done because `passed` remains false.


---

# Answer A07

## 1. Executive summary

On startup, `handleStaleRun` reads `.ralph-loop/runs/active.json`, rejects an active owner, fails closed without a TTY, normalizes crash artifacts, then offers only actions valid for the persisted state. Ordinary stale runs may resume, roll back when a snapshot exists, abandon, or cancel. Partial Force-Kill Undo runs cannot resume; they may finish rollback only after durable process-drain evidence and a snapshot are present.  
Evidence: `src/core/utils/stale-run-recovery.ts:392-438`; `docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:32-41,54-57`.

For normal resume, interrupted writer phases are cleaned and replayed from safe boundaries. The new process adopts the existing tracker ownership, constructs a `LoopRun`, builds scheduler state from the persisted task table, and continues writing the same tracker through atomic, revision-incrementing updates before notifying subscribers.  
Evidence: `src/core/utils/stale-run-recovery.ts:264-302`; `src/core/loop-run/resume-plan.ts:35-77`; `src/core/loop-run/loop-run.ts:4-7,96-102`.

## 2. Detailed flow / architecture / impact analysis

1. **Detection and action selection**
   - Missing tracker: proceed with a fresh run.
   - Non-stale tracker: abort to prevent two owners.
   - Default non-TTY startup: abort rather than silently choosing recovery.
   - `normalizeCrashRules()` runs before the recovery menu. It finds task `liveSteering` records still marked `submitted`, persists them as `unknown-after-crash`, and refreshes in-memory state. Already-terminal steering statuses are unchanged; task phases are unaffected.
   - Ordinary stale run actions are `resume`, `abandon`, and `cancel`; `rollback` is inserted only when `rollbackSnapshotId` exists. A missing snapshot disables loop-start rollback but does not disable tracker-based resume.
   - A partial panic undo is identified by `panicUndo.phase !== "rollback-completed"`. It suppresses ordinary `resume` and `rollback`; it offers `finishRollback` only when phase is `processes-drained` and a snapshot exists, always retaining `abandon` and `cancel`.
   - Evidence: `src/core/utils/stale-run-recovery.ts:112-164,392-438`; `src/core/loop-run/state.ts:112-123`; `docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:32-40,54-57`.

2. **Selected action**
   - `cancel` aborts startup without changing the run.
   - `abandon` archives the stale tracker and starts a new run.
   - Ordinary `rollback` adopts the recorded snapshot, restores Git state, archives the tracker only on success, cleans up, and releases the lock.
   - `resume` calls `prepareResume`; if recovery cannot safely continue, the developer may abandon. After preparation succeeds, the new process calls `tracker.adoptOwnership()`.
   - Evidence: `src/core/utils/stale-run-recovery.ts:166-303`.

3. **Crash normalization**
   - `normalizeCrashRules()` is a narrow pre-choice repair. It does nothing for state-only `StaleRun` instances or when no `submitted` records exist.
   - The pure state rule maps only `submitted → unknown-after-crash`; it does not infer whether the steering command reached the agent.
   - Evidence: `src/core/utils/stale-run-recovery.ts:157-164,428-431`; `src/core/loop-run/state.ts:112-123`.

4. **Resume preparation and replay planning**
   - `implementing`: delete/recreate the task worktree, discarding interrupted writer output.
   - `merge-pending`/`merging`: abort an in-progress merge, require a clean primary workspace, reset to `preMergeHead`, then clean the task worktree.
   - `verify-pending`/`verifying`: verification is rerun.
   - `mark-done-pending`: completion marking is retried.
   - `done`: its `integratedHead` must remain reachable from `HEAD`; otherwise the developer chooses restart or trust.
   - Interrupted/failed/blocked whole-run review is rerun.
   - `buildResumePlan` marks existing `done` tasks terminal, processes `mark-done-pending` tasks by calling `isDone` when available or `markDone` otherwise, records `done` through `LoopRun`, and then builds:
     - `replayQueue`: nonterminal tasks;
     - `terminalIds`: completed tasks plus newly completed pending-mark tasks;
     - `resumeIterations`: persisted `scheduler.iterationsStarted`;
     - `resumeSkippedIds`: persisted skipped IDs.
   - Evidence: `src/core/utils/stale-run-recovery.ts:307-371,454-501`; `src/core/loop-run/resume-plan.ts:35-77`; `src/core/ralph-loop.ts:386-387,687-745`.

5. **Sole tracker ownership and scheduler control**
   - After resume preparation, `adoptOwnership()` changes the existing logical run to `status: "running"`, records the new PID and heartbeat, and increments the revision; it does not create a new run ID or tracker.
   - `ralphLoop` then constructs `LoopRun` over that same tracker. `startOrResume()` reads the existing tracker and adopts its existing rollback snapshot rather than creating a new snapshot/tracker.
   - The scheduler consumes `replayQueue` first, seeds claimed/terminal IDs from the plan, restores iteration/skipped state, and only then fetches new issues.
   - Tracker updates use `update()`: read current state, increment `revision`, write a temporary file, then atomically rename it into place.
   - `LoopRun` is the authoritative writer. Its lifecycle methods persist first and emit facts second. Subscribers are invoked synchronously in registration order only after the durable write succeeds.
   - Evidence: `src/core/utils/loop-run-tracker.ts:122-164,344-365`; `src/core/loop-run/loop-run.ts:4-7,46-50,96-151,276-310,607-610`; `src/core/ralph-loop.ts:344-386`.

6. **Why partial Force-Kill Undo is special**
   - Force-Kill Undo may have killed writers but not completed repository restoration. Treating that state as an ordinary stale run could resume against an ambiguous or partially restored workspace.
   - `Finish Rollback` requires fresh confirmation, `panicUndo.phase === "processes-drained"`, a recorded snapshot, and successful snapshot restoration. A stale PID alone is insufficient proof that active writers were drained.
   - Failed finish rollback records `rollback-failed` and keeps the active tracker for another explicit attempt. Successful rollback records `rollback-completed`, archives the run as interrupted with terminal reason `panic-undo`, and retains forensic panic state.
   - Evidence: `src/core/utils/stale-run-recovery.ts:132-148,224-262`; `src/core/loop-run/loop-run.ts:195-258`; `docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:52-57`.

7. **Dirty merge safety check**
   - During merge recovery, any remaining `git.isDirty()` result blocks the reset to `preMergeHead`, because that reset could overwrite manual primary-workspace edits.
   - The recovery loop asks the developer to clean the workspace and retry or abandon. An in-progress merge is aborted before this check, so merge-conflict dirt is not treated as manual work.
   - Evidence: `src/core/utils/stale-run-recovery.ts:469-501`; `docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:35-40`.

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| Stale detection uses owner PID and heartbeat | `LoopRunTracker.isStale` | `src/core/utils/loop-run-tracker.ts:155-164` |
| Recovery is fail-closed in non-TTY startup | `handleStaleRun` | `src/core/utils/stale-run-recovery.ts:404-418` |
| Crash normalization precedes action selection | `handleStaleRun` | `src/core/utils/stale-run-recovery.ts:428-431` |
| Submitted steering becomes unknown-after-crash | `normalizeSteeringPostCrash` | `src/core/loop-run/state.ts:112-123` |
| Partial panic undo suppresses resume | `StaleRun.getAvailableActions` | `src/core/utils/stale-run-recovery.ts:132-148` |
| Finish rollback requires drained processes and snapshot | `StaleRun.canFinishRollback` | `src/core/utils/stale-run-recovery.ts:128-138` |
| Mark-done-pending is reconciled through the issue source | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:48-63` |
| Replay and scheduler state come from persisted tasks/scheduler | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:65-77` |
| Resume adopts existing tracker ownership | `adoptOwnership` | `src/core/utils/loop-run-tracker.ts:150-164` |
| Existing snapshot is adopted instead of recaptured | `LoopRun.startOrResume` | `src/core/loop-run/loop-run.ts:117-151` |
| Tracker revisions are monotonic and writes atomic | `LoopRunTracker.update`, `atomicWrite` | `src/core/utils/loop-run-tracker.ts:122-137,344-365` |
| Subscribers observe only after writes, in registration order | `LoopRun.subscribe`, `emit` | `src/core/loop-run/loop-run.ts:76-102,607-610` |
| Dirty primary workspace blocks merge reset | `prepareMergingResume` | `src/core/utils/stale-run-recovery.ts:478-501` |

## 4. Tests and documentation

- Recovery action availability, partial panic-undo restrictions, ownership adoption, merge recovery, dirty-worktree blocking, and crash normalization: `test/stale-run-recovery.test.ts:451-730,1272-1335,1573-1760`.
- `mark-done-pending` handling and persisted task-body propagation: `test/resume-plan.test.ts:1-91`.
- Atomic revision updates and stale heartbeat detection: `test/loop-run-tracker.test.ts:436-545`.
- Architecture and policy: `docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:19-57`; sole-writer/event ordering: `docs/adr/0007-loop-run-coordinator-and-fact-events.md:16-19,32-35`.

## 5. Uncertainties

- The ordinary resume path clearly hands ownership to `LoopRun` before scheduler replay. The startup `finishRollback` branch still performs its rollback tracker writes directly in `StaleRun.execute`; ADR-0007 states that partial-undo lifecycle advancement should first be adopted into a `LoopRun`. This appears to be an implementation/architecture mismatch worth validating separately.


---

# Answer A08

## 1. Executive summary

Add `executionCount: number` to `UsageTotals`. Count each ledger entry in run, issue, and phase buckets; entries with `null` usage still count. Streaming usage must leave the count unchanged.

Required production changes:

- `src/core/loop-run/state.ts:244-254` — extend `UsageTotals`.
- `src/core/loop-run/usage.ts:27-58` — initialize and increment counts for ledger entries.
- `src/core/loop-run/ink-worker-projection.ts:29-78` — mirror the field for UI projections; do not increment it for streaming usage.
- `src/core/loop-run/ink-view.ts:87-103, 351-362` — optionally render average cost as `costUsd / executionCount`.
- Tests in `test/usage.test.ts` and `test/ink-state.test.ts` require updates/additions.

## 2. Detailed flow / architecture / impact analysis

- `UsageLedgerEntry` represents one completed execution and includes execution metadata, issue, phase, and usage values (`state.ts:233-242`).
- `UsageSummary` contains run, per-issue, and per-phase `UsageTotals` buckets (`state.ts:256-260`).
- `buildUsageSummary` recomputes all buckets from the complete ledger (`usage.ts:60-95`). Increment `executionCount` once in `accumulateInto`; the existing calls automatically apply it to run, issue, and phase totals.
- `LoopRun.recordUsage` appends exactly one ledger entry and rebuilds the persisted summary (`loop-run.ts:506-536`).
- `zeroUsageTotals` supplies UI totals (`ink-worker-projection.ts:29-40`).
- `accumulateUsage` processes committed ledger entries (`ink-worker-projection.ts:52-64`) and must increment `executionCount`.
- `accumulateStreamingUsage` processes ephemeral in-progress values (`ink-worker-projection.ts:66-78`) and must preserve the existing count.
- Streaming events are explicitly non-persistent and do not create ledger entries (`events.ts:39-48`; `loop-run.ts:542-545`).
- `displayRunUsage` starts from zero and aggregates only streaming values (`ink-worker-projection.ts:253-264`), so its count should remain zero.
- The TUI currently displays total cost for run and selected-worker views (`ink-view.ts:87-103, 351-362`). If the request includes visible average cost, add an average formatter/render line there, guarding against zero executions and unknown cost.

## 3. Evidence table

| Claim | Symbol | File:line |
|---|---|---|
| Ledger entries represent executions | `UsageLedgerEntry` | `src/core/loop-run/state.ts:233-242` |
| `UsageTotals` currently lacks the count | `UsageTotals` | `src/core/loop-run/state.ts:244-254` |
| Summary has run, issue, and phase buckets | `UsageSummary` | `src/core/loop-run/state.ts:256-260` |
| Summary is recomputed from the full ledger | `buildUsageSummary` | `src/core/loop-run/usage.ts:60-95` |
| Run totals accumulate every ledger entry | `accumulateInto` | `src/core/loop-run/usage.ts:41-58, 80-92` |
| Persisted usage appends one ledger entry | `recordUsage` | `src/core/loop-run/loop-run.ts:506-536` |
| UI committed totals use ledger entries | `accumulateUsage` | `src/core/loop-run/ink-worker-projection.ts:52-64` |
| Streaming totals are separate and ephemeral | `accumulateStreamingUsage` | `src/core/loop-run/ink-worker-projection.ts:66-78` |
| Streaming does not create ledger entries | `StreamingUsageEvent` | `src/core/loop-run/events.ts:39-48` |
| Run streaming display starts independently | `displayRunUsage` | `src/core/loop-run/ink-worker-projection.ts:253-264` |
| Run cost is rendered in the TUI | `renderRunUsageLines` | `src/core/loop-run/ink-view.ts:87-103` |
| Worker cost is rendered in the TUI | selected-worker details rendering | `src/core/loop-run/ink-view.ts:351-362` |

## 4. Tests and documentation

Existing tests that will break or need updates:

- `test/usage.test.ts:23-38` — exact empty `UsageTotals` object must include `executionCount: 0`.
- `test/usage.test.ts:40-50` — assert execution count.
- `test/usage.test.ts:78-100` — assert per-issue and per-phase counts.
- `test/ink-state.test.ts:171-198` — assert committed worker count.
- `test/ink-state.test.ts:232-337` — add count assertions around streaming and final recording.

New cases:

1. Empty summary has zero counts in every bucket.
2. Multiple ledger entries count once in run, issue, and phase buckets.
3. Entries with unknown/null cost still increment counts.
4. Entries without `issueId` increment run and phase only.
5. Streaming updates do not change committed run or worker counts.
6. After `usageRecorded`, count increments exactly once and streaming data is cleared.
7. Average cost is zero/undefined-safe when count is zero and unknown when cost is unknown.

The source documentation already identifies the ledger as the source of truth (`usage.ts:2-6`) and explicitly documents streaming as non-ledger-backed (`events.ts:39-48`).

## 5. Uncertainties

- The repository has no existing average-cost formatter or dedicated TUI rendering test; whether `ink-view.ts` must change depends on whether “UI can display” means exposing the field only or immediately rendering it.
- `UsageTotals` impact is broader than the indexed direct references because it is structurally constructed in projection helpers; all constructors returning `UsageTotals` must include the new field.


---

# Answer A09

## 1. Executive summary

On startup, `ralphLoop` calls `handleStaleRun`. It rejects a live tracker, aborts non-interactive recovery without injected prompts, normalizes crash-sensitive state, computes valid recovery choices, and executes the selected action.【src/core/ralph-loop.ts:310-319】【src/core/utils/stale-run-recovery.ts:392-440】

For resume, the stale process is cleaned up, the new process adopts tracker ownership, reconstructs scheduler state with `buildResumePlan`, and continues using the existing tracker. Tracker mutations are durable, revision-monotonic, and emitted only after successful writes.【src/core/utils/stale-run-recovery.ts:287-303】【src/core/loop-run/resume-plan.ts:35-79】【src/core/utils/loop-run-tracker.ts:132-159】

## 2. Detailed flow / architecture / impact analysis

1. **Detection and action selection**
   - No tracker: proceed.
   - Tracker whose owner is alive and heartbeat is current: abort; another loop is active.
   - Stale tracker in default non-TTY mode: abort rather than select a default action.
   - Otherwise, `normalizeCrashRules()` runs before choices are offered.【src/core/utils/stale-run-recovery.ts:398-428】

   For an ordinary stale run:
   - `resume` is always offered.
   - `abandon` archives the stale run and starts fresh.
   - `cancel` aborts recovery.
   - `rollback` is offered only when `rollbackSnapshotId` exists.【src/core/utils/stale-run-recovery.ts:141-155】【src/core/utils/stale-run-recovery.ts:180-218】

   A partial panic undo is different:
   - It is identified when `panicUndo` exists and its phase is not `rollback-completed`.
   - Only `abandon` and `cancel` are normally offered.
   - `finishRollback` is additionally offered only when the phase is `processes-drained` and a rollback snapshot exists.【src/core/utils/stale-run-recovery.ts:128-155】

2. **Crash-rule normalization**
   - `normalizeCrashRules()` checks whether any task contains a live-steering record with status `submitted`.
   - If so, it calls `normalizeLiveSteeringPostCrash()`, which converts every `submitted` record to `unknown-after-crash`, then reloads tracker state.
   - If no such record exists, it does nothing.【src/core/utils/stale-run-recovery.ts:157-166】【src/core/utils/loop-run-tracker.ts:356-369】【src/core/loop-run/state.ts:112-123】

3. **Resume preparation**
   - `implementing` tasks have their worktrees cleaned.
   - `merge-pending`/`merging` tasks abort any in-progress merge, require a clean primary workspace, reset to `preMergeHead`, and clean the task worktree.
   - Interrupted verification and completion marking are retried.
   - Done tasks whose `integratedHead` is unreachable from `HEAD` require developer input or fail in non-interactive mode.【src/core/utils/stale-run-recovery.ts:312-377】【src/core/utils/stale-run-recovery.ts:468-502】

4. **Rebuilding live scheduler state**
   - `buildResumePlan()` reads the persisted task table.
   - Done tasks become terminal IDs; failed tasks are not treated as non-retryable terminals.
   - `mark-done-pending` tasks are checked with `isDone`; if necessary, `markDone` is called, then the tracker phase is durably changed to `done`.
   - The task table is reread after those writes.
   - Remaining nonterminal tasks become `replayQueue`; persisted iteration count and skipped IDs restore scheduler progress.【src/core/loop-run/resume-plan.ts:35-79】

5. **Sole authoritative ownership**
   - On successful resume preparation, `execute("resume")` calls `tracker.adoptOwnership()`, changing status to `running` and replacing the owner PID/heartbeat with the new process.【src/core/utils/stale-run-recovery.ts:287-303】【src/core/utils/loop-run-tracker.ts:150-159】
   - `ralphLoop` then constructs `LoopRun` with that tracker and calls `startOrResume`; an existing rollback snapshot is adopted, otherwise existing state is updated rather than creating a new run.【src/core/ralph-loop.ts:343-375】【src/core/loop-run/loop-run.ts:105-145】
   - The `LoopRun` contract explicitly makes it the sole writer while active; callers must not write directly to the tracker.【src/core/loop-run/loop-run.ts:44-52】
   - Tracker updates increment `revision` from the current value and atomically write before returning.【src/core/utils/loop-run-tracker.ts:126-140】
   - LoopRun events use write-then-emit ordering: for task phases, tracker writes complete before the event is emitted.【src/core/loop-run/loop-run.ts:275-300】
   - Subscribers are invoked synchronously, in registration order, after the durable write succeeds.【src/core/loop-run/loop-run.ts:75-101】

6. **Force-Kill Undo and Finish Rollback**
   - A partially completed Force-Kill Undo represents an interrupted destructive rollback, so it cannot be treated as an ordinary resumable stale run.
   - `finishRollback` requires explicit confirmation, an existing rollback snapshot, successful rollback, workspace cleanup, recording `rollback-completed`, and archiving the tracker as interrupted with reason `panic-undo`.【src/core/utils/stale-run-recovery.ts:224-285】

7. **Dirty-workspace safety check**
   - Merge recovery loops while `git.isDirty()` is true and requires the developer to commit, stash, or discard changes, or abandon.
   - In non-interactive mode it throws before resetting to `preMergeHead`, preventing primary-workspace edits from being overwritten.【src/core/utils/stale-run-recovery.ts:474-499】
   - This behavior is covered by the integration test for interrupted merge recovery with uncommitted primary-repository changes.【test/recovery-integration.test.ts:254-304】

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| Startup invokes stale recovery before creating the new LoopRun | `ralphLoop`, `handleStaleRun` | `src/core/ralph-loop.ts:310-319` |
| Active owner blocks startup | `handleStaleRun` | `src/core/utils/stale-run-recovery.ts:404-409` |
| Ordinary action availability depends on rollback snapshot | `getAvailableActions` | `src/core/utils/stale-run-recovery.ts:141-155` |
| Partial panic undo excludes ordinary resume/rollback | `isPartialPanicUndo`, `getAvailableActions` | `src/core/utils/stale-run-recovery.ts:128-155` |
| Crash normalization converts submitted steering records | `normalizeCrashRules`, `normalizeSteeringPostCrash` | `src/core/utils/stale-run-recovery.ts:157-166`; `src/core/loop-run/state.ts:112-123` |
| Mark-done-pending tasks are completed during planning | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:47-63` |
| Scheduler queue/progress are reconstructed from persisted state | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:65-79` |
| New process adopts tracker ownership | `execute`, `adoptOwnership` | `src/core/utils/stale-run-recovery.ts:287-303`; `src/core/utils/loop-run-tracker.ts:150-159` |
| Revisions are monotonic and writes are atomic | `update` | `src/core/utils/loop-run-tracker.ts:132-140` |
| Events follow durable writes and subscriber order | `recordTaskPhase`, `subscribe` | `src/core/loop-run/loop-run.ts:75-101`, `275-300` |
| Dirty merge recovery is blocked | `prepareMergingResume` | `src/core/utils/stale-run-recovery.ts:474-499` |

## 4. Tests and documentation

- `resume-plan.ts` documents the persisted-task-to-scheduler translation and references ADR-0006.【src/core/loop-run/resume-plan.ts:1-21】
- Integration coverage verifies dirty primary-workspace protection during merge recovery.【test/recovery-integration.test.ts:254-304】
- The same test suite covers clean interrupted-merge recovery and reset-to-`preMergeHead`.【test/recovery-integration.test.ts:310-330】

## 5. Uncertainties

- The exact presentation-layer wording for the recovery menu is abstracted behind `RecoveryPrompts`; the lifecycle and availability rules are directly visible in `StaleRun` and `handleStaleRun`.
- “Sole authoritative writer” is both an explicit `LoopRun` contract and the observed ownership flow; external callers could violate it only by disregarding that contract.


---

# Answer A10

## 1. Executive summary

The implemented pipeline is:

1. `runVerification()` parses verifier stdout into overall and per-criterion verdicts.
2. `TaskPipeline.executeTask()` passes parsed criteria to `LoopRun.recordCriterionVerdicts()`.
3. `recordCriterionVerdicts()` stabilizes IDs, writes stdout evidence artifacts, and atomically updates the Loop Run Tracker.
4. Verification phase transitions emit `taskPhaseChanged` events after tracker persistence.
5. The Ink worker projection consumes those phase events.

However, the per-criterion verdict itself is **not emitted as a fact event** and is **not represented in the Live Dashboard worker projection**. Only the surrounding task phase changes are emitted/projected.

## 2. Detailed flow / architecture / impact analysis

### 1. Raw stdout → parsed verdicts

`runVerification()` receives the verifier execution output as `raw`. It rejects unsuccessful execution as `outcome.kind: "errored"` and `passed: false` [src/core/actions/verifier.ts:261-278].

For successful execution, `parseCriterionVerdicts(raw)` scans `<criterion ...>...</criterion>` blocks [src/core/actions/verifier.ts:281-283]. Each block:

- Preserves an explicit `id`.
- Generates `criterion-N` when the ID is absent.
- Assigns an ordinal.
- Normalizes invalid statuses to `"unmet"`.
- Extracts embedded fenced stdout [src/core/actions/verifier.ts:114-134].

The overall verdict requires an explicit `<verdict>` tag. Missing tags produce `outcome.kind: "inconclusive"` and `passed: false` [src/core/actions/verifier.ts:283-301]. Only an explicit `PASS` sets `passed: true` [src/core/actions/verifier.ts:304-321].

### 2. Pipeline → Loop Run Tracker

`TaskPipeline.executeTask()` invokes `runVerification()`, stores `v.criteria`, and calls `loopRun.recordCriterionVerdicts(issue.id, v.criteria)` [src/core/utils/task-pipeline.ts:342-373].

`recordCriterionVerdicts()`:

- Requires an active Loop Run.
- Reads the current tracker state.
- Resolves stable criterion identities.
- Writes verifier stdout as a run-scoped artifact.
- Stores only the artifact reference inline.
- Updates the task’s `criteria` and `criterionIdentities` fields [src/core/loop-run/loop-run.ts:322-369].

Identity stability is provided by `resolveCriterionIdentity()`:

- Explicit IDs are preserved and replace the identity at that ordinal.
- Missing IDs reuse the previously frozen identity for that ordinal.
- Otherwise, `criterion-N` is generated and frozen [src/core/loop-run/loop-run.ts:619-637].

Evidence stdout is content-addressed using a truncated SHA-256 filename and written through a temporary file followed by rename [src/core/loop-run/loop-run.ts:639-670].

### 3. Durability and ADR-0007 discipline

Tracker updates use `LoopRunTracker.update()`, which reads the current snapshot, increments its revision, and calls `atomicWrite()` [src/core/utils/loop-run-tracker.ts:132-141].

`atomicWrite()` writes JSON to `.tmp`, then renames it into the active tracker path; Windows rename collisions are handled explicitly [src/core/utils/loop-run-tracker.ts:371-385].

For task phases, ADR-0007’s write-then-emit rule is explicit: `recordTaskPhase()` performs tracker writes first and calls `emit()` only afterward. If persistence throws, no fact event is emitted [src/core/loop-run/loop-run.ts:275-300].

The criterion-specific method does persist first, but it does **not** call `emit()` afterward [src/core/loop-run/loop-run.ts:358-369].

### 4. Fact event boundary

Before verification, the pipeline records `"verify-pending"` and `"verifying"` phases [src/core/utils/task-pipeline.ts:342-345].

Those phase writes emit `taskPhaseChanged` events after persistence [src/core/loop-run/loop-run.ts:282-299]. `LoopRunEvent` contains task phase, metadata, usage, steering, and lifecycle events, but no criterion-verdict event type [src/core/loop-run/events.ts:122-141].

Therefore, the criterion verdict is durably persisted but is **not emitted as its own fact event**.

### 5. Live Dashboard projection

The Ink reducer handles `taskPhaseChanged` by calling `applyTaskPhaseToWorkerProjection()` [src/core/loop-run/ink-state.ts:161-177].

That projection stores worker issue ID, phase, phase records, timestamps, metadata, and usage; `WorkerDashboardRow` has no criterion-verdict field [src/core/loop-run/ink-worker-projection.ts:9-20].

Consequently, the dashboard reflects `"verifying"` or `"failed"`/other task phases, not individual criterion statuses.

### 6. Protection against false completion

The pipeline marks a task verified only when `v.passed` is true [src/core/utils/task-pipeline.ts:383-387]. Protection includes:

- Missing overall verdict tag → `passed: false` [src/core/actions/verifier.ts:283-301].
- Invalid criterion status → `"unmet"` rather than silently dropping the criterion [src/core/actions/verifier.ts:83-87].
- Failed verifier execution → `"errored"` and `passed: false`; a second attempt is made [src/core/actions/verifier.ts:261-278; src/core/utils/task-pipeline.ts:375-381].
- Two verifier failures cause a fail-closed break [src/core/utils/task-pipeline.ts:379-381].
- Failed or incomplete implementation output does not enter successful verification [src/core/utils/task-pipeline.ts:302-327].
- A non-verified task is recorded as `"failed"` unless manually skipped/interrupted [src/core/utils/task-pipeline.ts:409-411].

## 3. Evidence table

| Claim | Symbol | File:line |
|---|---|---|
| Per-criterion blocks are parsed from raw verifier output | `parseCriterionVerdicts` | `src/core/actions/verifier.ts:114-134` |
| Invalid criterion statuses become `unmet` | `normalizeCriterionStatus` | `src/core/actions/verifier.ts:83-87` |
| Missing overall verdict is inconclusive and not passed | `runVerification` | `src/core/actions/verifier.ts:283-301` |
| Pipeline records parsed criteria | `executeTask` | `src/core/utils/task-pipeline.ts:371-374` |
| Stable IDs are frozen by ordinal | `resolveCriterionIdentity` | `src/core/loop-run/loop-run.ts:619-637` |
| Criteria and evidence references are persisted | `recordCriterionVerdicts` | `src/core/loop-run/loop-run.ts:322-369` |
| Tracker writes are atomic | `atomicWrite` | `src/core/utils/loop-run-tracker.ts:371-385` |
| Phase events obey write-then-emit | `recordTaskPhase` | `src/core/loop-run/loop-run.ts:275-300` |
| No criterion event exists in the Loop Run event union | `LoopRunEvent` | `src/core/loop-run/events.ts:122-141` |
| Dashboard projects task phases, not criteria | `applyLoopRunEventToInkState` | `src/core/loop-run/ink-state.ts:161-177` |
| Worker rows contain no criterion verdicts | `WorkerDashboardRow` | `src/core/loop-run/ink-worker-projection.ts:9-20` |
| Double verifier failure fails closed | `executeTask` | `src/core/utils/task-pipeline.ts:375-381` |

## 4. Tests and documentation

Tests directly cover:

- PASS and FAIL parsing [test/verifier.test.ts:37-76].
- Per-criterion parsing and ordering [test/verifier.test.ts:97-119].
- Malformed criterion status defaulting to `unmet` [test/verifier.test.ts:121-139].

The implementation comments document write-then-emit behavior for phase events [src/core/loop-run/loop-run.ts:275-280] and stable criterion identity behavior [src/core/loop-run/loop-run.ts:313-320].

No cited test or event definition demonstrates a criterion-specific fact event or criterion data in the dashboard projection.

## 5. Uncertainties

- The repository may have an external log/artifact consumer not represented in `LoopRunEvent`; the inspected Loop Run event union and Ink projection do not expose criterion verdict events.
- The verifier result interface comment says execution errors “fail open,” but the current implementation returns `passed: false` for execution errors and the task pipeline retries then fails closed [src/core/actions/verifier.ts:64-75; src/core/utils/task-pipeline.ts:375-381].


---

# Answer A11

## 1. Executive summary

On startup, `ralphLoop` calls stale-run handling before creating/resuming `LoopRun` (`src/core/ralph-loop.ts:310-329`). A tracker is stale when its owner is dead or its heartbeat exceeds 30 seconds (`src/core/utils/loop-run-tracker.ts:161-178`).

Recovery then:

1. Rejects active runs and non-interactive stale runs without an injected decision provider (`src/core/utils/stale-run-recovery.ts:404-420`).
2. Normalizes crash-affected steering records.
3. Offers only actions valid for the persisted state.
4. For resume, prepares task/workspace state, adopts tracker ownership, constructs the runtime `LoopRun`, and rebuilds scheduler state.
5. `LoopRun` becomes the sole authoritative writer: durable tracker writes precede emitted events.

## 2. Detailed flow / architecture / impact analysis

### Recovery action selection

`StaleRun.getAvailableActions()` provides:

- **Partial Force-Kill Undo:** `abandon` and `cancel`; `finishRollback` is added only when panic undo is at `processes-drained` and a rollback snapshot exists (`src/core/utils/stale-run-recovery.ts:128-155`).
- **Ordinary stale run:** always `resume`, `abandon`, and `cancel`; `rollback` is available only when `rollbackSnapshotId` exists (`src/core/utils/stale-run-recovery.ts:141-155`).
- **Cancel:** aborts startup without changing the tracker (`src/core/utils/stale-run-recovery.ts:180-183`).
- **Abandon:** archives the stale tracker as completed and starts a new run (`src/core/utils/stale-run-recovery.ts:184-187`).
- **Rollback:** adopts the persisted snapshot, rolls it back, archives the tracker, cleans workspaces, and starts fresh; it is rejected if no snapshot exists or rollback fails (`src/core/utils/stale-run-recovery.ts:189-221`).
- **Finish Rollback:** requires confirmation, a snapshot, successful rollback, cleanup, then archives the run as interrupted with `panic-undo` as the terminal reason (`src/core/utils/stale-run-recovery.ts:224-284`).

The choice is prompted only after `normalizeCrashRules()`, and an invalid choice is rejected (`src/core/utils/stale-run-recovery.ts:423-440`).

### Crash-rule normalization

`normalizeCrashRules()` checks whether any task contains a submitted live-steering record. If so, it calls `tracker.normalizeLiveSteeringPostCrash()` and refreshes in-memory state (`src/core/utils/stale-run-recovery.ts:157-166`).

The underlying rule converts `submitted` records to `unknown-after-crash`, leaving terminal records unchanged (`src/core/loop-run/state.ts:112-123`).

### Resume preparation and scheduler reconstruction

Before ownership adoption, resume preparation handles each persisted task:

- `implementing`: removes its old worktree.
- `merge-pending` / `merging`: aborts an in-progress merge, requires a clean primary workspace, resets to `preMergeHead`, and removes the worktree.
- Verification phases are rerun.
- `mark-done-pending` completion marking is retried.
- Done tasks whose integrated commit is unreachable require restart/trust input (`src/core/utils/stale-run-recovery.ts:307-377`).

The primary-workspace safety check is explicit: dirty changes block merge recovery because reset could overwrite developer edits. Interactive mode permits retry or abandon; non-interactive mode throws (`src/core/utils/stale-run-recovery.ts:468-502`).

`buildResumePlan()` reads the durable task table, places done tasks in `terminalIds`, processes `mark-done-pending` tasks by checking `isDone`, calling `markDone` when necessary, and durably recording `done` (`src/core/loop-run/resume-plan.ts:35-63`). It then rereads the tracker and produces:

- `replayQueue` for non-terminal tasks;
- `terminalIds` for completed tasks;
- persisted iteration count;
- persisted skipped-ID set (`src/core/loop-run/resume-plan.ts:65-79`).

`ralphLoop` invokes this plan after `LoopRun.startOrResume()` (`src/core/ralph-loop.ts:343-387`).

### Tracker ownership and event ordering

After successful resume preparation, `StaleRun.execute("resume")` calls `tracker.adoptOwnership()` (`src/core/utils/stale-run-recovery.ts:287-303`). Adoption changes status to `running`, records the new process PID, and refreshes the heartbeat (`src/core/utils/loop-run-tracker.ts:150-159`).

`LoopRun` is documented as the sole authoritative writer; the tracker provides atomic, crash-safe, monotonic-revision JSON persistence (`src/core/utils/loop-run-tracker.ts:2-10`). Every `update()` rereads the current state, increments `revision`, then atomically writes it (`src/core/utils/loop-run-tracker.ts:126-140`). The atomic write uses a temporary file followed by rename (`src/core/utils/loop-run-tracker.ts:371-385`).

For phase transitions, the tracker write completes before the event is emitted; failed writes emit no event (`src/core/loop-run/loop-run.ts:275-300`). Subscribers run synchronously in registration order after the durable write (`src/core/loop-run/loop-run.ts:75-101`), and event dispatch iterates that subscriber list in order (`src/core/loop-run/loop-run.ts:607-610`).

## 3. Evidence table

| Claim | Symbol | File:line |
|---|---|---|
| Startup performs stale recovery before run creation | `ralphLoop` | `src/core/ralph-loop.ts:310-329` |
| Staleness is based on owner liveness or heartbeat age | `isStale` | `src/core/utils/loop-run-tracker.ts:161-178` |
| Ordinary and panic-undo action availability | `getAvailableActions` | `src/core/utils/stale-run-recovery.ts:128-155` |
| Crash normalization is conditional on submitted steering | `normalizeCrashRules` | `src/core/utils/stale-run-recovery.ts:157-166` |
| Submitted steering becomes unknown after crash | `normalizeSteeringPostCrash` | `src/core/loop-run/state.ts:112-123` |
| Resume preparation handles task phases | `prepareResume` | `src/core/utils/stale-run-recovery.ts:307-377` |
| Dirty primary workspace blocks merge recovery | `prepareMergingResume` | `src/core/utils/stale-run-recovery.ts:468-502` |
| Mark-done-pending tasks are completed during planning | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:47-63` |
| Scheduler replay and progress are reconstructed | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:65-79` |
| New process adopts tracker ownership | `adoptOwnership` | `src/core/utils/loop-run-tracker.ts:150-159` |
| Revisions monotonically increase before atomic persistence | `update` | `src/core/utils/loop-run-tracker.ts:132-140` |
| Events follow successful writes | `recordTaskPhase` | `src/core/loop-run/loop-run.ts:275-300` |
| Subscribers preserve registration order | `subscribe`, `emit` | `src/core/loop-run/loop-run.ts:75-101, 607-610` |
| Partial panic undo is distinct from ordinary stale recovery | `isPartialPanicUndo`, `canFinishRollback` | `src/core/utils/stale-run-recovery.ts:128-139` |
| Finish Rollback requires confirmation and successful rollback | `execute` | `src/core/utils/stale-run-recovery.ts:224-284` |

## 4. Tests and documentation

The resume plan documents its scheduler translation and references ADR-0006 (`src/core/loop-run/resume-plan.ts:1-22`).

The integration suite explicitly tests that merge recovery is blocked by uncommitted primary-repository changes and configures the dirty condition (`test/recovery-integration.test.ts:254-281`).

## 5. Uncertainties

- The cited source establishes the tracker/write/event contract, but the complete test coverage for every recovery action was not inspected.
- “Sole authoritative writer” is directly documented for `LoopRun` and implemented through its tracker updates; the broader process-level guarantee depends on no other process continuing to write after stale ownership is detected.


---

# Answer A12

## 1. Executive summary

The pipeline currently parses verifier stdout and durably stores criterion verdicts, but it **does not emit a criterion-verdict fact event or project criteria into the Live Dashboard worker state**.

Malformed results do not mark tasks verified: missing overall verdicts produce `passed: false`; execution errors retry once and then fail closed. However, verification can be bypassed when disabled and the implementer emits `<promise>COMPLETE</promise>`.

## 2. Detailed flow / architecture / impact analysis

1. **Verifier execution and parsing**
   - `runVerification()` invokes `runAgentExecution()` and captures its stdout in `raw` (`src/core/actions/verifier.ts:234-240`).
   - `parseCriterionVerdicts()` extracts `<criterion>` blocks, normalizes statuses to `met`, `unmet`, or `regressed`, and assigns omitted IDs as `criterion-N` (`src/core/actions/verifier.ts:114-135`).
   - The overall `<verdict>PASS|FAIL</verdict>` is parsed separately (`src/core/actions/verifier.ts:281-305`).

2. **Pipeline handoff**
   - `TaskPipeline.executeTask()` calls `runVerification()`, then passes `v.criteria` to `loopRun.recordCriterionVerdicts()` (`src/core/utils/task-pipeline.ts:371-374`).
   - A verifier execution error is retried once; two errors terminate the task without verification (`src/core/utils/task-pipeline.ts:375-381`).

3. **Stable criterion identity and evidence**
   - `LoopRun.recordCriterionVerdicts()` preserves explicit IDs.
   - For omitted IDs, `resolveCriterionIdentity()` freezes the first-seen positional identity and reuses it on later attempts (`src/core/loop-run/loop-run.ts:619-637`).
   - Raw criterion stdout is stored as a run-scoped SHA-256-named artifact; only its relative reference is persisted inline (`src/core/loop-run/loop-run.ts:343-355`, `639-671`).

4. **Durable Loop Run Tracker persistence**
   - `recordCriterionVerdicts()` updates the task’s `criteria` and `criterionIdentities` through `tracker.update()` (`src/core/loop-run/loop-run.ts:358-369`).
   - `LoopRunTracker.update()` increments the revision and calls `atomicWrite()` (`src/core/utils/loop-run-tracker.ts:132-140`).
   - `atomicWrite()` writes a temporary JSON file and renames it into place, providing crash-safe replacement (`src/core/utils/loop-run-tracker.ts:371-385`).

5. **Fact-event boundary**
   - ADR-0007’s general discipline is implemented by Loop Run methods that write first and call `emit()` only afterward (`src/core/loop-run/loop-run.ts:276-310`).
   - **`recordCriterionVerdicts()` has no corresponding `emit()` call** (`src/core/loop-run/loop-run.ts:322-369`).
   - `LoopRunEvent` contains task-phase, metadata, usage, steering, and run events, but no criterion-verdict event (`src/core/loop-run/events.ts:122-139`).
   - Therefore, criterion verdicts are persisted but are not emitted as a criterion fact event.

6. **Live Dashboard worker projection**
   - `applyLoopRunEventToInkState()` projects task phases, metadata, usage, streaming usage, and run completion (`src/core/loop-run/ink-state.ts:161-200`).
   - `WorkerDashboardRow` contains phase, title, timestamps, and usage, but no criteria field (`src/core/loop-run/ink-worker-projection.ts:9-20`).
   - Thus the dashboard reflects transitions such as `verifying` and `failed`, but not the persisted per-criterion verdicts.

7. **Protection against false completion**
   - Missing overall verdict tags produce an `inconclusive` result with `passed: false` (`src/core/actions/verifier.ts:283-301`).
   - Invalid criterion statuses become `unmet`, rather than being accepted (`src/core/actions/verifier.ts:83-88`).
   - Failed verification sets task feedback and ultimately moves the task to `failed` (`src/core/utils/task-pipeline.ts:390-411`).
   - A verifier crash is retried once and then fails closed (`src/core/utils/task-pipeline.ts:375-381`).
   - Inference: these guards prevent malformed verifier output from silently completing a normally verified task, except when verification is explicitly disabled (`src/core/utils/task-pipeline.ts:329-332`).

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| Raw verifier stdout is captured | `runVerification` | `src/core/actions/verifier.ts:234-240` |
| Criterion blocks are parsed and default IDs generated | `parseCriterionVerdicts` | `src/core/actions/verifier.ts:114-135` |
| Invalid statuses normalize to `unmet` | `normalizeCriterionStatus` | `src/core/actions/verifier.ts:83-88` |
| Missing overall verdict is inconclusive and not passed | `runVerification` | `src/core/actions/verifier.ts:283-301` |
| Pipeline persists parsed criteria | `executeTask` | `src/core/utils/task-pipeline.ts:371-374` |
| Verifier errors retry once, then fail closed | `executeTask` | `src/core/utils/task-pipeline.ts:375-381` |
| Positional criterion identity is frozen | `resolveCriterionIdentity` | `src/core/loop-run/loop-run.ts:619-637` |
| Verdicts and evidence references are persisted | `recordCriterionVerdicts` | `src/core/loop-run/loop-run.ts:322-369` |
| Tracker writes are revisioned and atomic | `update`, `atomicWrite` | `src/core/utils/loop-run-tracker.ts:132-140, 371-385` |
| No criterion fact event exists | `LoopRunEvent` | `src/core/loop-run/events.ts:122-139` |
| Dashboard projects phases/usages only | `applyLoopRunEventToInkState` | `src/core/loop-run/ink-state.ts:161-200` |
| Worker rows have no criteria projection | `WorkerDashboardRow` | `src/core/loop-run/ink-worker-projection.ts:9-20` |

## 4. Tests and documentation

- Verifier parsing, malformed statuses, missing verdicts, and explicit IDs are tested in `test/verifier.test.ts:97-179`.
- ADR-0007 is explicitly referenced by the tracker and event architecture documentation (`src/core/utils/loop-run-tracker.ts:1-10`; `src/core/loop-run/events.ts:1-10`).
- No discovered test demonstrates a criterion-verdict event or dashboard-criteria projection.

## 5. Uncertainties

- The repository may expose persisted criteria through another dashboard path not represented in the worker projection inspected here; the inspected `LoopRunEvent` and `WorkerDashboardRow` APIs provide no such path.
- The verifier module’s comment describes execution errors as “fail open,” but the actual pipeline behavior retries and then fails closed (`src/core/actions/verifier.ts:64-75`; `src/core/utils/task-pipeline.ts:375-381`).


---

# Answer A13

## 1. Executive summary

The implemented pipeline is:

`runAgentExecution` → `runVerification` → `TaskPipeline.executeTask` → `LoopRun.recordCriterionVerdicts` → `LoopRunTracker.update` → atomic `active.json` write.

Criterion identities are stabilized by explicit IDs or frozen ordinal IDs (`criterion-N`). Verifier stdout evidence is stored as a content-addressed artifact, with only its path persisted inline.

However, the requested final two stages do **not currently exist for per-criterion verdicts**: `recordCriterionVerdicts` emits no fact event, and the event union/dashboard projection contains no criterion-verdict event or criterion state. Only task phase, metadata, usage, and streaming-usage events reach the Live Dashboard.

## 2. Detailed flow / architecture / impact analysis

1. **Raw verifier execution and parsing**  
   `runVerification` invokes `runAgentExecution`, captures `execResult.output`, parses `<criterion>` blocks, and extracts `<verdict>PASS|FAIL</verdict>` ([`src/core/actions/verifier.ts:234-239`](src/core/actions/verifier.ts#L234-L239), [`src/core/actions/verifier.ts:281-304`](src/core/actions/verifier.ts#L281-L304)).

2. **Criterion identity stability**  
   `parseCriterionVerdicts` preserves explicit IDs. Missing IDs initially become positional `criterion-N` IDs ([`src/core/actions/verifier.ts:114-134`](src/core/actions/verifier.ts#L114-L134)).  
   `LoopRun.resolveCriterionIdentity` freezes the first identity for each ordinal and reuses it on later attempts; explicit IDs replace the ordinal slot ([`src/core/loop-run/loop-run.ts:619-637`](src/core/loop-run/loop-run.ts#L619-L637)).

3. **Pipeline handoff**  
   `TaskPipeline.executeTask` receives `v.criteria` and calls `loopRun.recordCriterionVerdicts(issue.id, v.criteria)` ([`src/core/utils/task-pipeline.ts:371-374`](src/core/utils/task-pipeline.ts#L371-L374)). A retry after verifier execution failure records the retry’s criteria too ([`src/core/utils/task-pipeline.ts:375-383`](src/core/utils/task-pipeline.ts#L375-L383)).

4. **Evidence durability**  
   `recordCriterionVerdicts` normalizes status, writes stdout under `.ralph-loop/criterion-evidence/.../<sha256>.txt`, and stores only `evidenceRef` in the task record ([`src/core/loop-run/loop-run.ts:322-368`](src/core/loop-run/loop-run.ts#L322-L368), [`src/core/loop-run/loop-run.ts:639-672`](src/core/loop-run/loop-run.ts#L639-L672)).

5. **Tracker persistence and ADR-0007 discipline**  
   The criterion update calls `tracker.update`; `LoopRunTracker.update` reads the snapshot, increments revision, and calls `atomicWrite` ([`src/core/utils/loop-run-tracker.ts:132-141`](src/core/utils/loop-run-tracker.ts#L132-L141)). `atomicWrite` writes a temporary file and renames it into place ([`src/core/utils/loop-run-tracker.ts:371-385`](src/core/utils/loop-run-tracker.ts#L371-L385)).  
   ADR-0007’s write-then-emit design is documented and implemented for coordinator events: subscribers run only after durable writes ([`src/core/loop-run/loop-run.ts:4-10`](src/core/loop-run/loop-run.ts#L4-L10), [`src/core/loop-run/loop-run.ts:607-610`](src/core/loop-run/loop-run.ts#L607-L610)). **But `recordCriterionVerdicts` has no corresponding `emit` call** ([`src/core/loop-run/loop-run.ts:358-369`](src/core/loop-run/loop-run.ts#L358-L369)).

6. **Fact event and dashboard impact**  
   `LoopRunEvent` has no criterion-verdict event; it includes task phases, metadata, usage, streaming usage, and lifecycle events ([`src/core/loop-run/events.ts:122-141`](src/core/loop-run/events.ts#L122-L141)).  
   Ink applies those supported events, but has no criterion-verdict branch ([`src/core/loop-run/ink-state.ts:161-200`](src/core/loop-run/ink-state.ts#L161-L200)). Worker projection state likewise contains phase, metadata, and usage—not criteria ([`src/core/loop-run/ink-worker-projection.ts:9-27`](src/core/loop-run/ink-worker-projection.ts#L9-L27)).

7. **Protection against false completion**  
   Missing overall verdict produces `inconclusive` with `passed: false` ([`src/core/actions/verifier.ts:283-301`](src/core/actions/verifier.ts#L283-L301)). Execution errors are retried and, after two failures, the task fails closed ([`src/core/utils/task-pipeline.ts:375-381`](src/core/utils/task-pipeline.ts#L375-L381)). Failed or unverified tasks are recorded as `failed` ([`src/core/utils/task-pipeline.ts:409-418`](src/core/utils/task-pipeline.ts#L409-L418)).  
   Successful task integration requires `taskResult.success && taskResult.verified` ([`src/core/utils/task-pipeline.ts:501-502`](src/core/utils/task-pipeline.ts#L501-L502)).

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| Verifier captures agent stdout | `runVerification` | `src/core/actions/verifier.ts:234-239` |
| Criterion blocks are parsed and ordinalized | `parseCriterionVerdicts` | `src/core/actions/verifier.ts:114-134` |
| Explicit/missing IDs are stabilized | `resolveCriterionIdentity` | `src/core/loop-run/loop-run.ts:619-637` |
| Verdicts and evidence references are persisted | `recordCriterionVerdicts` | `src/core/loop-run/loop-run.ts:322-368` |
| Stdout artifacts are atomically created | `writeCriterionEvidenceArtifact` | `src/core/loop-run/loop-run.ts:639-672` |
| Tracker revisions and writes are durable | `update`, `atomicWrite` | `src/core/utils/loop-run-tracker.ts:132-141, 371-385` |
| Fact subscribers run after writes | `emit` | `src/core/loop-run/loop-run.ts:607-610` |
| No criterion fact event exists | `LoopRunEvent` | `src/core/loop-run/events.ts:122-141` |
| Dashboard projects phases/usage only | `WorkerProjectionState`, `applyLoopRunEventToInkState` | `src/core/loop-run/ink-worker-projection.ts:22-27`; `src/core/loop-run/ink-state.ts:161-200` |
| Missing verdict cannot pass | `runVerification` | `src/core/actions/verifier.ts:283-301` |
| Double verifier failure fails closed | `executeTask` | `src/core/utils/task-pipeline.ts:375-381` |

## 4. Tests and documentation

- Verifier tests cover PASS/FAIL parsing, criterion parsing, malformed statuses defaulting to `unmet`, missing overall verdicts, and explicit IDs ([`test/verifier.test.ts:37-179`](test/verifier.test.ts#L37-L179)).
- Durable tracker round-trip behavior is tested ([`test/loop-run-tracker.test.ts:762-818`](test/loop-run-tracker.test.ts#L762-L818)).
- Fact-event/log artifact durability is tested for supported events ([`test/run-log-artifact.test.ts:25-66`](test/run-log-artifact.test.ts#L25-L66)).
- ADR-0007 is referenced in the coordinator, event, and tracker module documentation ([`src/core/loop-run/loop-run.ts:4-10`](src/core/loop-run/loop-run.ts#L4-L10), [`src/core/loop-run/events.ts:2-10`](src/core/loop-run/events.ts#L2-L10), [`src/core/utils/loop-run-tracker.ts:2-10`](src/core/utils/loop-run-tracker.ts#L2-L10)).

## 5. Uncertainties

- The current code treats an overall `PASS` as sufficient even if an individual parsed criterion has status `unmet` or `regressed`; the criterion statuses are persisted but do not independently gate `verified` ([`src/core/actions/verifier.ts:304-321`](src/core/actions/verifier.ts#L304-L321)).
- The requested “criterion fact event” and “criterion reflected in the Live Dashboard” appear to be planned functionality rather than implemented functionality. Current evidence shows persistence only; no per-criterion event or dashboard projection exists.


---

# Answer A14

## 1. Executive summary

On startup, `handleStaleRun` reads the active tracker, rejects a live owner, rejects non-interactive recovery, normalizes crashed steering records, and offers only actions valid for the persisted state. Normal stale runs may resume, rollback if a snapshot exists, abandon, or cancel. Partial Force-Kill Undo runs cannot resume; they may only finish rollback when processes were drained and a snapshot exists, or abandon/cancel.

A resumed run cleans unsafe phase boundaries, adopts the existing tracker ownership, creates a `LoopRun`, adopts the rollback snapshot, builds scheduler state from the persisted task table, and continues writing the same tracker with increasing revisions. Durable writes precede synchronous subscriber events.

## 2. Detailed flow / architecture / impact analysis

1. **Detection and action selection**
   - `LoopRunTracker.isStale()` considers a tracker stale when its owner process is dead or its heartbeat is older than 30 seconds. Active ownership is otherwise rejected. `src/core/utils/loop-run-tracker.ts:150-177`
   - Startup performs stale recovery before feature-branch setup, snapshot creation, or `LoopRun.startOrResume`. `src/core/ralph-loop.ts:314-345`
   - Non-TTY startup fails rather than selecting an implicit recovery action. `src/core/utils/stale-run-recovery.ts:404-420`
   - For an ordinary stale run:
     - `resume` is available.
     - `rollback` is available only when `rollbackSnapshotId` exists.
     - `abandon` and `cancel` are always available.
     - `finishRollback` is not offered. `src/core/utils/stale-run-recovery.ts:131-153`
   - For a partial panic undo, resume and ordinary rollback are suppressed. `finishRollback` is offered only when `panicUndo.phase === "processes-drained"` and a rollback snapshot exists; otherwise only abandon/cancel remain. `src/core/utils/stale-run-recovery.ts:116-153`

2. **Crash normalization**
   - `normalizeCrashRules()` checks whether any task has a live-steering record still marked `submitted`. If so, it calls `tracker.normalizeLiveSteeringPostCrash()` and refreshes its state. `src/core/utils/stale-run-recovery.ts:157-168`
   - The normalization converts only `submitted` records to `unknown-after-crash`; terminal records remain unchanged. `src/core/loop-run/state.ts:107-124`
   - It is called after stale detection and before the recovery choices are presented. `src/core/utils/stale-run-recovery.ts:423-440`

3. **Resume preparation and scheduler reconstruction**
   - Unsafe writer phases are reset at their recovery boundaries:
     - interrupted implementation worktrees are cleaned;
     - interrupted merge is aborted, the primary workspace is checked for dirtiness, then reset to `preMergeHead`;
     - verification, completion marking, and review are rerun. `src/core/utils/stale-run-recovery.ts:303-386`
   - A completed task is trusted only if its `integratedHead` remains an ancestor of `HEAD`; otherwise recovery asks whether to restart or trust it. `src/core/utils/stale-run-recovery.ts:332-368`
   - `buildResumePlan`:
     - puts done tasks into `terminalIds`;
     - retries each `mark-done-pending` task, first consulting optional `isDone`;
     - calls `markDone` when needed, then records `done`;
     - rereads the tracker;
     - converts all nonterminal, non-`mark-done-pending` tasks into `replayQueue`;
     - restores `iterationsStarted` and `skippedIds`. `src/core/loop-run/resume-plan.ts:27-78`
   - The scheduler consumes replayed tasks before fetching new issues and resumes iteration accounting from the persisted values. `src/core/ralph-loop.ts:386-387`, `src/core/ralph-loop.ts:695-744`

4. **Tracker ownership and event ordering**
   - After successful resume preparation, startup calls `tracker.adoptOwnership()`, replacing the owner PID/heartbeat while preserving the same logical run and incrementing the revision. `src/core/utils/stale-run-recovery.ts:286-303`; `src/core/utils/loop-run-tracker.ts:136-158`
   - The new `LoopRun` then calls `startOrResume`; an existing snapshot is adopted rather than creating a new one. `src/core/ralph-loop.ts:350-386`; `src/core/loop-run/loop-run.ts:103-152`
   - Tracker updates atomically write a temporary file, rename it into place, and increment `revision` from the current state. `src/core/utils/loop-run-tracker.ts:132-140`, `src/core/utils/loop-run-tracker.ts:677-696`
   - `LoopRun` methods perform the durable tracker write first, then synchronously emit facts to subscribers in registration order. `src/core/loop-run/loop-run.ts:76-80`, `src/core/loop-run/loop-run.ts:276-310`, `src/core/loop-run/loop-run.ts:607-610`
   - Thus the resumed `LoopRun` becomes the sole authoritative writer; observers only consume already-durable facts. `src/core/loop-run/events.ts:1-9`

5. **Partial Force-Kill Undo**
   - A persisted `panicUndo` phase other than `rollback-completed` is classified as partial, so it is not treated as ordinary stale work. `src/core/utils/stale-run-recovery.ts:35-40`, `src/core/utils/stale-run-recovery.ts:116-126`
   - Finish Rollback requires explicit confirmation, a recorded snapshot, and the exact `processes-drained` phase. It adopts the snapshot, retries rollback, records `rollback-failed` on failure, or records `rollback-completed` and archives the run as interrupted on success. `src/core/utils/stale-run-recovery.ts:224-285`
   - The implementation currently performs these Finish Rollback tracker writes directly during startup. ADR-0007 states that this path should first adopt the stale run into `LoopRun` so panic-undo writes remain coordinator-owned. `docs/adr/0007-loop-run-coordinator-and-fact-events.md:33-36`

6. **Dirty merge safety check**
   - For `merge-pending`/`merging`, recovery aborts any merge, then repeatedly checks `git.isDirty()`. Dirty primary-workspace state blocks recovery because resetting to `preMergeHead` could overwrite manual edits. `src/core/utils/stale-run-recovery.ts:466-495`
   - Interactive recovery offers retry after manual cleanup or abandon; non-interactive recovery throws. `src/core/utils/stale-run-recovery.ts:478-498`

## 3. Evidence table

| Claim | Symbol | File:line |
|---|---|---|
| Stale ownership uses PID and heartbeat | `LoopRunTracker.isStale` | `src/core/utils/loop-run-tracker.ts:150-177` |
| Recovery is before new run setup | `handleStaleRun` call | `src/core/ralph-loop.ts:314-345` |
| Available actions depend on panic-undo and snapshot state | `StaleRun.getAvailableActions` | `src/core/utils/stale-run-recovery.ts:116-153` |
| Submitted steering becomes unknown after crash | `normalizeSteeringPostCrash` | `src/core/loop-run/state.ts:107-124` |
| Normalization runs before prompting | `handleStaleRun` | `src/core/utils/stale-run-recovery.ts:423-440` |
| Mark-done-pending is retried and persisted as done | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:40-69` |
| Replay and scheduler progress are restored | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:68-78` |
| Resumed tasks precede newly fetched tasks | scheduler loop | `src/core/ralph-loop.ts:739-744` |
| Resume adopts existing owner | `StaleRun.execute` / `adoptOwnership` | `src/core/utils/stale-run-recovery.ts:286-303` |
| Revisions increase with atomic writes | `LoopRunTracker.update` / `atomicWrite` | `src/core/utils/loop-run-tracker.ts:132-140`, `677-696` |
| Writes precede ordered subscriber events | `LoopRun.recordTaskPhase` / `emit` | `src/core/loop-run/loop-run.ts:276-310`, `607-610` |
| Finish Rollback requires drained processes and snapshot | `canFinishRollback` | `src/core/utils/stale-run-recovery.ts:131-139` |
| Dirty merge recovery is blocked | `prepareMergingResume` | `src/core/utils/stale-run-recovery.ts:466-498` |

## 4. Tests and documentation

- Recovery action gating, partial panic-undo behavior, and Finish Rollback are covered by `test/stale-run-recovery.test.ts:1272-1372`.
- Dirty merge recovery is covered by `test/recovery-integration.test.ts:258-308`.
- Mark-done-pending behavior, `isDone`, and persisted task-body propagation are covered by `test/resume-plan.test.ts:16-105`.
- Atomic revision behavior is covered by `test/loop-run-tracker.test.ts:436-458`.
- Write-before-emit and subscriber ordering are covered by `test/loop-run.test.ts:42-88`.
- Design requirements are specified in ADR-0006, especially stale actions, safe/unsafe resume, dirty-merge protection, ownership, atomic revision, and completion recovery: `docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:27-47`.
- ADR-0007 defines sole-writer, write-then-emit semantics and the intended LoopRun ownership for partial panic undo: `docs/adr/0007-loop-run-coordinator-and-fact-events.md:16-36`.

## 5. Uncertainties

- The code and ADR disagree on Finish Rollback ownership: ADR-0007 requires adoption into `LoopRun` before panic-undo writes, while `stale-run-recovery.ts` directly calls tracker methods.
- `handleStaleRun` itself does not create the `LoopRun`; ownership becomes coordinator-owned only after `ralphLoop` constructs it and calls `startOrResume`.
- Rollback availability is based on a recorded snapshot ID; snapshot existence/health is validated later by workspace operations.


---

# Answer A15

## 1. Executive summary

The pipeline is:

`verifier stdout → runVerification() parses criteria → TaskPipeline records criteria → LoopRun.recordCriterionVerdicts() persists tracker state → [no criterion fact event] → [no criterion dashboard projection]`.

ADR-0007 write-then-emit is enforced for task phases and other coordinator events, but **not for criterion verdicts**: `recordCriterionVerdicts()` persists silently. Consequently, criterion statuses are durable but are not emitted to, or reflected in, the Live Dashboard worker projection.

Malformed or crashed verifier executions generally fail closed, but a malformed output containing only `<verdict>PASS</verdict>` can currently mark a task done because criterion completeness is not validated.

## 2. Detailed flow / architecture / impact analysis

1. **Raw stdout → parser**  
   `runVerification()` executes the verifier and parses stdout with `parseCriterionVerdicts()` (`src/core/actions/verifier.ts:234-281`). Criterion blocks are recognized by tagged `<criterion>` elements; missing/invalid statuses normalize to `unmet` (`src/core/actions/verifier.ts:83-88`, `114-135`). Missing overall `<verdict>` produces `inconclusive` and `passed: false` (`src/core/actions/verifier.ts:283-301`).

2. **Criterion identity stability**  
   Explicit IDs are preserved. Otherwise, the parser assigns an ordinal fallback such as `criterion-1` (`src/core/actions/verifier.ts:118-135`).  
   `LoopRun.recordCriterionVerdicts()` resolves identity through `resolveCriterionIdentity()`: existing ordinal identities are reused, while first-seen ordinals are persisted (`src/core/loop-run/loop-run.ts:322-355`, `619-637`). This avoids hashing mutable criterion prose, matching ADR-0011 (`docs/adr/0011-stateful-per-criterion-verification-loop.md:23-26`).

3. **Pipeline → Loop Run persistence boundary**  
   `TaskPipeline` calls `recordCriterionVerdicts()` after each verification attempt (`src/core/utils/task-pipeline.ts:371-379`). The coordinator stores normalized `{id, status, evidenceProse, evidenceRef}` records inline in the task snapshot (`src/core/loop-run/loop-run.ts:343-360`). Captured stdout is written once to a run-scoped artifact and referenced from the tracker (`src/core/loop-run/loop-run.ts:346-354`, `639-668`).

4. **ADR-0007 write-then-emit discipline**  
   For task phase changes, `recordTaskPhase()` writes through the tracker before emitting `taskPhaseChanged`; a failed write prevents emission (`src/core/loop-run/loop-run.ts:275-301`). `emit()` synchronously invokes subscribers in registration order (`src/core/loop-run/loop-run.ts:607-611`). Tracker writes are atomic temporary-file-plus-rename operations (`src/core/utils/loop-run-tracker.ts:389-408`).

   However, `recordCriterionVerdicts()` ends after `tracker.update()` and does **not** call `emit()` (`src/core/loop-run/loop-run.ts:322-360`). There is no `criterionVerdictRecorded` event in the event union (`src/core/loop-run/events.ts:24-76`).

5. **Fact event → Live Dashboard**  
   The dashboard receives Loop Run events through `ink-ui.ts:onEvent()` and `applyLoopRunEventToInkState()` (`src/core/loop-run/ink-ui.ts:206-214`). Worker projection updates exist for task phases, metadata, and usage (`src/core/loop-run/ink-state.ts:161-192`), with phase projection implemented by `applyTaskPhaseToWorkerProjection()` (`src/core/loop-run/ink-worker-projection.ts:154-176`).

   No criterion event case or criterion field exists in `WorkerDashboardRow` (`src/core/loop-run/ink-worker-projection.ts:8-35`). Therefore, persisted per-criterion verdicts do not appear in the Live Dashboard worker projection.

6. **Done-safety**  
   A task reaches `done` only when `taskResult.success && taskResult.verified` (`src/core/ralph-loop.ts:500-510`). Execution errors return `passed: false`; the pipeline retries once and then breaks without setting `verified` (`src/core/actions/verifier.ts:237-279`; `src/core/utils/task-pipeline.ts:375-387`). Failed or unverified tasks are marked failed/open rather than done (`src/core/ralph-loop.ts:511-529`).

   The safety gap is that `<verdict>PASS</verdict>` alone sets `passed: true`, even if no criterion blocks were parsed (`src/core/actions/verifier.ts:281-321`). Thus, malformed-but-PASS output can still reach `done`.

## 3. Evidence table

| Claim | Symbol | File:line |
|---|---|---|
| Verifier parses criterion blocks and assigns ordinal fallback IDs | `parseCriterionVerdicts` | `src/core/actions/verifier.ts:114-135` |
| Invalid criterion status becomes `unmet` | `normalizeCriterionStatus` | `src/core/actions/verifier.ts:83-88` |
| Missing overall verdict is inconclusive and not passed | `runVerification` | `src/core/actions/verifier.ts:283-301` |
| Pipeline records verdicts after verification | `TaskPipeline` verification loop | `src/core/utils/task-pipeline.ts:371-379` |
| Criterion identity is frozen by ordinal | `resolveCriterionIdentity` | `src/core/loop-run/loop-run.ts:619-637` |
| Verdicts are persisted inline with evidence references | `recordCriterionVerdicts` | `src/core/loop-run/loop-run.ts:322-360` |
| Tracker writes are atomic | `atomicWrite` | `src/core/utils/loop-run-tracker.ts:389-408` |
| Phase events obey write-then-emit | `recordTaskPhase` | `src/core/loop-run/loop-run.ts:275-301` |
| Criterion verdicts have no fact event | `LoopRunEvent` / `recordCriterionVerdicts` | `src/core/loop-run/events.ts:24-76`; `src/core/loop-run/loop-run.ts:322-360` |
| Dashboard projects phases, metadata, and usage only | `applyLoopRunEventToInkState` | `src/core/loop-run/ink-state.ts:161-192` |
| Done requires successful verification | `handleTaskCompletion` | `src/core/ralph-loop.ts:500-529` |

## 4. Tests and documentation

- ADR-0011 specifies stable IDs, fail-closed malformed criteria, durable inline persistence, and retry behavior (`docs/adr/0011-stateful-per-criterion-verification-loop.md:23-52`).
- Tests verify positional identity freezing and evidence persistence (`test/loop-run.test.ts:400-490`).
- Verifier tests cover malformed statuses, missing overall verdicts, and explicit IDs (`test/verifier.test.ts:97-180`).
- No evidence was found for a criterion-verdict fact-event test or Live Dashboard criterion projection test.

## 5. Uncertainties

- The intended architecture may expect a future criterion event/projection joint; current event and projection types show it is not implemented.
- ADR-0011 states that parse failure cannot manufacture `met`, but the current implementation permits an overall `PASS` with zero parsed criteria (`src/core/actions/verifier.ts:281-321`), which appears inconsistent with that safety requirement.


---

# Answer A16

## 1. Executive summary

Add `executionCount: number` to `UsageTotals`.

Required source changes:

- `src/core/loop-run/state.ts:244-254` — extend the interface.
- `src/core/loop-run/usage.ts:27-58` — initialize and increment counts only for ledger entries.
- `src/core/loop-run/ink-worker-projection.ts:29-78` — preserve counts for committed usage, but do not increment them for streaming usage.

Streaming usage is explicitly ephemeral and does not create ledger entries (`src/core/loop-run/loop-run.ts:542-549`), so it must leave `executionCount` unchanged.

## 2. Detailed flow / architecture / impact analysis

`UsageLedgerEntry` represents one completed execution and carries execution metadata such as `executionId`, phase, and issue (`src/core/loop-run/state.ts:233-242`). `UsageSummary` contains run, issue, and phase buckets (`src/core/loop-run/state.ts:256-260`).

`buildUsageSummary` recomputes all buckets from the ledger (`src/core/loop-run/usage.ts:60-67`):

- Initialize each bucket with `zeroTotals`.
- Increment `run` for every ledger entry (`src/core/loop-run/usage.ts:80-82`).
- Increment `byIssue` only when `issueId` exists (`src/core/loop-run/usage.ts:83-89`).
- Increment `byPhase` for every entry (`src/core/loop-run/usage.ts:91`).

Therefore, `accumulateInto` should increment `target.executionCount` once per invocation (`src/core/loop-run/usage.ts:41-58`). This automatically gives correct run, issue, and phase counts.

`recordUsage` appends exactly one ledger entry and rebuilds the summary (`src/core/loop-run/loop-run.ts:506-534`). No change is needed there.

The dashboard projection has separate committed and streaming paths:

- `accumulateUsage` consumes ledger-backed entries (`src/core/loop-run/ink-worker-projection.ts:52-64`) and should increment `executionCount`.
- `accumulateStreamingUsage` consumes ephemeral cumulative updates (`src/core/loop-run/ink-worker-projection.ts:66-78`) and must not increment it.
- `displayRunUsage` combines committed totals with streaming values (`src/core/loop-run/ink-worker-projection.ts:253-263`), so the count remains the number of completed ledger-backed executions.

Do not modify `ControlledRunner.sumUsage`; it merges ephemeral `AgentExecutionUsage` values and is not a totals bucket (`src/core/runs/controlled-runner.ts:35-52`).

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| Usage totals currently have no execution count | `UsageTotals` | `src/core/loop-run/state.ts:244-254` |
| Summary has run, issue, and phase buckets | `UsageSummary` | `src/core/loop-run/state.ts:256-260` |
| Ledger entries represent executions | `UsageLedgerEntry` | `src/core/loop-run/state.ts:233-242` |
| Ledger aggregation initializes all buckets | `zeroTotals`, `buildUsageSummary` | `src/core/loop-run/usage.ts:27-38`, `67-78` |
| Every ledger entry contributes to run totals | `buildUsageSummary` | `src/core/loop-run/usage.ts:80-82` |
| Issue totals exclude entries without `issueId` | `buildUsageSummary` | `src/core/loop-run/usage.ts:83-89` |
| Phase totals receive every ledger entry | `buildUsageSummary` | `src/core/loop-run/usage.ts:91` |
| One usage record creates one ledger entry | `recordUsage` | `src/core/loop-run/loop-run.ts:506-534` |
| Streaming usage is not ledger-backed | `emitStreamingUsage` | `src/core/loop-run/loop-run.ts:542-549` |
| Committed projection usage is ledger-backed | `accumulateUsage` | `src/core/loop-run/ink-worker-projection.ts:52-64` |
| Streaming projection usage is separate | `accumulateStreamingUsage` | `src/core/loop-run/ink-worker-projection.ts:66-78` |
| Display combines committed and streaming values | `displayRunUsage` | `src/core/loop-run/ink-worker-projection.ts:253-263` |

## 4. Tests and documentation

Tests requiring updates:

- `test/usage.test.ts:23-38` — add `executionCount: 0` to zero-summary expectations.
- `test/usage.test.ts:40-50` — assert run count equals the number of ledger entries.
- `test/usage.test.ts:78-100` — assert per-issue and per-phase counts.
- `test/usage.test.ts:102-108` — verify entries without `issueId` do not create an issue bucket.
- `test/usage.test.ts:134-143` — include zero count for `live-steering`.

New tests:

- Multiple entries in one issue and phase produce count `2`.
- Entries across issues/phases produce independent counts.
- A ledger entry with all usage values `null` still increments count.
- Streaming updates leave `executionCount` unchanged.
- A streaming update followed by `usageRecorded` yields count `1`, not `2`.

Projection tests should be added near the existing streaming tests at `test/ink-state.test.ts:232-325`, especially alongside the existing “usageRecorded clears streamingUsage” case (`269-301`) and run-scoped streaming case (`303-315`).

The usage module references ADR-0009 (`src/core/loop-run/usage.ts:1-9`); update that ADR or related usage documentation if it specifies the `UsageTotals` schema.

## 5. Uncertainties

- The inspected UI tests show cost rendering but no direct average-cost rendering (`test/ink-state.test.ts:232-315`). The eventual UI formatter/card that displays average cost may require a separate change, but no direct consumer of `executionCount` was evidenced in the inspected references.
- Persisted snapshots should remain compatible if `usageSummary` is recomputed from `usageLedger`; verify migration behavior if older snapshots are read without the new field.


---

# Answer A17

## 1. Executive summary

Startup constructs the tracker and calls `handleStaleRun`. A tracker is stale when its owner process is dead or its heartbeat exceeds 30 seconds. Active runs abort startup; stale runs enter recovery. `handleStaleRun` normalizes crash state, computes legal actions, prompts, and executes the selected action.【src/core/utils/loop-run-tracker.ts:161-178】【src/core/utils/stale-run-recovery.ts:392-440】

For resume, the process repairs task/workspace state, adopts tracker ownership, initializes `LoopRun`, reconstructs scheduler state, and resumes execution. From that point, `LoopRun` is the authoritative writer: every durable update happens before its event is emitted.【src/core/utils/stale-run-recovery.ts:287-303】【src/core/loop-run/loop-run.ts:75-102】

## 2. Detailed flow / architecture / impact analysis

1. **Detection and action selection**
   - Missing tracker state proceeds normally.
   - A live tracker aborts startup to prevent two loop processes.
   - A stale tracker without a TTY aborts rather than selecting a default action.
   - Otherwise, crash rules are normalized, then actions are calculated and presented.【src/core/utils/stale-run-recovery.ts:398-440】
   - Ordinary stale runs offer `resume`, `abandon`, and `cancel`; `rollback` is added only when `rollbackSnapshotId` exists.【src/core/utils/stale-run-recovery.ts:141-155】
   - `cancel` aborts without changing the run; `abandon` archives the tracker and proceeds with a new run.【src/core/utils/stale-run-recovery.ts:180-187】
   - Invalid prompt choices are rejected.【src/core/utils/stale-run-recovery.ts:430-440】

2. **Crash-rule normalization**
   - `normalizeCrashRules` checks whether any task has submitted live-steering records.
   - If so, it calls `tracker.normalizeLiveSteeringPostCrash()` and rereads the resulting state.
   - It is called exactly after stale detection and before action availability is computed.【src/core/utils/stale-run-recovery.ts:157-166】【src/core/utils/stale-run-recovery.ts:423-431】
   - The tracker normalizes each task’s steering records through `normalizeSteeringPostCrash`, using a revisioned durable update.【src/core/utils/loop-run-tracker.ts:356-369】【src/core/utils/loop-run-tracker.ts:132-140】

3. **Resume preparation**
   - `resume` calls `prepareResume`, then `adoptOwnership`.
   - Implementing tasks have their worktrees cleaned.
   - Merge-pending/merging tasks abort any merge in progress, require a clean primary workspace, reset to `preMergeHead`, and clean the task worktree.
   - Verification and completion-marking interruptions are explicitly left for rerun/retry.
   - Done tasks whose `integratedHead` is unreachable require a restart/trust decision; restart persists the task as scheduled.【src/core/utils/stale-run-recovery.ts:287-303】【src/core/utils/stale-run-recovery.ts:307-377】

4. **Persisted task table → live scheduler**
   - `buildResumePlan` reads the initial snapshot.
   - `done` tasks become terminal IDs; failed tasks are not treated as non-retryable terminals.
   - `mark-done-pending` tasks call `isDone`; if necessary, `markDone` is called, then the tracker phase is written as `done`.
   - The tracker is reread after these writes.
   - Remaining nonterminal, non-`mark-done-pending` tasks become `replayQueue`; scheduler iterations and skipped IDs are restored from persisted scheduler state.【src/core/loop-run/resume-plan.ts:35-79】
   - `ralphLoop` consumes these four outputs immediately after `startOrResume`.【src/core/ralph-loop.ts:360-387】

5. **Sole authoritative ownership**
   - `adoptOwnership` revisionally updates the existing tracker to `status: "running"`, the new PID, and a fresh heartbeat.【src/core/utils/loop-run-tracker.ts:132-159】
   - `LoopRun.startOrResume` adopts the existing rollback snapshot and emits `snapshotAdopted`; it does not create a competing tracker when one already exists.【src/core/loop-run/loop-run.ts:104-152】
   - `LoopRun` owns the tracker and is documented as the sole authoritative writer.【src/core/loop-run/loop-run.ts:63-73】【src/core/utils/loop-run-tracker.ts:1-8】
   - Tracker updates increment revision monotonically and atomically write the new snapshot before returning.【src/core/utils/loop-run-tracker.ts:132-140】【src/core/utils/loop-run-tracker.ts:371-385】
   - Task transitions demonstrate write-then-emit: the tracker update completes first; only then is the event emitted. Subscribers run synchronously in registration order.【src/core/loop-run/loop-run.ts:75-102】【src/core/loop-run/loop-run.ts:275-300】
   - Thus, after `adoptOwnership` and `startOrResume`, the resumed `LoopRun` controls all subsequent tracker writes and event publication.

6. **Partially completed Force-Kill Undo**
   - A `panicUndo` state is partial whenever its phase is not `rollback-completed`; it is therefore not treated as an ordinary stale run.
   - Partial undo offers only `abandon` and `cancel`, plus `finishRollback` when the phase is exactly `processes-drained` and a rollback snapshot exists. Ordinary `resume` and `rollback` are excluded.【src/core/utils/stale-run-recovery.ts:128-155】
   - Finish Rollback requires explicit confirmation, a recorded snapshot, successful rollback, cleanup, recording `rollback-completed`, and archiving the run as interrupted with reason `panic-undo`.【src/core/utils/stale-run-recovery.ts:224-284】

7. **Merge safety check**
   - During merge recovery, `git.isDirty()` blocks resetting the primary workspace to `preMergeHead`.
   - The user must clean the workspace and retry, or abandon. Noninteractive recovery throws instead of proceeding.【src/core/utils/stale-run-recovery.ts:468-502】

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| Stale means dead owner or expired heartbeat | `isStale` | `src/core/utils/loop-run-tracker.ts:161-178` |
| Startup dispatches stale recovery | `handleStaleRun` | `src/core/utils/stale-run-recovery.ts:392-440` |
| Ordinary action availability | `getAvailableActions` | `src/core/utils/stale-run-recovery.ts:141-155` |
| Crash normalization | `normalizeCrashRules` | `src/core/utils/stale-run-recovery.ts:157-166` |
| Pending completion repair | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:35-79` |
| Resume workspace repair | `prepareResume` | `src/core/utils/stale-run-recovery.ts:307-377` |
| Merge dirty-tree guard | `prepareMergingResume` | `src/core/utils/stale-run-recovery.ts:468-502` |
| New process ownership | `adoptOwnership` | `src/core/utils/loop-run-tracker.ts:150-159` |
| Monotonic durable revision | `update` | `src/core/utils/loop-run-tracker.ts:132-140` |
| Write-before-event ordering | `recordTaskPhase` | `src/core/loop-run/loop-run.ts:275-300` |
| Subscriber ordering | `subscribe` documentation | `src/core/loop-run/loop-run.ts:75-102` |
| Partial Force-Kill Undo rules | `canFinishRollback`, `getAvailableActions` | `src/core/utils/stale-run-recovery.ts:128-155` |
| Finish Rollback requirements | `execute` / `finishRollback` | `src/core/utils/stale-run-recovery.ts:224-284` |

## 4. Tests and documentation

- ADR-0006 is explicitly referenced as the design authority for the Durable Loop Run Tracker and stale-run recovery.【src/core/loop-run/resume-plan.ts:21】
- Integration coverage includes the dirty-primary-workspace merge-recovery case.【test/recovery-integration.test.ts:258】
- The implementation comments document sole-writer ownership, atomic persistence, write-then-emit semantics, and recovery behavior.【src/core/utils/loop-run-tracker.ts:1-10】【src/core/loop-run/loop-run.ts:104-112】

## 5. Uncertainties

- The exact scheduler loop that consumes `replayQueue`, `terminalIds`, and restored counters is outside the inspected ranges; their construction and handoff are directly evidenced.
- The benchmark describes “startup” broadly; the concrete startup call path shown is `ralphLoop` invoking `handleStaleRun` before constructing and starting `LoopRun`.


---

# Answer A18

## 1. Executive summary

`UsageTotals` is defined in `src/core/loop-run/state.ts:244-254` and is produced by both durable summary code and the Ink UI projection.

Required behavior:

- Increment `executionCount` once per `UsageLedgerEntry`.
- Apply that increment independently to run, issue, and phase buckets.
- Do not increment it for ephemeral streaming usage.
- Preserve `executionCount` when adding streaming values to display-only totals, so in-progress usage remains count `0`.
- Update UI rendering to show total cost and average cost per execution.

## 2. Detailed flow / architecture / impact analysis

### Durable ledger and summary

`LoopRun.recordUsage()` creates one ledger entry per completed agent execution and recomputes the summary via `buildUsageSummary()` (`src/core/loop-run/loop-run.ts:506-533`). The ledger is therefore the authoritative count source.

Required edits:

- **`src/core/loop-run/state.ts:244-254`**
  - Add `executionCount: number` to `UsageTotals`.

- **`src/core/loop-run/usage.ts:27-63`**
  - Initialize `executionCount: 0` in `zeroTotals()`.
  - Increment `target.executionCount` once in `accumulateInto()`.
  - `buildUsageSummary()` already routes every entry into run, optional issue, and phase buckets (`:67-91`), so one increment in `accumulateInto()` correctly covers all three.

- **`src/core/utils/loop-run-tracker.ts:104-105`**
  - No algorithmic change is needed because initialization already delegates to `buildUsageSummary([])`.
  - Persisted snapshots will automatically include the new field after summary generation.

### Ink projection and streaming behavior

The UI has a separate projection path:

- `accumulateUsage()` adds committed ledger entries (`src/core/loop-run/ink-worker-projection.ts:52-64`).
- `accumulateStreamingUsage()` adds ephemeral usage (`:66-77`).
- `displayRunUsage()` aggregates only streaming usage (`:253-263`).

Required edits:

- **`src/core/loop-run/ink-worker-projection.ts:29-39`**
  - Initialize `executionCount: 0`.

- **`src/core/loop-run/ink-worker-projection.ts:52-64`**
  - Increment `executionCount` for each committed `UsageLedgerEntry`.
  - This affects `runUsage` and each worker’s committed `usage`.

- **`src/core/loop-run/ink-worker-projection.ts:66-77`**
  - Copy the existing `executionCount` unchanged.
  - Never increment it for `AgentExecutionUsage`.

- **`src/core/loop-run/ink-worker-projection.ts:253-263`**
  - `displayRunUsage()` should continue returning count `0` for streaming-only totals.
  - If streaming is combined with committed totals elsewhere, retain the committed count rather than counting the stream.

### UI display

- **`src/core/loop-run/ink-view.ts:87-105`**
  - Extend `renderRunUsageLines()` to show average cost per execution.
  - Use `costUsd / executionCount` when `executionCount > 0` and cost is known.
  - Render `unknown` when `hasUnknownCost` is true; render an explicit zero/not-applicable value when the count is zero.

- **`src/core/loop-run/ink-view.ts:350-362`**
  - Extend the selected-worker details to show average cost alongside total cost, using `selectedWorker.usage.executionCount`.

- **`src/core/loop-run/ink-state.ts:262-265`**
  - Consider adding a dedicated formatter for average cost to centralize zero-count and unknown-cost behavior. `formatUsageCost()` currently formats only total cost.

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| `UsageTotals` is the shared totals shape | `UsageTotals` | `src/core/loop-run/state.ts:244-254` |
| Summaries contain run, issue, and phase buckets | `UsageSummary` | `src/core/loop-run/state.ts:256-260` |
| Durable summaries start from zero totals | `zeroTotals` | `src/core/loop-run/usage.ts:27-39` |
| Each ledger entry is accumulated into totals | `accumulateInto` | `src/core/loop-run/usage.ts:41-63` |
| Run, issue, and phase buckets all use the accumulator | `buildUsageSummary` | `src/core/loop-run/usage.ts:67-91` |
| Ledger entries are appended after executions return | `recordUsage` | `src/core/loop-run/loop-run.ts:506-533` |
| Streaming usage is explicitly non-ledger and ephemeral | `emitStreamingUsage` | `src/core/loop-run/loop-run.ts:545-551` |
| Committed UI usage is accumulated separately | `accumulateUsage` | `src/core/loop-run/ink-worker-projection.ts:52-64` |
| Streaming UI usage is accumulated separately | `accumulateStreamingUsage` | `src/core/loop-run/ink-worker-projection.ts:66-77` |
| Display-only run usage reads streaming usage | `displayRunUsage` | `src/core/loop-run/ink-worker-projection.ts:253-263` |
| Run summary currently renders total cost only | `renderRunUsageLines` | `src/core/loop-run/ink-view.ts:87-105` |
| Worker details currently render total cost only | selected-worker render block | `src/core/loop-run/ink-view.ts:350-362` |
| Tracker initialization derives an empty summary | `LoopRunTracker.create` | `src/core/utils/loop-run-tracker.ts:104-105` |
| Empty-summary exact shape is asserted | empty summary test | `test/usage.test.ts:20-38` |
| Tracker exact summary fixtures omit the new field | initialization fixture | `test/loop-run-tracker.test.ts:68-135` |
| LoopRun summary recomputation is tested | `recomputes summary from the full ledger` | `test/loop-run.test.ts:548-572` |
| Streaming must not mutate committed totals | streaming test | `test/ink-state.test.ts:303-337` |
| UI renders run cost and in-progress cost | Ink UI tests | `test/ink-ui.test.ts:121-146` |

## 4. Tests and documentation

### Tests that will break

- `test/usage.test.ts:25-38` — exact empty `UsageTotals` object.
- `test/loop-run-tracker.test.ts:68-135` — exact zeroed summary fixture.
- `test/loop-run-tracker.test.ts:167-223` and `:264-321` — manually constructed `UsageTotals` fixtures.
- Any TypeScript-checked test fixtures assigning complete `usageSummary` objects will require `executionCount`.

### New tests to add

- Empty ledger produces `executionCount: 0` in run and every phase bucket.
- Multiple entries produce the correct run count.
- Issue buckets count only entries for that issue.
- Phase buckets count only entries for that phase.
- Entries with entirely null usage still increment the count.
- An entry without `issueId` increments run and phase counts but creates no issue bucket.
- Streaming-only usage keeps `executionCount === 0`.
- Streaming usage followed by `usageRecorded` yields count `1`, not `2`.
- Average-cost UI output divides total cost by committed execution count.
- Unknown cost remains `unknown` for average cost.
- Zero executions do not produce `NaN` or `Infinity`.

No separate documentation currently defines `UsageTotals`; `docs/adr/0009-inline-usage-ledger-in-loop-run-tracker.md:24-30` documents the ledger/summary contract and should be amended if persisted schema changes are documented there.

## 5. Uncertainties

- The desired display text and zero-execution representation for average cost are not specified.
- It is unclear whether average cost should be shown only in the run summary or also in selected-worker details; both currently expose total cost and are likely UI impact points.
- Existing persisted snapshots may lack `executionCount`; loading compatibility behavior is not visible in the inspected code and should be verified before making the field mandatory for old archives.


---
