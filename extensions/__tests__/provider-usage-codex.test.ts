import assert from "node:assert/strict";
import { test } from "node:test";
import { providerReaders, UsageReadError } from "../lib/provider-usage/readers.ts";
import { usageScope } from "../lib/provider-usage/scope.ts";
import usageFooter from "../usage-footer.ts";
import { SharedUsageCache } from "../lib/provider-usage/shared-cache.ts";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { compactFooterRows } from "../lib/provider-usage/model.ts";

const token = (account: string, plan: string) => `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({
  "https://api.openai.com/auth": { chatgpt_account_id: account, chatgpt_plan_type: plan },
})).toString("base64url")}.signature`;
const usage = {
  rate_limit: {
    primary_window: { used_percent: 8, limit_window_seconds: 18000, reset_at: 1793310080 },
    secondary_window: { used_percent: 1, limit_window_seconds: 604800, reset_at: 1793896880 },
  },
};

test("Pi Codex personal and Team/Business usage wins over an unrelated Free CLI account", async (t) => {
  let currentToken = "";
  let account = "";
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://chatgpt.com/backend-api/wham/usage");
    const headers = new Headers(init.headers);
    assert.equal(headers.get("authorization"), `Bearer ${currentToken}`);
    assert.equal(headers.get("chatgpt-account-id"), account);
    assert.equal(init.redirect, "error");
    return Response.json(usage);
  });
  let cliReads = 0;
  const reader = providerReaders(async () => {
    cliReads++;
    return { rateLimits: { primary: { usedPercent: 0, windowDurationMins: 43200 } } };
  }, undefined, undefined, undefined, { codexApiKey: async () => currentToken })[0];
  for (const plan of ["plus", "pro", "team", "business"]) {
    account = `synthetic-${plan}`;
    currentToken = token(account, plan);
    const value = await reader.read(new AbortController().signal);
    assert.equal(compactFooterRows([{ id: "codex", name: "Codex", status: "available", value }])[0], "Codex 5h-8% wk-1%");
    assert(value.kind === "quota");
    assert.deepEqual(value.groups[0].windows.map(w => w.resetsAt), [1793310080000, 1793896880000]);
    assert(!JSON.stringify(value).includes("synthetic"));
  }
  assert.equal(cliReads, 0);
});

test("Codex falls back to the existing CLI only when Pi has no Codex credential", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("No OAuth request expected"); });
  let cliReads = 0;
  for (const codexApiKey of [undefined, async () => undefined]) {
    const reader = providerReaders(async (request) => {
      assert.equal(request.command, "codex");
      cliReads++;
      return { rateLimits: { primary: { usedPercent: 25, windowDurationMins: 300 } } };
    }, undefined, undefined, undefined, { codexApiKey })[0];
    const value = await reader.read(new AbortController().signal);
    assert.equal(compactFooterRows([{ id: "codex", name: "Codex", status: "available", value }])[0], "Codex 5h-25%");
  }
  assert.equal(cliReads, 2);
});

test("Codex never falls back to a different account on credential, HTTP, or schema errors", async (t) => {
  let currentToken = token("synthetic-team", "team");
  let resolveError = false;
  let response = () => Response.json(usage);
  t.mock.method(globalThis, "fetch", async () => response());
  let cliReads = 0;
  const reader = providerReaders(async () => { cliReads++; throw new Error("wrong account"); },
    undefined, undefined, undefined, { codexApiKey: async () => {
      if (resolveError) throw new Error("private refresh detail");
      return currentToken;
    } })[0];
  for (const body of [
    () => Response.json({ private: "server-detail" }, { status: 401 }),
    () => new Response("<html>private</html>", { headers: { "content-type": "text/html" } }),
    () => Response.json({ rate_limit: { primary_window: { used_percent: "8", limit_window_seconds: 18000 } } }),
    () => Response.json({ rate_limit: null, credits: { unlimited: true } }),
    () => new Response("{private", { headers: { "content-type": "application/json" } }),
  ]) {
    response = body;
    await assert.rejects(reader.read(new AbortController().signal), UsageReadError);
  }
  response = () => Response.json(usage);
  for (const invalid of ["", "not-a-jwt", token("", "team")]) {
    currentToken = invalid;
    await assert.rejects(reader.read(new AbortController().signal), UsageReadError);
  }
  resolveError = true;
  await assert.rejects(reader.read(new AbortController().signal), (error: Error) => {
    assert(error instanceof UsageReadError);
    assert(!/private|server-detail|synthetic/.test(error.message));
    return true;
  });
  assert.equal(cliReads, 0);
});

