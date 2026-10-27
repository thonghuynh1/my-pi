import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SharedUsageCache, SHARED_USAGE_TTL, type SharedObservation } from "../lib/provider-usage/shared-cache.ts";
import { ProviderUsageMonitor } from "../lib/provider-usage/monitor.ts";
import type { UsageScope } from "../lib/provider-usage/scope.ts";
import type { ProviderReader } from "../lib/provider-usage/readers.ts";
import type { UsageMetric } from "../lib/provider-usage/model.ts";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const scope = (): UsageScope => ({ key: hash(randomUUID()), generation: hash("fixture-generation"), identity: "known" });
const signal = () => new AbortController().signal;
const credits = (consumed = 42): UsageMetric => ({ kind: "credits", consumed });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
function directory(t: { after(fn: () => void): void }): string {
  const root = mkdtempSync(path.join(tmpdir(), "provider-usage-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function reader(context: UsageScope, read: ProviderReader["read"]): ProviderReader {
  return { id: "copilot", name: "Fixture", scope: async () => context, read };
}
function child(options: { root: string; counter: string; scope: UsageScope; now: number; fail?: boolean; gate?: boolean; abortAfterMs?: number }) {
  const fixture = new URL("./fixtures/provider-usage-process.ts", import.meta.url).href;
  const process = spawn(globalThis.process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `import {run} from ${JSON.stringify(fixture)}; await run(${JSON.stringify(options)});`], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
  const messages: Record<string, unknown>[] = [];
  const waiters = new Set<() => void>();
  let stderr = "";
  process.stderr.on("data", (bytes: Buffer) => { stderr += bytes.toString(); });
  process.on("message", (value: unknown) => { if (value && typeof value === "object") messages.push(value as Record<string, unknown>); for (const wake of waiters) wake(); });
  const exit = new Promise<number | null>((resolve, reject) => { process.once("error", reject); process.once("exit", (code) => { resolve(code); for (const wake of waiters) wake(); }); });
  const wait = (type: string): Promise<Record<string, unknown>> => new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`Child barrier ${type}: ${stderr}`)), 10_000);
    const finish = (error?: Error, value?: Record<string, unknown>) => {
      clearTimeout(timer); waiters.delete(check);
      if (error) reject(error); else resolve(value!);
    };
    const check = () => {
      const index = messages.findIndex((message) => message.type === type);
      if (index >= 0) finish(undefined, messages.splice(index, 1)[0]);
      else if (process.exitCode !== null || process.signalCode !== null) finish(new Error(`Child exited before ${type}: ${stderr}`));
    };
    waiters.add(check); check();
  });
  return { process, wait, exit, send: (command: string) => process.send(command) };
}

test("manual rapid reads share TTL, original timestamps, and one refresh at expiry", async (t) => {
  const root = directory(t), context = scope();
  let now = 1000, calls = 0;
  const cache = new SharedUsageCache({ root, now: () => now });
  const source = reader(context, async () => { calls++; return credits(); });
  const first = await cache.read(source, signal());
  now += 50;
  assert.deepEqual(await cache.read(source, signal()), first);
  assert.deepEqual(await new SharedUsageCache({ root, now: () => now }).read(source, signal()), first);
  assert.equal(calls, 1);
  now = 1000 + SHARED_USAGE_TTL;
  const results = await Promise.all([cache.read(source, signal()), new SharedUsageCache({ root, now: () => now }).read(source, signal())]);
  assert.equal(calls, 2);
  assert.deepEqual(results[0], results[1]);
  assert.equal(results[0].lastAttempt, now);
});

