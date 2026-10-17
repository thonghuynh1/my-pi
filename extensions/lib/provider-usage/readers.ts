import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { readCursorUsage } from "./cursor.ts";
import { parseAntigravity, parseCodex, parseCopilot, parseCursor, type ProviderId, type UsageMetric } from "./model.ts";

export class UsageReadError extends Error {}
export type ProcessRequest = { command: "codex" | "agy" | "gh"; args: readonly string[]; protocol?: "codex" };
export type ProcessRunner = (request: ProcessRequest, signal: AbortSignal) => Promise<unknown>;
export type ProviderReader = { id: ProviderId; name: string; experimental?: boolean; read(signal: AbortSignal): Promise<UsageMetric> };
export const CODEX_INITIALIZE = { id: 1, method: "initialize", params: { clientInfo: { name: "provider_usage", title: "Provider Usage", version: "0.1.0" } } };
export const COPILOT_FIELDS = "{quota_snapshots: {premium_interactions: {credits_used: .quota_snapshots.premium_interactions.credits_used}}, quota_reset_date_utc: .quota_reset_date_utc}";
export function providerReaders(run: ProcessRunner = runProcess, cursorRead = readCursorUsage): ProviderReader[] {
  return [
    { id: "codex", name: "Codex", read: async (signal) => parseCodex(await run({ command: "codex", args: ["app-server"], protocol: "codex" }, signal)) },
    { id: "antigravity", name: "Antigravity", read: async (signal) => parseAntigravity(await run({ command: "agy", args: ["-p", "/usage", "--output-format", "json"] }, signal)) },
    { id: "copilot", name: "GitHub Copilot", experimental: true, read: async (signal) => parseCopilot(await run({ command: "gh", args: ["api", "/copilot_internal/user", "--jq", COPILOT_FIELDS] }, signal)) },
    { id: "cursor", name: "Cursor", experimental: true, read: async (signal) => {
      let raw: unknown;
      try { raw = await cursorRead(signal); }
      catch { throw new UsageReadError("Cursor usage unavailable; check existing CLI login (file store required)"); }
      return parseCursor(raw);
    } },
  ];
}

