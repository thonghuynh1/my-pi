## 1. Executive summary

On startup, `handleStaleRun` reads the active tracker, rejects a live owner, and treats a dead/stale owner as recoverable. It normalizes crash-sensitive state, computes allowed actions, executes the selected action, and—on resume—adopts ownership before the new `LoopRun` reconstructs scheduler state.

The resumed `LoopRun` is authoritative: tracker writes occur before events are emitted, revisions increase monotonically, and subscribers observe facts in registration order.

## 2. Detailed flow / architecture / impact analysis

1. **Detection and action availability**
   - `LoopRunTracker.isStale()` returns stale when the tracker is missing, its owner PID is dead, or its heartbeat exceeds 30 seconds (`src/core/utils/loop-run-tracker.ts:161-178`).
   - A live owner aborts startup; non-interactive default recovery also aborts rather than selecting an implicit action (`src/core/utils/stale-run-recovery.ts:404-420`).
   - Ordinary stale runs offer:
     - `resume` always.
     - `rollback` only when `rollbackSnapshotId` exists.
     - `abandon` and `cancel` always (`src/core/utils/stale-run-recovery.ts:141-155`).
   - A partial panic undo is special: it offers only `abandon`/`cancel`, plus `finishRollback` only when the phase is `processes-drained` and a rollback snapshot exists (`src/core/utils/stale-run-recovery.ts:128-147`).

2. **Crash normalization**
   - `normalizeCrashRules()` checks whether any task contains live-steering records still marked `submitted`. If none do, it does nothing.
   - Otherwise it calls `tracker.normalizeLiveSteeringPostCrash()`, which converts submitted records to `unknown-after-crash`, then refreshes in-memory state (`src/core/utils/stale-run-recovery.ts:157-166`; `src/core/loop-run/state.ts:112-123`).
   - It runs after stale detection and before actions are presented (`src/core/utils/stale-run-recovery.ts:423-431`).

3. **Resume preparation**
   - `prepareResume()` cleans interrupted implementation worktrees, aborts in-progress merges, reruns interrupted verification/completion work, and validates that done-task commits remain reachable (`src/core/utils/stale-run-recovery.ts:307-377`).
   - For interrupted merge tasks, recovery requires a clean primary workspace. Dirty state causes an interactive retry/abandon choice, while non-interactive recovery throws; only then may it reset to `preMergeHead` and clean the task worktree (`src/core/utils/stale-run-recovery.ts:468-502`).
   - `buildResumePlan()` reads the persisted task table:
     - `done` tasks become terminal IDs.
     - `mark-done-pending` tasks are checked with `isDone`; if needed, `markDone` is called, then the tracker phase is durably changed to `done`.
     - Remaining nonterminal tasks become live `Issue` objects in `replayQueue`.
     - Scheduler iteration and skipped-ID state are restored from the refreshed snapshot (`src/core/loop-run/resume-plan.ts:35-79`).

4. **Ownership and authoritative writes**
   - After successful resume preparation, the new process calls `tracker.adoptOwnership()`, setting status to `running`, replacing the owner PID, and refreshing the heartbeat (`src/core/utils/stale-run-recovery.ts:287-303`; `src/core/utils/loop-run-tracker.ts:150-159`).
   - `ralphLoop` then constructs `LoopRun`, calls `startOrResume`, starts heartbeat updates, and builds the resume plan (`src/core/ralph-loop.ts:310-386`).
   - Tracker updates increment `revision` from the current value and persist atomically through a temporary file plus rename (`src/core/utils/loop-run-tracker.ts:132-140`, `371-385`).
   - `LoopRun` is the sole internal writer. Task phase/meta methods write first and emit only after persistence succeeds (`src/core/loop-run/loop-run.ts:275-310`).
   - Subscribers are invoked synchronously in registration order after the durable write; the external phase tracker is therefore an observer, not a competing writer (`src/core/loop-run/loop-run.ts:75-101`; `src/core/loop-run/external-phase-observer.ts:1-10`).

5. **Partial Force-Kill Undo**
   - `panicUndo` phases other than `rollback-completed` identify an undo that did not finish; it is therefore not treated as an ordinary stale run (`src/core/utils/stale-run-recovery.ts:35-39`, `128-132`).
   - Finish Rollback requires explicit confirmation, an existing snapshot, successful snapshot adoption and rollback, cleanup, recording `rollback-completed`, and archiving the run as `interrupted` with terminal reason `panic-undo` (`src/core/utils/stale-run-recovery.ts:224-303`).
   - Failed rollback records `rollback-failed` and retains recovery details where available (`src/core/utils/stale-run-recovery.ts:238-257`).

6. **Merge safety check**
   - Merge recovery calls `git.isDirty()` before resetting to `preMergeHead`; uncommitted primary-workspace edits block recovery because reset could overwrite them (`src/core/utils/stale-run-recovery.ts:478-499`).

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| Staleness is based on owner liveness and heartbeat age | `isStale` | `src/core/utils/loop-run-tracker.ts:161-178` |
| Available actions depend on panic-undo and snapshot state | `getAvailableActions` | `src/core/utils/stale-run-recovery.ts:128-155` |
| Crash normalization converts submitted steering to unknown-after-crash | `normalizeCrashRules` | `src/core/utils/stale-run-recovery.ts:157-166` |
| Normalization happens before prompting | `handleStaleRun` | `src/core/utils/stale-run-recovery.ts:423-431` |
| Mark-done-pending tasks are completed during resume planning | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:47-63` |
| Scheduler progress and replay queue are reconstructed | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:65-79` |
| New process adopts tracker ownership | `adoptOwnership` | `src/core/utils/loop-run-tracker.ts:150-159` |
| Writes precede emitted task events | `recordTaskPhase`, `recordTaskMeta` | `src/core/loop-run/loop-run.ts:275-310` |
| Revisions are monotonic and writes atomic | `update`, `atomicWrite` | `src/core/utils/loop-run-tracker.ts:132-140`, `371-385` |
| Subscribers run synchronously in registration order | `subscribe`, `emit` | `src/core/loop-run/loop-run.ts:75-101`, `607-610` |
| Partial panic undo restricts recovery choices | `isPartialPanicUndo`, `canFinishRollback` | `src/core/utils/stale-run-recovery.ts:128-147` |
| Dirty primary workspace blocks merge recovery | `prepareMergingResume` | `src/core/utils/stale-run-recovery.ts:468-502` |

## 4. Tests and documentation

- Integration coverage verifies dirty merge recovery is rejected and clean interrupted merges reset to `preMergeHead` (`test/recovery-integration.test.ts:254-340`).
- Integration coverage also verifies interrupted implementation worktrees are cleaned before restart (`test/recovery-integration.test.ts:199-252`).
- `resume-plan.ts` documents the persisted-to-runtime translation and references ADR-0006 (`src/core/loop-run/resume-plan.ts:1-21`).
- The tracker and external observer identify ADR-0006/ADR-0007 as the governing durability and ownership design (`src/core/utils/loop-run-tracker.ts:2-10`; `src/core/loop-run/external-phase-observer.ts:1-10`).

## 5. Uncertainties

- The exact user-facing prompt presentation is abstracted behind `RecoveryPrompts`; the available action set and execution semantics are directly evidenced.
- `startOrResume` emits `snapshotAdopted` when a rollback snapshot already exists, but the ownership adoption itself occurs earlier in stale-run recovery (`src/core/loop-run/loop-run.ts:117-152`; `src/core/utils/stale-run-recovery.ts:287-303`).
