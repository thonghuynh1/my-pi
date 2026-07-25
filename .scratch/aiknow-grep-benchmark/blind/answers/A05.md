## 1. Executive summary

On startup, `handleStaleRun` reads the active tracker, rejects a live owner, and otherwise treats a dead/expired owner as recoverable. It normalizes crash-sensitive steering state, computes permitted actions, and executes the selected recovery.

For ordinary stale runs, resume prepares safe task boundaries, adopts the existing tracker ownership, reconstructs scheduler state through `buildResumePlan`, and starts the resumed `LoopRun`. The coordinator then becomes the sole tracker writer: each durable revision is written atomically before ordered subscriber events are emitted.

A partial Force-Kill Undo is a separate safety state: normal resume is forbidden. Finish Rollback is offered only after durable process drainage and a recorded rollback snapshot. Merge recovery refuses to reset the primary workspace while it contains uncommitted edits.

## 2. Detailed flow / architecture / impact analysis

### Startup detection and action availability

1. `handleStaleRun`:
   - No tracker: proceed.
   - Tracker exists but owner is alive and heartbeat is recent: abort; a second loop cannot start.
   - Dead owner or expired heartbeat: continue stale recovery.
   - Non-interactive default startup aborts rather than selecting a recovery action implicitly.  
   (`src/core/utils/stale-run-recovery.ts:391-424`; `src/core/utils/loop-run-tracker.ts:145-166`)

2. `normalizeCrashRules()` runs before the action menu. It scans every task for live-steering records still marked `submitted`; if any exist, it persists those records as `unknown-after-crash`, then refreshes the in-memory state. If none exist, it does nothing.  
   (`src/core/utils/stale-run-recovery.ts:157-169`; `src/core/utils/state.ts:92-100`)

3. Ordinary stale run actions:
   - **resume**: always available; preserves workflow state and retries/restarts recoverable work.
   - **rollback**: available only when `rollbackSnapshotId` exists; restores the loop-start repository state and starts fresh.
   - **abandon**: archives the stale tracker and starts fresh without recovery.
   - **cancel**: aborts startup.
   (`src/core/utils/stale-run-recovery.ts:124-154`)

4. Partial panic-undo actions:
   - Detected when `panicUndo` exists and is not `rollback-completed`.
   - **resume** is deliberately unavailable.
   - **finishRollback** is available only when phase is `processes-drained` and a rollback snapshot ID exists.
   - **abandon** and **cancel** remain available.
   (`src/core/utils/stale-run-recovery.ts:112-140`; `docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:27-32`)

### Recovery execution

- **Rollback** adopts the saved snapshot, performs rollback, archives the tracker on success, cleans up, and releases the workspace lock. A failed rollback leaves recovery aborted and preserves failure details.  
  (`src/core/utils/stale-run-recovery.ts:184-224`)

- **Finish Rollback** requires a fresh confirmation, then performs the same destructive rollback. On success it records `rollback-completed` and archives the run as `interrupted` with terminal reason `panic-undo`. On failure it records `rollback-failed` and keeps the tracker active for another attempt.  
  (`src/core/utils/stale-run-recovery.ts:226-286`)

- **Resume** first prepares every task:
  - `implementing`: removes the task worktree/branch boundary so implementation restarts cleanly.
  - `merge-pending`/`merging`: aborts an in-progress merge, requires a clean primary tree, then resets to `preMergeHead`.
  - verification, completion marking, and interrupted review are safely rerunnable.
  - completed tasks with an unreachable `integratedHead` require an explicit restart/trust decision.
  
  After preparation succeeds, `adoptOwnership()` assigns the current PID, refreshes the heartbeat, sets status to `running`, and increments the tracker revision.  
  (`src/core/utils/stale-run-recovery.ts:299-344`; `src/core/utils/stale-run-recovery.ts:461-524`; `src/core/utils/loop-run-tracker.ts:145-157`)

### Resume plan and scheduler reconstruction

`ralphLoop` constructs the `LoopRun`, calls `startOrResume`, then calls `buildResumePlan`.

`buildResumePlan`:

1. Reads the persisted task table.
2. Initially treats only `done` tasks as terminal.
3. For every `mark-done-pending` task:
   - calls optional `issueSource.isDone`;
   - retries `markDone` when necessary, using the persisted ID, title, and body;
   - records the durable transition to `done`;
   - adds the issue to `terminalIds`.
4. Re-reads the tracker after those writes.
5. Builds `replayQueue` from every non-terminal task except `mark-done-pending`.
6. Restores `scheduler.iterationsStarted` and `scheduler.skippedIds`.

Thus interrupted implementation, verification, merge, or scheduled work is replayed, while completed work is not.  
(`src/core/loop-run/resume-plan.ts:35-83`; `src/core/ralph-loop.ts:350-387`)

### Sole authoritative tracker ownership

The new process takes ownership before normal loop execution through `StaleRun.execute("resume")` → `tracker.adoptOwnership()`. `ralphLoop` then creates a `LoopRun` over that tracker. If a rollback snapshot already exists, `startOrResume` adopts it and returns the existing state rather than creating a new run.  
(`src/core/utils/stale-run-recovery.ts:299-320`; `src/core/ralph-loop.ts:334-386`; `src/core/loop-run/loop-run.ts:117-152`)

