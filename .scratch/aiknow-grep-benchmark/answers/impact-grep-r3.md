## 1. Executive summary

`UsageTotals` is defined in `src/core/loop-run/state.ts:244-253` and is produced by two separate accumulation paths:

- Durable ledger summaries: `src/core/loop-run/usage.ts:27-84`
- Ephemeral Ink dashboard projections: `src/core/loop-run/ink-worker-projection.ts:29-76`

Add `executionCount: number` to both zero-value constructors and increment it only in ledger-entry accumulation. Do not increment it in `accumulateStreamingUsage`.

The UI currently renders committed and in-progress cost in `src/core/loop-run/ink-view.ts:87-103` and worker cost in `src/core/loop-run/ink-view.ts:356-362`. Add average-cost formatting using `costUsd / executionCount`, returning `"unknown"` when cost is unknown or the count is zero.

## 2. Detailed flow / architecture / impact analysis

1. `UsageLedgerEntry` represents one completed execution and is persisted in `RunSnapshot.usageLedger` (`src/core/loop-run/state.ts:233-242`, `:298-299`).
2. `LoopRun.recordUsage` appends one entry, then recomputes the entire summary with `buildUsageSummary` (`src/core/loop-run/loop-run.ts:506-533`).
3. `buildUsageSummary` initializes run, issue, and phase buckets with `zeroTotals`, then calls `accumulateInto` once for each ledger entry (`src/core/loop-run/usage.ts:27-64`, `:67-84`).
4. `executionCount` must therefore be incremented in `accumulateInto`; this automatically updates run, issue, and phase buckets.
5. The Ink projection separately accumulates committed entries through `accumulateUsage` (`src/core/loop-run/ink-worker-projection.ts:52-64`).
6. Streaming updates use `accumulateStreamingUsage` (`src/core/loop-run/ink-worker-projection.ts:66-78`) and are not ledger-backed. That function must preserve `executionCount` unchanged.
7. `displayRunUsage` starts from zero totals and adds only streaming usage (`src/core/loop-run/ink-worker-projection.ts:253-263`), so its count should remain zero for ephemeral usage.
8. Required implementation files:
   - **`src/core/loop-run/state.ts:244-253`** — add `executionCount: number` to `UsageTotals`.
   - **`src/core/loop-run/usage.ts:27-39`** — initialize `executionCount: 0` in `zeroTotals`.
   - **`src/core/loop-run/usage.ts:41-64`** — increment `target.executionCount` once per ledger entry.
   - **`src/core/loop-run/ink-worker-projection.ts:29-43`** — initialize the field in `zeroUsageTotals`.
   - **`src/core/loop-run/ink-worker-projection.ts:52-64`** — increment count for committed ledger entries.
   - **`src/core/loop-run/ink-worker-projection.ts:66-78`** — carry the existing count forward; do not increment it for streaming usage.
   - **`src/core/loop-run/ink-state.ts:262-265`** — add a formatter for average cost, or extend the existing cost-formatting helpers.
   - **`src/core/loop-run/ink-view.ts:87-103`** — render average cost alongside committed and in-progress cost. In-progress totals have no count, so average should be unavailable unless explicitly based on committed count.
   - **`src/core/loop-run/ink-view.ts:356-362`** — render worker average cost alongside worker total cost.
   - **`src/core/utils/loop-run-tracker.ts:47-54`** — consider normalizing or rebuilding legacy persisted summaries missing `executionCount`; current normalization only repairs task fields.
9. `src/core/loop-run/index.ts:25-31` already exports `UsageTotals`, so no export change is required.

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| `UsageTotals` contains all aggregate fields | `UsageTotals` | `src/core/loop-run/state.ts:244-253` |
| Ledger entries identify one execution | `UsageLedgerEntry` | `src/core/loop-run/state.ts:233-242` |
| Run, issue, and phase buckets share `UsageTotals` | `UsageSummary` | `src/core/loop-run/state.ts:255-259` |
| Durable summaries are initialized with zero totals | `zeroTotals` | `src/core/loop-run/usage.ts:27-39` |
| Each ledger entry is accumulated into buckets | `accumulateInto`, `buildUsageSummary` | `src/core/loop-run/usage.ts:41-84` |
| Recording usage appends to the ledger and recomputes summary | `recordUsage` | `src/core/loop-run/loop-run.ts:506-533` |
| Ink committed usage accumulates ledger entries | `accumulateUsage` | `src/core/loop-run/ink-worker-projection.ts:52-64` |
| Streaming usage is accumulated separately | `accumulateStreamingUsage` | `src/core/loop-run/ink-worker-projection.ts:66-78` |
| Streaming display starts from zero and only includes ephemeral values | `displayRunUsage` | `src/core/loop-run/ink-worker-projection.ts:253-263` |
| Run summary renders total cost | `renderRunUsageLines` | `src/core/loop-run/ink-view.ts:87-103` |
| Worker dashboard renders total cost | worker cost render | `src/core/loop-run/ink-view.ts:356-362` |
| Persisted snapshots are read without usage-summary normalization | `normalizeRunSnapshot`, `read` | `src/core/utils/loop-run-tracker.ts:47-54`, `:112-116` |

## 4. Tests and documentation

Tests requiring expected-object updates:

- `test/usage.test.ts:23-37` — add `executionCount: 0` to the empty summary expectation.
- `test/loop-run-tracker.test.ts:58-158` — add the field to every zeroed bucket in the initialization expectation.
- `test/loop-run-tracker.test.ts:160-229` and `:264-318` — update manually constructed `UsageTotals` fixtures.

New tests should cover:

- Empty ledger gives count `0`.
- Two ledger entries produce run count `2`.
- Counts are independently correct in `byIssue` and `byPhase`.
- Entries with null token/cost fields still count as executions.
- Streaming usage changes cost/tokens but leaves `executionCount` unchanged.
- Average cost is correct for known cost and positive count.
- Average cost is `"unknown"` when cost is unknown or count is zero.
- Legacy persisted snapshots either normalize or rebuild missing counts.

Existing projection/UI coverage is in `test/ink-state.test.ts:233-340` and `test/ink-ui.test.ts:116-146`; extend those tests for count preservation and average-cost rendering.

No documentation currently surfaced by the relevant symbols requires modification.

## 5. Uncertainties

- The request does not specify whether an in-progress average should use committed executions only or remain unavailable. The safer interpretation is that streaming usage contributes no count, so an in-progress-only average is unavailable.
- Persisted old snapshots may lack the new field. Because `normalizeRunSnapshot` currently does not normalize usage summaries, backward compatibility requires an explicit migration or recomputation from `usageLedger`.
