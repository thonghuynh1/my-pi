## 1. Executive summary

On startup, `handleStaleRun` reads `.ralph-loop/runs/active.json`, rejects an active owner, fails closed without a TTY, normalizes crash artifacts, then offers only actions valid for the persisted state. Ordinary stale runs may resume, roll back when a snapshot exists, abandon, or cancel. Partial Force-Kill Undo runs cannot resume; they may finish rollback only after durable process-drain evidence and a snapshot are present.  
Evidence: `src/core/utils/stale-run-recovery.ts:392-438`; `docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:32-41,54-57`.

For normal resume, interrupted writer phases are cleaned and replayed from safe boundaries. The new process adopts the existing tracker ownership, constructs a `LoopRun`, builds scheduler state from the persisted task table, and continues writing the same tracker through atomic, revision-incrementing updates before notifying subscribers.  
Evidence: `src/core/utils/stale-run-recovery.ts:264-302`; `src/core/loop-run/resume-plan.ts:35-77`; `src/core/loop-run/loop-run.ts:4-7,96-102`.

## 2. Detailed flow / architecture / impact analysis

1. **Detection and action selection**
   - Missing tracker: proceed with a fresh run.
   - Non-stale tracker: abort to prevent two owners.
   - Default non-TTY startup: abort rather than silently choosing recovery.
   - `normalizeCrashRules()` runs before the recovery menu. It finds task `liveSteering` records still marked `submitted`, persists them as `unknown-after-crash`, and refreshes in-memory state. Already-terminal steering statuses are unchanged; task phases are unaffected.
   - Ordinary stale run actions are `resume`, `abandon`, and `cancel`; `rollback` is inserted only when `rollbackSnapshotId` exists. A missing snapshot disables loop-start rollback but does not disable tracker-based resume.
   - A partial panic undo is identified by `panicUndo.phase !== "rollback-completed"`. It suppresses ordinary `resume` and `rollback`; it offers `finishRollback` only when phase is `processes-drained` and a snapshot exists, always retaining `abandon` and `cancel`.
   - Evidence: `src/core/utils/stale-run-recovery.ts:112-164,392-438`; `src/core/loop-run/state.ts:112-123`; `docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:32-40,54-57`.

2. **Selected action**
   - `cancel` aborts startup without changing the run.
   - `abandon` archives the stale tracker and starts a new run.
   - Ordinary `rollback` adopts the recorded snapshot, restores Git state, archives the tracker only on success, cleans up, and releases the lock.
   - `resume` calls `prepareResume`; if recovery cannot safely continue, the developer may abandon. After preparation succeeds, the new process calls `tracker.adoptOwnership()`.
   - Evidence: `src/core/utils/stale-run-recovery.ts:166-303`.

3. **Crash normalization**
   - `normalizeCrashRules()` is a narrow pre-choice repair. It does nothing for state-only `StaleRun` instances or when no `submitted` records exist.
   - The pure state rule maps only `submitted → unknown-after-crash`; it does not infer whether the steering command reached the agent.
   - Evidence: `src/core/utils/stale-run-recovery.ts:157-164,428-431`; `src/core/loop-run/state.ts:112-123`.

4. **Resume preparation and replay planning**
   - `implementing`: delete/recreate the task worktree, discarding interrupted writer output.
   - `merge-pending`/`merging`: abort an in-progress merge, require a clean primary workspace, reset to `preMergeHead`, then clean the task worktree.
   - `verify-pending`/`verifying`: verification is rerun.
   - `mark-done-pending`: completion marking is retried.
   - `done`: its `integratedHead` must remain reachable from `HEAD`; otherwise the developer chooses restart or trust.
   - Interrupted/failed/blocked whole-run review is rerun.
   - `buildResumePlan` marks existing `done` tasks terminal, processes `mark-done-pending` tasks by calling `isDone` when available or `markDone` otherwise, records `done` through `LoopRun`, and then builds:
     - `replayQueue`: nonterminal tasks;
     - `terminalIds`: completed tasks plus newly completed pending-mark tasks;
     - `resumeIterations`: persisted `scheduler.iterationsStarted`;
     - `resumeSkippedIds`: persisted skipped IDs.
   - Evidence: `src/core/utils/stale-run-recovery.ts:307-371,454-501`; `src/core/loop-run/resume-plan.ts:35-77`; `src/core/ralph-loop.ts:386-387,687-745`.

