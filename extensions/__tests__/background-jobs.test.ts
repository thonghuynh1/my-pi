import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const storage = mkdtempSync(join(tmpdir(), "pi-bg-test-"));
process.env.PI_DURABLE_JOBS_DIR = storage;
after(() => rmSync(storage, { recursive: true, force: true }));
import backgroundJobsExtension, { piExtension } from "../background-jobs.ts";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

interface MockPi {
  tools: Map<string, any>;
  commands: Map<string, any>;
  listeners: Map<string, Array<(...args: any[]) => any>>;
  sentMessages: Array<{ message: string; options?: any }>;
  activeTools: string[];
}

function createMockPi(): MockPi & ExtensionAPI {
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  const listeners = new Map<string, Array<(...args: any[]) => any>>();
  const sentMessages: Array<{ message: string; options?: any }> = [];
  let activeTools: string[] = [];

  const mock: any = {
    tools,
    commands,
    listeners,
    sentMessages,
    get activeTools() {
      return [...activeTools];
    },
    registerTool(tool: any) {
      tools.set(tool.name, tool);
      if (!activeTools.includes(tool.name)) activeTools.push(tool.name);
    },
    registerCommand(name: string, options: any) {
      commands.set(name, options);
    },
    getActiveTools() {
      return [...activeTools];
    },
    setActiveTools(names: string[]) {
      activeTools = [...names];
    },
    on(event: string, handler: (...args: any[]) => any) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(handler);
    },
    sendUserMessage(message: string, options?: any) {
      sentMessages.push({ message, options });
    },
    emit(event: string, ...args: any[]) {
      const handlers = listeners.get(event) ?? [];
      return Promise.all(handlers.map((h) => h(...args)));
    },
  };

  return mock;
}

function createMockContext(): ExtensionContext {
  const sessionId = randomUUID();
  const entries: any[] = [];
  return {
    sessionManager: { getSessionId: () => sessionId, getEntries: () => entries },
    cwd: process.cwd(),
    hasUI: true,
    ui: {
      notify: () => {},
      setWidget: () => {},
      setStatus: () => {},
      confirm: async () => true,
      select: async () => undefined,
      input: async () => undefined,
      custom: async () => undefined,
    } as any,
  } as unknown as ExtensionContext;
}

test("background-jobs extension registers expected tools and commands", () => {
  const pi = createMockPi();
  backgroundJobsExtension(pi);

  assert.equal(piExtension.id, "background-jobs");
  assert.ok(pi.tools.has("bg_run"), "bg_run should be registered");
  assert.ok(pi.tools.has("bg_status"), "bg_status should be registered");
  assert.ok(pi.tools.has("bg_list"), "bg_list should be registered");
  assert.ok(pi.tools.has("bg_kill"), "bg_kill should be registered");
  assert.ok(pi.tools.has("bg_input"), "bg_input should be registered");
  assert.ok(pi.commands.has("jobs"), "/jobs command should be registered");
});

