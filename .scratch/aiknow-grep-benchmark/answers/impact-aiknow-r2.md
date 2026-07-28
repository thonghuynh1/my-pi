## 1. Executive summary

`UsageTotals` is defined in `src/core/loop-run/state.ts:239-249` and is produced from the ledger by `buildUsageSummary` in `src/core/loop-run/usage.ts:67-94`.

Required changes:

- Add `executionCount: number` to `UsageTotals`.
- Increment it once per `UsageLedgerEntry` in `accumulateInto`.
- Initialize it to `0` in both totals factories.
- Do not increment it in `accumulateStreamingUsage`; streaming data is ephemeral.
- Update run-summary and worker-detail UI formatting to show average cost (`costUsd / executionCount`) alongside total cost.
- Update affected tests and add coverage for run, issue, phase, null-cost, and streaming behavior.

## 2. Detailed flow / architecture / impact analysis

1. `UsageLedgerEntry` extends `AgentExecutionUsage` and identifies one execution through `executionId` (`src/core/loop-run/state.ts:228-237`).
2. `UsageSummary` contains run, issue, and phase buckets (`src/core/loop-run/state.ts:251-255`).
3. `buildUsageSummary` creates zeroed buckets, then sends every ledger entry through `accumulateInto` for:
   - run totals (`src/core/loop-run/usage.ts:68-82`)
   - issue totals (`src/core/loop-run/usage.ts:83-89`)
   - phase totals (`src/core/loop-run/usage.ts:91`)
4. `LoopRun.recordUsage` appends exactly one ledger entry and recomputes the complete summary (`src/core/loop-run/loop-run.ts:486-526`).
5. The live Ink projection separately accumulates committed ledger entries with `accumulateUsage` (`src/core/loop-run/ink-worker-projection.ts:52-64`, `191-221`).
6. Streaming updates use `accumulateStreamingUsage` (`src/core/loop-run/ink-worker-projection.ts:66-78`) and are displayed through `displayRunUsage` (`src/core/loop-run/ink-worker-projection.ts:253-264`). This function must preserve `executionCount` unchanged.
7. The run summary currently renders total cost at `src/core/loop-run/ink-view.ts:87-104`; worker details render cost at `src/core/loop-run/ink-view.ts:351-362`. These are the UI points for average-cost display.
8. No changes are required to agent clients or streaming producers: they provide `AgentExecutionUsage`, while counting belongs to ledger-backed accumulation.

Files requiring changes:

| File | Symbols/functions | Required change |
|---|---|---|
| `src/core/loop-run/state.ts:239-249` | `UsageTotals` | Add `executionCount: number`. |
| `src/core/loop-run/usage.ts:27-38` | `zeroTotals` | Initialize `executionCount: 0`. |
| `src/core/loop-run/usage.ts:41-58` | `accumulateInto` | Increment `target.executionCount` once for every ledger entry, regardless of null token/cost fields. |
| `src/core/loop-run/ink-worker-projection.ts:29-40` | `zeroUsageTotals` | Initialize `executionCount: 0`. |
| `src/core/loop-run/ink-worker-projection.ts:52-64` | `accumulateUsage` | Increment `executionCount` for committed ledger entries. |
| `src/core/loop-run/ink-worker-projection.ts:66-78` | `accumulateStreamingUsage` | Do not change `executionCount`; streaming usage must not count as an execution. |
| `src/core/loop-run/ink-state.ts:262-265` | `formatUsageCost` or a new average-cost formatter | Add safe average-cost formatting, handling zero executions and unknown cost. |
| `src/core/loop-run/ink-view.ts:87-104` | `renderRunUsageLines` | Render total cost and average cost per execution using run `executionCount`. |
| `src/core/loop-run/ink-view.ts:351-362` | worker Details card | Render average cost using the worker’s committed `usage.executionCount`; do not use `streamingUsage` for the count. |

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| `UsageTotals` contains aggregate numeric usage fields | `UsageTotals` | `src/core/loop-run/state.ts:239-249` |
| Ledger entries represent individual executions | `UsageLedgerEntry` | `src/core/loop-run/state.ts:228-237` |
| Summary has run, issue, and phase buckets | `UsageSummary` | `src/core/loop-run/state.ts:251-255` |
| Each ledger entry is accumulated into run totals | `buildUsageSummary` | `src/core/loop-run/usage.ts:67-82` |
| Issue totals only include entries with `issueId` | `buildUsageSummary` | `src/core/loop-run/usage.ts:83-89` |
| Phase totals receive every ledger entry | `buildUsageSummary` | `src/core/loop-run/usage.ts:91` |
| Ledger entries are appended by `recordUsage` | `LoopRun.recordUsage` | `src/core/loop-run/loop-run.ts:486-526` |
| Committed UI usage increments from ledger entries | `accumulateUsage` | `src/core/loop-run/ink-worker-projection.ts:52-64` |
| Streaming usage currently accumulates separately | `accumulateStreamingUsage` | `src/core/loop-run/ink-worker-projection.ts:66-78` |
| Streaming usage is displayed separately from committed totals | `displayRunUsage` | `src/core/loop-run/ink-worker-projection.ts:253-264` |
| Run summary displays total cost | `renderRunUsageLines` | `src/core/loop-run/ink-view.ts:87-104` |
| Worker details display cost | Details card rendering | `src/core/loop-run/ink-view.ts:351-362` |

## 4. Tests and documentation

Tests likely to break:

- `test/usage.test.ts:23-38` — exact equality for zero totals must include `executionCount`.
- Any TypeScript object literals implementing `UsageTotals`, especially `zeroUsageTotals`-related fixtures.

Existing tests to update:

- `test/usage.test.ts:40-50` — assert run count.
- `test/usage.test.ts:78-87` — assert per-issue counts.
- `test/usage.test.ts:89-100` — assert per-phase counts.
- `test/usage.test.ts:110-121` — verify null-cost entries still count.
- `test/loop-run.test.ts:496-520` — assert recomputed run, issue, and phase counts.
- `test/ink-state.test.ts:303-336` — verify streaming usage leaves count unchanged and committed usage increments it.
- `test/ink-ui.test.ts:121-148` — update expected run-summary output.

New cases to add:

1. Empty ledger returns `executionCount: 0` in every phase bucket.
2. Two entries produce run count `2`.
3. Issue buckets count only entries belonging to that issue.
4. Phase buckets count entries assigned to that phase.
5. Entries with `costUsd: null` still increment count.
6. Streaming updates do not increment run or worker count.
7. After `usageRecorded`, the count increments exactly once and streaming usage is cleared.
8. Average cost is total cost divided by execution count.
9. Average cost is unknown when cost is unknown; zero-execution buckets avoid division by zero.
10. UI displays total and average cost separately.

Documentation/comments to update:

- `UsageTotals` field documentation in `state.ts`.
- The usage-summary comments in `usage.ts:61-66` to explicitly state that counts represent ledger entries, not streaming updates.
- UI comments/tests describing committed versus in-progress usage.

## 5. Uncertainties

- The current UI exposes run totals and per-issue worker totals, but not durable per-phase cost totals directly. The data model still requires phase counts because `UsageSummary.byPhase` is authoritative.
- Whether average cost should be shown for worker details as well as the run summary is inferred from the request and existing cost displays.
- No separate user-facing usage documentation was identified in the indexed repository; comments and tests appear to be the primary documentation for this behavior.
