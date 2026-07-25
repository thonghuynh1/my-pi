## 1. Executive summary

Add `executionCount: number` to `UsageTotals`, initialized to `0` and incremented once per `UsageLedgerEntry` in run, issue, and phase buckets. Streaming usage must leave the count unchanged because it is not ledger-backed.

The UI should display total cost and average cost (`costUsd / executionCount`) for committed usage, while avoiding division by zero and excluding ephemeral streaming usage from the denominator.

## 2. Detailed flow / architecture / impact analysis

### Files that must change

- **`src/core/loop-run/state.ts:244-260`**
  - Add `executionCount: number` to `UsageTotals`.
  - This affects `run`, `byIssue`, and `byPhase` through their shared type.

- **`src/core/loop-run/usage.ts:27-64,67-94`**
  - `zeroTotals()` must initialize `executionCount: 0`.
  - `accumulateInto()` must increment `target.executionCount` once for every ledger entry.
  - `buildUsageSummary()` already routes each entry into the run bucket, optional issue bucket, and phase bucket, so one increment in `accumulateInto()` correctly counts all applicable buckets.

- **`src/core/loop-run/ink-worker-projection.ts:29-77,253-276,292-295`**
  - `zeroUsageTotals()` must initialize the field.
  - `accumulateUsage()` must increment it for committed ledger entries.
  - `accumulateStreamingUsage()` must preserve the existing count rather than incrementing it.
  - `displayRunUsage()` will therefore show streaming cost/tokens with the committed execution count unchanged.
  - Add average-cost formatting support for worker totals; streaming usage must not increase the denominator.

- **`src/core/loop-run/ink-state.ts:262-265`**
  - Add a formatter for average cost, or extend `formatUsageCost()`.
  - Return a zero/“n/a” representation when `executionCount === 0`; return unknown when cost is unknown according to existing semantics.

- **`src/core/loop-run/ink-view.ts:87-104,315-362`**
  - Run Summary should show committed total cost and average cost per execution.
  - Details should show the selected issue’s total and average cost.
  - The in-progress line may show streaming cost, but must not present it as an additional execution or alter the committed average denominator.

- **`docs/adr/0009-inline-usage-ledger-in-loop-run-tracker.md:18-26`**
  - Document that `UsageSummary` includes execution counts and that counts represent ledger entries, including entries with unknown usage.
  - Explicitly state that streaming usage is not part of the durable ledger or execution count.

### Files whose assertions will break

- **`test/usage.test.ts:24-39`**
  - The exact empty-summary object must include `executionCount: 0`.

- **`test/loop-run-tracker.test.ts:58-145`**
  - The exact initial `usageSummary` object must include `executionCount: 0` in `run` and every phase bucket.

Other tests use partial matching or inspect individual numeric fields and should not break solely because of the new field.

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| `UsageTotals` is the shared totals contract | `UsageTotals` | `src/core/loop-run/state.ts:244-254` |
| Summaries contain run, issue, and phase buckets | `UsageSummary` | `src/core/loop-run/state.ts:256-260` |
| The ledger is persisted as the source data | `RunSnapshot.usageLedger`, `usageSummary` | `src/core/loop-run/state.ts:296-300` |
| Empty totals are created in one summary helper | `zeroTotals` | `src/core/loop-run/usage.ts:27-39` |
| Each ledger entry is aggregated into totals | `accumulateInto` | `src/core/loop-run/usage.ts:41-64` |
| Entries contribute to run, issue, and phase buckets | `buildUsageSummary` | `src/core/loop-run/usage.ts:67-94` |
| Tracker recomputes summary after ledger append | `recordUsage` | `src/core/loop-run/loop-run.ts:506-534` |
| Tracker initialization derives an empty summary from the ledger | `LoopRunTracker.create` | `src/core/utils/loop-run-tracker.ts:112-113` |
| UI projection has separate committed and streaming state | `WorkerProjectionState` | `src/core/loop-run/ink-worker-projection.ts:23-27` |
| Committed entries currently accumulate into totals | `accumulateUsage` | `src/core/loop-run/ink-worker-projection.ts:52-64` |
| Streaming usage currently accumulates separately | `accumulateStreamingUsage` | `src/core/loop-run/ink-worker-projection.ts:66-78` |
| Run display combines streaming values without mutating committed totals | `displayRunUsage` | `src/core/loop-run/ink-worker-projection.ts:253-263` |
| Run Summary displays committed cost and in-progress cost | `renderRunUsageLines` | `src/core/loop-run/ink-view.ts:87-104` |
| Selected-worker Details displays issue cost | Details renderer | `src/core/loop-run/ink-view.ts:315-362` |
| Existing tests assert exact zero totals | `buildUsageSummary` test | `test/usage.test.ts:24-39` |
| Existing tracker test asserts exact zero summary | initialization test | `test/loop-run-tracker.test.ts:58-145` |
| Existing tests verify streaming does not mutate committed totals | streaming tests | `test/ink-state.test.ts:303-337` |
| Existing UI test covers in-progress cost rendering | run-summary test | `test/ink-ui.test.ts:121-147` |

## 4. Tests and documentation

Add tests for:

- Empty totals have `executionCount === 0`.
- Two ledger entries produce run count `2`.
- Issue buckets count only entries for that issue.
- Phase buckets count entries assigned to that phase.
- Entries with all usage fields `null` still increment the count.
- Entries without `issueId` increment run and phase counts but not `byIssue`.
- Streaming accumulation leaves `executionCount` unchanged.
- Committing a streamed entry increments the count exactly once.
- Average cost is total cost divided by execution count.
- Average cost handles zero executions and unknown cost.
- UI renders total and average cost for run and selected issue.

Update ADR-0009 to define the count semantics and streaming exclusion.

## 5. Uncertainties

- Existing persisted tracker JSON may contain summaries without `executionCount`; the read path’s backward-compatibility behavior should be decided. A migration or summary recomputation may be needed for old archived runs.
- The current UI exposes run totals and selected-issue totals, but not persisted `byPhase` totals directly; phase-count support is required in the data model even if a separate phase-summary UI is not added now.
