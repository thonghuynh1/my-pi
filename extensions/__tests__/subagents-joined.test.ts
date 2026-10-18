import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, type ServerResponse } from "node:http";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, renameSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createAgentSessionServices, createAgentSessionFromServices, ModelRuntime, ModelRegistry, SessionManager, createEventBus, VERSION,
	type ExtensionAPI, type ExtensionContext, type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import backgroundJobsExtension from "../background-jobs.ts";
import { supportsNativeCacheWarming } from "../lib/background-cache-warming.ts";
import subagents, { type SubagentSdk } from "../subagents.ts";
import { DurableJobStore, durableSessionDirectory } from "../lib/durable-jobs.ts";
import { type StoredBackgroundJob } from "../lib/subagent-background.ts";
import { childContextPolicy } from "../lib/subagent-context.ts";

function deferred() {
	let resolve: () => void = () => {};
	const promise = new Promise<void>((done) => { resolve = done; });
	return { promise, resolve };
}
const tick = () => new Promise<void>((done) => setImmediate(done));
function record(value: unknown): Record<string, unknown> {
	assert.ok(value && typeof value === "object" && !Array.isArray(value));
	// Registered SDK tools return unknown details at this public boundary.
	return value as Record<string, unknown>;
}
function text(result: Awaited<ReturnType<ToolDefinition["execute"]>>): string {
	return result.content.filter((part) => part.type === "text").map((part) => part.text).join("~");
}