test("failure cooldown starts at completion and retains only matching stale value across restart", async (t) => {
  const root = directory(t), context = scope();
  let now = 1000, calls = 0, fail = false;
  const source = reader(context, async () => {
    calls++;
    if (fail) { now += 2000; throw new Error("synthetic-secret-token-account@example.test"); }
    return credits();
  });
  const cache = new SharedUsageCache({ root, now: () => now });
  const first = await cache.read(source, signal());
  now += SHARED_USAGE_TTL; fail = true;
  const failed = await cache.read(source, signal());
  assert.equal(failed.status, "error");
  assert.deepEqual(failed.value, first.value);
  assert.equal(failed.lastSuccess, first.lastSuccess);
  assert.equal(failed.lastAttempt, 301000);
  now += SHARED_USAGE_TTL - 1;
  assert.deepEqual(await new SharedUsageCache({ root, now: () => now }).read(source, signal()), failed);
  assert.equal(calls, 2);
  context.generation = hash("new-credential");
  const changed = await cache.read(source, signal());
  assert.equal(changed.value, undefined);
  assert.equal(changed.lastSuccess, undefined);
  assert.equal(calls, 2);
  now++;
  const newFailure = await cache.read(source, signal());
  assert.equal(newFailure.status, "error");
  assert.equal(newFailure.value, undefined);
  assert.equal(calls, 3);
  const serialized = readFileSync(path.join(root, `${context.key}.json`), "utf8");
  assert(!serialized.includes("synthetic-secret"));
  assert(!serialized.includes("example.test"));
});

test("structured retry hints and exact Claude rate-limit reason survive shared restart", async (t) => {
  const root = directory(t), context = scope();
  let now = 1000, calls = 0;
  const source = reader(context, async () => { calls++; throw Object.assign(new Error("Claude usage refresh rate limited"), { retryAfterMs: 900000, raw: "synthetic-secret" }); });
  const first = await new SharedUsageCache({ root, now: () => now }).read(source, signal());
  assert.equal(first.status === "error" && first.error, "Claude usage refresh rate limited");
  now += 600000;
  assert.deepEqual(await new SharedUsageCache({ root, now: () => now }).read(source, signal()), first);
  assert.equal(calls, 1);
  assert(!readFileSync(path.join(root, `${context.key}.json`), "utf8").includes("synthetic-secret"));
});

test("real separate processes coalesce through the public sample boundary and restart failure cooldown", { timeout: 30000 }, async (t) => {
  const root = directory(t), context = scope(), counter = path.join(root, "counter");
  const owner = child({ root, scope: context, counter, now: 1000, gate: true });
  const follower = child({ root, scope: context, counter, now: 1000 });
  try {
    await Promise.all([owner.wait("ready"), follower.wait("ready")]);
    owner.send("go"); await owner.wait("entered");
    follower.send("go"); await follower.wait("scope");
    owner.send("finish");
    const [a, b] = await Promise.all([owner.wait("result"), follower.wait("result")]);
    assert.deepEqual(a.result, b.result);
    assert.deepEqual(a.result, { status: "available", value: credits(), lastAttempt: 1000, lastSuccess: 1000 });
    assert.equal(readFileSync(counter, "utf8"), "live\n");
    assert.deepEqual(await Promise.all([owner.exit, follower.exit]), [0, 0]);
    const failure = child({ root, scope: context, counter, now: 301000, fail: true });
    try {
      await failure.wait("ready"); failure.send("go");
      const failed = (await failure.wait("result")).result;
      assert.equal(await failure.exit, 0);
      const restart = child({ root, scope: context, counter, now: 301100 });
      try {
        await restart.wait("ready"); restart.send("go");
        assert.deepEqual((await restart.wait("result")).result, failed);
        assert.equal(await restart.exit, 0);
        assert.equal((failed as SharedObservation).status, "error");
        assert.deepEqual((failed as SharedObservation).value, credits());
        assert.equal(readFileSync(counter, "utf8"), "live\nlive\n");
      } finally { restart.process.kill(); await restart.exit; }
    } finally { failure.process.kill(); await failure.exit; }
  } finally { owner.process.kill(); follower.process.kill(); await Promise.all([owner.exit, follower.exit]); }
});

