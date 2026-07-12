import assert from "node:assert/strict";
import { test } from "node:test";

import aiknowExtension, { piExtension, resolveAiknowCliCommand } from "../aiknow.ts";
import type { ManagedExtensionPiApi } from "../lib/capability-visibility.ts";

// ── FakePi ────────────────────────────────────────────────────────────────

interface FakePi extends ManagedExtensionPiApi {
	tools: Map<string, unknown>;
	handlers: Map<string, Array<(...args: unknown[]) => unknown>>;
	emit(event: string, ...args: unknown[]): void;
}

function createFakePi(): FakePi {
	const tools = new Map<string, unknown>();
	let activeTools: string[] = [];
	const handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();

	return {
		tools,
		handlers,
		registerTool(tool: unknown) {
			const def = tool as { name: string };
			tools.set(def.name, tool);
			if (!activeTools.includes(def.name)) activeTools = [...activeTools, def.name];
		},
		registerCommand() {},
		getActiveTools() {
			return [...activeTools];
		},
		setActiveTools(names: string[]) {
			activeTools = [...names];
		},
		on(event: string, handler: (...args: unknown[]) => unknown) {
			if (!handlers.has(event)) handlers.set(event, []);
			handlers.get(event)!.push(handler);
		},
		emit(event: string, ...args: unknown[]) {
			for (const handler of handlers.get(event) ?? []) handler(...args);
		},
	};
}

// ── Helpers ───────────────────────────────────────────────────────────────

function getRegisteredToolNames(pi: FakePi): string[] {
	return [...pi.tools.keys()];
}

function getToolDef(pi: FakePi, name: string) {
	return pi.tools.get(name) as
		| {
				name: string;
				description: string;
				promptGuidelines?: string[];
				parameters: unknown;
				execute: (id: string, params: unknown, signal: undefined, onUpdate: undefined, ctx: unknown) => Promise<unknown>;
		  }
		| undefined;
}

// ── Tests: extension identity and tool registration ───────────────────────

test("piExtension.id is 'aiknow'", () => {
	assert.equal(piExtension.id, "aiknow");
});

test("extension registers all current aiKnow tools", () => {
	const pi = createFakePi();
	aiknowExtension(pi as any);

	const expected = [
		"aiknow_search",
		"aiknow_sync",
		"aiknow_status",
		"aiknow_capabilities",
		"aiknow_impact",
		"aiknow_read",
		"aiknow_file_map",
		"aiknow_neighbors",
	];
	for (const name of expected) {
		assert.ok(pi.tools.has(name), `expected tool '${name}' to be registered`);
	}
	assert.equal(getRegisteredToolNames(pi).length, expected.length);
});

test("aiknow_search exposes the current aiKnow query schema", () => {
	const pi = createFakePi();
	aiknowExtension(pi as any);

	assert.ok(!pi.tools.has("aiknow_context"), "removed aiKnow tools must not be registered");
	const tool = getToolDef(pi, "aiknow_search");
	assert.ok(tool, "aiknow_search must be registered");
	const schema = tool.parameters as { properties?: Record<string, unknown> };
	for (const name of ["query", "mode", "tier", "tokenBudget", "includeDetails", "includeMetrics", "limit", "keywords", "anchors", "depth", "playbook", "intent"]) {
		assert.ok(schema.properties?.[name], `search schema must include '${name}'`);
	}
	assert.ok(
		tool.promptGuidelines?.some((g) => g.includes("aiknow_read") && g.includes("before grep/read")),
		"guidance must say to follow aiknow_read suggestions before grep/read",
	);

	const readTool = getToolDef(pi, "aiknow_read");
	assert.ok(readTool, "aiknow_read must be registered");
	const readSchema = readTool.parameters as { properties?: Record<string, unknown> };
	for (const name of ["path", "mode", "startLine", "endLine", "tier", "tokenBudget", "includeDetails", "includeMetrics"]) {
		assert.ok(readSchema.properties?.[name], `read schema must include '${name}'`);
	}
});


