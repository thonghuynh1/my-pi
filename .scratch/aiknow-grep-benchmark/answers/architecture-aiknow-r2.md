## 1. Executive summary

The implemented pipeline is:

1. `runVerification()` parses verifier stdout into overall and per-criterion verdicts.
2. `TaskPipeline.executeTask()` passes parsed criteria to `LoopRun.recordCriterionVerdicts()`.
3. `recordCriterionVerdicts()` stabilizes IDs, writes stdout evidence artifacts, and atomically updates the Loop Run Tracker.
4. Verification phase transitions emit `taskPhaseChanged` events after tracker persistence.
5. The Ink worker projection consumes those phase events.

However, the per-criterion verdict itself is **not emitted as a fact event** and is **not represented in the Live Dashboard worker projection**. Only the surrounding task phase changes are emitted/projected.

## 2. Detailed flow / architecture / impact analysis

### 1. Raw stdout → parsed verdicts

`runVerification()` receives the verifier execution output as `raw`. It rejects unsuccessful execution as `outcome.kind: "errored"` and `passed: false` [src/core/actions/verifier.ts:261-278].

For successful execution, `parseCriterionVerdicts(raw)` scans `<criterion ...>...</criterion>` blocks [src/core/actions/verifier.ts:281-283]. Each block:

- Preserves an explicit `id`.
- Generates `criterion-N` when the ID is absent.
- Assigns an ordinal.
- Normalizes invalid statuses to `"unmet"`.
- Extracts embedded fenced stdout [src/core/actions/verifier.ts:114-134].

The overall verdict requires an explicit `<verdict>` tag. Missing tags produce `outcome.kind: "inconclusive"` and `passed: false` [src/core/actions/verifier.ts:283-301]. Only an explicit `PASS` sets `passed: true` [src/core/actions/verifier.ts:304-321].

### 2. Pipeline → Loop Run Tracker

`TaskPipeline.executeTask()` invokes `runVerification()`, stores `v.criteria`, and calls `loopRun.recordCriterionVerdicts(issue.id, v.criteria)` [src/core/utils/task-pipeline.ts:342-373].

`recordCriterionVerdicts()`:

- Requires an active Loop Run.
- Reads the current tracker state.
- Resolves stable criterion identities.
- Writes verifier stdout as a run-scoped artifact.
- Stores only the artifact reference inline.
- Updates the task’s `criteria` and `criterionIdentities` fields [src/core/loop-run/loop-run.ts:322-369].

Identity stability is provided by `resolveCriterionIdentity()`:

- Explicit IDs are preserved and replace the identity at that ordinal.
- Missing IDs reuse the previously frozen identity for that ordinal.
- Otherwise, `criterion-N` is generated and frozen [src/core/loop-run/loop-run.ts:619-637].

Evidence stdout is content-addressed using a truncated SHA-256 filename and written through a temporary file followed by rename [src/core/loop-run/loop-run.ts:639-670].

### 3. Durability and ADR-0007 discipline

Tracker updates use `LoopRunTracker.update()`, which reads the current snapshot, increments its revision, and calls `atomicWrite()` [src/core/utils/loop-run-tracker.ts:132-141].

`atomicWrite()` writes JSON to `.tmp`, then renames it into the active tracker path; Windows rename collisions are handled explicitly [src/core/utils/loop-run-tracker.ts:371-385].

For task phases, ADR-0007’s write-then-emit rule is explicit: `recordTaskPhase()` performs tracker writes first and calls `emit()` only afterward. If persistence throws, no fact event is emitted [src/core/loop-run/loop-run.ts:275-300].

The criterion-specific method does persist first, but it does **not** call `emit()` afterward [src/core/loop-run/loop-run.ts:358-369].

### 4. Fact event boundary

Before verification, the pipeline records `"verify-pending"` and `"verifying"` phases [src/core/utils/task-pipeline.ts:342-345].

Those phase writes emit `taskPhaseChanged` events after persistence [src/core/loop-run/loop-run.ts:282-299]. `LoopRunEvent` contains task phase, metadata, usage, steering, and lifecycle events, but no criterion-verdict event type [src/core/loop-run/events.ts:122-141].

