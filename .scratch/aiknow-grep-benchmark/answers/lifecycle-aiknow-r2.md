## 1. Executive summary

On startup, `ralphLoop` calls stale-run handling before creating/resuming `LoopRun` (`src/core/ralph-loop.ts:310-329`). A tracker is stale when its owner is dead or its heartbeat exceeds 30 seconds (`src/core/utils/loop-run-tracker.ts:161-178`).

Recovery then:

1. Rejects active runs and non-interactive stale runs without an injected decision provider (`src/core/utils/stale-run-recovery.ts:404-420`).
2. Normalizes crash-affected steering records.
3. Offers only actions valid for the persisted state.
4. For resume, prepares task/workspace state, adopts tracker ownership, constructs the runtime `LoopRun`, and rebuilds scheduler state.
5. `LoopRun` becomes the sole authoritative writer: durable tracker writes precede emitted events.

## 2. Detailed flow / architecture / impact analysis

### Recovery action selection

`StaleRun.getAvailableActions()` provides:

- **Partial Force-Kill Undo:** `abandon` and `cancel`; `finishRollback` is added only when panic undo is at `processes-drained` and a rollback snapshot exists (`src/core/utils/stale-run-recovery.ts:128-155`).
- **Ordinary stale run:** always `resume`, `abandon`, and `cancel`; `rollback` is available only when `rollbackSnapshotId` exists (`src/core/utils/stale-run-recovery.ts:141-155`).
- **Cancel:** aborts startup without changing the tracker (`src/core/utils/stale-run-recovery.ts:180-183`).
- **Abandon:** archives the stale tracker as completed and starts a new run (`src/core/utils/stale-run-recovery.ts:184-187`).
- **Rollback:** adopts the persisted snapshot, rolls it back, archives the tracker, cleans workspaces, and starts fresh; it is rejected if no snapshot exists or rollback fails (`src/core/utils/stale-run-recovery.ts:189-221`).
- **Finish Rollback:** requires confirmation, a snapshot, successful rollback, cleanup, then archives the run as interrupted with `panic-undo` as the terminal reason (`src/core/utils/stale-run-recovery.ts:224-284`).

The choice is prompted only after `normalizeCrashRules()`, and an invalid choice is rejected (`src/core/utils/stale-run-recovery.ts:423-440`).

### Crash-rule normalization

`normalizeCrashRules()` checks whether any task contains a submitted live-steering record. If so, it calls `tracker.normalizeLiveSteeringPostCrash()` and refreshes in-memory state (`src/core/utils/stale-run-recovery.ts:157-166`).

The underlying rule converts `submitted` records to `unknown-after-crash`, leaving terminal records unchanged (`src/core/loop-run/state.ts:112-123`).

### Resume preparation and scheduler reconstruction

Before ownership adoption, resume preparation handles each persisted task:

- `implementing`: removes its old worktree.
- `merge-pending` / `merging`: aborts an in-progress merge, requires a clean primary workspace, resets to `preMergeHead`, and removes the worktree.
- Verification phases are rerun.
- `mark-done-pending` completion marking is retried.
- Done tasks whose integrated commit is unreachable require restart/trust input (`src/core/utils/stale-run-recovery.ts:307-377`).

The primary-workspace safety check is explicit: dirty changes block merge recovery because reset could overwrite developer edits. Interactive mode permits retry or abandon; non-interactive mode throws (`src/core/utils/stale-run-recovery.ts:468-502`).

`buildResumePlan()` reads the durable task table, places done tasks in `terminalIds`, processes `mark-done-pending` tasks by checking `isDone`, calling `markDone` when necessary, and durably recording `done` (`src/core/loop-run/resume-plan.ts:35-63`). It then rereads the tracker and produces:

- `replayQueue` for non-terminal tasks;
- `terminalIds` for completed tasks;
- persisted iteration count;
- persisted skipped-ID set (`src/core/loop-run/resume-plan.ts:65-79`).

