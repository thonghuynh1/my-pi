import assert from "node:assert/strict";
import { test } from "node:test";
import { createCursorUsageReader, type CursorUsageDependencies } from "../lib/provider-usage/cursor.ts";

const now = 1_800_000_000_000;
const jwt = (claims: unknown = { exp: now / 1000 + 3600 }) => `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.c2ln`;
const usage = { enabled: true, billingCycleStart: "1800000000000", billingCycleEnd: "1802600000000", planUsage: { includedSpend: 0, bonusSpend: 0, totalSpend: 125, limit: 2000, remaining: 1875, totalPercentUsed: 6.25 } };
const signal = () => new AbortController().signal;
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
function fixture(options: CursorUsageDependencies = {}, auth: unknown = { accessToken: jwt(), refreshToken: "never-use", apiKey: "never-use" }, config: unknown = {}) {
  const files: string[] = [];
  const requests: { url: string; init: RequestInit }[] = [];
  const read = createCursorUsageReader({
    platform: "win32", env: { APPDATA: "C:/Roaming" }, home: "C:/Users/Fixture", now: () => now,
    readFile: async (file) => { files.push(file); return JSON.stringify(file.endsWith("auth.json") ? auth : config); },
    fetch: async (url, init) => { requests.push({ url: String(url), init: init! }); return json(usage); },
    ...options,
  });
  return { read, files, requests };
}
test("Cursor reads provider-owned existing accessToken and POSTs only empty Connect JSON", async () => {
  const f = fixture({}, undefined, { authInfo: { activeTeamId: 42, teamId: 99 } });
  assert.deepEqual(await f.read(signal()), usage);
  assert.deepEqual(f.files, [String.raw`C:\Roaming\Cursor\auth.json`, String.raw`C:\Users\Fixture\.cursor\cli-config.json`]);
  assert.equal(f.requests.length, 1);
  const { url, init } = f.requests[0];
  assert.equal(url, "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage");
  assert.equal(init.method, "POST"); assert.equal(init.body, "{}"); assert.equal(init.redirect, "error"); assert.equal(init.credentials, "omit");
  const headers = new Headers(init.headers);
  assert.equal(headers.get("authorization"), `Bearer ${jwt()}`);
  assert.equal(headers.get("connect-protocol-version"), "1");
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(headers.get("x-cursor-team-id"), "42");
  assert.equal(headers.get("x-cursor-client-type"), "cli");
  assert(!JSON.stringify(init).includes("never-use"));
});
test("Cursor platform paths and config overrides follow CLI source, not credential config overrides", async () => {
  for (const [platform, env, expected] of [
    ["linux", {}, ["/home/test/.config/cursor/auth.json", "/home/test/.cursor/cli-config.json"]],
    ["linux", { XDG_CONFIG_HOME: "/xdg", CURSOR_CONFIG_DIR: "/config" }, ["/xdg/cursor/auth.json", "/config/cli-config.json"]],
    ["darwin", { AGENT_CLI_CREDENTIAL_STORE: "file" }, ["/home/test/.cursor/auth.json", "/home/test/.cursor/cli-config.json"]],
  ] as const) {
    const f = fixture({ platform, env, home: "/home/test" });
    await f.read(signal()); assert.deepEqual(f.files, expected);
  }
  for (const options of [{ platform: "darwin" as const, env: {} }, { env: { AGENT_CLI_CREDENTIAL_STORE: "memory" } }]) {
    const f = fixture(options); await assert.rejects(f.read(signal()), /store unsupported/); assert.equal(f.files.length, 0);
  }
});
test("Cursor never exchanges API keys or refreshes malformed/missing/expired tokens", async () => {
  for (const auth of [{}, { apiKey: "secret" }, { accessToken: "secret" }, { accessToken: jwt({ exp: now / 1000 - 1 }) }, { accessToken: jwt({ exp: now / 1000 + 299 }) }, { accessToken: jwt({}) }]) {
    const f = fixture({}, auth);
    await assert.rejects(f.read(signal()), /existing login/);
    assert.equal(f.requests.length, 0);
  }
});
test("Cursor fails closed on unreadable config or invalid active team; missing config is optional", async () => {
  for (const config of [{ authInfo: null }, { authInfo: { activeTeamId: "42" } }, { authInfo: { activeTeamId: -1 } }]) {
    const f = fixture({}, undefined, config); await assert.rejects(f.read(signal())); assert.equal(f.requests.length, 0);
  }
  const f = fixture({ readFile: async (file) => {
    if (file.endsWith("auth.json")) return JSON.stringify({ accessToken: jwt() });
    throw Object.assign(new Error("private path"), { code: "ENOENT" });
  } });
  await f.read(signal()); assert.equal(new Headers(f.requests[0].init.headers).has("x-cursor-team-id"), false);
});