test("aiknow_search guidance says to follow aiknow_read next suggestions", () => {
	const pi = createFakePi();
	aiknowExtension(pi as any);

	const tool = getToolDef(pi, "aiknow_search");
	assert.ok(tool, "aiknow_search must be registered");
	assert.ok(
		tool.promptGuidelines?.some((g) => g.includes("next aiknow_read") && g.includes("before grep/read")),
		"aiknow_search guidance must prefer suggested aiknow_read before grep/read",
	);
});

// ── Tests: CLI/path helpers ──────────────────────────────────────────────

test("resolveAiknowCliCommand uses AIKNOW_CLI as a Node CLI path", () => {
	const oldCli = process.env.AIKNOW_CLI;
	const oldBin = process.env.AIKNOW_BIN;
	process.env.AIKNOW_CLI = "F:/MyWork/aiKnow/dist/cli.js";
	delete process.env.AIKNOW_BIN;
	try {
		const cmd = resolveAiknowCliCommand();
		assert.equal(cmd.command, process.execPath);
		assert.deepEqual(cmd.argsPrefix, ["F:\\MyWork\\aiKnow\\dist\\cli.js"]);
		assert.match(cmd.display, /node .*cli\.js/);
	} finally {
		if (oldCli === undefined) delete process.env.AIKNOW_CLI;
		else process.env.AIKNOW_CLI = oldCli;
		if (oldBin === undefined) delete process.env.AIKNOW_BIN;
		else process.env.AIKNOW_BIN = oldBin;
	}
});

test("resolveAiknowCliCommand uses AIKNOW_BIN as an installed command override", () => {
	const oldCli = process.env.AIKNOW_CLI;
	const oldBin = process.env.AIKNOW_BIN;
	delete process.env.AIKNOW_CLI;
	process.env.AIKNOW_BIN = "aiknow-dev";
	try {
		const cmd = resolveAiknowCliCommand();
		assert.equal(cmd.command, "aiknow-dev");
		assert.deepEqual(cmd.argsPrefix, []);
	} finally {
		if (oldCli === undefined) delete process.env.AIKNOW_CLI;
		else process.env.AIKNOW_CLI = oldCli;
		if (oldBin === undefined) delete process.env.AIKNOW_BIN;
		else process.env.AIKNOW_BIN = oldBin;
	}
});

test("aiknow_sync matches aiKnow's empty input schema", () => {
	const pi = createFakePi();
	aiknowExtension(pi as any);

	const tool = getToolDef(pi, "aiknow_sync");
	assert.ok(tool, "aiknow_sync must be registered");
	const schema = tool.parameters as { properties?: Record<string, unknown> };
	assert.deepEqual(schema.properties, {});
});

// ── Tests: stale-file tracking (DEC-032) ─────────────────────────────────

test("tool_result for 'edit' adds path to stale set and updates status", () => {
	const pi = createFakePi();
	aiknowExtension(pi as any);

	const statusUpdates: Array<{ key: string; text: string | undefined }> = [];
	const fakeCtx = {
		ui: {
			setStatus(key: string, text: string | undefined) {
				statusUpdates.push({ key, text });
			},
		},
	};

	pi.emit(
		"tool_result",
		{
			type: "tool_result",
			toolCallId: "c1",
			toolName: "edit",
			input: { path: "src/foo.ts", edits: [] },
			content: [{ type: "text", text: "ok" }],
			isError: false,
			details: undefined,
		},
		fakeCtx,
	);

	const last = statusUpdates.at(-1);
	assert.ok(last, "setStatus should have been called");
	assert.equal(last!.key, "aiknow");
	assert.match(last!.text ?? "", /1 file stale/);
});