async function fixture(options: { commandsOrder?: "before" | "after"; creationGate?: ReturnType<typeof deferred>; cleanupGate?: ReturnType<typeof deferred>; window?: number; afterDispose?: () => void; workflow?: boolean; reasoning?: boolean } = {}) {
	const base = mkdtempSync(join(tmpdir(), "pi-subagent-sdk-"));
	const prior = process.env.PI_DURABLE_JOBS_DIR;
	process.env.PI_DURABLE_JOBS_DIR = base;
	const requests: Array<{ body: Record<string, unknown>; response: ServerResponse }> = [];
	const requestWaiters: Array<() => void> = [];
	const server = createServer(async (request, response) => {
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(Buffer.from(chunk));
		const body: unknown = JSON.parse(Buffer.concat(chunks).toString());
		requests.push({ body: record(body), response });
		for (const done of requestWaiters.splice(0)) done();
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const runtime = await ModelRuntime.create({ authPath: join(base, "auth.json"), modelsPath: null, refreshOnCreate: false });
	runtime.registerProvider("subagent-test", {
		api: "openai-completions", apiKey: "local-test-only", baseUrl: `http://127.0.0.1:${address.port}/v1`,
		models: [{ id: "scripted", name: "Scripted", reasoning: options.reasoning ?? false, thinkingLevelMap: options.reasoning ? { xhigh: null, max: null } : undefined, input: ["text"],
			cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 }, contextWindow: options.window ?? 100_000, maxTokens: 1024,
			compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, supportsUsageInStreaming: true },
		}],
	});
	const model = runtime.getModel("subagent-test", "scripted");
	assert.ok(model);
	const tools = new Map<string, ToolDefinition>();
	const handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();
	const deliveries: string[] = [];
	let created = 0;
	let disposed = 0;
	let cleanupStarted = 0;
	const creationStarted = deferred();
	const childSettings: Array<ReturnType<typeof childContextPolicy>["compaction"]> = [];
	const childThinkingLevels: string[] = [];
	const parents: Array<Awaited<ReturnType<typeof createAgentSessionFromServices>>["session"]> = [];
	const sdk: SubagentSdk = {
		async createServices(input) {
			const services = await createAgentSessionServices({ ...input, agentDir: base, modelRuntime: runtime });
			childSettings.push(services.settingsManager.getCompactionSettings());
			return services;
		},
		async createSession(input) {
			childThinkingLevels.push(input.thinkingLevel);
			creationStarted.resolve();
			await options.creationGate?.promise;
			const result = await createAgentSessionFromServices(input);
			created++;
			const abort = result.session.abort.bind(result.session);
			result.session.abort = async () => { cleanupStarted++; await options.cleanupGate?.promise; await abort(); };
			const dispose = result.session.dispose.bind(result.session);
			result.session.dispose = () => { disposed++; dispose(); options.afterDispose?.(); };
			return result;
		},
	};
	const pi = {
		events: createEventBus(),
		registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool), registerFlag: () => {}, getFlag: () => options.workflow !== false,
		registerCommand: () => {}, appendEntry: () => {}, getActiveTools: () => [...tools.keys()], setActiveTools: () => {},
		getThinkingLevel: () => "off", sendUserMessage: (message: string) => deliveries.push(message), sendMessage: () => {},
		on: (name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
	} as unknown as ExtensionAPI;
	const sessionManager = SessionManager.inMemory(base);
	const ctx = { cwd: base, hasUI: false, ui: {}, sessionManager, model, modelRegistry: new ModelRegistry(runtime) } as unknown as ExtensionContext;
	async function emit(event: string, value: unknown = {}) {
		const results: unknown[] = [];
		for (const handler of handlers.get(event) ?? []) results.push(await handler(value, ctx));
		return results;
	}
	async function startFreshExtension() {
		tools.clear(); handlers.clear();
		if (options.commandsOrder === "before") backgroundJobsExtension(pi);
		subagents({ ...pi }, sdk);
		if (options.commandsOrder === "after") backgroundJobsExtension(pi);
		await emit("session_start");
		await emit("agent_start");
	}
	await startFreshExtension();
	const store = new DurableJobStore<StoredBackgroundJob>(durableSessionDirectory(ctx, "subagents", "unused"));
	async function call(name: string, id: string, args: Record<string, unknown>, signal?: AbortSignal) {
		const tool = tools.get(name);
		assert.ok(tool);
		return tool.execute(id, args, signal, undefined, ctx);
	}
	async function requestCount(count: number) {
		while (requests.length < count) await new Promise<void>((done, reject) => {
			const timer = setTimeout(() => reject(new Error(`Expected ${count} provider requests, received ${requests.length}: ${JSON.stringify(requests.map((request) => request.body.messages)).slice(-2000)}`)), 10_000);
			requestWaiters.push(() => { clearTimeout(timer); done(); });
		});
	}
	function reply(index: number, content: string, input = 100, output = 10, toolCalls?: unknown[]) {
		const response = requests[index].response;
		response.writeHead(200, { "content-type": "text/event-stream" });
		const chunk = (choices: unknown[], usage?: unknown) => response.write(`data: ${JSON.stringify({ id: "local", object: "chat.completion.chunk", created: 1, model: "scripted", choices, usage })}` + String.fromCharCode(10, 10));
		chunk([{ index: 0, delta: { role: "assistant", content, ...(toolCalls ? { tool_calls: toolCalls } : {}) }, finish_reason: null }]);
		chunk([{ index: 0, delta: {}, finish_reason: toolCalls ? "tool_calls" : "stop" }]);
		chunk([], { prompt_tokens: input, completion_tokens: output, total_tokens: input + output });
		response.end("data: [DONE]" + String.fromCharCode(10, 10));
	}
	async function createParent() {
		const subagentTool = tools.get("subagent");
		assert.ok(subagentTool);
		const services = await createAgentSessionServices({ cwd: base, agentDir: base, modelRuntime: runtime, resourceLoaderOptions: { noExtensions: true } });
		const { session } = await createAgentSessionFromServices({
			services, model, thinkingLevel: "off", sessionManager: SessionManager.inMemory(base), tools: ["subagent"],
			customTools: [{ ...subagentTool, execute: (id, args, signal) => call("subagent", id, record(args), signal) }],
		});
		parents.push(session);
		return session;
	}
	async function close() {
		options.creationGate?.resolve(); options.cleanupGate?.resolve();
		const parentAborts = parents.map((parent) => parent.abort());
		await emit("session_shutdown");
		server.closeAllConnections();
		await Promise.allSettled(parentAborts);
		for (const parent of parents) parent.dispose();
		await new Promise<void>((done) => server.close(() => done()));
		if (prior === undefined) delete process.env.PI_DURABLE_JOBS_DIR; else process.env.PI_DURABLE_JOBS_DIR = prior;
		rmSync(base, { recursive: true, force: true });
	}
	function fail(index: number) {
		requests[index].response.writeHead(400, { "content-type": "application/json" });
		requests[index].response.end(JSON.stringify({ error: { message: "Scripted provider failure", type: "invalid_request_error" } }));
	}
	function index(task: string) { return requests.findIndex((request) => JSON.stringify(request.body).includes(`Task: ${task}`) || JSON.stringify(request.body).includes(`Parent task: ${task}`)); }
	return { base, tools, call, emit, startFreshExtension, requests, requestCount, reply, fail, index, close, createParent, store, deliveries, childSettings, sessionManager, childThinkingLevels, creationStarted: creationStarted.promise,
		get created() { return created; }, get disposed() { return disposed; }, get cleanupStarted() { return cleanupStarted; },
	};
}


test("fresh agent guidance includes the capability guide in tool metadata and startup prompt", async (t) => {
	const f = await fixture();
	t.after(() => f.close());
	for (let startup = 0; startup < 2; startup++) {
		const tool = f.tools.get("subagent");
		assert.ok(tool);
		const guide = tool.promptGuidelines?.join("\n") ?? "";
		for (const contract of [
			/mode=joined/, /mode=detached/, /subagent_followup/, /latest.*job ID/, /Promise\.all/,
			/shared filesystem/, /no extensions/, /50k.*target.*not.*ceiling/, /6.*slots/, /subagent_resume.*user/,
		]) assert.match(guide, contract);
		const [injected] = await f.emit("before_agent_start", { systemPrompt: "PARENT_BASE" });
		const prompt = record(injected).systemPrompt;
		assert.equal(typeof prompt, "string");
		assert.ok(String(prompt).startsWith("PARENT_BASE"));
		for (const line of tool.promptGuidelines ?? []) assert.ok(String(prompt).includes(line));
		assert.equal(f.created, 0, "instructions do not launch work");
		if (startup === 0) { await f.emit("session_shutdown"); await f.startFreshExtension(); }
	}
});

