## 1. Executive summary

`UsageTotals` is defined in `src/core/loop-run/state.ts:244-254` and is constructed in both the durable summary builder and Ink projection.

Required changes:

- Add `executionCount: number` to `UsageTotals`.
- Increment it once per `UsageLedgerEntry` in `buildUsageSummary`.
- Increment it for committed entries in Ink projection.
- Do not increment it in `accumulateStreamingUsage`.
- Display total and average cost in the run and selected-worker UI.
- Update exact-object tests and add count/streaming regression tests.
- Consider normalizing old persisted summaries so legacy tracker files receive a correct count.

## 2. Detailed flow / architecture / impact analysis

### Durable ledger and summary

`LoopRun.recordUsage` creates exactly one `UsageLedgerEntry`, appends it to `usageLedger`, and recomputes the summary from the full ledger (`src/core/loop-run/loop-run.ts:484-533`). Therefore, the durable count belongs in `buildUsageSummary`, not in the record-writing path.

Required edits:

- **`src/core/loop-run/state.ts:244-254` — `UsageTotals`**
  - Add `executionCount: number`.
- **`src/core/loop-run/usage.ts:27-38` — `zeroTotals`**
  - Initialize `executionCount: 0`.
- **`src/core/loop-run/usage.ts:41-58` — `accumulateInto`**
  - Add `target.executionCount += 1` once per ledger entry.
  - Keep counting entries whose token or cost fields are `null`; they are still executions.
- **`src/core/loop-run/usage.ts:67-93` — `buildUsageSummary`**
  - Existing calls already route each entry to run, optional issue, and phase buckets, so one increment in `accumulateInto` updates all applicable buckets.

### Live Ink projection

The UI maintains committed usage separately from ephemeral streaming usage:

- Committed entries use `accumulateUsage` (`src/core/loop-run/ink-worker-projection.ts:52-64`).
- Streaming usage uses `accumulateStreamingUsage` (`src/core/loop-run/ink-worker-projection.ts:66-78`).
- `displayRunUsage` combines only streaming values (`src/core/loop-run/ink-worker-projection.ts:253-264`).

Required edits:

- **`src/core/loop-run/ink-worker-projection.ts:29-40` — `zeroUsageTotals`**
  - Initialize `executionCount: 0`.
- **`accumulateUsage` at lines 52-64**
  - Return `executionCount: target.executionCount + 1`.
- **`accumulateStreamingUsage` at lines 66-78**
  - Preserve `target.executionCount`; do not increment it.
  - This ensures in-progress usage cannot inflate execution counts.
- **`displayRunUsage` at lines 253-264**
  - No counting logic should be added; its result should remain count `0` for streaming-only usage.
- **`formatDisplayCost` at lines 292-295**
  - Add average-cost formatting using committed `worker.usage.executionCount`.
  - Streaming cost may be shown as a transient total, but must not be included in the denominator.

### UI display

- **`src/core/loop-run/ink-view.ts:87-104` — `renderRunUsageLines`**
  - Show committed total cost and average cost per execution.
  - For in-progress usage, avoid presenting an average based on its count, because streaming totals intentionally have `executionCount === 0`.
- **`src/core/loop-run/ink-view.ts:356-362` — selected-worker usage**
  - Display total and average cost for the selected worker.
- **`src/core/loop-run/ink-state.ts:262-265` — `formatUsageCost`**
  - Either extend this formatter or add a dedicated average formatter.
  - Unknown cost should remain `"unknown"`.
  - Zero executions should render a non-misleading value such as `"n/a"` rather than dividing by zero.

### Persistence compatibility

- **`src/core/utils/loop-run-tracker.ts:46-58` — `normalizeRunSnapshot`**
  - Existing persisted snapshots may contain `usageSummary` objects without `executionCount`.
  - Recommended: recompute `usageSummary` from `usageLedger` during normalization, or explicitly backfill all buckets from the ledger.
  - This is an inferred compatibility requirement; current code only normalizes task fields and returns persisted usage summaries unchanged.

### Documentation

