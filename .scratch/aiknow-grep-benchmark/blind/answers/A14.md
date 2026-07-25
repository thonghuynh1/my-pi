## 1. Executive summary

On startup, `handleStaleRun` reads the active tracker, rejects a live owner, rejects non-interactive recovery, normalizes crashed steering records, and offers only actions valid for the persisted state. Normal stale runs may resume, rollback if a snapshot exists, abandon, or cancel. Partial Force-Kill Undo runs cannot resume; they may only finish rollback when processes were drained and a snapshot exists, or abandon/cancel.

A resumed run cleans unsafe phase boundaries, adopts the existing tracker ownership, creates a `LoopRun`, adopts the rollback snapshot, builds scheduler state from the persisted task table, and continues writing the same tracker with increasing revisions. Durable writes precede synchronous subscriber events.

## 2. Detailed flow / architecture / impact analysis

1. **Detection and action selection**
   - `LoopRunTracker.isStale()` considers a tracker stale when its owner process is dead or its heartbeat is older than 30 seconds. Active ownership is otherwise rejected. `src/core/utils/loop-run-tracker.ts:150-177`
   - Startup performs stale recovery before feature-branch setup, snapshot creation, or `LoopRun.startOrResume`. `src/core/ralph-loop.ts:314-345`
   - Non-TTY startup fails rather than selecting an implicit recovery action. `src/core/utils/stale-run-recovery.ts:404-420`
   - For an ordinary stale run:
     - `resume` is available.
     - `rollback` is available only when `rollbackSnapshotId` exists.
     - `abandon` and `cancel` are always available.
     - `finishRollback` is not offered. `src/core/utils/stale-run-recovery.ts:131-153`
   - For a partial panic undo, resume and ordinary rollback are suppressed. `finishRollback` is offered only when `panicUndo.phase === "processes-drained"` and a rollback snapshot exists; otherwise only abandon/cancel remain. `src/core/utils/stale-run-recovery.ts:116-153`

2. **Crash normalization**
   - `normalizeCrashRules()` checks whether any task has a live-steering record still marked `submitted`. If so, it calls `tracker.normalizeLiveSteeringPostCrash()` and refreshes its state. `src/core/utils/stale-run-recovery.ts:157-168`
   - The normalization converts only `submitted` records to `unknown-after-crash`; terminal records remain unchanged. `src/core/loop-run/state.ts:107-124`
   - It is called after stale detection and before the recovery choices are presented. `src/core/utils/stale-run-recovery.ts:423-440`

3. **Resume preparation and scheduler reconstruction**
   - Unsafe writer phases are reset at their recovery boundaries:
     - interrupted implementation worktrees are cleaned;
     - interrupted merge is aborted, the primary workspace is checked for dirtiness, then reset to `preMergeHead`;
     - verification, completion marking, and review are rerun. `src/core/utils/stale-run-recovery.ts:303-386`
   - A completed task is trusted only if its `integratedHead` remains an ancestor of `HEAD`; otherwise recovery asks whether to restart or trust it. `src/core/utils/stale-run-recovery.ts:332-368`
   - `buildResumePlan`:
     - puts done tasks into `terminalIds`;
     - retries each `mark-done-pending` task, first consulting optional `isDone`;
     - calls `markDone` when needed, then records `done`;
     - rereads the tracker;
     - converts all nonterminal, non-`mark-done-pending` tasks into `replayQueue`;
     - restores `iterationsStarted` and `skippedIds`. `src/core/loop-run/resume-plan.ts:27-78`
   - The scheduler consumes replayed tasks before fetching new issues and resumes iteration accounting from the persisted values. `src/core/ralph-loop.ts:386-387`, `src/core/ralph-loop.ts:695-744`

4. **Tracker ownership and event ordering**
   - After successful resume preparation, startup calls `tracker.adoptOwnership()`, replacing the owner PID/heartbeat while preserving the same logical run and incrementing the revision. `src/core/utils/stale-run-recovery.ts:286-303`; `src/core/utils/loop-run-tracker.ts:136-158`
   - The new `LoopRun` then calls `startOrResume`; an existing snapshot is adopted rather than creating a new one. `src/core/ralph-loop.ts:350-386`; `src/core/loop-run/loop-run.ts:103-152`
   - Tracker updates atomically write a temporary file, rename it into place, and increment `revision` from the current state. `src/core/utils/loop-run-tracker.ts:132-140`, `src/core/utils/loop-run-tracker.ts:677-696`
   - `LoopRun` methods perform the durable tracker write first, then synchronously emit facts to subscribers in registration order. `src/core/loop-run/loop-run.ts:76-80`, `src/core/loop-run/loop-run.ts:276-310`, `src/core/loop-run/loop-run.ts:607-610`
   - Thus the resumed `LoopRun` becomes the sole authoritative writer; observers only consume already-durable facts. `src/core/loop-run/events.ts:1-9`

