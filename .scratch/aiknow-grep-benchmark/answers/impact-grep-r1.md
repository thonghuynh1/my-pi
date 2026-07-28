## 1. Executive summary

`UsageTotals` is defined in `src/core/loop-run/state.ts:244-254` and is produced by both ledger aggregation and UI projections.

Required changes:

- Add `executionCount: number` to `UsageTotals`.
- Increment it exactly once in ledger-backed accumulation for run, issue, and phase buckets.
- Keep it unchanged in streaming accumulation.
- Update zero-value constructors and all exact-object test fixtures.
- Add average-cost formatting/display using `costUsd / executionCount`, with a defined zero-count behavior.

## 2. Detailed flow / architecture / impact analysis

1. `LoopRun.recordUsage()` creates one `UsageLedgerEntry` per completed execution and recomputes the persisted summary through `buildUsageSummary()` (`src/core/loop-run/loop-run.ts:503-534`).
2. `buildUsageSummary()` initializes run, issue, and phase buckets, then calls `accumulateInto()` for each ledger entry (`src/core/loop-run/usage.ts:27-94`).
3. `accumulateInto()` should increment `executionCount` once per entry. Because it is called for run, matching issue, and matching phase, all three buckets receive the correct count.
4. The Ink projection separately accumulates committed entries through `accumulateUsage()` and ephemeral updates through `accumulateStreamingUsage()` (`src/core/loop-run/ink-worker-projection.ts:52-77`).
5. `accumulateStreamingUsage()` must preserve `target.executionCount`; streaming usage has no ledger entry and must not affect the denominator.
6. `displayRunUsage()` combines only ephemeral usage into a zeroed projection total (`src/core/loop-run/ink-worker-projection.ts:253-264`). Its count should remain zero for streaming-only usage.
7. The run UI currently renders committed total cost and in-progress cost (`src/core/loop-run/ink-view.ts:87-103`). Add average cost based on committed `state.runUsage`, not the streaming display total.
8. `formatUsageCost()` currently formats only total cost (`src/core/loop-run/ink-state.ts:262-265`). Add a narrowly named average-cost formatter or equivalent helper with zero-count handling.

Files that must change:

- `src/core/loop-run/state.ts`
  - `UsageTotals`: add `executionCount: number`.
- `src/core/loop-run/usage.ts`
  - `zeroTotals()`: initialize count to `0`.
  - `accumulateInto()`: increment count once per ledger entry.
- `src/core/loop-run/ink-worker-projection.ts`
  - `zeroUsageTotals()`: initialize count to `0`.
  - `accumulateUsage()`: increment count for committed ledger entries.
  - `accumulateStreamingUsage()`: preserve the existing count.
  - `displayRunUsage()`: retain zero count for streaming-only totals.
  - Add/update average-cost formatting support if projection-level display is required.
- `src/core/loop-run/ink-state.ts`
  - Add average-cost formatting based on `executionCount`.
- `src/core/loop-run/ink-view.ts`
  - `renderRunUsageLines()`: render average cost alongside total committed cost; do not increase the count for in-progress usage.
- `test/usage.test.ts`
  - Update exact zero fixture and add count assertions.
- `test/loop-run-tracker.test.ts`
  - Update exact persisted summary fixtures at the initialization and archive/per-model cases.
- `test/loop-run.test.ts`
  - Add count assertions to recomputation and persistence cases.
- `test/ink-state.test.ts`
  - Add streaming-count preservation assertions.
- `test/ink-ui.test.ts`
  - Update expected run-summary output and add average-cost assertions.
