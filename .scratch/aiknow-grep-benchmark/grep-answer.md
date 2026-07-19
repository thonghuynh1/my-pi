## (1) Executive summary

The supported entry points are the `run/issues.ts` launcher and exported `ralphLoop()` API. Both converge on `ralphLoop`, which schedules issues through `TaskPipeline`. The current implementation creates a required isolated Git worktree for **every task, including sequential runs**, despite older README/type comments describing isolation as parallel-only or opt-in (`src/core/ralph-loop.ts:707-719`).

`WorkspaceManager` creates sibling worktrees under `.ralph-wt-<repo>/<task-id>` on branches named `ralph/<task-id>`. Implementation and verification execute in that worktree. Verified branches are integrated under a merge mutex, with an agent handling conflicts. Task phases, worktree recovery handles, attempts, scheduler progress, and integration heads are persisted atomically in `.ralph-loop/runs/active.json` and projected to UI/log subscribers.

Each task disposes its worktree in `finally`. Panic undo first drains writers, rolls the repository back, then calls aggregate worktree cleanup. Crashed runs use persisted phase/worktree metadata to discard interrupted writer state and recreate work safely.

## (2) Numbered end-to-end flow

1. **Entry and configuration.** `npm run dev` invokes `run/issues.ts`; direct usage accepts repository and feature-folder arguments. TTY startup uses the wizard, while non-TTY startup uses arguments/environment and fixes `maxParallel` at 5 (`package.json:13-16`, `run/issues.ts:8-15`, `run/issues.ts:93-109`, `run/issues.ts:238-298`). The package also exports `ralphLoop()` directly (`package.json:7-10`).

2. **Repository/branch preparation.** The launcher validates repository and issue paths, checks tracked dirty files, resolves an optional feature branch, then passes configuration to `ralphLoop` (`run/issues.ts:145-183`, `run/issues.ts:209-228`).

3. **Recovery and run initialization.** Before scheduling, `ralphLoop` checks `.ralph-loop/runs/active.json` for an active or stale run. It then captures or adopts the loop-start rollback snapshot and starts a 10-second tracker heartbeat (`src/core/ralph-loop.ts:310-327`, `src/core/ralph-loop.ts:350-381`).

4. **Scheduling.** A continuous scheduler claims issues, prevents duplicate IDs, and maintains up to `maxParallel` workers. Iteration counts and skipped IDs are persisted as scheduler progress (`src/core/ralph-loop.ts:689-779`).

5. **Worktree creation.** For each issue, `TaskPipeline.run` chooses the current integration tip as its base and calls `WorkspaceManager.createSandbox` with `isolate: true` and `required: true` (`src/core/utils/task-pipeline.ts:466-482`, `src/core/ralph-loop.ts:707-719`). The manager:
   - sanitizes the task ID;
   - chooses branch `ralph/<id>` and sibling path `.ralph-wt-<repo>/<id>`;
   - pre-cleans stale path/branch state;
   - optionally reuses `origin/ralph/<id>`;
   - retries `git worktree add -b` four times;
   - throws rather than running in-place when creation fails (`src/core/utils/workspace.ts:119-187`).

6. **Recovery handles and execution.** Immediately after creation—and before agent execution—the pipeline persists `worktreePath`, `branchName`, and `baseCommit` (`src/core/utils/task-pipeline.ts:484-491`). It then sends the implementation prompt with `cwd` set to the sandbox. Claude/Pi spawn there; OpenCode retains its configuration launch directory but receives the sandbox through `--dir` (`src/core/utils/task-pipeline.ts:155-162`, `src/core/utils/task-pipeline.ts:229-265`, `src/core/runs/clients/base-client.ts:92-105`, `src/core/runs/clients/opencode-client.ts:86-130`).

7. **Implementation and verification progress.** Attempts transition through `implementing`, `verify-pending`, and `verifying`. Verification also runs against the worktree; failures feed criterion-specific feedback into another implementation attempt. Exhaustion records `failed` (`src/core/utils/task-pipeline.ts:212-218`, `src/core/utils/task-pipeline.ts:301-409`).

