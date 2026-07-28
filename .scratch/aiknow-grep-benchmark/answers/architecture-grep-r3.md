## 1. Executive summary

The implemented pipeline parses verifier stdout and persists per-criterion verdicts, but it does **not** complete the requested event/dashboard path:

- `runVerification()` parses raw agent output into criterion records.
- `TaskPipeline` calls `LoopRun.recordCriterionVerdicts()`.
- `LoopRun` normalizes identities and durably writes criteria into the tracker.
- No `criterionVerdictsRecorded` fact event exists.
- The Live Dashboard worker projection has no criterion-verdict state or reducer.

Crashes and missing overall verdicts fail closed, but a malformed criterion can still be paired with `<verdict>PASS</verdict>` and mark the task verified.

## 2. Detailed flow / architecture / impact analysis

1. **Raw verifier stdout → parser**  
   `runVerification()` receives `runAgentExecution()` output as `raw`, then invokes `parseCriterionVerdicts(raw)` (`src/core/actions/verifier.ts:198-224, 280`). Criterion tags are parsed with regex; missing IDs receive positional IDs, and invalid statuses normalize to `unmet` (`verifier.ts:46-48, 114-139`).

2. **Criterion identity stabilization**  
   `LoopRun.recordCriterionVerdicts()` delegates identity handling to `resolveCriterionIdentity()` (`src/core/loop-run/loop-run.ts:316-350, 594-612`):
   - Explicit IDs are preserved.
   - Missing IDs use `criterion-N`.
   - Once assigned, positional identities are stored in `criterionIdentities` and reused on later attempts.
   - This is ordinal stability, not text hashing. Reordering or insertion remains a documented risk (`docs/adr/0011-stateful-per-criterion-verification-loop.md:29-39, 91-93`).

3. **Pipeline → Loop Run coordinator**  
   `TaskPipeline` records each verification result immediately after `runVerification()` returns (`src/core/utils/task-pipeline.ts:388-400`). Verifier execution errors are retried once; two errors break without verification (`task-pipeline.ts:392-399`).

4. **Loop Run → durable tracker**  
   `recordCriterionVerdicts()` constructs normalized records and calls `tracker.update()` (`src/core/loop-run/loop-run.ts:316-354`). `LoopRunTracker.update()` increments the revision and performs `atomicWrite()` (`src/core/utils/loop-run-tracker.ts:145-156, 390-405`). Evidence stdout is written by `InvocationBundle.writeEvidence()` before the coordinator receives its reference (`verifier.ts:280-284`; `loop-run.ts:313-315`).

5. **Write-then-emit discipline**  
   ADR-0007 requires the coordinator to write first and emit afterward (`docs/adr/0007-loop-run-coordinator-and-fact-events.md:17-24`). The event system documents that subscribers receive only already-persisted facts (`src/core/loop-run/events.ts:2-9`). However, `recordCriterionVerdicts()` currently emits **no event**, so the discipline is not exercised for criterion verdicts.

6. **Fact event → Live Dashboard**  
   This boundary is absent. `LoopRunEvent` contains phase, metadata, usage, lifecycle, and steering events, but no criterion-verdict event (`src/core/loop-run/events.ts:14-135`). `applyLoopRunEventToInkState()` handles phase, metadata, usage, streaming usage, and completion only (`src/core/loop-run/ink-state.ts:165-204`). `WorkerDashboardRow` contains no criteria field (`src/core/loop-run/ink-worker-projection.ts:8-20`).

7. **Task completion protection**  
   The issue source is marked done only when `taskResult.success && taskResult.verified`; the tracker records `mark-done-pending` before `markDone()`, then `done` afterward (`src/core/ralph-loop.ts:534-539`). Missing verdicts produce `passed: false` (`src/core/actions/verifier.ts:301-306`), and execution errors produce `passed: false`, are retried, and ultimately fail closed (`verifier.ts:221-276`; `task-pipeline.ts:392-399`).

   **Gap:** overall PASS is trusted independently of criterion statuses (`verifier.ts:315-344`). Thus `<criterion status="maybe">…</criterion><verdict>PASS</verdict>` normalizes the criterion to `unmet` but still returns `passed: true`.

## 3. Evidence table

| Claim | Symbol | File:line |
|---|---|---|
| Raw agent output is parsed into criteria | `runVerification`, `parseCriterionVerdicts` | `src/core/actions/verifier.ts:198-224, 280-306` |
| Invalid criterion status becomes `unmet` | `normalizeCriterionStatus` | `src/core/actions/verifier.ts:84-91` |
| Explicit IDs and ordinal fallback are stabilized | `recordCriterionVerdicts`, `resolveCriterionIdentity` | `src/core/loop-run/loop-run.ts:316-350, 594-612` |
| Criteria are durably stored inline | `tracker.update` | `src/core/loop-run/loop-run.ts:350-354` |
| Tracker writes are revisioned and atomic | `LoopRunTracker.update`, `atomicWrite` | `src/core/utils/loop-run-tracker.ts:145-156, 390-405` |
| Pipeline records every verifier result | `recordCriterionVerdicts` calls | `src/core/utils/task-pipeline.ts:388-400` |
| No criterion fact event exists | `LoopRunEvent` | `src/core/loop-run/events.ts:14-135` |
| Dashboard projection lacks criteria | `WorkerDashboardRow` | `src/core/loop-run/ink-worker-projection.ts:8-20` |
| Dashboard reducer handles no criterion event | `applyLoopRunEventToInkState` | `src/core/loop-run/ink-state.ts:165-204` |
| Task completion requires `verified` | completion branch | `src/core/ralph-loop.ts:534-539` |
| Missing verdict fails closed | inconclusive result | `src/core/actions/verifier.ts:301-306` |
| PASS can bypass unmet criteria | `passed` calculation | `src/core/actions/verifier.ts:315-344` |

## 4. Tests and documentation

Tests cover parsing, malformed status fallback, missing overall verdicts, explicit IDs, retry behavior, ordinal identity persistence, and tracker round-tripping (`test/verifier.test.ts:96-177`; `test/loop-run.test.ts:350-437`).

ADR-0011 specifies fail-closed per-criterion semantics and durable tracker persistence (`docs/adr/0011-stateful-per-criterion-verification-loop.md:39-62`), but the current implementation does not enforce criterion status when deciding overall PASS.

No test or implementation evidence was found for a criterion fact event or dashboard criterion projection.

## 5. Uncertainties

- ADR-0011 describes execution errors as inconclusive/fail-closed, while its context mentions an older fail-open behavior; current code returns `passed: false`.
- The requested “fact event” and “worker projection” stages appear planned but are not implemented for per-criterion verdicts.
- Positional identity can mis-map criteria if acceptance criteria are reordered between attempts, as explicitly acknowledged by ADR-0011.
