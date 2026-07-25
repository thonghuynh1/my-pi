## 1. Executive summary

Add `executionCount: number` to `UsageTotals`. Count each ledger entry in run, issue, and phase buckets; entries with `null` usage still count. Streaming usage must leave the count unchanged.

Required production changes:

- `src/core/loop-run/state.ts:244-254` — extend `UsageTotals`.
- `src/core/loop-run/usage.ts:27-58` — initialize and increment counts for ledger entries.
- `src/core/loop-run/ink-worker-projection.ts:29-78` — mirror the field for UI projections; do not increment it for streaming usage.
- `src/core/loop-run/ink-view.ts:87-103, 351-362` — optionally render average cost as `costUsd / executionCount`.
- Tests in `test/usage.test.ts` and `test/ink-state.test.ts` require updates/additions.

## 2. Detailed flow / architecture / impact analysis

- `UsageLedgerEntry` represents one completed execution and includes execution metadata, issue, phase, and usage values (`state.ts:233-242`).
- `UsageSummary` contains run, per-issue, and per-phase `UsageTotals` buckets (`state.ts:256-260`).
- `buildUsageSummary` recomputes all buckets from the complete ledger (`usage.ts:60-95`). Increment `executionCount` once in `accumulateInto`; the existing calls automatically apply it to run, issue, and phase totals.
- `LoopRun.recordUsage` appends exactly one ledger entry and rebuilds the persisted summary (`loop-run.ts:506-536`).
- `zeroUsageTotals` supplies UI totals (`ink-worker-projection.ts:29-40`).
- `accumulateUsage` processes committed ledger entries (`ink-worker-projection.ts:52-64`) and must increment `executionCount`.
- `accumulateStreamingUsage` processes ephemeral in-progress values (`ink-worker-projection.ts:66-78`) and must preserve the existing count.
- Streaming events are explicitly non-persistent and do not create ledger entries (`events.ts:39-48`; `loop-run.ts:542-545`).
- `displayRunUsage` starts from zero and aggregates only streaming values (`ink-worker-projection.ts:253-264`), so its count should remain zero.
- The TUI currently displays total cost for run and selected-worker views (`ink-view.ts:87-103, 351-362`). If the request includes visible average cost, add an average formatter/render line there, guarding against zero executions and unknown cost.

## 3. Evidence table

| Claim | Symbol | File:line |
|---|---|---|
| Ledger entries represent executions | `UsageLedgerEntry` | `src/core/loop-run/state.ts:233-242` |
| `UsageTotals` currently lacks the count | `UsageTotals` | `src/core/loop-run/state.ts:244-254` |
| Summary has run, issue, and phase buckets | `UsageSummary` | `src/core/loop-run/state.ts:256-260` |
| Summary is recomputed from the full ledger | `buildUsageSummary` | `src/core/loop-run/usage.ts:60-95` |
| Run totals accumulate every ledger entry | `accumulateInto` | `src/core/loop-run/usage.ts:41-58, 80-92` |
| Persisted usage appends one ledger entry | `recordUsage` | `src/core/loop-run/loop-run.ts:506-536` |
| UI committed totals use ledger entries | `accumulateUsage` | `src/core/loop-run/ink-worker-projection.ts:52-64` |
| Streaming totals are separate and ephemeral | `accumulateStreamingUsage` | `src/core/loop-run/ink-worker-projection.ts:66-78` |
| Streaming does not create ledger entries | `StreamingUsageEvent` | `src/core/loop-run/events.ts:39-48` |
| Run streaming display starts independently | `displayRunUsage` | `src/core/loop-run/ink-worker-projection.ts:253-264` |
| Run cost is rendered in the TUI | `renderRunUsageLines` | `src/core/loop-run/ink-view.ts:87-103` |
| Worker cost is rendered in the TUI | selected-worker details rendering | `src/core/loop-run/ink-view.ts:351-362` |

## 4. Tests and documentation

Existing tests that will break or need updates:

- `test/usage.test.ts:23-38` — exact empty `UsageTotals` object must include `executionCount: 0`.
- `test/usage.test.ts:40-50` — assert execution count.
- `test/usage.test.ts:78-100` — assert per-issue and per-phase counts.
- `test/ink-state.test.ts:171-198` — assert committed worker count.
- `test/ink-state.test.ts:232-337` — add count assertions around streaming and final recording.

New cases:

1. Empty summary has zero counts in every bucket.
2. Multiple ledger entries count once in run, issue, and phase buckets.
3. Entries with unknown/null cost still increment counts.
4. Entries without `issueId` increment run and phase only.
5. Streaming updates do not change committed run or worker counts.
6. After `usageRecorded`, count increments exactly once and streaming data is cleared.
7. Average cost is zero/undefined-safe when count is zero and unknown when cost is unknown.

The source documentation already identifies the ledger as the source of truth (`usage.ts:2-6`) and explicitly documents streaming as non-ledger-backed (`events.ts:39-48`).

## 5. Uncertainties

- The repository has no existing average-cost formatter or dedicated TUI rendering test; whether `ink-view.ts` must change depends on whether “UI can display” means exposing the field only or immediately rendering it.
- `UsageTotals` impact is broader than the indexed direct references because it is structurally constructed in projection helpers; all constructors returning `UsageTotals` must include the new field.
