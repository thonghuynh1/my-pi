import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DurableJobStore, durableSessionDirectory } from "../lib/durable-jobs.ts";
import { BackgroundJobRegistry, buildRecoveryTask, type StoredBackgroundJob } from "../lib/subagent-background.ts";
import { replaceFileWithRetry } from "../lib/durable-file.mjs";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

function withStore(run: (store: DurableJobStore<StoredBackgroundJob>) => void) {
  const dir = mkdtempSync(join(tmpdir(), "pi-durable-test-"));
  try { run(new DurableJobStore(dir)); } finally { rmSync(dir, { recursive: true, force: true }); }
}
function launch(registry: BackgroundJobRegistry) {
  return registry.launch({ type: "shell", name: "shell", task: "inspect logs", batchId: "batch", startedAt: 1,
    resumeParams: { type: "shell", task: "inspect logs", cwd: "/workspace" } });
}

test("durable store atomically replaces snapshots and surfaces corruption", () => withStore((store) => {
  assert.equal(store.load(), undefined);
  store.save(1, []);
  store.save(2, []);
  assert.equal(store.load()?.counter, 2);
  assert.deepEqual(readdirSync(store.directory), ["registry.json"]);
  writeFileSync(store.file, "{broken");
  assert.throws(() => store.load());
  writeFileSync(store.file, JSON.stringify({ version: 2, counter: 2, jobs: [] }));
  assert.throws(() => store.load(), /Invalid durable job registry/);
}));

test("scope follows session identity, not repository cwd", () => {
  const ctx = (id: string, cwd: string) => ({ cwd, sessionManager: { getSessionId: () => id } }) as unknown as ExtensionContext;
  assert.equal(durableSessionDirectory(ctx("a", "one"), "bg", "unused"), durableSessionDirectory(ctx("a", "two"), "bg", "unused"));
  assert.notEqual(durableSessionDirectory(ctx("a", "one"), "bg", "unused"), durableSessionDirectory(ctx("b", "one"), "bg", "unused"));
});

test("restart retains output, counters and undelivered results while interrupting unfinished work", () => withStore((store) => {
  const first = new BackgroundJobRegistry((snapshot) => store.save(snapshot.counter, snapshot.jobs));
  const pending = launch(first);
  first.checkpoint(pending.id, { output: "completed read output", turns: 2, toolCount: 3, sessionFilePath: "/audit.jsonl" });
  const done = launch(first);
  first.complete(done.id, { status: "completed", output: "final findings", turns: 1, toolCount: 2, endedAt: 4 });
  const restored = new BackgroundJobRegistry((snapshot) => store.save(snapshot.counter, snapshot.jobs));
  restored.restore(store.load()!, 10);
  assert.equal(restored.get(pending.id)?.status, "interrupted");
  assert.equal(restored.get(pending.id)?.output, "completed read output");
  assert.equal(restored.get(pending.id)?.sessionFilePath, "/audit.jsonl");
  assert.equal(restored.get(done.id)?.status, "completed");
  assert.equal(restored.get(done.id)?.output, "final findings");
  assert.equal(restored.undelivered().length, 2);
  assert.equal(launch(restored).id, "sa-3");
  assert.equal("abort" in store.load()!.jobs[0], false);
}));

test("confirmed delivery and cancellation persist across restart", () => withStore((store) => {
  const registry = new BackgroundJobRegistry((snapshot) => store.save(snapshot.counter, snapshot.jobs));
  const done = launch(registry);
  registry.complete(done.id, { status: "completed", output: "result", turns: 0, toolCount: 0, endedAt: 2 });
  registry.markDelivered([done.id]);
  const cancelled = launch(registry);
  registry.cancel(cancelled.id);
  const restored = new BackgroundJobRegistry();
  restored.restore(store.load()!, 4);
  assert.equal(restored.get(done.id)?.delivered, true);
  assert.equal(restored.get(cancelled.id)?.status, "cancelled");
}));

test("graceful shutdown retains checkpoint and rejects a stale completion", () => {
  const registry = new BackgroundJobRegistry();
  const job = launch(registry);
  registry.checkpoint(job.id, { output: "partial findings" });
  registry.interruptRunning(2);
  assert.equal(job.abort.signal.aborted, true);
  assert.equal(job.status, "interrupted");
  registry.complete(job.id, { status: "completed", output: "stale", turns: 3, toolCount: 4, endedAt: 5 });
  assert.equal(job.output, "partial findings");
  assert.equal(job.delivered, false);
});

test("failed admission does not launch or retain an uncommitted task", () => {
  const registry = new BackgroundJobRegistry(() => { throw new Error("disk full"); });
  assert.throws(() => launch(registry), /disk full/);
  assert.equal(registry.list().length, 0);
});

test("recovery handoff preserves task and checkpoint, and warns about uncertain side effects", () => {
  const job = launch(new BackgroundJobRegistry());
  job.output = "read showed config X";
  const prompt = buildRecoveryTask(job);
  assert.match(prompt, /inspect logs/);
  assert.match(prompt, /read showed config X/);
  assert.match(prompt, /Do NOT blindly repeat/);
  assert.match(prompt, /side effects/);
});

test("failed commits roll back completion, delivery and shutdown state", () => {
  let fail = false;
  const registry = new BackgroundJobRegistry(() => { if (fail) throw new Error("disk full"); });
  const job = launch(registry);
  registry.checkpoint(job.id, { output: "known checkpoint" });
  fail = true;
  assert.throws(() => registry.complete(job.id, { status: "completed", output: "uncommitted", turns: 1, toolCount: 2, endedAt: 3 }), /disk full/);
  assert.equal(job.status, "running");
  assert.equal(job.output, "known checkpoint");
  assert.throws(() => registry.markDelivered([job.id]), /disk full/);
  assert.equal(job.delivered, false);
  assert.throws(() => registry.interruptRunning(4), /disk full/);
  assert.equal(job.status, "running", "memory must retain last committed state");
  assert.equal(job.abort.signal.aborted, true, "shutdown still aborts live children on storage failure");
});

test("Windows transient replacement locks retry without removing committed data", () => {
  let attempts = 0;
  let clock = 0;
  const delays: number[] = [];
  replaceFileWithRetry("source", "destination", {
    platform: "win32", now: () => clock, maxWaitMs: 100,
    pause: (ms) => { delays.push(ms); clock += ms; },
    rename: () => { if (++attempts < 3) throw Object.assign(new Error("reader lock"), { code: "EPERM" }); },
  });
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [5, 10]);
});

test("replacement retry is bounded and does not retry non-sharing errors", () => {
  let clock = 0;
  let attempts = 0;
  assert.throws(() => replaceFileWithRetry("source", "destination", {
    platform: "win32", now: () => clock, maxWaitMs: 10,
    pause: (ms) => { clock += ms; },
    rename: () => { attempts++; throw Object.assign(new Error("locked"), { code: "EPERM" }); },
  }), /locked/);
  assert.equal(clock, 10);
  assert.equal(attempts, 3);
  assert.throws(() => replaceFileWithRetry("source", "destination", {
    platform: "win32", pause: () => { throw new Error("must not retry"); },
    rename: () => { throw Object.assign(new Error("disk full"), { code: "ENOSPC" }); },
  }), /disk full/);
});
