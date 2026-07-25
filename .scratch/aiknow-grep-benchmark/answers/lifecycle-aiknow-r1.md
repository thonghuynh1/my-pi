## 1. Executive summary

Startup constructs the tracker and calls `handleStaleRun`. A tracker is stale when its owner process is dead or its heartbeat exceeds 30 seconds. Active runs abort startup; stale runs enter recovery. `handleStaleRun` normalizes crash state, computes legal actions, prompts, and executes the selected action.【src/core/utils/loop-run-tracker.ts:161-178】【src/core/utils/stale-run-recovery.ts:392-440】

For resume, the process repairs task/workspace state, adopts tracker ownership, initializes `LoopRun`, reconstructs scheduler state, and resumes execution. From that point, `LoopRun` is the authoritative writer: every durable update happens before its event is emitted.【src/core/utils/stale-run-recovery.ts:287-303】【src/core/loop-run/loop-run.ts:75-102】

## 2. Detailed flow / architecture / impact analysis

1. **Detection and action selection**
   - Missing tracker state proceeds normally.
   - A live tracker aborts startup to prevent two loop processes.
   - A stale tracker without a TTY aborts rather than selecting a default action.
   - Otherwise, crash rules are normalized, then actions are calculated and presented.【src/core/utils/stale-run-recovery.ts:398-440】
   - Ordinary stale runs offer `resume`, `abandon`, and `cancel`; `rollback` is added only when `rollbackSnapshotId` exists.【src/core/utils/stale-run-recovery.ts:141-155】
   - `cancel` aborts without changing the run; `abandon` archives the tracker and proceeds with a new run.【src/core/utils/stale-run-recovery.ts:180-187】
   - Invalid prompt choices are rejected.【src/core/utils/stale-run-recovery.ts:430-440】

2. **Crash-rule normalization**
   - `normalizeCrashRules` checks whether any task has submitted live-steering records.
   - If so, it calls `tracker.normalizeLiveSteeringPostCrash()` and rereads the resulting state.
   - It is called exactly after stale detection and before action availability is computed.【src/core/utils/stale-run-recovery.ts:157-166】【src/core/utils/stale-run-recovery.ts:423-431】
   - The tracker normalizes each task’s steering records through `normalizeSteeringPostCrash`, using a revisioned durable update.【src/core/utils/loop-run-tracker.ts:356-369】【src/core/utils/loop-run-tracker.ts:132-140】

3. **Resume preparation**
   - `resume` calls `prepareResume`, then `adoptOwnership`.
   - Implementing tasks have their worktrees cleaned.
   - Merge-pending/merging tasks abort any merge in progress, require a clean primary workspace, reset to `preMergeHead`, and clean the task worktree.
   - Verification and completion-marking interruptions are explicitly left for rerun/retry.
   - Done tasks whose `integratedHead` is unreachable require a restart/trust decision; restart persists the task as scheduled.【src/core/utils/stale-run-recovery.ts:287-303】【src/core/utils/stale-run-recovery.ts:307-377】

4. **Persisted task table → live scheduler**
   - `buildResumePlan` reads the initial snapshot.
   - `done` tasks become terminal IDs; failed tasks are not treated as non-retryable terminals.
   - `mark-done-pending` tasks call `isDone`; if necessary, `markDone` is called, then the tracker phase is written as `done`.
   - The tracker is reread after these writes.
   - Remaining nonterminal, non-`mark-done-pending` tasks become `replayQueue`; scheduler iterations and skipped IDs are restored from persisted scheduler state.【src/core/loop-run/resume-plan.ts:35-79】
   - `ralphLoop` consumes these four outputs immediately after `startOrResume`.【src/core/ralph-loop.ts:360-387】

