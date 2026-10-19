# ADR 0006 — Durable background work with conservative recovery

## Decision

Keep the existing Pi extension/SDK integration; do not replace the host agent loop with the experimental `pi-durable` harness. Add native durable job bookkeeping and a separate shell supervisor.

### Storage and identity

Job registries live under `~/.pi/agent/jobs/{background,subagents}/<sha256(session-id)>/registry.json`. `PI_DURABLE_JOBS_DIR` overrides the base directory. Working directory is not session identity. Counters are saved with job state; `bg-N` and `sa-N` remain session-local handles and do not reset on reload. Parent tool-call IDs are persisted as request IDs so retried admissions return the existing job rather than duplicating work. Logs and transcripts use per-session, per-job directories.

Writes use a private temporary file, fsync, then rename. Transient Windows replacement sharing errors (EPERM/EACCES/EBUSY) receive bounded I/O backoff (at most one second); the previously committed file is never deleted to work around a lock. Admission is saved before work starts; terminal outcomes are saved before notification. Corrupt registries fail visibly instead of silently resetting history. One Pi host owns a session registry at a time; opening the same session concurrently in two hosts is unsupported. These are local filesystem/process durability guarantees, not distributed or power-loss guarantees.

### Shell commands

`bg_run` launches a dependency-free detached Node supervisor. It owns stdout/stderr logging, stdin, timeout enforcement, tree termination, and an atomic outcome file. Natural command exit wins over late timeout/kill requests while stdio is draining; Windows tree termination is awaited and a failure produces an unknown/interrupted outcome rather than false success. It outlives Pi shutdown, reload, and session replacement. A worker-exclusive launch lock prevents duplicate supervisors from executing the command twice.

Pi reconciles outcome files internally and recovers existing workers/results when the same session reopens. This internal monitoring is not agent-facing status polling. Agent no-polling instructions remain unchanged.

Controls use token-bound files, not signals to persisted command PIDs. A missing supervisor or expired heartbeat (two-second refresh, ten-second lease) produces `interrupted`, meaning the command outcome is unknown. A late token-matched terminal outcome can still settle an interrupted job. Neither an admission gap nor a lost supervisor causes automatic command replay. A supervisor crash may leave a command alive; inspect logs and current OS state rather than infer failure or issue a potentially unsafe PID kill.

`bg_kill` acknowledges a kill request; only the supervisor confirms `killed` after process close. `bg_input` acknowledges queued input, not application receipt. `/jobs clear` removes terminal registry records, retaining audit files.

### Subagents

Joined (default) and detached (optional results) share the same isolated, disk-backed, in-process SDK execution and durable registry. Admissions are saved synchronously before asynchronous SDK construction. Request-ID deduplication precedes the shared six-child capacity check; capacity failure never silently changes mode. `background: true/false` aliases detached/joined, with disagreements rejected. `/subagent on/off` is prompting-only.

Joined calls return the terminal report as the launching tool result only after child abort/idle/disposal cleanup. Cancellation aborts and awaits the child, never calls parent `ctx.abort()`. Detached calls immediately return a job ID and use the existing outbox. Evidence-packet calls honor both modes and save structured reports and packet metadata. Wait defaults to all targets; any waits for one terminal target. Omitted targets include undelivered finished work. Wait timeout/abort affects only the wait, not execution.

Launch configuration, bounded output checkpoints, audit transcript path, per-assignment usage, report, execution mode, context policy, and reuse metadata are persisted. Terminal outcome and report share one snapshot. A completion-write failure cannot undo actual child completion: the job remains terminal in memory, releases capacity, and returns a visible persistenceError warning with its report. Detached automatic delivery skips unconfirmed outcomes until a subsequent successful snapshot confirms them; explicit retrieval remains available. Receipt-write failures are logged and retried at later lifecycle boundaries, not allowed to crash timer callbacks. A crash during persistent storage failure can leave an interrupted disk record despite completed work, so inspect the parent tool receipt and child transcript before any explicit recovery. Streaming checkpoints are throttled to roughly one second; completed tool output, assistant-message boundaries, finalization, and graceful shutdown force a checkpoint. Legacy records without mode normalize to detached.

Shutdown aborts and awaits in-process children, retaining them as interrupted (or cancelled if requested). Startup also converts orphaned running records. Completed, failed, and undelivered records remain queryable. Runtime/registry fencing prevents late callbacks from another session mutating current state or billing. No automatic replay or automatic resume occurs.

`subagent_resume(jobId)` explicitly creates a NEW detached run from an interrupted job's saved configuration/checkpoint, linked by resumedFrom. It is a natural-language handoff, not exact continuation of an unfinished model request/tool. Each interrupted run admits at most one recovery child. The child must inspect uncertain side effects before proceeding.

