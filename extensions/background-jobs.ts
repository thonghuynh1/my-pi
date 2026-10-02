/** Background commands supervised outside the Pi host, with session-scoped recovery. */
import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type, type TSchema } from "typebox";
import { spawn } from "node:child_process";
import { existsSync, openSync, closeSync, readSync, fstatSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { platform } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createManagedExtension, loadCapabilityVisibilitySettings } from "./lib/capability-visibility.ts";
import { DurableJobStore, durableSessionDirectory, hasRecordedUserMessage, readJson, writeAtomicJson } from "./lib/durable-jobs.ts";

export const piExtension = { id: "background-jobs" };
const WORKER_PATH = fileURLToPath(new URL("./lib/background-job-worker.mjs", import.meta.url));
const DELIVERY_HEADER = "[Background Job ";
const DEFAULT_TAIL_LINES = 40;
export type JobStatus = "running" | "completed" | "failed" | "killed" | "timed_out" | "interrupted";
export interface BackgroundJob {
  id: string;
  requestId?: string;
  token: string;
  directory: string;
  command: string;
  cwd: string;
  pid?: number;
  supervisorPid?: number;
  heartbeatAt?: number;
  status: JobStatus;
  startedAt: number;
  endedAt?: number;
  exitCode?: number | null;
  logFilePath: string;
  notifyOnFinish: boolean;
  delivered: boolean;
  error?: string;
}

export function resolveShell(): { shell: string; args: string[]; label: string } {
  if (platform() === "win32") return { shell: process.env.COMSPEC || "cmd.exe", args: ["/d", "/s", "/c"], label: "cmd" };
  if (existsSync("/bin/bash")) return { shell: "/bin/bash", args: ["-c"], label: "bash" };
  return { shell: "/bin/sh", args: ["-c"], label: "sh" };
}