test("Cursor strips messages/identity fields and accepts source-verified spend-limit int64 JSON", async () => {
  const data = { ...usage, displayMessage: "private account", account: "secret", planUsage: { ...usage.planUsage, bonusTooltip: "private" }, spendLimitUsage: { pooledLimit: "1000", pooledRemaining: "900", individualUsed: 0 } };
  const f = fixture({ fetch: async () => json(data) });
  assert.deepEqual(await f.read(signal()), { ...usage, spendLimitUsage: { pooledLimit: "1000", pooledRemaining: "900", totalSpend: 0, individualUsed: 0, individualRemaining: 0 } });
});
test("Cursor rejects unsupported JSON schemas rather than inventing usage for missing messages", async () => {
  for (const data of [null, [], {}, { plan_usage: { total_spend: 1 } }, { planUsage: { unexpected: 1 } }, { planUsage: { totalSpend: "1" } }, { planUsage: { totalSpend: -2_147_483_649 } }, { planUsage: { totalPercentUsed: null } }, { ...usage, enabled: "true" }, { ...usage, billingCycleEnd: "tomorrow" }, { spendLimitUsage: { pooledRemaining: "9223372036854775808" } }]) {
    const f = fixture({ fetch: async () => json(data) });
    await assert.rejects(f.read(signal()), /schema unavailable/);
  }
});
test("Cursor sanitizes filesystem/network/JSON failures and HTTP errors without exposing bodies", async () => {
  const privateText = "private-token-private-path";
  const cases: CursorUsageDependencies[] = [
    { readFile: async () => { throw new Error(privateText); } },
    { readFile: async () => privateText },
    { fetch: async () => { throw new Error(privateText); } },
    { fetch: async () => new Response(privateText, { status: 401 }) },
    { fetch: async () => new Response(privateText, { status: 403 }) },
    { fetch: async () => new Response(privateText, { status: 302, headers: { location: "https://evil.invalid" } }) },
    { fetch: async () => new Response(privateText, { headers: { "content-type": "application/json" } }) },
    { fetch: async () => new Response(privateText, { headers: { "content-type": "text/html" } }) },
  ];
  for (const options of cases) await assert.rejects(fixture(options).read(signal()), (e: Error) => {
    assert.equal(e.constructor, Error); assert(!e.message.includes("private")); assert.equal(e.cause, undefined); return true;
  });
});
test("Cursor bounds both advertised and streamed response bytes and auth input", async () => {
  const large = "x".repeat(100);
  for (const headers of [{ "content-type": "application/json" }, { "content-type": "application/json", "content-length": "100" }]) {
    await assert.rejects(fixture({ maxResponseBytes: 16, fetch: async () => new Response(large, { headers }) }).read(signal()), /safety limit/);
  }
  let canceled = false;
  const body = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(new Uint8Array(17)); }, cancel() { canceled = true; },
  });
  await assert.rejects(fixture({ maxResponseBytes: 16, fetch: async () => new Response(body, { headers: { "content-type": "application/json" } }) }).read(signal()), /safety limit/);
  assert.equal(canceled, true);
  const f = fixture({ readFile: async () => " ".repeat(65_537) });
  await assert.rejects(f.read(signal())); assert.equal(f.requests.length, 0);
});
test("Cursor cancellation and timeout bound even noncooperative injected dependencies", async () => {
  const already = new AbortController(); already.abort();
  const f = fixture(); await assert.rejects(f.read(already.signal), /canceled/); assert.equal(f.files.length, 0);
  await assert.rejects(fixture({ timeoutMs: 5, readFile: async () => new Promise(() => {}) }).read(signal()), /timed out/);
  await assert.rejects(fixture({ timeoutMs: 5, fetch: async () => new Promise(() => {}) }).read(signal()), /timed out/);
  const controller = new AbortController();
  let requestSignal: AbortSignal | undefined;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const active = fixture({ fetch: async (_, init) => { requestSignal = init!.signal!; started(); return new Promise(() => {}); } });
  const pending = active.read(controller.signal); await ready; controller.abort();
  await assert.rejects(pending, /canceled/); assert.equal(requestSignal!.aborted, true);
});
test("Cursor timeout cancels a stalled response stream", async () => {
  let canceled = false;
  const body = new ReadableStream<Uint8Array>({ cancel() { canceled = true; } });
  const f = fixture({ timeoutMs: 5, fetch: async () => new Response(body, { headers: { "content-type": "application/json" } }) });
  await assert.rejects(f.read(signal()), /timed out/); assert.equal(canceled, true);
});