5. **Sole tracker ownership and scheduler control**
   - After resume preparation, `adoptOwnership()` changes the existing logical run to `status: "running"`, records the new PID and heartbeat, and increments the revision; it does not create a new run ID or tracker.
   - `ralphLoop` then constructs `LoopRun` over that same tracker. `startOrResume()` reads the existing tracker and adopts its existing rollback snapshot rather than creating a new snapshot/tracker.
   - The scheduler consumes `replayQueue` first, seeds claimed/terminal IDs from the plan, restores iteration/skipped state, and only then fetches new issues.
   - Tracker updates use `update()`: read current state, increment `revision`, write a temporary file, then atomically rename it into place.
   - `LoopRun` is the authoritative writer. Its lifecycle methods persist first and emit facts second. Subscribers are invoked synchronously in registration order only after the durable write succeeds.
   - Evidence: `src/core/utils/loop-run-tracker.ts:122-164,344-365`; `src/core/loop-run/loop-run.ts:4-7,46-50,96-151,276-310,607-610`; `src/core/ralph-loop.ts:344-386`.

6. **Why partial Force-Kill Undo is special**
   - Force-Kill Undo may have killed writers but not completed repository restoration. Treating that state as an ordinary stale run could resume against an ambiguous or partially restored workspace.
   - `Finish Rollback` requires fresh confirmation, `panicUndo.phase === "processes-drained"`, a recorded snapshot, and successful snapshot restoration. A stale PID alone is insufficient proof that active writers were drained.
   - Failed finish rollback records `rollback-failed` and keeps the active tracker for another explicit attempt. Successful rollback records `rollback-completed`, archives the run as interrupted with terminal reason `panic-undo`, and retains forensic panic state.
   - Evidence: `src/core/utils/stale-run-recovery.ts:132-148,224-262`; `src/core/loop-run/loop-run.ts:195-258`; `docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:52-57`.

7. **Dirty merge safety check**
   - During merge recovery, any remaining `git.isDirty()` result blocks the reset to `preMergeHead`, because that reset could overwrite manual primary-workspace edits.
   - The recovery loop asks the developer to clean the workspace and retry or abandon. An in-progress merge is aborted before this check, so merge-conflict dirt is not treated as manual work.
   - Evidence: `src/core/utils/stale-run-recovery.ts:469-501`; `docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:35-40`.

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| Stale detection uses owner PID and heartbeat | `LoopRunTracker.isStale` | `src/core/utils/loop-run-tracker.ts:155-164` |
| Recovery is fail-closed in non-TTY startup | `handleStaleRun` | `src/core/utils/stale-run-recovery.ts:404-418` |
| Crash normalization precedes action selection | `handleStaleRun` | `src/core/utils/stale-run-recovery.ts:428-431` |
| Submitted steering becomes unknown-after-crash | `normalizeSteeringPostCrash` | `src/core/loop-run/state.ts:112-123` |
| Partial panic undo suppresses resume | `StaleRun.getAvailableActions` | `src/core/utils/stale-run-recovery.ts:132-148` |
| Finish rollback requires drained processes and snapshot | `StaleRun.canFinishRollback` | `src/core/utils/stale-run-recovery.ts:128-138` |
| Mark-done-pending is reconciled through the issue source | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:48-63` |
| Replay and scheduler state come from persisted tasks/scheduler | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:65-77` |
| Resume adopts existing tracker ownership | `adoptOwnership` | `src/core/utils/loop-run-tracker.ts:150-164` |
| Existing snapshot is adopted instead of recaptured | `LoopRun.startOrResume` | `src/core/loop-run/loop-run.ts:117-151` |
| Tracker revisions are monotonic and writes atomic | `LoopRunTracker.update`, `atomicWrite` | `src/core/utils/loop-run-tracker.ts:122-137,344-365` |
| Subscribers observe only after writes, in registration order | `LoopRun.subscribe`, `emit` | `src/core/loop-run/loop-run.ts:76-102,607-610` |
| Dirty primary workspace blocks merge reset | `prepareMergingResume` | `src/core/utils/stale-run-recovery.ts:478-501` |

## 4. Tests and documentation

- Recovery action availability, partial panic-undo restrictions, ownership adoption, merge recovery, dirty-worktree blocking, and crash normalization: `test/stale-run-recovery.test.ts:451-730,1272-1335,1573-1760`.
- `mark-done-pending` handling and persisted task-body propagation: `test/resume-plan.test.ts:1-91`.
- Atomic revision updates and stale heartbeat detection: `test/loop-run-tracker.test.ts:436-545`.
- Architecture and policy: `docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:19-57`; sole-writer/event ordering: `docs/adr/0007-loop-run-coordinator-and-fact-events.md:16-19,32-35`.

## 5. Uncertainties

- The ordinary resume path clearly hands ownership to `LoopRun` before scheduler replay. The startup `finishRollback` branch still performs its rollback tracker writes directly in `StaleRun.execute`; ADR-0007 states that partial-undo lifecycle advancement should first be adopted into a `LoopRun`. This appears to be an implementation/architecture mismatch worth validating separately.