test("model thinking suffix reaches child sessions and an omitted suffix inherits the parent level", { timeout: 15_000 }, async (t) => {
	const f = await fixture({ reasoning: true });
	t.after(() => f.close());
	const explicit = f.call("subagent", "thinking-high", { type: "explore", task: "thinking high", model: "subagent-test/scripted:high" });
	const inherited = f.call("subagent", "thinking-parent", { type: "explore", task: "thinking parent", model: "subagent-test/scripted" });
	const unsupported = f.call("subagent", "thinking-unsupported", { type: "explore", task: "thinking unsupported", model: "subagent-test/scripted:xhigh" });
	await f.requestCount(3);
	assert.deepEqual([...f.childThinkingLevels].sort(), ["high", "off", "off"]);
	f.reply(f.index("thinking high"), "high complete");
	f.reply(f.index("thinking parent"), "parent complete");
	f.reply(f.index("thinking unsupported"), "unsupported fell back");
	await Promise.all([explicit, inherited, unsupported]);
});

test("workflow-off guidance removes coaching but keeps the joined tool contract", async (t) => {
	const f = await fixture({ workflow: false });
	t.after(() => f.close());
	const tool = f.tools.get("subagent");
	assert.ok(tool);
	assert.match(tool.description, /Joined by default/);
	assert.equal(tool.promptSnippet, "");
	assert.deepEqual(tool.promptGuidelines, []);
	assert.deepEqual(await f.emit("before_agent_start", { systemPrompt: "PARENT_BASE" }), [undefined]);
});

test("omitted/legacy modes admit synchronously, dedupe before shared capacity, never fallback foreground", { timeout: 20_000 }, async (t) => {
	const creationGate = deferred();
	const f = await fixture({ creationGate });
	t.after(() => f.close());
	let settled = false;
	const joined = f.call("subagent", "default", { type: "explore", task: "default" }).then((result) => { settled = true; return result; });
	assert.equal(f.store.load()!.jobs[0].mode, "joined");
	const detached = await f.call("subagent", "legacy-true", { type: "explore", task: "optional", background: true });
	assert.equal(record(detached.details).mode, "detached");
	const explicit = f.call("subagent", "legacy-false", { type: "explore", task: "required", background: false });
	const packet = { version: 1, packetId: "p", groupId: "g", claims: [{ id: "c", summary: "verify", priority: "normal" }], anchors: [{ path: "file", line: 1, symbol: "f" }], shape: { fileCount: 1, anchorCount: 1, subsystem: "test", crossFileFlow: false } };
	const packetJoined = f.call("subagent", "packet-joined", { type: "explore", task: "packet required", evidencePacket: packet });
	const packetDetached = await f.call("subagent", "packet-detached", { type: "explore", task: "packet optional", evidencePacket: packet, mode: "detached" });
	assert.equal(record(packetDetached.details).mode, "detached");
	await f.call("subagent", "six", { type: "explore", task: "six", mode: "detached" });
	await assert.rejects(f.call("subagent", "conflict", { type: "explore", task: "x", mode: "joined", background: true }), /disagree/);
	await assert.rejects(f.call("subagent", "conflict2", { type: "explore", task: "x", mode: "detached", background: false }), /disagree/);
	await assert.rejects(f.call("subagent", "seven", { type: "explore", task: "seven" }), /capacity/);
	const joinedDuplicate = f.call("subagent", "default", { type: "explore", task: "default" });
	const duplicate = await f.call("subagent", "legacy-true", { type: "explore", task: "optional", background: true });
	assert.equal(record(duplicate.details).jobId, record(detached.details).jobId);
	assert.equal(f.store.load()!.jobs.length, 6);
	assert.equal(f.created, 0);
	await tick(); assert.equal(settled, false);
	creationGate.resolve();
	await f.requestCount(6);
	for (let i = 0; i < 6; i++) f.reply(i, "finished");
	const joinedResults = await Promise.all([joined, joinedDuplicate, explicit, packetJoined]);
	assert.equal(record(joinedResults[0].details).jobId, record(joinedResults[1].details).jobId);
	await f.call("subagent_wait", "wait", {});
	assert.equal(f.created, 6);
	assert.equal(f.disposed, 6);
});

test("joined required calls and mixed parallel batch stay pending through child cleanup", { timeout: 15_000 }, async (t) => {
	const cleanupGate = deferred();
	const f = await fixture({ cleanupGate });
	t.after(() => f.close());
	let resumed = false;
	const first = f.call("subagent", "one", { type: "explore", task: "required one" });
	const second = f.call("subagent", "two", { type: "explore", task: "required two" });
	const optional = f.call("subagent", "three", { type: "explore", task: "optional three", mode: "detached" });
	const batch = Promise.all([first, second, optional]).then((results) => { resumed = true; return results; });
	await optional;
	await f.requestCount(3);
	f.reply(f.index("required one"), "one report"); f.reply(f.index("required two"), "two report"); f.reply(f.index("optional three"), "optional report");
	while (f.cleanupStarted < 3) await tick();
	assert.equal(resumed, false);
	assert.equal(f.disposed, 0);
	assert.ok(f.store.load()!.jobs.every((job) => job.status === "running"));
	cleanupGate.resolve();
	const results = await batch;
	assert.equal(f.disposed, 3);
	assert.equal(record(results[0].details).mode, "joined");
	assert.equal(record(results[0].details).status, "completed");
	await f.call("subagent_wait", "all", {});
	await f.emit("agent_settled");
	assert.equal(f.deliveries.length, 1);
	assert.match(f.deliveries[0], /optional report/);
	assert.doesNotMatch(f.deliveries[0], /required one|required two/);
	assert.ok(f.store.load()!.jobs.filter((job) => job.mode === "joined").every((job) => !job.delivered));
});

