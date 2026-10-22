import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { CLAUDE_USAGE_REQUEST, claudeConfigFile, readClaudeUsage, readClaudeUsageAt } from "../lib/provider-usage/claude.ts";
import { compactFooterRows, detailText, footerRows, parseClaude, type ProviderState } from "../lib/provider-usage/model.ts";
import { providerReaders, type ProcessRequest } from "../lib/provider-usage/readers.ts";

const signal = () => new AbortController().signal;
const localUsage = { type: "result", is_error: false, local_command: "usage", num_turns: 0, total_cost_usd: 0 };
// Sanitized shape of a real enterprise usage-based seat cache.
const enterprise = {
  fetchedAtMs: 1792385880305,
  accountUuid: "secret-account",
  utilization: {
    five_hour: null, seven_day: null, seven_day_opus: null,
    extra_usage: { is_enabled: true, monthly_limit: 50000, used_credits: 40690, utilization: 81.38, currency: "USD", decimal_places: 2 },
    limits: [],
    spend: {
      used: { amount_minor: 40690, currency: "USD", exponent: 2 },
      limit: { amount_minor: 50000, currency: "USD", exponent: 2 },
      percent: 81, severity: "warning", enabled: true,
    },
  },
};
const config = (cache: unknown) => JSON.stringify({ emailAddress: "someone@example.com", oauthAccount: { accessToken: "nope" }, cachedUsageUtilization: cache });

test("reader runs local /usage only, then returns just usage fields from Claude Code's cache", async () => {
  const requests: ProcessRequest[] = [];
  const files: string[] = [];
  const raw = await readClaudeUsage(async (request) => { requests.push(request); return localUsage; }, signal(), {
    env: {}, home: "/home/u", readFile: async (file) => { files.push(file); return config(enterprise); },
  });
  assert.deepEqual(requests, [CLAUDE_USAGE_REQUEST]);
  assert.deepEqual(CLAUDE_USAGE_REQUEST.args, ["-p", "/usage", "--output-format", "json", "--no-session-persistence"]);
  assert.deepEqual(files, [path.join("/home/u", ".claude.json")]);
  assert(!JSON.stringify(raw).match(/someone@|secret-account|accessToken|nope/));
  assert.deepEqual(Object.keys(raw as object), ["fetchedAtMs", "utilization"]);
});

test("config location honors CLAUDE_CONFIG_DIR", () => {
  assert.equal(claudeConfigFile({ CLAUDE_CONFIG_DIR: "/cfg" }, "/home/u"), path.join("/cfg", ".claude.json"));
});

test("reader refuses a non-local /usage result and a missing or invalid cache", async () => {
  const deps = { env: {}, home: "/h", readFile: async () => config(enterprise) };
  await assert.rejects(readClaudeUsage(async () => ({ ...localUsage, local_command: undefined }), signal(), deps), /local command/);
  await assert.rejects(readClaudeUsage(async () => ({ ...localUsage, is_error: true }), signal(), deps), /local command/);
  await assert.rejects(readClaudeUsage(async () => localUsage, signal(), { ...deps, readFile: async () => { throw new Error("ENOENT /h/.claude.json"); } }), /cache unavailable/);
  await assert.rejects(readClaudeUsage(async () => localUsage, signal(), { ...deps, readFile: async () => "{" }), /cache unreadable/);
});

test("registry surfaces safe Claude reader errors", async () => {
  const claude = providerReaders(async () => ({}), async () => ({}), async () => { throw new Error("/secret/path"); }).find((r) => r.id === "claude-work")!;
  assert.equal(claude.experimental, true);
  assert.equal(claude.name, "Claude Work");
  await assert.rejects(claude.read(signal()), (e: Error) => e.message === "Claude Work usage unavailable");
  const personal = providerReaders(async () => ({}), async () => ({}), async () => { throw new Error("/secret/path"); }).find((r) => r.id === "claude-personal")!;
  assert.equal(personal.name, "Claude Personal");
  await assert.rejects(personal.read(signal()), (e: Error) => e.message === "Claude Personal usage unavailable");
});

test("enterprise usage credits parse to dollars against the seat limit", () => {
  const value = parseClaude(enterprise);
  assert.equal(value.kind, "spend");
  if (value.kind !== "spend") return;
  const { usedPercent, ...rest } = value.spend!;
  assert.deepEqual(rest, { used: 406.9, limit: 500, currency: "USD", severity: "warning" });
  assert(Math.abs(usedPercent! - 81.38) < 1e-9);
  assert.deepEqual(value.windows, []);
  assert.equal(value.fetchedAt, 1792385880305);
});

