import { createHash } from "node:crypto";
import { closeSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, realpathSync } from "node:fs";
import { createServer, type Server } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writeAtomicJson } from "../durable-file.mjs";
import type { UsageMetric, QuotaWindow } from "./model.ts";
import type { ProviderReader } from "./readers.ts";
import type { UsageScope } from "./scope.ts";

export const SHARED_USAGE_TTL = 300_000;
export type SharedErrorCode = "unavailable" | "claude-rate-limit" | "canceled" | "scope-changed" | "in-flight" | "storage";
export type SharedObservation =
  | { status: "available"; value: UsageMetric; lastAttempt: number; lastSuccess: number }
  | { status: "error"; errorCode: SharedErrorCode; error: string; value?: UsageMetric; lastAttempt: number; lastSuccess?: number };
type DiskObservation = Omit<Extract<SharedObservation, { status: "error" }>, "error"> | Extract<SharedObservation, { status: "available" }>;
type DiskRecord = { version: 1; key: string; generation: string; identity: UsageScope["identity"]; observation: DiskObservation; nextRefreshAt: number; inFlight: boolean };
export interface SharedCacheDependencies { root?: string; now?: () => number }
const codes = new Set<SharedErrorCode>(["unavailable", "claude-rate-limit", "canceled", "scope-changed", "in-flight", "storage"]);
const hashPattern = /^[a-f0-9]{64}$/;
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const number = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const message = (code: SharedErrorCode): string => code === "claude-rate-limit" ? "Claude usage refresh rate limited" : "usage refresh unavailable";
const failure = (code: SharedErrorCode, lastAttempt: number, previous?: DiskObservation): SharedObservation => ({
  status: "error", errorCode: code, error: message(code), lastAttempt,
  ...(previous?.value === undefined ? {} : { value: previous.value, lastSuccess: previous.lastSuccess }),
});
function boundedObservation(observation: DiskObservation, scope: UsageScope, now: number): DiskObservation {
  if (scope.identity === "known" || observation.value === undefined || (observation.lastSuccess !== undefined && now - observation.lastSuccess < SHARED_USAGE_TTL)) return observation;
  return { status: "error", errorCode: observation.status === "error" ? observation.errorCode : "unavailable", lastAttempt: observation.lastAttempt };
}
function publicObservation(observation: DiskObservation, scope: UsageScope, now: number): SharedObservation {
  const safe = boundedObservation(observation, scope, now);
  return safe.status === "available" ? safe : { ...safe, error: message(safe.errorCode) };
}
const diskObservation = (observation: SharedObservation): DiskObservation => {
  if (observation.status === "available") return observation;
  const { error: _error, ...safe } = observation;
  return safe;
};
function scopeValid(scope: UsageScope): boolean { return hashPattern.test(scope.key) && hashPattern.test(scope.generation) && (scope.identity === "known" || scope.identity === "opaque"); }
function sameScope(a: UsageScope, b: UsageScope): boolean { return a.key === b.key && a.generation === b.generation && a.identity === b.identity; }
function timestamp(v: unknown, now: number, future = 60_000): v is number { return number(v) && v <= now + future; }
function optionalTime(v: unknown, now: number, future?: number): number | undefined {
  if (v === undefined) return undefined;
  if (!timestamp(v, now, future)) throw new Error("Invalid timestamp");
  return v;
}
function normalizeMetric(input: unknown, now: number): UsageMetric {
  if (!object(input)) throw new Error("Invalid metric");
  const amount = (v: unknown): number => { if (!number(v)) throw new Error("Invalid measurement"); return v; };
  const windows = (v: unknown): QuotaWindow[] => {
    if (!Array.isArray(v) || v.length > 16 || new Set(v.map((w: unknown) => object(w) ? w.id : undefined)).size !== v.length) throw new Error("Invalid windows");
    return v.map((w: unknown) => {
      if (!object(w) || typeof w.id !== "string" || !/^(?:5h|week|month|auto|api|[1-9]\d{0,6}m)$/.test(w.id)) throw new Error("Invalid window");
      const label = w.id === "auto" ? "Auto" : w.id === "api" ? "API" : w.id;
      return { id: w.id, label, usedPercent: amount(w.usedPercent), ...(w.resetsAt === undefined ? {} : { resetsAt: optionalTime(w.resetsAt, now, 366 * 86_400_000) }) };
    });
  };
  if (input.kind === "credits") return { kind: "credits", consumed: amount(input.consumed), ...(input.resetsAt === undefined ? {} : { resetsAt: optionalTime(input.resetsAt, now, 366 * 86_400_000) }) };
  if (input.kind === "quota") {
    if (!Array.isArray(input.groups) || !input.groups.length || input.groups.length > 8) throw new Error("Invalid groups");
    const names: Record<string, [string, string]> = { codex: ["Codex", "Codex"], gemini: ["Gemini Models", "AG Gemini"], "third-party": ["Claude and GPT models", "AG Claude/GPT"], cursor: ["Cursor included plan", "Cursor"] };
    return { kind: "quota", groups: input.groups.map((g: unknown) => {
      if (!object(g) || typeof g.id !== "string" || !Object.hasOwn(names, g.id)) throw new Error("Invalid group");
      const [name, shortName] = names[g.id];
      const normalized = windows(g.windows);
      if (!normalized.length) throw new Error("Invalid windows");
      return { id: g.id, name, shortName, windows: normalized };
    }) };
  }
  if (input.kind === "spend") {
    const normalized = windows(input.windows);
    let spend: Extract<UsageMetric, { kind: "spend" }>["spend"];
    if (input.spend !== undefined) {
      const s = input.spend;
      if (!object(s) || typeof s.currency !== "string" || !/^[A-Z]{3}$/.test(s.currency)) throw new Error("Invalid spend");
      spend = { used: amount(s.used), currency: s.currency,
        ...(s.limit === undefined ? {} : { limit: amount(s.limit) }),
        ...(s.usedPercent === undefined ? {} : { usedPercent: amount(s.usedPercent) }),
        ...(typeof s.severity === "string" && ["normal", "warning", "critical", "none", "info", "error"].includes(s.severity) ? { severity: s.severity } : {}) };
    }
    if (!spend && !normalized.length) throw new Error("Invalid spend");
    return { kind: "spend", windows: normalized, ...(spend ? { spend } : {}), ...(input.fetchedAt === undefined ? {} : { fetchedAt: optionalTime(input.fetchedAt, now) }) };
  }
  throw new Error("Invalid metric");
}
function parseRecord(input: unknown, key: string, now: number): DiskRecord | undefined {
  try {
    if (!object(input) || input.version !== 1 || input.key !== key || typeof input.generation !== "string" || !hashPattern.test(input.generation)
      || typeof input.inFlight !== "boolean" || !timestamp(input.nextRefreshAt, now, 30 * 86_400_000) || !object(input.observation)) return undefined;
    if (input.identity !== undefined && input.identity !== "known" && input.identity !== "opaque") return undefined;
    const identity = input.identity === "known" ? "known" : "opaque";
    const o = input.observation;
    if (!timestamp(o.lastAttempt, now) || input.nextRefreshAt < o.lastAttempt) return undefined;
    if (input.inFlight && (o.status !== "error" || o.errorCode !== "in-flight")) return undefined;
    const lastSuccess = optionalTime(o.lastSuccess, now);
    const value = o.value === undefined ? undefined : normalizeMetric(o.value, now);
    let observation: DiskObservation;
    if (o.status === "available" && value !== undefined && lastSuccess !== undefined && !input.inFlight) observation = { status: "available", value, lastAttempt: o.lastAttempt, lastSuccess };
    else if (o.status === "error" && typeof o.errorCode === "string" && codes.has(o.errorCode as SharedErrorCode) && (value === undefined) === (lastSuccess === undefined)) {
      observation = { status: "error", errorCode: o.errorCode as SharedErrorCode, lastAttempt: o.lastAttempt, ...(value === undefined ? {} : { value, lastSuccess }) };
    } else return undefined;
    return { version: 1, key, generation: input.generation, identity, observation,
      nextRefreshAt: observation.status === "available" ? Math.min(input.nextRefreshAt, observation.lastAttempt + SHARED_USAGE_TTL) : input.nextRefreshAt, inFlight: input.inFlight };
  } catch { return undefined; }
}
function readRecord(file: string, key: string, now: number): DiskRecord | undefined {
  let fd: number | undefined;
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || (process.platform !== "win32" && (stat.mode & 0o077) !== 0)) throw new Error("Private cache unavailable");
    if (stat.size > 65_536) return undefined;
    fd = openSync(file, "r");
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.ino !== stat.ino || opened.dev !== stat.dev || (process.platform !== "win32" && (opened.mode & 0o077) !== 0)) throw new Error("Private cache unavailable");
    const bytes = Buffer.alloc(65_537);
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(fd, bytes, size, bytes.length - size, null);
      if (!count) break;
      size += count;
    }
    if (size > 65_536) return undefined;
    let parsed: unknown;
    try { parsed = JSON.parse(bytes.toString("utf8", 0, size)); } catch { return undefined; }
    return parseRecord(parsed, key, now);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  } finally { if (fd !== undefined) closeSync(fd); }
}
async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
async function bind(port: number, signal: AbortSignal): Promise<Server | undefined> {
  signal.throwIfAborted();
  const server = createServer((socket) => socket.destroy());
  try {
    await new Promise<void>((resolve, reject) => {
      const error = (reason: Error) => { server.removeListener("listening", ready); reject(reason); };
      const ready = () => { server.removeListener("error", error); resolve(); };
      server.once("error", error);
      server.once("listening", ready);
      server.listen({ host: "127.0.0.1", port, exclusive: true });
    });
    if (signal.aborted) { await close(server); signal.throwIfAborted(); }
    return server;
  } catch (error) {
    if (server.listening) await close(server);
    if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") return undefined;
    throw error;
  }
}
export class SharedUsageCache {
  private root: string | undefined;
  private now: () => number;
  constructor(deps: SharedCacheDependencies = {}) { this.root = deps.root; this.now = deps.now ?? Date.now; }
  async read(reader: ProviderReader, signal: AbortSignal): Promise<SharedObservation> {
    let lock: Server | undefined;
    try {
      signal.throwIfAborted();
      if (!reader.scope) return failure("unavailable", this.now());
      const scope = { ...await reader.scope() };
      if (!scopeValid(scope)) return failure("unavailable", this.now());
      let root = path.resolve(this.root ?? path.join(getAgentDir(), "provider-usage", "v1"));
      mkdirSync(root, { recursive: true, mode: 0o700 });
      const directory = lstatSync(root);
      if (!directory.isDirectory() || (process.platform !== "win32" && (directory.mode & 0o077) !== 0)) throw new Error("Private cache unavailable");
      root = realpathSync(root);
      const file = path.join(root, `${scope.key}.json`);
      const port = 49152 + createHash("sha256").update(root + "\0" + scope.key).digest().readUInt32BE(0) % 16384;
      let record: DiskRecord | undefined;
      for (;;) {
        signal.throwIfAborted();
        record = readRecord(file, scope.key, this.now());
        if (record && !record.inFlight && record.generation === scope.generation && record.identity === scope.identity && record.nextRefreshAt > this.now()) return publicObservation(record.observation, scope, this.now());
        lock = await bind(port, signal);
        if (lock) break;
        await delay(100, undefined, { signal });
      }
      signal.throwIfAborted();
      if (!sameScope(scope, await reader.scope())) return failure("scope-changed", this.now());
      record = readRecord(file, scope.key, this.now());
      const matching = record?.generation === scope.generation && record.identity === scope.identity;
      if (record && record.nextRefreshAt > this.now() && (matching || record.observation.status === "error" || record.inFlight)) {
        return matching ? publicObservation(record.observation, scope, this.now()) : failure("scope-changed", record.observation.lastAttempt);
      }
      const lastAttempt = this.now();
      const previous = matching && record ? boundedObservation(record.observation, scope, this.now()) : undefined;
      const marker: DiskRecord = { version: 1, key: scope.key, generation: scope.generation, identity: scope.identity,
        observation: diskObservation(failure("in-flight", lastAttempt, previous)), nextRefreshAt: lastAttempt + SHARED_USAGE_TTL, inFlight: true };
      writeAtomicJson(file, marker);
      let observation: SharedObservation;
      let retryMs = SHARED_USAGE_TTL;
      try {
        signal.throwIfAborted();
        const value = normalizeMetric(await reader.read(signal), this.now());
        observation = { status: "available", value, lastAttempt, lastSuccess: this.now() };
      } catch (error) {
        const code = error instanceof Error && error.message === "Claude usage refresh rate limited" ? "claude-rate-limit" : signal.aborted ? "canceled" : "unavailable";
        observation = failure(code, lastAttempt, previous);
        if (object(error) && number(error.retryAfterMs)) retryMs = Math.max(retryMs, Math.min(error.retryAfterMs, 30 * 86_400_000));
      }
      // Await the reader's cleanup before releasing the OS lock, even on abort.
      if (!sameScope(scope, await reader.scope())) return failure("scope-changed", lastAttempt);
      if (signal.aborted) return publicObservation(diskObservation(failure("canceled", lastAttempt, previous)), scope, this.now());
      const safe = boundedObservation(diskObservation(observation), scope, this.now());
      writeAtomicJson(file, { version: 1, key: scope.key, generation: scope.generation, identity: scope.identity, observation: safe,
        nextRefreshAt: observation.status === "available" ? lastAttempt + SHARED_USAGE_TTL : this.now() + retryMs, inFlight: false } satisfies DiskRecord);
      return publicObservation(safe, scope, this.now());
    } catch { return failure(signal.aborted ? "canceled" : "storage", this.now()); }
    finally { if (lock) await close(lock); }
  }
}
