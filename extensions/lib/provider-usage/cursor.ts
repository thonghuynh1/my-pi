import { open } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

// Source-verified against Cursor Agent 2026.10.16-e3cb207; never import its entrypoint.
const ENDPOINT = "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage";
const FILE_LIMIT = 65_536;
class SafeError extends Error {}
const fail = (message: string): never => { throw new SafeError(message); };
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
export interface CursorUsageDependencies {
  fetch?: typeof globalThis.fetch;
  readFile?: (file: string, signal: AbortSignal) => Promise<string>;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
  now?: () => number;
  timeoutMs?: number;
  maxResponseBytes?: number;
}
async function boundedFile(file: string, signal: AbortSignal): Promise<string> {
  const handle = await open(file, "r");
  try {
    if (!(await handle.stat()).isFile()) fail("Cursor credential source unavailable");
    const buffer = Buffer.alloc(FILE_LIMIT + 1);
    let size = 0;
    while (size < buffer.length) {
      signal.throwIfAborted();
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > FILE_LIMIT) fail("Cursor credential source unavailable");
    return buffer.toString("utf8", 0, size);
  } finally { await handle.close(); }
}
function parseFile(text: string): Record<string, unknown> {
  if (Buffer.byteLength(text) > FILE_LIMIT) fail("Cursor credential source unavailable");
  const data: unknown = JSON.parse(text);
  if (!record(data)) return fail("Cursor credential source unavailable");
  return data;
}
function accessToken(auth: Record<string, unknown>, now: number): string {
  const token = auth.accessToken;
  if (typeof token !== "string" || token.length > 32_768 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    return fail("Cursor existing login unavailable");
  }
  const claims: unknown = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  // The CLI treats tokens within five minutes of expiry as unavailable.
  if (!record(claims) || typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp * 1000 - now < 300_000) {
    return fail("Cursor existing login unavailable or expired");
  }
  return token;
}
// Proto field type 3 is signed int64: JSON uses decimal strings, not int32s.
function int64(value: unknown): value is number | string {
  if (typeof value === "number") return Number.isSafeInteger(value);
  if (typeof value !== "string" || !/^-?(?:0|[1-9]\d{0,18})$/.test(value)) return false;
  const n = BigInt(value);
  return n >= -9_223_372_036_854_775_808n && n <= 9_223_372_036_854_775_807n;
}
function usageSchema(raw: unknown): unknown {
  if (!record(raw)) return fail("Cursor usage schema unavailable");
  const result: Record<string, unknown> = {};
  for (const key of ["billingCycleStart", "billingCycleEnd"]) {
    const v = raw[key];
    if (v === undefined) continue;
    if (!int64(v)) return fail("Cursor usage schema unavailable");
    result[key] = v;
  }
  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== "boolean") return fail("Cursor usage schema unavailable");
    result.enabled = raw.enabled;
  }
  let measurements = 0;
  for (const [key, fields] of [
    ["planUsage", ["totalSpend", "includedSpend", "bonusSpend", "remaining", "limit", "autoSpend", "apiSpend", "autoLimit", "apiLimit", "autoPercentUsed", "apiPercentUsed", "totalPercentUsed"]],
    ["spendLimitUsage", ["totalSpend", "pooledLimit", "pooledUsed", "pooledRemaining", "individualLimit", "individualUsed", "individualRemaining", "overallLimit", "overallUsed", "overallRemaining"]],
  ] as const) {
    const source = raw[key];
    if (source === undefined) continue;
    if (!record(source)) return fail("Cursor usage schema unavailable");
    const extras = key === "planUsage" ? { remainingBonus: "boolean", bonusTooltip: "string" } : { limitType: "string" };
    for (const [field, type] of Object.entries(extras)) {
      if (source[field] !== undefined && typeof source[field] !== type) return fail("Cursor usage schema unavailable");
    }
    // Empty proto3 messages mean zero usage; unknown-only objects prove nothing.
    const known = new Set<string>([...fields, ...Object.keys(extras)]);
    if (Object.keys(source).length && !Object.keys(source).some((field) => known.has(field))) return fail("Cursor usage schema unavailable");
    const selected: Record<string, number | string> = {};
    for (const field of fields) {
      const v = source[field];
      if (v === undefined) continue;
      if (field === "pooledLimit" || field === "pooledRemaining") {
        if (!int64(v)) return fail("Cursor usage schema unavailable");
        selected[field] = v;
      } else if (typeof v === "number" && Number.isFinite(v) &&
        (field.endsWith("PercentUsed") || (Number.isInteger(v) && v >= -2_147_483_648 && v <= 2_147_483_647))) selected[field] = v;
      else return fail("Cursor usage schema unavailable");
      measurements++;
    }
    // Restore only the nonoptional proto3 scalars, whose zero defaults are
    // omitted from JSON, after validating a present usage message.
    const defaults = key === "planUsage"
      ? ["totalSpend", "includedSpend", "bonusSpend", "remaining", "limit"]
      : ["totalSpend", "individualUsed", "individualRemaining"];
    for (const field of defaults) {
      if (selected[field] === undefined) { selected[field] = 0; measurements++; }
    }
    result[key] = selected;
  }
  if (!measurements) return fail("Cursor usage schema unavailable");
  // Drop all messages and identity data; retain only source-verified usage fields.
  return result;
}
async function responseJson(response: Response, limit: number, signal: AbortSignal): Promise<unknown> {
  if (response.status !== 200 || response.redirected) return fail("Cursor usage request unavailable");
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) return fail("Cursor usage response unavailable");
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) return fail("Cursor usage response exceeded safety limit");
  if (!response.body) return fail("Cursor usage response unavailable");
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) return fail("Cursor usage response exceeded safety limit");
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size)));
  } finally { signal.removeEventListener("abort", abort); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function createCursorUsageReader(deps: CursorUsageDependencies = {}): (signal: AbortSignal) => Promise<unknown> {
  return async (signal) => {
    if (signal.aborted) throw new Error("Cursor usage read canceled");
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, deps.timeoutMs ?? 15_000);
    let rejectAbort!: () => void;
    const canceled = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(new SafeError(timedOut ? "Cursor usage read timed out" : "Cursor usage read canceled"));
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
    });
    const work = async () => {
      const env = deps.env ?? process.env;
      const platform = deps.platform ?? process.platform;
      const home = deps.home ?? homedir();
      // Default macOS store is Keychain. Never fall back to a potentially stale file.
      if (env.AGENT_CLI_CREDENTIAL_STORE === "memory" || (platform === "darwin" && env.AGENT_CLI_CREDENTIAL_STORE !== "file")) return fail("Cursor credential store unsupported");
      const paths = platform === "win32" ? path.win32 : path.posix;
      const authPath = platform === "win32"
        ? paths.join(env.APPDATA || paths.join(home, "AppData", "Roaming"), "Cursor", "auth.json")
        : platform === "darwin" ? paths.join(home, ".cursor", "auth.json")
          : paths.join(env.XDG_CONFIG_HOME || paths.join(home, ".config"), "cursor", "auth.json");
      const read = deps.readFile ?? boundedFile;
      const token = accessToken(parseFile(await read(authPath, controller.signal)), (deps.now ?? Date.now)());
      controller.signal.throwIfAborted();
      const configDir = env.CURSOR_CONFIG_DIR?.trim() ? env.CURSOR_CONFIG_DIR
        : env.XDG_CONFIG_HOME?.trim() ? paths.join(env.XDG_CONFIG_HOME, "cursor") : paths.join(home, ".cursor");
      let team: number | undefined;
      try {
        const config = parseFile(await read(paths.join(configDir, "cli-config.json"), controller.signal));
        if (config.authInfo !== undefined) {
          if (!record(config.authInfo)) return fail("Cursor active team unavailable");
          const value = config.authInfo.activeTeamId;
          if (value !== undefined) {
            if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return fail("Cursor active team unavailable");
            // Zero means no selected team; the CLI omits its header.
            if (value > 0) team = value;
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
      }
      controller.signal.throwIfAborted();
      const headers: Record<string, string> = {
        authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json",
        "connect-protocol-version": "1", "x-cursor-client-type": "cli", "x-ghost-mode": "true",
        "x-cursor-client-version": "cli-2026.10.16-e3cb207",
      };
      if (team !== undefined) headers["x-cursor-team-id"] = String(team);
      const response = await (deps.fetch ?? globalThis.fetch)(ENDPOINT, {
        method: "POST", headers, body: "{}", redirect: "error", credentials: "omit", signal: controller.signal,
      });
      try { return usageSchema(await responseJson(response, deps.maxResponseBytes ?? 262_144, controller.signal)); }
      finally { void response.body?.cancel().catch(() => {}); }
    };
    try {
      if (signal.aborted) controller.abort();
      return await Promise.race([work(), canceled]);
    } catch (error) {
      throw new Error(error instanceof SafeError ? error.message : "Cursor usage unavailable; check existing CLI login");
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      controller.signal.removeEventListener("abort", rejectAbort);
      controller.abort();
    }
  };
}
export const readCursorUsage: (signal: AbortSignal) => Promise<unknown> = createCursorUsageReader();
