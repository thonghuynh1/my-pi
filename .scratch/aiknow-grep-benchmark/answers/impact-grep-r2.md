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
