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