test("tool_result for 'write' adds path to stale set", () => {
	const pi = createFakePi();
	aiknowExtension(pi as any);

	const statusUpdates: Array<{ key: string; text: string | undefined }> = [];
	const fakeCtx = {
		ui: {
			setStatus(key: string, text: string | undefined) {
				statusUpdates.push({ key, text });
			},
		},
	};

	pi.emit(
		"tool_result",
		{
			type: "tool_result",
			toolCallId: "c2",
			toolName: "write",
			input: { path: "src/bar.ts", content: "hello" },
			content: [{ type: "text", text: "ok" }],
			isError: false,
			details: undefined,
		},
		fakeCtx,
	);

	const last = statusUpdates.at(-1);
	assert.ok(last);
	assert.match(last!.text ?? "", /1 file stale/);
});

test("tool_result with isError:true does not add path to stale set", () => {
	const pi = createFakePi();
	aiknowExtension(pi as any);

	const statusUpdates: Array<{ key: string; text: string | undefined }> = [];
	const fakeCtx = {
		ui: {
			setStatus(key: string, text: string | undefined) {
				statusUpdates.push({ key, text });
			},
		},
	};

	pi.emit(
		"tool_result",
		{
			type: "tool_result",
			toolCallId: "c3",
			toolName: "edit",
			input: { path: "src/err.ts", edits: [] },
			content: [{ type: "text", text: "conflict" }],
			isError: true,
			details: undefined,
		},
		fakeCtx,
	);

	assert.equal(statusUpdates.length, 0, "no status update for failed edit");
});

test("stale count accumulates across multiple edits", () => {
	const pi = createFakePi();
	aiknowExtension(pi as any);

	const statusUpdates: Array<{ key: string; text: string | undefined }> = [];
	const fakeCtx = {
		ui: {
			setStatus(key: string, text: string | undefined) {
				statusUpdates.push({ key, text });
			},
		},
	};

	for (const p of ["src/a.ts", "src/b.ts", "src/c.ts"]) {
		pi.emit(
			"tool_result",
			{
				type: "tool_result",
				toolCallId: `c-${p}`,
				toolName: "edit",
				input: { path: p, edits: [] },
				content: [{ type: "text", text: "ok" }],
				isError: false,
				details: undefined,
			},
			fakeCtx,
		);
	}

	const last = statusUpdates.at(-1);
	assert.ok(last);
	assert.match(last!.text ?? "", /3 files stale/);
});

test("duplicate paths are not double-counted in stale set", () => {
	const pi = createFakePi();
	aiknowExtension(pi as any);

	const statusUpdates: Array<{ key: string; text: string | undefined }> = [];
	const fakeCtx = {
		ui: {
			setStatus(key: string, text: string | undefined) {
				statusUpdates.push({ key, text });
			},
		},
	};

	for (let i = 0; i < 3; i++) {
		pi.emit(
			"tool_result",
			{
				type: "tool_result",
				toolCallId: `c-${i}`,
				toolName: "edit",
				input: { path: "src/same.ts", edits: [] },
				content: [{ type: "text", text: "ok" }],
				isError: false,
				details: undefined,
			},
			fakeCtx,
		);
	}

	const last = statusUpdates.at(-1);
	assert.ok(last);
	assert.match(last!.text ?? "", /1 file stale/);
});

// ── Tests: guidance injection ─────────────────────────────────────────────

test("before_agent_start injects exploration guidance for explore prompts", () => {
	const pi = createFakePi();
	aiknowExtension(pi as any);

	const handlers = pi.handlers.get("before_agent_start") ?? [];
	assert.ok(handlers.length > 0, "before_agent_start handler must be registered");

	const event = {
		type: "before_agent_start",
		prompt: "Explore how the authentication module works",
		systemPrompt: "You are a helpful assistant.",
		systemPromptOptions: {},
	};

	let result: unknown;
	for (const h of handlers) {
		const r = h(event, {});
		if (r) result = r;
	}

	assert.ok(result, "handler should return a result for exploration prompts");
	const sp = (result as { systemPrompt?: string }).systemPrompt ?? "";
	assert.ok(sp.includes("investigation"), "guidance should mention 'investigation' playbook");
	assert.ok(sp.includes("aiknow_search"), "exploration guidance should encourage aiknow_search follow-ups");
	assert.ok(!sp.includes("aiknow_context"), "guidance must not reference a removed tool");
	assert.ok(
		sp.includes("If aiknow_search returns a next aiknow_read suggestion"),
		"exploration guidance should require following aiknow_read next suggestions",
	);
	assert.ok(!sp.includes("Poteto/pstack owns reasoning"), "normal explore prompt must not get poteto guidance");
});

