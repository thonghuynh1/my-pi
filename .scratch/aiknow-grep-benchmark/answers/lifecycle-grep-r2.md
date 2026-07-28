## 1. Executive summary

Startup reads the active tracker, rejects a live owner, and otherwise treats a dead/expired owner as stale. Interactive recovery normalizes crash-specific state, offers only safe actions, and—on resume—cleans unsafe task boundaries before adopting the existing tracker under the new PID. `LoopRun` then resumes from that tracker, becomes the sole durable writer, and drives scheduler recovery.  
Evidence: `src/core/ralph-loop.ts:314-338`; `src/core/utils/stale-run-recovery.ts:392-440`.

## 2. Detailed flow / architecture / impact analysis

1. **Detection and action selection**
   - No tracker: proceed.
   - Non-stale tracker: abort because another process is active.
   - Stale tracker in non-TTY mode: abort; no implicit recovery is selected.
   - Ordinary stale run offers:
     - `resume`: always available.
     - `rollback`: available only when `rollbackSnapshotId` exists.
     - `abandon` and `cancel`: always available.
   - A partial panic-undo is special: `resume` and ordinary `rollback` are withheld. `finishRollback` is offered only when `panicUndo.phase === "processes-drained"` and a rollback snapshot exists; otherwise only `abandon`/`cancel` remain.  
   Evidence: `src/core/utils/stale-run-recovery.ts:116-158`; `src/core/utils/stale-run-recovery.ts:398-430`.

2. **Crash normalization**
   - `normalizeCrashRules()` first checks whether any task contains a live-steering record still marked `submitted`.
   - If so, it persists the result of `normalizeSteeringPostCrash()`, converting those records to `unknown-after-crash`; terminal steering records are unchanged.
   - It is called after stale detection and before available actions are calculated or prompted.  
   Evidence: `src/core/utils/stale-run-recovery.ts:159-171`; `src/core/utils/stale-run-recovery.ts:428-431`; `src/core/loop-run/state.ts:112-123`.

3. **Resume preparation**
   - Implementing tasks have their isolated worktrees cleaned, forcing a clean restart.
   - Merge-pending/merging tasks abort an in-progress merge, require a clean primary workspace, reset to `preMergeHead`, then clean the task worktree.
   - Verification, completion marking, and whole-run review are safe to repeat.
   - Done tasks are validated: an unreachable `integratedHead` requires an explicit restart/trust decision.  
   Evidence: `src/core/utils/stale-run-recovery.ts:304-361`; `src/core/utils/stale-run-recovery.ts:463-501`; `docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:11-24`.

4. **Resume plan and scheduler reconstruction**
   - `buildResumePlan()` reads the persisted task table.
   - `done` tasks become terminal IDs; failed tasks are not treated as non-retryable terminal tasks.
   - `mark-done-pending` tasks call `isDone` when available, retry `markDone` if necessary using persisted issue data, then persist `done` and add the ID to terminal IDs.
   - Remaining non-terminal tasks become `replayQueue`.
   - Persisted `scheduler.iterationsStarted` and `scheduler.skippedIds` restore scheduler progress.
   - The scheduler seeds claimed/terminal IDs, replays queued tasks before fetching new issues, and resumes from the persisted iteration count.  
   Evidence: `src/core/loop-run/resume-plan.ts:35-78`; `src/core/ralph-loop.ts:386-387`; `src/core/ralph-loop.ts:687-704`; `src/core/ralph-loop.ts:739-745`.

5. **Ownership transfer and authoritative writing**
   - After successful preparation, `tracker.adoptOwnership()` performs a durable update setting status to `running`, replacing the owner PID, and refreshing the heartbeat.
   - `LoopRun.startOrResume()` then adopts the existing rollback snapshot and returns the existing tracker state rather than creating a new run.
   - Tracker updates increment revision monotonically (`current.revision + 1`) and atomically replace the active file.
   - `LoopRun` performs write-then-emit: durable writes complete before facts are emitted. Subscribers run synchronously in registration order. The external tracker is an observer, not a parallel writer.
   Evidence: `src/core/utils/stale-run-recovery.ts:284-302`; `src/core/utils/loop-run-tracker.ts:126-153`; `src/core/utils/loop-run-tracker.ts:132-140`; `src/core/loop-run/loop-run.ts:3-7`; `src/core/loop-run/loop-run.ts:75-101`; `src/core/loop-run/loop-run.ts:276-300`; `src/core/loop-run/loop-run.ts:607-610`; `src/core/ralph-loop.ts:347-358`.

