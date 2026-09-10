/**
 * Background Jobs Extension for Pi.
 *
 * Enables running long-running shell commands (tests, builds, daemons, watchers)
 * in the background without blocking the conversational turn. Users can continue
 * chatting with Pi while tasks execute. Once a background task finishes, Pi is
 * reactively woken up via a follow-up message when idle.
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, appendFileSync, writeFileSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import {
  createManagedExtension,
  loadCapabilityVisibilitySettings,
  type CapabilityVisibilitySettings,
} from "./lib/capability-visibility.ts";

export const piExtension = { id: "background-jobs" };

const LOG_BASE_DIR = join(homedir(), ".pi", "agent", "logs", "bg-jobs");
const MAX_BUFFER_LINES = 2000;
const DEFAULT_TAIL_LINES = 40;

export type JobStatus = "running" | "completed" | "failed" | "killed" | "timed_out";

export interface BackgroundJob {
  id: string;
  command: string;
  cwd: string;
  pid?: number;
  status: JobStatus;
  startedAt: number;
  endedAt?: number;
  exitCode?: number | null;
  outputBuffer: string[];
  logFilePath: string;
  notifyOnFinish: boolean;
  child?: ChildProcess;
  timeoutHandle?: NodeJS.Timeout;
}

const BgRunParams = Type.Object({
  command: Type.String({ description: "The shell command to run in the background." }),
  cwd: Type.Optional(Type.String({ description: "Working directory for the command. Defaults to the current working directory." })),
  timeoutSeconds: Type.Optional(Type.Number({ description: "Optional timeout in seconds after which the process is killed." })),
  notifyOnFinish: Type.Optional(Type.Boolean({ description: "Whether to notify the agent automatically when the job completes. Defaults to true." })),
});

type BgRunInput = Static<typeof BgRunParams>;

const BgStatusParams = Type.Object({
  jobId: Type.String({ description: "The ID of the background job (e.g. 'bg-1')." }),
  lines: Type.Optional(Type.Number({ description: "Number of tail output lines to return. Defaults to 40." })),
});

type BgStatusInput = Static<typeof BgStatusParams>;

const BgListParams = Type.Object({
  status: Type.Optional(Type.String({ description: "Filter by status: 'all', 'running', 'completed', 'failed', 'killed', 'timed_out'. Defaults to 'all'." })),
});

type BgListInput = Static<typeof BgListParams>;

const BgKillParams = Type.Object({
  jobId: Type.String({ description: "The ID of the background job to kill (e.g. 'bg-1')." }),
});

type BgKillInput = Static<typeof BgKillParams>;

const BgInputParams = Type.Object({
  jobId: Type.String({ description: "The ID of the background job to send input to." }),
  input: Type.String({ description: "The text input to write to standard input (stdin)." }),
});

type BgInputInput = Static<typeof BgInputParams>;

function ensureLogDir(): void {
  try {
    mkdirSync(LOG_BASE_DIR, { recursive: true });
  } catch {}
}

function initLogFile(filePath: string, header: string): void {
  try {
    ensureLogDir();
    writeFileSync(filePath, header, "utf8");
  } catch {}
}

function appendToLog(filePath: string, text: string): void {
  try {
    appendFileSync(filePath, text, "utf8");
  } catch {}
}

interface ShellConfig {
  shell: string;
  args: string[];
}

/**
 * Resolves the appropriate shell, prioritizing Git Bash on Windows to match Pi's native behavior.
 */