8. **Integration.** A verified task optionally pushes its branch, records `preMergeHead`, transitions through `merge-pending`/`merging`, and acquires `MergeMutex`. It merges into either the pinned feature branch or the primary repository. Conflicts invoke the merger agent; unresolved conflicts are aborted. Successful integration records `integratedHead` and best-effort deletes the remote task branch (`src/core/utils/task-pipeline.ts:497-616`).

9. **Completion and observable status.** Successful integrated work moves through `mark-done-pending` to `done`; failures remain open and become `failed` (`src/core/ralph-loop.ts:518-545`). `LoopRun` writes tracker state before emitting fact events. Those events feed the TUI, run log, console reporter, and optional external observer (`src/core/loop-run/loop-run.ts:278-312`, `src/core/ralph-loop.ts:350-357`, `src/core/loop-run/ink-state.ts:159-199`, `src/core/loop-run/run-log-artifact.ts:20-45`).

10. **Normal cleanup.** `TaskPipeline.run` always calls `sandbox.dispose()` in `finally`. Disposal retries worktree removal, pruning, branch deletion, and filesystem deletion; residual paths generate manual-cleanup warnings (`src/core/utils/task-pipeline.ts:620-622`, `src/core/utils/workspace.ts:219-299`).

11. **Termination and undo.** The first Ctrl+C stops scheduling and kills active process trees while allowing cleanup; a second Ctrl+C exits immediately (`src/core/ralph-loop.ts:447-470`). Panic undo durably records the request, waits up to 30 seconds for writers to exit, rolls back the loop-start snapshot, calls `cleanupAll`, restores issue statuses when supported, and ends as interrupted (`src/core/ralph-loop.ts:629-678`, `src/core/loop-run/loop-run.ts:194-257`).

12. **Crash recovery.** Interrupted implementation worktrees are deleted before replay. Interrupted merges are aborted, reset to `preMergeHead`, and have their worktree removed. Verification/completion phases are rerun, and ownership of the same tracker is adopted (`src/core/utils/stale-run-recovery.ts:286-376`, `src/core/utils/stale-run-recovery.ts:392-501`).

## (3) Evidence table with claim | symbol | file:line

| claim | symbol | file:line |
|---|---|---|
| Supported launcher calls the core loop | `main`, `runInteractive`, `runNonInteractive` | `run/issues.ts:93-109`, `run/issues.ts:119-228`, `run/issues.ts:238-298` |
| Public API exports `ralphLoop` | package export | `package.json:7-10` |
| Current runner always requires isolated task worktrees | `new TaskPipeline` options | `src/core/ralph-loop.ts:707-719` |
| Scheduler continuously fills parallel slots | scheduler loop | `src/core/ralph-loop.ts:740-779` |
| Worktree naming and creation are centralized | `WorkspaceManager.createSandbox` | `src/core/utils/workspace.ts:119-187` |
| Actual Git creation uses argv-safe `worktree add -b` | `ShellGitClient.worktreeAdd` | `src/core/utils/git-client.ts:155-160` |
| Recovery handles are persisted before execution | `TaskPipeline.run` | `src/core/utils/task-pipeline.ts:484-493` |
| Implementer receives the worktree cwd | `TaskPipeline.executeTask` | `src/core/utils/task-pipeline.ts:155-162`, `src/core/utils/task-pipeline.ts:229-265` |
| Verification executes in the same worktree | `runVerification` call | `src/core/utils/task-pipeline.ts:342-380` |
| Merges are serialized | `MergeMutex.runExclusive` | `src/core/utils/workspace.ts:53-68`, `src/core/utils/task-pipeline.ts:590-594` |
| Conflicts invoke the merger agent and may abort | `runMergerAgent` | `src/core/utils/task-pipeline.ts:537-584` |
| Tracker stores explicit phases and worktree metadata | `TaskPhase`, `TaskMeta` | `src/core/loop-run/state.ts:13-56` |
| Tracker is atomic runtime state under `.ralph-loop/runs` | `LoopRunTracker` | `src/core/utils/loop-run-tracker.ts:27-33`, `src/core/utils/loop-run-tracker.ts:348-361` |
| Successful runs archive the active tracker | `markStatusAndArchive` | `src/core/utils/loop-run-tracker.ts:201-229` |
| Task cleanup is guaranteed by pipeline `finally` | `sandbox.dispose` | `src/core/utils/task-pipeline.ts:620-622` |
| Stale writer phases clean recorded worktrees | `prepareImplementingResume`, `prepareMergingResume` | `src/core/utils/stale-run-recovery.ts:461-501` |

