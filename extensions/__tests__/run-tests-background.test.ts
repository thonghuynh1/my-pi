import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createEventBus, type ExtensionContext } from "@earendil-works/pi-coding-agent";

const storage = mkdtempSync(join(tmpdir(), "pi-run-tests-bg-"));
process.env.PI_DURABLE_JOBS_DIR = storage;
process.env.PI_RUN_TESTS_WAIT_MS = "1500";
after(() => rmSync(storage, { recursive: true, force: true }));

const { default: backgroundJobsExtension } = await import("../background-jobs.ts");
const { default: runTestsExtension } = await import("../run-tests.ts");

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean; details?: { jobId?: string } };

function createPi() {
	const tools = new Map<string, any>();
	const listeners = new Map<string, Array<(...args: any[]) => any>>();
	const sentMessages: string[] = [];
	let activeTools: string[] = [];
	const pi: any = {
		tools,
		sentMessages,
		events: createEventBus(),
		registerTool(tool: any) {
			tools.set(tool.name, tool);
			if (!activeTools.includes(tool.name)) activeTools.push(tool.name);
		},
		registerCommand() {},
		getActiveTools: () => [...activeTools],
		setActiveTools: (names: string[]) => { activeTools = [...names]; },
		on(event: string, handler: (...args: any[]) => any) {
			if (!listeners.has(event)) listeners.set(event, []);
			listeners.get(event)!.push(handler);
		},
		emit(event: string, ...args: any[]) {
			return Promise.all((listeners.get(event) ?? []).map((handler) => handler(...args)));
		},
		sendUserMessage(message: string) { sentMessages.push(message); },
		async exec() { throw new Error("run_tests must not use pi.exec when background jobs are available"); },
	};
	backgroundJobsExtension(pi);
	runTestsExtension(pi);
	return pi;
}

function createContext(): ExtensionContext {
	const sessionId = randomUUID();
	return {
		sessionManager: { getSessionId: () => sessionId, getEntries: () => [] },
		cwd: process.cwd(),
		hasUI: false,
		ui: { notify() {}, setWidget() {}, setStatus() {} },
	} as unknown as ExtensionContext;
}

async function runTests(pi: any, ctx: ExtensionContext, command: string, signal?: AbortSignal): Promise<ToolResult> {
	return pi.tools.get("run_tests").execute(randomUUID(), { command }, signal, () => {}, ctx);
}

async function eventually(check: () => boolean, label: string, timeoutMs = 20_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!check()) {
		if (Date.now() > deadline) assert.fail(`timed out waiting for: ${label}`);
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}

test("run_tests returns the compact result when the background run finishes in the wait window", async () => {
	const pi = createPi();
	const ctx = createContext();

	const result = await runTests(pi, ctx, `node -e "console.log('3 tests passed')"`);

	assert.match(result.content[0]!.text, /^✅ 3 tests passed/);
	await new Promise((resolve) => setTimeout(resolve, 1000));
	assert.deepEqual(pi.sentMessages, [], "a result already returned must not be delivered again");
	await pi.emit("session_shutdown", {}, ctx);
});

test("run_tests reports a failing background run as failed", async () => {
	const pi = createPi();
	const ctx = createContext();

	const result = await runTests(pi, ctx, `node -e "console.log('boom'); process.exit(2)"`);

	assert.match(result.content[0]!.text, /^❌ Tests failed \(exit 2/);
	await pi.emit("session_shutdown", {}, ctx);
});

test("run_tests hands a long run to the background job and the agent is notified when it finishes", async () => {
	const pi = createPi();
	const ctx = createContext();

	const result = await runTests(pi, ctx, `node -e "setTimeout(() => console.log('9 tests passed'), 3000)"`);
	const text = result.content[0]!.text;
	const jobId = result.details?.jobId;

	assert.equal(text.includes("✅"), false);
	assert.match(text, /still running as background job bg-\d+/);
	assert.match(text, /not a pass/);
	assert.ok(jobId, "the job id is returned so the agent can refer to it");
	await eventually(
		() => pi.sentMessages.some((message: string) => message.includes(`[Background Job ${jobId} COMPLETED]`) && message.includes("9 tests passed")),
		"completion delivered to the agent",
	);
	await pi.emit("session_shutdown", {}, ctx);
});

test("aborting run_tests stops the background job", async () => {
	const pi = createPi();
	const ctx = createContext();
	const controller = new AbortController();
	setTimeout(() => controller.abort(), 500);

	const result = await runTests(pi, ctx, `node -e "setTimeout(() => {}, 30000)"`, controller.signal);
	const jobId = result.details?.jobId;

	assert.equal(result.isError, true);
	assert.match(result.content[0]!.text, /aborted/);
	const status = async () => (await pi.tools.get("bg_status").execute("s", { jobId }, undefined, undefined, ctx)).content[0].text as string;
	let last = "";
	await eventually(() => { void status().then((text) => { last = text; }); return /KILLED/.test(last); }, "job killed");
	await pi.emit("session_shutdown", {}, ctx);
});