test("before_agent_start injects bug-fix guidance for debug prompts", () => {
	const pi = createFakePi();
	aiknowExtension(pi as any);

	const handlers = pi.handlers.get("before_agent_start") ?? [];
	const event = {
		type: "before_agent_start",
		prompt: "Debug the authentication error in login flow",
		systemPrompt: "Base prompt.",
		systemPromptOptions: {},
	};

	let result: unknown;
	for (const h of handlers) {
		const r = h(event, {});
		if (r) result = r;
	}

	assert.ok(result);
	const sp = (result as { systemPrompt?: string }).systemPrompt ?? "";
	assert.ok(sp.includes("bug-fix"), "guidance should mention 'bug-fix' playbook");
	assert.ok(sp.includes("aiknow_search"), "bug-fix guidance should encourage aiknow_search follow-ups");
});

test("before_agent_start returns undefined for unrelated prompts", () => {
	const pi = createFakePi();
	aiknowExtension(pi as any);

	const handlers = pi.handlers.get("before_agent_start") ?? [];
	const event = {
		type: "before_agent_start",
		prompt: "What is the capital of France?",
		systemPrompt: "Base prompt.",
		systemPromptOptions: {},
	};

	let result: unknown;
	for (const h of handlers) {
		const r = h(event, {});
		if (r) result = r;
	}

	assert.equal(result, undefined, "no guidance for unrelated prompts");
});

test("before_agent_start injects refactor guidance", () => {
	const pi = createFakePi();
	aiknowExtension(pi as any);

	const handlers = pi.handlers.get("before_agent_start") ?? [];
	const event = {
		type: "before_agent_start",
		prompt: "Refactor the payment module to extract the retry logic",
		systemPrompt: "Base.",
		systemPromptOptions: {},
	};

	let result: unknown;
	for (const h of handlers) {
		const r = h(event, {});
		if (r) result = r;
	}

	assert.ok(result);
	const sp = (result as { systemPrompt?: string }).systemPrompt ?? "";
	assert.ok(sp.includes("aiknow_impact"), "guidance should mention aiknow_impact for refactor");
});

test("before_agent_start injects pstack aiKnow guidance for poteto explore prompts", () => {
	const pi = createFakePi();
	aiknowExtension(pi as any);

	const handlers = pi.handlers.get("before_agent_start") ?? [];
	const event = {
		type: "before_agent_start",
		prompt: "/poteto-mode explore auth flow",
		systemPrompt: "You are a helpful assistant.",
		systemPromptOptions: {},
	};

	let result: unknown;
	for (const h of handlers) {
		const r = h(event, {});
		if (r) result = r;
	}

	assert.ok(result, "handler should return a result for poteto prompts");
	const sp = (result as { systemPrompt?: string }).systemPrompt ?? "";
	assert.ok(sp.includes("Poteto/pstack owns reasoning"), "guidance must contain merged pstack hint");
	assert.ok(sp.includes("aiknow_search"), "guidance must mention aiknow_search");
	assert.ok(sp.includes("aiknow_status"), "guidance must mention aiknow_status");
	assert.ok(!sp.includes("aiknow_context"), "guidance must not reference a removed tool");
	assert.ok(!sp.includes("Token-frugal investigation path"), "guidance must not duplicate normal investigation wording");
});
