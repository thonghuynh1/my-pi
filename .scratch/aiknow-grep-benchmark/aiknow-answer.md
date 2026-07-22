## (1) Executive summary

The supported CLI (`run/issues.ts`) and public `ralphLoop()` API feed a continuous scheduler that always configures tasks with required isolated worktrees in the current implementation—even when `maxParallel === 1`. Each issue gets a sibling-directory worktree on `ralph/<issue-id>`, runs implementation and verification subprocesses there, then serializes integration through a merge mutex. Task phase, branch, worktree, attempt, merge, scheduler, and usage data are durably persisted and projected to the TUI.

Successful or failed tasks dispose their local worktree in `finally`; successful remote task branches are intended to be deleted, while qualifying near-misses may remain remotely for reuse. Panic undo drains subprocesses, rolls back the loop-start snapshot, and calls aggregate cleanup. Crashed runs use recorded worktree metadata for stale-run recovery.

## (2) Numbered end-to-end flow

1. **Entry and configuration.** `npm run dev` launches `run/issues.ts`; users may use the startup wizard or direct arguments. Both paths validate the repository/feature folder and call `ralphLoop()` with the selected client, models, and `maxParallel` (`package.json:16-23`, `run/issues.ts:85-103`, `run/issues.ts:194-227`, `run/issues.ts:230-301`). Programmatic callers use exported `ralphLoop()` or the lower-level `runTaskInSandbox()` (`package.json:6-14`, `src/core/utils/executor.ts:45-79`).

2. **Run initialization and recovery.** `ralphLoop()` creates `ShellGitClient`, `WorkspaceManager`, `LoopRunTracker`, and `LoopRun`; before scheduling, it detects active/stale runs, resolves recovery, captures or adopts a rollback snapshot, creates the workspace lock, starts the UI, and starts a 10-second heartbeat (`src/core/ralph-loop.ts:224-265`, `src/core/ralph-loop.ts:310-384`, `src/core/loop-run/loop-run.ts:104-153`).

3. **Scheduling.** A continuous scheduler fills slots up to `maxParallel`, claims issue IDs, persists `iterationsStarted`, starts workers, and waits for the first completion before refilling. A shared `MergeMutex` serializes integrations (`src/core/ralph-loop.ts:683-718`, `src/core/ralph-loop.ts:722-785`).

4. **Worktree creation.** The main pipeline sets `isolate: true` and `requireSandbox: true`. `TaskPipeline.run()` computes a base commit—using the live pinned-feature-branch tip when applicable—and calls `createSandbox()` before recording `worktreePath`, `branchName`, and `baseCommit` (`src/core/ralph-loop.ts:706-718`, `src/core/utils/task-pipeline.ts:466-490`). `WorkspaceManager` sanitizes the task ID, creates `ralph/<id>` under sibling root `.ralph-wt-<repo>`, pre-cleans stale state, optionally reuses `origin/ralph/<id>`, and retries `git worktree add` four times. Required creation failure aborts rather than running in place (`src/core/utils/workspace.ts:119-187`, `src/core/utils/workspace.ts:305-307`, `src/core/utils/git-client.ts:155-168`).

5. **Execution and progress.** The agent client receives the worktree as `cwd`; `ControlledRunner` spawns the selected CLI there, streams text/tool/usage events, and registers its process handle for termination (`src/core/utils/task-pipeline.ts:155-163`, `src/core/utils/task-pipeline.ts:212-257`, `src/core/runs/clients/base-client.ts:91-107`, `src/core/runs/controlled-runner.ts:89-160`). The pipeline persists `implementing`, verification, failure, and attempt data; verification retries execute in the same worktree (`src/core/utils/task-pipeline.ts:177-212`, `src/core/utils/task-pipeline.ts:277-343`, `src/core/utils/task-pipeline.ts:370-410`).

6. **Status presentation and durability.** `LoopRun` writes phase/meta/scheduler state before emitting events. The tracker stores task phase, worktree/branch/base/merge handles, scheduler progress, run status, owner PID, and heartbeat under `.ralph-loop/runs/active.json`; the presentation forwards events to the Ink dashboard and sinks (`src/core/loop-run/state.ts:15-30`, `src/core/loop-run/state.ts:50-62`, `src/core/loop-run/state.ts:154-180`, `src/core/loop-run/loop-run.ts:275-310`, `src/core/loop-run/loop-run.ts:446-468`, `src/core/utils/loop-run-tracker.ts:31-36`, `src/core/utils/loop-run-tracker.ts:84-148`, `src/core/ralph-loop.ts:350-358`). Ink projects task phase/meta and usage into worker rows and logs (`src/core/loop-run/ink-state.ts:161-199`).