`ralphLoop` invokes this plan after `LoopRun.startOrResume()` (`src/core/ralph-loop.ts:343-387`).

### Tracker ownership and event ordering

After successful resume preparation, `StaleRun.execute("resume")` calls `tracker.adoptOwnership()` (`src/core/utils/stale-run-recovery.ts:287-303`). Adoption changes status to `running`, records the new process PID, and refreshes the heartbeat (`src/core/utils/loop-run-tracker.ts:150-159`).

`LoopRun` is documented as the sole authoritative writer; the tracker provides atomic, crash-safe, monotonic-revision JSON persistence (`src/core/utils/loop-run-tracker.ts:2-10`). Every `update()` rereads the current state, increments `revision`, then atomically writes it (`src/core/utils/loop-run-tracker.ts:126-140`). The atomic write uses a temporary file followed by rename (`src/core/utils/loop-run-tracker.ts:371-385`).

For phase transitions, the tracker write completes before the event is emitted; failed writes emit no event (`src/core/loop-run/loop-run.ts:275-300`). Subscribers run synchronously in registration order after the durable write (`src/core/loop-run/loop-run.ts:75-101`), and event dispatch iterates that subscriber list in order (`src/core/loop-run/loop-run.ts:607-610`).

## 3. Evidence table

| Claim | Symbol | File:line |
|---|---|---|
| Startup performs stale recovery before run creation | `ralphLoop` | `src/core/ralph-loop.ts:310-329` |
| Staleness is based on owner liveness or heartbeat age | `isStale` | `src/core/utils/loop-run-tracker.ts:161-178` |
| Ordinary and panic-undo action availability | `getAvailableActions` | `src/core/utils/stale-run-recovery.ts:128-155` |
| Crash normalization is conditional on submitted steering | `normalizeCrashRules` | `src/core/utils/stale-run-recovery.ts:157-166` |
| Submitted steering becomes unknown after crash | `normalizeSteeringPostCrash` | `src/core/loop-run/state.ts:112-123` |
| Resume preparation handles task phases | `prepareResume` | `src/core/utils/stale-run-recovery.ts:307-377` |
| Dirty primary workspace blocks merge recovery | `prepareMergingResume` | `src/core/utils/stale-run-recovery.ts:468-502` |
| Mark-done-pending tasks are completed during planning | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:47-63` |
| Scheduler replay and progress are reconstructed | `buildResumePlan` | `src/core/loop-run/resume-plan.ts:65-79` |
| New process adopts tracker ownership | `adoptOwnership` | `src/core/utils/loop-run-tracker.ts:150-159` |
| Revisions monotonically increase before atomic persistence | `update` | `src/core/utils/loop-run-tracker.ts:132-140` |
| Events follow successful writes | `recordTaskPhase` | `src/core/loop-run/loop-run.ts:275-300` |
| Subscribers preserve registration order | `subscribe`, `emit` | `src/core/loop-run/loop-run.ts:75-101, 607-610` |
| Partial panic undo is distinct from ordinary stale recovery | `isPartialPanicUndo`, `canFinishRollback` | `src/core/utils/stale-run-recovery.ts:128-139` |
| Finish Rollback requires confirmation and successful rollback | `execute` | `src/core/utils/stale-run-recovery.ts:224-284` |

## 4. Tests and documentation

The resume plan documents its scheduler translation and references ADR-0006 (`src/core/loop-run/resume-plan.ts:1-22`).

The integration suite explicitly tests that merge recovery is blocked by uncommitted primary-repository changes and configures the dirty condition (`test/recovery-integration.test.ts:254-281`).

## 5. Uncertainties

- The cited source establishes the tracker/write/event contract, but the complete test coverage for every recovery action was not inspected.
- “Sole authoritative writer” is directly documented for `LoopRun` and implemented through its tracker updates; the broader process-level guarantee depends on no other process continuing to write after stale ownership is detected.
