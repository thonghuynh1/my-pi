# Blinded reviewer packet

# Blinded answer-quality rubric (10 points)

Score each anonymized final answer before seeing method labels or usage/cost data. Use five dimensions worth 0–2 points each.

1. **Factual correctness (0–2)**
   - 0: materially wrong or unsafe.
   - 1: mostly correct with one meaningful error or unsupported claim.
   - 2: correct, precise, and no material contradictions.
2. **Scenario completeness (0–2)**
   - 0: misses most requested parts.
   - 1: covers the main path but misses at least one important requested branch/invariant.
   - 2: covers every explicit part of the question at useful depth.
3. **Evidence and traceability (0–2)**
   - 0: little/no verifiable repository evidence.
   - 1: useful symbols/files but some broad, inaccurate, or missing locations.
   - 2: claims consistently tied to accurate symbols and file:line evidence.
4. **Cross-boundary reasoning (0–2)**
   - 0: isolated file summary with no coherent relationships.
   - 1: generally coherent flow/impact with some weak transitions.
   - 2: accurately explains ordering, ownership, data flow, invariants, and conditional branches.
5. **Tests, safety, and actionable guidance (0–2)**
   - 0: omits relevant tests/safety consequences or gives unusable guidance.
   - 1: identifies major tests/risks but misses meaningful coverage.
   - 2: identifies relevant existing/new tests, failure/safety behavior, and concrete guidance appropriate to the scenario.

Record one integer per dimension and a total out of 10. Add a short justification. Do not infer or guess the discovery method.


---

# Answer A01

**Scenario:** impact


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



---

# Answer A02

**Scenario:** impact


## 1. Executive summary

The repository could not be inspected because the repository index service was unavailable. No reliable file, symbol, line, test, or documentation evidence was obtained.

## 2. Detailed flow / architecture / impact analysis

Insufficient evidence to identify:

- `UsageTotals` definition and all consumers.
- `UsageLedgerEntry` creation, persistence, and replay.
- Run, issue, and phase accumulation functions.
- Streaming usage accumulation paths.
- UI average-cost calculations.
- Exact files and symbols requiring edits.

Any implementation guidance without these references would be speculative.

## 3. Evidence table

| Claim | Symbol | File:line |
|---|---|---|
| No repository evidence was available | — | — |

## 4. Tests and documentation

Unable to identify existing tests that would break or the appropriate test files for:

- `executionCount` shape/type expectations.
- Run, issue, and phase ledger aggregation.
- Exclusion of streaming usage from counts.
- Average cost per execution UI behavior.

## 5. Uncertainties

The requested impact analysis remains incomplete because repository inspection was unavailable.



---

# Answer A03

**Scenario:** lifecycle


## 1. Executive summary

Insufficient repository evidence was available to reconstruct the stale-run recovery lifecycle or provide the required exact file-and-line citations.

## 2. Detailed flow / architecture / impact analysis

No verified implementation details could be retrieved. Therefore, the availability rules for recovery actions, crash-rule normalization, resume-plan construction, tracker ownership, Force-Kill Undo handling, and merge-phase safety checks remain unconfirmed.

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| No claims could be directly verified. | — | — |

## 4. Tests and documentation

No tests or documentation could be verified.

## 5. Uncertainties

The repository evidence needed for this investigation was unavailable, so supplying implementation claims or citations would risk fabrication.



---

# Answer A04

**Scenario:** architecture


## 1. Executive summary

The implemented pipeline is:

`runAgentExecution()` → `runVerification()` parses stdout → `TaskPipeline` calls `LoopRun.recordCriterionVerdicts()` → criterion evidence is artifact-written and tracker-persisted.

The pipeline **does not emit a criterion-verdict fact event** and the Live Dashboard has **no criterion-verdict projection**. Dashboard updates occur only for task phases, metadata, and usage. Therefore, requirements (c) and (d) are not currently implemented.

Task completion is protected against missing overall verdicts and verifier execution errors, but **not against a malformed/partial criterion set accompanied by `<verdict>PASS</verdict>`**: `v.passed` depends only on the overall tag.

## 2. Detailed flow / architecture / impact analysis

1. **Raw verifier stdout**
   - `runVerification()` invokes `runAgentExecution()` and assigns `execResult.output` to `raw` (`src/core/actions/verifier.ts:237-241`).
   - The parser extracts `<criterion>` blocks, normalizes invalid statuses to `unmet`, assigns provisional positional IDs, and extracts fenced stdout (`src/core/actions/verifier.ts:66-70`, `src/core/actions/verifier.ts:82-131`).

2. **Overall verdict identification**
   - The overall result is identified by `VERDICT_TAG_PATTERN`, accepting only `PASS` or `FAIL` (`src/core/actions/verifier.ts:46-48`, `src/core/actions/verifier.ts:281-304`).
   - Missing `<verdict>` returns `inconclusive` with `passed: false` (`src/core/actions/verifier.ts:283-301`).
   - If present, `passed` is derived solely from `PASS`, independently of criterion completeness or statuses (`src/core/actions/verifier.ts:304-321`).

3. **Task-pipeline boundary**
   - `TaskPipeline` receives `v.criteria`, stores them through `loopRun.recordCriterionVerdicts()`, and branches on `v.outcome`/`v.passed` (`src/core/utils/task-pipeline.ts:371-390`).
   - Failed or regressed criteria become implementer feedback; statuses `unmet` and `regressed` are explicitly selected (`src/core/utils/task-pipeline.ts:390-408`).

4. **Stable criterion identity**
   - Explicit IDs are retained.
   - Missing IDs are frozen by ordinal in `TaskRecord.criterionIdentities`; later attempts reuse the stored identity (`src/core/loop-run/loop-run.ts:319-345`, `src/core/loop-run/loop-run.ts:619-637`).
   - This is positional stability, not semantic stability: insertion, deletion, or reordering can mismatch criteria, a documented limitation (`docs/adr/0011-stateful-per-criterion-verification-loop.md:23-26`, `:61`).

5. **Durable tracker persistence**
   - `recordCriterionVerdicts()` writes stdout once to `.ralph-loop/criterion-evidence/.../<hash>.txt`, then stores `{id,status,evidenceProse,evidenceRef}` inline in the task record (`src/core/loop-run/loop-run.ts:343-368`, `src/core/loop-run/loop-run.ts:639-666`).
   - The tracker write is performed directly, but this method emits no corresponding event (`src/core/loop-run/loop-run.ts:322-369`).

6. **Fact-event boundary**
   - ADR-0007 requires durable write, then synchronous fact emission (`docs/adr/0007-loop-run-coordinator-and-fact-events.md:17-21`).
   - `recordTaskPhase()` and `recordTaskMeta()` implement that discipline (`src/core/loop-run/loop-run.ts:276-310`).
   - Criterion persistence has no `CriterionVerdictsChangedEvent` in the event union and no `emit()` call (`src/core/loop-run/events.ts:11-78`; `src/core/loop-run/loop-run.ts:322-369`).
   - Consequently, no criterion-verdict fact is emitted.

7. **Live Dashboard projection**
   - Ink state handles `taskPhaseChanged`, `taskMetaChanged`, `usageRecorded`, `streamingUsage`, and `runFinished` (`src/core/loop-run/ink-state.ts:164-204`).
   - Worker rows contain phase, title, timestamps, context, and usage, but no criteria field (`src/core/loop-run/ink-worker-projection.ts:4-24`).
   - Therefore persisted criterion verdicts are not reflected in the Live Dashboard.

