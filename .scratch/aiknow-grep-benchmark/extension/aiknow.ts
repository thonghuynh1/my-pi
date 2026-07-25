// Pi extension for aiKnow — registers aiKnow tools, lazy-starts or reuses the
// shared TypeScript local server, confirms first init, marks edited files stale,
// and injects brief guidance for registered repos.
//
// DEC-001 (CLI+MCP+Pi), DEC-012 (shared local server), DEC-021 (playbook intents),
// DEC-032 (stale marking, no auto-sync), DEC-035 (status/capabilities),
// DEC-054 (no installer in v1).

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import {
	createManagedExtension,
	loadCapabilityVisibilitySettings,
	type CapabilityVisibilitySettings,
} from "./lib/capability-visibility.ts";

export const piExtension = { id: "aiknow" };

// ── Runtime server info (mirrors aiKnow's runtime ServerInfo) ──────────────

interface ServerInfo {
	url: string;
	token: string;
	pid: number;
}

// ── Path helpers (mirror aiKnow's paths package) ───────────────────────────

/** First 8 bytes of SHA-256 of the canonical absolute path, as 16-char hex (DEC-005). */
function repoId(canonicalPath: string): string {
	const hash = createHash("sha256").update(canonicalPath).digest();
	return hash.subarray(0, 8).toString("hex");
}

/** Filesystem-safe branch name (mirrors aiKnow's sanitizeBranch). */
function sanitizeBranch(branch: string): string {
	return branch.replace(/[/\\:*?"<>|]/g, "_");
}

/** `~/.aiknow` */
function aiknowDir(): string {
	return join(homedir(), ".aiknow");
}

interface AiknowCliCommand {
	command: string;
	argsPrefix: string[];
	display: string;
}

function nodeCliCommand(cliPath: string): AiknowCliCommand {
	return {
		command: process.execPath,
		argsPrefix: [cliPath],
		display: `node ${cliPath}`,
	};
}

/**
 * Resolve the current TypeScript aiKnow CLI.
 *
 * Preferred overrides:
 * - AIKNOW_CLI: absolute/relative path to dist/cli.js
 * - AIKNOW_BIN: command/shim name (for an npm global bin)
 *
 * Development fallback supports this workspace layout:
 * F:/MyWork/my-pi/extensions/aiknow.ts + F:/MyWork/aiKnow/dist/cli.js.
 */
export function resolveAiknowCliCommand(): AiknowCliCommand {
	const envCli = process.env.AIKNOW_CLI?.trim();
	if (envCli) return nodeCliCommand(resolve(envCli));

	const envBin = process.env.AIKNOW_BIN?.trim();
	if (envBin) {
		return { command: envBin, argsPrefix: [], display: envBin };
	}

	const extensionDir = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		join(extensionDir, "..", "..", "aiKnow", "dist", "cli.js"),
		join(process.cwd(), "..", "aiKnow", "dist", "cli.js"),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) return nodeCliCommand(candidate);
	}

	// Keep supporting an installed npm shim when one is present on PATH.
	return { command: "aiknow", argsPrefix: [], display: "aiknow" };
}

/** Reads `~/.aiknow/runtime/<repoId>/<branch>/server.json`. Returns null when absent. */
function readServerJson(canonicalRoot: string, branch: string): ServerInfo | null {
	const p = join(aiknowDir(), "runtime", repoId(canonicalRoot), sanitizeBranch(branch), "server.json");
	if (!existsSync(p)) return null;
	try {
		const raw = JSON.parse(readFileSync(p, "utf-8"));
		if (typeof raw.url === "string" && typeof raw.token === "string") {
			return { url: raw.url, token: raw.token, pid: raw.pid ?? 0 };
		}
		return null;
	} catch {
		return null;
	}
}

/** GET /health — true when the server responds 200. */
async function checkHealth(url: string): Promise<boolean> {
	try {
		const resp = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
		return resp.ok;
	} catch {
		return false;
	}
}

/** POST /tools/<name> with Bearer token. Returns the parsed JSON body. */
async function callTool(url: string, token: string, endpoint: string, args: unknown): Promise<unknown> {
	const resp = await fetch(`${url}${endpoint}`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(args ?? {}),
		signal: AbortSignal.timeout(60_000),
	});
	if (!resp.ok) {
		throw new Error(`aiKnow server returned HTTP ${resp.status}`);
	}
	return resp.json();
}

/**
 * Returns [url, token] for a live local server, starting one if needed.
 * Throws with a descriptive message when the TypeScript CLI is absent or startup fails.
 */
