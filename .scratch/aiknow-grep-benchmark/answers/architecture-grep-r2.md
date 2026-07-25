## 1. Executive summary

The implemented pipeline is:

`verifier stdout → runVerification → TaskPipeline → LoopRun.recordCriterionVerdicts → LoopRunTracker`

Criterion identity and status are stabilized and persisted, but the requested final two stages do **not** exist for per-criterion verdicts:

- No `criterionVerdictsRecorded` fact event is defined or emitted.
- The Live Dashboard worker projection has no criterion-verdict fields or reducer.

Only the related task lifecycle phases (`verifying`, `mark-done-pending`, `done`, `failed`) reach fact subscribers and the dashboard.

## 2. Detailed flow / architecture / impact analysis

1. **Raw stdout parsing — `runVerification`**
   - `runAgentExecution` returns verifier stdout, which is assigned to `raw`.
   - `parseCriterionVerdicts(raw)` extracts `<criterion>` blocks, ordinal position, optional explicit ID, normalized status, prose, and fenced stdout evidence.
   - Missing or malformed criterion status becomes `unmet`; missing `<verdict>` produces `inconclusive` and `passed: false`.
   - Evidence: `src/core/actions/verifier.ts:237-281`, `src/core/actions/verifier.ts:114-137`, `src/core/actions/verifier.ts:283-302`.

2. **Task-pipeline boundary**
   - `TaskPipeline.executeTask` invokes `runVerification`, then passes `v.criteria` to `loopRun.recordCriterionVerdicts`.
   - Verifier execution errors are retried once; two errors break the loop and do not set `verified`.
   - Only `v.passed`—which requires an explicit `PASS` verdict—sets `verified = true`.
   - Evidence: `src/core/utils/task-pipeline.ts:371-387`.

3. **Stable criterion identity**
   - `LoopRun.recordCriterionVerdicts` preserves explicit IDs.
   - For omitted IDs, `resolveCriterionIdentity` reuses the identity already stored at that ordinal; otherwise it generates `criterion-N`.
   - This freezes positional identity across retries, even when verifier wording changes.
   - Evidence: `src/core/loop-run/loop-run.ts:314-320`, `src/core/loop-run/loop-run.ts:343-365`, `src/core/loop-run/loop-run.ts:619-636`.

4. **Durable persistence**
   - Each criterion is normalized and stored inline under `tasks[issueId].criteria`.
   - Fenced stdout is written to a run-scoped hashed artifact; only its `evidenceRef` is stored in the tracker.
   - `LoopRunTracker.update` increments the revision and calls `atomicWrite`; `atomicWrite` writes a temporary JSON file and renames it into place.
   - Evidence: `src/core/loop-run/loop-run.ts:346-365`, `src/core/loop-run/loop-run.ts:639-667`, `src/core/utils/loop-run-tracker.ts:132-140`, `src/core/utils/loop-run-tracker.ts:371-378`.

5. **Fact-event boundary: missing for verdicts**
   - `recordCriterionVerdicts` performs the tracker update but never calls `emit`.
   - `events.ts` defines lifecycle, usage, steering, and run events, but no criterion-verdict event.
   - Therefore ADR-0007’s write-then-emit discipline is enforced for phase/meta methods, not for criterion verdicts: there is no verdict fact to emit.
   - Evidence: `src/core/loop-run/loop-run.ts:322-365`, `src/core/loop-run/events.ts:12-75`, `src/core/loop-run/loop-run.ts:275-310`.

6. **Live Dashboard projection: only lifecycle status**
   - `applyLoopRunEventToInkState` handles `taskPhaseChanged` and `taskMetaChanged`.
   - `applyTaskPhaseToWorkerProjection` updates the worker’s phase, phase history, title, ordering, and timestamp.
   - `WorkerDashboardRow` contains no criterion collection, verdict, or evidence fields.
   - Thus the dashboard reflects `verifying`, `done`, or `failed`, but not individual verdicts.
   - Evidence: `src/core/loop-run/ink-state.ts:161-182`, `src/core/loop-run/ink-worker-projection.ts:9-20`, `src/core/loop-run/ink-worker-projection.ts:154-175`.

7. **Completion safety**
   - `ralphLoop` marks an issue `done` only when both `taskResult.success` and `taskResult.verified` are true.
   - Otherwise it records `failed` and leaves the issue open.
   - `mark-done-pending` is persisted before `issueSource.markDone`; `done` is recorded only after that operation returns.
   - Evidence: `src/core/ralph-loop.ts:526-546`.

## 3. Evidence table

| Claim | Symbol | File:line |
|---|---|---|
| Verifier stdout becomes `raw` and is parsed into criteria | `runVerification`, `parseCriterionVerdicts` | `src/core/actions/verifier.ts:237-281` |
| Criterion blocks receive ordinal IDs and normalized statuses | `parseCriterionVerdicts` | `src/core/actions/verifier.ts:114-137` |
| Missing overall verdict is inconclusive and cannot pass | `runVerification` | `src/core/actions/verifier.ts:283-302` |
| Criteria cross into orchestration | `executeTask` | `src/core/utils/task-pipeline.ts:371-387` |
| Explicit IDs are preserved; positional IDs are frozen | `resolveCriterionIdentity` | `src/core/loop-run/loop-run.ts:619-636` |
| Criteria are persisted inline | `recordCriterionVerdicts` | `src/core/loop-run/loop-run.ts:322-365` |
| Stdout evidence is stored as a hashed artifact reference | `writeCriterionEvidenceArtifact` | `src/core/loop-run/loop-run.ts:639-667` |
| Tracker writes are revisioned and atomic | `LoopRunTracker.update`, `atomicWrite` | `src/core/utils/loop-run-tracker.ts:132-140, 371-378` |
| Lifecycle events are emitted after writes | `recordTaskPhase`, `recordTaskMeta` | `src/core/loop-run/loop-run.ts:275-310` |
| No criterion fact event exists | `LoopRunEvent` union | `src/core/loop-run/events.ts:12-75` |
| Dashboard projects lifecycle phase changes | `applyTaskPhaseToWorkerProjection` | `src/core/loop-run/ink-worker-projection.ts:154-175` |
| `done` requires successful explicit verification | `ralphLoop` completion branch | `src/core/ralph-loop.ts:526-546` |

## 4. Tests and documentation

- Positional identity stability and evidence persistence: `test/loop-run.test.ts:400-490`.
- Malformed criterion status and missing verdict behavior: `test/verifier.test.ts:121-186`.
- Legacy tracker compatibility: `test/loop-run-tracker.test.ts:44-56`.
- ADR-0007 specifies sole-writer and write-then-emit semantics: `docs/adr/0007-loop-run-coordinator-and-fact-events.md:20-35`.
- Verifier output grammar requires criterion blocks followed by exactly one verdict: `src/instruction/verify.md:29-54`.

## 5. Uncertainties

- The code may intentionally treat lifecycle phase events as sufficient dashboard visibility; however, no repository evidence shows per-criterion verdict projection.
- “Emitted as a fact event” and “reflected in the Live Dashboard worker projection” are not currently satisfied for the criterion record itself.
- Malformed criterion blocks are retained as `unmet`, but malformed or crashed verifier execution produces no criteria and cannot mark the task done because `passed` remains false.