test("paused owner is never stolen even after marker expiry; canceled follower cannot cancel owner; crash releases OS mutex", { timeout: 30000 }, async (t) => {
  const root = directory(t), context = scope(), counter = path.join(root, "counter");
  await new SharedUsageCache({ root, now: () => 1000 }).read(reader(context, async () => credits(8)), signal());
  const owner = child({ root, scope: context, counter, now: 301000, gate: true });
  try {
    await owner.wait("ready"); owner.send("go"); await owner.wait("entered");
    const follower = child({ root, scope: context, counter, now: 301000 + SHARED_USAGE_TTL + 1, abortAfterMs: 250 });
    try {
      await follower.wait("ready"); follower.send("go");
      const canceled = (await follower.wait("result")).result as SharedObservation;
      assert.equal(canceled.status === "error" && canceled.errorCode, "canceled");
      assert.equal(await follower.exit, 0);
      assert.equal(readFileSync(counter, "utf8"), "live\n");
      assert.equal(owner.process.exitCode, null);
      owner.process.kill("SIGKILL"); await owner.exit;
      const restart = child({ root, scope: context, counter, now: 301100 });
      try {
        await restart.wait("ready"); restart.send("go");
        const recovered = (await restart.wait("result")).result as SharedObservation;
        assert.equal(recovered.status === "error" && recovered.errorCode, "in-flight");
        assert.equal(recovered.lastAttempt, 301000);
        assert.deepEqual(recovered.value, credits(8));
        assert.equal(recovered.lastSuccess, 1000);
        assert.equal(await restart.exit, 0);
        assert.equal(readFileSync(counter, "utf8"), "live\n");
      } finally { restart.process.kill(); await restart.exit; }
    } finally { follower.process.kill(); await follower.exit; }
  } finally { owner.process.kill(); await owner.exit; }
});

test("owner abort holds mutex through underlying cleanup and never publishes late success", async (t) => {
  const root = directory(t), context = scope();
  const entered = deferred<void>(), cleanup = deferred<void>();
  const owner = new AbortController(), follower = new AbortController();
  let calls = 0;
  const source = reader(context, async () => { calls++; entered.resolve(); await cleanup.promise; return credits(); });
  const cache = new SharedUsageCache({ root, now: () => 1000 });
  const pending = cache.read(source, owner.signal);
  await entered.promise;
  owner.abort();
  const following = new SharedUsageCache({ root, now: () => 1000 + SHARED_USAGE_TTL + 1 }).read(source, follower.signal);
  follower.abort();
  const canceled = await following;
  assert.equal(canceled.status === "error" && canceled.errorCode, "canceled");
  assert.equal(calls, 1);
  cleanup.resolve();
  const aborted = await pending;
  assert.equal(aborted.status === "error" && aborted.errorCode, "canceled");
  const next = await cache.read(source, signal());
  assert.equal(next.status === "error" && next.errorCode, "in-flight");
  assert.equal(next.value, undefined);
  assert.equal(calls, 1);
});

test("scope change during fetch discards result, clears monitor state, and never publishes old-account success", async (t) => {
  const root = directory(t), context = scope();
  let now = 1000, change = false;
  const cache = new SharedUsageCache({ root, now: () => now });
  const source = reader(context, async () => {
    if (change) context.generation = hash("replacement-account");
    return credits();
  });
  const monitor = new ProviderUsageMonitor([source], undefined, cache);
  await monitor.refresh();
  assert.deepEqual(monitor.snapshot()[0].value, credits());
  now += SHARED_USAGE_TTL; change = true;
  await monitor.refresh();
  assert.equal(monitor.snapshot()[0].status, "error");
  assert.equal(monitor.snapshot()[0].value, undefined);
  assert.equal(monitor.snapshot()[0].lastSuccess, undefined);
  const next = await cache.read(source, signal());
  assert.equal(next.value, undefined);
  assert.equal(next.status, "error");
  const stored: unknown = JSON.parse(readFileSync(path.join(root, `${context.key}.json`), "utf8"));
  assert.equal((stored as { inFlight: boolean }).inFlight, true);
  monitor.stop();
});

test("monitor adopts original shared timestamps and shared stale replacement, not local cached value", async () => {
  const context = scope();
  const source = reader(context, async () => { throw new Error("must not call direct reader"); });
  let observation: SharedObservation = { status: "available", value: credits(9), lastAttempt: 100, lastSuccess: 101 };
  const monitor = new ProviderUsageMonitor([source], undefined, { read: async () => observation });
  await monitor.refresh();
  assert.equal(monitor.snapshot()[0].lastAttempt, 100);
  assert.equal(monitor.snapshot()[0].lastSuccess, 101);
  observation = { status: "error", errorCode: "unavailable", error: "usage refresh unavailable", value: credits(2), lastAttempt: 200, lastSuccess: 50 };
  await monitor.refresh();
  assert.deepEqual(monitor.snapshot()[0].value, credits(2));
  assert.equal(monitor.snapshot()[0].lastSuccess, 50);
  observation = { status: "error", errorCode: "scope-changed", error: "usage refresh unavailable", lastAttempt: 300 };
  await monitor.refresh();
  assert.equal(monitor.snapshot()[0].value, undefined);
  assert.equal(monitor.snapshot()[0].lastSuccess, undefined);
  assert.equal(monitor.snapshot()[0].lastAttempt, 300);
  monitor.stop();
});

