## 1. Executive summary

Startup reads `.ralph-loop/runs/active.json` and treats the tracker as stale when its owner process is dead or its heartbeat is older than 30 seconds (`src/core/utils/loop-run-tracker.ts:168-182`). Recovery occurs before creating a new snapshot or LoopRun (`src/core/ralph-loop.ts:314-386`).

For an ordinary stale run, startup offers:

- **Resume** always; it reconstructs safe task boundaries.
- **Rollback** only when `rollbackSnapshotId` exists.
- **Abandon** and **cancel** always.
- **Finish Rollback** only for a partial Force-Kill Undo that durably reached `processes-drained` and still has a rollback snapshot.

After resume preparation, the new process claims the existing tracker using `adoptOwnership()`, which changes PID/heartbeat and increments revision. A `LoopRun` is then created, resumes the same logical tracker, builds scheduler state, and becomes the authoritative lifecycle writer.

## 2. Detailed flow / architecture / impact analysis

1. **Detection and action selection**

   `handleStaleRun()` first reads the tracker, rejects a currently active owner, rejects non-interactive recovery, normalizes crash state, computes available actions, prompts, and executes the selected action (`src/core/utils/stale-run-recovery.ts:398-440`).

   Ordinary stale runs offer `resume`, `abandon`, and `cancel`; `rollback` is inserted only when `rollbackSnapshotId` is present (`src/core/utils/stale-run-recovery.ts:135-151`). A missing snapshot disables loop-start rollback but does not disable tracker-based resume, consistent with the ADR (`docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:39-43`).

2. **Crash normalization**

   `normalizeCrashRules()` checks every task’s `liveSteering` records for status `submitted`. If any exist, it calls `normalizeLiveSteeringPostCrash()`, converting those records to the post-crash status and rereading tracker state (`src/core/utils/stale-run-recovery.ts:157-168`; `src/core/utils/loop-run-tracker.ts:360-373`).

   It is called after stale detection but before the recovery prompt (`src/core/utils/stale-run-recovery.ts:423-431`), so the developer sees normalized state.

3. **Resume preparation**

   Resume does not continue writer phases in place:

   - `implementing`: delete/recreate the task worktree boundary.
   - `merge-pending`/`merging`: abort an in-progress merge, require a clean primary workspace, reset to `preMergeHead`, then clean the task worktree.
   - `verify-pending`/`verifying`: rerun verification.
   - `mark-done-pending`: retry completion marking.
   - `done`: verify `integratedHead` remains reachable from `HEAD`; otherwise request restart or explicit trust.
   - interrupted/failed/blocked whole-run review is rerun.

   (`src/core/utils/stale-run-recovery.ts:306-347`)

   `buildResumePlan()` then translates the persisted table into scheduler state. Done tasks become terminal IDs; `mark-done-pending` tasks call `isDone` when available, otherwise `markDone`, then persist `done`. The tracker is reread, nonterminal tasks become `replayQueue`, and scheduler iterations/skipped IDs are restored (`src/core/loop-run/resume-plan.ts:31-76`).

4. **Ownership transfer and resumed scheduling**

   After preparation succeeds, resume calls `tracker.adoptOwnership()` (`src/core/utils/stale-run-recovery.ts:294-302`). This updates status, PID, and heartbeat through a revisioned tracker update (`src/core/utils/loop-run-tracker.ts:140-162`).

   `ralphLoop()` then constructs `LoopRun`, registers observers, and calls `startOrResume()`. Existing snapshots are adopted; otherwise a new snapshot is captured and persisted into the existing tracker (`src/core/ralph-loop.ts:346-386`; `src/core/loop-run/loop-run.ts:117-152`). A heartbeat is updated every 10 seconds (`src/core/ralph-loop.ts:377-384`).

   The LoopRun is the sole authoritative writer. Tracker updates atomically replace the file and increment `revision`; events are emitted only after successful writes. Subscribers run synchronously in registration order (`src/core/utils/loop-run-tracker.ts:136-144,375-388`; `src/core/loop-run/loop-run.ts:276-310,607-611`; `docs/adr/0007-loop-run-coordinator-and-fact-events.md:18-21`).