test("bg_run executes a quick command and resolves immediately with running status", async () => {
  const pi = createMockPi();
  backgroundJobsExtension(pi);

  const ctx = createMockContext();
  const bgRun = pi.tools.get("bg_run");
  const bgStatus = pi.tools.get("bg_status");
  const bgList = pi.tools.get("bg_list");

  // Run a quick echo command
  const runResult = await bgRun.execute(
    "call-1",
    { command: "node -e \"console.log('hello from bg')\"" },
    new AbortController().signal,
    () => {},
    ctx,
  );

  assert.equal(runResult.details.status, "running");
  const jobId = runResult.details.jobId;
  assert.ok(jobId, "Should return a jobId");

  // Immediate bg_list should include the job
  const listResult = await bgList.execute(
    "call-2",
    {},
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(listResult.content[0].text.includes(jobId));

  // Wait for the quick process to finish
  await awaitTerminal(pi, ctx, jobId);

  // Check status after finish
  const statusResult = await bgStatus.execute(
    "call-3",
    { jobId },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(
    statusResult.content[0].text.includes("COMPLETED"),
    `Expected completed status but got: ${statusResult.content[0].text}`,
  );
  assert.ok(statusResult.content[0].text.includes("hello from bg"));

  // Check that pi.sendUserMessage was called to wake Pi
  assert.ok(
    pi.sentMessages.some((m) => m.message.includes(jobId) && m.message.includes("COMPLETED")),
    "Should notify agent with followUp message on completion",
  );
});

test("bg_kill terminates a running process", async () => {
  const pi = createMockPi();
  backgroundJobsExtension(pi);

  const ctx = createMockContext();
  const bgRun = pi.tools.get("bg_run");
  const bgKill = pi.tools.get("bg_kill");

  // Run a long sleep
  const runResult = await bgRun.execute(
    "call-4",
    { command: "node -e \"setTimeout(() => {}, 30000)\"" },
    new AbortController().signal,
    () => {},
    ctx,
  );

  const jobId = runResult.details.jobId;
  const killResult = await bgKill.execute(
    "call-5",
    { jobId },
    new AbortController().signal,
    () => {},
    ctx,
  );

  assert.ok(killResult.content[0].text.includes("Termination requested"));
  assert.equal(killResult.details.status, "kill_requested");
  assert.equal((await awaitTerminal(pi, ctx, jobId)).details.status, "killed");
});

test("/jobs command handles list, tail, and clear", async () => {
  const pi = createMockPi();
  backgroundJobsExtension(pi);

  const notifications: string[] = [];
  const ctx = {
    ...createMockContext(),
    ui: {
      notify: (msg: string) => notifications.push(msg),
    },
  } as any;

  const bgRun = pi.tools.get("bg_run");
  await bgRun.execute(
    "call-6",
    { command: "node -e \"console.log('command output line')\"" },
    new AbortController().signal,
    () => {},
    ctx,
  );

  await awaitTerminal(pi, ctx, "bg-1");

  const jobsCmd = pi.commands.get("jobs");
  assert.ok(jobsCmd, "/jobs command should exist");

  // /jobs list
  await jobsCmd.handler("list", ctx);
  assert.ok(notifications.some((n) => n.includes("Background Jobs:") && n.includes("bg-1")));

  // /jobs tail bg-1
  await jobsCmd.handler("tail bg-1 10", ctx);
  assert.ok(notifications.some((n) => n.includes("command output line")));

  // /jobs clear
  await jobsCmd.handler("clear", ctx);
  assert.ok(notifications.some((n) => n.includes("Cleared 1 finished background jobs")));
});

test("bg_run executes shell-native echo via cmd/sh (matches run_tests path)", async () => {
  const pi = createMockPi();
  backgroundJobsExtension(pi);

  const ctx = createMockContext();
  const bgRun = pi.tools.get("bg_run");
  const bgStatus = pi.tools.get("bg_status");

  // Windows bg_run uses cmd.exe /c — avoid bash-only syntax like $BASH_VERSION.
  const command = process.platform === "win32"
    ? "echo bg-shell-ok"
    : "echo bg-shell-ok && pwd";

  const runResult = await bgRun.execute(
    "call-7",
    { command },
    new AbortController().signal,
    () => {},
    ctx,
  );

  assert.equal(runResult.details.status, "running", `Expected running start, got: ${JSON.stringify(runResult)}`);
  const jobId = runResult.details.jobId;
  await awaitTerminal(pi, ctx, jobId);

  const statusResult = await bgStatus.execute(
    "call-8",
    { jobId },
    new AbortController().signal,
    () => {},
    ctx,
  );

  assert.ok(statusResult.content[0].text.includes("COMPLETED"), `Expected COMPLETED but got: ${statusResult.content[0].text}`);
  assert.ok(statusResult.content[0].text.includes("bg-shell-ok"), `Expected output, got: ${statusResult.content[0].text}`);
});

test("before_agent_start injects background jobs protocol", () => {
  const pi = createMockPi();
  backgroundJobsExtension(pi);

  const beforeAgentStart = pi.listeners.get("before_agent_start")?.[0];
  assert.ok(beforeAgentStart, "before_agent_start listener should be registered");

  const result = beforeAgentStart({ systemPrompt: "Base prompt" });
  assert.ok(result.systemPrompt.includes("=== Background Jobs Protocol ==="));
  assert.ok(result.systemPrompt.includes("NEVER call `sleep`/`timeout`/`Start-Sleep` in bash"));
  assert.ok(result.systemPrompt.includes("NEVER call `bg_status` or `bg_list` in a loop"));
});

test("tool_call intercepts and blocks sleep commands while jobs are running", async () => {
  const pi = createMockPi();
  backgroundJobsExtension(pi);

  const ctx = createMockContext();
  const toolCallHandler = pi.listeners.get("tool_call")?.[0];
  assert.ok(toolCallHandler, "tool_call listener should be registered");

  // When no jobs are running, sleep is not blocked
  const noJobResult = await toolCallHandler({ toolName: "bash", input: { command: "sleep 10" } }, ctx);
  assert.equal(noJobResult, undefined);

  // Start a long-running job
  const bgRun = pi.tools.get("bg_run");
  const runResult = await bgRun.execute(
    "call-long",
    { command: "node -e \"setTimeout(() => {}, 30000)\"" },
    new AbortController().signal,
    () => {},
    ctx,
  );

  // Now sleep 180 should be blocked!
  const blockedResult = await toolCallHandler(
    { toolName: "bash", input: { command: "sleep 180; python check.py" } },
    ctx,
  );
  assert.ok(blockedResult?.block, "Should block sleep command while jobs are running");
  assert.ok(blockedResult?.reason?.includes("BLOCKED: Do not use 'sleep'"));

  // Non-sleep bash commands should NOT be blocked
  const normalResult = await toolCallHandler(
    { toolName: "bash", input: { command: "git status" } },
    ctx,
  );
  assert.equal(normalResult, undefined);

  // Clean up
  const bgKill = pi.tools.get("bg_kill");
  await bgKill.execute("kill-long", { jobId: runResult.details.jobId }, new AbortController().signal, () => {}, ctx);
  await awaitTerminal(pi, ctx, runResult.details.jobId);
});




/** Internal test synchronization only; agent-facing tools must never poll. */
async function awaitTerminal(pi: MockPi, ctx: ExtensionContext, jobId: string): Promise<any> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await pi.tools.get("bg_status").execute("test-status", { jobId }, undefined, undefined, ctx);
    if (result.details.status !== "running") return result;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Job did not settle: " + jobId);
}

test("jobs survive parent shutdown, restore output and ids, and keep sessions isolated", async () => {
  const first = createMockPi();
  backgroundJobsExtension(first);
  const ctx = createMockContext();
  const result = await first.tools.get("bg_run").execute("launch", {
    command: `node -e "setTimeout(() => console.log('survived-host'), 500)"`,
  }, undefined, undefined, ctx);
  await (first as any).emit("session_shutdown", {}, ctx);
  const restored = createMockPi();
  backgroundJobsExtension(restored);
  await (restored as any).emit("session_start", {}, ctx);
  const outcome = await awaitTerminal(restored, ctx, result.details.jobId);
  assert.equal(outcome.details.status, "completed");
  assert.match(outcome.content[0].text, /survived-host/);
  assert.ok(restored.sentMessages.some((message) => message.message.includes("COMPLETED")));
  // Confirm the notification before reopening again.
  await (restored as any).emit("input", { source: "extension", text: restored.sentMessages[0].message });
  await (restored as any).emit("agent_start");
  (ctx.sessionManager.getEntries() as any[]).push({ type: "message", message: { role: "user", content: restored.sentMessages[0].message } });
  await (restored as any).emit("agent_settled");
  await (restored as any).emit("session_shutdown", {}, ctx);
  const again = createMockPi();
  backgroundJobsExtension(again);
  await (again as any).emit("session_start", {}, ctx);
  assert.equal(again.sentMessages.length, 0, "confirmed completion is not redelivered");
  const next = await again.tools.get("bg_run").execute("next", { command: "echo next", notifyOnFinish: false }, undefined, undefined, ctx);
  assert.equal(next.details.jobId, "bg-2");
  const duplicate = await again.tools.get("bg_run").execute("next", { command: "echo next", notifyOnFinish: false }, undefined, undefined, ctx);
  assert.equal(duplicate.details.jobId, "bg-2", "same request ID must not execute a second command");
  await awaitTerminal(again, ctx, "bg-2");
  const otherCtx = createMockContext();
  const other = await again.tools.get("bg_list").execute("other", {}, undefined, undefined, otherCtx);
  assert.equal(other.details.total, 0);
  await (again as any).emit("session_shutdown", {}, otherCtx);
});

test("timeout remains enforced by supervisor after host shutdown", async () => {
  const pi = createMockPi();
  backgroundJobsExtension(pi);
  const ctx = createMockContext();
  const result = await pi.tools.get("bg_run").execute("timeout", {
    command: `node -e "setTimeout(() => {}, 30000)"`, timeoutSeconds: 0.5, notifyOnFinish: false,
  }, undefined, undefined, ctx);
  await (pi as any).emit("session_shutdown", {}, ctx);
  const resumed = createMockPi();
  backgroundJobsExtension(resumed);
  assert.equal((await awaitTerminal(resumed, ctx, result.details.jobId)).details.status, "timed_out");
  await (resumed as any).emit("session_shutdown", {}, ctx);
});

test("stdin controls work after reconnecting to the supervisor", async () => {
  const pi = createMockPi();
  backgroundJobsExtension(pi);
  const ctx = createMockContext();
  const result = await pi.tools.get("bg_run").execute("stdin", {
    command: `node -e "process.stdin.once('data', d => { console.log(d.toString().trim()); process.exit(0); })"`,
  }, undefined, undefined, ctx);
  await (pi as any).emit("session_shutdown", {}, ctx);
  const resumed = createMockPi();
  backgroundJobsExtension(resumed);
  await resumed.tools.get("bg_input").execute("input", { jobId: result.details.jobId, input: "durable-stdin" }, undefined, undefined, ctx);
  const outcome = await awaitTerminal(resumed, ctx, result.details.jobId);
  assert.equal(outcome.details.status, "completed", outcome.content[0].text);
  assert.match(outcome.content[0].text, /durable-stdin/);
  await (resumed as any).emit("session_shutdown", {}, ctx);
});

test("unconfirmed completion is redelivered after reopening", async () => {
  const pi = createMockPi();
  backgroundJobsExtension(pi);
  const ctx = createMockContext();
  const run = await pi.tools.get("bg_run").execute("launch", { command: "echo recovered-notification" }, undefined, undefined, ctx);
  await awaitTerminal(pi, ctx, run.details.jobId);
  await (pi as any).emit("session_shutdown", {}, ctx);
  const resumed = createMockPi();
  backgroundJobsExtension(resumed);
  await (resumed as any).emit("session_start", {}, ctx);
  assert.ok(resumed.sentMessages.some((message) => message.message.includes(run.details.jobId)));
  await (resumed as any).emit("session_shutdown", {}, ctx);
});
