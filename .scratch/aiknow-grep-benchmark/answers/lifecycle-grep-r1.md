## 1. Executive summary

Startup reads `.ralph-loop/runs/active.json` and checks owner PID/heartbeat. A dead or expired owner makes the tracker stale; a live owner aborts startup. Recovery occurs before creating a new snapshot or lock.

For an ordinary stale run, startup normalizes submitted live-steering records, offers available recovery actions, prepares safe/unsafe phase recovery, then adopts the existing tracker with the new PID. The resumed `LoopRun` continues using the same logical tracker and revision sequence.

A partial Force-Kill Undo is handled separately: normal resume is blocked. Finish Rollback is offered only after durable process-drain evidence and a rollback snapshot are present.

## 2. Detailed flow / architecture / impact analysis

1. **Detection and action selection**
   - `handleStaleRun()` reads the tracker, rejects an active owner, and fails fast without a TTY rather than selecting a default action (`src/core/utils/stale-run-recovery.ts:396-420`).
   - For an ordinary stale run, actions are:
     - `resume`: always available.
     - `rollback`: available only when `rollbackSnapshotId` exists.
     - `abandon`: archives the tracker and starts fresh.
     - `cancel`: aborts startup without changing state.
     - `src/core/utils/stale-run-recovery.ts:141-159`
   - If `panicUndo` exists in any phase other than `rollback-completed`, the run is treated as a partial Force-Kill Undo. Resume and ordinary rollback are suppressed; only `abandon`/`cancel` are available, plus `finishRollback` when the phase is `processes-drained` and a snapshot exists (`src/core/utils/stale-run-recovery.ts:128-147`).
   - Missing snapshots disable loop-start rollback but do not disable tracker-based resume (`docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:11-18`).

2. **Crash normalization**
   - `normalizeCrashRules()` checks whether any task contains a live-steering record still marked `submitted`. If none do, it does nothing.
   - Otherwise it calls `tracker.normalizeLiveSteeringPostCrash()`, converting submitted records to `unknown-after-crash`, then reloads state (`src/core/utils/stale-run-recovery.ts:161-172`).
   - `handleStaleRun()` invokes this after stale detection and before computing the action list (`src/core/utils/stale-run-recovery.ts:423-431`).
   - The conversion is defined as a pure state rule: submitted records become `unknown-after-crash`; terminal records remain unchanged (`src/core/loop-run/state.ts:101-111`).

3. **Preparing a resumed run**
   - `prepareResume()` applies phase-specific recovery (`src/core/utils/stale-run-recovery.ts:306-366`):
     - `implementing`: discard the task worktree so implementation restarts cleanly.
     - `merge-pending`/`merging`: abort an in-progress merge, require a clean primary workspace, reset to `preMergeHead`, then remove the task worktree.
     - `verify-pending`/`verifying`: leave the task for verification rerun.
     - `mark-done-pending`: leave it for completion retry.
     - `done`: verify `integratedHead` remains reachable from `HEAD`; otherwise ask whether to restart or trust the tracker.
     - interrupted/failed/blocked whole-run review is rerun.
   - After preparation succeeds, `execute("resume")` calls `tracker.adoptOwnership()` (`src/core/utils/stale-run-recovery.ts:287-303`).

4. **Translating persisted tasks into scheduler state**
   - `buildResumePlan()` reads the persisted task table from `loopRun.snapshot()` (`src/core/loop-run/resume-plan.ts:27-38`).
   - `done` tasks populate `terminalIds`; failed tasks are terminal for replay filtering but are not included in the successful-terminal set (`src/core/loop-run/resume-plan.ts:37-39`, `src/core/loop-run/resume-plan.ts:72-78`).
   - `mark-done-pending` tasks are reconciled through `issueSource.isDone()`. If not already complete, `markDone()` receives the persisted issue ID, title, and body. The task is then durably changed to `done` and added to `terminalIds` (`src/core/loop-run/resume-plan.ts:41-57`).
   - The function rereads state after those writes, places all remaining nonterminal/non-`mark-done-pending` tasks into `replayQueue`, and restores `iterationsStarted` and `skippedIds` (`src/core/loop-run/resume-plan.ts:59-68`).
   - `ralphLoop` invokes this after `startOrResume()` and uses the resulting queue and scheduler progress (`src/core/ralph-loop.ts:360-387`).

