## 1. Executive summary

On startup, `ralphLoop` calls `handleStaleRun`. It rejects a live tracker, aborts non-interactive recovery without injected prompts, normalizes crash-sensitive state, computes valid recovery choices, and executes the selected action.【src/core/ralph-loop.ts:310-319】【src/core/utils/stale-run-recovery.ts:392-440】

For resume, the stale process is cleaned up, the new process adopts tracker ownership, reconstructs scheduler state with `buildResumePlan`, and continues using the existing tracker. Tracker mutations are durable, revision-monotonic, and emitted only after successful writes.【src/core/utils/stale-run-recovery.ts:287-303】【src/core/loop-run/resume-plan.ts:35-79】【src/core/utils/loop-run-tracker.ts:132-159】

## 2. Detailed flow / architecture / impact analysis

1. **Detection and action selection**
   - No tracker: proceed.
   - Tracker whose owner is alive and heartbeat is current: abort; another loop is active.
   - Stale tracker in default non-TTY mode: abort rather than select a default action.
   - Otherwise, `normalizeCrashRules()` runs before choices are offered.【src/core/utils/stale-run-recovery.ts:398-428】

   For an ordinary stale run:
   - `resume` is always offered.
   - `abandon` archives the stale run and starts fresh.
   - `cancel` aborts recovery.
   - `rollback` is offered only when `rollbackSnapshotId` exists.【src/core/utils/stale-run-recovery.ts:141-155】【src/core/utils/stale-run-recovery.ts:180-218】

   A partial panic undo is different:
   - It is identified when `panicUndo` exists and its phase is not `rollback-completed`.
   - Only `abandon` and `cancel` are normally offered.
   - `finishRollback` is additionally offered only when the phase is `processes-drained` and a rollback snapshot exists.【src/core/utils/stale-run-recovery.ts:128-155】

2. **Crash-rule normalization**
   - `normalizeCrashRules()` checks whether any task contains a live-steering record with status `submitted`.
   - If so, it calls `normalizeLiveSteeringPostCrash()`, which converts every `submitted` record to `unknown-after-crash`, then reloads tracker state.
   - If no such record exists, it does nothing.【src/core/utils/stale-run-recovery.ts:157-166】【src/core/utils/loop-run-tracker.ts:356-369】【src/core/loop-run/state.ts:112-123】

3. **Resume preparation**
   - `implementing` tasks have their worktrees cleaned.
   - `merge-pending`/`merging` tasks abort any in-progress merge, require a clean primary workspace, reset to `preMergeHead`, and clean the task worktree.
   - Interrupted verification and completion marking are retried.
   - Done tasks whose `integratedHead` is unreachable from `HEAD` require developer input or fail in non-interactive mode.【src/core/utils/stale-run-recovery.ts:312-377】【src/core/utils/stale-run-recovery.ts:468-502】

4. **Rebuilding live scheduler state**
   - `buildResumePlan()` reads the persisted task table.
   - Done tasks become terminal IDs; failed tasks are not treated as non-retryable terminals.
   - `mark-done-pending` tasks are checked with `isDone`; if necessary, `markDone` is called, then the tracker phase is durably changed to `done`.
   - The task table is reread after those writes.
   - Remaining nonterminal tasks become `replayQueue`; persisted iteration count and skipped IDs restore scheduler progress.【src/core/loop-run/resume-plan.ts:35-79】