test("joined completion returns the real report with a durability warning when terminal save fails", { timeout: 15_000 }, async (t) => {
	let failSave = () => {};
	const f = await fixture({ afterDispose: () => failSave() });
	const backup = `${f.store.file}.before-failure`;
	t.after(async () => {
		if (existsSync(backup)) {
			rmSync(f.store.file, { recursive: true, force: true });
			renameSync(backup, f.store.file);
		}
		await f.close();
	});
	failSave = () => {
		renameSync(f.store.file, backup);
		mkdirSync(f.store.file);
		failSave = () => {};
	};
	const joined = f.call("subagent", "save-fails", { type: "explore", task: "required report" });
	await f.requestCount(1); f.reply(0, "ACTUAL_REPORT_AFTER_CLEANUP");
	const result = await joined;
	assert.equal(f.disposed, 1);
	assert.equal(record(result.details).status, "completed");
	assert.ok(typeof record(result.details).persistenceError === "string");
	assert.match(text(result), /ACTUAL_REPORT_AFTER_CLEANUP/);
	assert.match(text(result), /Completion persistence failed/);
	const status = await f.call("subagent_status", "unconfirmed-snapshot", { jobId: record(result.details).jobId });
	assert.match(text(status), /snapshot unconfirmed/);
	const waited = await f.call("subagent_wait", "read-memory-report", { jobIds: [record(result.details).jobId], timeoutSeconds: 1 });
	assert.deepEqual(record(waited.details).stillRunning, []);
	assert.match(text(waited), /ACTUAL_REPORT_AFTER_CLEANUP/);
	f.sessionManager.appendMessage({ role: "toolResult", toolCallId: "save-fails", toolName: "subagent", content: result.content, details: result.details, isError: false, timestamp: Date.now() });
	await f.emit("agent_settled");
});

test("wait any vs all and timeout/abort stop only waiting, never children", { timeout: 15_000 }, async (t) => {
	const f = await fixture(); t.after(() => f.close());
	const a = await f.call("subagent", "a", { type: "explore", task: "a", mode: "detached" });
	const b = await f.call("subagent", "b", { type: "explore", task: "b", mode: "detached" });
	const ids = [record(a.details).jobId, record(b.details).jobId];
	await f.requestCount(2);
	assert.match(text(await f.call("subagent_wait", "unknown-any", { jobIds: ["sa-unknown"], waitFor: "any" })), /Unknown job ids/);
	let allDone = false;
	const all = f.call("subagent_wait", "all", { jobIds: ids }).then((value) => { allDone = true; return value; });
	const any = f.call("subagent_wait", "any", { jobIds: ids, waitFor: "any" });
	f.reply(f.index("a"), "first outcome");
	const result = await any;
	assert.match(text(result), /first outcome/);
	assert.equal(record(result.details).waitFor, "any");
	assert.equal(allDone, false);
	const timeout = await f.call("subagent_wait", "timeout", { jobIds: [ids[1]], timeoutSeconds: 1 });
	assert.match(text(timeout), /Still running.*detached/);
	assert.equal(f.store.load()!.jobs[1].status, "running");
	assert.equal(f.store.load()!.jobs[1].cancelRequested, false);
	const abort = new AbortController();
	const waiting = f.call("subagent_wait", "abort-wait", { jobIds: [ids[1]] }, abort.signal);
	abort.abort();
	assert.match(text(await waiting), /wait aborted/);
	assert.equal(f.store.load()!.jobs[1].cancelRequested, false);
	f.reply(f.index("b"), "last outcome");
	assert.match(text(await all), /last outcome/);
});

test("follow-up rejects coercible malformed configuration restored from disk", { timeout: 20_000 }, async (t) => {
	const f = await fixture(); t.after(() => f.close());
	const initial = f.call("subagent", "valid-source", { type: "explore", task: "Remember a fact" });
	await f.requestCount(1); f.reply(0, "Saved fact");
	const first = record((await initial).details);
	const validSnapshot = JSON.stringify(f.store.load());
	for (const field of ["type", "thinkingLevel"] as const) {
		await f.emit("session_shutdown");
		const snapshot = record(JSON.parse(validSnapshot));
		assert.ok(Array.isArray(snapshot.jobs));
		const config = record(record(record(snapshot.jobs[0]).reuse).config);
		config[field] = [config[field]];
		writeFileSync(f.store.file, JSON.stringify(snapshot));
		await f.startFreshExtension();
		const abort = new AbortController();
		const timer = setTimeout(() => abort.abort(), 1_000);
		try {
			await assert.rejects(f.call("subagent_followup", `invalid-${field}`, { jobId: first.jobId, task: "Use that fact" }, abort.signal), /Only successful normal children/);
		} finally { clearTimeout(timer); }
	}
	assert.equal(f.created, 1);
	assert.equal(f.requests.length, 1);
});