- `docs/adr/0009-inline-usage-ledger-in-loop-run-tracker.md`
  - Document that `executionCount` counts ledger entries per bucket and excludes ephemeral streaming usage.

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| `UsageTotals` is the shared totals shape | `UsageTotals` | `src/core/loop-run/state.ts:244-254` |
| Usage summaries contain run, issue, and phase buckets | `UsageSummary` | `src/core/loop-run/state.ts:256-260` |
| Ledger entries identify one execution | `UsageLedgerEntry.executionId` | `src/core/loop-run/state.ts:233-240` |
| Summaries are recomputed from the complete ledger | `buildUsageSummary` | `src/core/loop-run/usage.ts:67-94` |
| Each ledger entry contributes to the run bucket | `accumulateInto(run, entry)` | `src/core/loop-run/usage.ts:80-81` |
| Issue buckets only include entries with an issue ID | `entry.issueId` branch | `src/core/loop-run/usage.ts:83-89` |
| Every ledger entry contributes to its phase bucket | `accumulateInto(byPhase[entry.phase], entry)` | `src/core/loop-run/usage.ts:91` |
| Usage is recorded after execution and persisted | `recordUsage` | `src/core/loop-run/loop-run.ts:503-534` |
| Committed UI usage is accumulated separately | `accumulateUsage` | `src/core/loop-run/ink-worker-projection.ts:52-64` |
| Streaming usage currently accumulates cost/tokens | `accumulateStreamingUsage` | `src/core/loop-run/ink-worker-projection.ts:66-78` |
| Streaming usage is ephemeral and cleared after recording | `applyUsageRecordedToWorkerProjection` | `src/core/loop-run/ink-worker-projection.ts:191-221` |
| Streaming-only display totals are separate from committed totals | `displayRunUsage` | `src/core/loop-run/ink-worker-projection.ts:253-264` |
| Total cost is rendered in the run summary | `renderRunUsageLines` | `src/core/loop-run/ink-view.ts:87-103` |
| Cost formatting handles unknown cost | `formatUsageCost` | `src/core/loop-run/ink-state.ts:262-265` |
| Empty summary is asserted with exact object equality | `returns zeroed summary for empty ledger` | `test/usage.test.ts:23-37` |
| Tracker fixtures assert complete summary objects | initialization/archive fixtures | `test/loop-run-tracker.test.ts:58-225`, `:264-321` |
| Ledger recomputation behavior is tested | `recomputes summary from the full ledger` | `test/loop-run.test.ts:545-573` |
| Streaming display behavior is tested | `tracks run-scoped streaming usage separately` | `test/ink-state.test.ts:308-343` |
| UI output currently asserts total and in-progress cost | run-summary test | `test/ink-ui.test.ts:121-147` |
| ADR defines the persisted summary contract | Usage Summary decision | `docs/adr/0009-inline-usage-ledger-in-loop-run-tracker.md:39-47` |

## 4. Tests and documentation

Tests expected to break from exact `UsageTotals` equality:

- `test/usage.test.ts:25-35`
- `test/loop-run-tracker.test.ts:68-225`
- `test/loop-run-tracker.test.ts:264-321`

Tests to update or extend:

- `test/usage.test.ts`
  - Empty buckets have count `0`.
  - Two ledger entries produce run count `2`.
  - Issue and phase buckets count only their contributing entries.
  - Entries without `issueId` do not create or increment an issue bucket.
  - Unknown cost still counts as an execution.
- `test/loop-run.test.ts`
  - Recomputed and persisted summaries expose correct counts.
  - Failed executions with null usage still count.
- `test/ink-state.test.ts`
  - Streaming-only usage leaves `executionCount` at `0`.
  - Recorded usage increments count once and clears streaming usage.
- `test/ink-ui.test.ts`
  - Total and average cost are rendered.
  - Streaming usage does not inflate the displayed average denominator.

Update ADR-0009 to define `executionCount` as the number of `UsageLedgerEntry` records contributing to each bucket; explicitly state that streaming usage is not ledger-backed and is excluded.

## 5. Uncertainties

- The requested UI location is inferred to be the existing run summary in `renderRunUsageLines()`; no current UI renders issue/phase summary tables.
- The desired zero-execution average display is unspecified. Recommended behavior is `"n/a"` or `"unknown"` when `executionCount === 0`.
- Backward compatibility for already persisted JSON is not explicitly handled: `LoopRunTracker.read()` parses and normalizes snapshots (`src/core/utils/loop-run-tracker.ts:112-117`). If old snapshots must remain readable, normalization should backfill missing counts from `usageLedger` or default safely.