test("corrupt, oversized and invalid-schema records rebuild under coordination; only normalized safe data persists", async (t) => {
  const root = directory(t), context = scope(), file = path.join(root, `${context.key}.json`);
  let calls = 0;
  const source = reader(context, async () => { calls++; return { kind: "credits", consumed: 42, raw: "synthetic-secret-provider-response" } as UsageMetric; });
  const cache = new SharedUsageCache({ root, now: () => 1000 });
  for (const bad of ["{broken", "x".repeat(65537), JSON.stringify({ version: 1, key: context.key, generation: context.generation,
    nextRefreshAt: 9999999999999999, inFlight: false,
    observation: { status: "available", value: { kind: "credits", consumed: -1 }, lastAttempt: 1, lastSuccess: 1 } })]) {
    writeFileSync(file, bad, { mode: 0o600 });
    assert.equal((await cache.read(source, signal())).status, "available");
    const serialized = readFileSync(file, "utf8");
    assert(Buffer.byteLength(serialized) <= 65536);
    assert(!serialized.includes("synthetic-secret"));
  }
  assert.equal(calls, 3);
  if (process.platform !== "win32") {
    assert.equal(lstatSync(root).mode & 0o077, 0);
    assert.equal(lstatSync(file).mode & 0o077, 0);
    chmodSync(file, 0o644);
    const denied = await cache.read(source, signal());
    assert.equal(denied.status === "error" && denied.errorCode, "storage");
    assert.equal(calls, 3);
  }
});

test("storage failures fail closed without invoking live reader", async (t) => {
  const root = directory(t), context = scope();
  let calls = 0;
  const source = reader(context, async () => { calls++; return credits(); });
  const blocked = path.join(root, "not-a-directory");
  writeFileSync(blocked, "synthetic-secret", { mode: 0o600 });
  const result = await new SharedUsageCache({ root: blocked }).read(source, signal());
  assert.equal(result.status === "error" && result.errorCode, "storage");
  assert.equal(calls, 0);
  const file = path.join(root, `${context.key}.json`);
  mkdirSync(file);
  const nonregular = await new SharedUsageCache({ root }).read(source, signal());
  assert.equal(nonregular.status === "error" && nonregular.errorCode, "storage");
  assert.equal(calls, 0);
});

test("different provider/profile/auth namespaces have independent values and cooldowns", async (t) => {
  const root = directory(t);
  const cache = new SharedUsageCache({ root, now: () => 1000 });
  const contexts = ["codex", "copilot", "claude-work", "claude-personal", "cursor-team-1", "cursor-team-2"].map((id) => ({ key: hash(id + randomUUID()), generation: hash(id), identity: "known" as const }));
  const observations = await Promise.all(contexts.map((context, index) => cache.read(reader(context, async () => credits(index)), signal())));
  assert.deepEqual(observations.map((observation) => observation.value), contexts.map((_context, index) => credits(index)));
});

test("scoped startup, five-minute tick, and rapid manual refresh all use the same freshness policy", async (t) => {
  const root = directory(t), context = scope();
  let now = 1000, calls = 0;
  let tick = () => {};
  const source = reader(context, async () => { calls++; return credits(); });
  const monitor = new ProviderUsageMonitor([source], {
    now: () => now,
    every: (callback) => { tick = callback; return 1; },
    after: () => 2,
    cancelEvery: () => {}, cancelAfter: () => {},
  }, new SharedUsageCache({ root, now: () => now }));
  try {
    monitor.start(); await monitor.refresh();
    assert.equal(calls, 1);
    now += 1;
    await monitor.refresh(); await monitor.refresh();
    assert.equal(calls, 1);
    assert.equal(monitor.snapshot()[0].lastAttempt, 1000);
    assert.equal(monitor.snapshot()[0].lastSuccess, 1000);
    now = 1000 + SHARED_USAGE_TTL;
    tick(); await monitor.refresh();
    assert.equal(calls, 2);
    assert.equal(monitor.snapshot()[0].lastAttempt, now);
  } finally { monitor.stop(); }
});


