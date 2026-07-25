## 1. Executive summary

The implemented pipeline is complete through parsing and durable tracker persistence, but **not through criterion fact emission or criterion-specific dashboard projection**:

`runAgentExecution()` stdout → `runVerification()` parses criteria → `TaskPipeline` calls `LoopRun.recordCriterionVerdicts()` → tracker persists criteria and evidence.

`recordCriterionVerdicts()` emits no event. `LoopRunEvent` has no criterion-verdict event, and the Ink dashboard projection has no criterion-verdict field or reducer. Only subsequent task phase/meta events reach the dashboard.

## 2. Detailed flow / architecture / impact analysis

1. **Raw verifier stdout**
   - `runVerification()` receives `execResult.output` from `runAgentExecution()` and assigns it to `raw`.
   - It parses `<criterion>` blocks with `parseCriterionVerdicts()`, normalizing statuses to `met`, `unmet`, or `regressed`; malformed statuses become `unmet`.
   - The overall `<verdict>` tag independently controls `passed`.

2. **Task-pipeline boundary**
   - `TaskPipeline.executeTask()` calls `runVerification()`, stores `v.criteria`, then invokes `loopRun.recordCriterionVerdicts(issue.id, v.criteria)`.

3. **Stable criterion identity**
   - Explicit `id` values are preserved.
   - Missing IDs receive positional IDs such as `criterion-1`.
   - `LoopRun.resolveCriterionIdentity()` stores identities in `criterionIdentities`; later attempts reuse the stored ordinal identity, even if wording changes.
   - This is ordinal persistence, not text hashing.

4. **Durable Loop Run Tracker**
   - `recordCriterionVerdicts()` creates evidence artifacts for captured stdout, then writes `criteria`, `criterionIdentities`, and `evidenceRef` into the task record.
   - `LoopRunTracker.update()` increments the revision and performs an atomic write.
   - This satisfies write-before-observation only insofar as persistence is concerned.

5. **Fact-event boundary**
   - No criterion-verdict fact is emitted. `recordCriterionVerdicts()` ends after `tracker.update()`.
   - ADR-0007's write-then-emit discipline is implemented for task phase/meta methods, but not for criterion verdicts because there is no corresponding event or emit call.
   - The available event union contains `taskPhaseChanged` and `taskMetaChanged`, but no criterion-verdict event.

6. **Live Dashboard**
   - Ink state handles `taskPhaseChanged`, `taskMetaChanged`, usage, streaming usage, and run completion.
   - `WorkerDashboardRow` contains phase, metadata, and usage only; it has no criteria/verdict projection.
   - Therefore criterion verdicts are not reflected directly in the Live Dashboard. The dashboard may show the later `failed` or `done` phase, but not the per-criterion verdict.

7. **Protection against false completion**
   - Missing `<verdict>` produces `inconclusive` and `passed: false`.
   - Verifier execution errors produce `errored` and `passed: false`; after a retry, the task remains unverified and is marked failed.
   - Task completion requires both `taskResult.success` and `taskResult.verified`; only then is the issue marked done.
   - However, a verifier output containing `<verdict>PASS</verdict>` with malformed or missing criterion blocks can still set `passed: true`. The parser defaults malformed statuses to `unmet`, but completion does not independently require all persisted criteria to be `met`. This is a remaining correctness gap.

## 3. Evidence table

| Claim | Symbol | File:line |
|---|---|---|
| Verifier stdout becomes `raw` and is parsed into criteria | `runVerification`, `parseCriterionVerdicts` | `src/core/actions/verifier.ts:234-281` |
| Malformed criterion statuses normalize to `unmet` | `normalizeCriterionStatus` | `src/core/actions/verifier.ts:83-88` |
| Missing overall verdict is inconclusive and not passed | `runVerification` | `src/core/actions/verifier.ts:283-300` |
| Pipeline forwards parsed criteria to the Loop Run | `executeTask` | `src/core/utils/task-pipeline.ts:371-379` |
| Explicit IDs are preserved; omitted IDs use frozen ordinals | `recordCriterionVerdicts`, `resolveCriterionIdentity` | `src/core/loop-run/loop-run.ts:314-345; 620-636` |
| Evidence stdout is written and referenced from tracker state | `recordCriterionVerdicts` | `src/core/loop-run/loop-run.ts:346-365` |
| Tracker update increments revision and atomically writes | `LoopRunTracker.update` | `src/core/utils/loop-run-tracker.ts:132-140` |
| Criterion persistence emits no fact event | `recordCriterionVerdicts` | `src/core/loop-run/loop-run.ts:322-365` |
| Event union has no criterion-verdict event | `LoopRunEvent` | `src/core/loop-run/events.ts:99-124` |
| Dashboard reducer handles phases/meta, not criteria | `applyLoopRunEventToInkState` | `src/core/loop-run/ink-state.ts:158-202` |
| Worker projection has no criterion verdict fields | `WorkerDashboardRow` | `src/core/loop-run/ink-worker-projection.ts:8-19` |
| Done requires successful, verified task | `handleTaskCompletion` | `src/core/ralph-loop.ts:135-148` |
| ADR-0007 requires durable write before synchronous fact emission | ADR-0007 decision | `docs/adr/0007-loop-run-coordinator-and-fact-events.md:17-20` |

## 4. Tests and documentation

- Verifier parsing, malformed status fallback, missing verdict handling, and explicit IDs: `test/verifier.test.ts:98-179`.
- Positional identity freezing and evidence persistence: `test/loop-run.test.ts:400-489`.
- Legacy tracker compatibility: `test/loop-run-tracker.test.ts:27-56`.
- ADR-0007 defines the sole-writer and write-then-emit architecture: `docs/adr/0007-loop-run-coordinator-and-fact-events.md:17-20`.

No cited test establishes a criterion-verdict fact event or dashboard criterion projection.

## 5. Uncertainties

- The dashboard may intentionally expose only aggregate task phase rather than individual criteria; the current source provides no criterion-specific projection contract.
- The malformed-`PASS` completion gap is directly implied by the control flow, but no test was found covering that exact combination.