function resolveShell(): ShellConfig {
  if (platform() === "win32") {
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    const gitBash = join(programFiles, "Git", "bin", "bash.exe");
    if (existsSync(gitBash)) {
      return { shell: gitBash, args: ["-c"] };
    }
    const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const gitBashX86 = join(programFilesX86, "Git", "bin", "bash.exe");
    if (existsSync(gitBashX86)) {
      return { shell: gitBashX86, args: ["-c"] };
    }
    try {
      const whereResult = spawnSync("where", ["bash.exe"], { encoding: "utf8", windowsHide: true });
      if (whereResult.status === 0 && whereResult.stdout) {
        const firstMatch = whereResult.stdout.trim().split(/\r?\n/)[0];
        if (firstMatch && existsSync(firstMatch)) {
          return { shell: firstMatch, args: ["-c"] };
        }
      }
    } catch {}
    return { shell: process.env.COMSPEC || "cmd.exe", args: ["/d", "/s", "/c"] };
  }
  if (existsSync("/bin/bash")) return { shell: "/bin/bash", args: ["-c"] };
  return { shell: "/bin/sh", args: ["-c"] };
}

/**
 * Cross-platform process tree termination.
 */
function killProcessTree(pid: number): void {
  try {
    if (platform() === "win32") {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        process.kill(pid, "SIGKILL");
      }
    }
  } catch {}
}