test("explicit follow-up reopens history with saved config and bills only its segment; ancestor concurrency rejected", { timeout: 20_000 }, async (t) => {
	const f = await fixture(); t.after(() => f.close());
	const initial = f.call("subagent", "first", { type: "explore", task: "Remember the original goal" });
	await f.requestCount(1); f.reply(0, "Earlier fact: SECRET_FACT_42", 100, 10);
	const first = record((await initial).details);
	assert.equal(first.status, "completed");
	assert.ok(typeof first.transcript === "string");
	mkdirSync(join(f.base, ".pi", "agents"), { recursive: true });
	writeFileSync(join(f.base, ".pi", "agents", "models.json"), JSON.stringify({ subagents: { default: "changed/unavailable-model" } }));
	const next = f.call("subagent_followup", "next", { jobId: first.jobId, task: "Use the earlier fact" });
	await f.requestCount(2);
	assert.match(JSON.stringify(f.requests[1].body), /SECRET_FACT_42/);
	assert.equal(f.requests[1].body.model, "scripted");
	await assert.rejects(f.call("subagent_followup", "parallel", { jobId: first.jobId, task: "overlap" }), /lineage.*in use/);
	f.reply(1, "Using SECRET_FACT_42", 200, 20);
	const second = record((await next).details);
	assert.equal(second.transcript, first.transcript);
	assert.equal(second.followedFrom, first.jobId);
	assert.equal(record(second.usage).inputTokens, 200);
	assert.equal(record(second.usage).outputTokens, 20);
	assert.equal(record(second.usage).totalTokens, 220);
	assert.ok(Math.abs(Number(record(second.usage).costUsd) - 0.00024) < 1e-8);
	const third = f.call("subagent_followup", "third", { jobId: second.jobId, task: "third assignment" });
	await f.requestCount(3);
	await assert.rejects(f.call("subagent_followup", "via-ancestor", { jobId: first.jobId, task: "ancestor overlap" }), /lineage.*in use/);
	f.reply(2, "Third report"); await third;
	await assert.rejects(f.call("subagent_followup", "unknown", { jobId: "sa-no", task: "x" }), /Unknown/);
	await assert.rejects(f.call("subagent_followup", "ancestor", { jobId: first.jobId, task: "x" }), /latest lineage/);
});


test("failed follow-up lineage fails closed with an explicit reviewed-handoff path", { timeout: 15_000 }, async (t) => {
	const f = await fixture(); t.after(() => f.close());
	const initial = f.call("subagent", "lineage-source", { type: "explore", task: "Remember facts" });
	await f.requestCount(1); f.reply(0, "Fact survives in audit");
	const first = record((await initial).details);
	const followup = f.call("subagent_followup", "lineage-fails", { jobId: first.jobId, task: "Related work" });
	await f.requestCount(2); f.fail(1);
	const failed = record((await followup).details);
	assert.equal(failed.status, "error");
	await assert.rejects(f.call("subagent_followup", "old-source", { jobId: first.jobId, task: "Retry" }), /latest.*failed.*new child.*reviewed handoff/i);
	await assert.rejects(f.call("subagent_followup", "failed-source", { jobId: failed.jobId, task: "Retry" }), /Only successful/);
	assert.equal(f.created, 2);
});

test("interrupted custom-agent follow-up keeps its agent name for explicit fresh recovery", { timeout: 20_000 }, async (t) => {
	const f = await fixture(); t.after(() => f.close());
	const agentDir = join(f.base, ".pi", "agents");
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(join(agentDir, "memory-owner.md"), "---\nname: memory-owner\ndescription: Test memory owner\ntools: read\n---\nRetain the earlier facts.");
	const initial = f.call("subagent", "custom-source", { type: "custom", customAgent: "memory-owner", task: "Remember facts" });
	await f.requestCount(1); f.reply(0, "Original custom fact");
	const first = record((await initial).details);
	const followup = f.call("subagent_followup", "custom-followup", { jobId: first.jobId, task: "Related custom check" });
	await f.requestCount(2);
	await f.emit("session_shutdown");
	const interrupted = record((await followup).details);
	assert.equal(f.store.load()!.jobs[1].status, "interrupted");
	await f.startFreshExtension();
	assert.equal(f.created, 2);
	const recovery = await f.call("subagent_resume", "recover-custom", { jobId: interrupted.jobId });
	await f.requestCount(3); f.reply(2, "Reviewed explicit recovery");
	const waited = await f.call("subagent_wait", "custom-recovery-result", { jobIds: [record(recovery.details).jobId] });
	assert.match(text(waited), /Reviewed explicit recovery/);
	assert.equal(record(f.store.load()!.jobs[2].resumeParams).customAgent, "memory-owner");
});

