## 1. Executive summary

A startup reads the active tracker and distinguishes **missing**, **live**, and **stale** runs. For a stale run it normalizes crash-incomplete steering, computes valid recovery actions, prompts the developer, prepares workspaces, then calls `adoptOwnership()` before continuing. The resumed `LoopRun` becomes the sole tracker writer; every durable mutation is written atomically before subscribers receive events.

## 2. Detailed flow / architecture / impact analysis

1. **Detection and action availability**
   - `handleStaleRun` returns `proceed` when no tracker exists, aborts if the owner is still active, and aborts non-interactively rather than selecting a default recovery action (`src/core/utils/stale-run-recovery.ts:394-423`).
   - It constructs `StaleRun`, normalizes crash rules, computes actions, validates the selected action, and executes it (`src/core/utils/stale-run-recovery.ts:425-442`).
   - Ordinary stale runs offer `resume`, `abandon`, and `cancel`; `rollback` is added only when `rollbackSnapshotId` exists (`src/core/utils/stale-run-recovery.ts:142-155`).
   - A partial panic undo is special: it offers only `abandon`/`cancel`, plus `finishRollback` only when processes were drained and a rollback snapshot exists (`src/core/utils/stale-run-recovery.ts:129-149`).

2. **Crash-rule normalization**
   - `normalizeCrashRules()` checks whether any task has live steering still marked `submitted`; if none do, it does nothing. Otherwise it persists every such record as `unknown-after-crash`, then refreshes in-memory state (`src/core/utils/stale-run-recovery.ts:158-167`; `src/core/loop-run/state.ts:112-123`).
   - Startup invokes it after stale detection and before presenting actions (`src/core/utils/stale-run-recovery.ts:425-433`).

3. **Recovery choices**
   - `cancel` aborts without mutation; `abandon` archives the stale tracker and starts a new run (`src/core/utils/stale-run-recovery.ts:181-188`).
   - `rollback` requires a snapshot, adopts it, rolls back, archives the stale run on success, cleans workspace state, and releases the lock (`src/core/utils/stale-run-recovery.ts:190-223`).
   - `resume` first repairs interrupted invocations and task/workspace state, then adopts tracker ownership (`src/core/utils/stale-run-recovery.ts:288-304`).
   - Resume preparation cleans implementation worktrees, aborts an in-progress merge, validates a clean primary workspace, resets to `preMergeHead`, and cleans the task worktree (`src/core/utils/stale-run-recovery.ts:308-379`, `470-504`).

4. **Persisted task table → live scheduler state**
   - `buildResumePlan` treats `done` tasks as terminal, selects `mark-done-pending` tasks for completion repair, and re-reads the tracker after those writes (`src/core/loop-run/resume-plan.ts:40-72`).
   - For each mark-done-pending task it calls `isDone`, calls `markDone` if necessary, records `done`, and adds the issue to terminal IDs (`src/core/loop-run/resume-plan.ts:47-63`).
   - Remaining nonterminal, non-pending tasks become the replay queue; persisted iteration count and skipped IDs restore scheduler progress (`src/core/loop-run/resume-plan.ts:68-79`).
   - Verification interruptions are deliberately rerun; inconsistent completed tasks require a restart/trust decision (`src/core/utils/stale-run-recovery.ts:327-371`).

5. **Sole ownership and event ordering**
   - `adoptOwnership()` updates the existing state to `running`, replaces the owner PID with the new process, refreshes heartbeat, increments revision through `update`, and atomically persists it (`src/core/utils/loop-run-tracker.ts:154-181`).
   - `update` always sets `next.revision = current.revision + 1`; `atomicWrite` writes state, pointer, and compatibility mirror via temporary files and renames (`src/core/utils/loop-run-tracker.ts:154-162`, `406-431`).
   - `LoopRun` is explicitly designed as the sole authoritative writer (`src/core/loop-run/loop-run.ts:1-7`, `38-46`).
   - Mutations use write-then-emit: subscribers see facts only after persistence succeeds (`src/core/loop-run/loop-run.ts:270-305`). Subscribers run synchronously in registration order (`src/core/loop-run/loop-run.ts:69-75`, `582-585`; `src/core/loop-run/events.ts:1-7`).
   - Thus, after `adoptOwnership()` and construction/use of the resumed `LoopRun`, the new process controls all subsequent tracker writes and event publication.

