## 1. Executive summary

The implemented pipeline is:

`runAgentExecution()` → `runVerification()` → `TaskPipeline` → `LoopRun.recordCriterionVerdicts()` → `LoopRunTracker.update()`.

Criterion identity is stable: explicit IDs are preserved; missing IDs become positional `criterion-N` identities frozen across retries.

However, the requested final stages are not implemented for criterion verdicts:

- `recordCriterionVerdicts()` persists criteria but emits no fact event.
- `LoopRunEvent` has no criterion-verdict event.
- The Live Dashboard worker projection handles phases and usage, not criteria.

Thus verdicts are durably stored in `.ralph-loop/runs/.../state.json`, but are neither emitted as facts nor projected into the dashboard.

## 2. Detailed flow / architecture / impact analysis

1. **Raw verifier stdout acquisition**

   `runVerification()` invokes `runAgentExecution()` and assigns `execResult.output` to `raw` (`src/core/actions/verifier.ts:218-236`).

2. **Criterion parsing and stable identification**

   `parseCriterionVerdicts(raw)` scans `<criterion>` blocks, extracts `id` and `status`, assigns ordinal positions, and generates `criterion-N` when an ID is absent (`src/core/actions/verifier.ts:114-134`).

   Statuses are normalized to `met`, `unmet`, or `regressed`; malformed statuses become `unmet` (`src/core/actions/verifier.ts:83-88`).

   The overall verdict is accepted only from `<verdict>PASS</verdict>` or `<verdict>FAIL</verdict>` (`src/core/actions/verifier.ts:46-49`, `288-309`). Missing the tag produces `inconclusive` and `passed: false` (`src/core/actions/verifier.ts:288-306`).

3. **Evidence artifact boundary**

   Fenced stdout inside each criterion is extracted and, when an invocation exists, written through `invocation.writeEvidence()` before the criterion result is returned (`src/core/actions/verifier.ts:102-111`, `280-285`).

4. **Task-pipeline boundary**

   `TaskPipeline` calls `runVerification()`, stores the returned criteria, and passes them to `loopRun.recordCriterionVerdicts()` (`src/core/utils/task-pipeline.ts:356-390`).

   A verifier error is retried once. Two execution errors cause the task attempt to fail rather than verify (`src/core/utils/task-pipeline.ts:392-400`). Only `v.passed` permits `verified = true` (`src/core/utils/task-pipeline.ts:402-405`); otherwise the task is recorded as failed (`src/core/utils/task-pipeline.ts:427-429`).

5. **Loop Run / tracker persistence**

   `LoopRun.recordCriterionVerdicts()`:

   - Reads the current tracker state.
   - Resolves explicit IDs or frozen positional identities.
   - Normalizes status and stores evidence references.
   - Calls `tracker.update()` to persist the task record (`src/core/loop-run/loop-run.ts:316-360`).

   `LoopRunTracker.update()` increments the revision and calls `atomicWrite()` (`src/core/utils/loop-run-tracker.ts:148-157`). `atomicWrite()` writes a temporary state file and atomically renames it, then updates the active-run pointer (`src/core/utils/loop-run-tracker.ts:389-416`).

6. **ADR-0007 write-then-emit discipline**

   The coordinator documents that subscribers receive facts only after durable writes (`src/core/loop-run/loop-run.ts:2-10`; `src/core/loop-run/events.ts:1-9`).

   Phase and metadata methods enforce this by calling tracker writes before `emit()` (`src/core/loop-run/loop-run.ts:270-304`). Tests verify that subscribers observe persisted state and that failed writes emit nothing (`test/loop-run.test.ts:42-63`, `100-105`).

   **Criterion persistence is an exception in functionality, not ordering:** `recordCriterionVerdicts()` writes first but ends at line 361 without emitting an event (`src/core/loop-run/loop-run.ts:350-361`).

7. **Fact event and dashboard boundary**

   There is no criterion-verdict event in `LoopRunEvent`; the union contains task phases, metadata, usage, steering, and run lifecycle events only (`src/core/loop-run/events.ts:117-133`).

   `applyLoopRunEventToInkState()` handles task phases, metadata, usage, streaming usage, and run completion, but no criterion event (`src/core/loop-run/ink-state.ts:161-200`).

   `WorkerDashboardRow` contains phase, timing, usage, and streaming usage fields, but no criterion/verdict field (`src/core/loop-run/ink-worker-projection.ts:9-20`).

## 3. Evidence table

| Claim | Symbol | File:line |
|---|---|---|
| Verifier stdout becomes `raw` | `runVerification` | `src/core/actions/verifier.ts:218-236` |
| Criterion blocks are parsed by ordinal | `parseCriterionVerdicts` | `src/core/actions/verifier.ts:114-134` |
| Invalid criterion status defaults to `unmet` | `normalizeCriterionStatus` | `src/core/actions/verifier.ts:83-88` |
| Missing overall verdict is inconclusive | `runVerification` | `src/core/actions/verifier.ts:288-306` |
| Criteria reach the Loop Run | `TaskPipeline` verification flow | `src/core/utils/task-pipeline.ts:388-400` |
| Explicit IDs and positional identities are stabilized | `resolveCriterionIdentity` | `src/core/loop-run/loop-run.ts:594-612` |
| Criteria are persisted inline | `recordCriterionVerdicts` | `src/core/loop-run/loop-run.ts:316-361` |
| Tracker updates are revisioned and atomic | `update`, `atomicWrite` | `src/core/utils/loop-run-tracker.ts:148-157`, `389-416` |
| No criterion event exists | `LoopRunEvent` | `src/core/loop-run/events.ts:117-133` |
| Dashboard does not consume criterion events | `applyLoopRunEventToInkState` | `src/core/loop-run/ink-state.ts:161-200` |
| Two verifier execution errors fail closed | `TaskPipeline` retry logic | `src/core/utils/task-pipeline.ts:392-400` |
| Failed verification records task failure | `TaskPipeline` finalization | `src/core/utils/task-pipeline.ts:427-429` |

## 4. Tests and documentation

- Parser tests cover per-criterion parsing, malformed status normalization, missing overall verdicts, and explicit IDs (`test/verifier.test.ts:96-178`).
- Loop Run tests cover frozen positional identities and durable evidence persistence (`test/loop-run.test.ts:350-438`).
- Write-then-emit behavior is tested for task phases, including suppression after tracker failure (`test/loop-run.test.ts:42-63`, `100-105`).
- ADR-0007 is referenced directly in the Loop Run and event-module documentation (`src/core/loop-run/loop-run.ts:6-10`; `src/core/loop-run/events.ts:1-9`).

## 5. Uncertainties

- The inspected code does not show a criterion-verdict fact event or dashboard projection; this appears to be an incomplete feature slice rather than an alternate implementation elsewhere.
- Malformed **criterion status** alone does not prevent completion if the verifier emits an overall `PASS`; it is normalized to `unmet`, but `TaskPipeline` branches on `v.passed` (`src/core/actions/verifier.ts:83-88`, `src/core/utils/task-pipeline.ts:402-405`). Missing or malformed overall verdicts do fail closed.
