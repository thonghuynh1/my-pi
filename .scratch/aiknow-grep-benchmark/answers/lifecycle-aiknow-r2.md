## 1. Executive summary

On startup, `handleStaleRun` reads the active tracker, verifies it is stale, normalizes crash-sensitive steering state, offers only actions valid for the persisted state, and executes the selected recovery. For resume, it cleans interrupted work, adopts the tracker under the new PID, constructs a `LoopRun`, and rebuilds scheduler state with `buildResumePlan`.

The resumed process becomes authoritative by calling `adoptOwnership`, which writes the new owner and increments the tracker revision before normal LoopRun writes and events continue. LoopRun subscribers receive events only after durable writes and in registration order.

## 2. Detailed flow / architecture / impact analysis

1. **Detection and action selection**
   - `handleStaleRun` returns immediately if no state exists, aborts if the owner is still active, and aborts in non-interactive default mode because no safe choice can be selected: `src/core/utils/stale-run-recovery.ts:394-425`.
   - It calls `normalizeCrashRules`, then obtains the permitted actions before prompting: `src/core/utils/stale-run-recovery.ts:430-442`.
   - Ordinary stale runs always offer `resume`, `abandon`, and `cancel`. `rollback` is added only when `rollbackSnapshotId` exists: `src/core/utils/stale-run-recovery.ts:142-155`.
   - `cancel` aborts startup without changes; `abandon` archives the stale tracker and starts a new run; `rollback` restores the snapshot, archives the stale run, and starts fresh: `src/core/utils/stale-run-recovery.ts:181-223`.
   - A partial panic undo is a separate state. It offers only `abandon` and `cancel`, plus `finishRollback` only when processes are drained and a rollback snapshot exists: `src/core/utils/stale-run-recovery.ts:129-156`.

2. **Crash-rule normalization**
   - `normalizeCrashRules` checks whether any task contains live-steering records with `status: "submitted"`. If none exist, it does nothing; otherwise it calls tracker normalization and refreshes in-memory state: `src/core/utils/stale-run-recovery.ts:158-167`.
   - It is called after stale detection and before action availability is calculated or the choice is prompted: `src/core/utils/stale-run-recovery.ts:425-433`.
   - The tracker applies `normalizeSteeringPostCrash` to every task’s steering records and persists the result: `src/core/utils/loop-run-tracker.ts:391-404`.

3. **Resume preparation and scheduler reconstruction**
   - Resume first recovers interrupted invocations and prepares each persisted task by phase. Implementing tasks have their worktrees cleaned; merging tasks abort an in-progress merge, require a clean primary workspace, reset to `preMergeHead`, and clean the worktree; verification and review are rerun; interrupted completion marking is retried: `src/core/utils/stale-run-recovery.ts:308-379`, `src/core/utils/stale-run-recovery.ts:463-504`.
   - `buildResumePlan` reads the persisted task table. Done tasks become terminal IDs; failed tasks are not treated as non-retryable terminals: `src/core/loop-run/resume-plan.ts:40-45`, `src/core/loop-run/resume-plan.ts:82-88`.
   - `mark-done-pending` tasks are checked with `isDone`; if needed, `markDone` is called, then the tracker phase is durably advanced to `done` and the task is added to terminal IDs: `src/core/loop-run/resume-plan.ts:47-63`.
   - It rereads the tracker, converts all nonterminal, non-`mark-done-pending` tasks into the replay queue, and restores iteration/skipped-ID scheduler state: `src/core/loop-run/resume-plan.ts:65-79`.
   - The production loop invokes this plan before scheduling work: `src/core/ralph-loop.ts:390-400`.

4. **Sole ownership and event ordering**
   - After successful resume preparation, `execute("resume")` calls `tracker.adoptOwnership()`: `src/core/utils/stale-run-recovery.ts:288-304`.
   - `adoptOwnership` uses the generic update path, sets status to `running`, records the new PID and heartbeat, increments `revision`, and atomically writes the state: `src/core/utils/loop-run-tracker.ts:154-163`, `src/core/utils/loop-run-tracker.ts:172-181`.
   - The new `LoopRun` is constructed with that tracker and `startOrResume` adopts the existing rollback snapshot when present, rather than creating a new one: `src/core/ralph-loop.ts:344-376`, `src/core/loop-run/loop-run.ts:111-146`.
   - LoopRun is documented as the sole authoritative writer; normal callers must not write directly to the tracker: `src/core/loop-run/loop-run.ts:38-46`.
   - Writes precede events. Subscribers are invoked synchronously in registration order only after the durable write returns: `src/core/loop-run/loop-run.ts:69-75`, `src/core/loop-run/loop-run.ts:582-586`.