test("legacy extra_usage shape is used only when spend is absent; disabled spend is not zero", () => {
  const legacy = parseClaude({ utilization: { extra_usage: enterprise.utilization.extra_usage } });
  assert(legacy.kind === "spend" && legacy.spend?.used === 406.9 && legacy.spend.limit === 500);
  assert.throws(() => parseClaude({ utilization: { spend: { enabled: false }, extra_usage: enterprise.utilization.extra_usage } }));
  assert.throws(() => parseClaude({ utilization: { five_hour: null, spend: { enabled: true, used: { amount_minor: -1, exponent: 2 } } } }));
  assert.throws(() => parseClaude(undefined));
});

test("spend without a personal limit keeps the amount and invents no limit or percentage", () => {
  const value = parseClaude({ utilization: { spend: { enabled: true, used: { amount_minor: 1234, currency: "USD", exponent: 2 }, limit: null } } });
  assert(value.kind === "spend");
  assert.deepEqual(value.spend, { used: 12.34, limit: undefined, currency: "USD", usedPercent: undefined, severity: undefined });
  const state: ProviderState = { id: "claude-work", name: "Claude Work", status: "available", value };
  assert.deepEqual(compactFooterRows([state]), ["", "Claude-W $12"]);
  assert(detailText([state]).includes("$12.34 used (no personal limit)"));
});

test("Pro/Max subscription windows map to 5h/week with resets; spend optional", () => {
  const value = parseClaude({ utilization: {
    five_hour: { utilization: 23.5, resets_at: "2026-01-01T10:00:00Z" },
    seven_day: { utilization: 41.2, resets_at: "2026-01-05T10:00:00Z" },
    spend: { enabled: false },
  } });
  assert(value.kind === "spend");
  assert.equal(value.spend, undefined);
  assert.deepEqual(value.windows, [
    { id: "5h", label: "5h", usedPercent: 23.5, resetsAt: Date.parse("2026-01-01T10:00:00Z") },
    { id: "week", label: "week", usedPercent: 41.2, resetsAt: Date.parse("2026-01-05T10:00:00Z") },
  ]);
  const state: ProviderState = { id: "claude-work", name: "Claude Work", status: "available", value };
  assert.deepEqual(compactFooterRows([state]), ["Claude-W 5h-24% wk-41%", ""]);
});

test("footer, stale marker and details for enterprise spend", () => {
  const state: ProviderState = { id: "claude-work", name: "Claude Work", experimental: true, status: "available", value: parseClaude(enterprise) };
  assert.deepEqual(compactFooterRows([state]), ["", "Claude-W $407/$500 81%"]);
  assert.deepEqual(compactFooterRows([{ ...state, error: "Read timed out (30 seconds)" }]), ["", "Claude-W $407/$500 81%*"]);
  assert.deepEqual(footerRows([state]), ["Claude Work $406.90 / $500.00 (81.4%) used"]);
  const details = detailText([state]);
  assert(details.includes("Claude Work (experimental internal API)"));
  assert(details.includes("Usage credits: $406.90 used of $500.00 limit · 81.4% · warning"));
  assert(details.includes("Spend period/reset not reported"));
  assert(details.includes("Claude Code cache fetched:"));
});

test("per-profile read pins CLAUDE_CONFIG_DIR, strips the API key and keeps only usage fields", async () => {
  const requests: ProcessRequest[] = [];
  const raw = await readClaudeUsageAt(async (request) => { requests.push(request); return localUsage; }, signal(), "/cfg-personal", {
    readFile: async (file) => { assert.equal(file, path.join("/cfg-personal", ".claude.json")); return config(enterprise); },
  });
  assert.deepEqual(requests, [{ ...CLAUDE_USAGE_REQUEST, env: { CLAUDE_CONFIG_DIR: "/cfg-personal", ANTHROPIC_API_KEY: undefined } }]);
  assert(!JSON.stringify(raw).match(/someone@|secret-account|accessToken|nope/));
  assert.deepEqual(Object.keys(raw as object), ["fetchedAtMs", "utilization"]);
});

test("unparseable profile cache surfaces a per-profile safe error", async () => {
  const readers = providerReaders(async () => localUsage, async () => ({}), async () => ({}));
  const work = readers.find((r) => r.id === "claude-work")!;
  await assert.rejects(work.read(signal()), (e: Error) => e.message === "Claude Work usage unavailable");
});