test("Cursor zero activeTeamId selects personal/default context without a team header", async () => {
  const f = fixture({}, undefined, { authInfo: { activeTeamId: 0, teamId: 99 } });
  await f.read(signal());
  assert.equal(new Headers(f.requests[0].init.headers).has("x-cursor-team-id"), false);
  assert.equal(f.requests[0].init.body, "{}");
});
test("Cursor restores proto3 zero defaults only for present usage messages", async () => {
  const f = fixture({ fetch: async () => json({ planUsage: {}, spendLimitUsage: {} }) });
  assert.deepEqual(await f.read(signal()), {
    planUsage: { totalSpend: 0, includedSpend: 0, bonusSpend: 0, remaining: 0, limit: 0 },
    spendLimitUsage: { totalSpend: 0, individualUsed: 0, individualRemaining: 0 },
  });
});
test("Cursor uses signed int32, int64, and double proto field types without precision loss", async () => {
  const data = { ...usage, billingCycleStart: "9223372036854775807", planUsage: { ...usage.planUsage, remaining: -1, totalPercentUsed: 100.25 },
    spendLimitUsage: { totalSpend: 0, individualUsed: 0, individualRemaining: 0, pooledLimit: 3_000_000_000, pooledRemaining: "-9223372036854775808" } };
  assert.deepEqual(await fixture({ fetch: async () => json(data) }).read(signal()), data);
  for (const pooledLimit of ["9999999999999999999", "-9223372036854775809", Number.MAX_SAFE_INTEGER + 1, 1.5]) {
    await assert.rejects(fixture({ fetch: async () => json({ spendLimitUsage: { pooledLimit } }) }).read(signal()), /schema unavailable/);
  }
});
test("Cursor credential paths preserve the CLI env fallback rules on Windows and macOS", async () => {
  for (const [env, base] of [
    [{}, String.raw`C:\Users\Fixture\AppData\Roaming`],
    [{ APPDATA: "", XDG_CONFIG_HOME: "C:/ignored", CURSOR_CONFIG_DIR: "C:/config" }, String.raw`C:\Users\Fixture\AppData\Roaming`],
    [{ APPDATA: "C:/Custom", CURSOR_CONFIG_DIR: "C:/config" }, String.raw`C:\Custom`],
  ] as const) {
    const f = fixture({ env }); await f.read(signal());
    assert.equal(f.files[0], base + String.raw`\Cursor\auth.json`);
  }
  const mac = fixture({ platform: "darwin", home: "/Users/fixture", env: { AGENT_CLI_CREDENTIAL_STORE: "file", CURSOR_CONFIG_DIR: "/config", XDG_CONFIG_HOME: "/xdg" } });
  await mac.read(signal());
  assert.deepEqual(mac.files, ["/Users/fixture/.cursor/auth.json", "/config/cli-config.json"]);
});