5. **Partial Force-Kill Undo**
   - A persisted `panicUndo` phase other than `rollback-completed` is classified as partial, so it is not treated as ordinary stale work. `src/core/utils/stale-run-recovery.ts:35-40`, `src/core/utils/stale-run-recovery.ts:116-126`
   - Finish Rollback requires explicit confirmation, a recorded snapshot, and the exact `processes-drained` phase. It adopts the snapshot, retries rollback, records `rollback-failed` on failure, or records `rollback-completed` and archives the run as interrupted on success. `src/core/utils/stale-run-recovery.ts:224-285`
   - The implementation currently performs these Finish Rollback tracker writes directly during startup. ADR-0007 states that this path should first adopt the stale run into `LoopRun` so panic-undo writes remain coordinator-owned. `docs/adr/0007-loop-run-coordinator-and-fact-events.md:33-36`

6. **Dirty merge safety check**
   - For `merge-pending`/`merging`, recovery aborts any merge, then repeatedly checks `git.isDirty()`. Dirty primary-workspace state blocks recovery because resetting to `preMergeHead` could overwrite manual edits. `src/core/utils/stale-run-recovery.ts:466-495`
   - Interactive recovery offers retry after manual cleanup or abandon; non-interactive recovery throws. `src/core/utils/stale-run-recovery.ts:478-498`

## 3. Evidence table

| Claim | Symbol | File:line |
|---|---|---|
| Stale ownership uses PID and heartbeat | `LoopRunTracker.isStale` | `src/core/utils/loop-run-tracker.ts:150-177` |
| Recovery is before new run setup | `handleStaleRun` call | `src/core/ralph-loop.ts:314-345` |
| Available actions depend on panic-undo and snapshot state | `StaleRun.getAvailableActions` | `src/core/utils/stale-run-recovery.ts:116-153` |
| Submitted steering becomes unknown after crash | `normalizeSteeringPostCrash` | `src/core/loop-run/state.ts:107-124` |
| Normalization runs before prompting | `handleStaleRun` | `src/core/utils/stale-run-recovery.ts:423-440` |
| Mark-done-pending is retried and persisted as done | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:40-69` |
| Replay and scheduler progress are restored | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:68-78` |
| Resumed tasks precede newly fetched tasks | scheduler loop | `src/core/ralph-loop.ts:739-744` |
| Resume adopts existing owner | `StaleRun.execute` / `adoptOwnership` | `src/core/utils/stale-run-recovery.ts:286-303` |
| Revisions increase with atomic writes | `LoopRunTracker.update` / `atomicWrite` | `src/core/utils/loop-run-tracker.ts:132-140`, `677-696` |
| Writes precede ordered subscriber events | `LoopRun.recordTaskPhase` / `emit` | `src/core/loop-run/loop-run.ts:276-310`, `607-610` |
| Finish Rollback requires drained processes and snapshot | `canFinishRollback` | `src/core/utils/stale-run-recovery.ts:131-139` |
| Dirty merge recovery is blocked | `prepareMergingResume` | `src/core/utils/stale-run-recovery.ts:466-498` |

## 4. Tests and documentation

- Recovery action gating, partial panic-undo behavior, and Finish Rollback are covered by `test/stale-run-recovery.test.ts:1272-1372`.
- Dirty merge recovery is covered by `test/recovery-integration.test.ts:258-308`.
- Mark-done-pending behavior, `isDone`, and persisted task-body propagation are covered by `test/resume-plan.test.ts:16-105`.
- Atomic revision behavior is covered by `test/loop-run-tracker.test.ts:436-458`.
- Write-before-emit and subscriber ordering are covered by `test/loop-run.test.ts:42-88`.
- Design requirements are specified in ADR-0006, especially stale actions, safe/unsafe resume, dirty-merge protection, ownership, atomic revision, and completion recovery: `docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:27-47`.
- ADR-0007 defines sole-writer, write-then-emit semantics and the intended LoopRun ownership for partial panic undo: `docs/adr/0007-loop-run-coordinator-and-fact-events.md:16-36`.

## 5. Uncertainties

- The code and ADR disagree on Finish Rollback ownership: ADR-0007 requires adoption into `LoopRun` before panic-undo writes, while `stale-run-recovery.ts` directly calls tracker methods.
- `handleStaleRun` itself does not create the `LoopRun`; ownership becomes coordinator-owned only after `ralphLoop` constructs it and calls `startOrResume`.
- Rollback availability is based on a recorded snapshot ID; snapshot existence/health is validated later by workspace operations.