5. **Sole tracker ownership and event ordering**
   - `adoptOwnership()` updates the existing state to `running`, replaces the owner PID, refreshes the heartbeat, increments revision through `update()`, and atomically writes the result (`src/core/utils/loop-run-tracker.ts:126-160`).
   - Every tracker update increments `revision` from the current state and writes via temporary-file replacement (`src/core/utils/loop-run-tracker.ts:126-139`, `src/core/utils/loop-run-tracker.ts:312-330`). Thus the resumed process continues the existing monotonic revision sequence rather than creating a second run.
   - `LoopRun` is the domain coordinator and the tracker is its persistence adapter; normal phase/meta updates write first and emit only after persistence succeeds (`src/core/loop-run/loop-run.ts:199-236`, `src/core/loop-run/loop-run.ts:286-315`).
   - Subscribers are invoked synchronously in registration order (`src/core/loop-run/loop-run.ts:620-625`). This ensures observers see events only after the authoritative tracker state exists.
   - `ralphLoop` performs stale recovery before constructing the active `LoopRun` and before starting a new snapshot/lock (`src/core/ralph-loop.ts:310-360`; `docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:17-19`).

6. **Partial Force-Kill Undo**
   - A partial undo is not an ordinary stale run because rollback may have been preceded by process termination but not completed. Continuing workflow work could race with unresolved destructive recovery (`src/core/utils/stale-run-recovery.ts:35-39`).
   - `finishRollback` requires explicit confirmation, a `processes-drained` tracker phase, and a rollback snapshot (`src/core/utils/stale-run-recovery.ts:134-138`, `224-282`).
   - Successful completion cleans workspaces, records `rollback-completed`, and archives the run as `interrupted`; failure records `rollback-failed` and keeps the tracker recoverable (`src/core/utils/stale-run-recovery.ts:241-280`).
   - The ADR explicitly requires durable writer-drained evidence; a stale PID alone is insufficient (`docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:27-32`).

7. **Merge safety**
   - Before resetting to `preMergeHead`, merge recovery repeatedly checks `git.isDirty()`.
   - If the primary workspace has uncommitted edits, recovery pauses and asks the developer to clean it and retry or abandon. Noninteractive mode throws instead of resetting (`src/core/utils/stale-run-recovery.ts:474-495`).
   - This prevents recovery from overwriting manual edits, matching the ADR’s explicit merge-recovery safety rule (`docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:15`, `Consequences`).

## 3. Evidence table with columns Claim | Symbol | File:line

| Claim | Symbol | File:line |
|---|---|---|
| Owner PID/heartbeat determine stale status | `isStale` | `src/core/utils/loop-run-tracker.ts:162-178` |
| Non-TTY recovery fails fast | `handleStaleRun` | `src/core/utils/stale-run-recovery.ts:410-420` |
| Normal action availability depends on snapshot | `getAvailableActions` | `src/core/utils/stale-run-recovery.ts:141-159` |
| Partial undo suppresses normal resume | `isPartialPanicUndo` | `src/core/utils/stale-run-recovery.ts:128-138` |
| Crash normalization changes submitted steering records | `normalizeCrashRules` | `src/core/utils/stale-run-recovery.ts:161-172` |
| Normalization runs before prompting | `handleStaleRun` | `src/core/utils/stale-run-recovery.ts:423-431` |
| Mark-done-pending tasks are reconciled and completed | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:41-57` |
| Scheduler queue/progress are rebuilt from persisted state | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:59-68` |
| Resume adopts the existing tracker owner | `execute` | `src/core/utils/stale-run-recovery.ts:287-303` |
| Ownership update is revisioned and atomic | `adoptOwnership`, `update` | `src/core/utils/loop-run-tracker.ts:126-160` |
| Events follow durable writes | `recordTaskPhase` | `src/core/loop-run/loop-run.ts:286-315` |
| Merge recovery blocks dirty primary workspaces | `prepareMergingResume` | `src/core/utils/stale-run-recovery.ts:474-495` |

## 4. Tests and documentation

- Recovery action availability and partial-undo restrictions: `test/stale-run-recovery.test.ts:77-110`, `test/stale-run-recovery.test.ts:1220-1335`.
- `mark-done-pending` body propagation, idempotent completion, and durable phase update: `test/resume-plan.test.ts:13-98`.
- Atomic revision increments: `test/loop-run-tracker.test.ts:436-458`.
- Write-before-emit and subscriber ordering: `test/loop-run.test.ts:42-88`.
- Primary design contract: `docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:1-32`.

## 5. Uncertainties

- The exact scheduler dispatch after `buildResumePlan()` is outside the cited recovery code; the plan’s queue and progress outputs are directly evidenced, while their subsequent scheduling behavior is inferred from `ralphLoop` integration.
- “Sole authoritative writer” is an architectural contract enforced by `LoopRun` usage and ownership adoption; the tracker class itself remains callable by other code, so exclusivity depends on the recovered process being the only active owner.