7. **Integration and remote handling.** After successful verification, the task branch is pushed, merge metadata/phases are recorded, and integration runs under `MergeMutex`. A pinned target branch is merged in its owning worktree when available; otherwise normal integration uses the primary repository. Conflicts invoke the merger agent (`src/core/utils/task-pipeline.ts:500-590`, `src/core/utils/workspace.ts:189-215`). Successful merges record `integratedHead` and attempt remote-branch deletion; failed near-misses with over half their criteria met may preserve the remote branch for a later run (`src/core/utils/task-pipeline.ts:597-640`).

8. **Normal cleanup and completion.** `TaskPipeline.run()` always calls `sandbox.dispose()` in `finally`. Disposal retries worktree removal, prunes Git metadata, deletes the local branch, falls back to recursive filesystem deletion, and warns about residue. Successful tasks are then marked done in the issue source (`src/core/utils/task-pipeline.ts:642-651`, `src/core/utils/workspace.ts:218-303`, `src/core/ralph-loop.ts:518-548`). End-of-run releases the snapshot/lock and archives the durable tracker; normal shutdown relies on per-task disposal rather than a final `cleanupAll()` (`src/core/ralph-loop.ts:880-909`, `src/core/loop-run/loop-run.ts:262-273`, `src/core/loop-run/loop-run.ts:552-570`).

9. **Termination, undo, and crash recovery.** Panic actions target registered subprocesses; full undo waits for process-tree termination, rolls back the loop-start snapshot, calls `cleanupAll()`, and restores issue statuses where supported (`src/core/utils/process-registry.ts:30-110`, `src/core/ralph-loop.ts:635-680`, `src/core/ralph-loop.ts:841-850`). First Ctrl+C requests a drain and lets scheduler/finally cleanup run; a second exits immediately (`src/core/ralph-loop.ts:448-468`). On restart, stale-run recovery can resume, roll back, finish partial undo, abandon, or cancel; interrupted implementation/merge worktrees are deleted using their recorded paths and branches before replay (`src/core/utils/stale-run-recovery.ts:141-303`, `src/core/utils/stale-run-recovery.ts:307-377`, `src/core/utils/stale-run-recovery.ts:392-440`, `src/core/utils/stale-run-recovery.ts:461-502`).

## (3) Evidence table with claim | symbol | file:line

| claim | symbol | file:line |
|---|---|---|
| Supported CLI enters through interactive or non-interactive launcher paths | `main`, `runInteractive`, `runNonInteractive` | `run/issues.ts:85-103`, `run/issues.ts:105-227`, `run/issues.ts:230-301` |
| `ralphLoop` constructs Git, workspace, tracker, and process coordination | `ralphLoop` | `src/core/ralph-loop.ts:224-265` |
| Main pipeline always requires isolated worktrees | `new TaskPipeline` | `src/core/ralph-loop.ts:706-718` |
| Scheduler continuously fills up to `maxParallel` | scheduler loop | `src/core/ralph-loop.ts:683-785` |
| Each task records explicit recovery handles before execution | `TaskPipeline.run` | `src/core/utils/task-pipeline.ts:478-493` |
| Worktrees use sibling root and `ralph/<safe-id>` branches | `WorkspaceManager.createSandbox`, `worktreeRoot` | `src/core/utils/workspace.ts:119-140`, `src/core/utils/workspace.ts:305-307` |
| Creation pre-cleans, reuses remote near-misses, and retries | `createSandbox` | `src/core/utils/workspace.ts:142-187` |
| Git creation is `worktree add -b branch path ref` | `ShellGitClient.worktreeAdd` | `src/core/utils/git-client.ts:155-160` |
| Agent subprocesses execute with the task worktree as `cwd` | `BaseShellAgentClient.execute`, `ControlledRunner.run` | `src/core/runs/clients/base-client.ts:91-107`, `src/core/runs/controlled-runner.ts:89-116` |
| Task phases and scheduler progress are persisted before events | `recordTaskPhase`, `recordSchedulerProgress` | `src/core/loop-run/loop-run.ts:275-310`, `src/core/loop-run/loop-run.ts:446-468` |
| Tracker stores worktree, branch, phase, scheduler, owner, and run status | `TaskRecord`, `RunSnapshot` | `src/core/loop-run/state.ts:154-180`, `src/core/loop-run/state.ts:280-300` |
| Merge execution is serialized | `MergeMutex.runExclusive` | `src/core/utils/workspace.ts:64-77`, `src/core/utils/task-pipeline.ts:589-593` |
| Every task attempts local disposal in `finally` | `TaskPipeline.run` | `src/core/utils/task-pipeline.ts:642-651` |
| Disposal removes Git metadata, branch, and filesystem path | `disposeWorktree`, `cleanupWorktree`, `cleanupAll` | `src/core/utils/workspace.ts:218-303` |
| Panic undo drains processes before rollback and aggregate cleanup | `finalizeUndo`, `requestPanicUndo` | `src/core/ralph-loop.ts:635-680`, `src/core/loop-run/loop-run.ts:199-259` |
| Stale recovery deletes recorded implementing/merging worktrees | `prepareImplementingResume`, `prepareMergingResume` | `src/core/utils/stale-run-recovery.ts:461-502` |
| Finished trackers are archived with bounded retention | `markStatusAndArchive`, `pruneArchive` | `src/core/utils/loop-run-tracker.ts:207-270` |