test("nonzero fetch duration still refreshes exactly once at the next start-aligned monitor tick", async (t) => {
  const root = directory(t), context = scope();
  let now = 1000, calls = 0;
  let tick = () => {};
  const source = reader(context, async () => { calls++; now += 1250; return credits(calls); });
  const monitor = new ProviderUsageMonitor([source], {
    now: () => now, every: (callback) => { tick = callback; return 1; }, after: () => 2,
    cancelEvery: () => {}, cancelAfter: () => {},
  }, new SharedUsageCache({ root, now: () => now }));
  try {
    monitor.start(); await monitor.refresh();
    assert.equal(calls, 1);
    assert.equal(monitor.snapshot()[0].lastAttempt, 1000);
    assert.equal(monitor.snapshot()[0].lastSuccess, 2250);
    now = 1000 + SHARED_USAGE_TTL - 1;
    await monitor.refresh();
    assert.equal(calls, 1);
    assert.equal(monitor.snapshot()[0].lastSuccess, 2250);
    now = 1000 + SHARED_USAGE_TTL;
    tick(); await monitor.refresh();
    assert.equal(calls, 2);
    assert.equal(monitor.snapshot()[0].lastAttempt, 301000);
    assert.equal(monitor.snapshot()[0].lastSuccess, 302250);
    await monitor.refresh();
    assert.equal(calls, 2);
    assert.equal(monitor.snapshot()[0].lastSuccess, 302250);
  } finally { monitor.stop(); }
});

test("opaque stale fallback expires on failures and cannot resurrect after restart; known contexts retain stale values", async (t) => {
  const root = directory(t);
  for (const identity of ["opaque", "known"] as const) {
    const context: UsageScope = { ...scope(), identity };
    let now = 1000, calls = 0, fail = false;
    const source = reader(context, async () => {
      calls++;
      if (fail) throw new Error("synthetic-secret-failure");
      return credits(74);
    });
    const cache = new SharedUsageCache({ root, now: () => now });
    const first = await cache.read(source, signal());
    assert.deepEqual(first.value, credits(74));
    now += SHARED_USAGE_TTL - 1;
    assert.deepEqual(await cache.read(source, signal()), first);
    now++; fail = true;
    const failure = await cache.read(source, signal());
    assert.equal(failure.status, "error");
    assert.deepEqual(failure.value, identity === "known" ? credits(74) : undefined);
    assert.equal(failure.lastSuccess, identity === "known" ? 1000 : undefined);
    now += 100;
    const restarted = await new SharedUsageCache({ root, now: () => now }).read(source, signal());
    assert.deepEqual(restarted, failure);
    assert.equal(calls, 2);
    const serialized = JSON.parse(readFileSync(path.join(root, `${context.key}.json`), "utf8")) as { observation: { value?: UsageMetric; lastSuccess?: number } };
    assert.deepEqual(serialized.observation.value, failure.value);
    assert.equal(serialized.observation.lastSuccess, failure.lastSuccess);
  }
});

test("opaque cooldown and orphan-marker sanitization also covers old records with missing confidence", async (t) => {
  const root = directory(t);
  for (const inFlight of [false, true]) for (const diskIdentity of [undefined, "opaque", "known"] as const) {
    const context: UsageScope = { ...scope(), identity: "opaque" };
    const now = 1000 + SHARED_USAGE_TTL + 1;
    let calls = 0;
    const source = reader(context, async () => { calls++; return credits(99); });
    writeFileSync(path.join(root, `${context.key}.json`), JSON.stringify({
      version: 1, key: context.key, generation: context.generation, identity: diskIdentity, inFlight,
      nextRefreshAt: now + SHARED_USAGE_TTL,
      observation: { status: "error", errorCode: inFlight ? "in-flight" : "unavailable", value: credits(74), lastSuccess: 1000, lastAttempt: now - 1 },
    }), { mode: 0o600 });
    for (let restart = 0; restart < 2; restart++) {
      const observed = await new SharedUsageCache({ root, now: () => now }).read(source, signal());
      assert.equal(observed.status, "error");
      assert.equal(observed.value, undefined);
      assert.equal(observed.lastSuccess, undefined);
    }
    assert.equal(calls, 0);
  }
});