export type Launch = { file: string; args: string[]; windowsVerbatimArguments?: boolean };
// Resolve npm .cmd shims explicitly: Node cannot spawn them directly on Windows.
export function resolveLaunch(request: ProcessRequest, platform = process.platform, env = process.env, exists = existsSync): Launch {
  if (platform !== "win32") return { file: request.command, args: [...request.args] };
  let executable: string | undefined;
  const directories = (env.PATH ?? env.Path ?? "").split(";");
  for (const dir of directories) {
    if (!dir) continue;
    for (const extension of [".exe", ".cmd", ".bat"]) {
      const candidate = path.win32.join(dir.replace(/^"|"$/g, ""), request.command + extension);
      if (exists(candidate)) { executable = candidate; break; }
    }
    if (executable) break;
  }
  if (!executable) throw new UsageReadError("CLI not installed or not on PATH");
  if (/\.(cmd|bat)$/i.test(executable)) {
    const quote = (s: string): string => {
      if (/["%!^&|<>\r\n]/.test(s)) throw new UsageReadError("CLI path cannot be launched safely");
      return `"${s}"`;
    };
    return { file: env.ComSpec ?? "C:/Windows/System32/cmd.exe", args: ["/d", "/s", "/c", `"${[executable, ...request.args].map(quote).join(" ")}"`], windowsVerbatimArguments: true };
  }
  return { file: executable, args: [...request.args] };
}

export interface ProcessDependencies {
  launch?: (request: ProcessRequest) => Launch;
  spawn?: (launch: Launch) => ChildProcessWithoutNullStreams;
  terminate?: (child: ChildProcessWithoutNullStreams) => Promise<void>;
  timeoutMs?: number;
  maxOutputBytes?: number;
}
export interface TreeDependencies {
  platform?: NodeJS.Platform;
  taskkill?: (pid: number) => ReturnType<typeof spawn>;
  killGroup?: (pid: number) => void;
  after?: (callback: () => void, ms: number) => unknown;
  cancelAfter?: (handle: unknown) => void;
}
export function createTreeTerminator(deps: TreeDependencies = {}): (child: ChildProcessWithoutNullStreams) => Promise<void> {
  return async (child) => {
    child.stdin.destroy();
    if (!child.pid) return;
    if ((deps.platform ?? process.platform) === "win32") {
      await new Promise<void>((resolve) => {
        const killer = deps.taskkill ? deps.taskkill(child.pid!)
          : spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
        let finished = false;
        const cancel = deps.cancelAfter ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
        const finish = () => {
          if (finished) return;
          finished = true;
          cancel(timer);
          child.kill();
          resolve();
        };
        const timer = (deps.after ?? setTimeout)(() => { killer.kill(); finish(); }, 1000);
        killer.once("error", finish);
        killer.once("exit", finish);
      });
    } else {
      try { (deps.killGroup ?? ((pid) => process.kill(-pid, "SIGKILL")))(child.pid); }
      catch { child.kill("SIGKILL"); }
    }
  };
}
const terminateTree = createTreeTerminator();
export function createProcessRunner(deps: ProcessDependencies = {}): ProcessRunner {
  return async (request, signal) => {
    if (signal.aborted) throw new UsageReadError("Read canceled");
    let child: ChildProcessWithoutNullStreams;
    try {
      const launch = (deps.launch ?? resolveLaunch)(request);
      child = deps.spawn ? deps.spawn(launch) : spawn(launch.file, launch.args, {
        windowsHide: true, windowsVerbatimArguments: launch.windowsVerbatimArguments,
        detached: process.platform !== "win32", stdio: "pipe",
      });
    } catch (error) {
      throw error instanceof UsageReadError ? error : new UsageReadError("CLI could not be started");
    }
    return new Promise<unknown>((resolve, reject) => {
      let settled = false;
      let buffer = "";
      let bytes = 0;
      let initialized = false;
      const finish = (error?: UsageReadError, value?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        buffer = "";
        void (deps.terminate ?? terminateTree)(child).catch(() => {}).then(() => error ? reject(error) : resolve(value));
      };
      const abort = () => finish(new UsageReadError("Read canceled"));
      const timer = setTimeout(() => finish(new UsageReadError("Read timed out (30 seconds)")), deps.timeoutMs ?? 30_000);
      signal.addEventListener("abort", abort, { once: true });
      child.once("error", (error: NodeJS.ErrnoException) => finish(new UsageReadError(error.code === "ENOENT" ? "CLI not installed or not on PATH" : "CLI could not be started")));
      child.stdin.on("error", () => finish(new UsageReadError("CLI input closed")));
      child.stdout.setEncoding("utf8");
      child.stderr.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > (deps.maxOutputBytes ?? 1_048_576)) finish(new UsageReadError("CLI output exceeded safety limit"));
      });
      const send = (message: unknown) => { if (!settled) child.stdin.write(JSON.stringify(message) + "\n"); };
      child.stdout.on("data", (chunk: string) => {
        if (settled) return;
        bytes += Buffer.byteLength(chunk);
        if (bytes > (deps.maxOutputBytes ?? 1_048_576)) { finish(new UsageReadError("CLI output exceeded safety limit")); return; }
        buffer += chunk;
        if (request.protocol !== "codex") return;
        let newline: number;
        while (!settled && (newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          try {
            const message = JSON.parse(line);
            if (message.id === 1 && !initialized) {
              if (message.error || !message.result) { finish(new UsageReadError("Codex initialization failed; check CLI login")); return; }
              initialized = true;
              send({ method: "initialized" });
              send({ id: 2, method: "account/rateLimits/read" });
            } else if (message.id === 2 && initialized) {
              if (message.error || !message.result) finish(new UsageReadError("Codex usage unavailable; check CLI login"));
              else finish(undefined, message.result);
            }
          } catch { finish(new UsageReadError("CLI returned invalid JSON")); }
        }
      });
      child.once("close", (code) => {
        if (settled) return;
        if (code !== 0 || request.protocol === "codex") { finish(new UsageReadError("CLI read failed; check existing CLI login")); return; }
        try { finish(undefined, JSON.parse(buffer)); } catch { finish(new UsageReadError("CLI returned invalid JSON")); }
      });
      if (signal.aborted) abort();
      else if (request.protocol === "codex") send(CODEX_INITIALIZE);
      else child.stdin.end();
    });
  };
}
export const runProcess: ProcessRunner = createProcessRunner();