test("bounded native child compaction is enabled independently of main settings and includes summary billing", { timeout: 20_000 }, async (t) => {
	const f = await fixture(); t.after(() => f.close());
	writeFileSync(join(f.base, "settings.json"), JSON.stringify({ compaction: { enabled: false, keepRecentTokens: 99_000 } }));
	const run = f.call("subagent", "compact", { type: "explore", task: "Preserve ORIGINAL_GOAL" });
	await f.requestCount(1);
	assert.deepEqual(f.childSettings[0], { enabled: true, reserveTokens: 50_000, keepRecentTokens: 12_000 });
	f.reply(0, "evidence ".repeat(9000), 55_000, 100);
	await f.requestCount(2);
	f.reply(1, "Goal: ORIGINAL_GOAL; evidence remains in audit transcript", 500, 50);
	const details = record((await run).details);
	assert.equal(details.status, "completed");
	assert.equal(record(details.usage).inputTokens, 55_500);
	assert.equal(record(details.usage).outputTokens, 150);
	assert.equal(record(details.context).tokens, null, "post-compaction context is unknown, not false zero");
	assert.equal(record(details.context).budget, 50_000);
	assert.match(readFileSync(String(details.transcript), "utf8"), /"type":"compaction"/);
	const next = f.call("subagent_followup", "after-compact", { jobId: details.jobId, task: "Next explicit assignment" });
	await f.requestCount(3);
	assert.match(JSON.stringify(f.requests[2].body), /Fresh-session handoff, NOT full conversation memory/);
	f.reply(2, "Fresh reviewed report");
	assert.equal(record(record((await next).details).context).reset, "unsafe-context");
	assert.deepEqual(childContextPolicy(2048), { budget: 1536, compaction: { enabled: true, reserveTokens: 512, keepRecentTokens: 384 } });
});

test("three-assignment rollover keeps bounded goal/report/pointer handoff and retains full old transcript", { timeout: 20_000 }, async (t) => {
	const f = await fixture(); t.after(() => f.close());
	let result = f.call("subagent", "first", { type: "explore", task: "ORIGINAL_GOAL" });
	await f.requestCount(1); f.reply(0, "Fact A");
	let previous = record((await result).details);
	const originalPath = previous.transcript;
	for (let segment = 2; segment <= 3; segment++) {
		result = f.call("subagent_followup", `segment-${segment}`, { jobId: previous.jobId, task: `Assignment ${segment}` });
		await f.requestCount(segment);
		f.reply(segment - 1, segment === 3 ? "LATEST_REPORT:" + "x".repeat(9000) + "OMITTED_REPORT_TAIL" : "Fact B");
		previous = record((await result).details);
		assert.equal(previous.transcript, originalPath);
	}
	const before = readFileSync(String(originalPath), "utf8");
	const fourth = f.call("subagent_followup", "fourth", { jobId: previous.jobId, task: "Assignment 4" });
	await f.requestCount(4);
	const messages = f.requests[3].body.messages;
	assert.ok(Array.isArray(messages));
	const userMessages = messages.filter((message) => record(message).role === "user");
	assert.equal(userMessages.length, 1, "rollover starts a fresh conversation, not the old history");
	const handoff = JSON.stringify(record(userMessages[0]).content);
	assert.match(handoff, /Fresh-session handoff/);
	assert.match(handoff, /ORIGINAL_GOAL/);
	assert.match(handoff, /LATEST_REPORT/);
	assert.doesNotMatch(handoff, /OMITTED_REPORT_TAIL/);
	assert.ok(handoff.length < 20_000);
	f.reply(3, "Generation two");
	const details = record((await fourth).details);
	assert.notEqual(details.transcript, originalPath);
	assert.equal(record(details.context).reset, "assignment-limit");
	assert.equal(record(details.reuse).assignments, 1);
	assert.equal(record(details.reuse).generation, 2);
	assert.equal(readFileSync(String(originalPath), "utf8"), before);
});

test("one-MiB rollover and unavailable transcript fail closed", { timeout: 15_000 }, async (t) => {
	const f = await fixture(); t.after(() => f.close());
	const initial = f.call("subagent", "raw", { type: "explore", task: "Raw transcript goal" });
	await f.requestCount(1); f.reply(0, "Report");
	const first = record((await initial).details);
	appendFileSync(String(first.transcript), JSON.stringify({ type: "custom", id: "large-audit", parentId: null, timestamp: new Date().toISOString(), customType: "audit", data: "x".repeat(1024 * 1024) }) + String.fromCharCode(10));
	const next = f.call("subagent_followup", "large-next", { jobId: first.jobId, task: "Related task" });
	await f.requestCount(2); f.reply(1, "Fresh report");
	const details = record((await next).details);
	assert.equal(record(details.context).reset, "transcript-limit");
	assert.notEqual(details.transcript, first.transcript);
	rmSync(String(details.transcript));
	await assert.rejects(f.call("subagent_followup", "missing", { jobId: details.jobId, task: "Related" }), /transcript is unavailable/);
});

