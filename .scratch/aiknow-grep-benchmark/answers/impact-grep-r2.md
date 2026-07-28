## 1. Executive summary

Add `executionCount: number` to `UsageTotals`.

Required production changes:

- `src/core/loop-run/state.ts`: extend `UsageTotals`.
- `src/core/loop-run/usage.ts`: initialize and increment the count for run, issue, and phase buckets.
- `src/core/loop-run/ink-worker-projection.ts`: count committed ledger entries, but never count streaming usage.
- `src/core/loop-run/ink-state.ts` and `src/core/loop-run/ink-view.ts`: expose/render average cost per execution.
- Existing exact-object tests and manually constructed totals must add `executionCount`.

`LoopRun.recordUsage` itself should not increment the count directly; it already appends one ledger record and recomputes the summary.

## 2. Detailed flow / architecture / impact analysis

- `UsageLedgerEntry` represents one completed agent execution and has a monotonic `executionId` ([state.ts:233-242](src/core/loop-run/state.ts:233-242)).
- `UsageTotals` is the shared totals shape for run, issue, and phase summaries ([state.ts:244-254](src/core/loop-run/state.ts:244-254)).
- `buildUsageSummary` creates zeroed buckets, accumulates every ledger entry into the run bucket, optionally into `byIssue`, and always into `byPhase` ([usage.ts:27-62](src/core/loop-run/usage.ts:27-62), [usage.ts:67-88](src/core/loop-run/usage.ts:67-88)).
- Implement `executionCount += 1` in `accumulateInto`; this automatically counts entries in all three ledger-backed summary buckets, including entries with unknown usage values.
- `LoopRun.recordUsage` appends one entry and rebuilds the summary from the full ledger ([loop-run.ts:496-537](src/core/loop-run/loop-run.ts:496-537)).
- The Ink projection separately accumulates committed ledger entries through `accumulateUsage` ([ink-worker-projection.ts:52-64](src/core/loop-run/ink-worker-projection.ts:52-64)). Increment its count there for run and worker totals.
- Streaming usage is ephemeral and handled by `accumulateStreamingUsage` ([ink-worker-projection.ts:66-78](src/core/loop-run/ink-worker-projection.ts:66-78)). It must preserve `executionCount` unchanged. `displayRunUsage` combines streaming values into a temporary total ([ink-worker-projection.ts:253-264](src/core/loop-run/ink-worker-projection.ts:253-264)).
- Add average-cost formatting based on `costUsd / executionCount`. Return `"unknown"` when `hasUnknownCost` is true; define an explicit zero-count result such as `"n/a"` or `"$0.00"`.
- Render committed total cost and average cost in `renderRunUsageLines` ([ink-view.ts:86-106](src/core/loop-run/ink-view.ts:86-106)). Do not derive the average from streaming usage.

Files that must change:

1. **`src/core/loop-run/state.ts`**
   - Symbol: `UsageTotals`
   - Add `executionCount: number`.

2. **`src/core/loop-run/usage.ts`**
   - Symbols: `zeroTotals`, `accumulateInto`
   - Initialize count to zero.
   - Increment only in `accumulateInto`, once per `UsageLedgerEntry`.

3. **`src/core/loop-run/ink-worker-projection.ts`**
   - Symbols: `zeroUsageTotals`, `accumulateUsage`, `accumulateStreamingUsage`
   - Initialize count to zero.
   - Increment for committed entries in `accumulateUsage`.
   - Preserve the target count in `accumulateStreamingUsage`.

4. **`src/core/loop-run/ink-state.ts`**
   - Symbol: add an average-cost formatter adjacent to `formatUsageCost`, or extend that formatting API.
   - Handle unknown cost and zero executions explicitly.

5. **`src/core/loop-run/ink-view.ts`**
   - Symbol: `renderRunUsageLines`
   - Render average cost beside total cost for committed run totals.
   - Streaming/in-progress display must not increase the execution count.

`src/core/loop-run/loop-run.ts` requires no production logic change: its existing append-and-recompute flow supplies the correct ledger source.

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| Ledger entries represent executions | `UsageLedgerEntry` | `src/core/loop-run/state.ts:233-242` |
| Totals are used for run, issue, and phase buckets | `UsageSummary` | `src/core/loop-run/state.ts:256-260` |
| Totals are initialized in one shared builder | `zeroTotals` | `src/core/loop-run/usage.ts:27-39` |
| Ledger entries feed all summary buckets | `buildUsageSummary` | `src/core/loop-run/usage.ts:67-88` |
| Each execution appends one ledger entry | `recordUsage` | `src/core/loop-run/loop-run.ts:506-535` |
| Committed UI usage is accumulated separately | `accumulateUsage` | `src/core/loop-run/ink-worker-projection.ts:52-64` |
| Streaming usage is ephemeral | `accumulateStreamingUsage` | `src/core/loop-run/ink-worker-projection.ts:66-78` |
| Streaming usage is merged only for display | `displayRunUsage` | `src/core/loop-run/ink-worker-projection.ts:253-264` |
| Run summary currently renders total cost only | `renderRunUsageLines` | `src/core/loop-run/ink-view.ts:86-106` |
| Tracker creation derives an empty summary | `LoopRunTracker.create` | `src/core/utils/loop-run-tracker.ts:79-103` |

## 4. Tests and documentation

Tests that will break or need expected-value updates:

- `test/usage.test.ts:20-36` — exact empty totals object.
- `test/usage.test.ts:140-143` — live-steering zero totals.
- `test/loop-run-tracker.test.ts:58-136` — exact initial summary.
- `test/loop-run-tracker.test.ts:167-224` and `264-321` — manually constructed persisted summaries.
- `test/loop-run.test.ts:550-578` — summary assertions should include counts.
- `test/ink-ui.test.ts:121-145` — rendered cost expectations.

New test cases:

- Empty summary has `executionCount: 0` in every phase/run bucket.
- Two entries produce run count `2`.
- Issue and phase counts include only entries belonging to those buckets.
- Entries with `null` cost or tokens still increment the count.
- Streaming usage leaves `executionCount` unchanged.
- Average cost is `total cost / executionCount`.
- Unknown cost renders as unknown; zero executions use the chosen zero-count behavior.

Documentation candidates:

- Update the usage-summary contract in `docs/adr/0009-inline-usage-ledger-in-loop-run-tracker.md:24-34`.
- Update the UI/status-bar description in `docs/adr/0014-single-terminal-writer-and-pinned-status-bar.md:10-12` to mention execution count and average cost.

## 5. Uncertainties

- The requested display location for averages is not specified. The current visible run summary is `renderRunUsageLines`; worker cards use separate cost formatting.
- Behavior for zero executions and unknown cost needs a product decision (`"n/a"` vs `$0.00`; unknown likely remains `"unknown"`).
- Whether average cost should also appear in worker/detail cards is unclear; the data path supports it, but current evidence only shows run-summary cost rendering.
