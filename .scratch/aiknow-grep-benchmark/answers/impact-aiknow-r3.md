## 1. Executive summary

Add `executionCount` to `UsageTotals`. Count one for every ledger-backed `UsageLedgerEntry` in run, issue, and phase buckets. Streaming usage must update display-only token/cost fields but leave `executionCount` unchanged.

Required implementation files:

- `src/core/loop-run/state.ts`
- `src/core/loop-run/usage.ts`
- `src/core/loop-run/ink-worker-projection.ts`
- `src/core/loop-run/ink-state.ts`
- `src/core/loop-run/ink-view.ts`

`LoopRun.recordUsage` already appends ledger entries and recomputes summaries, so it needs no behavioral change (`src/core/loop-run/loop-run.ts:486-528`).

## 2. Detailed flow / architecture / impact analysis

- `UsageLedgerEntry` represents one completed agent execution and is persisted in `RunSnapshot.usageLedger` (`src/core/loop-run/state.ts:228-237`, `src/core/loop-run/state.ts:284-285`).
- `UsageTotals` is used for run, per-issue, and per-phase summaries (`src/core/loop-run/state.ts:239-255`). Add `executionCount: number`.
- `zeroTotals()` must initialize `executionCount` to `0` (`src/core/loop-run/usage.ts:27-38`).
- `accumulateInto()` must increment `executionCount` exactly once per ledger entry (`src/core/loop-run/usage.ts:41-58`).
- `buildUsageSummary()` applies `accumulateInto()` to run, issue, and phase buckets (`src/core/loop-run/usage.ts:67-94`), so the count propagates automatically.
- `recordUsage()` creates exactly one ledger entry per execution and rebuilds the summary (`src/core/loop-run/loop-run.ts:486-528`).
- Streaming usage is explicitly ephemeral and does not create ledger entries (`src/core/loop-run/events.ts:34-43`, `src/core/loop-run/loop-run.ts:534-542`).
- The Ink projection has separate ledger-backed and streaming accumulation paths:
  - `accumulateUsage()` should increment `executionCount` (`src/core/loop-run/ink-worker-projection.ts:52-64`).
  - `accumulateStreamingUsage()` must not increment it (`src/core/loop-run/ink-worker-projection.ts:66-78`).
  - `displayRunUsage()` combines streaming values for display, so its count must remain ledger-only (`src/core/loop-run/ink-worker-projection.ts:253-263`).
- The UI currently renders total cost only in Run Summary and Details (`src/core/loop-run/ink-view.ts:87-104`, `src/core/loop-run/ink-view.ts:351-362`). Add average cost as `costUsd / executionCount`, with a zero-count-safe display such as `n/a`; do not include streaming usage in the denominator.
- `formatUsageCost()` and `formatDisplayCost()` are the natural formatting seams for total/average cost (`src/core/loop-run/ink-state.ts:262-265`, `src/core/loop-run/ink-worker-projection.ts:287-296`).

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| Ledger entries represent executions | `UsageLedgerEntry` | `src/core/loop-run/state.ts:228-237` |
| Usage totals feed run, issue, and phase buckets | `UsageSummary` | `src/core/loop-run/state.ts:239-255` |
| Summaries are recomputed from the ledger | `buildUsageSummary` | `src/core/loop-run/usage.ts:60-94` |
| Each ledger entry is accumulated into all applicable buckets | `accumulateInto` | `src/core/loop-run/usage.ts:41-58` |
| Recording usage appends one entry | `LoopRun.recordUsage` | `src/core/loop-run/loop-run.ts:486-528` |
| Streaming usage is not persisted | `StreamingUsageEvent` | `src/core/loop-run/events.ts:34-43` |
| Streaming updates do not create ledger entries | `LoopRun.emitStreamingUsage` | `src/core/loop-run/loop-run.ts:534-542` |
| UI combines persisted and streaming display usage | `displayRunUsage` | `src/core/loop-run/ink-worker-projection.ts:253-263` |
| UI renders total cost in Run Summary | `renderRunUsageLines` | `src/core/loop-run/ink-view.ts:87-104` |
| UI renders worker cost in Details | Details render branch | `src/core/loop-run/ink-view.ts:351-362` |

## 4. Tests and documentation

Existing tests that will break because exact `UsageTotals` objects gain a field:

- `test/usage.test.ts:23-38` — empty summary expected object.
- `test/usage.test.ts:134-143` — live-steering zero totals expected object.
- Any other `UsageTotals` fixtures using exact equality should be updated.

Add tests:

- `test/usage.test.ts`
  - Empty ledger has `executionCount: 0`.
  - Two entries produce run count `2`.
  - Counts are independently correct in `byIssue`.
  - Counts are independently correct in `byPhase`.
  - Entries without `issueId` count in run/phase but not `byIssue`.
  - Null token/cost values still count as executions.
- `test/ink-state.test.ts`
  - Ledger-backed usage increments worker and run counts.
  - Streaming usage changes displayed cost/tokens but not `executionCount`.
  - Average cost is calculated only from ledger-backed count.
  - Zero-count average renders safely.
- Add/update UI assertions for Run Summary and Details average-cost text if render testing exists.

No change is needed to the ledger write path in `LoopRun.recordUsage`; its existing single-entry append behavior supplies the count source.

## 5. Uncertainties

- The repository index reports stale files, so some indirect `UsageTotals` consumers may be omitted.
- Whether average cost should appear as a separate line or inline beside total cost is not specified; both `Run Summary` and `Details` are clearly affected by the current rendering code.
- Persisted legacy snapshots may lack `executionCount`; if backward compatibility is required, deserialization should derive it from `usageLedger.length` or rebuild the summary.