Therefore, the criterion verdict is durably persisted but is **not emitted as its own fact event**.

### 5. Live Dashboard projection

The Ink reducer handles `taskPhaseChanged` by calling `applyTaskPhaseToWorkerProjection()` [src/core/loop-run/ink-state.ts:161-177].

That projection stores worker issue ID, phase, phase records, timestamps, metadata, and usage; `WorkerDashboardRow` has no criterion-verdict field [src/core/loop-run/ink-worker-projection.ts:9-20].

Consequently, the dashboard reflects `"verifying"` or `"failed"`/other task phases, not individual criterion statuses.

### 6. Protection against false completion

The pipeline marks a task verified only when `v.passed` is true [src/core/utils/task-pipeline.ts:383-387]. Protection includes:

- Missing overall verdict tag → `passed: false` [src/core/actions/verifier.ts:283-301].
- Invalid criterion status → `"unmet"` rather than silently dropping the criterion [src/core/actions/verifier.ts:83-87].
- Failed verifier execution → `"errored"` and `passed: false`; a second attempt is made [src/core/actions/verifier.ts:261-278; src/core/utils/task-pipeline.ts:375-381].
- Two verifier failures cause a fail-closed break [src/core/utils/task-pipeline.ts:379-381].
- Failed or incomplete implementation output does not enter successful verification [src/core/utils/task-pipeline.ts:302-327].
- A non-verified task is recorded as `"failed"` unless manually skipped/interrupted [src/core/utils/task-pipeline.ts:409-411].

## 3. Evidence table

| Claim | Symbol | File:line |
|---|---|---|
| Per-criterion blocks are parsed from raw verifier output | `parseCriterionVerdicts` | `src/core/actions/verifier.ts:114-134` |
| Invalid criterion statuses become `unmet` | `normalizeCriterionStatus` | `src/core/actions/verifier.ts:83-87` |
| Missing overall verdict is inconclusive and not passed | `runVerification` | `src/core/actions/verifier.ts:283-301` |
| Pipeline records parsed criteria | `executeTask` | `src/core/utils/task-pipeline.ts:371-374` |
| Stable IDs are frozen by ordinal | `resolveCriterionIdentity` | `src/core/loop-run/loop-run.ts:619-637` |
| Criteria and evidence references are persisted | `recordCriterionVerdicts` | `src/core/loop-run/loop-run.ts:322-369` |
| Tracker writes are atomic | `atomicWrite` | `src/core/utils/loop-run-tracker.ts:371-385` |
| Phase events obey write-then-emit | `recordTaskPhase` | `src/core/loop-run/loop-run.ts:275-300` |
| No criterion event exists in the Loop Run event union | `LoopRunEvent` | `src/core/loop-run/events.ts:122-141` |
| Dashboard projects task phases, not criteria | `applyLoopRunEventToInkState` | `src/core/loop-run/ink-state.ts:161-177` |
| Worker rows contain no criterion verdicts | `WorkerDashboardRow` | `src/core/loop-run/ink-worker-projection.ts:9-20` |
| Double verifier failure fails closed | `executeTask` | `src/core/utils/task-pipeline.ts:375-381` |

## 4. Tests and documentation

Tests directly cover:

- PASS and FAIL parsing [test/verifier.test.ts:37-76].
- Per-criterion parsing and ordering [test/verifier.test.ts:97-119].
- Malformed criterion status defaulting to `unmet` [test/verifier.test.ts:121-139].

The implementation comments document write-then-emit behavior for phase events [src/core/loop-run/loop-run.ts:275-280] and stable criterion identity behavior [src/core/loop-run/loop-run.ts:313-320].

No cited test or event definition demonstrates a criterion-specific fact event or criterion data in the dashboard projection.

## 5. Uncertainties

- The repository may have an external log/artifact consumer not represented in `LoopRunEvent`; the inspected Loop Run event union and Ink projection do not expose criterion verdict events.
- The verifier result interface comment says execution errors “fail open,” but the current implementation returns `passed: false` for execution errors and the task pipeline retries then fails closed [src/core/actions/verifier.ts:64-75; src/core/utils/task-pipeline.ts:375-381].