test("Codex scopes follow the selected Pi account, ignore unrelated CLI auth, and hash secrets", async () => {
  let currentToken: string | undefined = token("synthetic-personal", "plus");
  const deps = { env: {}, home: "/unused", platform: "linux" as const,
    codexApiKey: async () => currentToken,
    readFile: () => { throw new Error("Pi OAuth scope must not inspect CLI credentials"); } };
  const resolve = usageScope("codex", undefined, deps);
  const personal = await resolve();
  assert.equal(personal.identity, "known");
  assert.deepEqual(await resolve(), personal);
  currentToken = token("synthetic-team", "team");
  const team = await resolve();
  assert.notEqual(personal.key, team.key);
  assert.notEqual(personal.generation, team.generation);
  assert(!JSON.stringify([personal, team]).includes("synthetic"));
  assert(!JSON.stringify([personal, team]).includes(currentToken));
  currentToken = undefined;
  const cli = await usageScope("codex", undefined, { ...deps, readFile: () => undefined })();
  assert.notEqual(cli.key, team.key);
  assert.notEqual(cli.key, personal.key);
});

test("Codex rejects oversized responses and cancels an interrupted response stream", async (t) => {
  let canceled = false;
  let response = () => new Response(" ".repeat(65_537), { headers: { "content-type": "application/json" } });
  t.mock.method(globalThis, "fetch", async () => response());
  const reader = providerReaders(async () => { throw new Error("CLI must not run"); },
    undefined, undefined, undefined, { codexApiKey: async () => token("synthetic-team", "team") })[0];
  await assert.rejects(reader.read(new AbortController().signal), UsageReadError);
  const body = new ReadableStream<Uint8Array>({ cancel() { canceled = true; } });
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  response = () => { started(); return new Response(body, { headers: { "content-type": "application/json" } }); };
  const controller = new AbortController();
  const pending = reader.read(controller.signal);
  await ready;
  controller.abort();
  await assert.rejects(pending, UsageReadError);
  assert.equal(canceled, true);
});

test("the default TUI footer resolves Pi Codex OAuth and renders that account's usage", async (t) => {
  const callbacks = new Map<string, ((event: unknown, ctx: ExtensionContext) => unknown)[]>();
  const emit = (name: string) => { for (const callback of callbacks.get(name) ?? []) callback({}, ctx); };
  let component: (Component & { dispose?(): void }) | undefined;
  let authReads = 0;
  let finishRead!: () => void;
  const readDone = new Promise<void>(resolve => { finishRead = resolve; });
  t.mock.method(globalThis, "fetch", async () => Response.json(usage));
  t.mock.method(SharedUsageCache.prototype, "read", async (reader, signal) => {
    if (reader.id !== "codex") return { status: "error", errorCode: "unavailable", error: "unused", lastAttempt: 1 };
    assert((await reader.scope!()).identity === "known");
    const value = await reader.read(signal);
    finishRead();
    return { status: "available", value, lastAttempt: 1, lastSuccess: 1 };
  });
  const pi = {
    on(name: string, callback: (event: unknown, ctx: ExtensionContext) => unknown) { callbacks.set(name, [...(callbacks.get(name) ?? []), callback]); },
    registerCommand() {}, registerTool() {}, getActiveTools: () => [], setActiveTools() {}, getThinkingLevel: () => "medium",
  } as unknown as ExtensionAPI;
  const ctx = {
    mode: "tui", hasUI: true, model: { provider: "openai-codex", id: "test-model" },
    modelRegistry: { getProviderAuth: async (provider: string) => {
      assert.equal(provider, "openai-codex");
      authReads++;
      return { source: "OAuth", auth: { apiKey: token("synthetic-pi-team", "team") } };
    } },
    getContextUsage: () => undefined, sessionManager: { getBranch: () => [] },
    ui: { setFooter(factory: (tui: unknown, theme: unknown) => Component) {
      component = factory({ requestRender() {} }, { fg: (_color: string, value: string) => value });
    } },
  } as unknown as ExtensionContext;
  usageFooter(pi);
  t.after(() => { emit("session_shutdown"); component?.dispose?.(); });
  emit("session_start");
  await readDone;
  await new Promise<void>(resolve => setImmediate(resolve));
  assert(authReads >= 1);
  assert(component);
  const lines = component.render(180);
  assert.equal(lines.length, 3);
  assert.match(lines[1], /Codex 5h-8% wk-1%/);
  assert(!lines.join("\n").includes("43200m"));
});
