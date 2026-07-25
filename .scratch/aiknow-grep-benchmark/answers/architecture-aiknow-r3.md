## 1. Executive summary

The implemented pipeline is:

`runAgentExecution` → `runVerification` → `TaskPipeline.executeTask` → `LoopRun.recordCriterionVerdicts` → `LoopRunTracker.update` → atomic `active.json` write.

Criterion identities are stabilized by explicit IDs or frozen ordinal IDs (`criterion-N`). Verifier stdout evidence is stored as a content-addressed artifact, with only its path persisted inline.

However, the requested final two stages do **not currently exist for per-criterion verdicts**: `recordCriterionVerdicts` emits no fact event, and the event union/dashboard projection contains no criterion-verdict event or criterion state. Only task phase, metadata, usage, and streaming-usage events reach the Live Dashboard.

## 2. Detailed flow / architecture / impact analysis

1. **Raw verifier execution and parsing**  
   `runVerification` invokes `runAgentExecution`, captures `execResult.output`, parses `<criterion>` blocks, and extracts `<verdict>PASS|FAIL</verdict>` ([`src/core/actions/verifier.ts:234-239`](src/core/actions/verifier.ts#L234-L239), [`src/core/actions/verifier.ts:281-304`](src/core/actions/verifier.ts#L281-L304)).

2. **Criterion identity stability**  
   `parseCriterionVerdicts` preserves explicit IDs. Missing IDs initially become positional `criterion-N` IDs ([`src/core/actions/verifier.ts:114-134`](src/core/actions/verifier.ts#L114-L134)).  
   `LoopRun.resolveCriterionIdentity` freezes the first identity for each ordinal and reuses it on later attempts; explicit IDs replace the ordinal slot ([`src/core/loop-run/loop-run.ts:619-637`](src/core/loop-run/loop-run.ts#L619-L637)).

3. **Pipeline handoff**  
   `TaskPipeline.executeTask` receives `v.criteria` and calls `loopRun.recordCriterionVerdicts(issue.id, v.criteria)` ([`src/core/utils/task-pipeline.ts:371-374`](src/core/utils/task-pipeline.ts#L371-L374)). A retry after verifier execution failure records the retry’s criteria too ([`src/core/utils/task-pipeline.ts:375-383`](src/core/utils/task-pipeline.ts#L375-L383)).

4. **Evidence durability**  
   `recordCriterionVerdicts` normalizes status, writes stdout under `.ralph-loop/criterion-evidence/.../<sha256>.txt`, and stores only `evidenceRef` in the task record ([`src/core/loop-run/loop-run.ts:322-368`](src/core/loop-run/loop-run.ts#L322-L368), [`src/core/loop-run/loop-run.ts:639-672`](src/core/loop-run/loop-run.ts#L639-L672)).

5. **Tracker persistence and ADR-0007 discipline**  
   The criterion update calls `tracker.update`; `LoopRunTracker.update` reads the snapshot, increments revision, and calls `atomicWrite` ([`src/core/utils/loop-run-tracker.ts:132-141`](src/core/utils/loop-run-tracker.ts#L132-L141)). `atomicWrite` writes a temporary file and renames it into place ([`src/core/utils/loop-run-tracker.ts:371-385`](src/core/utils/loop-run-tracker.ts#L371-L385)).  
   ADR-0007’s write-then-emit design is documented and implemented for coordinator events: subscribers run only after durable writes ([`src/core/loop-run/loop-run.ts:4-10`](src/core/loop-run/loop-run.ts#L4-L10), [`src/core/loop-run/loop-run.ts:607-610`](src/core/loop-run/loop-run.ts#L607-L610)). **But `recordCriterionVerdicts` has no corresponding `emit` call** ([`src/core/loop-run/loop-run.ts:358-369`](src/core/loop-run/loop-run.ts#L358-L369)).

6. **Fact event and dashboard impact**  
   `LoopRunEvent` has no criterion-verdict event; it includes task phases, metadata, usage, streaming usage, and lifecycle events ([`src/core/loop-run/events.ts:122-141`](src/core/loop-run/events.ts#L122-L141)).  
   Ink applies those supported events, but has no criterion-verdict branch ([`src/core/loop-run/ink-state.ts:161-200`](src/core/loop-run/ink-state.ts#L161-L200)). Worker projection state likewise contains phase, metadata, and usage—not criteria ([`src/core/loop-run/ink-worker-projection.ts:9-27`](src/core/loop-run/ink-worker-projection.ts#L9-L27)).

7. **Protection against false completion**  
   Missing overall verdict produces `inconclusive` with `passed: false` ([`src/core/actions/verifier.ts:283-301`](src/core/actions/verifier.ts#L283-L301)). Execution errors are retried and, after two failures, the task fails closed ([`src/core/utils/task-pipeline.ts:375-381`](src/core/utils/task-pipeline.ts#L375-L381)). Failed or unverified tasks are recorded as `failed` ([`src/core/utils/task-pipeline.ts:409-418`](src/core/utils/task-pipeline.ts#L409-L418)).  
   Successful task integration requires `taskResult.success && taskResult.verified` ([`src/core/utils/task-pipeline.ts:501-502`](src/core/utils/task-pipeline.ts#L501-L502)).

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| Verifier captures agent stdout | `runVerification` | `src/core/actions/verifier.ts:234-239` |
| Criterion blocks are parsed and ordinalized | `parseCriterionVerdicts` | `src/core/actions/verifier.ts:114-134` |
| Explicit/missing IDs are stabilized | `resolveCriterionIdentity` | `src/core/loop-run/loop-run.ts:619-637` |
| Verdicts and evidence references are persisted | `recordCriterionVerdicts` | `src/core/loop-run/loop-run.ts:322-368` |
| Stdout artifacts are atomically created | `writeCriterionEvidenceArtifact` | `src/core/loop-run/loop-run.ts:639-672` |
| Tracker revisions and writes are durable | `update`, `atomicWrite` | `src/core/utils/loop-run-tracker.ts:132-141, 371-385` |
| Fact subscribers run after writes | `emit` | `src/core/loop-run/loop-run.ts:607-610` |
| No criterion fact event exists | `LoopRunEvent` | `src/core/loop-run/events.ts:122-141` |
| Dashboard projects phases/usage only | `WorkerProjectionState`, `applyLoopRunEventToInkState` | `src/core/loop-run/ink-worker-projection.ts:22-27`; `src/core/loop-run/ink-state.ts:161-200` |
| Missing verdict cannot pass | `runVerification` | `src/core/actions/verifier.ts:283-301` |
| Double verifier failure fails closed | `executeTask` | `src/core/utils/task-pipeline.ts:375-381` |

## 4. Tests and documentation

- Verifier tests cover PASS/FAIL parsing, criterion parsing, malformed statuses defaulting to `unmet`, missing overall verdicts, and explicit IDs ([`test/verifier.test.ts:37-179`](test/verifier.test.ts#L37-L179)).
- Durable tracker round-trip behavior is tested ([`test/loop-run-tracker.test.ts:762-818`](test/loop-run-tracker.test.ts#L762-L818)).
- Fact-event/log artifact durability is tested for supported events ([`test/run-log-artifact.test.ts:25-66`](test/run-log-artifact.test.ts#L25-L66)).
- ADR-0007 is referenced in the coordinator, event, and tracker module documentation ([`src/core/loop-run/loop-run.ts:4-10`](src/core/loop-run/loop-run.ts#L4-L10), [`src/core/loop-run/events.ts:2-10`](src/core/loop-run/events.ts#L2-L10), [`src/core/utils/loop-run-tracker.ts:2-10`](src/core/utils/loop-run-tracker.ts#L2-L10)).

## 5. Uncertainties

- The current code treats an overall `PASS` as sufficient even if an individual parsed criterion has status `unmet` or `regressed`; the criterion statuses are persisted but do not independently gate `verified` ([`src/core/actions/verifier.ts:304-321`](src/core/actions/verifier.ts#L304-L321)).
- The requested “criterion fact event” and “criterion reflected in the Live Dashboard” appear to be planned functionality rather than implemented functionality. Current evidence shows persistence only; no per-criterion event or dashboard projection exists.
