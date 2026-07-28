## 1. Executive summary

The implemented pipeline is:

`verifier stdout → runVerification → TaskPipeline → LoopRun.recordCriterionVerdicts → LoopRunTracker.atomicWrite`

Criterion identities are stable: explicit IDs are preserved; missing IDs become positional `criterion-N` identities frozen in `criterionIdentities`.

However, the requested pipeline is incomplete:

- Criterion verdicts are durably persisted.
- No criterion-verdict fact event is emitted.
- The Live Dashboard has no criterion-verdict event or projection; it only projects task phases and usage.
- Task completion is guarded by `taskResult.verified`, which requires an explicit `<verdict>PASS</verdict>`.

## 2. Detailed flow / architecture / impact analysis

1. **Raw verifier output**
   - `runVerification` calls `runAgentExecution`, receives `execResult.output`, and treats it as raw verifier stdout.
   - Execution failures return `outcome.kind === "errored"` and `passed: false`.

2. **Stable parsing**
   - `parseCriterionVerdicts` scans `<criterion ...>...</criterion>` blocks.
   - Statuses outside `met`, `unmet`, or `regressed` normalize to `unmet`.
   - Explicit `id` values are retained.
   - Missing IDs initially receive ordinal IDs such as `criterion-1`.
   - Missing overall `<verdict>PASS|FAIL</verdict>` produces `inconclusive` with `passed: false`.

3. **Evidence boundary**
   - Fenced stdout inside a criterion is extracted.
   - `InvocationBundle.writeEvidence` writes the artifact before the criterion is passed to `LoopRun.recordCriterionVerdicts`; only its reference is persisted in the task record.

4. **Task pipeline boundary**
   - `TaskPipeline.executeTask` records the parsed criteria after every verification attempt.
   - Verifier errors are retried once. A second verifier error breaks without setting `verified`.
   - Only `v.passed` sets `verified = true`.

5. **Identity stability**
   - `LoopRun.recordCriterionVerdicts` copies existing `criterionIdentities`.
   - Explicit IDs overwrite the identity at that ordinal.
   - For an omitted ID, an existing ordinal identity is reused; otherwise `criterion-N` is generated and frozen.
   - Thus wording changes across attempts cannot change an omitted criterion’s positional identity.

6. **Durable persistence / ADR-0007**
   - `recordCriterionVerdicts` calls `tracker.update`.
   - `LoopRunTracker.update` reads the current snapshot, increments `revision`, and calls `atomicWrite`.
   - `atomicWrite` writes `state.json` to a temporary file and renames it, then atomically updates the active-run pointer.
   - Unlike phase, usage, and steering methods, `recordCriterionVerdicts` currently does **not** call `emit` afterward. Therefore ADR-0007’s write-then-emit sequence is enforced for other fact types, but no verdict fact exists to emit here.

7. **Fact-event boundary**
   - `events.ts` defines task-phase, metadata, usage, steering, review, snapshot, and run-finished events.
   - It defines no `criterionVerdictsRecorded` event.
   - Consequently, no criterion verdict crosses the event bus.

8. **Live Dashboard projection**
   - `applyLoopRunEventToInkState` handles `taskPhaseChanged`, `taskMetaChanged`, `usageRecorded`, `streamingUsage`, and `runFinished`.
   - `WorkerDashboardRow` contains phase, metadata, and usage fields but no criteria field.
   - Therefore the dashboard cannot reflect persisted per-criterion verdicts; it only reflects the related phase transition to `verifying`, `failed`, or `done`.

9. **Protection against false completion**
   - `handleTaskCompletion` marks the issue done only when both `taskResult.success` and `taskResult.verified` are true.
   - `verified` is set only after `v.passed`, which requires an explicit PASS tag.
   - Malformed statuses become `unmet`; missing overall verdicts are inconclusive and false; crashed verifiers remain false and are retried, then fail closed after the second error.
   - Failed or inconclusive verification records the task as failed/open rather than calling `markDone`.

## 3. Evidence table

| Claim | Symbol | File:line |
|---|---|---|
| Verifier output is obtained from agent execution | `runVerification` | `src/core/actions/verifier.ts:218-236` |
| Criterion blocks are parsed from raw output | `parseCriterionVerdicts` | `src/core/actions/verifier.ts:114-134` |
| Invalid criterion statuses normalize to `unmet` | `normalizeCriterionStatus` | `src/core/actions/verifier.ts:83-88` |
| Missing overall verdict is inconclusive and not passed | `runVerification` | `src/core/actions/verifier.ts:288-306` |
| Evidence stdout is written before persistence | `runVerification` | `src/core/actions/verifier.ts:280-286` |
| Pipeline records criteria after each verifier attempt | `executeTask` | `src/core/utils/task-pipeline.ts:388-400` |
| Only a passed verification sets `verified` | `executeTask` | `src/core/utils/task-pipeline.ts:402-406` |
| Explicit and positional identities are resolved | `resolveCriterionIdentity` | `src/core/loop-run/loop-run.ts:594-612` |
| Criterion verdicts are persisted in the task record | `recordCriterionVerdicts` | `src/core/loop-run/loop-run.ts:316-361` |
| Tracker updates increment revision and atomically write | `LoopRunTracker.update` | `src/core/utils/loop-run-tracker.ts:148-157` |
| Atomic state and active pointer writes | `atomicWrite` | `src/core/utils/loop-run-tracker.ts:390-410` |
| ADR-0007 subscriber events occur after writes | `LoopRun.emit` / coordinator contract | `src/core/loop-run/loop-run.ts:1-14, 69-75, 582-586` |
| No criterion-verdict event is defined | `LoopRunEvent` | `src/core/loop-run/events.ts:117-133` |
| Dashboard handles only phase, metadata, usage, streaming, and finish events | `applyLoopRunEventToInkState` | `src/core/loop-run/ink-state.ts:161-200` |
| Dashboard worker rows contain no criteria projection | `WorkerDashboardRow` | `src/core/loop-run/ink-worker-projection.ts:9-20` |
| Task completion requires verified success | `handleTaskCompletion` | `src/core/ralph-loop.ts:526-555` |

## 4. Tests and documentation

- Verifier tests cover per-criterion parsing, malformed statuses, missing overall verdicts, and explicit IDs: `test/verifier.test.ts:96-178`.
- The audit records positional identity freezing and tracker persistence as verified: `.audit/01-per-criterion-verdict-verify.tsv:5-13`.
- ADR-0007 and the write-then-emit contract are documented in `src/core/loop-run/loop-run.ts:1-14` and `src/core/loop-run/events.ts:1-10`.
- Dashboard tests cover worker phase and usage projection, not criterion verdict projection: `test/ink-state.test.ts:171-220`.

## 5. Uncertainties

- The repository may contain an external or future consumer that reads `TaskRecord.criteria` directly, but no such event-driven dashboard path is present in the inspected implementation.
- `runVerification` documentation says execution errors historically failed open, but current `TaskPipeline` behavior retries once and then fails closed (`src/core/utils/task-pipeline.ts:392-400`).