export default function backgroundJobsExtension(pi: ExtensionAPI): void {
  const visibility = loadCapabilityVisibilitySettings();
  for (const warning of visibility.warnings) console.warn(`[background-jobs] ${warning.message}`);
  const managed = createManagedExtension(pi, { id: piExtension.id, visibility: visibility.settings });
  const registerTool = <P extends TSchema>(tool: ToolDefinition<P, any> & { defaultVisibility: "agent-visible" }) => managed.registerTool({ ...tool });
  const fallbackSessionId = randomUUID();
  const jobs = new Map<string, BackgroundJob>();
  let counter = 0;
  let store: DurableJobStore<BackgroundJob> | undefined;
  let monitor: NodeJS.Timeout | undefined;
  let active = false;
  let dirty = false;
  let lastContext: ExtensionContext | undefined;
  let isAgentBusy = false;
  let hasUserTurnPending = false;
  let compactionInProgress = false;
  let deliveryInFlight: string[] | undefined;
  let deliveryAccepted = false;
  let deliveryMessage: string | undefined;
  let deliveryTimer: NodeJS.Timeout | undefined;

  function persist(): void { store?.save(counter, [...jobs.values()]); }
  function running(): BackgroundJob[] { return [...jobs.values()].filter((job) => job.status === "running"); }
  function tail(job: BackgroundJob, count = DEFAULT_TAIL_LINES): string {
    if (!existsSync(job.logFilePath)) return "(no output)";
    const lines = Number.isFinite(count) ? Math.max(1, Math.min(2000, Math.floor(count))) : DEFAULT_TAIL_LINES;
    const fd = openSync(job.logFilePath, "r");
    try {
      const size = fstatSync(fd).size;
      const bytes = Buffer.alloc(Math.min(size, 256 * 1024));
      const count = readSync(fd, bytes, 0, bytes.length, Math.max(0, size - bytes.length));
      const output = bytes.subarray(0, count).toString("utf8");
      return output.split(/\r?\n/).slice(-lines).join("\n");
    } finally { closeSync(fd); }
  }
  function updateStatusWidget(): void {
    if (!lastContext?.hasUI || typeof lastContext.ui?.setWidget !== "function") return;
    const live = running();
    lastContext.ui.setWidget("bg-jobs-status", live.length ? [`⚡ [bg] ${live.length} running: ${live.map((job) => job.id).join(", ")}`] : undefined);
  }
  function clearDelivery(): void {
    if (deliveryTimer) clearTimeout(deliveryTimer);
    deliveryTimer = undefined;
    deliveryInFlight = undefined;
    deliveryAccepted = false;
    deliveryMessage = undefined;
  }
  function stopMonitoring(): void {
    if (monitor) clearInterval(monitor);
    monitor = undefined;
    clearDelivery();
  }
  function confirmDelivery(): void {
    if (!deliveryMessage || !hasRecordedUserMessage(lastContext, deliveryMessage)) return;
    const previous = new Map<BackgroundJob, boolean>();
    for (const id of deliveryInFlight ?? []) {
      const job = jobs.get(id);
      if (job) { previous.set(job, job.delivered); job.delivered = true; }
    }
    try { persist(); } catch (error) {
      for (const [job, delivered] of previous) job.delivered = delivered;
      throw error;
    }
    clearDelivery();
  }
  function flushPendingWakes(): void {
    if (!active || isAgentBusy || hasUserTurnPending || compactionInProgress || deliveryInFlight) return;
    const ready = [...jobs.values()].filter((job) => job.status !== "running" && job.notifyOnFinish && !job.delivered);
    if (!ready.length) return;
    deliveryInFlight = ready.map((job) => job.id);
    deliveryTimer = setTimeout(() => { confirmDelivery(); clearDelivery(); flushPendingWakes(); }, 60_000);
    deliveryTimer.unref();
    deliveryMessage = ready.map((job) => [
      `[Background Job ${job.id} ${job.status.toUpperCase()}]`,
      `Command: \`${job.command}\``,
      `Exit code: ${job.exitCode ?? "unknown"}`,
      `Log: ${job.logFilePath}`,
      job.error ?? "", "", "Output tail:", "```", tail(job), "```",
    ].join("\n")).join("\n\n");
    pi.sendUserMessage(deliveryMessage, { deliverAs: "followUp" });
  }
  function reconcile(): void {
    let changed = false;
    for (const job of jobs.values()) {
      if (job.status !== "running" && job.status !== "interrupted") continue;
      const state = readJson<Partial<BackgroundJob>>(join(job.directory, "state.json"));
      if (state?.token === job.token && !(job.status === "interrupted" && state.status === "running")) {
        const before = JSON.stringify([job.status, job.pid, job.endedAt, job.exitCode]);
        const recoveredOutcome = job.status === "interrupted" && state.status !== "running";
        Object.assign(job, state);
        if (recoveredOutcome) { job.delivered = false; if (!state.error) delete job.error; }
        changed ||= before !== JSON.stringify([job.status, job.pid, job.endedAt, job.exitCode]);
      }
      if (job.status === "running") {
        // Never kill a persisted PID: it may have been reused. Commands are sent
        // only to the token-bound supervisor, which owns the live child handle.
        let alive = true;
        if (job.supervisorPid) {
          try { process.kill(job.supervisorPid, 0); }
          catch (error) { alive = (error as NodeJS.ErrnoException).code !== "ESRCH"; }
        }
        const leaseExpired = Date.now() - (job.heartbeatAt ?? job.startedAt) > 10_000;
        if (leaseExpired || !alive) {
          // The supervisor may commit completion and exit between our initial
          // read and the liveness probe. Re-read before declaring an unknown outcome.
          const latest = readJson<Partial<BackgroundJob>>(join(job.directory, "state.json"));
          if (latest?.token === job.token && latest.status && latest.status !== "running") {
            Object.assign(job, latest);
          } else if (!alive || Date.now() - (latest?.token === job.token ? latest.heartbeatAt ?? job.startedAt : job.startedAt) > 10_000) {
            job.status = "interrupted";
            job.endedAt = Date.now();
            job.error = `Supervisor disappeared or its heartbeat expired; command outcome is unknown. Inspect the command log and ${join(job.directory, "supervisor.log")} before explicitly retrying.`;
          }
          changed = true;
        }
      }
    }
    if (changed) dirty = true;
    if (dirty) { persist(); dirty = false; updateStatusWidget(); }
    flushPendingWakes();
  }
  function attach(ctx: ExtensionContext): void {
    const directory = durableSessionDirectory(ctx, "background", fallbackSessionId);
    if (store?.directory === directory && active) return;
    stopMonitoring();
    const nextStore = new DurableJobStore<BackgroundJob>(directory);
    const saved = nextStore.load();
    store = nextStore;
    jobs.clear();
    counter = saved?.counter ?? 0;
    for (const job of saved?.jobs ?? []) jobs.set(job.id, job);
    active = true;
    dirty = false;
    lastContext = ctx;
    isAgentBusy = false;
    hasUserTurnPending = false;
    compactionInProgress = false;
    reconcile();
    monitor = setInterval(() => {
      try { reconcile(); } catch (error) { console.error("[background-jobs] reconciliation failed", error); }
    }, 250);
    monitor.unref();
    updateStatusWidget();
  }
  function sendControl(job: BackgroundJob, action: "kill" | "input", input?: string): void {
    writeAtomicJson(join(job.directory, "controls", `${Date.now()}-${randomUUID()}.json`), { token: job.token, action, input });
  }

  pi.on("session_start", async (_event, ctx) => attach(ctx));
  pi.on("session_shutdown", async () => {
    active = false;
    stopMonitoring();
    persist();
    // Supervisors deliberately outlive Pi. bg_kill /jobs kill stops them.
  });
  pi.on("agent_start", () => { isAgentBusy = true; if (deliveryAccepted) confirmDelivery(); });
  pi.on("turn_start", () => { isAgentBusy = true; });
  pi.on("input", (event) => {
    if (deliveryInFlight && event.source === "extension" && event.text.startsWith(DELIVERY_HEADER)) {
      if (event.streamingBehavior) confirmDelivery();
      else deliveryAccepted = true;
    } else hasUserTurnPending = true;
  });
  pi.on("turn_end", () => confirmDelivery());
  pi.on("agent_settled", () => { isAgentBusy = false; hasUserTurnPending = false; confirmDelivery(); clearDelivery(); flushPendingWakes(); });
  pi.on("session_before_compact", () => { compactionInProgress = true; });
  const onCompactionEnd = () => {
    compactionInProgress = false;
    const timer = setTimeout(flushPendingWakes, 0);
    timer.unref();
  };
  pi.on("session_compact", onCompactionEnd);
  pi.on("session_compact_failed", onCompactionEnd);
  pi.on("before_agent_start", (event) => ({
    systemPrompt: event.systemPrompt + `\n\n=== Background Jobs Protocol ===\nLong-running commands (tests, benchmarks, evaluations, watchers, servers) run via \`bg_run\`, never inline in \`bash\`.\n\nHARD RULES — follow exactly, no exceptions:\n1. NEVER call \`sleep\`/\`timeout\`/\`Start-Sleep\` in bash to wait for a background job.\n2. NEVER call \`bg_status\` or \`bg_list\` in a loop, or just to check up on a running job.\n3. The instant \`bg_run\` returns, or a status tool shows running: inform the user and END YOUR TURN immediately.\n4. The harness delivers completion automatically. Do not wait, retry, or poll.\n5. Check status only after completion notification or when the user explicitly asks.\nJobs survive Pi shutdown; reopen the same session to recover them. An interrupted outcome is unknown: inspect logs, never automatically replay shell actions.\n`,
  }));
  pi.on("tool_call", async (event) => {
    if (event.toolName !== "bash" || !running().length) return;
    const command = (event.input as { command?: string }).command ?? "";
    if (/\b(?:sleep|timeout)\s+\d+/i.test(command) || /Start-Sleep/i.test(command)) {
      return { block: true, reason: "BLOCKED: Do not use 'sleep' to wait for background jobs. End your turn; completion will be delivered automatically." };
    }
  });

  registerTool({
    name: "bg_run", label: "Run Background Command", defaultVisibility: "agent-visible",
    description: "Run a command in a durable detached supervisor. Returns immediately. On Windows uses cmd.exe, not Git Bash. Jobs survive Pi exiting; reopen the same session to recover status and completion. After this call returns: inform the user and END YOUR TURN; never poll or sleep.",
    parameters: Type.Object({
      command: Type.String(), cwd: Type.Optional(Type.String()),
      timeoutSeconds: Type.Optional(Type.Number({ minimum: 0 })),
      notifyOnFinish: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      attach(ctx);
      const existing = [...jobs.values()].find((job) => job.requestId === _toolCallId);
      if (existing) {
        if (existing.command !== params.command || existing.cwd !== (params.cwd ?? ctx.cwd)) throw new Error("Job request ID reused with different command/cwd.");
        return { content: [{ type: "text", text: `Existing background job: ${existing.id} [${existing.status}]. Log: ${existing.logFilePath}` }], details: { jobId: existing.id, status: existing.status, logFilePath: existing.logFilePath } };
      }
      const id = `bg-${++counter}`;
      const directory = join(store!.directory, id);
      const job: BackgroundJob = {
        id, requestId: _toolCallId, directory, token: randomUUID(), command: params.command, cwd: params.cwd ?? ctx.cwd,
        status: "running", startedAt: Date.now(), logFilePath: join(directory, "output.log"),
        notifyOnFinish: params.notifyOnFinish ?? true, delivered: false,
      };
      // Intent precedes execution. The admission gap is never auto-replayed.
      writeAtomicJson(join(directory, "request.json"), { ...job, timeoutSeconds: params.timeoutSeconds });
      jobs.set(id, job);
      try { persist(); } catch (error) { jobs.delete(id); throw error; }
      try {
        const diagnostics = openSync(join(directory, "supervisor.log"), "a", 0o600);
        let worker;
        try { worker = spawn(process.execPath, [WORKER_PATH, directory], { detached: true, stdio: ["ignore", diagnostics, diagnostics], windowsHide: true }); }
        finally { closeSync(diagnostics); }
        job.supervisorPid = worker.pid;
        worker.on("error", (error) => {
          if (!active || jobs.get(id) !== job) return;
          job.status = "failed"; job.error = error.message; job.endedAt = Date.now();
          dirty = true;
          try { reconcile(); } catch (commitError) { console.error("[background-jobs] failed to commit spawn failure", commitError); }
        });
        worker.unref();
        persist();
      } catch (error) {
        job.status = "interrupted"; job.error = String(error); job.endedAt = Date.now(); persist();
      }
      updateStatusWidget();
      return {
        content: [{ type: "text", text: [
          `Background job started: ${id}`, `Shell: ${resolveShell().label}`, `Command: \`${job.command}\``,
          `Working directory: \`${job.cwd}\``, `Log file: \`${job.logFilePath}\``,
          `Status: ${job.status}. You will be notified on completion; jobs survive Pi shutdown.`,
        ].join("\n") }],
        details: { jobId: id, status: job.status, logFilePath: job.logFilePath },
      };
    },
    renderResult(result, _options, _theme) {
      const content = result.content[0];
      return new Text(content?.type === "text" ? content.text : "", 0, 0);
    },
  });
  registerTool({
    name: "bg_status", label: "Check Background Job Status", defaultVisibility: "agent-visible",
    description: "Check a recovered or live job only when the user asks or after a completion notification. If running: inform the user and END YOUR TURN. Never poll.",
    parameters: Type.Object({ jobId: Type.String(), lines: Type.Optional(Type.Number()) }),
    async execute(_id, params, _signal, _update, ctx) {
      attach(ctx); reconcile();
      const job = jobs.get(params.jobId);
      if (!job) return { content: [{ type: "text", text: `Job '${params.jobId}' not found.` }], details: {} };
      return {
        content: [{ type: "text", text: [
          `Job: ${job.id} [${job.status.toUpperCase()}]`, `Command: \`${job.command}\``,
          `PID: ${job.pid ?? "unknown"}`, `Duration: ${(((job.endedAt ?? Date.now()) - job.startedAt) / 1000).toFixed(1)}s`,
          `Exit Code: ${job.exitCode ?? (job.status === "running" ? "running" : "unknown")}`,
          `Log File: \`${job.logFilePath}\``, job.error ?? "", "", "Output tail:", "```", tail(job, params.lines), "```",
        ].join("\n") }], details: { jobId: job.id, status: job.status, exitCode: job.exitCode },
      };
    },
  });
  registerTool({
    name: "bg_list", label: "List Background Jobs", defaultVisibility: "agent-visible",
    description: "List session-scoped background jobs, including recovered results. Filters: all, running, completed, failed, killed, timed_out, interrupted. Do NOT poll. If running: inform the user and END YOUR TURN.",
    parameters: Type.Object({ status: Type.Optional(Type.String()) }),
    async execute(_id, params, _signal, _update, ctx) {
      attach(ctx); reconcile();
      const filter = params.status?.toLowerCase() ?? "all";
      const selected = [...jobs.values()].filter((job) => filter === "all" || job.status === filter);
      return { content: [{ type: "text", text: selected.length
        ? `Background jobs (${selected.length}):\n${selected.map((job) => `- **${job.id}** [${job.status}] PID:${job.pid ?? "?"}: \`${job.command}\``).join("\n")}`
        : `No background jobs found matching status '${filter}'.` }], details: { total: selected.length } };
    },
  });
  registerTool({
    name: "bg_kill", label: "Kill Background Job", defaultVisibility: "agent-visible",
    description: "Ask the durable supervisor to terminate a running job and its process tree. Final status is confirmed by the supervisor, not guessed from a persisted PID.",
    parameters: Type.Object({ jobId: Type.String() }),
    async execute(_id, params, _signal, _update, ctx) {
      attach(ctx); reconcile();
      const job = jobs.get(params.jobId);
      if (!job || job.status !== "running") return { content: [{ type: "text", text: job ? `Job '${job.id}' is not running (status: ${job.status}).` : `Job '${params.jobId}' not found.` }], details: {} };
      sendControl(job, "kill");
      return { content: [{ type: "text", text: `Termination requested for background job '${job.id}'. Completion will be confirmed by the supervisor.` }], details: { jobId: job.id, status: "kill_requested" } };
    },
  });
  registerTool({
    name: "bg_input", label: "Send Input to Background Job", defaultVisibility: "agent-visible",
    description: "Queue stdin input for the durable supervisor, including after reopening the parent session.",
    parameters: Type.Object({ jobId: Type.String(), input: Type.String() }),
    async execute(_id, params, _signal, _update, ctx) {
      attach(ctx); reconcile();
      const job = jobs.get(params.jobId);
      if (!job || job.status !== "running") return { content: [{ type: "text", text: `Job '${params.jobId}' is not currently running.` }], details: {} };
      sendControl(job, "input", params.input);
      return { content: [{ type: "text", text: `Queued input for job '${job.id}'.` }], details: {} };
    },
  });
  managed.registerCommand("jobs", {
    description: "Manage durable jobs: /jobs [list|kill <id>|tail <id> [lines]|clear]",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      attach(ctx); reconcile();
      const [action = "list", id, count] = args.trim().split(/\s+/);
      if (action === "clear") {
        let cleared = 0;
        for (const job of jobs.values()) if (job.status !== "running") { jobs.delete(job.id); cleared++; }
        persist();
        ctx.ui.notify(`Cleared ${cleared} finished background jobs from registry (logs retained).`, "info");
      } else if (action === "kill") {
        const job = jobs.get(id);
        if (!job || job.status !== "running") { ctx.ui.notify(`Job '${id}' is not running.`, "warning"); return; }
        sendControl(job, "kill");
        ctx.ui.notify(`Termination requested for ${id}.`, "info");
      } else if (action === "tail" || action === "log") {
        const job = jobs.get(id);
        ctx.ui.notify(job ? `Tail of ${id}:\n${tail(job, Number(count ?? 30))}` : `Job '${id}' not found.`, "info");
      } else {
        ctx.ui.notify(jobs.size ? `Background Jobs:\n${[...jobs.values()].map((job) => `${job.id} [${job.status}] - ${job.command}`).join("\n")}` : "No background jobs recorded.", "info");
      }
    },
  });
}
