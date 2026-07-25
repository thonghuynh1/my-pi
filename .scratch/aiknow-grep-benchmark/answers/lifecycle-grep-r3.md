## 1. Executive summary

On startup, `handleStaleRun()` reads the tracker, rejects an active owner, rejects non-interactive recovery, normalizes crash artifacts, computes valid actions, and executes the developer’s choice. Normal resume cleans interrupted writer phases, validates completed tasks, then adopts the stale tracker’s ownership. `buildResumePlan()` converts persisted tasks into scheduler queues and progress. The resumed `LoopRun` continues writing the same tracker with monotonically increasing revisions and emits subscriber facts only after durable writes.

## 2. Detailed flow / architecture / impact analysis

1. **Detection and action selection**
   - `LoopRunTracker.isStale()` considers a run stale if the owner PID is dead or the heartbeat is older than 30 seconds; otherwise startup aborts because another loop is active. `src/core/utils/loop-run-tracker.ts:147-169`
   - Non-TTY startup fails rather than choosing a recovery action implicitly. `src/core/utils/stale-run-recovery.ts:400-418`
   - `StaleRun.getAvailableActions()` normally offers:
     - `resume`: always available for an ordinary stale run.
     - `rollback`: available only when `rollbackSnapshotId` exists.
     - `abandon` and `cancel`: always available.
     `src/core/utils/stale-run-recovery.ts:125-146`
   - A missing rollback snapshot disables loop-start rollback but does not disable tracker-based resume. `CONTEXT.md:84-86`; `docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:45-46`

2. **Crash normalization**
   - `handleStaleRun()` calls `staleRun.normalizeCrashRules()` after stale detection and before presenting choices. `src/core/utils/stale-run-recovery.ts:421-433`
   - It detects any live-steering record still in `submitted`, calls `tracker.normalizeLiveSteeringPostCrash()`, and refreshes its in-memory state. `src/core/utils/stale-run-recovery.ts:153-166`
   - `normalizeSteeringPostCrash()` changes `submitted` to `unknown-after-crash` and preserves terminal statuses. `src/core/loop-run/state.ts:112-123`

3. **Resume preparation**
   - `resume` first calls `prepareResume()`, then adopts tracker ownership. `src/core/utils/stale-run-recovery.ts:278-302`
   - Interrupted implementation is discarded at the task-worktree boundary. `src/core/utils/stale-run-recovery.ts:311-319`, `463-466`
   - Interrupted merge is aborted, requires a clean primary workspace, resets to `preMergeHead`, and removes the task worktree. `src/core/utils/stale-run-recovery.ts:320-323`, `468-501`
   - Verification, completion marking, and interrupted/failed/blocked whole-run review are retried rather than trusted as complete. `src/core/utils/stale-run-recovery.ts:325-356`
   - A task marked `done` is trusted only when its `integratedHead` remains reachable from `HEAD`; otherwise the developer chooses restart or trust. `src/core/utils/stale-run-recovery.ts:334-355`

4. **Resume-plan translation**
   - `ralphLoop()` creates a `LoopRun`, calls `startOrResume()`, then builds the scheduler plan. `src/core/ralph-loop.ts:343-386`
   - `buildResumePlan()`:
     - Adds `done` tasks to `terminalIds`.
     - For `mark-done-pending`, calls `isDone()` when available, otherwise calls `markDone()` with the persisted issue data, then durably records `done`.
     - Re-reads the tracker after those writes.
     - Places all non-terminal, non-`mark-done-pending` tasks into `replayQueue`.
     - Restores `iterationsStarted` and `skippedIds`.
     `src/core/loop-run/resume-plan.ts:31-75`
   - `failed` tasks are not added to the non-retryable terminal set, so they remain eligible for scheduler handling according to normal retry rules. `src/core/loop-run/resume-plan.ts:76-84`

5. **Sole tracker ownership and event ordering**
   - `adoptOwnership()` updates the existing tracker in place, setting status to `running`, the new PID, and a fresh heartbeat. `src/core/utils/loop-run-tracker.ts:147-158`
   - Every tracker update increments `revision` from the current revision and atomically replaces the active file. `src/core/utils/loop-run-tracker.ts:128-145`, `334-349`
   - `LoopRun` is explicitly the sole authoritative writer; subscribers are invoked synchronously, in registration order, only after the durable write succeeds. `src/core/loop-run/loop-run.ts:5-7`, `76-90`
   - Phase writes precede `taskPhaseChanged` emission; failed writes emit no event. `src/core/loop-run/loop-run.ts:276-300`
   - Thus the resumed process keeps the same logical run/tracker, writes first, advances revisions monotonically, and only then informs observers.

