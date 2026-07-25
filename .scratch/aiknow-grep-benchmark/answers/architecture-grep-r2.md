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
