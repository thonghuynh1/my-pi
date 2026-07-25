## 1. Executive summary

The pipeline currently parses verifier stdout and durably stores criterion verdicts, but it **does not emit a criterion-verdict fact event or project criteria into the Live Dashboard worker state**.

Malformed results do not mark tasks verified: missing overall verdicts produce `passed: false`; execution errors retry once and then fail closed. However, verification can be bypassed when disabled and the implementer emits `<promise>COMPLETE</promise>`.

## 2. Detailed flow / architecture / impact analysis

1. **Verifier execution and parsing**
   - `runVerification()` invokes `runAgentExecution()` and captures its stdout in `raw` (`src/core/actions/verifier.ts:234-240`).
   - `parseCriterionVerdicts()` extracts `<criterion>` blocks, normalizes statuses to `met`, `unmet`, or `regressed`, and assigns omitted IDs as `criterion-N` (`src/core/actions/verifier.ts:114-135`).
   - The overall `<verdict>PASS|FAIL</verdict>` is parsed separately (`src/core/actions/verifier.ts:281-305`).

2. **Pipeline handoff**
   - `TaskPipeline.executeTask()` calls `runVerification()`, then passes `v.criteria` to `loopRun.recordCriterionVerdicts()` (`src/core/utils/task-pipeline.ts:371-374`).
   - A verifier execution error is retried once; two errors terminate the task without verification (`src/core/utils/task-pipeline.ts:375-381`).

3. **Stable criterion identity and evidence**
   - `LoopRun.recordCriterionVerdicts()` preserves explicit IDs.
   - For omitted IDs, `resolveCriterionIdentity()` freezes the first-seen positional identity and reuses it on later attempts (`src/core/loop-run/loop-run.ts:619-637`).
   - Raw criterion stdout is stored as a run-scoped SHA-256-named artifact; only its relative reference is persisted inline (`src/core/loop-run/loop-run.ts:343-355`, `639-671`).

4. **Durable Loop Run Tracker persistence**
   - `recordCriterionVerdicts()` updates the task’s `criteria` and `criterionIdentities` through `tracker.update()` (`src/core/loop-run/loop-run.ts:358-369`).
   - `LoopRunTracker.update()` increments the revision and calls `atomicWrite()` (`src/core/utils/loop-run-tracker.ts:132-140`).
   - `atomicWrite()` writes a temporary JSON file and renames it into place, providing crash-safe replacement (`src/core/utils/loop-run-tracker.ts:371-385`).

5. **Fact-event boundary**
   - ADR-0007’s general discipline is implemented by Loop Run methods that write first and call `emit()` only afterward (`src/core/loop-run/loop-run.ts:276-310`).
   - **`recordCriterionVerdicts()` has no corresponding `emit()` call** (`src/core/loop-run/loop-run.ts:322-369`).
   - `LoopRunEvent` contains task-phase, metadata, usage, steering, and run events, but no criterion-verdict event (`src/core/loop-run/events.ts:122-139`).
   - Therefore, criterion verdicts are persisted but are not emitted as a criterion fact event.

6. **Live Dashboard worker projection**
   - `applyLoopRunEventToInkState()` projects task phases, metadata, usage, streaming usage, and run completion (`src/core/loop-run/ink-state.ts:161-200`).
   - `WorkerDashboardRow` contains phase, title, timestamps, and usage, but no criteria field (`src/core/loop-run/ink-worker-projection.ts:9-20`).
   - Thus the dashboard reflects transitions such as `verifying` and `failed`, but not the persisted per-criterion verdicts.

7. **Protection against false completion**
   - Missing overall verdict tags produce an `inconclusive` result with `passed: false` (`src/core/actions/verifier.ts:283-301`).
   - Invalid criterion statuses become `unmet`, rather than being accepted (`src/core/actions/verifier.ts:83-88`).
   - Failed verification sets task feedback and ultimately moves the task to `failed` (`src/core/utils/task-pipeline.ts:390-411`).
   - A verifier crash is retried once and then fails closed (`src/core/utils/task-pipeline.ts:375-381`).
   - Inference: these guards prevent malformed verifier output from silently completing a normally verified task, except when verification is explicitly disabled (`src/core/utils/task-pipeline.ts:329-332`).

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| Raw verifier stdout is captured | `runVerification` | `src/core/actions/verifier.ts:234-240` |
| Criterion blocks are parsed and default IDs generated | `parseCriterionVerdicts` | `src/core/actions/verifier.ts:114-135` |
| Invalid statuses normalize to `unmet` | `normalizeCriterionStatus` | `src/core/actions/verifier.ts:83-88` |
| Missing overall verdict is inconclusive and not passed | `runVerification` | `src/core/actions/verifier.ts:283-301` |
| Pipeline persists parsed criteria | `executeTask` | `src/core/utils/task-pipeline.ts:371-374` |
| Verifier errors retry once, then fail closed | `executeTask` | `src/core/utils/task-pipeline.ts:375-381` |
| Positional criterion identity is frozen | `resolveCriterionIdentity` | `src/core/loop-run/loop-run.ts:619-637` |
| Verdicts and evidence references are persisted | `recordCriterionVerdicts` | `src/core/loop-run/loop-run.ts:322-369` |
| Tracker writes are revisioned and atomic | `update`, `atomicWrite` | `src/core/utils/loop-run-tracker.ts:132-140, 371-385` |
| No criterion fact event exists | `LoopRunEvent` | `src/core/loop-run/events.ts:122-139` |
| Dashboard projects phases/usages only | `applyLoopRunEventToInkState` | `src/core/loop-run/ink-state.ts:161-200` |
| Worker rows have no criteria projection | `WorkerDashboardRow` | `src/core/loop-run/ink-worker-projection.ts:9-20` |

## 4. Tests and documentation

- Verifier parsing, malformed statuses, missing verdicts, and explicit IDs are tested in `test/verifier.test.ts:97-179`.
- ADR-0007 is explicitly referenced by the tracker and event architecture documentation (`src/core/utils/loop-run-tracker.ts:1-10`; `src/core/loop-run/events.ts:1-10`).
- No discovered test demonstrates a criterion-verdict event or dashboard-criteria projection.

## 5. Uncertainties

- The repository may expose persisted criteria through another dashboard path not represented in the worker projection inspected here; the inspected `LoopRunEvent` and `WorkerDashboardRow` APIs provide no such path.
- The verifier module’s comment describes execution errors as “fail open,” but the actual pipeline behavior retries and then fails closed (`src/core/actions/verifier.ts:64-75`; `src/core/utils/task-pipeline.ts:375-381`).
