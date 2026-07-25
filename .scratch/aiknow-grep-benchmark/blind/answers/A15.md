## 1. Executive summary

Add `executionCount: number` to `UsageTotals`, initialized to `0` and incremented once per `UsageLedgerEntry` in every applicable bucket:

- `run`
- `byIssue[issueId]`
- `byPhase[phase]`

Streaming usage must preserve the existing count; it is ephemeral and not ledger-backed. The UI should derive average cost as `costUsd / executionCount`, while retaining unknown-cost behavior.

Required production files:

- `src/core/loop-run/state.ts`
- `src/core/loop-run/usage.ts`
- `src/core/loop-run/ink-worker-projection.ts`
- `src/core/loop-run/ink-state.ts`
- `src/core/loop-run/ink-view.ts`

Primary tests requiring updates/additions:

- `test/usage.test.ts`
- `test/loop-run.test.ts`
- `test/ink-state.test.ts`
- `test/ink-ui.test.ts`

## 2. Detailed flow / architecture / impact analysis

1. `UsageTotals` is the shared contract for persisted summaries and UI projections (`state.ts:244-254`). Add `executionCount: number`.

2. `buildUsageSummary()` is the authoritative ledger-derived aggregation (`usage.ts:67-96`):
   - Add `executionCount: 0` in `zeroTotals()` (`usage.ts:27-38`).
   - Increment `target.executionCount` in `accumulateInto()` (`usage.ts:41-58`) for every ledger entry.
   - Because the same function feeds run, issue, and phase buckets (`usage.ts:80-94`), counts will automatically be correct for all three.
   - Entries with null usage still count, because they are ledger records.

3. `LoopRun.recordUsage()` already appends exactly one ledger entry per completed execution and recomputes the summary (`loop-run.ts:484-541`). No count-specific change is required there; its behavior is covered by the updated summary builder.

4. The Ink projection duplicates aggregation for committed entries (`ink-worker-projection.ts:29-64`):
   - Initialize `executionCount` in `zeroUsageTotals()` (`ink-worker-projection.ts:29-40`).
   - Increment it in `accumulateUsage()` (`ink-worker-projection.ts:52-64`).
   - Do not increment it in `accumulateStreamingUsage()` (`ink-worker-projection.ts:66-78`), ensuring ephemeral updates do not inflate counts.
   - `displayRunUsage()` combines only streaming values over a fresh zero total (`ink-worker-projection.ts:253-264`), so its count remains zero for streaming-only usage.

5. Cost formatting currently exposes only total cost:
   - `formatUsageCost()` is the shared run/worker formatter (`ink-state.ts:262-265`).
   - Extend it, or add a dedicated formatter, to display total and average cost. Return `"unknown"` when `hasUnknownCost` is true; otherwise calculate average only when `executionCount > 0`.
   - `formatDisplayCost()` handles worker committed plus streaming cost (`ink-worker-projection.ts:292-295`). Its average must use committed `worker.usage.executionCount`; streaming usage must not affect the denominator.

6. Run-summary rendering is in `renderRunUsageLines()` (`ink-view.ts:87-104`). Add average cost alongside total cost for committed run usage. In-progress usage should not show an execution average, or should explicitly show no average/count, because it has no ledger-backed executions.

7. The persisted tracker is initialized through `buildUsageSummary([])` (`loop-run-tracker.ts:111-114`), so adding the field to `zeroTotals()` automatically initializes new snapshots correctly.

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| `UsageTotals` is the shared totals shape | `UsageTotals` | `src/core/loop-run/state.ts:244-254` |
| Summaries contain run, issue, and phase buckets | `UsageSummary` | `src/core/loop-run/state.ts:256-260` |
| Ledger entries represent executions | `UsageLedgerEntry` | `src/core/loop-run/state.ts:233-242` |
| Summary is recomputed from the full ledger | `buildUsageSummary` | `src/core/loop-run/usage.ts:67-96` |
| All buckets use the same accumulation path | `accumulateInto` | `src/core/loop-run/usage.ts:41-58,80-94` |
| One ledger entry is appended per `recordUsage` call | `recordUsage` | `src/core/loop-run/loop-run.ts:484-541` |
| Committed UI usage accumulation exists separately | `accumulateUsage` | `src/core/loop-run/ink-worker-projection.ts:52-64` |
| Streaming accumulation is separate | `accumulateStreamingUsage` | `src/core/loop-run/ink-worker-projection.ts:66-78` |
| Streaming display starts from zero totals | `displayRunUsage` | `src/core/loop-run/ink-worker-projection.ts:253-264` |
| Worker cost includes streaming cost | `formatDisplayCost` | `src/core/loop-run/ink-worker-projection.ts:287-295` |
| Run cost is rendered in the summary | `renderRunUsageLines` | `src/core/loop-run/ink-view.ts:87-104` |
| Shared cost formatting is centralized | `formatUsageCost` | `src/core/loop-run/ink-state.ts:262-265` |
| Empty tracker summaries are initialized through the builder | `LoopRunTracker.create` | `src/core/utils/loop-run-tracker.ts:111-114` |

## 4. Tests and documentation

Tests that will break because exact `UsageTotals` object expectations gain a required field:

- `test/usage.test.ts:21-38` — empty summary exact object.
- `test/usage.test.ts:133-143` — live-steering zero-total object expectation.

Existing tests to update with count assertions:

- `test/usage.test.ts:40-49` — run count should be `2`.
- `test/usage.test.ts:78-87` — issue counts should be `2` and `1`.
- `test/usage.test.ts:89-100` — phase counts should match entries.
- `test/usage.test.ts:110-121` — null/known values still count both entries.
- `test/loop-run.test.ts:549-570` — persisted run, issue, and phase counts.
- `test/loop-run.test.ts:518-533` — missing usage still produces count `1`.

New test cases:

- Empty ledger gives count `0` in every phase bucket.
- Entries with all-null usage still increment counts.
- One entry increments run, matching issue, and matching phase exactly once.
- An entry without `issueId` increments run and phase but no issue bucket.
- Streaming usage leaves `executionCount` unchanged:
  - `test/ink-state.test.ts:303-333`
  - `test/ink-ui.test.ts:121-148`
- A committed entry followed by streaming usage keeps the same count.
- Average cost is `costUsd / executionCount`.
- Unknown cost displays `"unknown"` even when count is nonzero.
- Zero executions do not produce `NaN` or `Infinity`.

Relevant documentation establishes that the ledger is execution-based and summaries are ledger-derived: `docs/adr/0009-inline-usage-ledger-in-loop-run-tracker.md:24-30`.

## 5. Uncertainties

- The exact UI text for average cost is not specified. A format such as `cost $1.00 · avg $0.50/execution` is consistent with the existing run-summary format.
- It is unclear whether the average should appear on worker Details cards as well as the run summary. `formatDisplayCost()` is the worker-specific cost path, so supporting both is the safest interpretation.
- For zero executions, the UI should use a stable placeholder such as `n/a`; the repository currently has no established convention for this case.
