import assert from "node:assert/strict";
import { test, beforeEach, afterEach } from "node:test";
import { createEventBus, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  backgroundWarmingDecision, backgroundCacheWarmingOptedOut, commandExpectsContinuation,
  subagentExpectsContinuation, supportsNativeCacheWarming, registerBackgroundCacheWarming,
  type NativeCacheWarmingDecision,
} from "../lib/background-cache-warming.ts";
import { shouldApplyLongCacheTtl, withLongCacheTtl } from "../lib/subagent-background.ts";

let previousOptOut: string | undefined;
beforeEach(() => { previousOptOut = process.env.PI_BACKGROUND_CACHE_WARMING; delete process.env.PI_BACKGROUND_CACHE_WARMING; });
afterEach(() => {
  if (previousOptOut === undefined) delete process.env.PI_BACKGROUND_CACHE_WARMING;
  else process.env.PI_BACKGROUND_CACHE_WARMING = previousOptOut;
});

const profitable: NativeCacheWarmingDecision = {
  type: "cache_warming_decision", action: "stop", warmCost: 0.02, missCost: 0.2, continuationProbability: 0.15,
};
function context(id: string | undefined): ExtensionContext {
  return { cwd: "/same-cwd", sessionManager: { getSessionId: () => id } } as unknown as ExtensionContext;
}
function extension(events = createEventBus()) {
  const handlers = new Map<string, Array<(event: any, ctx: ExtensionContext) => unknown>>();
  // No settings/model/request APIs: the policy cannot use them.
  const pi = { events, on(name: string, handler: (event: any, ctx: ExtensionContext) => unknown) {
    handlers.set(name, [...(handlers.get(name) ?? []), handler]);
  } } as unknown as ExtensionAPI;
  async function emit(name: string, ctx: ExtensionContext, event: unknown = {}) {
    const values: unknown[] = [];
    for (const handler of handlers.get(name) ?? []) values.push(await handler(event, ctx));
    return values;
  }
  return { pi, handlers, emit };
}

test("only expected continuation changes native probability; preserve economic floor", () => {
  assert.deepEqual(backgroundWarmingDecision(profitable, true, undefined), { action: "warm" });
  assert.equal(backgroundWarmingDecision(profitable, false, undefined), undefined);
  assert.equal(backgroundWarmingDecision({ ...profitable, action: "warm" }, true, undefined), undefined);
  for (const warmCost of [undefined, NaN, Infinity, -1, 0.16, 0.2, 100]) {
    assert.equal(backgroundWarmingDecision({ ...profitable, warmCost }, true, undefined), undefined);
  }
  for (const missCost of [undefined, NaN, Infinity, -1, 0, 0.06]) {
    assert.equal(backgroundWarmingDecision({ ...profitable, missCost }, true, undefined), undefined);
  }
  assert.deepEqual(backgroundWarmingDecision({ ...profitable, warmCost: 0, missCost: 0.05 }, true, undefined), { action: "warm" });
});

test("opt-out is explicit, case-insensitive and leaves native policy alone", () => {
  for (const value of ["0", "false", "NO", " Off "]) {
    assert.equal(backgroundCacheWarmingOptedOut(value), true);
    assert.equal(backgroundWarmingDecision(profitable, true, value), undefined);
  }
  for (const value of [undefined, "", "1", "true"]) assert.equal(backgroundCacheWarmingOptedOut(value), false);
});

test("only running notification commands and running subagents expect continuation", () => {
  assert.equal(commandExpectsContinuation({ status: "running", notifyOnFinish: true }), true);
  assert.equal(commandExpectsContinuation({ status: "running", notifyOnFinish: false }), false);
  for (const status of ["completed", "failed", "killed", "timed_out", "interrupted", "cancelled", "error"]) {
    assert.equal(commandExpectsContinuation({ status, notifyOnFinish: true }), false);
    assert.equal(subagentExpectsContinuation({ status }), false);
  }
  assert.equal(subagentExpectsContinuation({ status: "running" }), true);
});

test("stable public host version selects native policy; old/unknown hosts retain TTL fallback", () => {
  for (const version of ["1.3.0", "1.3.1", "1.10.0", "2.0.0"]) assert.equal(supportsNativeCacheWarming(version), true);
  for (const version of ["0.84.3", "1.1.0", "1.2.99", "unknown", "1.3.0-beta.1", ""]) assert.equal(supportsNativeCacheWarming(version), false);
  const request = { api: "anthropic-messages", supportsLongCacheRetention: true, windowActive: true, optOutEnv: undefined };
  assert.equal(shouldApplyLongCacheTtl(request), true);
  assert.equal(shouldApplyLongCacheTtl({ ...request, nativeWarmingSupported: false }), true);
  assert.equal(shouldApplyLongCacheTtl({ ...request, nativeWarmingSupported: true }), false);
  assert.equal(shouldApplyLongCacheTtl({ ...request, optOutEnv: "0" }), false);
  const explicit = { system: [{ type: "text", text: "prefix", cache_control: { type: "ephemeral", ttl: "5m" } }] };
  assert.equal(withLongCacheTtl(explicit), undefined, "explicit short TTL stays short even on old hosts");
  assert.equal(withLongCacheTtl({ system: [{ cache_control: { type: "ephemeral", ttl: "1h" } }] }), undefined);
  const old = extension();
  const registration = registerBackgroundCacheWarming(old.pi, () => true, "0.84.3");
  assert.equal(registration.nativeSupported, false);
  assert.equal(old.handlers.has("cache_warming_decision"), false);
});

