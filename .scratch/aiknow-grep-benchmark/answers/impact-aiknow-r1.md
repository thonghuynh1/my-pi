## 1. Executive summary

Add `executionCount` to `UsageTotals`, incremented once per ledger entry in run, issue, and phase buckets. Streaming usage must leave it unchanged because streaming events are explicitly ephemeral and ledger-free【src/core/loop-run/loop-run.ts:534-541】.

Required production files:

- `src/core/loop-run/state.ts` — extend `UsageTotals`.
- `src/core/loop-run/usage.ts` — initialize and increment counts from ledger entries.
- `src/core/loop-run/ink-worker-projection.ts` — propagate counts for UI ledger projections while excluding streaming updates.
- `src/core/loop-run/ink-state.ts` — add average-cost formatting.
- `src/core/loop-run/ink-view.ts` — render average cost in Run Summary and Details cards.

## 2. Detailed flow / architecture / impact analysis

1. `UsageLedgerEntry` represents one completed execution and contains execution metadata plus usage values【src/core/loop-run/state.ts:228-237】.
2. `LoopRun.recordUsage` creates one ledger entry per execution, appends it, and recomputes `usageSummary` from the complete ledger【src/core/loop-run/loop-run.ts:486-526】.
3. `buildUsageSummary` creates run, issue, and phase buckets, then applies every ledger entry to each applicable bucket【src/core/loop-run/usage.ts:67-94】.
4. Add `executionCount: 0` in `zeroTotals`; increment it exactly once at the beginning of `accumulateInto`. This automatically counts entries even when all usage fields are `null`【src/core/loop-run/usage.ts:27-58】.
5. `UsageTotals` is also used by the live Ink projection. `accumulateUsage` processes committed ledger entries, while `accumulateStreamingUsage` processes ephemeral updates【src/core/loop-run/ink-worker-projection.ts:52-77】.
6. Add the count only to `accumulateUsage`; do not increment it in `accumulateStreamingUsage`. `applyUsageRecordedToWorkerProjection` will then count committed worker executions, while `displayRunUsage` continues to aggregate streaming values without inflating execution count【src/core/loop-run/ink-worker-projection.ts:191-221】【src/core/loop-run/ink-worker-projection.ts:253-264】.
7. Add an average-cost formatter, using `costUsd / executionCount`, but return `unknown` when cost is unknown and a sensible zero/not-available value when count is zero. Render it beside total cost in both Run Summary and Details【src/core/loop-run/ink-view.ts:87-103】【src/core/loop-run/ink-view.ts:351-362】.

## 3. Evidence table

| Claim | Symbol | File:line |
|---|---|---|
| `UsageTotals` owns aggregate numeric fields | `UsageTotals` | `src/core/loop-run/state.ts:239-249` |
| Summary has run, issue, and phase buckets | `UsageSummary` | `src/core/loop-run/state.ts:251-255` |
| Ledger entries identify executions | `UsageLedgerEntry` | `src/core/loop-run/state.ts:228-237` |
| Ledger entries are appended and summary recomputed | `LoopRun.recordUsage` | `src/core/loop-run/loop-run.ts:486-526` |
| Summary aggregation occurs in one pure builder | `buildUsageSummary` | `src/core/loop-run/usage.ts:60-94` |
| All buckets are initialized through `zeroTotals` | `zeroTotals` | `src/core/loop-run/usage.ts:27-38` |
| Streaming events do not write ledger entries | `emitStreamingUsage` | `src/core/loop-run/loop-run.ts:534-541` |
| Committed UI usage is accumulated separately | `accumulateUsage` | `src/core/loop-run/ink-worker-projection.ts:52-64` |
| Streaming usage is accumulated separately | `accumulateStreamingUsage` | `src/core/loop-run/ink-worker-projection.ts:66-78` |
| Run Summary renders committed and in-progress usage | `renderRunUsageLines` | `src/core/loop-run/ink-view.ts:87-105` |
| Details renders worker cost | `LoopRunInkView` | `src/core/loop-run/ink-view.ts:351-362` |
| Existing cost formatting handles unknown cost | `formatUsageCost` | `src/core/loop-run/ink-state.ts:262-265` |

## 4. Tests and documentation

Tests requiring updates:

- `test/usage.test.ts:23-38` — expected zero totals must include `executionCount: 0`.
- `test/usage.test.ts:40-50` — assert run count for two entries.
- `test/usage.test.ts:78-100` — assert per-issue and per-phase counts.
- `test/usage.test.ts:134-143` — assert zero count for `live-steering`.
- `test/loop-run.test.ts:496-520` — assert persisted run, issue, and phase counts.
- `test/ink-state.test.ts:232-337` — update committed usage expectations and add assertions that streaming-only usage has count `0`.

New cases:

- Mixed ledger entries with and without `issueId`: run/phase count increments; only issue buckets with `issueId` exist.
- Entries with entirely unknown usage: count still increments, while unknown flags remain correct.
- Multiple entries in the same issue and phase: count equals ledger-entry count, not token updates.
- Streaming update before commit: count remains zero; after `usageRecorded`, count becomes one.
- Repeated streaming updates for one execution: count remains zero and is never additive.
- Average cost with known cost, unknown cost, and zero executions.

No documentation file is directly evidenced as describing `UsageTotals`; update the relevant usage/ADR documentation only if the project requires durable schema changes.

## 5. Uncertainties

- Existing persisted snapshots may lack `executionCount`; the tracker’s load/migration normalization was not located in the indexed evidence. If old snapshots are supported, add backward-compatible normalization or treat missing counts as zero.
- The requested average-cost UI scope is inferred to include the existing Run Summary and Details cards. The persisted `byIssue`/`byPhase` summaries are available in `UsageSummary`, but the live Ink state currently exposes only run and worker totals【src/core/loop-run/ink-worker-projection.ts:22-27】.
