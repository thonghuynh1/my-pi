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
