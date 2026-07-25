## 1. Executive summary

On startup, `handleStaleRun()` reads the active tracker, rejects live ownership, requires interactive input for stale recovery, normalizes crash-only state, and offers actions based on tracker state. A normal stale run can resume, rollback if a snapshot exists, abandon, or cancel. A partially completed Force-Kill Undo is restricted to Finish Rollback, abandon, or cancel.

For resume, recovery first repairs unsafe workspace boundaries, then adopts the existing tracker ownership. `ralphLoop()` constructs a `LoopRun` over that same tracker, builds scheduler state from persisted tasks, and thereafter routes durable lifecycle writes through `LoopRun`, which writes atomically before synchronously notifying subscribers.

## 2. Detailed flow / architecture / impact analysis

1. **Detection and action selection**
   - `handleStaleRun()` proceeds if no tracker exists; aborts if the owner is still active; and fails fast without a TTY rather than selecting a default recovery action. `StaleRun.fromTracker()` confirms staleness using owner PID and heartbeat.
   - For an ordinary stale run, actions are `resume`, `abandon`, and `cancel`; `rollback` is inserted only when `rollbackSnapshotId` exists. Missing snapshots therefore disable loop-start rollback but do not inherently prevent tracker-based resume.
   - For a partial panic undo, `resume` and ordinary `rollback` are not offered. The choices are `abandon` and `cancel`, plus `finishRollback` only when the panic-undo phase is `processes-drained` and a rollback snapshot exists.
   - `cancel` aborts startup. `abandon` archives the stale tracker and permits a fresh run. `rollback` restores the snapshot, archives the tracker, cleans workspaces, and starts fresh.

2. **Crash normalization**
   - `normalizeCrashRules()` scans task live-steering records for `submitted` entries. If any exist, it calls `normalizeLiveSteeringPostCrash()`, which changes those records to `unknown-after-crash` while preserving terminal records.
   - This occurs in `handleStaleRun()` after stale detection and before available actions are calculated or prompted. The normalization itself is persisted through the tracker’s normal revisioned atomic update.

3. **Resume preparation**
   - `prepareResume()` handles persisted phases:
     - `implementing`: deletes/recreates the task worktree boundary.
     - `merge-pending`/`merging`: aborts an in-progress merge, requires a clean primary workspace, resets to `preMergeHead`, and cleans the task worktree.
     - `verify-pending`/`verifying`: leaves the task for verification replay.
     - `mark-done-pending`: leaves completion marking to the resume plan.
     - `done`: validates `integratedHead` remains reachable from `HEAD`; the developer may trust it or restart the task.
     - interrupted or failed whole-run review is rerun.
   - After preparation succeeds, `execute("resume")` calls `tracker.adoptOwnership()`, changing status to `running`, replacing the owner PID/heartbeat, and incrementing the tracker revision.

4. **Persisted task table to scheduler state**
   - `buildResumePlan()` initially places `done` tasks in `terminalIds`.
   - For every `mark-done-pending` task, it calls `issueSource.isDone()` when available. If incomplete, it retries `markDone()` using the persisted issue ID, title, and body; then records the durable phase transition to `done` and adds the issue to `terminalIds`.
   - It rereads the tracker after those writes. All nonterminal tasks become `replayQueue`; scheduler iteration count and skipped IDs come from the refreshed persisted scheduler snapshot. Thus failed tasks are replayable, while completed tasks are terminal.

5. **Sole tracker ownership and event ordering**
   - The resumed process creates `LoopRun` with the existing `LoopRunTracker`, then calls `startOrResume()`. Existing rollback snapshots are adopted rather than creating a new run snapshot.
   - Tracker updates increment `revision` from the current value and use temporary-file write plus rename replacement. This preserves monotonic, crash-safe state.
   - `LoopRun` is the authoritative lifecycle writer. Its phase/meta operations persist through the tracker first, and emit events only after the write succeeds. Subscribers execute synchronously in registration order, so observers cannot precede durable state.
   - The scheduler then operates using `replayQueue`, `terminalIds`, restored iteration count, and restored skipped IDs while the same logical tracker continues advancing.