async function ensureServer(
	canonicalRoot: string,
	branch: string,
	pi: ExtensionAPI,
): Promise<[string, string]> {
	// Fast path: reuse a live server.
	const existing = readServerJson(canonicalRoot, branch);
	if (existing && (await checkHealth(existing.url))) {
		return [existing.url, existing.token];
	}

	// Spawn the TypeScript CLI's `serve-local` detached so it outlives Pi (DEC-012).
	const cli = resolveAiknowCliCommand();
	let spawnErrorMessage = "";
	const child = spawn(cli.command, [...cli.argsPrefix, "serve-local", "--repo", canonicalRoot, "--branch", branch], {
		detached: true,
		stdio: "ignore",
	});
	child.on("error", (err) => {
		spawnErrorMessage = err.message;
	});
	child.unref();

	// Wait up to 5 s for server.json to appear and health to pass.
	for (let i = 0; i < 100; i++) {
		await new Promise((r) => setTimeout(r, 50));
		const info = readServerJson(canonicalRoot, branch);
		if (info && (await checkHealth(info.url))) {
			return [info.url, info.token];
		}
	}

	throw new Error(
		"aiKnow local server did not start in time. " +
			`Tried ${cli.display} serve-local. ` +
			(spawnErrorMessage ? `Spawn error: ${spawnErrorMessage}. ` : "") +
			"Set AIKNOW_CLI to aiKnow's dist/cli.js or AIKNOW_BIN to an installed aiknow command.",
	);
}

// ── MCP endpoint mapping ──────────────────────────────────────────────────

const toolEndpoints: Record<string, string> = {
	aiknow_search: "/tools/search",
	aiknow_sync: "/tools/sync",
	aiknow_status: "/tools/status",
	aiknow_capabilities: "/tools/capabilities",
	aiknow_impact: "/tools/impact",
	aiknow_read: "/tools/read",
	aiknow_file_map: "/tools/file_map",
	aiknow_neighbors: "/tools/neighbors",
};

// ── Tool parameter schemas ─────────────────────────────────────────────────

const SearchParams = Type.Object({
	query: Type.Optional(Type.String({ description: "Natural language or code query" })),
	mode: Type.Optional(Type.Union([Type.Literal("auto"), Type.Literal("lookup"), Type.Literal("explore")], { description: "Search mode (default: auto)" })),
	tier: Type.Optional(Type.Union([Type.Literal("compact"), Type.Literal("standard"), Type.Literal("deep")], { description: "Response detail tier (default: compact)" })),
	tokenBudget: Type.Optional(Type.Integer({ description: "Max token budget for response" })),
	includeDetails: Type.Optional(Type.Boolean({ description: "Return structured details and metrics (default: false)" })),
	includeMetrics: Type.Optional(Type.Boolean({ description: "Inline metrics in compact output" })),
	limit: Type.Optional(Type.Integer({ description: "Max results to return" })),
	keywords: Type.Optional(Type.Array(Type.String(), { description: "Keyword hints" })),
	anchors: Type.Optional(Type.Array(Type.String(), { description: "Anchor hints (file:line, symbol names)" })),
	depth: Type.Optional(Type.Integer({ description: "Graph expansion depth (0 = no expansion)" })),
	playbook: Type.Optional(Type.String({ description: "Playbook hint" })),
	intent: Type.Optional(Type.Union([
		Type.Literal("lookup"), Type.Literal("explore"), Type.Literal("callers"), Type.Literal("callees"),
		Type.Literal("impact"), Type.Literal("test"), Type.Literal("edit"),
	], { description: "Intent hint" })),
});

const EmptyParams = Type.Object({});

const ImpactParams = Type.Object({
	path: Type.Optional(Type.String({ description: "Repo-relative file path" })),
	symbol: Type.Optional(Type.String({ description: "Symbol name within the file" })),
	depth: Type.Optional(Type.Integer({ description: "Traversal depth (default 2)" })),
});

const ReadParams = Type.Object({
	path: Type.String({ description: "Repo-relative file path" }),
	mode: Type.Optional(Type.Union([Type.Literal("map"), Type.Literal("signatures"), Type.Literal("lines"), Type.Literal("full")], { description: "Read mode" })),
	startLine: Type.Optional(Type.Integer({ description: "Start line for lines mode (1-based)" })),
	endLine: Type.Optional(Type.Integer({ description: "End line for lines mode (1-based, inclusive)" })),
	tier: Type.Optional(Type.Union([Type.Literal("compact"), Type.Literal("standard"), Type.Literal("deep")], { description: "Response detail tier" })),
	tokenBudget: Type.Optional(Type.Integer({ description: "Max token budget for response" })),
	includeDetails: Type.Optional(Type.Boolean({ description: "Return structured details and metrics (default: false)" })),
	includeMetrics: Type.Optional(Type.Boolean({ description: "Inline metrics in compact output" })),
});

const NeighborsParams = Type.Object({
	nodeId: Type.Optional(Type.String({ description: "Graph node ID" })),
	symbol: Type.Optional(Type.String({ description: "Symbol name (alternative to nodeId)" })),
	depth: Type.Optional(Type.Integer({ description: "Traversal depth (default 1)" })),
});