The tracker’s `update()` reads the current state, increments `revision` by one, and performs an atomic temporary-file write followed by rename. The coordinator’s lifecycle methods write through the tracker first and emit facts only after the write succeeds. Subscribers run synchronously in registration order.  
(`src/core/utils/loop-run-tracker.ts:119-143`; `src/core/utils/loop-run-tracker.ts:369-388`; `src/core/loop-run/loop-run.ts:275-310`; `src/core/loop-run/loop-run.ts:607-610`; `docs/adr/0007-loop-run-coordinator-and-fact-events.md:18-20`)

### Why partial Force-Kill Undo is special

A stale PID only proves the prior process is gone; it does not prove all writer subprocesses exited before rollback. Therefore the tracker persists panic-undo phases, and startup permits Finish Rollback only after `processes-drained` plus a snapshot handle. Normal resume is blocked because continuing workflow work could occur against a partially destructive transaction.  
(`src/core/loop-run/loop-run.ts:205-264`; `src/core/utils/stale-run-recovery.ts:112-140`; `docs/adr/0005-git-backed-force-kill-undo.md:53-57`)

Finish Rollback also requires a new explicit confirmation. A successful operation records rollback completion and archives the run as interrupted; a failure leaves the tracker active.  
(`src/core/utils/stale-run-recovery.ts:226-286`)

### Merge-phase safety check

For interrupted merge recovery, the code aborts any merge, then repeatedly checks `git.isDirty()`. If the primary workspace has uncommitted edits, recovery pauses for the developer to clean it or abandon; non-interactive recovery throws. This prevents `resetHard(preMergeHead)` from overwriting manual changes.  
(`src/core/utils/stale-run-recovery.ts:500-524`; `docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:15`)

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| Staleness is based on owner liveness or heartbeat age | `isStale` | `src/core/utils/loop-run-tracker.ts:145-166` |
| Non-interactive stale startup does not choose a default | `handleStaleRun` | `src/core/utils/stale-run-recovery.ts:405-424` |
| Crash normalization converts submitted steering to unknown | `normalizeCrashRules` | `src/core/utils/stale-run-recovery.ts:157-169` |
| Ordinary action availability depends on snapshot presence | `getAvailableActions` | `src/core/utils/stale-run-recovery.ts:124-154` |
| Partial undo blocks resume | `isPartialPanicUndo`, `getAvailableActions` | `src/core/utils/stale-run-recovery.ts:112-140` |
| Finish Rollback requires drained writers and snapshot ID | `canFinishRollback` | `src/core/utils/stale-run-recovery.ts:116-123` |
| Resume cleans interrupted implementation worktrees | `prepareImplementingResume` | `src/core/utils/stale-run-recovery.ts:461-469` |
| Resume protects merge reset from dirty edits | `prepareMergingResume` | `src/core/utils/stale-run-recovery.ts:471-524` |
| Resume adopts current process ownership | `execute("resume")` | `src/core/utils/stale-run-recovery.ts:299-320` |
| Mark-done-pending tasks are retried and advanced | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:48-70` |
| Replay queue excludes terminal and mark-done-pending tasks | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:72-83` |
| Scheduler iterations and skipped IDs are restored | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:78-83` |
| Tracker revisions are monotonic | `LoopRunTracker.update` | `src/core/utils/loop-run-tracker.ts:119-133` |
| Writes are atomic | `atomicWrite` | `src/core/utils/loop-run-tracker.ts:369-388` |
| LoopRun is the sole writer and emits after persistence | `LoopRunOptions`, coordinator methods | `src/core/loop-run/loop-run.ts:44-50`, `275-310` |
| Subscribers receive ordered synchronous facts | `subscribe`, `emit` | `src/core/loop-run/loop-run.ts:78-94`, `607-610` |
| Partial undo state is durable | `requestPanicUndo`, `rollback` | `src/core/loop-run/loop-run.ts:205-264`, `165-201` |

## 4. Tests and documentation

- `test/stale-run-recovery.test.ts:75-104` covers ordinary action availability.
- `test/stale-run-recovery.test.ts:1213-1372` covers partial panic-undo gating.
- `test/stale-run-recovery.test.ts:1387-1489` covers Finish Rollback confirmation and failure retention.
- `test/recovery-integration.test.ts:230-300` covers dirty merge protection and clean merge replay.
- `test/resume-plan.test.ts:16-99` covers `mark-done-pending`, including body propagation and idempotent completion.
- `docs/adr/0005-git-backed-force-kill-undo.md` defines rollback and partial-undo safety.
- `docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md` defines stale recovery and resume policy.
- `docs/adr/0007-loop-run-coordinator-and-fact-events.md` defines sole ownership and write-then-emit ordering.

## 5. Uncertainties

- The ADR requires Finish Rollback to validate snapshot readability and branch/workspace context, but `canFinishRollback()` currently checks only panic phase and snapshot ID (`src/core/utils/stale-run-recovery.ts:116-123`).
- The ADR says startup-finished partial undo should first adopt a `LoopRun`; the current `finishRollback` branch writes directly through `LoopRunTracker` before archiving (`src/core/utils/stale-run-recovery.ts:226-286`). Ordinary resume does reach a coordinator-owned `LoopRun`.
- Abandon currently calls `markCompletedAndArchive()` even for partial panic-undo (`src/core/utils/stale-run-recovery.ts:174-181`), whereas ADR-0006 specifies archival as `interrupted` with retained panic-undo state.