- **`docs/adr/0009-inline-usage-ledger-in-loop-run-tracker.md:30`**
  - Update the Usage Summary contract to document `executionCount` and clarify that it counts ledger-backed executions, including entries with unknown usage, but excludes streaming state.
- **`docs/adr/0016-single-interactive-ui-boundary-for-loop-runs.md:27-29`**
  - Optionally document that the dashboard exposes total and average cost.

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| `UsageTotals` currently has no execution count | `UsageTotals` | `src/core/loop-run/state.ts:244-254` |
| Durable summaries contain run, issue, and phase buckets | `UsageSummary` | `src/core/loop-run/state.ts:256-260` |
| Ledger entries represent executions and have monotonic IDs | `UsageLedgerEntry` | `src/core/loop-run/state.ts:233-242` |
| Each recorded execution appends one ledger entry and recomputes summary | `LoopRun.recordUsage` | `src/core/loop-run/loop-run.ts:484-533` |
| Durable summary aggregation is centralized in `accumulateInto` | `accumulateInto` | `src/core/loop-run/usage.ts:41-58` |
| Run, issue, and phase buckets all call the same accumulator | `buildUsageSummary` | `src/core/loop-run/usage.ts:67-93` |
| Ink committed usage increments through `accumulateUsage` | `accumulateUsage` | `src/core/loop-run/ink-worker-projection.ts:52-64` |
| Streaming usage is accumulated separately | `accumulateStreamingUsage` | `src/core/loop-run/ink-worker-projection.ts:66-78` |
| Streaming usage is displayed without mutating committed totals | `displayRunUsage` | `src/core/loop-run/ink-worker-projection.ts:253-264` |
| Run UI currently displays only total cost | `renderRunUsageLines` | `src/core/loop-run/ink-view.ts:87-104` |
| Worker UI currently displays only total cost | selected-worker render | `src/core/loop-run/ink-view.ts:356-362` |
| Existing formatter only formats total cost | `formatUsageCost` | `src/core/loop-run/ink-state.ts:262-265` |
| Empty-summary tests use exact object equality | `buildUsageSummary` test | `test/usage.test.ts:23-36` |
| Tracker initialization tests use exact nested totals | tracker initialization test | `test/loop-run-tracker.test.ts:58-136` |
| UI tests assert current cost-only output | Ink UI test | `test/ink-ui.test.ts:121-147` |
| Streaming/committed separation is already tested | Ink projection tests | `test/ink-state.test.ts:270-337` |

## 4. Tests and documentation

Tests expected to break or require updates:

- `test/usage.test.ts:23-36` — exact empty `UsageTotals` object.
- `test/usage.test.ts:134-143` — live-steering expected totals should include count.
- `test/loop-run-tracker.test.ts:58-136` — exact initialization snapshot.
- `test/loop-run-tracker.test.ts:150-223` and later explicit `usageSummary` fixtures — add `executionCount` to all manually constructed totals.
- `test/ink-ui.test.ts:121-147` — update cost-only assertions to include average cost if output changes.
- `test/ink-state.test.ts:270-337` — update committed and streaming expectations where full totals are asserted.

New tests:

- Empty ledger yields `executionCount: 0` in run and every phase bucket.
- Two ledger entries produce run count `2`.
- Issue bucket counts only entries for that issue.
- Phase bucket counts entries for that phase.
- Entries with `null` cost/tokens still increment count.
- Entries without `issueId` count in run and phase, but not `byIssue`.
- Streaming accumulation leaves `executionCount` unchanged.
- `displayRunUsage` reports count `0` for streaming-only usage.
- Average cost is `total cost / executionCount`.
- Average cost is not shown or is `"n/a"` when count is zero.
- Unknown cost remains `"unknown"` even when execution count is nonzero.
- Legacy persisted snapshots are normalized/recomputed with counts, if compatibility handling is added.

## 5. Uncertainties

- Whether average cost should be shown for worker rows, run summary, or both; current UI has both cost locations.
- Exact desired zero-count rendering (`"n/a"`, `"$0.00"`, or omission) is unspecified.
- The tracker currently has no explicit schema migration. Recomputing summaries during `normalizeRunSnapshot` is the safest compatibility behavior, but this is an inferred requirement.