## (4) Tests/docs

**Tests—not executed:**

- `test/workspace.test.ts:58-85`, `test/workspace.test.ts:213-300` — direct versus isolated sandboxes, required creation, base commits, disposal retries, and warnings.
- `test/worktree-cleanup.test.ts:45-142`, `test/worktree-cleanup.test.ts:144-196` — real Git worktree/branch cleanup, multiple sandboxes, idempotence, and failures.
- `test/executor.test.ts:284-389`, `test/executor.test.ts:392-620` — sandbox create/execute/merge/dispose and task-phase recording.
- `test/stale-run-recovery.test.ts:506-609`, `test/stale-run-recovery.test.ts:1064-1138` — interrupted implementation/merge cleanup and merge reset.
- `test/loop-run.test.ts:107-139`, `test/loop-run.test.ts:192-272` — durable scheduler events, run finish, panic drain, and timeout state.
- `test/process-registry.test.ts:21-100` — process registration, termination, timeout, and Windows handling.
- `test/controlled-runner-deregister.test.ts:53-74` — subprocess handle deregistration on close.

**Docs:**

- `README.md:15-27`, `README.md:39-55`, `README.md:63-85` — CLI/API usage and high-level execute/verify/merge flow.
- `CONTEXT.md:56-67` — Loop Run ownership and event model.
- `CONTEXT.md:78-115` — durable tracker, recovery handles, and Task Worktree contract.
- `CONTEXT.md:120-133` — force-kill undo, merge mutex, and continuous scheduler.
- `CONTEXT.md:190-204` — live status and worktree-backed context handoff.

## (5) Uncertainties

- `README.md:52` says per-issue worktrees apply when `maxParallel > 1`, but current code sets `isolate: true` and `requireSandbox: true` unconditionally (`src/core/ralph-loop.ts:706-718`). The README appears stale or the implementation is broader than documented.
- The first Ctrl+C sets `terminalReason = "ctrl-c"` but does not visibly change `stoppedReason` to `"interrupted"` before outcome classification (`src/core/ralph-loop.ts:841-856`). This may archive a Ctrl+C run with an unexpected completion status; no focused Ctrl+C end-to-end test was found.
- A second Ctrl+C calls `process.exit(130)` directly, so per-task disposal and final tracker/snapshot cleanup are intentionally bypassed (`src/core/ralph-loop.ts:448-468`); recovery then depends on stale-run metadata.
- `pushDelete()` uses a silent Git wrapper that does not throw (`src/core/utils/git-client.ts:76-88`, `src/core/utils/git-client.ts:220-222`), so the surrounding warning path may not detect remote-branch deletion failure.
- aiKnow repeatedly reported 1,772 stale indexed files even after synchronization. Findings reflect the indexed source returned by aiKnow; no tests were run, as requested.