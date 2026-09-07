import assert from "node:assert/strict";
import { test } from "node:test";
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
      for (const h of handlers) h(...args);
    },
  };

  return mock;
}

function createMockContext(): ExtensionContext {
  return {
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
  await new Promise((r) => setTimeout(r, 600));

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

  assert.ok(killResult.content[0].text.includes("Successfully killed"));
  assert.equal(killResult.details.status, "killed");
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

  await new Promise((r) => setTimeout(r, 600));

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

test("bg_run executes bash commands with unix paths", async () => {
  const pi = createMockPi();
  backgroundJobsExtension(pi);

  const ctx = createMockContext();
  const bgRun = pi.tools.get("bg_run");
  const bgStatus = pi.tools.get("bg_status");

  const runResult = await bgRun.execute(
    "call-7",
    { command: "echo $BASH_VERSION && pwd" },
    new AbortController().signal,
    () => {},
    ctx,
  );

  const jobId = runResult.details.jobId;
  await new Promise((r) => setTimeout(r, 600));

  const statusResult = await bgStatus.execute(
    "call-8",
    { jobId },
    new AbortController().signal,
    () => {},
    ctx,
  );

  assert.ok(statusResult.content[0].text.includes("COMPLETED"), `Expected COMPLETED but got: ${statusResult.content[0].text}`);
});

test("before_agent_start injects background jobs protocol", () => {
  const pi = createMockPi();
  backgroundJobsExtension(pi);

  const beforeAgentStart = pi.listeners.get("before_agent_start")?.[0];
  assert.ok(beforeAgentStart, "before_agent_start listener should be registered");

  const result = beforeAgentStart({ systemPrompt: "Base prompt" });
  assert.ok(result.systemPrompt.includes("=== Background Jobs Protocol ==="));
  assert.ok(result.systemPrompt.includes("NEVER call `sleep` in `bash`"));
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
});



