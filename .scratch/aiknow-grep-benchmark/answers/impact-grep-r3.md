## 1. Executive summary

`UsageTotals` is defined in `src/core/loop-run/state.ts:244-254` and aggregated by `buildUsageSummary()` in `src/core/loop-run/usage.ts:27-83`.

Required changes:

- Add `executionCount: number` to `UsageTotals`.
- Increment it once per ledger entry in run, issue, and phase buckets.
- Do not increment it in streaming accumulations.
- Update UI cost formatting to show total and average cost per committed execution.
- Update initialization, projection, persistence expectations, tests, and ADR documentation.

## 2. Detailed flow / architecture / impact analysis

1. `LoopRun.recordUsage()` creates one `UsageLedgerEntry` per completed execution and recomputes the persisted summary through `buildUsageSummary()` (`src/core/loop-run/loop-run.ts:506-534`).
2. `UsageLedgerEntry` carries execution identity, issue, and phase attribution (`src/core/loop-run/state.ts:233-241`).
3. `buildUsageSummary()` initializes run, per-issue, and per-phase `UsageTotals`, then calls `accumulateInto()` for each ledger entry (`src/core/loop-run/usage.ts:27-83`).
4. Streaming usage is separate ephemeral state. `accumulateStreamingUsage()` currently adds token/cost values but must leave `executionCount` unchanged (`src/core/loop-run/ink-worker-projection.ts:66-78`).
5. Committed UI usage is accumulated by `accumulateUsage()` for run and worker totals (`src/core/loop-run/ink-worker-projection.ts:52-64`, `193-221`).
6. The run summary currently renders committed cost and a separate in-progress cost (`src/core/loop-run/ink-view.ts:87-103`). Worker cost is rendered by `formatDisplayCost()` (`src/core/loop-run/ink-view.ts:356-362`).
7. Recommended UI behavior: display `total cost` and `average cost/execution`; calculate the average using committed `executionCount`, while streamed cost may remain included in the displayed transient total. If the count is zero, render average as unavailable rather than dividing by zero.
8. `UsageSummary` is currently persisted but not otherwise consumed by the UI (`src/core/loop-run/state.ts:256-260`; `src/core/utils/loop-run-tracker.ts:102-105`; `src/core/loop-run/loop-run.ts:530-534`). Therefore, per-issue and per-phase counts require aggregation changes now, but no additional per-phase UI wiring is evidenced.

Files requiring changes:

- `src/core/loop-run/state.ts`
  - `UsageTotals`: add `executionCount: number`.
- `src/core/loop-run/usage.ts`
  - `zeroTotals()`: initialize `executionCount: 0`.
  - `accumulateInto()`: increment once for every ledger entry.
  - `buildUsageSummary()`: no structural change beyond using the updated accumulator.
- `src/core/loop-run/ink-worker-projection.ts`
  - `zeroUsageTotals()`: initialize the count.
  - `accumulateUsage()`: increment for committed `UsageLedgerEntry` records.
  - `accumulateStreamingUsage()`: preserve the existing count; never increment it.
  - `formatDisplayCost()`: expose total and average using committed count.
  - `displayRunUsage()`: streamed totals must retain the committed count.
- `src/core/loop-run/ink-state.ts`
  - `formatUsageCost()`: format total plus average, handling unknown cost and zero executions.
- `src/core/loop-run/ink-view.ts`
  - `renderRunUsageLines()`: label/render total and average cost for committed and in-progress usage.
  - Worker detail rendering: show the updated total/average string from `formatDisplayCost()`.

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| `UsageTotals` is the shared totals shape | `UsageTotals` | `src/core/loop-run/state.ts:244-254` |
| Ledger entries identify execution, issue, and phase | `UsageLedgerEntry` | `src/core/loop-run/state.ts:233-241` |
| Summary contains run, issue, and phase buckets | `UsageSummary` | `src/core/loop-run/state.ts:256-260` |
| Empty totals are constructed in one place | `zeroTotals` | `src/core/loop-run/usage.ts:27-39` |
| Ledger values are aggregated by entry | `accumulateInto` | `src/core/loop-run/usage.ts:41-58` |
| All three buckets use the accumulator | `buildUsageSummary` | `src/core/loop-run/usage.ts:67-83` |
| Completed usage increments projection totals | `accumulateUsage` | `src/core/loop-run/ink-worker-projection.ts:52-64` |
| Streaming usage is accumulated separately | `accumulateStreamingUsage` | `src/core/loop-run/ink-worker-projection.ts:66-78` |
| Recorded usage clears streaming state | `applyUsageRecordedToWorkerProjection` | `src/core/loop-run/ink-worker-projection.ts:191-221` |
| Run in-progress totals are derived from streaming state | `displayRunUsage` | `src/core/loop-run/ink-worker-projection.ts:253-266` |
| Worker cost currently displays only total cost | `formatDisplayCost` | `src/core/loop-run/ink-worker-projection.ts:287-295` |
| Run summary currently renders cost only | `renderRunUsageLines` | `src/core/loop-run/ink-view.ts:87-103` |
| Worker UI renders cost through formatter | Worker detail render | `src/core/loop-run/ink-view.ts:356-362` |
| Usage summary is recomputed after recording | `LoopRun.recordUsage` | `src/core/loop-run/loop-run.ts:506-534` |
| Empty persisted summaries are initialized through the builder | `LoopRunTracker.create` | `src/core/utils/loop-run-tracker.ts:102-105` |

## 4. Tests and documentation

Tests expected to break because they use exact `UsageTotals` object equality:

- `test/usage.test.ts:23-38`
- `test/loop-run-tracker.test.ts:58-145`
- `test/loop-run-tracker.test.ts:167-224`

Tests requiring updated expectations or new assertions:

- `test/usage.test.ts:40-50`: assert run count for two entries.
- `test/usage.test.ts:78-97`: assert per-issue and per-phase counts.
- `test/usage.test.ts:102-108`: assert entries without issue still count in run/phase, not `byIssue`.
- `test/loop-run.test.ts:554-571`: assert persisted run, issue, and phase counts.
- `test/ink-state.test.ts:232-333`: assert committed usage increments count and streaming usage does not.
- `test/ink-ui.test.ts:121-147`: update cost output and assert average display.
- Add a zero-ledger/zero-count average test.
- Add a mixed streaming-plus-recorded test proving streaming cost changes do not change `executionCount`.
- Add a null-cost test proving count still increments even when `costUsd` is unknown.

Documentation updates:

- `docs/adr/0009-inline-usage-ledger-in-loop-run-tracker.md:24-34`: define `executionCount` as the number of ledger-backed executions and document that streaming usage is excluded.
- `docs/adr/0014-single-terminal-writer-and-pinned-status-bar.md:10-12`: document total and average cost presentation if this ADR remains the UI contract.

## 5. Uncertainties

- The exact desired UI string for total versus average cost is not specified.
- It is unclear whether average cost should be shown for worker cards during an active stream when `executionCount === 0`; recommended behavior is `n/a` or equivalent.
- No current UI path consumes persisted `UsageSummary.byIssue` or `.byPhase`; adding phase/issue UI displays would be a separate feature.