5. **Sole authoritative ownership**
   - `adoptOwnership` revisionally updates the existing tracker to `status: "running"`, the new PID, and a fresh heartbeat.【src/core/utils/loop-run-tracker.ts:132-159】
   - `LoopRun.startOrResume` adopts the existing rollback snapshot and emits `snapshotAdopted`; it does not create a competing tracker when one already exists.【src/core/loop-run/loop-run.ts:104-152】
   - `LoopRun` owns the tracker and is documented as the sole authoritative writer.【src/core/loop-run/loop-run.ts:63-73】【src/core/utils/loop-run-tracker.ts:1-8】
   - Tracker updates increment revision monotonically and atomically write the new snapshot before returning.【src/core/utils/loop-run-tracker.ts:132-140】【src/core/utils/loop-run-tracker.ts:371-385】
   - Task transitions demonstrate write-then-emit: the tracker update completes first; only then is the event emitted. Subscribers run synchronously in registration order.【src/core/loop-run/loop-run.ts:75-102】【src/core/loop-run/loop-run.ts:275-300】
   - Thus, after `adoptOwnership` and `startOrResume`, the resumed `LoopRun` controls all subsequent tracker writes and event publication.

6. **Partially completed Force-Kill Undo**
   - A `panicUndo` state is partial whenever its phase is not `rollback-completed`; it is therefore not treated as an ordinary stale run.
   - Partial undo offers only `abandon` and `cancel`, plus `finishRollback` when the phase is exactly `processes-drained` and a rollback snapshot exists. Ordinary `resume` and `rollback` are excluded.【src/core/utils/stale-run-recovery.ts:128-155】
   - Finish Rollback requires explicit confirmation, a recorded snapshot, successful rollback, cleanup, recording `rollback-completed`, and archiving the run as interrupted with reason `panic-undo`.【src/core/utils/stale-run-recovery.ts:224-284】

7. **Merge safety check**
   - During merge recovery, `git.isDirty()` blocks resetting the primary workspace to `preMergeHead`.
   - The user must clean the workspace and retry, or abandon. Noninteractive recovery throws instead of proceeding.【src/core/utils/stale-run-recovery.ts:468-502】

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| Stale means dead owner or expired heartbeat | `isStale` | `src/core/utils/loop-run-tracker.ts:161-178` |
| Startup dispatches stale recovery | `handleStaleRun` | `src/core/utils/stale-run-recovery.ts:392-440` |
| Ordinary action availability | `getAvailableActions` | `src/core/utils/stale-run-recovery.ts:141-155` |
| Crash normalization | `normalizeCrashRules` | `src/core/utils/stale-run-recovery.ts:157-166` |
| Pending completion repair | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:35-79` |
| Resume workspace repair | `prepareResume` | `src/core/utils/stale-run-recovery.ts:307-377` |
| Merge dirty-tree guard | `prepareMergingResume` | `src/core/utils/stale-run-recovery.ts:468-502` |
| New process ownership | `adoptOwnership` | `src/core/utils/loop-run-tracker.ts:150-159` |
| Monotonic durable revision | `update` | `src/core/utils/loop-run-tracker.ts:132-140` |
| Write-before-event ordering | `recordTaskPhase` | `src/core/loop-run/loop-run.ts:275-300` |
| Subscriber ordering | `subscribe` documentation | `src/core/loop-run/loop-run.ts:75-102` |
| Partial Force-Kill Undo rules | `canFinishRollback`, `getAvailableActions` | `src/core/utils/stale-run-recovery.ts:128-155` |
| Finish Rollback requirements | `execute` / `finishRollback` | `src/core/utils/stale-run-recovery.ts:224-284` |

## 4. Tests and documentation

- ADR-0006 is explicitly referenced as the design authority for the Durable Loop Run Tracker and stale-run recovery.【src/core/loop-run/resume-plan.ts:21】
- Integration coverage includes the dirty-primary-workspace merge-recovery case.【test/recovery-integration.test.ts:258】
- The implementation comments document sole-writer ownership, atomic persistence, write-then-emit semantics, and recovery behavior.【src/core/utils/loop-run-tracker.ts:1-10】【src/core/loop-run/loop-run.ts:104-112】

## 5. Uncertainties

- The exact scheduler loop that consumes `replayQueue`, `terminalIds`, and restored counters is outside the inspected ranges; their construction and handoff are directly evidenced.
- The benchmark describes “startup” broadly; the concrete startup call path shown is `ralphLoop` invoking `handleStaleRun` before constructing and starting `LoopRun`.
