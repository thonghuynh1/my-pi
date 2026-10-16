import assert from "node:assert/strict";
import { test } from "node:test";
import { ProviderUsageMonitor, type MonitorClock } from "../lib/provider-usage/monitor.ts";
import { UsageReadError, type ProviderReader } from "../lib/provider-usage/readers.ts";
import { footerRows, type UsageMetric } from "../lib/provider-usage/model.ts";

class Clock implements MonitorClock {
  time = 1_000;
  next = 0;
  tasks = new Map<number, { at: number; interval?: number; callback(): void }>();
  now = () => this.time;
  every = (callback: () => void, ms: number) => { const id = ++this.next; this.tasks.set(id, { at: this.time + ms, interval: ms, callback }); return id; };
  after = (callback: () => void, ms: number) => { const id = ++this.next; this.tasks.set(id, { at: this.time + ms, callback }); return id; };
  cancelEvery = (id: unknown) => { this.tasks.delete(id as number); };
  cancelAfter = this.cancelEvery;
  advance(ms: number) {
    const end = this.time + ms;
    while (true) {
      const first = [...this.tasks].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!first) break;
      const [id, task] = first;
      this.time = task.at;
      if (task.interval) task.at += task.interval;
      else this.tasks.delete(id);
      task.callback();
    }
    this.time = end;
  }
  intervals() { return [...this.tasks.values()].filter((task) => task.interval).length; }
}
const credits = (consumed = 54386): UsageMetric => ({ kind: "credits", consumed });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("no factory resources; initial async refresh, 5-minute cadence and idempotent start/stop", async () => {
  const clock = new Clock();
  let calls = 0;
  const monitor = new ProviderUsageMonitor([{ id: "copilot", name: "GitHub Copilot", read: async () => { calls++; return credits(); } }], clock);
  assert.equal(clock.tasks.size, 0);
  assert.equal(calls, 0);
  assert.equal(monitor.snapshot()[0].value, undefined);
  monitor.start(); monitor.start();
  assert.equal(clock.intervals(), 1);
  assert.equal(monitor.snapshot()[0].status, "loading");
  await flush();
  assert.equal(calls, 1);
  assert.equal(monitor.snapshot()[0].lastSuccess, 1000);
  clock.advance(299_999); await flush();
  assert.equal(calls, 1);
  clock.advance(1); await flush();
  assert.equal(calls, 2);
  monitor.stop(); monitor.stop();
  assert.equal(clock.tasks.size, 0);
  clock.advance(900_000); await flush();
  assert.equal(calls, 2);
});

test("manual refresh and timer refresh share coalesced per-provider work", async () => {
  const clock = new Clock();
  const pending = deferred<UsageMetric>();
  let calls = 0;
  const monitor = new ProviderUsageMonitor([{ id: "codex", name: "Codex", read: () => { calls++; return pending.promise; } }], clock);
  monitor.start();
  const manual = monitor.refresh();
  const manualAgain = monitor.refresh();
  await flush();
  assert.equal(calls, 1);
  pending.resolve(credits());
  await Promise.all([manual, manualAgain]);
  assert.equal(monitor.snapshot()[0].status, "available");
  clock.advance(300_000); await flush();
  assert.equal(calls, 2);
  assert.equal(clock.intervals(), 1);
  monitor.stop();
});

test("providers complete independently; failure preserves stale successful value and strips raw errors", async () => {
  const clock = new Clock();
  let fail = false;
  const slow = deferred<UsageMetric>();
  const readers: ProviderReader[] = [
    { id: "codex", name: "Codex", read: async () => { if (fail) throw new Error("raw secret account response"); return credits(1); } },
    { id: "copilot", name: "Copilot", read: () => slow.promise },
  ];
  const monitor = new ProviderUsageMonitor(readers, clock);
  const first = monitor.refresh();
  await flush();
  assert.equal(monitor.snapshot()[0].status, "available");
  assert.equal(monitor.snapshot()[1].status, "loading");
  slow.resolve(credits(54386)); await first;
  fail = true;
  clock.advance(5);
  await monitor.refresh();
  const state = monitor.snapshot()[0];
  assert.equal(state.status, "error");
  assert.deepEqual(state.value, credits(1));
  assert.equal(state.lastSuccess, 1000);
  assert.equal(state.lastAttempt, 1005);
  assert(!JSON.stringify(monitor.snapshot()).includes("secret"));
  assert.match(footerRows(monitor.snapshot())[0], /stale/);
  assert.equal(monitor.snapshot()[1].status, "available");
  monitor.stop();
});

test("30s deadline aborts hung reader and retains stale data; initial failure remains unavailable", async () => {
  const clock = new Clock();
  let hang = false;
  let aborted = false;
  const monitor = new ProviderUsageMonitor([
    { id: "codex", name: "Codex", read: async (signal) => {
      if (!hang) return credits(1);
      signal.addEventListener("abort", () => { aborted = true; });
      return new Promise<UsageMetric>(() => {});
    } },
    { id: "antigravity", name: "Antigravity", read: async () => { throw new UsageReadError("CLI not installed or not on PATH"); } },
  ], clock);
  await monitor.refresh();
  assert.equal(monitor.snapshot()[1].value, undefined);
  hang = true;
  const pending = monitor.refresh();
  await flush();
  clock.advance(30_000);
  await pending;
  assert.equal(aborted, true);
  assert.equal(monitor.snapshot()[0].status, "error");
  assert.match(monitor.snapshot()[0].error!, /timed out/);
  assert.deepEqual(monitor.snapshot()[0].value, credits(1));
  monitor.stop();
  assert.equal(clock.tasks.size, 0);
});

test("stop/restart invalidates late readers, notifications, and old pending finalizers", async () => {
  const clock = new Clock();
  const first = deferred<UsageMetric>();
  const second = deferred<UsageMetric>();
  let reads = 0;
  let notifications = 0;
  const monitor = new ProviderUsageMonitor([{ id: "copilot", name: "Copilot", read: () => (++reads === 1 ? first : second).promise }], clock);
  const unsubscribe = monitor.subscribe(() => { notifications++; });
  monitor.start(); await flush();
  monitor.stop();
  const stoppedNotifications = notifications;
  first.resolve(credits(1)); await flush();
  assert.equal(notifications, stoppedNotifications);
  assert.equal(monitor.snapshot()[0].value, undefined);
  monitor.start(); await flush();
  assert.equal(reads, 2);
  const manual = monitor.refresh();
  await flush(); assert.equal(reads, 2);
  second.resolve(credits(2)); await manual;
  assert.deepEqual(monitor.snapshot()[0].value, credits(2));
  unsubscribe();
  const previous = notifications;
  await monitor.refresh();
  assert.equal(notifications, previous);
  monitor.stop();
  assert.equal(clock.intervals(), 0);
});

test("manual refresh while stopped never enables periodic polling", async () => {
  const clock = new Clock();
  let calls = 0;
  const monitor = new ProviderUsageMonitor([{ id: "copilot", name: "Copilot", read: async () => { calls++; return credits(); } }], clock);
  monitor.stop();
  await monitor.refresh();
  assert.equal(calls, 1);
  assert.equal(clock.tasks.size, 0);
  clock.advance(600_000); await flush();
  assert.equal(calls, 1);
});
