## 1. Executive summary

A verifier stdout string crosses:

1. `runVerification()` executes the verifier and parses `<criterion>` blocks and `<verdict>`.
2. `TaskPipeline.runVerification` writes captured stdout evidence artifacts.
3. `LoopRun.recordCriterionVerdicts()` normalizes identities and durably writes criteria into the Loop Run Tracker.
4. **No criterion-verdict fact event is emitted.**
5. **The Live Dashboard worker projection does not receive or display criterion verdicts.** It only projects phase, metadata, usage, and streaming usage events.

ADR-0007 write-then-emit is enforced for lifecycle methods, but not for criterion verdicts because `recordCriterionVerdicts()` performs persistence without emitting an event.

## 2. Detailed flow / architecture / impact analysis

### Raw stdout → parsed verdict

`runVerification()` receives agent output from `runAgentExecution()` and stores it as `raw` (`src/core/actions/verifier.ts:218-236`). It parses criterion blocks with `parseCriterionVerdicts()` (`src/core/actions/verifier.ts:114-136`):

- Explicit `id` values are preserved.
- Missing IDs initially receive `criterion-N`.
- Invalid statuses normalize to `unmet` (`src/core/actions/verifier.ts:83-88`).
- Missing overall `<verdict>` produces `inconclusive` and `passed: false` (`src/core/actions/verifier.ts:288-306`).
- A recognized overall verdict sets `passed` solely from `PASS` versus `FAIL` (`src/core/actions/verifier.ts:309-326`).

Command stdout inside criterion evidence is written to an immutable invocation artifact by `InvocationBundle.writeEvidence()` (`src/core/loop-run/invocation-bundle.ts:210-214`). `runVerification()` attaches the resulting relative path as `evidenceRef` before finalizing the invocation (`src/core/actions/verifier.ts:280-286`).

### Parsed verdict → Loop Run boundary

`TaskPipeline` records each verifier result through `loopRun.recordCriterionVerdicts(issue.id, v.criteria)` (`src/core/utils/task-pipeline.ts:388-396`).

`LoopRun.recordCriterionVerdicts()`:

- Requires an active tracker.
- Maps each criterion to a persisted `{id, status, evidenceProse, evidenceRef}` record.
- Normalizes status again.
- Updates the task record through `tracker.update()` (`src/core/loop-run/loop-run.ts:316-360`).

### Criterion identity stability

`resolveCriterionIdentity()` uses an explicit verifier ID when present. Otherwise it reuses the previously persisted identity for that ordinal; if none exists, it freezes `criterion-N` into `criterionIdentities` (`src/core/loop-run/loop-run.ts:594-611`).

Thus identity is explicit-ID-first and positional fallback. It is not text- or hash-based. The known limitation is that inserting, deleting, or reordering unlabelled criteria can mis-map ordinals.

### Durable persistence and ADR-0007

`LoopRunTracker.update()` reads the current snapshot, increments `revision`, and atomically writes the next snapshot (`src/core/utils/loop-run-tracker.ts:145-158`). The Loop Run is documented as the sole authoritative tracker writer (`src/core/loop-run/loop-run.ts:4-7`).

For ordinary lifecycle facts, methods write first and call `emit()` afterward—for example `recordTaskPhase()` (`src/core/loop-run/loop-run.ts:268-294`). Subscribers are synchronous and receive facts only after persistence (`src/core/loop-run/loop-run.ts:70-75`, `src/core/loop-run/loop-run.ts:582-585`).

However, `recordCriterionVerdicts()` stops after `tracker.update()` and does not call `emit()` (`src/core/loop-run/loop-run.ts:349-360`). Therefore no criterion-verdict fact event exists.

### Live Dashboard projection

The Dashboard subscribes to Loop Run events through `presentation.onEvent(event)` (`src/core/ralph-loop.ts:356-358`). Ink applies events via `applyLoopRunEventToInkState()` (`src/core/loop-run/ink-state.ts:161-190`).

The worker projection handles:

- `taskPhaseChanged` via `applyTaskPhaseToWorkerProjection()`.
- `taskMetaChanged`.
- `usageRecorded` via `applyUsageRecordedToWorkerProjection()`.
- `streamingUsage`.

These are the only relevant worker projection paths (`src/core/loop-run/ink-state.ts:166-204`). `WorkerDashboardRow` has no criterion/verdict field (`src/core/loop-run/ink-worker-projection.ts:8-23`).