test("joined cancellation during delayed SDK construction awaits abort/disposal, without prompting or orphaning", { timeout: 15_000 }, async (t) => {
	const creationGate = deferred(); const cleanupGate = deferred();
	const f = await fixture({ creationGate, cleanupGate }); t.after(() => f.close());
	const controller = new AbortController(); let returned = false;
	const run = f.call("subagent", "cancel", { type: "explore", task: "cancel before prompt" }, controller.signal).then((value) => { returned = true; return value; });
	await f.creationStarted;
	controller.abort();
	assert.equal(f.store.load()!.jobs[0].cancelRequested, true);
	creationGate.resolve();
	while (f.cleanupStarted < 1) await tick();
	assert.equal(returned, false);
	assert.equal(f.disposed, 0);
	assert.equal(f.requests.length, 0);
	cleanupGate.resolve();
	const details = record((await run).details);
	assert.equal(details.status, "error");
	assert.equal(f.disposed, 1);
	assert.equal(f.store.load()!.jobs[0].status, "cancelled");
	await assert.rejects(f.call("subagent_followup", "unsafe", { jobId: details.jobId, task: "x" }), /Only successful/);
});

test("shutdown fences delayed child callbacks and retains interrupted job without automatic restart", { timeout: 15_000 }, async (t) => {
	const creationGate = deferred();
	const f = await fixture({ creationGate }); t.after(() => f.close());
	await f.call("subagent", "old-generation", { type: "explore", task: "delayed", mode: "detached" });
	await f.creationStarted;
	const shuttingDown = f.emit("session_shutdown");
	// Lifecycle dispatch awaits earlier handlers (including cache-policy cleanup).
	// Observe the shutdown transition rather than assuming synchronous dispatch.
	await tick();
	assert.equal(f.store.load()!.jobs[0].status, "interrupted");
	await assert.rejects(f.call("subagent", "new-generation-too-early", { type: "explore", task: "new" }), /still cleaning up/);
	creationGate.resolve();
	await shuttingDown;
	assert.equal(f.requests.length, 0);
	assert.equal(f.disposed, 1);
	await f.startFreshExtension();
	assert.equal(f.store.load()!.jobs[0].status, "interrupted");
	assert.equal(f.created, 1);
	await assert.rejects(f.call("subagent_followup", "unsafe-reload", { jobId: "sa-1", task: "x" }), /Only successful/);
});


test("detached evidence packet persists structured verification for explicit retrieval and cannot be reused", { timeout: 20_000 }, async (t) => {
	const f = await fixture(); t.after(() => f.close());
	const packet = { version: 1, packetId: "packet", groupId: "group", claims: [{ id: "claim", summary: "verify it", priority: "normal" }], anchors: [{ path: "verified.ts", line: 4, symbol: "verified" }], shape: { fileCount: 1, anchorCount: 1, subsystem: "test", crossFileFlow: false } };
	const admission = await f.call("subagent", "packet", { type: "explore", task: "Verify claim", mode: "detached", evidencePacket: packet });
	const id = record(admission.details).jobId;
	await f.requestCount(1);
	const report = { claims: [{ claimId: "claim", status: "confirmed", explanation: "checked source", evidence: [{ path: "verified.ts", line: 4, symbol: "verified" }] }], newLeads: [] };
	f.reply(0, "", 100, 10, [{ index: 0, id: "report-call", type: "function", function: { name: "report_verification", arguments: JSON.stringify(report) } }]);
	const wait = await f.call("subagent_wait", "packet-wait", { jobIds: [id] });
	assert.match(text(wait), /confirmed/);
	const saved = f.store.load()!.jobs[0];
	assert.deepEqual(saved.report?.verification, report);
	assert.equal(saved.report?.evidenceMode, "packet");
	assert.equal(saved.mode, "detached");
	assert.equal(saved.reuse?.kind, "unavailable");
	await assert.rejects(f.call("subagent_followup", "packet-reuse", { jobId: id, task: "x" }), /Only successful normal/);
});

test("failed normal children and failed compaction are visible, cleaned up, never reused or silently retried", { timeout: 20_000 }, async (t) => {
	const f = await fixture(); t.after(() => f.close());
	const failed = f.call("subagent", "fail", { type: "explore", task: "Fail normally" });
	await f.requestCount(1); f.fail(0);
	const error = record((await failed).details);
	assert.equal(error.status, "error");
	await assert.rejects(f.call("subagent_followup", "failed-reuse", { jobId: error.jobId, task: "x" }), /Only successful/);
	const compact = f.call("subagent", "compact-fail", { type: "explore", task: "Critical original goal" });
	await f.requestCount(2); f.reply(1, "evidence ".repeat(9000), 55_000, 100);
	await f.requestCount(3); f.fail(2);
	const details = record((await compact).details);
	assert.equal(details.status, "error");
	assert.match(String(record(details.context).compactionError), /compaction failed/i);
	assert.equal(f.requests.length, 3);
	assert.equal(f.disposed, 2);
	await assert.rejects(f.call("subagent_followup", "compaction-reuse", { jobId: details.jobId, task: "x" }), /Only successful/);
});