test("opaque cached error ages out at the return boundary even when its cooldown remains live", async (t) => {
  const root = directory(t), context: UsageScope = { ...scope(), identity: "opaque" };
  let now = 1000 + SHARED_USAGE_TTL - 1, calls = 0;
  const source = reader(context, async () => { calls++; return credits(99); });
  writeFileSync(path.join(root, `${context.key}.json`), JSON.stringify({
    version: 1, key: context.key, generation: context.generation, identity: "opaque", inFlight: false,
    nextRefreshAt: now + SHARED_USAGE_TTL,
    observation: { status: "error", errorCode: "unavailable", value: credits(74), lastSuccess: 1000, lastAttempt: now - 1 },
  }), { mode: 0o600 });
  const cache = new SharedUsageCache({ root, now: () => now });
  assert.deepEqual((await cache.read(source, signal())).value, credits(74));
  now++;
  assert.equal((await cache.read(source, signal())).value, undefined);
  const restarted = await new SharedUsageCache({ root, now: () => now }).read(source, signal());
  assert.equal(restarted.value, undefined);
  assert.equal(restarted.lastSuccess, undefined);
  assert.equal(calls, 0);
});

test("confidence-only transitions clear cached values without changing hash keys or bypassing failure cooldown", async (t) => {
  const root = directory(t), context = scope();
  let now = 1000, calls = 0;
  const source = reader(context, async () => { calls++; if (calls > 1) throw new Error("synthetic-failure"); return credits(74); });
  const cache = new SharedUsageCache({ root, now: () => now });
  const monitor = new ProviderUsageMonitor([source], undefined, cache);
  try {
    await monitor.refresh();
    assert.deepEqual(monitor.snapshot()[0].value, credits(74));
    const hashes = { key: context.key, generation: context.generation };
    context.identity = "opaque"; now++;
    await monitor.refresh();
    assert.equal(monitor.snapshot()[0].value, undefined);
    assert.equal(monitor.snapshot()[0].lastSuccess, undefined);
    context.identity = "known";
    const result = await new SharedUsageCache({ root, now: () => now }).read(source, signal());
    assert.equal(result.value, undefined);
    assert.equal(result.lastSuccess, undefined);
    assert.equal(calls, 2);
    assert.deepEqual({ key: context.key, generation: context.generation }, hashes);
  } finally { monitor.stop(); }
});

test("legacy error records without confidence cannot restore stale values into an identified context", async (t) => {
  const root = directory(t), context = scope();
  const now = 1000 + SHARED_USAGE_TTL + 1;
  let calls = 0;
  const source = reader(context, async () => { calls++; return credits(99); });
  writeFileSync(path.join(root, `${context.key}.json`), JSON.stringify({
    version: 1, key: context.key, generation: context.generation, inFlight: false, nextRefreshAt: now + SHARED_USAGE_TTL,
    observation: { status: "error", errorCode: "unavailable", value: credits(74), lastSuccess: 1000, lastAttempt: now - 1 },
  }), { mode: 0o600 });
  const result = await new SharedUsageCache({ root, now: () => now }).read(source, signal());
  assert.equal(result.status, "error");
  assert.equal(result.value, undefined);
  assert.equal(result.lastSuccess, undefined);
  assert.equal(calls, 0);
});


test("mid-fetch confidence changes discard prior values even when the owner is canceled", async (t) => {
  const root = directory(t), context = scope();
  let now = 1000, cancel = false;
  const controller = new AbortController();
  const source = reader(context, async () => {
    if (cancel) { context.identity = "opaque"; controller.abort(); }
    return credits(74);
  });
  const cache = new SharedUsageCache({ root, now: () => now });
  await cache.read(source, signal());
  now += SHARED_USAGE_TTL; cancel = true;
  const result = await cache.read(source, controller.signal);
  assert.equal(result.status === "error" && result.errorCode, "scope-changed");
  assert.equal(result.value, undefined);
  assert.equal(result.lastSuccess, undefined);
});