5. **Partial Force-Kill Undo**
   - A panic undo is partial whenever `panicUndo` exists with a phase other than `rollback-completed`: `src/core/utils/stale-run-recovery.ts:37-40`, `src/core/utils/stale-run-recovery.ts:129-133`.
   - It is not treated as an ordinary stale run because live processes may have been killed but repository rollback may not have completed; therefore resume and ordinary rollback are withheld: `src/core/utils/stale-run-recovery.ts:142-149`.
   - `finishRollback` requires explicit confirmation, an existing snapshot, and the `processes-drained` phase. It adopts the snapshot, performs rollback, records success/failure, cleans up, and archives the run as interrupted: `src/core/utils/stale-run-recovery.ts:135-140`, `src/core/utils/stale-run-recovery.ts:225-285`.

6. **Merge recovery safety check**
   - Before resetting to `preMergeHead`, merge recovery repeatedly checks `git.isDirty()`. Uncommitted edits block recovery because reset could overwrite them; the user must clean the workspace and retry or abandon: `src/core/utils/stale-run-recovery.ts:476-503`.

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| Stale detection precedes normalization and prompting | `handleStaleRun` | `src/core/utils/stale-run-recovery.ts:394-442` |
| Ordinary action availability depends on snapshot presence | `getAvailableActions` | `src/core/utils/stale-run-recovery.ts:142-155` |
| Partial panic undo restricts recovery choices | `isPartialPanicUndo`, `canFinishRollback` | `src/core/utils/stale-run-recovery.ts:129-149` |
| Crash normalization targets submitted steering records | `normalizeCrashRules` | `src/core/utils/stale-run-recovery.ts:158-167` |
| Pending completion is confirmed/marked and persisted as done | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:47-63` |
| Replay and scheduler state derive from refreshed tracker state | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:65-79` |
| Resume cleans or resets interrupted task state | `prepareResume`, `prepareMergingResume` | `src/core/utils/stale-run-recovery.ts:308-379`, `470-504` |
| New process adopts ownership | `adoptOwnership` | `src/core/utils/loop-run-tracker.ts:154-181` |
| Tracker revisions increase monotonically on update | `update` | `src/core/utils/loop-run-tracker.ts:154-163` |
| LoopRun is the sole authoritative writer | `LoopRunOptions` | `src/core/loop-run/loop-run.ts:38-46` |
| Events occur after writes and in subscriber order | `subscribe`, `emit` | `src/core/loop-run/loop-run.ts:69-95`, `582-586` |
| Dirty primary workspace blocks merge recovery | `prepareMergingResume` | `src/core/utils/stale-run-recovery.ts:476-503` |
| Production invokes resume-plan reconstruction | `ralphLoop` | `src/core/ralph-loop.ts:344-400` |

## 4. Tests and documentation

- Tests verify write-before-event behavior, subscriber registration order, and no event when a write fails: `test/loop-run.test.ts:41-105`.
- Tests verify task phase transitions including `mark-done-pending → done`: `test/loop-run.test.ts:65-77`.
- The resume-plan module explicitly references ADR-0006 for durable tracker and stale-run recovery behavior: `src/core/loop-run/resume-plan.ts:21-22`.
- Tracker documentation references ADR-0006 and ADR-0007 and describes atomic, crash-safe, monotonic writes: `src/core/utils/loop-run-tracker.ts:2-10`.

## 5. Uncertainties

- The inspected implementation establishes the recovery and ownership sequence, but the exact scheduler-consumer code that consumes `replayQueue` was not directly evidenced here; its construction and production call site are directly evidenced.
- `normalizeSteeringPostCrash`’s individual status transformations are delegated to `src/core/loop-run/state.ts`; only its invocation and persistence were directly evidenced.