// ── Guidance ───────────────────────────────────────────────────────────────

const ALWAYS_ON_GUIDELINE =
	"Use aiKnow only when it will reduce follow-up reads. For exploration, use one focused aiknow_search with mode='explore' and tier='compact' before broad grep/read. " +
	"If aiknow_search returns a next aiknow_read suggestion, follow it before grep/read.";

const CONDITIONAL_GUIDELINES: Array<{ pattern: RegExp; text: string }> = [
	{
		pattern: /\b(explore|understand|how does|explain|trace|investigate|where is)\b/i,
		text: "Token-frugal investigation path: use aiknow_search with mode='explore', tier='compact', and playbook='investigation' before broad grep/read. If aiknow_search returns a next aiknow_read suggestion, follow it before grep/read.",
	},
	{
		pattern: /\b(bug|debug|error|failure|broken|crash|exception|fix)\b/i,
		text: "Token-frugal debug path: start with aiknow_search for the error text or suspected symbol, using mode='lookup', tier='compact', and playbook='bug-fix'.",
	},
	{
		pattern: /\b(refactor|rename|move|extract|reorganize|restructure)\b/i,
		text: "Use aiknow_impact before refactoring to enumerate callers, callees, and tests that depend on the target symbol.",
	},
	{
		pattern: /\b(perf|performance|slow|latency|throughput|optimize)\b/i,
		text: "Token-frugal perf path: use aiknow_search with mode='explore', tier='compact', and playbook='perf-issue' for the hot path.",
	},
];

const PSTACK_PATTERN = /\b(poteto|poteto-mode|pstack|skill-pstack|playbook|principle|why skill|how skill)\b/i;

const PSTACK_MERGED_HINT =
	"Poteto/pstack owns reasoning and playbook choice. If aiKnow tools are available and this repo is indexed, use one focused aiknow_search with tier='compact' before broad grep/read. If unsure, use aiknow_status once for larger exploration or normal tools for small tasks.";

function buildConditionalGuidance(prompt: string): string | null {
	if (PSTACK_PATTERN.test(prompt)) {
		return `\n\naiKnow guidance for this task:\n- ${PSTACK_MERGED_HINT}`;
	}
	const matched = CONDITIONAL_GUIDELINES.filter((g) => g.pattern.test(prompt)).map((g) => `- ${g.text}`);
	if (matched.length === 0) return null;
	return `\n\naiKnow guidance for this task:\n${matched.join("\n")}`;
}

// ── Stale-file status helper ──────────────────────────────────────────────

function staleStatusText(count: number): string {
	return count === 0 ? "" : `aiKnow: ${count} file${count === 1 ? "" : "s"} stale`;
}

// ── Extension factory ──────────────────────────────────────────────────────