5. **Partial Force-Kill Undo**

   A `panicUndo` record whose phase is anything other than `rollback-completed` is classified as partial (`src/core/utils/stale-run-recovery.ts:117-127`). It is not an ordinary stale run because rollback may already have crossed a destructive boundary.

   Such a run never offers `resume`. It offers `finishRollback` only when:

   - phase is exactly `processes-drained`;
   - `rollbackSnapshotId` exists.

   Otherwise only `abandon` and `cancel` are available (`src/core/utils/stale-run-recovery.ts:129-151`; `docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:54-57`).

   Finish Rollback requires fresh confirmation, adopts the snapshot, retries rollback, records failure if needed, cleans up, records `rollback-completed`, and archives the run as `interrupted` with terminal reason `panic-undo` (`src/core/utils/stale-run-recovery.ts:224-285`).

   **Implementation note:** the ADR requires adopting the stale run into a `LoopRun` before continuing panic-undo writes (`docs/adr/0007-loop-run-coordinator-and-fact-events.md:33-36`), but the current `finishRollback` branch writes directly through `LoopRunTracker` before `LoopRun` construction (`src/core/utils/stale-run-recovery.ts:237-278`). This is an implementation/documentation mismatch.

6. **Merge safety check**

   `prepareMergingResume()` aborts any in-progress merge, then loops while `git.isDirty()`. Recovery refuses to reset to `preMergeHead` until the primary workspace is clean; interactive mode offers retry or abandon, while non-interactive mode throws (`src/core/utils/stale-run-recovery.ts:468-503`). This prevents overwriting manual uncommitted edits.

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| Dead owner or stale heartbeat marks tracker stale | `isStale` | `src/core/utils/loop-run-tracker.ts:168-182` |
| Recovery happens before LoopRun startup | `handleStaleRun` call | `src/core/ralph-loop.ts:314-386` |
| Non-TTY recovery fails without selecting a default | `handleStaleRun` | `src/core/utils/stale-run-recovery.ts:406-421` |
| Rollback requires a snapshot | `getAvailableActions` | `src/core/utils/stale-run-recovery.ts:135-151` |
| Crash normalization handles submitted steering records | `normalizeCrashRules` | `src/core/utils/stale-run-recovery.ts:157-168` |
| Normal resume prepares interrupted phases | `prepareResume` | `src/core/utils/stale-run-recovery.ts:306-347` |
| `mark-done-pending` is retried and persisted as done | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:45-62` |
| Replay queue excludes terminal tasks | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:65-76` |
| Resumed process claims existing tracker | `adoptOwnership` | `src/core/utils/stale-run-recovery.ts:294-302`; `src/core/utils/loop-run-tracker.ts:154-162` |
| Tracker revisions are monotonic and writes atomic | `update`, `atomicWrite` | `src/core/utils/loop-run-tracker.ts:136-144,375-388` |
| Events follow durable writes and subscriber order | `recordTaskPhase`, `emit` | `src/core/loop-run/loop-run.ts:276-310,607-611` |
| Partial panic-undo blocks ordinary resume | `isPartialPanicUndo` / `getAvailableActions` | `src/core/utils/stale-run-recovery.ts:117-151` |
| Finish Rollback requires drained writers and snapshot | `canFinishRollback` | `src/core/utils/stale-run-recovery.ts:129-133` |
| Dirty primary workspace blocks merge recovery | `prepareMergingResume` | `src/core/utils/stale-run-recovery.ts:468-503` |

## 4. Tests and documentation

- Recovery action availability and partial panic-undo behavior: `test/stale-run-recovery.test.ts:81-113,1234-1356`.
- Finish Rollback confirmation and failure retention: `test/stale-run-recovery.test.ts:1391-1481`.
- Merge dirty-worktree protection: `test/recovery-integration.test.ts:258-?`; `test/stale-run-recovery.test.ts:704-?`.
- Resume completion handling: `test/resume-plan.test.ts:16-84`.
- Revision and atomic update behavior: `test/loop-run-tracker.test.ts:436-456`.
- Subscriber ordering and phase ordering: `test/loop-run.test.ts:68-90`.
- Design requirements: `docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:32-57`.
- Sole writer and write-then-emit model: `docs/adr/0007-loop-run-coordinator-and-fact-events.md:18-36`.

## 5. Uncertainties

- The current `finishRollback` implementation directly mutates the tracker before constructing `LoopRun`, contrary to ADR-0007’s sole-writer requirement.
- The implementation’s `canFinishRollback()` checks for a recorded snapshot ID, but does not itself verify snapshot readability or branch/workspace context; those stricter requirements are specified in ADR-0005 rather than enforced in this predicate (`docs/adr/0005-git-backed-force-kill-undo.md:69-73`).