## (4) Tests/docs

**Tests identified; not run per instruction:**

- Worktree creation, fallback/required behavior, merging, disposal retries, and residual cleanup: `test/workspace.test.ts:20-316`.
- Raw Git worktree argument construction and branch ownership lookup: `test/git-client.test.ts:54-82`.
- Parallel scheduling, merge serialization, isolated worktrees, conflict handling, phases, and tracker archival: `test/ralph-loop-wiring.test.ts:588-824`, `test/ralph-loop-wiring.test.ts:1451-1669`.
- Base selection, pinned-branch integration, remote deletion, undo guards, and merger outcomes: `test/task-pipeline.test.ts:33-253`, `test/task-pipeline.test.ts:391-611`.
- Worktree recovery handles before execution: `test/executor.test.ts:284-390`.
- End-to-end interrupted implementation/merge recovery: `test/recovery-integration.test.ts:203-361`.
- Detailed stale-run worktree cleanup and panic-undo recovery: `test/stale-run-recovery.test.ts:506-735`, `test/stale-run-recovery.test.ts:1067-1139`, `test/stale-run-recovery.test.ts:1204-1552`.
- Parallel undo propagation and merge-lock race guards: `test/parallel-undo.test.ts:63-297`.
- Aggregate cleanup and non-fatal residual behavior: `test/worktree-cleanup.test.ts:45-195`.

**Docs:**

- User-facing overview: `README.md:40-81`.
- Worktree/scheduler architecture: `docs/adr/0004-parallel-event-driven-scheduler-with-automated-merger.md:6-44`.
- Durable recovery boundary and required isolation: `docs/adr/0006-durable-loop-run-tracker-and-stale-run-recovery.md:20-54`.
- Undo cleanup and writer-drain requirements: `docs/adr/0005-git-backed-force-kill-undo.md:28-67`.
- Domain definitions for tracker and task worktree: `CONTEXT.md:60-115`.

## (5) Uncertainties

- **Documentation/API drift:** README and `isolateWorktree` comments describe isolation as parallel-only or default-false, but `ralphLoop` ignores `isolateWorktree` and hardcodes required isolation for every task (`README.md:52`, `src/core/ralph-loop-types.ts:182-194`, `src/core/ralph-loop.ts:707-719`).
- **Ctrl+C outcome appears inconsistent:** first Ctrl+C sets `terminalReason = "ctrl-c"` but does not visibly change `stoppedReason` to `interrupted`; completion-status mapping may therefore archive it as completed depending on the preceding scheduler state (`src/core/ralph-loop.ts:107-114`, `src/core/ralph-loop.ts:841-866`).
- **Commit enforcement is prompt-based:** the implementer is instructed to commit, but the pipeline does not visibly validate that the worktree is clean or that a new commit exists before merging (`src/instruction/implement.md:53-58`, `src/core/utils/task-pipeline.ts:497-529`).
- **Cleanup guarantees are stronger for paths than branches:** Git removal helpers suppress command failures, while normal disposal’s retry success condition checks surviving paths, potentially leaving a local branch without a surfaced failure (`src/core/utils/git-client.ts:83-95`, `src/core/utils/workspace.ts:227-239`).
- **Preserved-branch base metadata:** `WorkspaceManager` can replace the requested base with `origin/ralph/<id>`, while the tracker records the originally computed `baseCommit`; the recorded base may therefore not describe the actual reused branch tip (`src/core/utils/workspace.ts:148-158`, `src/core/utils/task-pipeline.ts:474-491`).