for (const order of [["commands", "subagents"], ["subagents", "commands"]]) {
  test(`one cooperative owner combines both providers: ${order.join(" then ")}`, async () => {
    const bus = createEventBus();
    const ctx = context("session-a");
    const loaded = order.map(() => extension(bus));
    const live = [false, false];
    const registrations = loaded.map((item, index) => registerBackgroundCacheWarming(item.pi, () => live[index], "1.3.0"));
    for (const item of loaded) await item.emit("session_start", ctx);
    registrations.forEach((registration) => registration.bind(ctx));
    assert.equal(loaded.reduce((sum, item) => sum + (item.handlers.get("cache_warming_decision")?.length ?? 0), 0), 1);
    async function decide() {
      return (await Promise.all(loaded.map((item) => item.emit("cache_warming_decision", ctx, profitable)))).flat().filter(Boolean);
    }
    assert.deepEqual(await decide(), []);
    for (const index of [0, 1]) {
      live[index] = true;
      assert.deepEqual(await decide(), [{ action: "warm" }]);
      live[index] = false;
    }
    live.fill(true);
    assert.deepEqual(await decide(), [{ action: "warm" }]);
    for (const item of loaded) await item.emit("session_shutdown", ctx);
    assert.deepEqual(await decide(), []);
    // Resume without registering another hook or accumulating bus listeners.
    for (const item of loaded) await item.emit("session_start", ctx);
    registrations.forEach((registration) => registration.bind(ctx));
    assert.deepEqual(await decide(), [{ action: "warm" }]);
    assert.equal(loaded.reduce((sum, item) => sum + (item.handlers.get("cache_warming_decision")?.length ?? 0), 0), 1);
    for (const item of loaded) await item.emit("session_shutdown", ctx);
    // Fresh extension load on the SAME bus must not discover a stale owner.
    const fresh = extension(bus);
    registerBackgroundCacheWarming(fresh.pi, () => true, "1.3.0").bind(ctx);
    assert.deepEqual(await fresh.emit("cache_warming_decision", ctx, profitable), [{ action: "warm" }]);
    await fresh.emit("session_shutdown", ctx);
  });
}

test("same cwd is not session identity; replacement and shutdown fence stale work", async () => {
  const item = extension();
  const registration = registerBackgroundCacheWarming(item.pi, () => true, "1.3.0");
  let id = "session-a";
  const original = context(id);
  original.sessionManager.getSessionId = () => id;
  registration.bind(original);
  assert.deepEqual(await item.emit("cache_warming_decision", original, profitable), [{ action: "warm" }]);
  assert.deepEqual(await item.emit("cache_warming_decision", context("session-b"), profitable), [undefined]);
  id = "session-b"; // The host may mutate a SessionManager in place.
  assert.deepEqual(await item.emit("cache_warming_decision", original, profitable), [undefined]);
  await item.emit("session_start", original);
  assert.deepEqual(await item.emit("cache_warming_decision", original, profitable), [undefined]);
  registration.bind(original);
  assert.deepEqual(await item.emit("cache_warming_decision", original, profitable), [{ action: "warm" }]);
  registration.clear();
  assert.deepEqual(await item.emit("cache_warming_decision", original, profitable), [undefined]);
  registration.bind(context(undefined));
  assert.deepEqual(await item.emit("cache_warming_decision", context(undefined), profitable), [undefined]);
  await item.emit("session_shutdown", original);
});

test("failed providers cannot force warming or mask an eligible sibling", async () => {
  const bus = createEventBus();
  const broken = extension(bus), healthy = extension(bus);
  const ctx = context("a");
  registerBackgroundCacheWarming(broken.pi, () => { throw new Error("registry unavailable"); }, "1.3.0").bind(ctx);
  const sibling = registerBackgroundCacheWarming(healthy.pi, () => true, "1.3.0");
  assert.deepEqual(await broken.emit("cache_warming_decision", ctx, profitable), [undefined]);
  sibling.bind(ctx);
  assert.deepEqual(await broken.emit("cache_warming_decision", ctx, profitable), [{ action: "warm" }]);
  await broken.emit("session_shutdown", ctx); await healthy.emit("session_shutdown", ctx);
});
