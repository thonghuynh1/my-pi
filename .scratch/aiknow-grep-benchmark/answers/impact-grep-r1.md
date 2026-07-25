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