6. **Partial Force-Kill Undo**
   - A tracker with `panicUndo` in any phase other than `rollback-completed` is treated specially; normal `resume` is removed. `src/core/utils/stale-run-recovery.ts:107-123`, `125-146`
   - `finishRollback` is offered only when:
     - `panicUndo.phase === "processes-drained"`, and
     - a rollback snapshot exists.
     `src/core/utils/stale-run-recovery.ts:115-123`
   - It requires confirmation, adopts the snapshot, reruns rollback, records rollback progress, cleans workspace state, and archives the run as interrupted only after success. A failed attempt records `rollback-failed` and leaves the tracker active. `src/core/utils/stale-run-recovery.ts:218-276`
   - This prevents treating an incompletely drained/destructive undo as an ordinary resumable stale run. `docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:80-86`

7. **Dirty merge safety check**
   - Before resetting to `preMergeHead`, `prepareMergingResume()` aborts any merge in progress and loops while `git.isDirty()`. It refuses to reset over uncommitted primary-workspace edits, requiring cleanup/retry or abandonment. `src/core/utils/stale-run-recovery.ts:468-501`
   - Non-interactive mode throws immediately rather than making that destructive choice automatically. `src/core/utils/stale-run-recovery.ts:485-488`
   - This directly implements the ADR’s manual-edit protection rule. `docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:49-50`

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| Stale means dead owner or expired heartbeat | `isStale` | `src/core/utils/loop-run-tracker.ts:147-169` |
| Recovery is blocked without interactive input | `handleStaleRun` | `src/core/utils/stale-run-recovery.ts:400-418` |
| Ordinary action availability depends on snapshot presence | `getAvailableActions` | `src/core/utils/stale-run-recovery.ts:125-146` |
| Crash-submitted steering becomes unknown | `normalizeCrashRules`, `normalizeSteeringPostCrash` | `src/core/utils/stale-run-recovery.ts:153-166`; `src/core/loop-run/state.ts:112-123` |
| Resume cleans interrupted implementation and merge phases | `prepareResume` | `src/core/utils/stale-run-recovery.ts:311-323` |
| Merge recovery requires a clean primary workspace | `prepareMergingResume` | `src/core/utils/stale-run-recovery.ts:478-501` |
| `mark-done-pending` is completed before queue construction | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:31-75` |
| Scheduler progress is restored from persisted state | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:65-75` |
| Resumed process adopts existing tracker ownership | `adoptOwnership` | `src/core/utils/loop-run-tracker.ts:147-158` |
| Revisions are monotonic and writes are atomic | `update`, `atomicWrite` | `src/core/utils/loop-run-tracker.ts:128-145`, `334-349` |
| Subscribers observe only durable facts, in order | `subscribe`, `emit` | `src/core/loop-run/loop-run.ts:76-90`, `607-610` |
| Partial panic undo blocks normal resume | `isPartialPanicUndo`, `getAvailableActions` | `src/core/utils/stale-run-recovery.ts:107-146` |
| Finish Rollback requires drained processes and a snapshot | `canFinishRollback` | `src/core/utils/stale-run-recovery.ts:115-123` |
| Failed Finish Rollback remains recoverable | `execute("finishRollback")` | `src/core/utils/stale-run-recovery.ts:218-276` |

## 4. Tests and documentation

- Action availability and partial panic-undo rules: `test/stale-run-recovery.test.ts:81-114`, `1234-1377`
- Finish Rollback success/failure behavior: `test/stale-run-recovery.test.ts:1391-1485`
- Dirty merge recovery: `test/stale-run-recovery.test.ts:673-712`; `test/recovery-integration.test.ts:277-330`
- `mark-done-pending` resume behavior: `test/resume-plan.test.ts:16-99`
- Durable recovery contract and safety rationale: `docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:11-86`
- Single-writer and subscriber architecture: `CONTEXT.md:60-66`

## 5. Uncertainties

- The exact scheduler behavior after `buildResumePlan()` consumes `replayQueue` is outside the inspected resume-plan implementation; the plan’s outputs are directly evidenced.
- `rollbackDisabled` is returned as recovery metadata, while actual action availability is determined by `getAvailableActions()` and snapshot presence.