6. **Partial Force-Kill Undo**
   - A panic undo is not an ordinary stale run unless it reached terminal `rollback-completed`; any other panic phase is partial (`src/core/utils/stale-run-recovery.ts:37-40`, `129-133`).
   - `finishRollback` requires explicit confirmation, a recorded snapshot, and the `processes-drained` phase; it reruns rollback, records failure if needed, and on success records `rollback-completed`, archives as interrupted with reason `panic-undo`, and releases the lock (`src/core/utils/stale-run-recovery.ts:135-140`, `225-285`).
   - This protects against resuming while the previous process may have been killed mid-undo or while rollback is incomplete.

7. **Merge safety check**
   - For `merge-pending`/`merging` tasks, recovery aborts any in-progress merge and repeatedly checks `git.isDirty()`. Uncommitted primary-workspace edits block reset to `preMergeHead`; the developer must clean the tree, retry, or abandon (`src/core/utils/stale-run-recovery.ts:470-500`).

## 3. Evidence table

| Claim | Symbol | File:line |
|---|---|---|
| Recovery choices are resume/rollback/finishRollback/abandon/cancel | `RecoveryChoice` | `src/core/utils/stale-run-recovery.ts:10` |
| Stale runs are detected before prompting | `handleStaleRun` | `src/core/utils/stale-run-recovery.ts:394-433` |
| Action availability depends on panic phase and snapshot | `getAvailableActions` | `src/core/utils/stale-run-recovery.ts:129-155` |
| Crash steering is normalized before prompting | `normalizeCrashRules` | `src/core/utils/stale-run-recovery.ts:158-167`, `430-433` |
| Mark-done-pending tasks are completed during planning | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:47-63` |
| Replay queue and scheduler progress are restored | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:65-79` |
| New process adopts tracker ownership | `adoptOwnership` | `src/core/utils/loop-run-tracker.ts:172-181` |
| Revisions are monotonic | `update` | `src/core/utils/loop-run-tracker.ts:154-162` |
| Writes precede emitted events | `recordTaskPhase` | `src/core/loop-run/loop-run.ts:270-305` |
| Subscriber order is registration order | `subscribe`, `emit` | `src/core/loop-run/loop-run.ts:69-75`, `582-585` |
| Partial panic undo requires drained processes and snapshot | `canFinishRollback` | `src/core/utils/stale-run-recovery.ts:135-140` |
| Dirty primary workspace blocks merge recovery | `prepareMergingResume` | `src/core/utils/stale-run-recovery.ts:480-500` |

## 4. Tests and documentation

- Recovery action availability and missing-snapshot behavior: `test/stale-run-recovery.test.ts:114-147`.
- Stale/noninteractive startup behavior: `test/stale-run-recovery.test.ts:162-209`.
- Durable write before event emission: `test/loop-run.test.ts:41-63`.
- Subscriber ordering: `test/loop-run.test.ts:80-88`.
- Panic undo event sequencing: `test/loop-run.test.ts:192-209`.
- Design references are identified in the source as ADR-0006 and ADR-0007: `src/core/loop-run/resume-plan.ts:21`, `src/core/loop-run/loop-run.ts:9`.

## 5. Uncertainties

- The indexed evidence shows the recovery coordinator calling `adoptOwnership()` and the `LoopRun` ownership contract, but does not expose the higher-level startup caller that wires the returned recovery result into the scheduler. The scheduler handoff is therefore inferred from `buildResumePlan`’s explicit runtime-state contract (`src/core/loop-run/resume-plan.ts:4-19`).
