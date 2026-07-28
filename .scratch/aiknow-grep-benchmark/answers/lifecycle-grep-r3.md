## 1. Executive summary

On startup, `handleStaleRun` reads the active tracker, rejects active/non-TTY runs, normalizes crash-sensitive steering records, computes valid recovery actions, and executes the selected action [`src/core/utils/stale-run-recovery.ts:394-442`].

For ordinary stale runs, resume is always available; rollback requires a persisted rollback snapshot; abandon archives the stale tracker; cancel aborts startup. Partial Force-Kill Undo is a separate state machine: resume is blocked, and Finish Rollback is offered only after durable process drainage plus a snapshot [`src/core/utils/stale-run-recovery.ts:129-156`].

After preparation, the new process adopts the existing tracker, constructs `LoopRun`, builds scheduler state from persisted tasks, and all subsequent durable writes flow through `LoopRun` before events are synchronously delivered to subscribers [`src/core/utils/stale-run-recovery.ts:302-303`; `src/core/ralph-loop.ts:351-400`; `src/core/loop-run/loop-run.ts:70-72`].

## 2. Detailed flow / architecture / impact analysis

1. **Stale detection and action selection**
   - No tracker: startup proceeds.
   - Non-stale tracker: startup aborts to prevent concurrent loop ownership.
   - Default prompts without a TTY: startup fails closed; no implicit recovery action is selected [`src/core/utils/stale-run-recovery.ts:401-423`].
   - Ordinary stale run:
     - `resume`: always available.
     - `rollback`: available only when `rollbackSnapshotId` exists.
     - `abandon`: always available and archives the tracker.
     - `cancel`: always available and aborts startup [`src/core/utils/stale-run-recovery.ts:142-156`].
   - Missing rollback snapshot disables rollback but does not prevent tracker-based resume; the resumed result reports `rollbackDisabled` [`src/core/utils/stale-run-recovery.ts:302-303`; `docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:39-40`].

2. **Crash-rule normalization**
   - `normalizeCrashRules` checks whether any task has a live-steering record with status `submitted`. If none exist, it does nothing.
   - If records exist, it calls `tracker.normalizeLiveSteeringPostCrash()` and refreshes the in-memory state [`src/core/utils/stale-run-recovery.ts:158-168`].
   - The underlying pure transformation changes `submitted` to `unknown-after-crash` and leaves terminal statuses unchanged [`src/core/loop-run/state.ts:113-123`].
   - It is called after stale detection and before the recovery menu is displayed [`src/core/utils/stale-run-recovery.ts:430-433`].

3. **Resume preparation**
   - `prepareResume` recovers interrupted invocation bundles, then processes persisted task phases [`src/core/utils/stale-run-recovery.ts:307-368`].
   - Implementing tasks have their isolated worktrees cleaned so implementation restarts from the worktree boundary.
   - Merge-pending/merging tasks abort an in-progress merge, require a clean primary workspace, reset to `preMergeHead`, and clean the task worktree [`src/core/utils/stale-run-recovery.ts:470-503`].
   - Verification, completion marking, and interrupted/failed/blocked whole-run review are safely rerun.
   - Done tasks with an unreachable `integratedHead` require an explicit restart-or-trust decision; restart persists the task as scheduled [`src/core/utils/stale-run-recovery.ts:336-368`].

4. **Building live scheduler state**
   - `buildResumePlan` reads the persisted task table.
   - Done tasks populate `terminalIds`; failed tasks are not treated as non-retryable terminal tasks.
   - `mark-done-pending` tasks are checked with `issueSource.isDone`; if not already complete, `markDone` is retried using the persisted issue identity, title, and body. Each is then recorded as `done` and added to `terminalIds` [`src/core/loop-run/resume-plan.ts:39-63`].
   - The tracker is re-read after those writes. Non-terminal tasks, excluding `mark-done-pending`, become `replayQueue`; scheduler iterations and skipped IDs are restored from persisted scheduler progress [`src/core/loop-run/resume-plan.ts:65-79`].
   - Ralph seeds claimed IDs and iteration count from this plan, then replays queued tasks before fetching new issues [`src/core/ralph-loop.ts:697-714`; `src/core/ralph-loop.ts:749-754`].

5. **Sole ownership and event ordering**
   - After successful resume preparation, `tracker.adoptOwnership()` changes the existing logical run back to `running`, records the new process PID and heartbeat, and increments the revision through `update` [`src/core/utils/stale-run-recovery.ts:302-303`; `src/core/utils/loop-run-tracker.ts:154-180`].
   - `LoopRun.startOrResume` then reads/adopts the existing tracker rather than creating a new run [`src/core/loop-run/loop-run.ts:111-146`].
   - Every tracker update increments `revision` before atomic replacement; writes are therefore monotonic and crash-safe [`src/core/utils/loop-run-tracker.ts:154-162`, `406-435`].
   - `LoopRun` is the sole authoritative writer during execution; phase, metadata, scheduler, review, and completion operations write first and emit facts only after persistence succeeds [`src/core/loop-run/loop-run.ts:39-46`, `276-304`, `441-460`].
   - Subscribers are invoked synchronously in registration order after the write [`src/core/loop-run/loop-run.ts:70-72`, `582-584`]. Thus the resumed `LoopRun` is back in control once ownership adoption succeeds and its coordinator has been initialized.

