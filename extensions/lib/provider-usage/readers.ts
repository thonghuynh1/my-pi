import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { usageScope, type UsageScope, type ScopeDependencies } from "./scope.ts";
import { createCursorUsageReader } from "./cursor.ts";
import { createCodexUsageReader } from "./codex.ts";
import { ClaudeUsageError, readClaudeUsageAt } from "./claude.ts";
import { claudeProfiles, type ClaudeProfileMap } from "../claude-profiles.ts";
import { parseAntigravity, parseClaude, parseCodex, parseCopilot, parseCursor, type ProviderId, type UsageMetric } from "./model.ts";

export class UsageReadError extends Error {}
export type ProcessRequest = { command: "codex" | "agy" | "gh" | "claude"; args: readonly string[]; protocol?: "codex" | "claude"; env?: Record<string, string | undefined> };
export type ProcessRunner = (request: ProcessRequest, signal: AbortSignal) => Promise<unknown>;
export type ProviderReader = { id: ProviderId; name: string; experimental?: boolean; scope?(): Promise<UsageScope>; read(signal: AbortSignal): Promise<UsageMetric> };
export const CODEX_INITIALIZE = { id: 1, method: "initialize", params: { clientInfo: { name: "provider_usage", title: "Provider Usage", version: "0.1.0" } } };
export const COPILOT_FIELDS = "{quota_snapshots: {premium_interactions: {credits_used: .quota_snapshots.premium_interactions.credits_used}}, quota_reset_date_utc: .quota_reset_date_utc}";
export type ClaudeUsageAtReader = (run: ProcessRunner, signal: AbortSignal, configDir: string) => Promise<unknown>;
export function providerReaders(run: ProcessRunner = runProcess, cursorRead: ((signal: AbortSignal) => Promise<unknown>) | undefined = undefined, claudeReadAt: ClaudeUsageAtReader = readClaudeUsageAt, profiles: ClaudeProfileMap = claudeProfiles(), scopeDependencies: ScopeDependencies = {}): ProviderReader[] {
  const readCodex = createCodexUsageReader({ apiKey: scopeDependencies.codexApiKey,
    fallback: (signal) => run({ command: "codex", args: ["app-server"], protocol: "codex" }, signal) });
  const readCursor = cursorRead ?? createCursorUsageReader({ apiKey: scopeDependencies.cursorApiKey,
    env: scopeDependencies.env, home: scopeDependencies.home, platform: scopeDependencies.platform });
  const claudeReader = (id: "claude-work" | "claude-personal", name: string, configDir: string): ProviderReader => ({
    id, name, experimental: true, scope: usageScope(id, configDir, scopeDependencies), read: async (signal) => {
      try {
        return parseClaude(await claudeReadAt(run, signal, configDir));
      } catch (error) {
        if (error instanceof UsageReadError) throw error;
        if (error instanceof ClaudeUsageError) throw new UsageReadError(error.message);
        throw new UsageReadError(`${name} usage unavailable`);
      }
    },
  });
  return [
    { id: "codex", scope: usageScope("codex", undefined, scopeDependencies), name: "Codex", read: async (signal) => {
      try { return parseCodex(await readCodex(signal)); }
      catch (error) {
        if (error instanceof UsageReadError) throw error;
        throw new UsageReadError("Codex usage unavailable; check Pi Codex OAuth login or existing CLI login");
      }
    } },
    { id: "antigravity", scope: usageScope("antigravity", undefined, scopeDependencies), name: "Antigravity", read: async (signal) => parseAntigravity(await run({ command: "agy", args: ["-p", "/usage", "--output-format", "json"] }, signal)) },
    { id: "copilot", scope: usageScope("copilot", undefined, scopeDependencies), name: "GitHub Copilot", experimental: true, read: async (signal) => parseCopilot(await run({ command: "gh", args: ["api", "/copilot_internal/user", "--jq", COPILOT_FIELDS] }, signal)) },
    { id: "cursor", scope: usageScope("cursor", undefined, scopeDependencies), name: "Cursor", experimental: true, read: async (signal) => {
      let raw: unknown;
      try { raw = await readCursor(signal); }
      catch { throw new UsageReadError("Cursor usage unavailable; check Pi Cursor API key or existing CLI login (file store required for CLI)"); }
      return parseCursor(raw);
    } },
    claudeReader("claude-work", profiles.work.name, profiles.work.configDir),
    claudeReader("claude-personal", profiles.personal.name, profiles.personal.configDir),
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
function mergeRequestEnv(overlay: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const next = { ...process.env };
  for (const [key, value] of Object.entries(overlay)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next;
}
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
type ClaudeFreshness =
  | { kind: "waiting"; requested: boolean }
  | { kind: "fresh" }
  | { kind: "failed"; reason: "rate-limit" | "refresh" | "snapshot" };
function claudeFreshness(state: ClaudeFreshness, line: string): ClaudeFreshness {
  if (state.kind === "failed") return state;
  const text = line.replace(/^(?:\d{4}-\d{2}-\d{2}T[\d:.]+Z )?\[(?:DEBUG|ERROR)\] /, "");
  if (/^fetchUtilization: 429 remembered for this bearer; not asking again for \d+s$/.test(text)
    || /^fetchUtilization: \/api\/oauth\/usage replayed \u2014 the endpoint answered 429 \d+s ago; not asked again for \d+s$/.test(text)) {
    return { kind: "failed", reason: "rate-limit" };
  }
  if (/^Failed to load usage data:/.test(text)) {
    return { kind: "failed", reason: /status code 429\b/.test(text) ? "rate-limit" : "refresh" };
  }
  if (text === "Usage fetch returned a fieldless or non-object body (in-band error)") return { kind: "failed", reason: "refresh" };
  const snapshot = /^Usage read answered from a snapshot (\d+(?:\.\d+)?)s old; endpoint not asked$/.exec(text);
  if (snapshot) return Number(snapshot[1]) <= 60 ? { kind: "fresh" } : { kind: "failed", reason: "snapshot" };
  if (/^fetchUtilization: GET \/api\/oauth\/usage \(attempt [1-9]\d*\)$/.test(text)) return { kind: "waiting", requested: true };
  if (state.kind === "waiting" && state.requested && /^fetchUtilization: 200 after [1-9]\d* attempt\(s\)(?: \(401\u2192refresh\u2192retry succeeded\))?$/.test(text)) return { kind: "fresh" };
  return state;
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
        ...(request.env === undefined ? {} : { env: mergeRequestEnv(request.env) }),
      });
    } catch (error) {
      throw error instanceof UsageReadError ? error : new UsageReadError("CLI could not be started");
    }
    return new Promise<unknown>((resolve, reject) => {
      let settled = false;
      let buffer = "";
      let bytes = 0;
      let initialized = false;
      let claudeStage: "initialize" | "usage" = "initialize";
      let freshness: ClaudeFreshness = { kind: "waiting", requested: false };
      let claudePayload: { kind: "none" } | { kind: "received"; value: Record<string, unknown> } = { kind: "none" };
      const stderrDecoder = new StringDecoder("utf8");
      let stderrBuffer = "";
      let stderrEnded = false;
      let draining = false;
      let terminated = false;
      let cleanup: Promise<void> | undefined;
      const terminate = () => cleanup ??= (deps.terminate ?? terminateTree)(child).catch(() => {});
      const finish = (error?: UsageReadError, value?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        buffer = "";
        stderrBuffer = "";
        claudePayload = { kind: "none" };
        void terminate().then(() => error ? reject(error) : resolve(value));
      };
      const completeClaude = () => {
        if (settled || claudePayload.kind !== "received") return;
        if (freshness.kind === "failed") {
          finish(new UsageReadError(freshness.reason === "rate-limit" ? "Claude usage refresh rate limited"
            : freshness.reason === "snapshot" ? "Claude usage refresh unavailable; snapshot too old" : "Claude usage refresh failed"));
          return;
        }
        if (freshness.kind !== "fresh" || stderrBuffer) return;
        // Stop once we have both pieces, but drain stderr before publishing: a 200
        // may be followed by an in-band error, even in a later stream callback.
        if (!draining) {
          draining = true;
          void terminate().then(() => { terminated = true; completeClaude(); });
        }
        if (terminated && stderrEnded) finish(undefined, claudePayload.value);
      };
      const readDiagnostic = (line: string) => {
        freshness = claudeFreshness(freshness, line.replace(/\r$/, ""));
      };
      const abort = () => finish(new UsageReadError("Read canceled"));
      const timer = setTimeout(() => finish(new UsageReadError("Read timed out (30 seconds)")), deps.timeoutMs ?? 30_000);
      signal.addEventListener("abort", abort, { once: true });
      child.once("error", (error: NodeJS.ErrnoException) => finish(new UsageReadError(error.code === "ENOENT" ? "CLI not installed or not on PATH" : "CLI could not be started")));
      child.stdin.on("error", () => finish(new UsageReadError("CLI input closed")));
      child.stdout.setEncoding("utf8");
      child.stderr.on("data", (chunk: Buffer) => {
        if (settled) return;
        bytes += chunk.length;
        if (bytes > (deps.maxOutputBytes ?? 1_048_576)) { finish(new UsageReadError("CLI output exceeded safety limit")); return; }
        if (request.protocol !== "claude" || claudeStage !== "usage") return;
        stderrBuffer += stderrDecoder.write(chunk);
        let newline: number;
        while ((newline = stderrBuffer.indexOf("\n")) >= 0) {
          if (newline > 8192) { finish(new UsageReadError("Claude usage refresh diagnostics exceeded safety limit")); return; }
          readDiagnostic(stderrBuffer.slice(0, newline));
          stderrBuffer = stderrBuffer.slice(newline + 1);
        }
        if (stderrBuffer.length > 8192) { finish(new UsageReadError("Claude usage refresh diagnostics exceeded safety limit")); return; }
        completeClaude();
      });
      const endDiagnostics = () => {
        if (request.protocol !== "claude" || settled || stderrEnded) return;
        stderrBuffer += stderrDecoder.end();
        if (claudeStage === "usage" && stderrBuffer) readDiagnostic(stderrBuffer);
        stderrBuffer = "";
        stderrEnded = true;
        completeClaude();
      };
      child.stderr.once("end", endDiagnostics);
      child.stderr.once("close", endDiagnostics);
      const send = (message: unknown) => { if (!settled) child.stdin.write(JSON.stringify(message) + "\n"); };
      child.stdout.on("data", (chunk: string) => {
        if (settled) return;
        bytes += Buffer.byteLength(chunk);
        if (bytes > (deps.maxOutputBytes ?? 1_048_576)) { finish(new UsageReadError("CLI output exceeded safety limit")); return; }
        buffer += chunk;
        if (!request.protocol) return;
        let newline: number;
        while (!settled && (newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          try {
            const parsed: unknown = JSON.parse(line);
            const message = record(parsed);
            if (request.protocol === "claude") {
              if (message?.type === "control_request" && typeof message.request_id === "string" && record(message.request).subtype === "can_use_tool") {
                send({ type: "control_response", response: {
                  subtype: "success", request_id: message.request_id,
                  response: { behavior: "deny", message: "Usage reads do not permit tool execution" },
                } });
              } else if (message?.type === "control_response") {
                const response = record(message.response);
                const expectedId = claudeStage === "initialize" ? "usage-init" : "usage-read";
                if (response?.request_id !== expectedId) continue;
                if (response.subtype !== "success" || response.response === null || typeof response.response !== "object" || Array.isArray(response.response)) {
                  finish(new UsageReadError("Claude usage unavailable; check CLI login"));
                } else if (claudeStage === "initialize") {
                  claudeStage = "usage";
                  send({ type: "control_request", request_id: "usage-read", request: { subtype: "get_usage", skip_behaviors: true } });
                } else {
                  const payload = record(response.response);
                  if (payload.rate_limits_available !== true || payload.rate_limits === null
                    || typeof payload.rate_limits !== "object" || Array.isArray(payload.rate_limits)) finish(undefined, payload);
                  else if (claudePayload.kind === "none") {
                    claudePayload = { kind: "received", value: payload };
                    completeClaude();
                  }
                }
              }
            } else if (message.id === 1 && !initialized) {
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
        if (request.protocol === "claude" && draining) { endDiagnostics(); completeClaude(); return; }
        if (code !== 0 || request.protocol !== undefined) { finish(new UsageReadError("CLI read failed; check existing CLI login")); return; }
        try { finish(undefined, JSON.parse(buffer)); } catch { finish(new UsageReadError("CLI returned invalid JSON")); }
      });
      if (signal.aborted) abort();
      else if (request.protocol === "codex") send(CODEX_INITIALIZE);
      else if (request.protocol === "claude") send({ type: "control_request", request_id: "usage-init", request: { subtype: "initialize" } });
      else child.stdin.end();
    });
  };
}
export const runProcess: ProcessRunner = createProcessRunner();
