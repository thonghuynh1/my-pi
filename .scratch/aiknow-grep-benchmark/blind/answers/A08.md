## 1. Executive summary

The implemented pipeline is:

`verifier stdout → runVerification() parser → TaskPipeline → LoopRun.recordCriterionVerdicts() → atomic tracker state`

The requested later stages do **not currently exist** for per-criterion verdicts:

- `recordCriterionVerdicts()` persists criteria but emits no criterion-specific fact event.
- `LoopRunEvent` has no criterion-verdict event.
- `ink-worker-projection.ts` has no criterion field or reducer.
- The Live Dashboard therefore reflects verification indirectly through phase/meta events, not verdicts themselves.

Malformed or crashed verification cannot mark a task done: malformed statuses normalize to `unmet`; missing overall verdict is `inconclusive`; execution errors retry once and then fail closed.

## 2. Detailed flow / architecture / impact analysis

1. **Raw stdout acquisition**  
   `runVerification()` calls `runAgentExecution()` and assigns `execResult.output` to `raw` (`src/core/actions/verifier.ts:234-239`).

2. **Criterion parsing and stable identification**  
   `parseCriterionVerdicts(raw)` scans `<criterion>` blocks, extracts attributes/evidence, assigns temporary positional IDs (`criterion-1`, etc.), and normalizes unknown statuses to `unmet` (`src/core/actions/verifier.ts:83-87,114-136`).  
   Explicit IDs are retained; missing IDs initially receive positional ordinals (`src/core/actions/verifier.ts:120-133`).

3. **Overall verdict validation**  
   A separate `<verdict>PASS|FAIL</verdict>` tag is required. Missing tags produce `inconclusive` with `passed: false` (`src/core/actions/verifier.ts:281-300`).

4. **Pipeline handoff**  
   `TaskPipeline` receives the structured result and invokes `loopRun.recordCriterionVerdicts(issue.id, v.criteria)` (`src/core/utils/task-pipeline.ts:370-379`).

5. **Durable Loop Run persistence**  
   `LoopRun.recordCriterionVerdicts()` reads the current task, resolves each identity, writes captured stdout to an evidence artifact, and stores `{id,status,evidenceProse,evidenceRef}` in the task record (`src/core/loop-run/loop-run.ts:322-358`).  
   Identity stability is enforced by:
   - preserving explicit IDs;
   - freezing missing IDs by ordinal in `criterionIdentities`;
   - reusing the frozen ordinal identity on later attempts;
   - never hashing criterion text (`src/core/loop-run/loop-run.ts:619-636`).  
   The tracker update increments revision and atomically replaces the state file via temp-file write and rename (`src/core/utils/loop-run-tracker.ts:133-145,375-390`).

6. **ADR-0007 write-then-emit discipline**  
   The general coordinator contract is write first, then synchronously emit facts; failed writes emit nothing (`src/core/loop-run/loop-run.ts:276-280`, `src/core/loop-run/events.ts:4-9`).  
   However, `recordCriterionVerdicts()` performs the tracker update and returns without calling `emit()` (`src/core/loop-run/loop-run.ts:358-369`). Thus no criterion-verdict fact is currently emitted.

7. **Live Dashboard projection**  
   Ink consumes subscribed `LoopRunEvent`s through `applyLoopRunEventToInkState()` (`src/core/loop-run/ink-ui.ts:206-210`). The worker projection handles only task phase, task metadata, usage, and streaming usage (`src/core/loop-run/ink-state.ts:167-192`). `WorkerDashboardRow` contains no criterion verdict data (`src/core/loop-run/ink-worker-projection.ts:5-20`). Therefore persisted per-criterion verdicts are not reflected in the worker projection.

8. **Protection against false completion**  
   `TaskPipeline` sets `verified = true` only when `v.passed` is true; otherwise it records failure after attempts are exhausted (`src/core/utils/task-pipeline.ts:383-418`).  
   - Unknown criterion statuses become `unmet` (`src/core/actions/verifier.ts:83-87`).
   - Missing overall verdict becomes `inconclusive` and fails (`src/core/actions/verifier.ts:283-300`).
   - Execution failure becomes `errored`; after one retry, the pipeline breaks and fails closed (`src/core/utils/task-pipeline.ts:375-381`).
   - A crashed verifier returns `passed: false` (`src/core/actions/verifier.ts:243-278`).

## 3. Evidence table

| Claim | Symbol | File:line |
|---|---|---|
| Verifier stdout becomes `raw` | `runVerification` | `src/core/actions/verifier.ts:234-239` |
| Criterion blocks are parsed from stdout | `parseCriterionVerdicts` | `src/core/actions/verifier.ts:114-136` |
| Malformed statuses default to `unmet` | `normalizeCriterionStatus` | `src/core/actions/verifier.ts:83-87` |
| Missing overall verdict is inconclusive | `runVerification` | `src/core/actions/verifier.ts:281-300` |
| Pipeline forwards criteria to Loop Run | `TaskPipeline.run` | `src/core/utils/task-pipeline.ts:370-379` |
| Criteria are persisted in task state | `recordCriterionVerdicts` | `src/core/loop-run/loop-run.ts:322-358` |
| Explicit IDs and frozen ordinal IDs are resolved | `resolveCriterionIdentity` | `src/core/loop-run/loop-run.ts:619-636` |
| Tracker writes are revisioned and atomic | `update`, `atomicWrite` | `src/core/utils/loop-run-tracker.ts:133-145,375-390` |
| Fact events are emitted after durable writes | `LoopRun` contract | `src/core/loop-run/loop-run.ts:276-280` |
| No criterion event exists in event union | `LoopRunEvent` | `src/core/loop-run/events.ts:122-139` |
| Dashboard handles phase/meta/usage, not criteria | `applyLoopRunEventToInkState` | `src/core/loop-run/ink-state.ts:167-192` |
| Verifier errors fail closed after one retry | `TaskPipeline.run` | `src/core/utils/task-pipeline.ts:375-381` |

## 4. Tests and documentation

- Parser tests cover explicit criterion parsing, malformed status fallback, missing overall verdict, and explicit IDs (`test/verifier.test.ts:97-179`).
- Persistence tests cover frozen positional identities and evidence artifact references (`test/loop-run.test.ts:400-490`).
- ADR-0011 specifies stable criterion identity, fail-closed parsing, durable tracker persistence, and bounded verifier retry (`docs/adr/0011-stateful-per-criterion-verification-loop.md`).
- ADR-0007 specifies sole-writer and write-then-emit semantics (`docs/adr/0007-loop-run-coordinator-and-fact-events.md`).

## 5. Uncertainties

- The intended criterion-verdict fact event and Dashboard criterion projection may be planned work, but no implementation evidence exists in the current source.
- ADR-0007 allows finer-grained events when needed, but the current event vocabulary deliberately contains only lifecycle-level events (`docs/adr/0007-loop-run-coordinator-and-fact-events.md`).