8. **Completion safety**
   - Successful completion enters `mark-done-pending`, calls the issue source’s `markDone`, and only then records `done` (`src/core/ralph-loop.ts:526-531`).
   - Interrupted completion marking remains recoverable through `resume-plan.ts`, which retries `markDone` before recording `done` (`src/core/loop-run/resume-plan.ts:47-63`).
   - Failed verification records `failed` and leaves the issue open (`src/core/ralph-loop.ts:532-548`).
   - However, a malformed criterion block can default to `unmet` while an independent overall `PASS` still sets `passed: true`; this can reach `done` (`src/core/actions/verifier.ts:114-131`, `:304-321`; `src/core/ralph-loop.ts:526-531`).

## 3. Evidence table

| Claim | Symbol | File:line |
|---|---|---|
| Agent output becomes raw verifier stdout | `runVerification` | `src/core/actions/verifier.ts:237-241` |
| Criterion tags are parsed and invalid statuses become `unmet` | `parseCriterionVerdicts`, `normalizeCriterionStatus` | `src/core/actions/verifier.ts:82-131` |
| Missing overall verdict fails closed | `runVerification` | `src/core/actions/verifier.ts:283-301` |
| Overall PASS alone controls `passed` | `passed` assignment | `src/core/actions/verifier.ts:304-321` |
| Pipeline persists parsed criteria | `TaskPipeline` verification loop | `src/core/utils/task-pipeline.ts:371-390` |
| Explicit IDs and positional fallback are resolved | `resolveCriterionIdentity` | `src/core/loop-run/loop-run.ts:619-637` |
| Evidence is write-once and referenced | `writeCriterionEvidenceArtifact` | `src/core/loop-run/loop-run.ts:639-666` |
| Criteria are persisted inline | `recordCriterionVerdicts` | `src/core/loop-run/loop-run.ts:322-368` |
| ADR write-then-emit contract | ADR-0007 decision | `docs/adr/0007-loop-run-coordinator-and-fact-events.md:17-21` |
| No criterion event exists | `LoopRunEvent` union | `src/core/loop-run/events.ts:11-78` |
| Dashboard projects phases/meta/usage only | `applyLoopRunEventToInkState` | `src/core/loop-run/ink-state.ts:164-204` |
| Done requires issue marking after verification | `handleTaskCompletion` | `src/core/ralph-loop.ts:526-531` |
| Interrupted completion is retried | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:47-63` |

## 4. Tests and documentation

- Criterion identity freezing and evidence persistence are tested in `test/loop-run.test.ts:400-484`.
- Malformed statuses and missing overall verdicts are tested in `test/verifier.test.ts:121-159`.
- Completion phase ordering is tested in `test/ralph-loop-wiring.test.ts:1460-1490`.
- Recovery of `mark-done-pending` is tested in `test/resume-plan.test.ts` and `test/stale-run-recovery.test.ts:947-...`.
- ADR-0011 specifies fail-closed parsing and durable criterion state (`docs/adr/0011-stateful-per-criterion-verification-loop.md:37-52`), but the implementation does not fully enforce the stated “parse failure can never manufacture a `met`” guarantee when overall `PASS` is present.

## 5. Uncertainties

- The requested criterion fact-event and dashboard projection may be planned but are not present in the current source/event union.
- The verifier prompt may constrain agents to emit complete criterion coverage, but no runtime validation of expected criterion count or required statuses was found.
- The documented fail-closed intent conflicts with the current `passed` calculation; this is an implementation gap rather than an ambiguity in the ADR.



---

# Answer A05

**Scenario:** lifecycle


## 1. Executive summary

On startup, `handleStaleRun()` reads the tracker, rejects an active owner, rejects non-interactive recovery, normalizes crash artifacts, computes valid actions, and executes the developer’s choice. Normal resume cleans interrupted writer phases, validates completed tasks, then adopts the stale tracker’s ownership. `buildResumePlan()` converts persisted tasks into scheduler queues and progress. The resumed `LoopRun` continues writing the same tracker with monotonically increasing revisions and emits subscriber facts only after durable writes.

## 2. Detailed flow / architecture / impact analysis

1. **Detection and action selection**
   - `LoopRunTracker.isStale()` considers a run stale if the owner PID is dead or the heartbeat is older than 30 seconds; otherwise startup aborts because another loop is active. `src/core/utils/loop-run-tracker.ts:147-169`
   - Non-TTY startup fails rather than choosing a recovery action implicitly. `src/core/utils/stale-run-recovery.ts:400-418`
   - `StaleRun.getAvailableActions()` normally offers:
     - `resume`: always available for an ordinary stale run.
     - `rollback`: available only when `rollbackSnapshotId` exists.
     - `abandon` and `cancel`: always available.
     `src/core/utils/stale-run-recovery.ts:125-146`
   - A missing rollback snapshot disables loop-start rollback but does not disable tracker-based resume. `CONTEXT.md:84-86`; `docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:45-46`

2. **Crash normalization**
   - `handleStaleRun()` calls `staleRun.normalizeCrashRules()` after stale detection and before presenting choices. `src/core/utils/stale-run-recovery.ts:421-433`
   - It detects any live-steering record still in `submitted`, calls `tracker.normalizeLiveSteeringPostCrash()`, and refreshes its in-memory state. `src/core/utils/stale-run-recovery.ts:153-166`
   - `normalizeSteeringPostCrash()` changes `submitted` to `unknown-after-crash` and preserves terminal statuses. `src/core/loop-run/state.ts:112-123`

3. **Resume preparation**
   - `resume` first calls `prepareResume()`, then adopts tracker ownership. `src/core/utils/stale-run-recovery.ts:278-302`
   - Interrupted implementation is discarded at the task-worktree boundary. `src/core/utils/stale-run-recovery.ts:311-319`, `463-466`
   - Interrupted merge is aborted, requires a clean primary workspace, resets to `preMergeHead`, and removes the task worktree. `src/core/utils/stale-run-recovery.ts:320-323`, `468-501`
   - Verification, completion marking, and interrupted/failed/blocked whole-run review are retried rather than trusted as complete. `src/core/utils/stale-run-recovery.ts:325-356`
   - A task marked `done` is trusted only when its `integratedHead` remains reachable from `HEAD`; otherwise the developer chooses restart or trust. `src/core/utils/stale-run-recovery.ts:334-355`

4. **Resume-plan translation**
   - `ralphLoop()` creates a `LoopRun`, calls `startOrResume()`, then builds the scheduler plan. `src/core/ralph-loop.ts:343-386`
   - `buildResumePlan()`:
     - Adds `done` tasks to `terminalIds`.
     - For `mark-done-pending`, calls `isDone()` when available, otherwise calls `markDone()` with the persisted issue data, then durably records `done`.
     - Re-reads the tracker after those writes.
     - Places all non-terminal, non-`mark-done-pending` tasks into `replayQueue`.
     - Restores `iterationsStarted` and `skippedIds`.
     `src/core/loop-run/resume-plan.ts:31-75`
   - `failed` tasks are not added to the non-retryable terminal set, so they remain eligible for scheduler handling according to normal retry rules. `src/core/loop-run/resume-plan.ts:76-84`

5. **Sole tracker ownership and event ordering**
   - `adoptOwnership()` updates the existing tracker in place, setting status to `running`, the new PID, and a fresh heartbeat. `src/core/utils/loop-run-tracker.ts:147-158`
   - Every tracker update increments `revision` from the current revision and atomically replaces the active file. `src/core/utils/loop-run-tracker.ts:128-145`, `334-349`
   - `LoopRun` is explicitly the sole authoritative writer; subscribers are invoked synchronously, in registration order, only after the durable write succeeds. `src/core/loop-run/loop-run.ts:5-7`, `76-90`
   - Phase writes precede `taskPhaseChanged` emission; failed writes emit no event. `src/core/loop-run/loop-run.ts:276-300`
   - Thus the resumed process keeps the same logical run/tracker, writes first, advances revisions monotonically, and only then informs observers.

6. **Partial Force-Kill Undo**
   - A tracker with `panicUndo` in any phase other than `rollback-completed` is treated specially; normal `resume` is removed. `src/core/utils/stale-run-recovery.ts:107-123`, `125-146`
   - `finishRollback` is offered only when:
     - `panicUndo.phase === "processes-drained"`, and
     - a rollback snapshot exists.
     `src/core/utils/stale-run-recovery.ts:115-123`
   - It requires confirmation, adopts the snapshot, reruns rollback, records rollback progress, cleans workspace state, and archives the run as interrupted only after success. A failed attempt records `rollback-failed` and leaves the tracker active. `src/core/utils/stale-run-recovery.ts:218-276`
   - This prevents treating an incompletely drained/destructive undo as an ordinary resumable stale run. `docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:80-86`

7. **Dirty merge safety check**
   - Before resetting to `preMergeHead`, `prepareMergingResume()` aborts any merge in progress and loops while `git.isDirty()`. It refuses to reset over uncommitted primary-workspace edits, requiring cleanup/retry or abandonment. `src/core/utils/stale-run-recovery.ts:468-501`
   - Non-interactive mode throws immediately rather than making that destructive choice automatically. `src/core/utils/stale-run-recovery.ts:485-488`
   - This directly implements the ADR’s manual-edit protection rule. `docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:49-50`

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| Stale means dead owner or expired heartbeat | `isStale` | `src/core/utils/loop-run-tracker.ts:147-169` |
| Recovery is blocked without interactive input | `handleStaleRun` | `src/core/utils/stale-run-recovery.ts:400-418` |
| Ordinary action availability depends on snapshot presence | `getAvailableActions` | `src/core/utils/stale-run-recovery.ts:125-146` |
| Crash-submitted steering becomes unknown | `normalizeCrashRules`, `normalizeSteeringPostCrash` | `src/core/utils/stale-run-recovery.ts:153-166`; `src/core/loop-run/state.ts:112-123` |
| Resume cleans interrupted implementation and merge phases | `prepareResume` | `src/core/utils/stale-run-recovery.ts:311-323` |
| Merge recovery requires a clean primary workspace | `prepareMergingResume` | `src/core/utils/stale-run-recovery.ts:478-501` |
| `mark-done-pending` is completed before queue construction | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:31-75` |
| Scheduler progress is restored from persisted state | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:65-75` |
| Resumed process adopts existing tracker ownership | `adoptOwnership` | `src/core/utils/loop-run-tracker.ts:147-158` |
| Revisions are monotonic and writes are atomic | `update`, `atomicWrite` | `src/core/utils/loop-run-tracker.ts:128-145`, `334-349` |
| Subscribers observe only durable facts, in order | `subscribe`, `emit` | `src/core/loop-run/loop-run.ts:76-90`, `607-610` |
| Partial panic undo blocks normal resume | `isPartialPanicUndo`, `getAvailableActions` | `src/core/utils/stale-run-recovery.ts:107-146` |
| Finish Rollback requires drained processes and a snapshot | `canFinishRollback` | `src/core/utils/stale-run-recovery.ts:115-123` |
| Failed Finish Rollback remains recoverable | `execute("finishRollback")` | `src/core/utils/stale-run-recovery.ts:218-276` |

## 4. Tests and documentation

- Action availability and partial panic-undo rules: `test/stale-run-recovery.test.ts:81-114`, `1234-1377`
- Finish Rollback success/failure behavior: `test/stale-run-recovery.test.ts:1391-1485`
- Dirty merge recovery: `test/stale-run-recovery.test.ts:673-712`; `test/recovery-integration.test.ts:277-330`
- `mark-done-pending` resume behavior: `test/resume-plan.test.ts:16-99`
- Durable recovery contract and safety rationale: `docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:11-86`
- Single-writer and subscriber architecture: `CONTEXT.md:60-66`

## 5. Uncertainties

- The exact scheduler behavior after `buildResumePlan()` consumes `replayQueue` is outside the inspected resume-plan implementation; the plan’s outputs are directly evidenced.
- `rollbackDisabled` is returned as recovery metadata, while actual action availability is determined by `getAvailableActions()` and snapshot presence.



---

# Answer A06

**Scenario:** architecture


## 1. Executive summary

Unable to establish the requested pipeline because repository evidence was unavailable.

## 2. Detailed flow / architecture / impact analysis

No verified flow, module boundaries, persistence points, event emission, dashboard projection, or malformed-result safeguards could be established.

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| No claims could be verified | — | — |

## 4. Tests and documentation

No tests or documentation could be verified.

## 5. Uncertainties

The repository index was unavailable, so all requested architectural details remain undetermined.



---

# Answer A07

**Scenario:** impact


## 1. Executive summary

Unable to complete the impact analysis because repository access was unavailable.

## 2. Detailed flow / architecture / impact analysis

No symbols, data flow, or affected files could be verified.

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| No claims verified | — | — |

## 4. Tests and documentation

No tests or documentation could be inspected.

## 5. Uncertainties

The repository index/service did not respond, so all requested edit guidance and test-impact analysis remain undetermined.



---

# Answer A08

**Scenario:** architecture


## 1. Executive summary

The implemented pipeline is:

`verifier stdout → runVerification() parser → TaskPipeline → LoopRun.recordCriterionVerdicts() → atomic tracker state`

The requested later stages do **not currently exist** for per-criterion verdicts:

- `recordCriterionVerdicts()` persists criteria but emits no criterion-specific fact event.
- `LoopRunEvent` has no criterion-verdict event.
- `ink-worker-projection.ts` has no criterion field or reducer.
- The Live Dashboard therefore reflects verification indirectly through phase/meta events, not verdicts themselves.

Malformed or crashed verification cannot mark a task done: malformed statuses normalize to `unmet`; missing overall verdict is `inconclusive`; execution errors retry once and then fail closed.

## 2. Detailed flow / architecture / impact analysis

1. **Raw stdout acquisition**  
   `runVerification()` calls `runAgentExecution()` and assigns `execResult.output` to `raw` (`src/core/actions/verifier.ts:234-239`).

2. **Criterion parsing and stable identification**  
   `parseCriterionVerdicts(raw)` scans `<criterion>` blocks, extracts attributes/evidence, assigns temporary positional IDs (`criterion-1`, etc.), and normalizes unknown statuses to `unmet` (`src/core/actions/verifier.ts:83-87,114-136`).  
   Explicit IDs are retained; missing IDs initially receive positional ordinals (`src/core/actions/verifier.ts:120-133`).

3. **Overall verdict validation**  
   A separate `<verdict>PASS|FAIL</verdict>` tag is required. Missing tags produce `inconclusive` with `passed: false` (`src/core/actions/verifier.ts:281-300`).

4. **Pipeline handoff**  
   `TaskPipeline` receives the structured result and invokes `loopRun.recordCriterionVerdicts(issue.id, v.criteria)` (`src/core/utils/task-pipeline.ts:370-379`).

5. **Durable Loop Run persistence**  
   `LoopRun.recordCriterionVerdicts()` reads the current task, resolves each identity, writes captured stdout to an evidence artifact, and stores `{id,status,evidenceProse,evidenceRef}` in the task record (`src/core/loop-run/loop-run.ts:322-358`).  
   Identity stability is enforced by:
   - preserving explicit IDs;
   - freezing missing IDs by ordinal in `criterionIdentities`;
   - reusing the frozen ordinal identity on later attempts;
   - never hashing criterion text (`src/core/loop-run/loop-run.ts:619-636`).  
   The tracker update increments revision and atomically replaces the state file via temp-file write and rename (`src/core/utils/loop-run-tracker.ts:133-145,375-390`).

6. **ADR-0007 write-then-emit discipline**  
   The general coordinator contract is write first, then synchronously emit facts; failed writes emit nothing (`src/core/loop-run/loop-run.ts:276-280`, `src/core/loop-run/events.ts:4-9`).  
   However, `recordCriterionVerdicts()` performs the tracker update and returns without calling `emit()` (`src/core/loop-run/loop-run.ts:358-369`). Thus no criterion-verdict fact is currently emitted.

7. **Live Dashboard projection**  
   Ink consumes subscribed `LoopRunEvent`s through `applyLoopRunEventToInkState()` (`src/core/loop-run/ink-ui.ts:206-210`). The worker projection handles only task phase, task metadata, usage, and streaming usage (`src/core/loop-run/ink-state.ts:167-192`). `WorkerDashboardRow` contains no criterion verdict data (`src/core/loop-run/ink-worker-projection.ts:5-20`). Therefore persisted per-criterion verdicts are not reflected in the worker projection.

8. **Protection against false completion**  
   `TaskPipeline` sets `verified = true` only when `v.passed` is true; otherwise it records failure after attempts are exhausted (`src/core/utils/task-pipeline.ts:383-418`).  
   - Unknown criterion statuses become `unmet` (`src/core/actions/verifier.ts:83-87`).
   - Missing overall verdict becomes `inconclusive` and fails (`src/core/actions/verifier.ts:283-300`).
   - Execution failure becomes `errored`; after one retry, the pipeline breaks and fails closed (`src/core/utils/task-pipeline.ts:375-381`).
   - A crashed verifier returns `passed: false` (`src/core/actions/verifier.ts:243-278`).

## 3. Evidence table

| Claim | Symbol | File:line |
|---|---|---|
| Verifier stdout becomes `raw` | `runVerification` | `src/core/actions/verifier.ts:234-239` |
| Criterion blocks are parsed from stdout | `parseCriterionVerdicts` | `src/core/actions/verifier.ts:114-136` |
| Malformed statuses default to `unmet` | `normalizeCriterionStatus` | `src/core/actions/verifier.ts:83-87` |
| Missing overall verdict is inconclusive | `runVerification` | `src/core/actions/verifier.ts:281-300` |
| Pipeline forwards criteria to Loop Run | `TaskPipeline.run` | `src/core/utils/task-pipeline.ts:370-379` |
| Criteria are persisted in task state | `recordCriterionVerdicts` | `src/core/loop-run/loop-run.ts:322-358` |
| Explicit IDs and frozen ordinal IDs are resolved | `resolveCriterionIdentity` | `src/core/loop-run/loop-run.ts:619-636` |
| Tracker writes are revisioned and atomic | `update`, `atomicWrite` | `src/core/utils/loop-run-tracker.ts:133-145,375-390` |
| Fact events are emitted after durable writes | `LoopRun` contract | `src/core/loop-run/loop-run.ts:276-280` |
| No criterion event exists in event union | `LoopRunEvent` | `src/core/loop-run/events.ts:122-139` |
| Dashboard handles phase/meta/usage, not criteria | `applyLoopRunEventToInkState` | `src/core/loop-run/ink-state.ts:167-192` |
| Verifier errors fail closed after one retry | `TaskPipeline.run` | `src/core/utils/task-pipeline.ts:375-381` |

## 4. Tests and documentation

- Parser tests cover explicit criterion parsing, malformed status fallback, missing overall verdict, and explicit IDs (`test/verifier.test.ts:97-179`).
- Persistence tests cover frozen positional identities and evidence artifact references (`test/loop-run.test.ts:400-490`).
- ADR-0011 specifies stable criterion identity, fail-closed parsing, durable tracker persistence, and bounded verifier retry (`docs/adr/0011-stateful-per-criterion-verification-loop.md`).
- ADR-0007 specifies sole-writer and write-then-emit semantics (`docs/adr/0007-loop-run-coordinator-and-fact-events.md`).

## 5. Uncertainties

- The intended criterion-verdict fact event and Dashboard criterion projection may be planned work, but no implementation evidence exists in the current source.
- ADR-0007 allows finer-grained events when needed, but the current event vocabulary deliberately contains only lifecycle-level events (`docs/adr/0007-loop-run-coordinator-and-fact-events.md`).



---

# Answer A09

**Scenario:** architecture


## 1. Executive summary

The implemented pipeline stops short of the requested end-to-end flow:

- Raw verifier stdout is returned by `runAgentExecution()` and parsed by `runVerification()`.
- `TaskPipeline.executeTask()` passes parsed criteria to `LoopRun.recordCriterionVerdicts()`.
- `LoopRun` persists criteria and evidence atomically, with stable criterion identities.
- No per-criterion fact event is emitted.
- The Live Dashboard projection only consumes phase, metadata, usage, and log events; it has no criterion-verdict projection.
- A task reaches `done` only after an explicit verifier `PASS`, successful issue-source completion marking, and a durable `mark-done-pending → done` transition.

## 2. Detailed flow / architecture / impact analysis

1. **Agent boundary — raw stdout**
   - `runAgentExecution()` delegates to the configured agent client and returns its output string (`src/core/runs/runner.ts:92-115`).
   - `runVerification()` stores that output as `raw` and parses `<criterion>` blocks using `parseCriterionVerdicts()` (`src/core/actions/verifier.ts:234-281`).

2. **Verifier parsing and stability**
   - Criterion attributes are parsed from `id` and `status`; invalid statuses normalize to `unmet` (`src/core/actions/verifier.ts:114-149`).
   - Missing IDs initially receive ordinal IDs such as `criterion-1` (`src/core/actions/verifier.ts:114-149`).
   - Explicit IDs are preserved. During persistence, `LoopRun.resolveCriterionIdentity()` replaces positional identities only when an explicit ID exists; otherwise it reuses the prior identity for that ordinal, or freezes `criterion-{ordinal}` on first observation (`src/core/loop-run/loop-run.ts:619-636`).
   - This prevents wording changes between attempts from changing criterion identity.

3. **Task-pipeline boundary**
   - After verification, `TaskPipeline.executeTask()` stores `v.criteria` and calls `loopRun.recordCriterionVerdicts(issue.id, v.criteria)` (`src/core/utils/task-pipeline.ts:371-378`).
   - Verifier execution errors are retried once. A second error breaks without setting `verified`; malformed output without a verdict tag yields `inconclusive` and `passed: false` (`src/core/actions/verifier.ts:281-312`; `src/core/utils/task-pipeline.ts:375-385`).

4. **Tracker persistence boundary**
   - `recordCriterionVerdicts()` resolves stable IDs, writes non-empty criterion stdout to an evidence artifact, then updates the task’s inline `criteria` and `criterionIdentities` via `tracker.update()` (`src/core/loop-run/loop-run.ts:322-362`).
   - Evidence paths are content-hash-based and written using temp-file-plus-rename (`src/core/loop-run/loop-run.ts:639-672`).
   - `LoopRunTracker.update()` increments the revision and performs the atomic state write (`src/core/utils/loop-run-tracker.ts:121-134`).
   - This satisfies write-before-use for persisted criterion state, but `recordCriterionVerdicts()` does **not** emit a corresponding fact event.

5. **ADR-0007 event boundary**
   - ADR-0007 requires the coordinator to write durably first, then synchronously emit facts (`docs/adr/0007-loop-run-coordinator-and-fact-events.md:17-21`).
   - `recordTaskPhase()` implements that discipline: tracker writes occur before `emit()` (`src/core/loop-run/loop-run.ts:275-300`).
   - Criterion persistence has no event type in `LoopRunEvent` and no `emit()` call (`src/core/loop-run/loop-run.ts:322-362`; `src/core/loop-run/events.ts:27-81`).
   - Therefore there is no emitted per-criterion fact for downstream subscribers.

6. **Completion boundary**
   - The scheduler records `mark-done-pending`, calls `issueSource.markDone()`, and records `done` only after that call succeeds (`src/core/ralph-loop.ts:541-548`).
   - Verification failure records `failed`, not `done` (`src/core/ralph-loop.ts:548-557`).
   - Thus a malformed or crashed verifier cannot silently mark a task done through the normal path: missing verdicts and execution errors produce `passed: false`, and completion requires explicit `PASS`.

7. **Dashboard boundary**
   - `applyLoopRunEventToInkState()` handles phase, metadata, usage, streaming usage, and log-related events, but no criterion event (`src/core/loop-run/ink-state.ts:161-192`).
   - `WorkerDashboardRow` contains phase, title, timestamps, and usage only; it has no criterion/verdict field (`src/core/loop-run/ink-worker-projection.ts:8-28`).
   - Consequently, persisted criterion verdicts are not reflected in the Live Dashboard worker projection. Only the resulting phase transition, such as `verifying`, `failed`, or `done`, is visible.

## 3. Evidence table

| Claim | Symbol | File:line |
|---|---|---|
| Agent output becomes a returned stdout string | `runAgentExecution` | `src/core/runs/runner.ts:92-115` |
| Verifier parses raw output into criterion records | `runVerification`, `parseCriterionVerdicts` | `src/core/actions/verifier.ts:234-312` |
| Invalid criterion status defaults to `unmet` | `normalizeCriterionStatus` | `src/core/actions/verifier.ts:114-149` |
| Parsed criteria enter Loop Run persistence | `executeTask` | `src/core/utils/task-pipeline.ts:371-378` |
| Positional criterion identities are frozen across attempts | `resolveCriterionIdentity` | `src/core/loop-run/loop-run.ts:619-636` |
| Criterion stdout is written before tracker state update | `recordCriterionVerdicts` | `src/core/loop-run/loop-run.ts:322-362` |
| Evidence writes use temp file plus rename | `writeCriterionEvidenceArtifact` | `src/core/loop-run/loop-run.ts:639-672` |
| Tracker updates are revisioned and atomically written | `LoopRunTracker.update` | `src/core/utils/loop-run-tracker.ts:121-134` |
| ADR requires write-then-emit | ADR-0007 decision | `docs/adr/0007-loop-run-coordinator-and-fact-events.md:17-21` |
| Criterion verdicts have no fact event | `LoopRunEvent` | `src/core/loop-run/events.ts:27-81` |
| Dashboard consumes phase/metadata/usage, not criteria | `applyLoopRunEventToInkState` | `src/core/loop-run/ink-state.ts:161-192` |
| Worker projection has no criterion state | `WorkerDashboardRow` | `src/core/loop-run/ink-worker-projection.ts:8-28` |
| Done requires pending phase, source marking, then done phase | scheduler completion path | `src/core/ralph-loop.ts:541-548` |

## 4. Tests and documentation

- Verifier parsing, malformed statuses, missing verdicts, and explicit IDs: `test/verifier.test.ts:98-179`.
- Stable positional identities and evidence references: `test/loop-run.test.ts:400-483`.
- ADR-0007 documents sole-writer and write-then-emit semantics: `docs/adr/0007-loop-run-coordinator-and-fact-events.md:17-21`.
- The tests validate persistence and identity stability, but do not demonstrate a per-criterion fact event or dashboard criterion projection.

## 5. Uncertainties

- The verifier source comment says execution errors “fail open,” but the current implementation returns `passed: false` and the task pipeline fails closed after the bounded retry (`src/core/actions/verifier.ts:58-66`; `src/core/utils/task-pipeline.ts:375-385`).
- The requested criterion-event/dashboard stages may be planned functionality rather than an implemented path; current source evidence shows they do not exist.



---

# Answer A10

**Scenario:** impact


## 1. Executive summary

Unable to complete the impact analysis because repository access was unavailable.

## 2. Detailed flow / architecture / impact analysis

No repository evidence could be obtained. Therefore, affected symbols, files, and required edits cannot be identified reliably.

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| No claims verified | — | — |

## 4. Tests and documentation

Unable to inspect existing tests or documentation.

## 5. Uncertainties

- Repository indexing/access was unavailable.
- No files were modified.



---

# Answer A11

**Scenario:** lifecycle


## 1. Executive summary

On startup, `handleStaleRun()` reads the active tracker, rejects live ownership, requires interactive input for stale recovery, normalizes crash-only state, and offers actions based on tracker state. A normal stale run can resume, rollback if a snapshot exists, abandon, or cancel. A partially completed Force-Kill Undo is restricted to Finish Rollback, abandon, or cancel.

For resume, recovery first repairs unsafe workspace boundaries, then adopts the existing tracker ownership. `ralphLoop()` constructs a `LoopRun` over that same tracker, builds scheduler state from persisted tasks, and thereafter routes durable lifecycle writes through `LoopRun`, which writes atomically before synchronously notifying subscribers.

## 2. Detailed flow / architecture / impact analysis

1. **Detection and action selection**
   - `handleStaleRun()` proceeds if no tracker exists; aborts if the owner is still active; and fails fast without a TTY rather than selecting a default recovery action. `StaleRun.fromTracker()` confirms staleness using owner PID and heartbeat.
   - For an ordinary stale run, actions are `resume`, `abandon`, and `cancel`; `rollback` is inserted only when `rollbackSnapshotId` exists. Missing snapshots therefore disable loop-start rollback but do not inherently prevent tracker-based resume.
   - For a partial panic undo, `resume` and ordinary `rollback` are not offered. The choices are `abandon` and `cancel`, plus `finishRollback` only when the panic-undo phase is `processes-drained` and a rollback snapshot exists.
   - `cancel` aborts startup. `abandon` archives the stale tracker and permits a fresh run. `rollback` restores the snapshot, archives the tracker, cleans workspaces, and starts fresh.

2. **Crash normalization**
   - `normalizeCrashRules()` scans task live-steering records for `submitted` entries. If any exist, it calls `normalizeLiveSteeringPostCrash()`, which changes those records to `unknown-after-crash` while preserving terminal records.
   - This occurs in `handleStaleRun()` after stale detection and before available actions are calculated or prompted. The normalization itself is persisted through the tracker’s normal revisioned atomic update.

3. **Resume preparation**
   - `prepareResume()` handles persisted phases:
     - `implementing`: deletes/recreates the task worktree boundary.
     - `merge-pending`/`merging`: aborts an in-progress merge, requires a clean primary workspace, resets to `preMergeHead`, and cleans the task worktree.
     - `verify-pending`/`verifying`: leaves the task for verification replay.
     - `mark-done-pending`: leaves completion marking to the resume plan.
     - `done`: validates `integratedHead` remains reachable from `HEAD`; the developer may trust it or restart the task.
     - interrupted or failed whole-run review is rerun.
   - After preparation succeeds, `execute("resume")` calls `tracker.adoptOwnership()`, changing status to `running`, replacing the owner PID/heartbeat, and incrementing the tracker revision.

4. **Persisted task table to scheduler state**
   - `buildResumePlan()` initially places `done` tasks in `terminalIds`.
   - For every `mark-done-pending` task, it calls `issueSource.isDone()` when available. If incomplete, it retries `markDone()` using the persisted issue ID, title, and body; then records the durable phase transition to `done` and adds the issue to `terminalIds`.
   - It rereads the tracker after those writes. All nonterminal tasks become `replayQueue`; scheduler iteration count and skipped IDs come from the refreshed persisted scheduler snapshot. Thus failed tasks are replayable, while completed tasks are terminal.

5. **Sole tracker ownership and event ordering**
   - The resumed process creates `LoopRun` with the existing `LoopRunTracker`, then calls `startOrResume()`. Existing rollback snapshots are adopted rather than creating a new run snapshot.
   - Tracker updates increment `revision` from the current value and use temporary-file write plus rename replacement. This preserves monotonic, crash-safe state.
   - `LoopRun` is the authoritative lifecycle writer. Its phase/meta operations persist through the tracker first, and emit events only after the write succeeds. Subscribers execute synchronously in registration order, so observers cannot precede durable state.
   - The scheduler then operates using `replayQueue`, `terminalIds`, restored iteration count, and restored skipped IDs while the same logical tracker continues advancing.

6. **Partial Force-Kill Undo and Finish Rollback**
   - A panic-undo record whose phase is not `rollback-completed` represents an unfinished destructive transaction, not ordinary stale work; resuming tasks could conflict with live writers or leave repository state ambiguous.
   - Finish Rollback requires explicit confirmation, `panicUndo.phase === "processes-drained"`, and a recorded rollback snapshot. It adopts and executes the snapshot rollback, records rollback failure if needed, or records `rollback-completed`, marks the run interrupted with reason `panic-undo`, and archives it.
   - The tracker records panic-undo facts durably before corresponding Loop Run events in normal Loop Run operation.

7. **Dirty primary workspace safety gate**
   - Merge recovery first aborts any in-progress merge, then checks `git.isDirty()`. Uncommitted primary-workspace changes block recovery because resetting to `preMergeHead` could overwrite developer edits.
   - Interactive recovery offers retry after the workspace is cleaned or abandon. Non-interactive recovery throws immediately.

## 3. Evidence table

| Claim | Symbol | File:line |
|---|---|---|
| Stale detection rejects live ownership and requires interactive recovery | `handleStaleRun` | `src/core/utils/stale-run-recovery.ts:398-423` |
| Normal stale actions depend on snapshot presence | `StaleRun.getAvailableActions` | `src/core/utils/stale-run-recovery.ts:141-154` |
| Partial panic undo restricts actions and gates Finish Rollback | `isPartialPanicUndo`, `canFinishRollback` | `src/core/utils/stale-run-recovery.ts:128-147` |
| Crash normalization changes submitted steering records | `normalizeCrashRules` / `normalizeSteeringPostCrash` | `src/core/utils/stale-run-recovery.ts:157-167`; `src/core/loop-run/state.ts:112-122` |
| Normalization precedes prompting | `handleStaleRun` | `src/core/utils/stale-run-recovery.ts:428-440` |
| Resume adopts the stale tracker’s ownership | `execute("resume")` | `src/core/utils/stale-run-recovery.ts:287-303` |
| Implementation and merge recovery boundaries | `prepareResume`, `prepareMergingResume` | `src/core/utils/stale-run-recovery.ts:306-377,468-502` |
| Dirty primary workspace blocks merge recovery | `prepareMergingResume` | `src/core/utils/stale-run-recovery.ts:474-492` |
| `mark-done-pending` is completed idempotently and made terminal | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:34-75` |
| Replay queue and scheduler progress are restored from persisted state | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:76-91` |
| Existing tracker is reused by the new `LoopRun` | `ralphLoop`, `startOrResume` | `src/core/ralph-loop.ts:334-386`; `src/core/loop-run/loop-run.ts:105-151` |
| Revisions are monotonic and writes are atomic | `LoopRunTracker.update`, `atomicWrite` | `src/core/utils/loop-run-tracker.ts:132-144,375-389` |
| Durable write precedes event emission | `recordTaskPhase`, `emit` | `src/core/loop-run/loop-run.ts:276-289,607-611` |
| Subscribers run synchronously in registration order | `subscribe` and class contract | `src/core/loop-run/loop-run.ts:75-101` |
| Finish Rollback requires confirmation and records terminal panic-undo state | `execute("finishRollback")` | `src/core/utils/stale-run-recovery.ts:224-285` |

## 4. Tests and documentation

- `test/stale-run-recovery.test.ts:455-492` verifies ownership adoption on resume.
- `test/stale-run-recovery.test.ts:704-734` verifies dirty merge recovery is blocked.
- `test/stale-run-recovery.test.ts:1276-1376` verifies partial panic-undo action availability.
- `test/stale-run-recovery.test.ts:1391-1481` verifies Finish Rollback confirmation and failure behavior.
- `test/resume-plan.test.ts:17-99` verifies persisted task body propagation, idempotent completion checks, and `done` advancement.
- `test/recovery-integration.test.ts:258-305` verifies the primary-workspace safety gate.
- `docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:32-43` defines recovery actions, safe/unsafe restart rules, ownership, atomic revisions, and dirty-merge protection.
- `docs/adr/0007-loop-run-coordinator-and-fact-events.md:33-36` defines sole-writer, write-then-emit, panic-undo, and resume-plan responsibilities.

## 5. Uncertainties

- The implementation performs Finish Rollback directly through startup recovery methods, while ADR-0007 describes adopting the stale run into a `LoopRun` before completing partial panic undo. The normal resume path clearly adopts ownership before `LoopRun` execution; the Finish Rollback path’s conformance to that ADR wording is not fully evident from the current code.



---

# Answer A12

**Scenario:** architecture


## 1. Executive summary

Unable to establish the requested pipeline from repository evidence.

## 2. Detailed flow / architecture / impact analysis

No verifiable source evidence was available for:

- Raw verifier-agent stdout parsing
- Criterion identity stabilization
- Loop Run Tracker persistence
- Fact-event emission
- Live Dashboard worker projection
- ADR-0007 write-then-emit enforcement
- Safeguards against malformed results marking tasks complete

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| No claims could be verified | — | — |

## 4. Tests and documentation

No repository tests or documentation could be verified.

## 5. Uncertainties

The implementation locations, symbols, persistence model, event contracts, and failure handling remain undetermined.



---

# Answer A13

**Scenario:** lifecycle


## 1. Executive summary

Startup reads `.ralph-loop/runs/active.json` and treats the tracker as stale when its owner process is dead or its heartbeat is older than 30 seconds (`src/core/utils/loop-run-tracker.ts:168-182`). Recovery occurs before creating a new snapshot or LoopRun (`src/core/ralph-loop.ts:314-386`).

For an ordinary stale run, startup offers:

- **Resume** always; it reconstructs safe task boundaries.
- **Rollback** only when `rollbackSnapshotId` exists.
- **Abandon** and **cancel** always.
- **Finish Rollback** only for a partial Force-Kill Undo that durably reached `processes-drained` and still has a rollback snapshot.

After resume preparation, the new process claims the existing tracker using `adoptOwnership()`, which changes PID/heartbeat and increments revision. A `LoopRun` is then created, resumes the same logical tracker, builds scheduler state, and becomes the authoritative lifecycle writer.

## 2. Detailed flow / architecture / impact analysis

1. **Detection and action selection**

   `handleStaleRun()` first reads the tracker, rejects a currently active owner, rejects non-interactive recovery, normalizes crash state, computes available actions, prompts, and executes the selected action (`src/core/utils/stale-run-recovery.ts:398-440`).

   Ordinary stale runs offer `resume`, `abandon`, and `cancel`; `rollback` is inserted only when `rollbackSnapshotId` is present (`src/core/utils/stale-run-recovery.ts:135-151`). A missing snapshot disables loop-start rollback but does not disable tracker-based resume, consistent with the ADR (`docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:39-43`).

2. **Crash normalization**

   `normalizeCrashRules()` checks every task’s `liveSteering` records for status `submitted`. If any exist, it calls `normalizeLiveSteeringPostCrash()`, converting those records to the post-crash status and rereading tracker state (`src/core/utils/stale-run-recovery.ts:157-168`; `src/core/utils/loop-run-tracker.ts:360-373`).

   It is called after stale detection but before the recovery prompt (`src/core/utils/stale-run-recovery.ts:423-431`), so the developer sees normalized state.

3. **Resume preparation**

   Resume does not continue writer phases in place:

   - `implementing`: delete/recreate the task worktree boundary.
   - `merge-pending`/`merging`: abort an in-progress merge, require a clean primary workspace, reset to `preMergeHead`, then clean the task worktree.
   - `verify-pending`/`verifying`: rerun verification.
   - `mark-done-pending`: retry completion marking.
   - `done`: verify `integratedHead` remains reachable from `HEAD`; otherwise request restart or explicit trust.
   - interrupted/failed/blocked whole-run review is rerun.

   (`src/core/utils/stale-run-recovery.ts:306-347`)

   `buildResumePlan()` then translates the persisted table into scheduler state. Done tasks become terminal IDs; `mark-done-pending` tasks call `isDone` when available, otherwise `markDone`, then persist `done`. The tracker is reread, nonterminal tasks become `replayQueue`, and scheduler iterations/skipped IDs are restored (`src/core/loop-run/resume-plan.ts:31-76`).

4. **Ownership transfer and resumed scheduling**

   After preparation succeeds, resume calls `tracker.adoptOwnership()` (`src/core/utils/stale-run-recovery.ts:294-302`). This updates status, PID, and heartbeat through a revisioned tracker update (`src/core/utils/loop-run-tracker.ts:140-162`).

   `ralphLoop()` then constructs `LoopRun`, registers observers, and calls `startOrResume()`. Existing snapshots are adopted; otherwise a new snapshot is captured and persisted into the existing tracker (`src/core/ralph-loop.ts:346-386`; `src/core/loop-run/loop-run.ts:117-152`). A heartbeat is updated every 10 seconds (`src/core/ralph-loop.ts:377-384`).

   The LoopRun is the sole authoritative writer. Tracker updates atomically replace the file and increment `revision`; events are emitted only after successful writes. Subscribers run synchronously in registration order (`src/core/utils/loop-run-tracker.ts:136-144,375-388`; `src/core/loop-run/loop-run.ts:276-310,607-611`; `docs/adr/0007-loop-run-coordinator-and-fact-events.md:18-21`).

5. **Partial Force-Kill Undo**

   A `panicUndo` record whose phase is anything other than `rollback-completed` is classified as partial (`src/core/utils/stale-run-recovery.ts:117-127`). It is not an ordinary stale run because rollback may already have crossed a destructive boundary.

   Such a run never offers `resume`. It offers `finishRollback` only when:

   - phase is exactly `processes-drained`;
   - `rollbackSnapshotId` exists.

   Otherwise only `abandon` and `cancel` are available (`src/core/utils/stale-run-recovery.ts:129-151`; `docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:54-57`).

   Finish Rollback requires fresh confirmation, adopts the snapshot, retries rollback, records failure if needed, cleans up, records `rollback-completed`, and archives the run as `interrupted` with terminal reason `panic-undo` (`src/core/utils/stale-run-recovery.ts:224-285`).

   **Implementation note:** the ADR requires adopting the stale run into a `LoopRun` before continuing panic-undo writes (`docs/adr/0007-loop-run-coordinator-and-fact-events.md:33-36`), but the current `finishRollback` branch writes directly through `LoopRunTracker` before `LoopRun` construction (`src/core/utils/stale-run-recovery.ts:237-278`). This is an implementation/documentation mismatch.

6. **Merge safety check**

   `prepareMergingResume()` aborts any in-progress merge, then loops while `git.isDirty()`. Recovery refuses to reset to `preMergeHead` until the primary workspace is clean; interactive mode offers retry or abandon, while non-interactive mode throws (`src/core/utils/stale-run-recovery.ts:468-503`). This prevents overwriting manual uncommitted edits.

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| Dead owner or stale heartbeat marks tracker stale | `isStale` | `src/core/utils/loop-run-tracker.ts:168-182` |
| Recovery happens before LoopRun startup | `handleStaleRun` call | `src/core/ralph-loop.ts:314-386` |
| Non-TTY recovery fails without selecting a default | `handleStaleRun` | `src/core/utils/stale-run-recovery.ts:406-421` |
| Rollback requires a snapshot | `getAvailableActions` | `src/core/utils/stale-run-recovery.ts:135-151` |
| Crash normalization handles submitted steering records | `normalizeCrashRules` | `src/core/utils/stale-run-recovery.ts:157-168` |
| Normal resume prepares interrupted phases | `prepareResume` | `src/core/utils/stale-run-recovery.ts:306-347` |
| `mark-done-pending` is retried and persisted as done | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:45-62` |
| Replay queue excludes terminal tasks | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:65-76` |
| Resumed process claims existing tracker | `adoptOwnership` | `src/core/utils/stale-run-recovery.ts:294-302`; `src/core/utils/loop-run-tracker.ts:154-162` |
| Tracker revisions are monotonic and writes atomic | `update`, `atomicWrite` | `src/core/utils/loop-run-tracker.ts:136-144,375-388` |
| Events follow durable writes and subscriber order | `recordTaskPhase`, `emit` | `src/core/loop-run/loop-run.ts:276-310,607-611` |
| Partial panic-undo blocks ordinary resume | `isPartialPanicUndo` / `getAvailableActions` | `src/core/utils/stale-run-recovery.ts:117-151` |
| Finish Rollback requires drained writers and snapshot | `canFinishRollback` | `src/core/utils/stale-run-recovery.ts:129-133` |
| Dirty primary workspace blocks merge recovery | `prepareMergingResume` | `src/core/utils/stale-run-recovery.ts:468-503` |

## 4. Tests and documentation

- Recovery action availability and partial panic-undo behavior: `test/stale-run-recovery.test.ts:81-113,1234-1356`.
- Finish Rollback confirmation and failure retention: `test/stale-run-recovery.test.ts:1391-1481`.
- Merge dirty-worktree protection: `test/recovery-integration.test.ts:258-?`; `test/stale-run-recovery.test.ts:704-?`.
- Resume completion handling: `test/resume-plan.test.ts:16-84`.
- Revision and atomic update behavior: `test/loop-run-tracker.test.ts:436-456`.
- Subscriber ordering and phase ordering: `test/loop-run.test.ts:68-90`.
- Design requirements: `docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:32-57`.
- Sole writer and write-then-emit model: `docs/adr/0007-loop-run-coordinator-and-fact-events.md:18-36`.

## 5. Uncertainties

- The current `finishRollback` implementation directly mutates the tracker before constructing `LoopRun`, contrary to ADR-0007’s sole-writer requirement.
- The implementation’s `canFinishRollback()` checks for a recorded snapshot ID, but does not itself verify snapshot readability or branch/workspace context; those stricter requirements are specified in ADR-0005 rather than enforced in this predicate (`docs/adr/0005-git-backed-force-kill-undo.md:69-73`).



---

# Answer A14

**Scenario:** impact


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



---

# Answer A15

**Scenario:** impact


## 1. Executive summary

Add `executionCount: number` to `UsageTotals`, initialized to `0` and incremented once per `UsageLedgerEntry` in every applicable bucket:

- `run`
- `byIssue[issueId]`
- `byPhase[phase]`

Streaming usage must preserve the existing count; it is ephemeral and not ledger-backed. The UI should derive average cost as `costUsd / executionCount`, while retaining unknown-cost behavior.

Required production files:

- `src/core/loop-run/state.ts`
- `src/core/loop-run/usage.ts`
- `src/core/loop-run/ink-worker-projection.ts`
- `src/core/loop-run/ink-state.ts`
- `src/core/loop-run/ink-view.ts`

Primary tests requiring updates/additions:

- `test/usage.test.ts`
- `test/loop-run.test.ts`
- `test/ink-state.test.ts`
- `test/ink-ui.test.ts`

## 2. Detailed flow / architecture / impact analysis

1. `UsageTotals` is the shared contract for persisted summaries and UI projections (`state.ts:244-254`). Add `executionCount: number`.

2. `buildUsageSummary()` is the authoritative ledger-derived aggregation (`usage.ts:67-96`):
   - Add `executionCount: 0` in `zeroTotals()` (`usage.ts:27-38`).
   - Increment `target.executionCount` in `accumulateInto()` (`usage.ts:41-58`) for every ledger entry.
   - Because the same function feeds run, issue, and phase buckets (`usage.ts:80-94`), counts will automatically be correct for all three.
   - Entries with null usage still count, because they are ledger records.

3. `LoopRun.recordUsage()` already appends exactly one ledger entry per completed execution and recomputes the summary (`loop-run.ts:484-541`). No count-specific change is required there; its behavior is covered by the updated summary builder.

4. The Ink projection duplicates aggregation for committed entries (`ink-worker-projection.ts:29-64`):
   - Initialize `executionCount` in `zeroUsageTotals()` (`ink-worker-projection.ts:29-40`).
   - Increment it in `accumulateUsage()` (`ink-worker-projection.ts:52-64`).
   - Do not increment it in `accumulateStreamingUsage()` (`ink-worker-projection.ts:66-78`), ensuring ephemeral updates do not inflate counts.
   - `displayRunUsage()` combines only streaming values over a fresh zero total (`ink-worker-projection.ts:253-264`), so its count remains zero for streaming-only usage.

5. Cost formatting currently exposes only total cost:
   - `formatUsageCost()` is the shared run/worker formatter (`ink-state.ts:262-265`).
   - Extend it, or add a dedicated formatter, to display total and average cost. Return `"unknown"` when `hasUnknownCost` is true; otherwise calculate average only when `executionCount > 0`.
   - `formatDisplayCost()` handles worker committed plus streaming cost (`ink-worker-projection.ts:292-295`). Its average must use committed `worker.usage.executionCount`; streaming usage must not affect the denominator.

6. Run-summary rendering is in `renderRunUsageLines()` (`ink-view.ts:87-104`). Add average cost alongside total cost for committed run usage. In-progress usage should not show an execution average, or should explicitly show no average/count, because it has no ledger-backed executions.

7. The persisted tracker is initialized through `buildUsageSummary([])` (`loop-run-tracker.ts:111-114`), so adding the field to `zeroTotals()` automatically initializes new snapshots correctly.

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| `UsageTotals` is the shared totals shape | `UsageTotals` | `src/core/loop-run/state.ts:244-254` |
| Summaries contain run, issue, and phase buckets | `UsageSummary` | `src/core/loop-run/state.ts:256-260` |
| Ledger entries represent executions | `UsageLedgerEntry` | `src/core/loop-run/state.ts:233-242` |
| Summary is recomputed from the full ledger | `buildUsageSummary` | `src/core/loop-run/usage.ts:67-96` |
| All buckets use the same accumulation path | `accumulateInto` | `src/core/loop-run/usage.ts:41-58,80-94` |
| One ledger entry is appended per `recordUsage` call | `recordUsage` | `src/core/loop-run/loop-run.ts:484-541` |
| Committed UI usage accumulation exists separately | `accumulateUsage` | `src/core/loop-run/ink-worker-projection.ts:52-64` |
| Streaming accumulation is separate | `accumulateStreamingUsage` | `src/core/loop-run/ink-worker-projection.ts:66-78` |
| Streaming display starts from zero totals | `displayRunUsage` | `src/core/loop-run/ink-worker-projection.ts:253-264` |
| Worker cost includes streaming cost | `formatDisplayCost` | `src/core/loop-run/ink-worker-projection.ts:287-295` |
| Run cost is rendered in the summary | `renderRunUsageLines` | `src/core/loop-run/ink-view.ts:87-104` |
| Shared cost formatting is centralized | `formatUsageCost` | `src/core/loop-run/ink-state.ts:262-265` |
| Empty tracker summaries are initialized through the builder | `LoopRunTracker.create` | `src/core/utils/loop-run-tracker.ts:111-114` |

## 4. Tests and documentation

Tests that will break because exact `UsageTotals` object expectations gain a required field:

- `test/usage.test.ts:21-38` — empty summary exact object.
- `test/usage.test.ts:133-143` — live-steering zero-total object expectation.

Existing tests to update with count assertions:

- `test/usage.test.ts:40-49` — run count should be `2`.
- `test/usage.test.ts:78-87` — issue counts should be `2` and `1`.
- `test/usage.test.ts:89-100` — phase counts should match entries.
- `test/usage.test.ts:110-121` — null/known values still count both entries.
- `test/loop-run.test.ts:549-570` — persisted run, issue, and phase counts.
- `test/loop-run.test.ts:518-533` — missing usage still produces count `1`.

New test cases:

- Empty ledger gives count `0` in every phase bucket.
- Entries with all-null usage still increment counts.
- One entry increments run, matching issue, and matching phase exactly once.
- An entry without `issueId` increments run and phase but no issue bucket.
- Streaming usage leaves `executionCount` unchanged:
  - `test/ink-state.test.ts:303-333`
  - `test/ink-ui.test.ts:121-148`
- A committed entry followed by streaming usage keeps the same count.
- Average cost is `costUsd / executionCount`.
- Unknown cost displays `"unknown"` even when count is nonzero.
- Zero executions do not produce `NaN` or `Infinity`.

Relevant documentation establishes that the ledger is execution-based and summaries are ledger-derived: `docs/adr/0009-inline-usage-ledger-in-loop-run-tracker.md:24-30`.

## 5. Uncertainties

- The exact UI text for average cost is not specified. A format such as `cost $1.00 · avg $0.50/execution` is consistent with the existing run-summary format.
- It is unclear whether the average should appear on worker Details cards as well as the run summary. `formatDisplayCost()` is the worker-specific cost path, so supporting both is the safest interpretation.
- For zero executions, the UI should use a stable placeholder such as `n/a`; the repository currently has no established convention for this case.



---

# Answer A16

**Scenario:** architecture


## 1. Executive summary

The requested pipeline could not be verified because repository evidence was unavailable. No reliable claims can be made about verifier parsing, criterion identity, persistence, fact emission, dashboard projection, or completion safeguards.

## 2. Detailed flow / architecture / impact analysis

Insufficient evidence to trace the pipeline from verifier-agent stdout through:

- verdict stabilization,
- Loop Run Tracker persistence,
- fact-event emission,
- Live Dashboard worker projection,
- malformed-result and crash handling.

## 3. Evidence table

| Claim | Symbol | File:line |
|---|---|---|
| No repository symbols or source ranges were available for verification. | — | — |

## 4. Tests and documentation

No tests or documentation could be reliably identified.

## 5. Uncertainties

- The available repository context may not correspond to the repository named in the prompt.
- ADR-0007 and the relevant implementation files could not be verified.
- Any architectural description without source citations would be speculative.



---

# Answer A17

**Scenario:** lifecycle


1. Executive summary

Unable to complete the repository investigation because aiKnow was unavailable: its local server failed to start. No repository files or lines could be verified.

2. Detailed flow / architecture / impact analysis

Not determined. The required repository-only evidence could not be accessed.

3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| Repository evidence unavailable | — | — |

4. Tests and documentation

Not inspected.

5. Uncertainties

aiKnow failed to start while attempting to launch `F:\MyWork\aiKnow\dist\cli.js`.



---

# Answer A18

**Scenario:** lifecycle


## 1. Executive summary

Investigation could not be completed: repository evidence was unavailable because the configured local index service failed to start.

## 2. Detailed flow / architecture / impact analysis

No verified repository evidence is available for the stale-run recovery lifecycle, recovery action availability, crash-rule normalization, resume planning, tracker ownership, Force-Kill Undo handling, or merge-workspace safety checks.

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| No claims could be verified. | — | — |

## 4. Tests and documentation

No tests or documentation could be examined.

## 5. Uncertainties

All requested implementation details remain unverified, including exact symbols, control flow, and source locations.