6. **Partial Force-Kill Undo**
   - A `panicUndo` record whose phase is not `rollback-completed` is classified as partial undo, not ordinary stale work [`src/core/utils/stale-run-recovery.ts:129-133`].
   - Normal resume is blocked because live writers may not have been safely drained.
   - Finish Rollback requires both `panicUndo.phase === "processes-drained"` and a rollback snapshot; otherwise only abandon/cancel are offered [`src/core/utils/stale-run-recovery.ts:135-156`].
   - Finish Rollback requires confirmation, adopts the snapshot, runs rollback, records rollback failure without archiving if unsuccessful, and archives the run as interrupted with `panic-undo` only after success [`src/core/utils/stale-run-recovery.ts:222-269`].
   - This implements the rule that a stale PID alone does not prove rollback safety [`docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:52-57`].

7. **Dirty-workspace safety check**
   - During merge recovery, `git.isDirty()` is checked before the destructive reset to `preMergeHead`.
   - Recovery repeatedly prompts the developer to commit, stash, discard, retry, or abandon; non-interactive startup throws instead of resetting [`src/core/utils/stale-run-recovery.ts:480-500`].
   - This prevents manual primary-workspace edits from being overwritten [`docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:39`, `65`].

## 3. Evidence table

| Claim | Symbol | File:line |
|---|---|---|
| Active/non-stale runs are rejected; non-TTY stale recovery fails closed | `handleStaleRun` | `src/core/utils/stale-run-recovery.ts:401-423` |
| Ordinary recovery actions depend on snapshot presence | `getAvailableActions` | `src/core/utils/stale-run-recovery.ts:142-156` |
| Crash normalization converts submitted steering to unknown-after-crash | `normalizeCrashRules`, `normalizeSteeringPostCrash` | `src/core/utils/stale-run-recovery.ts:158-168`; `src/core/loop-run/state.ts:113-123` |
| Normalization occurs before prompting | `handleStaleRun` | `src/core/utils/stale-run-recovery.ts:430-433` |
| Implementing tasks restart at worktree boundary | `prepareImplementingResume` | `src/core/utils/stale-run-recovery.ts:318-321`, `463-468` |
| Merge recovery aborts, checks cleanliness, resets, and cleans worktree | `prepareMergingResume` | `src/core/utils/stale-run-recovery.ts:322-325`, `470-503` |
| Mark-done-pending tasks are completed idempotently | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:47-63` |
| Replay queue and scheduler progress are restored | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:65-79` |
| Resumed tasks are replayed before new fetches | scheduler loop | `src/core/ralph-loop.ts:697-714`, `749-754` |
| New PID adopts existing tracker ownership | `adoptOwnership` | `src/core/utils/loop-run-tracker.ts:154-180` |
| Revisions increase before atomic writes | `update`, `atomicWrite` | `src/core/utils/loop-run-tracker.ts:154-162`, `406-435` |
| Writes precede event emission | `recordTaskPhase`, `recordTaskMeta` | `src/core/loop-run/loop-run.ts:270-304` |
| Subscribers receive events synchronously in registration order | `subscribe`, `emit` | `src/core/loop-run/loop-run.ts:70-72`, `90-95`, `582-584` |
| Partial panic undo blocks resume | `isPartialPanicUndo`, `getAvailableActions` | `src/core/utils/stale-run-recovery.ts:129-156` |
| Finish Rollback requires drained processes and snapshot | `canFinishRollback` | `src/core/utils/stale-run-recovery.ts:135-140` |
| Finish Rollback preserves failed recovery state | `execute("finishRollback")` | `src/core/utils/stale-run-recovery.ts:222-269` |
| Dirty merge recovery is blocked | `prepareMergingResume` | `src/core/utils/stale-run-recovery.ts:480-500` |

## 4. Tests and documentation

- Recovery action gating and partial panic-undo behavior are covered by `test/stale-run-recovery.test.ts:1309-1409`.
- Finish Rollback confirmation and failure retention are covered by `test/stale-run-recovery.test.ts:1424-1530`.
- Steering normalization is covered by `test/stale-run-recovery.test.ts:1594-1780`.
- Resume completion behavior is covered by `test/resume-plan.test.ts:11-105`.
- The design contract is documented in ADR-0006, especially decisions 11–23 and 27–32 [`docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:27-57`].

## 5. Uncertainties

- The code establishes ownership after resume preparation, but the exact OS-level guarantee that the crashed PID cannot revive is not represented beyond stale detection and the new PID/heartbeat write.
- `rollbackDisabled` reflects missing snapshot state; it does not itself prevent tracker-based resume.
- Whole-run review rerun behavior is documented and logged, but its complete downstream scheduler effect is outside the stale-recovery module.