export default function aiknowExtension(pi: ExtensionAPI): void {
	const visibilityResult = loadCapabilityVisibilitySettings();
	for (const warning of visibilityResult.warnings) {
		console.warn(`[aiknow] capability-visibility: ${warning.message}`);
	}
	const piSettings: CapabilityVisibilitySettings = visibilityResult.settings;
	const managed = createManagedExtension(pi, { id: piExtension.id, visibility: piSettings });

	// Session state — reset each extension load.
	const staleFiles = new Set<string>();
	let serverCache: [string, string] | null = null; // [url, token]

	/** Resolves the canonical repo root and current git branch, then ensures the server is live. */
	async function getServer(pi: ExtensionAPI, cwd: string): Promise<[string, string]> {
		if (serverCache) return serverCache;
		const canonical = resolve(cwd);
		let branch = "main";
		try {
			const result = await pi.exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: canonical });
			if (result.code === 0) branch = result.stdout.trim() || "main";
		} catch {}
		const pair = await ensureServer(canonical, branch, pi);
		serverCache = pair;
		return pair;
	}

	/** Forward a tool call to the local HTTP server and return structured content. */
	async function forward(
		toolName: string,
		args: unknown,
		pi: ExtensionAPI,
		cwd: string,
	): Promise<{ content: Array<{ type: "text"; text: string }> }> {
		const [url, token] = await getServer(pi, cwd);
		const endpoint = toolEndpoints[toolName];
		if (!endpoint) throw new Error(`Unknown tool: ${toolName}`);
		const result = (await callTool(url, token, endpoint, args)) as {
			content?: Array<{ type: string; text: string }>;
		};
		const content = result?.content;
		if (Array.isArray(content) && content.length > 0) {
			return { content: content as Array<{ type: "text"; text: string }> };
		}
		return { content: [{ type: "text", text: JSON.stringify(result) }] };
	}

	// ── Tool registrations ─────────────────────────────────────────────────

	managed.registerTool({
		name: "aiknow_search",
		defaultVisibility: "agent-visible",
		label: "aiKnow Search",
		description: "Deterministic symbol, file, and keyword search with optional graph expansion.",
		promptSnippet: "Token-frugal first choice for symbol, file, keyword, and error lookups, with optional graph expansion.",
		promptGuidelines: [
			ALWAYS_ON_GUIDELINE,
			"When aiknow_search returns a next aiknow_read suggestion, call aiknow_read before grep/read.",
		],
		parameters: SearchParams,
		async execute(_id: string, params: Static<typeof SearchParams>, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			return forward("aiknow_search", params, pi, ctx.cwd);
		},
	});

	managed.registerTool({
		name: "aiknow_sync",
		defaultVisibility: "agent-visible",
		label: "aiKnow Sync",
		description: "Incrementally update the index for the current repo+branch.",
		promptSnippet: "Incrementally update the aiKnow index.",
		parameters: EmptyParams,
		async execute(_id: string, _params: Static<typeof EmptyParams>, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			const result = await forward("aiknow_sync", {}, pi, ctx.cwd);
			// Clear stale tracking after a successful sync.
			staleFiles.clear();
			ctx.ui.setStatus("aiknow", "");
			return result;
		},
	});

	managed.registerTool({
		name: "aiknow_status",
		defaultVisibility: "agent-visible",
		label: "aiKnow Status",
		description: "Show registration and index health for the current repo.",
		promptSnippet: "Registration and index health for the current repo.",
		parameters: EmptyParams,
		async execute(_id: string, _params: Static<typeof EmptyParams>, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			return forward("aiknow_status", {}, pi, ctx.cwd);
		},
	});

	managed.registerTool({
		name: "aiknow_capabilities",
		defaultVisibility: "agent-visible",
		label: "aiKnow Capabilities",
		description: "List supported tools, intents, playbooks, and languages.",
		promptSnippet: "List aiKnow supported tools, intents, playbooks, and languages.",
		parameters: EmptyParams,
		async execute(_id: string, _params: Static<typeof EmptyParams>, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			return forward("aiknow_capabilities", {}, pi, ctx.cwd);
		},
	});

	managed.registerTool({
		name: "aiknow_impact",
		defaultVisibility: "agent-visible",
		label: "aiKnow Impact",
		description: "Blast-radius analysis: callers, callees, tests, and validation suggestions.",
		promptSnippet: "Blast-radius analysis for a file or symbol.",
		parameters: ImpactParams,
		async execute(_id: string, params: Static<typeof ImpactParams>, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			return forward("aiknow_impact", params, pi, ctx.cwd);
		},
	});

	managed.registerTool({
		name: "aiknow_read",
		defaultVisibility: "agent-visible",
		label: "aiKnow Read",
		description: "Read a file from the index (modes: map, signatures, lines, full).",
		promptSnippet: "Read a file from the aiKnow index (map, signatures, lines, or full). Prefer this over grep/read when aiknow_search suggests a next aiknow_read call.",
		parameters: ReadParams,
		async execute(_id: string, params: Static<typeof ReadParams>, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			return forward("aiknow_read", params, pi, ctx.cwd);
		},
	});

	managed.registerTool({
		name: "aiknow_file_map",
		defaultVisibility: "agent-visible",
		label: "aiKnow File Map",
		description: "List all indexed files grouped by role.",
		promptSnippet: "List all indexed files grouped by role.",
		parameters: EmptyParams,
		async execute(_id: string, _params: Static<typeof EmptyParams>, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			return forward("aiknow_file_map", {}, pi, ctx.cwd);
		},
	});

	managed.registerTool({
		name: "aiknow_neighbors",
		defaultVisibility: "agent-visible",
		label: "aiKnow Neighbors",
		description: "Graph neighbors of a symbol node.",
		promptSnippet: "Graph neighbors of a symbol node.",
		parameters: NeighborsParams,
		async execute(_id: string, params: Static<typeof NeighborsParams>, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			return forward("aiknow_neighbors", params, pi, ctx.cwd);
		},
	});

	// ── Observe edit/write tool results → mark files stale (DEC-032) ──────

	pi.on("tool_result", (event, ctx) => {
		if (event.isError) return;
		const toolName = event.toolName;
		if (toolName !== "edit" && toolName !== "write") return;

		const filePath = event.input.path;
		if (typeof filePath !== "string") return;

		staleFiles.add(filePath);
		ctx.ui.setStatus("aiknow", staleStatusText(staleFiles.size));
	});

	// ── Inject conditional guidance for exploration/debug/refactor prompts ─

	pi.on("before_agent_start", (event, _ctx) => {
		const extra = buildConditionalGuidance(event.prompt);
		if (!extra) return undefined;
		return { systemPrompt: event.systemPrompt + extra };
	});
}