6. **Partial Force-Kill Undo**
   - A panic undo is not an ordinary stale run because rollback may be destructively incomplete and live writers may not have been drained.
   - `Finish Rollback` requires confirmation, a rollback snapshot, and the durable `processes-drained` phase. It adopts the snapshot and retries rollback.
   - Failure records `rollback-failed` and leaves the tracker active. Success cleans up, records `rollback-completed`, then archives the run as `interrupted` with terminal reason `panic-undo`.
   Evidence: `src/core/utils/stale-run-recovery.ts:121-138`; `src/core/utils/stale-run-recovery.ts:218-278`; `src/core/loop-run/loop-run.ts:218-250`; `docs/adr/0006-durable-loop-tracker-and-stale-run-recovery.md:27-32`.

7. **Dirty merge safety check**
   - Before resetting to `preMergeHead`, merge recovery repeatedly checks `git.isDirty()`.
   - Uncommitted primary-workspace edits block recovery because the reset could overwrite manual changes; interactive mode offers retry or abandon, while non-interactive mode throws.
   Evidence: `src/core/utils/stale-run-recovery.ts:478-501`; `test/recovery-integration.test.ts:258-304`.

## 3. Evidence table

| Claim | Symbol | File:line |
|---|---|---|
| Startup delegates stale-run handling before creating/resuming the run | `handleStaleRun` | `src/core/ralph-loop.ts:314-338` |
| Live owner blocks startup | `handleStaleRun` | `src/core/utils/stale-run-recovery.ts:405-413` |
| Normal action availability depends on snapshot presence | `getAvailableActions` | `src/core/utils/stale-run-recovery.ts:141-158` |
| Partial panic-undo blocks normal resume | `isPartialPanicUndo` | `src/core/utils/stale-run-recovery.ts:116-128` |
| Crash steering normalization converts submitted records | `normalizeSteeringPostCrash` | `src/core/loop-run/state.ts:112-123` |
| Mark-done-pending tasks are completed during planning | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:49-64` |
| Remaining tasks become replay work | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:67-78` |
| Resumed scheduler replays before fetching new work | scheduler loop | `src/core/ralph-loop.ts:739-745` |
| New PID adopts existing tracker | `adoptOwnership` | `src/core/utils/loop-run-tracker.ts:150-160` |
| Revisions increase monotonically and writes are atomic | `update`, `atomicWrite` | `src/core/utils/loop-run-tracker.ts:126-140`, `:328-345` |
| Events follow successful writes and preserve subscriber order | `emit` | `src/core/loop-run/loop-run.ts:75-82`, `:607-610` |
| Dirty merge recovery is blocked | `prepareMergingResume` | `src/core/utils/stale-run-recovery.ts:478-501` |

## 4. Tests and documentation

- Recovery action availability and partial panic-undo rules: `test/stale-run-recovery.test.ts:1230-1340`.
- `mark-done-pending` completion behavior and body propagation: `test/resume-plan.test.ts:14-91`.
- Dirty merge protection: `test/recovery-integration.test.ts:258-304`.
- Architectural recovery rules, ownership, safe/unsafe restart, and panic-undo requirements: `docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:11-32`.

## 5. Uncertainties

- The exact concrete `IssueSource` implementation used at runtime is injected by the caller; the recovery contract is directly evidenced, but source-specific idempotency depends on that implementation.
- `LoopRun.startOrResume()` adopts the workspace snapshot before scheduler planning; subsequent scheduler behavior is directly shown, while the phrase “back in control” is an architectural inference from the ownership and subscription sequence.
