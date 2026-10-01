/**
 * Pure tests for background subagent logic (extensions/lib/subagent-background.ts).
 *
 * Run: npx tsx --test extensions/__tests__/subagents-background.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
	BackgroundJobRegistry,
	DELIVERY_HEADER,
	SMART_JOIN_GRACE_MS,
	clampWaitSeconds,
	formatDeliveryMessage,
	longTtlWanted,
	resolveWaitTargets,
	selectDeliverable,
	selectWaitResults,
	shouldApplyLongCacheTtl,
	withLongCacheTtl,
} from "../lib/subagent-background.ts";

const identity = (text: string) => text;

function launch(registry: BackgroundJobRegistry, batchId: string, startedAt = 0, task = "do a thing") {
	return registry.launch({ type: "explore", name: "explore", task, batchId, startedAt });
}

function finish(registry: BackgroundJobRegistry, id: string, endedAt: number, output = `out ${id}`) {
	return registry.complete(id, { status: "completed", output, turns: 2, toolCount: 3, endedAt });
}

test("job ids are monotonic and never reuse after clear", () => {
	const registry = new BackgroundJobRegistry();
	const a = launch(registry, "t1");
	const b = launch(registry, "t1");
	assert.equal(a.id, "sa-1");
	assert.equal(b.id, "sa-2");
	registry.abortAllAndClear();
	assert.equal(registry.list().length, 0);
	const c = launch(registry, "t2");
	assert.equal(c.id, "sa-3");
	assert.equal(a.abort.signal.aborted, true);
});

test("smart join holds completed members while siblings run, releases when batch finishes", () => {
	const registry = new BackgroundJobRegistry();
	const a = launch(registry, "t1");
	const b = launch(registry, "t1");
	finish(registry, a.id, 1_000);
	let sel = selectDeliverable(registry.list(), 1_500);
	assert.deepEqual(sel.ready, []);
	assert.equal(sel.nextCheckAt, 1_000 + SMART_JOIN_GRACE_MS);
	finish(registry, b.id, 2_000);
	sel = selectDeliverable(registry.list(), 2_000);
	assert.deepEqual(sel.ready.map((j) => j.id), [a.id, b.id]);
	assert.equal(sel.nextCheckAt, undefined);
});

test("smart join releases after 30s grace even with running siblings", () => {
	const registry = new BackgroundJobRegistry();
	const a = launch(registry, "t1");
	launch(registry, "t1");
	finish(registry, a.id, 1_000);
	assert.deepEqual(selectDeliverable(registry.list(), 1_000 + SMART_JOIN_GRACE_MS - 1).ready, []);
	assert.deepEqual(selectDeliverable(registry.list(), 1_000 + SMART_JOIN_GRACE_MS).ready.map((j) => j.id), [a.id]);
});

test("jobs from different batches do not hold each other", () => {
	const registry = new BackgroundJobRegistry();
	const a = launch(registry, "t1");
	launch(registry, "t2");
	finish(registry, a.id, 1_000);
	assert.deepEqual(selectDeliverable(registry.list(), 1_001).ready.map((j) => j.id), [a.id]);
});

test("ready jobs are never dropped while the caller cannot deliver (busy)", () => {
	const registry = new BackgroundJobRegistry();
	const a = launch(registry, "t1");
	finish(registry, a.id, 1_000);
	// Simulate several busy flush attempts that do not mark delivered.
	for (const now of [1_000, 40_000, 100_000]) {
		assert.deepEqual(selectDeliverable(registry.list(), now).ready.map((j) => j.id), [a.id]);
	}
	registry.markDelivered([a.id]);
	assert.deepEqual(selectDeliverable(registry.list(), 200_000).ready, []);
});

test("subagent_wait results are excluded from the follow-up delivery", () => {
	const registry = new BackgroundJobRegistry();
	const a = launch(registry, "t1");
	const b = launch(registry, "t1");
	finish(registry, a.id, 1_000);
	const targets = resolveWaitTargets(registry);
	assert.deepEqual(targets.map((j) => j.id), [a.id, b.id]);
	const sel = selectWaitResults(registry, targets);
	assert.deepEqual(sel.finished.map((j) => j.id), [a.id]);
	assert.deepEqual(sel.stillRunning.map((j) => j.id), [b.id]);
	registry.markDelivered(sel.finished.map((j) => j.id));
	finish(registry, b.id, 2_000);
	assert.deepEqual(selectDeliverable(registry.list(), 2_000).ready.map((j) => j.id), [b.id]);
	// Explicit ids: delivered and unknown are reported separately.
	const again = selectWaitResults(registry, resolveWaitTargets(registry, [a.id, "sa-99"]), [a.id, "sa-99"]);
	assert.deepEqual(again.alreadyDelivered.map((j) => j.id), [a.id]);
	assert.deepEqual(again.unknownIds, ["sa-99"]);
});

test("cancel marks job cancelled on completion and aborts its signal", () => {
	const registry = new BackgroundJobRegistry();
	const a = launch(registry, "t1");
	assert.equal(registry.cancel(a.id), true);
	assert.equal(a.abort.signal.aborted, true);
	registry.complete(a.id, { status: "error", output: "partial", error: "Subagent was aborted.", turns: 1, toolCount: 0, endedAt: 5 });
	assert.equal(registry.get(a.id)?.status, "cancelled");
	assert.equal(registry.cancel(a.id), false);
});

test("delivery formatting is deterministic and self-describing", () => {
	const registry = new BackgroundJobRegistry();
	const longTask = "x".repeat(300);
	const a = launch(registry, "t1", 1_000, longTask);
	registry.complete(a.id, { status: "error", output: "boom output", error: "Subagent timed out", turns: 1, toolCount: 0, endedAt: 13_400 });
	const b = launch(registry, "t1", 2_000, "short task");
	finish(registry, b.id, 4_000, "result body");
	const text = formatDeliveryMessage([a, b], identity);
	assert.equal(text, formatDeliveryMessage([a, b], identity));
	assert.ok(text.startsWith(`${DELIVERY_HEADER}\n\n`));
	assert.ok(text.includes(`--- sa-1 (explore:explore) ---\nTask: ${"x".repeat(200)}...\nStatus: failed\nDuration: 12s\nError: Subagent timed out\n\nboom output`));
	assert.ok(text.includes("--- sa-2 (explore:explore) ---\nTask: short task\nStatus: completed\nDuration: 2s\n\nresult body"));
	assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(text));
	const truncated = formatDeliveryMessage([b], (t) => `[T]${t}`);
	assert.ok(truncated.endsWith("[T]result body"));
});

test("clampWaitSeconds defaults and clamps", () => {
	assert.equal(clampWaitSeconds(undefined), 120);
	assert.equal(clampWaitSeconds(-5), 120);
	assert.equal(clampWaitSeconds(30), 30);
	assert.equal(clampWaitSeconds(999), 240);
});

function samplePayload() {
	const shared = { type: "ephemeral" };
	return {
		model: "claude",
		system: [{ type: "text", text: "sys", cache_control: shared }],
		tools: [
			{ name: "a", input_schema: { type: "object" } },
			{ name: "b", input_schema: { type: "object" }, cache_control: shared },
		],
		messages: [
			{ role: "user", content: [{ type: "text", text: "hi", cache_control: { type: "ephemeral", ttl: "5m" } }] },
			{ role: "assistant", content: "plain" },
			{ role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "r", cache_control: shared }] },
		],
	};
}

test("TTL rewrite adds ttl only to ephemeral cache_control without ttl, on a deep copy", () => {
	const payload = samplePayload();
	const before = JSON.stringify(payload);
	const out = withLongCacheTtl(payload) as ReturnType<typeof samplePayload>;
	assert.ok(out);
	assert.equal(JSON.stringify(payload), before, "original must not be mutated");
	assert.deepEqual(out.system[0].cache_control, { type: "ephemeral", ttl: "1h" });
	assert.deepEqual(out.tools[1].cache_control, { type: "ephemeral", ttl: "1h" });
	assert.equal((out.tools[0] as { cache_control?: unknown }).cache_control, undefined);
	assert.deepEqual(out.messages[0].content[0], { type: "text", text: "hi", cache_control: { type: "ephemeral", ttl: "5m" } });
	assert.deepEqual((out.messages[2].content as Array<{ cache_control?: unknown }>)[0].cache_control, { type: "ephemeral", ttl: "1h" });
	assert.notEqual(out.system[0].cache_control, out.tools[1].cache_control);
	// Copy-on-write: untouched messages/blocks are shared, changed paths are new.
	assert.equal(out.messages[0], payload.messages[0]);
	assert.notEqual(out.messages[2], payload.messages[2]);
	assert.notEqual(out.system, payload.system);
	// Already-long payload: no change.
	assert.equal(withLongCacheTtl(out), undefined);
	assert.equal(withLongCacheTtl(null), undefined);
});

test("shouldApplyLongCacheTtl gates on api, window, env, and compat", () => {
	const base = { api: "anthropic-messages", supportsLongCacheRetention: undefined, windowActive: true, optOutEnv: undefined };
	assert.equal(shouldApplyLongCacheTtl(base), true);
	assert.equal(shouldApplyLongCacheTtl({ ...base, api: "openai-responses" }), false);
	assert.equal(shouldApplyLongCacheTtl({ ...base, api: undefined }), false);
	assert.equal(shouldApplyLongCacheTtl({ ...base, windowActive: false }), false);
	for (const off of ["0", "false", "no", "OFF"]) assert.equal(shouldApplyLongCacheTtl({ ...base, optOutEnv: off }), false);
	assert.equal(shouldApplyLongCacheTtl({ ...base, optOutEnv: "1" }), true);
	assert.equal(shouldApplyLongCacheTtl({ ...base, supportsLongCacheRetention: false }), false);
	assert.equal(shouldApplyLongCacheTtl({ ...base, supportsLongCacheRetention: true }), true);
});

test("long-TTL policy: 1h only while background jobs are running", () => {
	assert.equal(longTtlWanted({ running: 0 }), false, "idle / delivery turns use the default TTL");
	assert.equal(longTtlWanted({ running: 1 }), true);
	assert.equal(longTtlWanted({ running: 6 }), true);
});

test("cancel racing a successful completion keeps the real status", () => {
	const registry = new BackgroundJobRegistry();
	const ok = launch(registry, "t1");
	registry.cancel(ok.id);
	registry.complete(ok.id, { status: "completed", output: "done", turns: 1, toolCount: 0, endedAt: 1 });
	assert.equal(registry.get(ok.id)?.status, "completed");
	const aborted = launch(registry, "t1");
	registry.cancel(aborted.id);
	registry.complete(aborted.id, { status: "error", output: "", error: "aborted", turns: 1, toolCount: 0, endedAt: 1 });
	assert.equal(registry.get(aborted.id)?.status, "cancelled");
});

test("abortAllAndClear finalizes running jobs and notifies waiters", () => {
	const registry = new BackgroundJobRegistry();
	const running = launch(registry, "t1");
	const seen: string[] = [];
	registry.onChange((job) => seen.push(`${job.id}:${job.status}`));
	const targets = resolveWaitTargets(registry);
	registry.abortAllAndClear(5);
	assert.deepEqual(seen, [`${running.id}:cancelled`]);
	assert.equal(running.abort.signal.aborted, true);
	const sel = selectWaitResults(registry, targets, [running.id]);
	assert.deepEqual(sel.cleared.map((j) => j.id), [running.id]);
	assert.deepEqual(sel.stillRunning, []);
	assert.deepEqual(sel.unknownIds, []);
	assert.equal(registry.list().length, 0);
});
