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
