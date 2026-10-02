import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import subagentsExtension from "../subagents.ts";
import { DurableJobStore, durableSessionDirectory } from "../lib/durable-jobs.ts";
import { BackgroundJobRegistry, type StoredBackgroundJob } from "../lib/subagent-background.ts";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

function mock() {
  const tools = new Map<string, any>();
  const handlers = new Map<string, Function[]>();
  const messages: string[] = [];
  const pi = {
    registerTool: (tool: any) => tools.set(tool.name, tool),
    registerCommand: () => {}, registerFlag: () => {}, appendEntry: () => {},
    getActiveTools: () => [...tools.keys()], setActiveTools: () => {},
    getThinkingLevel: () => "off", sendUserMessage: (message: string) => messages.push(message), sendMessage: () => {},
    on: (event: string, handler: Function) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
  } as unknown as ExtensionAPI;
  subagentsExtension(pi);
  const emit = async (event: string, ...args: unknown[]) => { for (const handler of handlers.get(event) ?? []) await handler(...args); };
  return { tools, emit, messages };
}

test("extension reload restores interrupted work and preserves confirmed completion delivery", async () => {
  const base = mkdtempSync(join(tmpdir(), "pi-subagent-lifecycle-"));
  const previousBase = process.env.PI_DURABLE_JOBS_DIR;
  process.env.PI_DURABLE_JOBS_DIR = base;
  const entries: any[] = [];
  const ctx = { cwd: base, hasUI: false, ui: {}, sessionManager: { getSessionId: () => "test-session", getEntries: () => entries } } as unknown as ExtensionContext;
  const store = new DurableJobStore<StoredBackgroundJob>(durableSessionDirectory(ctx, "subagents", randomUUID()));
  const seed = new BackgroundJobRegistry((state) => store.save(state.counter, state.jobs));
  const running = seed.launch({ type: "explore", name: "explore", task: "find it", batchId: "batch", startedAt: 1, resumeParams: { type: "explore", task: "find it", cwd: base } });
  seed.checkpoint(running.id, { output: "saved findings", sessionFilePath: "/audit.jsonl" });
  const complete = seed.launch({ type: "explore", name: "explore", task: "done", batchId: "batch", startedAt: 1 });
  seed.complete(complete.id, { status: "completed", output: "final findings", turns: 1, toolCount: 1, endedAt: 2 });
  const first = mock();
  try {
    await first.emit("session_start", {}, ctx);
    assert.equal(store.load()!.jobs.find((job) => job.id === running.id)?.status, "interrupted");
    assert.equal(first.messages.length, 1);
    assert.match(first.messages[0], /saved findings/);
    assert.match(first.messages[0], /final findings/);
    await first.emit("input", { source: "extension", text: first.messages[0] });
    await first.emit("agent_start");
    assert.ok(store.load()!.jobs.every((job) => !job.delivered), "admission alone cannot acknowledge durable delivery");
    entries.push({ type: "message", message: { role: "user", content: first.messages[0] } });
    await first.emit("agent_settled");
    assert.ok(store.load()!.jobs.every((job) => job.delivered));
    await first.emit("session_shutdown", {}, ctx);
    const second = mock();
    await second.emit("session_start", {}, ctx);
    assert.equal(second.messages.length, 0);
    const status = await second.tools.get("subagent_status").execute("status", { jobId: running.id });
    assert.match(status.content[0].text, /interrupted/);
    // No provider needed: admission succeeds, then missing-model failure is handled.
    const recovery = await second.tools.get("subagent_resume").execute("recover", { jobId: running.id }, undefined, undefined, ctx);
    assert.equal(recovery.details.jobId, "sa-3");
    const duplicateRequest = await second.tools.get("subagent_resume").execute("recover", { jobId: running.id }, undefined, undefined, ctx);
    assert.equal(duplicateRequest.details.jobId, "sa-3", "same recovery request does not launch twice");
    assert.equal(store.load()!.jobs.find((job) => job.id === "sa-3")?.resumedFrom, running.id);
    await assert.rejects(() => second.tools.get("subagent_resume").execute("duplicate", { jobId: running.id }, undefined, undefined, ctx), /already has a recovery run/);
    await second.emit("session_shutdown", {}, ctx);
    // Drain rejected child promises; stale callbacks must not replace interrupted outcomes.
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(store.load()!.jobs.find((job) => job.id === running.id)?.status, "interrupted");
  } finally {
    await first.emit("session_shutdown", {}, ctx);
    if (previousBase === undefined) delete process.env.PI_DURABLE_JOBS_DIR;
    else process.env.PI_DURABLE_JOBS_DIR = previousBase;
    rmSync(base, { recursive: true, force: true });
  }
});

test("wait acknowledges results only after the tool receipt is recorded", async () => {
  const base = mkdtempSync(join(tmpdir(), "pi-subagent-wait-"));
  const previousBase = process.env.PI_DURABLE_JOBS_DIR;
  process.env.PI_DURABLE_JOBS_DIR = base;
  const entries: any[] = [];
  const ctx = { cwd: base, hasUI: false, ui: {}, sessionManager: { getSessionId: () => "wait-session", getEntries: () => entries } } as unknown as ExtensionContext;
  const store = new DurableJobStore<StoredBackgroundJob>(durableSessionDirectory(ctx, "subagents", randomUUID()));
  const seed = new BackgroundJobRegistry((state) => store.save(state.counter, state.jobs));
  const job = seed.launch({ type: "explore", name: "explore", task: "done", batchId: "batch", startedAt: 1 });
  seed.complete(job.id, { status: "completed", output: "retained result", turns: 1, toolCount: 1, endedAt: 2 });
  const pi = mock();
  try {
    await pi.emit("session_start", {}, ctx);
    const result = await pi.tools.get("subagent_wait").execute("wait-call", { jobIds: [job.id] }, undefined);
    assert.equal(store.load()!.jobs[0].delivered, false, "returning alone is not a durable receipt");
    entries.push({ type: "message", message: { role: "toolResult", toolName: "subagent_wait", toolCallId: "wait-call", details: result.details } });
    await pi.emit("agent_settled");
    assert.equal(store.load()!.jobs[0].delivered, true);
    await pi.emit("session_shutdown", {}, ctx);
    const resumed = mock();
    await resumed.emit("session_start", {}, ctx);
    assert.equal(resumed.messages.length, 0);
    await resumed.emit("session_shutdown", {}, ctx);
  } finally {
    await pi.emit("session_shutdown", {}, ctx);
    if (previousBase === undefined) delete process.env.PI_DURABLE_JOBS_DIR;
    else process.env.PI_DURABLE_JOBS_DIR = previousBase;
    rmSync(base, { recursive: true, force: true });
  }
});