export default function backgroundJobsExtension(pi: ExtensionAPI): void {
  let jobCounter = 0;
  const jobs = new Map<string, BackgroundJob>();
  const pendingWakes: string[] = [];

  let isAgentBusy = false;
  let hasUserTurnPending = false;
  let lastContext: ExtensionContext | undefined;

  let piSettings: CapabilityVisibilitySettings = {};
  const visibilityResult = loadCapabilityVisibilitySettings();
  for (const warning of visibilityResult.warnings) {
    console.warn(`[background-jobs] capability-visibility: ${warning.message}`);
  }
  piSettings = visibilityResult.settings;
  const managed = createManagedExtension(pi, { id: piExtension.id, visibility: piSettings });

  function getRunningJobs(): BackgroundJob[] {
    return [...jobs.values()].filter((j) => j.status === "running");
  }

  function updateStatusWidget(ctx?: ExtensionContext): void {
    const targetCtx = ctx ?? lastContext;
    if (!targetCtx || !targetCtx.hasUI || typeof targetCtx.ui?.setWidget !== "function") return;

    const running = getRunningJobs();
    if (running.length === 0) {
      targetCtx.ui.setWidget("bg-jobs-status", undefined);
      return;
    }

    targetCtx.ui.setWidget(
      "bg-jobs-status",
      (_tui: unknown, theme: Theme) => ({
        render(): string[] {
          const summary = running
            .map((j) => `${j.id} (${j.command.length > 20 ? j.command.slice(0, 17) + "..." : j.command})`)
            .join(", ");
          return [theme.fg("warning", `⚡ [bg] ${running.length} running: ${summary}`)];
        },
        invalidate() {},
      }),
      { placement: "aboveEditor" },
    );
  }

  /**
   * Safely dispatches pending completion notifications when the agent is idle.
   */
  function flushPendingWakes(): void {
    if (isAgentBusy || hasUserTurnPending) return;
    if (pendingWakes.length === 0) return;

    const message = pendingWakes.shift();
    if (!message) return;

    pi.sendUserMessage(message, { deliverAs: "followUp" });
  }

  // Inject prompt guidelines to prevent the agent from sleeping/busy-waiting
  pi.on("before_agent_start", (event) => {
    return {
      systemPrompt:
        event.systemPrompt +
        `\n\n=== Background Jobs Protocol ===\nLong-running commands (tests, benchmarks, evaluations, watchers, servers) run via \`bg_run\`, never inline in \`bash\`.\n\nHARD RULES — follow exactly, no exceptions:\n1. NEVER call \`sleep\`/\`timeout\`/\`Start-Sleep\` in bash to wait for a background job.\n2. NEVER call \`bg_status\` or \`bg_list\` in a loop, or "just to check up" on a running job. Checking once and then waiting is still polling — it is prohibited.\n3. The instant \`bg_run\` returns, or \`bg_status\`/\`bg_list\` shows a job as "running": tell the user it is running in the background, then END YOUR TURN immediately. Do not call any other tool afterward in that same turn.\n4. Do not re-check, retry, or wait for completion yourself. The harness delivers a follow-up message to you automatically the instant the job's completion event is published — you cannot discover completion sooner by checking, and you must not try.\n5. Only call \`bg_status\`/\`bg_list\` again after that follow-up notification arrives, or if the user explicitly asks for a fresh status update.\n`,
    };
  });

  // Intercept and block sleep commands in bash while background jobs are running
  pi.on("tool_call", async (event) => {
    if (event.toolName === "bash") {
      const cmd = (event.input as { command?: string })?.command ?? "";
      const running = getRunningJobs();
      if (running.length > 0) {
        const isSleep = /\b(?:sleep|timeout)\s+\d+/i.test(cmd) || /Start-Sleep/i.test(cmd);
        if (isSleep) {
          const runningIds = running.map((j) => j.id).join(", ");
          return {
            block: true,
            reason: `BLOCKED: Do not use 'sleep' to wait for background jobs (${runningIds}). You will be automatically notified with a follow-up message when the job completes. End your turn now so the user can continue chatting.`,
          };
        }
      }
    }
  });

  // Lifecycle listeners to track agent state and prevent waking collision
  pi.on("session_start", async (_event, ctx) => {
    lastContext = ctx;
    ensureLogDir();
    updateStatusWidget(ctx);
  });

  pi.on("agent_start", () => {
    isAgentBusy = true;
  });

  pi.on("turn_start", () => {
    isAgentBusy = true;
  });

  pi.on("input", () => {
    hasUserTurnPending = true;
  });

  pi.on("agent_settled", () => {
    isAgentBusy = false;
    hasUserTurnPending = false;
    flushPendingWakes();
  });

  pi.on("session_shutdown", async () => {
    // Clean up all running background jobs when Pi shuts down
    for (const job of getRunningJobs()) {
      if (job.timeoutHandle) clearTimeout(job.timeoutHandle);
      if (job.pid) killProcessTree(job.pid);
      job.status = "killed";
    }
  });

  // Tool: bg_run
  managed.registerTool({
    name: "bg_run",
    label: "Run Background Command",
    description: "Run a shell command asynchronously in the background. Returns immediately with a job ID so you can keep chatting while it runs. After this call returns: inform the user and END YOUR TURN. Do NOT call bg_status/bg_list right after to check progress, do NOT call sleep, and do NOT loop waiting. The harness wakes you with a follow-up message the instant the job finishes — you cannot and must not try to discover completion yourself.",
    parameters: BgRunParams,
    defaultVisibility: "agent-visible",
    async execute(_toolCallId: string, params: BgRunInput, _signal: AbortSignal, _onUpdate: unknown, ctx: ExtensionContext) {
      lastContext = ctx;
      ensureLogDir();

      jobCounter += 1;
      const id = `bg-${jobCounter}`;
      const logFilePath = join(LOG_BASE_DIR, `${id}.log`);
      const notifyOnFinish = params.notifyOnFinish ?? true;
      const cwd = params.cwd ? params.cwd : ctx.cwd;
      initLogFile(logFilePath, `[Started background job ${id} at ${new Date().toISOString()}]\nCommand: ${params.command}\nCwd: ${cwd}\n\n`);

      const isWin = platform() === "win32";
      const { shell, args } = resolveShell();

      const child = spawn(shell, [...args, params.command], {
        cwd,
        env: { ...process.env, PI_BACKGROUND_JOB: id },
        detached: !isWin,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });

      const job: BackgroundJob = {
        id,
        command: params.command,
        cwd,
        pid: child.pid,
        status: "running",
        startedAt: Date.now(),
        outputBuffer: [],
        logFilePath,
        notifyOnFinish,
        child,
      };

      jobs.set(id, job);

      const appendData = (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        appendToLog(logFilePath, text);
        const lines = text.split(/\r?\n/);
        for (const line of lines) {
          if (line.length > 0) {
            job.outputBuffer.push(line);
            if (job.outputBuffer.length > MAX_BUFFER_LINES) {
              job.outputBuffer.shift();
            }
          }
        }
      };

      child.stdout?.on("data", appendData);
      child.stderr?.on("data", appendData);

      if (params.timeoutSeconds && params.timeoutSeconds > 0) {
        job.timeoutHandle = setTimeout(() => {
          if (job.status === "running") {
            job.status = "timed_out";
            job.endedAt = Date.now();
            if (job.pid) killProcessTree(job.pid);
            appendToLog(logFilePath, `\n[Background job timed out after ${params.timeoutSeconds}s]\n`);
            updateStatusWidget(ctx);
            if (job.notifyOnFinish) {
              const preview = job.outputBuffer.slice(-DEFAULT_TAIL_LINES).join("\n");
              pendingWakes.push(
                `[Background Job ${job.id} TIMED OUT]\nCommand: \`${job.command}\`\nTimed out after ${params.timeoutSeconds}s.\nLog: ${job.logFilePath}\n\nRecent output:\n\`\`\`\n${preview}\n\`\`\``
              );
              flushPendingWakes();
            }
          }
        }, params.timeoutSeconds * 1000);
      }

      child.on("close", (code) => {
        if (job.timeoutHandle) clearTimeout(job.timeoutHandle);
        if (job.status !== "timed_out" && job.status !== "killed") {
          job.status = code === 0 ? "completed" : "failed";
        }
        job.exitCode = code;
        job.endedAt = Date.now();
        const durationSec = ((job.endedAt - job.startedAt) / 1000).toFixed(1);

        updateStatusWidget(ctx);

        if (job.notifyOnFinish) {
          const preview = job.outputBuffer.slice(-DEFAULT_TAIL_LINES).join("\n");
          pendingWakes.push(
            `[Background Job ${job.id} ${job.status.toUpperCase()}]\nCommand: \`${job.command}\`\nExit code: ${code} (took ${durationSec}s)\nLog: ${job.logFilePath}\n\nOutput tail:\n\`\`\`\n${preview || "(no output)"}\n\`\`\``
          );
          flushPendingWakes();
        }
      });

      child.on("error", (err) => {
        job.status = "failed";
        job.endedAt = Date.now();
        appendToLog(logFilePath, `\n[Process spawn error: ${err.message}]\n`);
        updateStatusWidget(ctx);
        if (job.notifyOnFinish) {
          pendingWakes.push(
            `[Background Job ${job.id} ERROR]\nCommand: \`${job.command}\`\nFailed to start: ${err.message}`
          );
          flushPendingWakes();
        }
      });

      updateStatusWidget(ctx);

      const msg = [
        `⚡ Background job started: ${id} (PID ${child.pid ?? "unknown"})`,
        `Command: \`${params.command}\``,
        `Working directory: \`${cwd}\``,
        `Log file: \`${logFilePath}\``,
        `Status: running (chat is unblocked). You will be notified when it completes.`,
      ].join("\n");

      return {
        content: [{ type: "text", text: msg }],
        details: { jobId: id, pid: child.pid, status: "running", logFilePath },
      };
    },
    renderResult(result: any, _options: { expanded?: boolean }, theme: Theme) {
      const details = result.details as { jobId?: string; pid?: number; status?: string } | undefined;
      const text = result.content?.[0];
      const body = text?.type === "text" ? text.text : "";
      if (!details?.jobId) return new Text(body, 0, 0);

      const icon = theme.fg("accent", "⚡");
      return new Text(`${icon} ${theme.bold(details.jobId)} running (PID ${details.pid ?? "?"})\n${body}`, 0, 0);
    },
  });

  // Tool: bg_status
  managed.registerTool({
    name: "bg_status",
    label: "Check Background Job Status",
    description: "Check the status, runtime, and recent output of a background job. Call this only when the user asks for an update, or in direct response to the automatic completion follow-up message — never in a loop or 'just to check up' on a running job. If the result shows status 'running': inform the user and END YOUR TURN immediately. Do NOT call bg_status/bg_list again in this turn, and do NOT call sleep. The harness notifies you automatically the instant the job finishes.",
    parameters: BgStatusParams,
    defaultVisibility: "agent-visible",
    async execute(_toolCallId: string, params: BgStatusInput) {
      const job = jobs.get(params.jobId);
      if (!job) {
        return { content: [{ type: "text", text: `Job '${params.jobId}' not found.` }] };
      }

      const tailCount = params.lines ?? DEFAULT_TAIL_LINES;
      const tailLines = job.outputBuffer.slice(-tailCount).join("\n");
      const durationSec = (
        ((job.endedAt ?? Date.now()) - job.startedAt) /
        1000
      ).toFixed(1);

      const response = [
        `Job: ${job.id} [${job.status.toUpperCase()}]`,
        `Command: \`${job.command}\``,
        `PID: ${job.pid ?? "unknown"}`,
        `Duration: ${durationSec}s`,
        `Exit Code: ${job.exitCode !== undefined && job.exitCode !== null ? job.exitCode : "running"}`,
        `Log File: \`${job.logFilePath}\``,
        ``,
        `Output tail (last ${tailCount} lines):`,
        "```",
        tailLines || "(no output yet)",
        "```",
      ].join("\n");

      return {
        content: [{ type: "text", text: response }],
        details: { jobId: job.id, status: job.status, exitCode: job.exitCode },
      };
    },
  });

  // Tool: bg_list
  managed.registerTool({
    name: "bg_list",
    label: "List Background Jobs",
    description: "List all background jobs and their current statuses. Do NOT use this to poll for completion of a running job. If a job shows 'running': inform the user and END YOUR TURN immediately instead of checking again. The harness delivers a follow-up message automatically the instant a job finishes.",
    parameters: BgListParams,
    defaultVisibility: "agent-visible",
    async execute(_toolCallId: string, params: BgListInput) {
      const filter = params.status?.toLowerCase() ?? "all";
      const allJobs = [...jobs.values()];
      const filtered =
        filter === "all"
          ? allJobs
          : allJobs.filter((j) => j.status === filter);

      if (filtered.length === 0) {
        return { content: [{ type: "text", text: `No background jobs found matching status '${filter}'.` }] };
      }

      const rows = filtered.map((j) => {
        const durationSec = (((j.endedAt ?? Date.now()) - j.startedAt) / 1000).toFixed(0);
        return `- **${j.id}** [${j.status}] PID:${j.pid ?? "?"} (${durationSec}s): \`${j.command}\``;
      });

      return {
        content: [{ type: "text", text: `Background jobs (${filtered.length}):\n${rows.join("\n")}` }],
        details: { total: filtered.length },
      };
    },
  });

  // Tool: bg_kill
  managed.registerTool({
    name: "bg_kill",
    label: "Kill Background Job",
    description: "Terminate a running background job and its process tree.",
    parameters: BgKillParams,
    defaultVisibility: "agent-visible",
    async execute(_toolCallId: string, params: BgKillInput, _signal: AbortSignal, _onUpdate: unknown, ctx: ExtensionContext) {
      const job = jobs.get(params.jobId);
      if (!job) {
        return { content: [{ type: "text", text: `Job '${params.jobId}' not found.` }] };
      }

      if (job.status !== "running") {
        return { content: [{ type: "text", text: `Job '${params.jobId}' is not running (status: ${job.status}).` }] };
      }

      if (job.timeoutHandle) clearTimeout(job.timeoutHandle);
      if (job.pid) killProcessTree(job.pid);
      job.status = "killed";
      job.endedAt = Date.now();
      appendToLog(job.logFilePath, `\n[Process killed by user]\n`);
      updateStatusWidget(ctx);

      return {
        content: [{ type: "text", text: `Successfully killed background job '${job.id}' (PID ${job.pid}).` }],
        details: { jobId: job.id, status: "killed" },
      };
    },
  });

  // Tool: bg_input
  managed.registerTool({
    name: "bg_input",
    label: "Send Input to Background Job",
    description: "Write text to the standard input (stdin) of a running background job.",
    parameters: BgInputParams,
    defaultVisibility: "agent-visible",
    async execute(_toolCallId: string, params: BgInputInput) {
      const job = jobs.get(params.jobId);
      if (!job) {
        return { content: [{ type: "text", text: `Job '${params.jobId}' not found.` }] };
      }

      if (job.status !== "running" || !job.child || !job.child.stdin) {
        return { content: [{ type: "text", text: `Job '${params.jobId}' is not currently running or stdin is closed.` }] };
      }

      try {
        job.child.stdin.write(params.input + "\n");
        return { content: [{ type: "text", text: `Sent input to job '${job.id}'.` }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Failed to write to stdin of '${job.id}': ${message}` }] };
      }
    },
  });

  // Slash command: /jobs
  managed.registerCommand("jobs", {
    description: "Manage background jobs. Usage: /jobs [list|kill <id>|tail <id> [lines]|clear]",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      lastContext = ctx;
      const parts = args.trim().split(/\s+/);
      const action = parts[0]?.toLowerCase() || "list";

      if (action === "list" || action === "") {
        const allJobs = [...jobs.values()];
        if (allJobs.length === 0) {
          ctx.ui.notify("No background jobs recorded.", "info");
          return;
        }

        const lines = allJobs.map((j) => {
          const dur = (((j.endedAt ?? Date.now()) - j.startedAt) / 1000).toFixed(0);
          return `${j.id} [${j.status}] PID:${j.pid ?? "?"} (${dur}s) - ${j.command}`;
        });
        ctx.ui.notify(`Background Jobs:\n${lines.join("\n")}`, "info");
        return;
      }

      if (action === "kill") {
        const targetId = parts[1];
        if (!targetId) {
          ctx.ui.notify("Usage: /jobs kill <jobId>", "warning");
          return;
        }
        const job = jobs.get(targetId);
        if (!job) {
          ctx.ui.notify(`Job '${targetId}' not found.`, "error");
          return;
        }
        if (job.status !== "running") {
          ctx.ui.notify(`Job '${targetId}' is already ${job.status}.`, "info");
          return;
        }
        if (job.timeoutHandle) clearTimeout(job.timeoutHandle);
        if (job.pid) killProcessTree(job.pid);
        job.status = "killed";
        job.endedAt = Date.now();
        updateStatusWidget(ctx);
        ctx.ui.notify(`Killed job ${job.id}.`, "info");
        return;
      }

      if (action === "tail" || action === "log") {
        const targetId = parts[1];
        if (!targetId) {
          ctx.ui.notify("Usage: /jobs tail <jobId> [lines]", "warning");
          return;
        }
        const job = jobs.get(targetId);
        if (!job) {
          ctx.ui.notify(`Job '${targetId}' not found.`, "error");
          return;
        }
        const lineCount = parseInt(parts[2] || "30", 10);
        let output = job.outputBuffer.slice(-lineCount).join("\n");
        if (!output && existsSync(job.logFilePath)) {
          try {
            const raw = readFileSync(job.logFilePath, "utf8");
            output = raw.split(/\r?\n/).slice(-lineCount).join("\n");
          } catch {}
        }
        ctx.ui.notify(`Tail of ${job.id} (${job.command}):\n${output || "(no output)"}`, "info");
        return;
      }

      if (action === "clear") {
        let cleared = 0;
        for (const [id, job] of [...jobs.entries()]) {
          if (job.status !== "running") {
            jobs.delete(id);
            cleared++;
          }
        }
        ctx.ui.notify(`Cleared ${cleared} finished background jobs from memory.`, "info");
        return;
      }

      ctx.ui.notify("Usage: /jobs [list | kill <id> | tail <id> [lines] | clear]", "info");
    },
  });
}
