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

Background subagents remain isolated in-process SDK sessions. Their launch configuration, bounded output checkpoints, audit transcript path, usage, result, and delivery state are persisted. Streaming checkpoints are throttled to roughly one second; completed tool output, assistant-message boundaries, run finalization, and graceful shutdown force a checkpoint. Background child transcripts use disk-backed SessionManagers. Foreground/evidence-packet runs retain their existing runtime behavior.

Shutdown aborts running in-process children and retains them as `interrupted` (or `cancelled` if cancellation was requested). Startup also converts orphaned `running` records to these states. Completed, failed, and undelivered records remain queryable. Late callbacks from another registry/session cannot mutate current state or billing.

`subagent_resume(jobId)` explicitly creates a NEW background run from the saved launch configuration and checkpoint, linked by `resumedFrom`. It is a natural-language handoff, not exact continuation of an unfinished model request/tool. It warns the child to verify current state and not blindly repeat uncertain side effects. Each interrupted run admits at most one recovery child; another interruption is recovered from that new child. There is no automatic replay of shell/custom agent actions.

### Delivery

Terminal jobs form a persistent outbox. Follow-ups are marked delivered only after the exact follow-up user message is present in Pi's persisted transcript. Input/agent-start admission alone is not acknowledgement. Turn completion, settlement, and retry-time checks confirm recording before retrying. Results returned by `subagent_wait` are acknowledged only after its tool receipt is recorded; startup can recover that acknowledgement from the transcript. Unconfirmed messages remain eligible after restart. Delivery is at-least-once across crash windows, not exactly-once; the durable job ID identifies duplicates. Status, results, and audit files remain available even after acknowledgement.

## Consequences

- Shell commands and their deadlines survive the Pi host exiting, but not host reboot or supervisor loss.
- Subagent output/history survives restart; in-process execution does not. Recovery is explicit and conservative.
- Detached watchers/servers must be stopped explicitly with `bg_kill` or `/jobs kill`; quitting Pi no longer stops them.
- No new runtime dependency or migration of the parent conversation engine is required.
- Registry/log contents may contain sensitive command/task/output data; directories and snapshot files are private on POSIX and follow local filesystem ACLs on Windows. Local retention/cleanup remains the user's responsibility.
