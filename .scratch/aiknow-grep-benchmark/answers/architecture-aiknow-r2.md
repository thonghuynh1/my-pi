## 1. Executive summary

The implemented pipeline is:

raw verifier stdout → `runVerification` parses criteria → `TaskPipeline` records them in `LoopRunTracker` → verification phase facts update the Live Dashboard.

However, **criterion verdicts themselves are not emitted as a fact event and are not represented in the worker dashboard projection**. Only surrounding phase, metadata, usage, and run-finished events are projected.

Malformed or crashed verification cannot mark a task verified: malformed criterion statuses become `unmet`, missing overall verdicts are `inconclusive`/`passed: false`, and repeated execution errors fail the task closed.

## 2. Detailed flow / architecture / impact analysis

1. **Verifier execution and parsing**
   - `runVerification` invokes the verifier agent via `runAgentExecution` and captures `execResult.output` as raw stdout (`src/core/actions/verifier.ts:218-236`).
   - `parseCriterionVerdicts` scans `<criterion>` blocks, extracts attributes/evidence, assigns an ordinal, and generates `criterion-N` when no explicit ID exists (`src/core/actions/verifier.ts:114-134`).
   - Statuses are normalized to `met`, `regressed`, or `unmet`; all other values become `unmet` (`src/core/actions/verifier.ts:83-88`).
   - The overall `<verdict>` tag is required. Missing it produces `inconclusive` and `passed: false` (`src/core/actions/verifier.ts:288-306`). Only `<verdict>PASS</verdict>` produces `passed: true` (`src/core/actions/verifier.ts:309-326`).

2. **Invocation evidence boundary**
   - Fenced command stdout inside a criterion is extracted and, when an invocation exists, persisted through `invocation.writeEvidence` before the criterion result is returned (`src/core/actions/verifier.ts:280-286`).

3. **Orchestration boundary**
   - `TaskPipeline` enters `verify-pending` and `verifying` before invoking `runVerification` (`src/core/utils/task-pipeline.ts:347-367`).
   - It receives `v.criteria` and calls `loopRun.recordCriterionVerdicts(issue.id, v.criteria)` (`src/core/utils/task-pipeline.ts:388-390`).
   - Verifier execution errors are retried once; two errors fail closed without setting `verified` (`src/core/utils/task-pipeline.ts:392-400`).
   - A failed or inconclusive verdict remains unverified; the task is eventually recorded as `failed` (`src/core/utils/task-pipeline.ts:402-428`).

4. **Stable criterion identity**
   - `LoopRun.recordCriterionVerdicts` preserves explicit verifier IDs.
   - For omitted IDs, `resolveCriterionIdentity` freezes the first identity at that ordinal and reuses it on subsequent attempts; otherwise it creates `criterion-${ordinal}` (`src/core/loop-run/loop-run.ts:594-612`).
   - The persisted task stores both the normalized criteria and the frozen identity list (`src/core/loop-run/loop-run.ts:337-359`).

5. **Durable tracker persistence and ADR-0007 discipline**
   - `recordCriterionVerdicts` updates the tracker and does not emit an event (`src/core/loop-run/loop-run.ts:316-361`).
   - Tracker updates increment the revision and call `atomicWrite` (`src/core/utils/loop-run-tracker.ts:148-157`).
   - `atomicWrite` writes temporary state, renames it into place, then atomically updates the active-run pointer (`src/core/utils/loop-run-tracker.ts:390-409`).
   - The write-then-emit discipline is explicitly implemented for task phase changes: `recordTaskPhase` persists first, then emits `taskPhaseChanged` (`src/core/loop-run/loop-run.ts:280-293`). The event contract states subscribers observe already-persisted facts (`src/core/loop-run/events.ts:2-9`).
   - Consequently, criterion persistence is durable, but there is **no criterion-verdict fact event** after that write.

6. **Live Dashboard projection**
   - `applyLoopRunEventToInkState` handles `taskPhaseChanged`, `taskMetaChanged`, usage, streaming usage, and `runFinished`; it has no criterion-verdict case (`src/core/loop-run/ink-state.ts:161-200`).
   - `taskPhaseChanged` updates worker rows through `applyTaskPhaseToWorkerProjection` (`src/core/loop-run/ink-state.ts:167-176`), which tracks worker phase, title, ordering, and timestamps (`src/core/loop-run/ink-worker-projection.ts:154-175`).
   - Therefore the dashboard can show the worker moving through `verifying` or `failed`, but cannot display the persisted per-criterion verdicts.

## 3. Evidence table

| Claim | Symbol | File:line |
|---|---|---|
| Raw agent output becomes `raw` | `runVerification` | `src/core/actions/verifier.ts:218-236` |
| Criterion blocks are parsed with ordinals | `parseCriterionVerdicts` | `src/core/actions/verifier.ts:114-134` |
| Invalid statuses normalize to `unmet` | `normalizeCriterionStatus` | `src/core/actions/verifier.ts:83-88` |
| Missing overall verdict is inconclusive | `runVerification` | `src/core/actions/verifier.ts:288-306` |
| Explicit IDs and positional IDs are stabilized | `resolveCriterionIdentity` | `src/core/loop-run/loop-run.ts:594-612` |
| Criteria are durably stored in task state | `recordCriterionVerdicts` | `src/core/loop-run/loop-run.ts:316-361` |
| Tracker writes are revisioned | `LoopRunTracker.update` | `src/core/utils/loop-run-tracker.ts:148-157` |
| Writes use temp files and renames | `atomicWrite` | `src/core/utils/loop-run-tracker.ts:390-409` |
| Phase facts emit after persistence | `recordTaskPhase` | `src/core/loop-run/loop-run.ts:280-293` |
| No criterion event exists in the event union | `LoopRunEvent` | `src/core/loop-run/events.ts:117-133` |
| Dashboard reduces only phase/meta/usage/run facts | `applyLoopRunEventToInkState` | `src/core/loop-run/ink-state.ts:161-200` |
| Two verifier execution errors fail closed | Task verification loop | `src/core/utils/task-pipeline.ts:392-400` |
| Failed tasks cannot remain verified | Task finalization | `src/core/utils/task-pipeline.ts:402-428` |

## 4. Tests and documentation

- Verifier tests cover per-criterion parsing, malformed status fallback, missing overall verdicts, and explicit IDs (`test/verifier.test.ts:96-178`).
- Loop Run tests verify events occur after durable writes and do not emit when persistence fails (`test/loop-run.test.ts:42-63`, `test/loop-run.test.ts:100-105`).
- Tracker and event modules explicitly reference ADR-0007 (`src/core/utils/loop-run-tracker.ts:1-11`, `src/core/loop-run/events.ts:2-9`).

## 5. Uncertainties

- The requested “criterion verdict fact event” and dashboard criterion projection are not present in the indexed implementation. If such behavior is expected, it is currently an architectural gap rather than an implemented pipeline stage.
- `VerificationResult` comments describe verifier execution errors as potentially “fail open” (`src/core/actions/verifier.ts:71-75`), but the active `TaskPipeline` retries and then fails closed (`src/core/utils/task-pipeline.ts:392-400`).