test("real parent SDK requests its next answer only after both joined child reports settle", { timeout: 20_000 }, async (t) => {
	const f = await fixture(); t.after(() => f.close());
	const parent = await f.createParent();
	const run = parent.prompt("Investigate two independent questions and use both reports.");
	await f.requestCount(1);
	f.reply(0, "", 100, 10, [
		{ index: 0, id: "child-one", type: "function", function: { name: "subagent", arguments: JSON.stringify({ type: "explore", task: "first question" }) } },
		{ index: 1, id: "child-two", type: "function", function: { name: "subagent", arguments: JSON.stringify({ type: "explore", task: "second question" }) } },
	]);
	await f.requestCount(3);
	f.reply(f.index("first question"), "FIRST_REQUIRED_REPORT");
	while (f.disposed < 1) await tick();
	assert.equal(f.requests.length, 3, "parent must not request another model response while the second child is running");
	assert.equal(parent.isStreaming, true);
	f.reply(f.index("second question"), "SECOND_REQUIRED_REPORT");
	await f.requestCount(4);
	assert.match(JSON.stringify(f.requests[3].body), /FIRST_REQUIRED_REPORT/);
	assert.match(JSON.stringify(f.requests[3].body), /SECOND_REQUIRED_REPORT/);
	f.reply(3, "Both reports were considered.");
	await run;
	assert.equal(parent.getLastAssistantText(), "Both reports were considered.");
	assert.equal(f.disposed, 2);
});

test("cancellation before SDK construction returns without creating or prompting a child", { timeout: 15_000 }, async (t) => {
	const f = await fixture(); t.after(() => f.close());
	const controller = new AbortController();
	const run = f.call("subagent", "cancel-before-create", { type: "explore", task: "cancel before construction" }, controller.signal);
	controller.abort();
	const details = record((await run).details);
	assert.equal(details.status, "error");
	assert.equal(f.created, 0);
	assert.equal(f.disposed, 0);
	assert.equal(f.requests.length, 0);
	assert.equal(f.store.load()!.jobs[0].status, "cancelled");
});

for (const mode of ["joined", "detached"] as const) {
  for (const commandsOrder of ["before", "after"] as const) {
    test(`native cache policy includes ${mode} children with commands loaded ${commandsOrder}`, {
      skip: !supportsNativeCacheWarming(VERSION),
    }, async (t) => {
      const previous = process.env.PI_BACKGROUND_CACHE_WARMING;
      delete process.env.PI_BACKGROUND_CACHE_WARMING;
      const gate = deferred();
      const f = await fixture({ creationGate: gate, commandsOrder });
      t.after(async () => {
        try { await f.close(); } finally {
          if (previous === undefined) delete process.env.PI_BACKGROUND_CACHE_WARMING;
          else process.env.PI_BACKGROUND_CACHE_WARMING = previous;
        }
      });
      const event = { type: "cache_warming_decision", action: "stop", warmCost: 0.02, missCost: 0.2, continuationProbability: 0.15 };
      assert.deepEqual(await f.emit("cache_warming_decision", event), [undefined], "one owner, no work yet");
      const child = f.call("subagent", "warming-child", { type: "explore", task: "gated local child", mode });
      await f.creationStarted;
      assert.deepEqual(await f.emit("cache_warming_decision", event), [{ action: "warm" }]);
      assert.deepEqual(await f.emit("cache_warming_decision", { ...event, warmCost: 0.19 }), [undefined]);
      process.env.PI_BACKGROUND_CACHE_WARMING = "0";
      assert.deepEqual(await f.emit("cache_warming_decision", event), [undefined]);
      delete process.env.PI_BACKGROUND_CACHE_WARMING;
      const payload = { system: [{ type: "text", text: "parent", cache_control: { type: "ephemeral" } }] };
      assert.deepEqual(await f.emit("before_provider_request", { payload }), [undefined], "native hosts never auto-upgrade TTL");
      const stopping = f.emit("session_shutdown");
      assert.deepEqual(await f.emit("cache_warming_decision", event), [undefined], "cleared before child cleanup finishes");
      gate.resolve();
      await stopping;
      await child;
      assert.deepEqual(await f.emit("cache_warming_decision", event), [undefined]);
      assert.equal(f.requests.length, 0, "decision handling never issues provider requests");
    });
  }
}

test("native warming stops when a detached child finishes, before its notification is delivered", {
  skip: !supportsNativeCacheWarming(VERSION), timeout: 15_000,
}, async (t) => {
  const old = process.env.PI_BACKGROUND_CACHE_WARMING;
  delete process.env.PI_BACKGROUND_CACHE_WARMING;
  const f = await fixture();
  t.after(async () => {
    try { await f.close(); } finally {
      if (old === undefined) delete process.env.PI_BACKGROUND_CACHE_WARMING;
      else process.env.PI_BACKGROUND_CACHE_WARMING = old;
    }
  });
  const event = { type: "cache_warming_decision", action: "stop", warmCost: 0.02, missCost: 0.2 };
  await f.call("subagent", "finish", { type: "explore", task: "finish locally", mode: "detached" });
  await f.requestCount(1);
  assert.deepEqual(await f.emit("cache_warming_decision", event), [{ action: "warm" }]);
  f.reply(0, "finished");
  const deadline = Date.now() + 10_000;
  while (f.store.load()!.jobs[0].status === "running" && Date.now() < deadline) await tick();
  assert.equal(f.store.load()!.jobs[0].status, "completed");
  assert.equal(f.deliveries.length, 0, "parent still busy; notification not yet sent");
  assert.deepEqual(await f.emit("cache_warming_decision", event), [undefined]);
});