5. **Sole authoritative ownership**
   - On successful resume preparation, `execute("resume")` calls `tracker.adoptOwnership()`, changing status to `running` and replacing the owner PID/heartbeat with the new process.【src/core/utils/stale-run-recovery.ts:287-303】【src/core/utils/loop-run-tracker.ts:150-159】
   - `ralphLoop` then constructs `LoopRun` with that tracker and calls `startOrResume`; an existing rollback snapshot is adopted, otherwise existing state is updated rather than creating a new run.【src/core/ralph-loop.ts:343-375】【src/core/loop-run/loop-run.ts:105-145】
   - The `LoopRun` contract explicitly makes it the sole writer while active; callers must not write directly to the tracker.【src/core/loop-run/loop-run.ts:44-52】
   - Tracker updates increment `revision` from the current value and atomically write before returning.【src/core/utils/loop-run-tracker.ts:126-140】
   - LoopRun events use write-then-emit ordering: for task phases, tracker writes complete before the event is emitted.【src/core/loop-run/loop-run.ts:275-300】
   - Subscribers are invoked synchronously, in registration order, after the durable write succeeds.【src/core/loop-run/loop-run.ts:75-101】

6. **Force-Kill Undo and Finish Rollback**
   - A partially completed Force-Kill Undo represents an interrupted destructive rollback, so it cannot be treated as an ordinary resumable stale run.
   - `finishRollback` requires explicit confirmation, an existing rollback snapshot, successful rollback, workspace cleanup, recording `rollback-completed`, and archiving the tracker as interrupted with reason `panic-undo`.【src/core/utils/stale-run-recovery.ts:224-285】

7. **Dirty-workspace safety check**
   - Merge recovery loops while `git.isDirty()` is true and requires the developer to commit, stash, or discard changes, or abandon.
   - In non-interactive mode it throws before resetting to `preMergeHead`, preventing primary-workspace edits from being overwritten.【src/core/utils/stale-run-recovery.ts:474-499】
   - This behavior is covered by the integration test for interrupted merge recovery with uncommitted primary-repository changes.【test/recovery-integration.test.ts:254-304】

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| Startup invokes stale recovery before creating the new LoopRun | `ralphLoop`, `handleStaleRun` | `src/core/ralph-loop.ts:310-319` |
| Active owner blocks startup | `handleStaleRun` | `src/core/utils/stale-run-recovery.ts:404-409` |
| Ordinary action availability depends on rollback snapshot | `getAvailableActions` | `src/core/utils/stale-run-recovery.ts:141-155` |
| Partial panic undo excludes ordinary resume/rollback | `isPartialPanicUndo`, `getAvailableActions` | `src/core/utils/stale-run-recovery.ts:128-155` |
| Crash normalization converts submitted steering records | `normalizeCrashRules`, `normalizeSteeringPostCrash` | `src/core/utils/stale-run-recovery.ts:157-166`; `src/core/loop-run/state.ts:112-123` |
| Mark-done-pending tasks are completed during planning | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:47-63` |
| Scheduler queue/progress are reconstructed from persisted state | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:65-79` |
| New process adopts tracker ownership | `execute`, `adoptOwnership` | `src/core/utils/stale-run-recovery.ts:287-303`; `src/core/utils/loop-run-tracker.ts:150-159` |
| Revisions are monotonic and writes are atomic | `update` | `src/core/utils/loop-run-tracker.ts:132-140` |
| Events follow durable writes and subscriber order | `recordTaskPhase`, `subscribe` | `src/core/loop-run/loop-run.ts:75-101`, `275-300` |
| Dirty merge recovery is blocked | `prepareMergingResume` | `src/core/utils/stale-run-recovery.ts:474-499` |

## 4. Tests and documentation

- `resume-plan.ts` documents the persisted-task-to-scheduler translation and references ADR-0006.【src/core/loop-run/resume-plan.ts:1-21】
- Integration coverage verifies dirty primary-workspace protection during merge recovery.【test/recovery-integration.test.ts:254-304】
- The same test suite covers clean interrupted-merge recovery and reset-to-`preMergeHead`.【test/recovery-integration.test.ts:310-330】

## 5. Uncertainties

- The exact presentation-layer wording for the recovery menu is abstracted behind `RecoveryPrompts`; the lifecycle and availability rules are directly visible in `StaleRun` and `handleStaleRun`.
- “Sole authoritative writer” is both an explicit `LoopRun` contract and the observed ownership flow; external callers could violate it only by disregarding that contract.
