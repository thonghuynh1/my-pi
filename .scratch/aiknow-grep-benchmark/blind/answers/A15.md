## 1. Executive summary

The pipeline is:

`verifier stdout → runVerification() parses criteria → TaskPipeline records criteria → LoopRun.recordCriterionVerdicts() persists tracker state → [no criterion fact event] → [no criterion dashboard projection]`.

ADR-0007 write-then-emit is enforced for task phases and other coordinator events, but **not for criterion verdicts**: `recordCriterionVerdicts()` persists silently. Consequently, criterion statuses are durable but are not emitted to, or reflected in, the Live Dashboard worker projection.

Malformed or crashed verifier executions generally fail closed, but a malformed output containing only `<verdict>PASS</verdict>` can currently mark a task done because criterion completeness is not validated.

## 2. Detailed flow / architecture / impact analysis

1. **Raw stdout → parser**  
   `runVerification()` executes the verifier and parses stdout with `parseCriterionVerdicts()` (`src/core/actions/verifier.ts:234-281`). Criterion blocks are recognized by tagged `<criterion>` elements; missing/invalid statuses normalize to `unmet` (`src/core/actions/verifier.ts:83-88`, `114-135`). Missing overall `<verdict>` produces `inconclusive` and `passed: false` (`src/core/actions/verifier.ts:283-301`).

2. **Criterion identity stability**  
   Explicit IDs are preserved. Otherwise, the parser assigns an ordinal fallback such as `criterion-1` (`src/core/actions/verifier.ts:118-135`).  
   `LoopRun.recordCriterionVerdicts()` resolves identity through `resolveCriterionIdentity()`: existing ordinal identities are reused, while first-seen ordinals are persisted (`src/core/loop-run/loop-run.ts:322-355`, `619-637`). This avoids hashing mutable criterion prose, matching ADR-0011 (`docs/adr/0011-stateful-per-criterion-verification-loop.md:23-26`).

3. **Pipeline → Loop Run persistence boundary**  
   `TaskPipeline` calls `recordCriterionVerdicts()` after each verification attempt (`src/core/utils/task-pipeline.ts:371-379`). The coordinator stores normalized `{id, status, evidenceProse, evidenceRef}` records inline in the task snapshot (`src/core/loop-run/loop-run.ts:343-360`). Captured stdout is written once to a run-scoped artifact and referenced from the tracker (`src/core/loop-run/loop-run.ts:346-354`, `639-668`).

4. **ADR-0007 write-then-emit discipline**  
   For task phase changes, `recordTaskPhase()` writes through the tracker before emitting `taskPhaseChanged`; a failed write prevents emission (`src/core/loop-run/loop-run.ts:275-301`). `emit()` synchronously invokes subscribers in registration order (`src/core/loop-run/loop-run.ts:607-611`). Tracker writes are atomic temporary-file-plus-rename operations (`src/core/utils/loop-run-tracker.ts:389-408`).

   However, `recordCriterionVerdicts()` ends after `tracker.update()` and does **not** call `emit()` (`src/core/loop-run/loop-run.ts:322-360`). There is no `criterionVerdictRecorded` event in the event union (`src/core/loop-run/events.ts:24-76`).

5. **Fact event → Live Dashboard**  
   The dashboard receives Loop Run events through `ink-ui.ts:onEvent()` and `applyLoopRunEventToInkState()` (`src/core/loop-run/ink-ui.ts:206-214`). Worker projection updates exist for task phases, metadata, and usage (`src/core/loop-run/ink-state.ts:161-192`), with phase projection implemented by `applyTaskPhaseToWorkerProjection()` (`src/core/loop-run/ink-worker-projection.ts:154-176`).

   No criterion event case or criterion field exists in `WorkerDashboardRow` (`src/core/loop-run/ink-worker-projection.ts:8-35`). Therefore, persisted per-criterion verdicts do not appear in the Live Dashboard worker projection.

6. **Done-safety**  
   A task reaches `done` only when `taskResult.success && taskResult.verified` (`src/core/ralph-loop.ts:500-510`). Execution errors return `passed: false`; the pipeline retries once and then breaks without setting `verified` (`src/core/actions/verifier.ts:237-279`; `src/core/utils/task-pipeline.ts:375-387`). Failed or unverified tasks are marked failed/open rather than done (`src/core/ralph-loop.ts:511-529`).

   The safety gap is that `<verdict>PASS</verdict>` alone sets `passed: true`, even if no criterion blocks were parsed (`src/core/actions/verifier.ts:281-321`). Thus, malformed-but-PASS output can still reach `done`.

## 3. Evidence table

| Claim | Symbol | File:line |
|---|---|---|
| Verifier parses criterion blocks and assigns ordinal fallback IDs | `parseCriterionVerdicts` | `src/core/actions/verifier.ts:114-135` |
| Invalid criterion status becomes `unmet` | `normalizeCriterionStatus` | `src/core/actions/verifier.ts:83-88` |
| Missing overall verdict is inconclusive and not passed | `runVerification` | `src/core/actions/verifier.ts:283-301` |
| Pipeline records verdicts after verification | `TaskPipeline` verification loop | `src/core/utils/task-pipeline.ts:371-379` |
| Criterion identity is frozen by ordinal | `resolveCriterionIdentity` | `src/core/loop-run/loop-run.ts:619-637` |
| Verdicts are persisted inline with evidence references | `recordCriterionVerdicts` | `src/core/loop-run/loop-run.ts:322-360` |
| Tracker writes are atomic | `atomicWrite` | `src/core/utils/loop-run-tracker.ts:389-408` |
| Phase events obey write-then-emit | `recordTaskPhase` | `src/core/loop-run/loop-run.ts:275-301` |
| Criterion verdicts have no fact event | `LoopRunEvent` / `recordCriterionVerdicts` | `src/core/loop-run/events.ts:24-76`; `src/core/loop-run/loop-run.ts:322-360` |
| Dashboard projects phases, metadata, and usage only | `applyLoopRunEventToInkState` | `src/core/loop-run/ink-state.ts:161-192` |
| Done requires successful verification | `handleTaskCompletion` | `src/core/ralph-loop.ts:500-529` |

## 4. Tests and documentation

- ADR-0011 specifies stable IDs, fail-closed malformed criteria, durable inline persistence, and retry behavior (`docs/adr/0011-stateful-per-criterion-verification-loop.md:23-52`).
- Tests verify positional identity freezing and evidence persistence (`test/loop-run.test.ts:400-490`).
- Verifier tests cover malformed statuses, missing overall verdicts, and explicit IDs (`test/verifier.test.ts:97-180`).
- No evidence was found for a criterion-verdict fact-event test or Live Dashboard criterion projection test.

## 5. Uncertainties

- The intended architecture may expect a future criterion event/projection joint; current event and projection types show it is not implemented.
- ADR-0011 states that parse failure cannot manufacture `met`, but the current implementation permits an overall `PASS` with zero parsed criteria (`src/core/actions/verifier.ts:281-321`), which appears inconsistent with that safety requirement.