Therefore persisted criteria are available through the durable tracker but are not reflected in the Live Dashboard worker projection.

### Crash and malformed-result safety

A verifier execution exception or unsuccessful execution returns `passed: false` and `outcome.kind: "errored"` (`src/core/actions/verifier.ts:237-277`). The pipeline retries once and, after a second error, breaks with `verified` still false (`src/core/utils/task-pipeline.ts:392-405`).

Task completion requires both `success` and `verified`; only then does `ralphLoop` call `markDone()` and record `done` (`src/core/ralph-loop.ts:526-543`). This prevents a crashed verifier from marking a task done.

Missing overall verdicts also remain inconclusive and fail closed (`src/core/actions/verifier.ts:288-306`).

There is a safety gap for malformed **criterion-level** output: an invalid criterion status becomes `unmet`, but a separate valid overall `<verdict>PASS</verdict>` still sets `passed: true` (`src/core/actions/verifier.ts:83-88`, `src/core/actions/verifier.ts:309-326`). No code checks that all criteria are `met` before completion.

## 3. Evidence table

| Claim | Symbol | File:line |
|---|---|---|
| Verifier output is captured as raw stdout | `runVerification` | `src/core/actions/verifier.ts:218-236` |
| Criterion tags are parsed with ordinal fallback IDs | `parseCriterionVerdicts` | `src/core/actions/verifier.ts:114-136` |
| Invalid criterion status becomes `unmet` | `normalizeCriterionStatus` | `src/core/actions/verifier.ts:83-88` |
| Missing overall verdict is inconclusive and not passed | `runVerification` | `src/core/actions/verifier.ts:288-306` |
| Overall pass is determined solely from `<verdict>PASS</verdict>` | `runVerification` | `src/core/actions/verifier.ts:309-326` |
| Evidence stdout is durably written as an artifact | `writeEvidence` | `src/core/loop-run/invocation-bundle.ts:210-214` |
| Pipeline forwards criteria to Loop Run | `runVerify` call site | `src/core/utils/task-pipeline.ts:388-396` |
| Criteria are persisted inline in the task record | `recordCriterionVerdicts` | `src/core/loop-run/loop-run.ts:316-360` |
| Explicit IDs and frozen ordinal identities are used | `resolveCriterionIdentity` | `src/core/loop-run/loop-run.ts:594-611` |
| Tracker revisions are incremented and atomically written | `LoopRunTracker.update` | `src/core/utils/loop-run-tracker.ts:145-158` |
| Lifecycle facts use write-then-emit | `recordTaskPhase` | `src/core/loop-run/loop-run.ts:268-294` |
| Criterion persistence emits no fact event | `recordCriterionVerdicts` | `src/core/loop-run/loop-run.ts:349-360` |
| Dashboard receives Loop Run events | `presentation.onEvent` | `src/core/ralph-loop.ts:356-358` |
| Dashboard projection handles phases and usage, not criteria | `applyLoopRunEventToInkState` | `src/core/loop-run/ink-state.ts:161-204` |
| Crashed verifier is retried once and then fails closed | verification loop | `src/core/utils/task-pipeline.ts:392-405` |
| Task is marked done only when `success && verified` | `handleTaskCompletion` | `src/core/ralph-loop.ts:526-543` |

## 4. Tests and documentation

- Criterion identity freezing is tested in `test/loop-run.test.ts:350-401`.
- Evidence persistence without a verdict sidecar is tested in `test/loop-run.test.ts:403-438`.
- Invalid criterion status and missing overall verdict behavior are tested in `test/verifier.test.ts:120-159`.
- ADR-0007 defines the sole-writer and synchronous write-then-emit contract in `docs/adr/0007-loop-run-coordinator-and-fact-events.md:17-25`.
- ADR-0011 defines stable criterion identity, fail-closed parsing, and verifier-error behavior in `docs/adr/0011-stateful-per-criterion-verification-loop.md:21-46`.

## 5. Uncertainties

- The repository contains no criterion-verdict fact event or Dashboard criterion projection, so the requested “emitted as a fact event” and “reflected in the Live Dashboard” stages are not implemented.
- The overall PASS path does not independently validate that every parsed criterion is `met`; consequently, malformed criterion status combined with an overall PASS may still permit completion.