6. **Partial Force-Kill Undo and Finish Rollback**
   - A panic-undo record whose phase is not `rollback-completed` represents an unfinished destructive transaction, not ordinary stale work; resuming tasks could conflict with live writers or leave repository state ambiguous.
   - Finish Rollback requires explicit confirmation, `panicUndo.phase === "processes-drained"`, and a recorded rollback snapshot. It adopts and executes the snapshot rollback, records rollback failure if needed, or records `rollback-completed`, marks the run interrupted with reason `panic-undo`, and archives it.
   - The tracker records panic-undo facts durably before corresponding Loop Run events in normal Loop Run operation.

7. **Dirty primary workspace safety gate**
   - Merge recovery first aborts any in-progress merge, then checks `git.isDirty()`. Uncommitted primary-workspace changes block recovery because resetting to `preMergeHead` could overwrite developer edits.
   - Interactive recovery offers retry after the workspace is cleaned or abandon. Non-interactive recovery throws immediately.

## 3. Evidence table

| Claim | Symbol | File:line |
|---|---|---|
| Stale detection rejects live ownership and requires interactive recovery | `handleStaleRun` | `src/core/utils/stale-run-recovery.ts:398-423` |
| Normal stale actions depend on snapshot presence | `StaleRun.getAvailableActions` | `src/core/utils/stale-run-recovery.ts:141-154` |
| Partial panic undo restricts actions and gates Finish Rollback | `isPartialPanicUndo`, `canFinishRollback` | `src/core/utils/stale-run-recovery.ts:128-147` |
| Crash normalization changes submitted steering records | `normalizeCrashRules` / `normalizeSteeringPostCrash` | `src/core/utils/stale-run-recovery.ts:157-167`; `src/core/loop-run/state.ts:112-122` |
| Normalization precedes prompting | `handleStaleRun` | `src/core/utils/stale-run-recovery.ts:428-440` |
| Resume adopts the stale tracker’s ownership | `execute("resume")` | `src/core/utils/stale-run-recovery.ts:287-303` |
| Implementation and merge recovery boundaries | `prepareResume`, `prepareMergingResume` | `src/core/utils/stale-run-recovery.ts:306-377,468-502` |
| Dirty primary workspace blocks merge recovery | `prepareMergingResume` | `src/core/utils/stale-run-recovery.ts:474-492` |
| `mark-done-pending` is completed idempotently and made terminal | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:34-75` |
| Replay queue and scheduler progress are restored from persisted state | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:76-91` |
| Existing tracker is reused by the new `LoopRun` | `ralphLoop`, `startOrResume` | `src/core/ralph-loop.ts:334-386`; `src/core/loop-run/loop-run.ts:105-151` |
| Revisions are monotonic and writes are atomic | `LoopRunTracker.update`, `atomicWrite` | `src/core/utils/loop-run-tracker.ts:132-144,375-389` |
| Durable write precedes event emission | `recordTaskPhase`, `emit` | `src/core/loop-run/loop-run.ts:276-289,607-611` |
| Subscribers run synchronously in registration order | `subscribe` and class contract | `src/core/loop-run/loop-run.ts:75-101` |
| Finish Rollback requires confirmation and records terminal panic-undo state | `execute("finishRollback")` | `src/core/utils/stale-run-recovery.ts:224-285` |

## 4. Tests and documentation

- `test/stale-run-recovery.test.ts:455-492` verifies ownership adoption on resume.
- `test/stale-run-recovery.test.ts:704-734` verifies dirty merge recovery is blocked.
- `test/stale-run-recovery.test.ts:1276-1376` verifies partial panic-undo action availability.
- `test/stale-run-recovery.test.ts:1391-1481` verifies Finish Rollback confirmation and failure behavior.
- `test/resume-plan.test.ts:17-99` verifies persisted task body propagation, idempotent completion checks, and `done` advancement.
- `test/recovery-integration.test.ts:258-305` verifies the primary-workspace safety gate.
- `docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:32-43` defines recovery actions, safe/unsafe restart rules, ownership, atomic revisions, and dirty-merge protection.
- `docs/adr/0007-loop-run-coordinator-and-fact-events.md:33-36` defines sole-writer, write-then-emit, panic-undo, and resume-plan responsibilities.

## 5. Uncertainties

- The implementation performs Finish Rollback directly through startup recovery methods, while ADR-0007 describes adopting the stale run into a `LoopRun` before completing partial panic undo. The normal resume path clearly adopts ownership before `LoopRun` execution; the Finish Rollback path’s conformance to that ADR wording is not fully evident from the current code.
