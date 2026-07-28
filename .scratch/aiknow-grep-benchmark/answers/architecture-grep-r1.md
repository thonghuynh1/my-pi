## 1. Executive summary

The implemented pipeline is:

`runAgentExecution()` → `parseCriterionVerdicts()` → `recordCriterionVerdicts()` → atomic tracker update → task lifecycle fact events → Live Dashboard worker projection.

Per-criterion verdicts are durably persisted, but **they are not emitted as fact events and are not represented in the Live Dashboard worker projection**. The dashboard only receives phase, metadata, usage, and streaming-usage events.

Malformed output without a valid overall verdict, or verifier execution failure, cannot mark a task done because `passed` is false and the pipeline records failure. However, output containing `<verdict>PASS</verdict>` with missing or malformed criterion blocks can still pass; criterion completeness is not validated.

## 2. Detailed flow / architecture / impact analysis

1. **Raw verifier stdout**
   - `runVerification()` invokes `runAgentExecution()` and stores its stdout in `raw`.
   - Execution exceptions and unsuccessful execution results return `outcome.kind = "errored"` with `passed: false`.
   - Evidence blocks are parsed before overall-verdict handling.

2. **Criterion parsing and initial identity**
   - `parseCriterionVerdicts()` scans `<criterion>` blocks.
   - Explicit `id` attributes are retained.
   - Missing IDs receive positional IDs such as `criterion-1`.
   - Invalid or absent statuses normalize to `unmet`.
   - Fenced command output becomes `stdout`, later written as an evidence artifact.

3. **Evidence persistence**
   - `runVerification()` calls `InvocationBundle.writeEvidence()` for captured stdout before finalizing the invocation.
   - The returned run-relative artifact path becomes `evidenceRef`.

4. **Loop Run tracker persistence**
   - `TaskPipeline` calls `loopRun.recordCriterionVerdicts(issue.id, v.criteria)` after each verification attempt.
   - `LoopRun.recordCriterionVerdicts()` normalizes the records and calls `tracker.update()`.
   - `LoopRunTracker.update()` increments the revision and calls `atomicWrite()`, which writes temporary files and renames them into place.

5. **Criterion identity stability**
   - Explicit IDs are preserved and written into the ordinal slot.
   - For omitted IDs, `resolveCriterionIdentity()` freezes the first identity for that ordinal and reuses it on later attempts.
   - This is positional stability, not semantic stability: inserting, deleting, or reordering criteria can mis-map them. The ADR documents this as a known limitation.

6. **Fact-event boundary**
   - `recordCriterionVerdicts()` performs no `emit()` call.
   - Therefore, no `criterionVerdictRecorded` or equivalent event exists.
   - Lifecycle updates such as `recordTaskPhase()` do enforce write-then-emit: the tracker write completes before `taskPhaseChanged` is emitted.
   - The emitted event describes the task phase, not the per-criterion verdict.

7. **Live Dashboard projection**
   - Ink receives Loop Run events through `applyLoopRunEventToInkState()`.
   - `taskPhaseChanged` updates worker phase/order; `taskMetaChanged` updates worker metadata; usage events update usage projections.
   - No event handler reads or projects `TaskRecord.criteria`.
   - Consequently, the dashboard can show a worker as `done` or `failed`, but cannot show individual criterion verdicts.

8. **Done protection**
   - A task reaches `done` only when `taskResult.success && taskResult.verified`.
   - Verification errors are retried once; a second error fails closed.
   - Missing `<verdict>` produces `inconclusive` with `passed: false`.
   - Failed or unverified tasks are recorded as `failed`, while successful verification uses the two-phase `mark-done-pending` → external `markDone()` → `done` sequence.

## 3. Evidence table

| Claim | Symbol | File:line |
|---|---|---|
| Verifier stdout is captured and parsed into criterion records | `runVerification`, `parseCriterionVerdicts` | `src/core/actions/verifier.ts:198-220, 280-285` |
| Missing IDs use ordinal identities and invalid statuses become `unmet` | `parseCriterionVerdicts`, `normalizeCriterionStatus` | `src/core/actions/verifier.ts:83-88, 114-132` |
| Captured stdout is durably written as evidence | `InvocationBundle.writeEvidence` | `src/core/actions/verifier.ts:280-285`; `src/core/loop-run/invocation-bundle.ts:209-214` |
| Pipeline records criteria after every verification attempt | `TaskPipeline` verification loop | `src/core/utils/task-pipeline.ts:388-396` |
| Criterion records are stored inline in tracker state | `recordCriterionVerdicts` | `src/core/loop-run/loop-run.ts:306-359` |
| Omitted criterion IDs are frozen by ordinal | `resolveCriterionIdentity` | `src/core/loop-run/loop-run.ts:594-611` |
| Tracker updates increment revision and atomically persist | `LoopRunTracker.update`, `atomicWrite` | `src/core/utils/loop-run-tracker.ts:154-162, 406-432` |
| Criterion verdicts do not emit a fact event | `recordCriterionVerdicts` | `src/core/loop-run/loop-run.ts:316-359` |
| Fact events are emitted only after durable writes | `recordTaskPhase`, `emit` | `src/core/loop-run/loop-run.ts:270-294, 582-585` |
| Event union has no criterion-verdict event | `LoopRunEvent` | `src/core/loop-run/events.ts:117-135` |
| Dashboard projects phase/meta/usage, not criteria | `applyLoopRunEventToInkState` | `src/core/loop-run/ink-state.ts:161-194` |
| Missing overall verdict cannot pass | `runVerification` | `src/core/actions/verifier.ts:288-307` |
| Verifier errors retry once and then fail closed | Task verification loop | `src/core/utils/task-pipeline.ts:392-405` |
| Only verified successful results can mark done | `handleTaskCompletion` | `src/core/ralph-loop.ts:526-543` |
| ADR-0007 mandates write-then-emit | ADR decision | `docs/adr/0007-loop-run-coordinator-and-fact-events.md:17-20` |
| Positional fallback has known reorder risk | ADR-0011 consequences | `docs/adr/0011-stateful-per-criterion-verification-loop.md:57-61` |

## 4. Tests and documentation

- Parser behavior for missing overall verdict: `test/verifier.test.ts:140-158`.
- Positional identity freezing and inline evidence persistence: `test/loop-run.test.ts:354-430`.
- Dashboard tests cover worker phase and usage projections, not criterion verdicts: `test/ink-state.test.ts:171-213`.
- ADR-0011 specifies inline criterion persistence and fail-closed verifier errors: `docs/adr/0011-stateful-per-criterion-verification-loop.md:51-59`.
- ADR-0007 specifies the single-writer and write-then-emit discipline: `docs/adr/0007-loop-run-coordinator-and-fact-events.md:17-20`.

## 5. Uncertainties

- The repository does not implement the requested per-criterion fact-event or dashboard-projection boundary; any claim that it does would be unsupported.
- A syntactically valid overall `PASS` with zero criterion blocks is accepted because only the overall verdict tag controls `passed`; there is no completeness check against the issue’s acceptance criteria.
- Explicit IDs are stable only when the verifier continues emitting the same IDs. The code overwrites the ordinal identity slot when a later attempt supplies a different explicit ID.