`subagent_followup(jobId, task)` is a separate, explicit operation for a successful normal child. It reopens the latest lineage transcript only after terminal success and cleanup, using saved resolved model/cwd/type/tools/prompt/thinking configuration. Failed, cancelled, interrupted, packet, legacy/nontranscript jobs and unavailable saved models fail closed. Simultaneous lineage or disk-session ownership is rejected, even via ancestor IDs. Ancestor IDs are not independently writable snapshots: follow-up requires the latest lineage ID. A later failed/cancelled/interrupted segment closes ordinary reuse of that lineage; it does not make an old successful transcript safe. Errors direct callers to a reviewed new-child handoff or explicit interrupted-work recovery, rather than to an unusable failed job. Custom follow-up launch configuration retains its agent name for explicit recovery. No idle SDK object is retained. Session statistics are differenced from the segment's opening baseline, including compaction costs, so history is not billed again.

Child-only SettingsManager.inMemory enables native compaction, independent of parent/global Accordion settings; no extensions load and no settings files are written. The compaction target is 150k tokens bounded by actual model window, with response reserve and a recent-tail target at most 12k. Models with unknown or sub-2048 windows are rejected. Native compaction estimates/indivisible messages are not a strict per-request ceiling; idle follow-up checks compact over-budget context before prompting. A successful final answer disables child-local post-run compaction so an unnecessary summarization request cannot delay the report until the execution deadline. Each new prompt restores the child policy; explicit follow-ups compact over-budget context before continuing. Error, truncated, and tool responses retain SDK recovery behavior. Prompt settlement and abort/disposal cleanup still precede terminal publication. Context tokens/window remain explicitly unknown where the SDK cannot report them, never false zero.

After three assignments in one generation, one MiB raw transcript, or unsafe/unknown context, an explicit follow-up rolls over to a new disk session. The bounded handoff preserves the original goal, up to 8k characters of the previous report, and the audit transcript pointer; it states fresh handoff, NOT full memory, and forbids uncertain side-effect replay. Oversized goals fail rather than silently truncating critical requirements. Results record reset reason and generation; full source transcripts remain for audit. Compaction failure is a visible error requiring an explicit reviewed new child/handoff, not unbounded retries.

Compatibility uses APIs present in both repository SDK 0.84.3 and host 1.1.0 (session factories, SettingsManager.inMemory, SessionManager.open, prompt/abort/dispose, context usage). It does not depend on nested executeTool, agent_before_settle, a new parent loop, or final-settlement blocking.

### Delivery

Terminal jobs form a persistent outbox. Follow-ups are marked delivered only after the exact follow-up user message is present in Pi's persisted transcript. Input/agent-start admission alone is not acknowledgement. Turn completion, settlement, and retry-time checks confirm recording before retrying. Joined outcomes never enter detached automatic follow-ups. They remain discoverable/retrievable after restart until the exact joined launch tool receipt or a wait receipt is recorded. Results returned by `subagent_wait` and joined launching calls are acknowledged only after their tool receipt is recorded; startup can recover that acknowledgement from the transcript. Unconfirmed messages remain eligible after restart. Delivery is at-least-once across crash windows, not exactly-once; the durable job ID identifies duplicates. Status, results, and audit files remain available even after acknowledgement.

## Consequences

- Shell commands and their deadlines survive the Pi host exiting, but not host reboot or supervisor loss.
- Subagent output/history survives restart; in-process execution does not. Recovery is explicit and conservative.
- Detached watchers/servers must be stopped explicitly with `bg_kill` or `/jobs kill`; quitting Pi no longer stops them.
- No new runtime dependency or migration of the parent conversation engine is required.
- Registry/log contents may contain sensitive command/task/output data; directories and snapshot files are private on POSIX and follow local filesystem ACLs on Windows. Local retention/cleanup remains the user's responsibility.

## Verification boundary

Regression fixtures exercise registered extension tools/events and real SDK children against a scripted local HTTP/SSE provider, including reuse, per-segment accounting, native compaction, rollover, packet reports, admission, cancellation, and delayed construction. A real parent SDK test verifies that its next model request waits for both joined child reports. The subagent suite also runs against the installed host SDK through the tracked subagents-host-sdk-loader.mjs probe. It mirrors the host's extension aliases for SDK/agent core/TUI/AI-compat/TypeBox source imports, leaves native host-internal imports alone, verifies SDK module identity, and logs loaded versions/resolution paths. This supplements the repository dependency stack; it is not a clean dependency-install audit. No paid/live LLMs were used. Host transcript receipts remain explicit inputs to lifecycle fixtures; interactive CLI reload and real-model behavior are separate verification boundaries.

Reproduce on Node 22.15+ (this verification used 22.22.1):

```sh
node --experimental-transform-types --test extensions/__tests__/*.test.ts
node --import ./extensions/__tests__/subagents-host-sdk-loader.mjs --experimental-transform-types --test extensions/__tests__/subagents*.test.ts
```

The host probe defaults to the installed Windows SDK under APPDATA/npm/node_modules. On another installation, set PI_SUBAGENT_TEST_SDK_ENTRY to its dist/index.js before running. It does not install packages or change global settings.
