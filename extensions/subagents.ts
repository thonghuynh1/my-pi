/**
 * Cursor-shaped in-process subagents for Pi.
 *
 * Provides one `subagent` tool with three modes:
 * - explore: read-only codebase exploration
 * - shell: command-oriented investigation
 * - custom: markdown-defined agent from ~/.pi/agent/agents or .pi/agents
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import type { Message } from "@earendil-works/pi-ai";
import {
	createAgentSessionFromServices,
	createAgentSessionServices,
	getAgentDir,
	parseFrontmatter,
	SessionManager,
	type ExtensionAPI,
	type ExtensionContext,
	type Theme,
	type ToolDefinition,
	type TurnEndEvent,
} from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";

type SubagentType = "explore" | "shell" | "custom";
type AgentSource = "user" | "project";

interface CustomAgent {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	prompt: string;
	source: AgentSource;
	filePath: string;
}

interface RunConfig {
	type: SubagentType;
	name: string;
	description: string;
	prompt: string;
	tools: string[];
	model?: string;
	source?: AgentSource;
	filePath?: string;
}

interface SubagentUsage {
	inputTokens: number;
	outputTokens: number;
	cacheTokens: number;
	totalTokens: number;
	costUsd: number;
	modelId?: string;
}

interface SubagentDetails {
	type: SubagentType;
	name: string;
	task: string;
	cwd: string;
	tools: string[];
	model?: string;
	status: "completed" | "error";
	output: string;
	error?: string;
	turns: number;
	toolCalls: Array<{ name: string; args: unknown; isError?: boolean }>;
	customAgentPath?: string;
	customAgentSource?: AgentSource;
	usage?: SubagentUsage;
}

type AssistantUsage = {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	totalTokens?: number;
	cost?: {
		input?: number;
		output?: number;
		cacheRead?: number;
		cacheWrite?: number;
		total?: number;
	};
};

// Returns the total USD cost of an assistant message robustly: prefers
// the SDK-precomputed `cost.total` (which already covers input + output
// + cacheRead + cacheWrite at each rate), and falls back to summing the
// sub-fields if the provider forgot to populate `total`. This guarantees
// cache pricing is always counted.
function totalCostOf(usage: AssistantUsage | undefined): number {
	if (!usage?.cost) return 0;
	if (typeof usage.cost.total === "number") return usage.cost.total;
	return (
		(usage.cost.input ?? 0) +
		(usage.cost.output ?? 0) +
		(usage.cost.cacheRead ?? 0) +
		(usage.cost.cacheWrite ?? 0)
	);
}

interface RunningSubagentStatus {
	id: string;
	type: SubagentType;
	name: string;
	task: string;
	cwd: string;
	tools: string[];
	model?: string;
	startedAt: number;
	turns: number;
	toolCalls: Array<{ name: string; args: unknown; isError?: boolean }>;
	currentTool?: string;
	preview: string;
	inputTokens: number;
	outputTokens: number;
	cacheTokens: number;
	totalTokens: number;
	cost: number;
	contextTokens?: number | null;
	contextWindow?: number;
	contextPercent?: number | null;
	customAgentPath?: string;
	customAgentSource?: AgentSource;
}

type SubagentStatusSink = (status: RunningSubagentStatus | undefined) => void;

const SubagentParams = Type.Object({
	type: StringEnum(["explore", "shell", "custom"] as const, {
		description: "Subagent type. explore=read-only investigation, shell=command-oriented investigation, custom=markdown-defined agent.",
	}),
	task: Type.String({ description: "Task to delegate to the subagent." }),
	customAgent: Type.Optional(Type.String({ description: "Custom agent name when type is custom." })),
	cwd: Type.Optional(Type.String({ description: "Working directory for the subagent. Defaults to the current cwd." })),
	model: Type.Optional(
		Type.String({
			description: "Optional model override. Use provider/model or a model id in the active provider.",
		}),
	),
	timeoutSeconds: Type.Optional(
		Type.Number({
			description: "Optional timeout in seconds. Default: no timeout. If provided, values below 600 are raised to 600.",
			minimum: 1,
		}),
	),
});

type SubagentParamsType = Static<typeof SubagentParams>;

const EXPLORE_PROMPT = `You are Pi's explore subagent.

Role:
- Investigate the codebase with an isolated context window.
- Prefer read/search/list tools.
- Do not edit files.
- Do not make risky shell changes.

Return a concise report with:
- Relevant files and symbols
- Key observations
- Evidence, paths, and line references when possible
- Suggested next steps for the parent agent`;

const SHELL_PROMPT = `You are Pi's shell subagent.

Role:
- Use shell commands and read/search tools to inspect the project, run tests, inspect logs, and diagnose issues.
- Avoid modifying files unless the delegated task explicitly asks for it.
- Prefer safe, read-only commands first.

Return a concise report with:
- Commands run
- Important output or failures
- Diagnosis
- Suggested next steps for the parent agent`;

function normalizePathArgument(input: string): string {
	return input.startsWith("@") ? input.slice(1) : input;
}

function parseTools(raw: unknown): string[] | undefined {
	if (typeof raw !== "string") return undefined;
	const tools = raw
		.split(",")
		.map((tool) => tool.trim())
		.filter(Boolean);
	return tools.length > 0 ? tools : undefined;
}

function loadCustomAgentsFromDir(dir: string, source: AgentSource): CustomAgent[] {
	if (!fs.existsSync(dir)) return [];
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}

	const agents: CustomAgent[] = [];
	for (const entry of entries) {
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;
		if (!/\.(md|mdc|markdown)$/i.test(entry.name)) continue;

		const filePath = path.join(dir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf8");
		} catch {
			continue;
		}

		const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(content);
		const name = typeof frontmatter.name === "string" && frontmatter.name.trim()
			? frontmatter.name.trim()
			: path.basename(entry.name, path.extname(entry.name)).replace(/[\s_]+/g, "-");
		const description = typeof frontmatter.description === "string" ? frontmatter.description.trim() : "";
		const model = typeof frontmatter.model === "string" ? frontmatter.model.trim() : undefined;
		const prompt = body.trim();
		if (!prompt) continue;

		agents.push({
			name,
			description,
			tools: parseTools(frontmatter.tools),
			model: model && model !== "inherit" ? model : undefined,
			prompt,
			source,
			filePath,
		});
	}
	return agents;
}

function findProjectAgentsDir(cwd: string): string | undefined {
	let current = path.resolve(cwd);
	while (true) {
		const candidate = path.join(current, ".pi", "agents");
		try {
			if (fs.statSync(candidate).isDirectory()) return candidate;
		} catch {
			// ignore
		}
		const parent = path.dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

function discoverCustomAgents(cwd: string): CustomAgent[] {
	const userDir = path.join(getAgentDir(), "agents");
	const projectDir = findProjectAgentsDir(cwd);
	const byName = new Map<string, CustomAgent>();
	for (const agent of loadCustomAgentsFromDir(userDir, "user")) byName.set(agent.name, agent);
	if (projectDir) {
		// Project agents override user agents with the same name, matching Cursor-like behavior.
		for (const agent of loadCustomAgentsFromDir(projectDir, "project")) byName.set(agent.name, agent);
	}
	return [...byName.values()];
}

function resolveRunConfig(params: SubagentParamsType, cwd: string): RunConfig {
	if (params.type === "explore") {
		return {
			type: "explore",
			name: "explore",
			description: "Read-only codebase exploration",
			prompt: EXPLORE_PROMPT,
			tools: ["read", "grep", "find", "ls"],
			model: params.model,
		};
	}

	if (params.type === "shell") {
		return {
			type: "shell",
			name: "shell",
			description: "Shell-oriented investigation",
			prompt: SHELL_PROMPT,
			tools: ["read", "grep", "find", "ls", "bash"],
			model: params.model,
		};
	}

	const agentName = params.customAgent?.trim();
	if (!agentName) {
		throw new Error('customAgent is required when type is "custom".');
	}
	const agents = discoverCustomAgents(cwd);
	const agent = agents.find((agent) => agent.name === agentName);
	if (!agent) {
		const available = agents.map((agent) => `${agent.name} (${agent.source})`).join(", ") || "none";
		throw new Error(`Unknown custom agent "${agentName}". Available custom agents: ${available}.`);
	}

	return {
		type: "custom",
		name: agent.name,
		description: agent.description,
		prompt: agent.prompt,
		tools: agent.tools && agent.tools.length > 0 ? agent.tools : ["read", "grep", "find", "ls"],
		model: params.model ?? agent.model,
		source: agent.source,
		filePath: agent.filePath,
	};
}

function parseModelOverride(modelOverride: string | undefined, inheritedProvider: string | undefined): {
	provider?: string;
	modelId?: string;
} {
	const value = modelOverride?.trim();
	if (!value) return {};
	const slash = value.indexOf("/");
	if (slash > 0) return { provider: value.slice(0, slash), modelId: value.slice(slash + 1) };
	return { provider: inheritedProvider, modelId: value };
}

function normalizeTimeoutSeconds(params: unknown): SubagentParamsType {
	if (!params || typeof params !== "object") return params as SubagentParamsType;
	const input = params as Record<string, unknown>;
	if (typeof input.timeoutSeconds === "number" && input.timeoutSeconds > 0 && input.timeoutSeconds < 600) {
		return { ...input, timeoutSeconds: 600 } as SubagentParamsType;
	}
	return params as SubagentParamsType;
}

function extractText(message: unknown): string {
	const msg = message as { role?: string; content?: unknown };
	if (msg.role !== "assistant" || !Array.isArray(msg.content)) return "";
	let text = "";
	for (const part of msg.content as Array<{ type?: string; text?: string }>) {
		if (part.type === "text" && typeof part.text === "string") text += part.text;
	}
	return text;
}

function finalAssistantText(messages: unknown[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const text = extractText(messages[i]);
		if (text.trim()) return text.trim();
	}
	return "";
}

function truncateForToolResult(text: string, maxBytes = 50 * 1024): string {
	if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
	let truncated = text.slice(0, maxBytes);
	while (Buffer.byteLength(truncated, "utf8") > maxBytes) truncated = truncated.slice(0, -1);
	return `${truncated}\n\n[Subagent output truncated to ${maxBytes} bytes.]`;
}

function statusLine(config: RunConfig, toolCalls: Array<{ name: string }>, turns: number): string {
	const bits = [`${config.type}:${config.name}`];
	if (turns > 0) bits.push(`${turns} turn${turns === 1 ? "" : "s"}`);
	if (toolCalls.length > 0) bits.push(`${toolCalls.length} tool${toolCalls.length === 1 ? "" : "s"}`);
	return bits.join(" • ");
}

function compactNumber(value: number): string {
	if (!Number.isFinite(value)) return "0";
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`;
	return String(Math.round(value));
}

function formatMoney(value: number): string {
	if (!Number.isFinite(value) || value <= 0) return "$0.0000";
	if (value >= 1) return `$${value.toFixed(3)}`;
	return `$${value.toFixed(4)}`;
}

function oneLine(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function formatElapsed(startedAt: number): string {
	const ms = Math.max(0, Date.now() - startedAt);
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const seconds = Math.floor(ms / 1000);
	return `${Math.floor(seconds / 60)}m${seconds % 60}s`;
}

function applyAssistantUsage(status: RunningSubagentStatus, message: Message): void {
	if (message.role !== "assistant") return;
	const usage = (message as { usage?: AssistantUsage }).usage;
	if (!usage) return;
	const input = usage.input ?? 0;
	const output = usage.output ?? 0;
	const cache = (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
	status.inputTokens += input;
	status.outputTokens += output;
	status.cacheTokens += cache;
	status.totalTokens += usage.totalTokens ?? input + output + cache;
	status.cost += totalCostOf(usage);
}

function renderBoxContent(line: string, innerWidth: number, theme: Theme): string {
	const clipped = truncateToWidth(line, innerWidth);
	return theme.fg("muted", "│") + clipped + " ".repeat(Math.max(0, innerWidth - visibleWidth(clipped))) + theme.fg("muted", "│");
}

function renderSubagentBox(status: RunningSubagentStatus, theme: Theme, frame: string, boxWidth: number): string[] {
	const inner = Math.max(1, boxWidth - 2);
	const rawTitle = ` ${status.type}:${status.name} `;
	const titlePlain = truncateToWidth(rawTitle, Math.max(2, inner - 2));
	const title = theme.fg("toolTitle", theme.bold(titlePlain));
	const titleW = visibleWidth(titlePlain);
	const top =
		theme.fg("muted", "┌─") +
		title +
		theme.fg("muted", "─".repeat(Math.max(0, inner - titleW - 2)) + "┐");
	const bottom = theme.fg("muted", "└" + "─".repeat(inner) + "┘");

	const elapsed = formatElapsed(status.startedAt);
	const line1 = `${theme.fg("warning", frame)} ${theme.fg("dim", `${status.turns}t·${status.toolCalls.length}T·${elapsed}`)}`;
	const ctxTok = status.contextTokens == null ? "?" : compactNumber(status.contextTokens);
	const ctxWin = status.contextWindow ? compactNumber(status.contextWindow) : "?";
	const ctxPct = status.contextPercent == null ? "?" : `${status.contextPercent.toFixed(0)}%`;
	const line2 = theme.fg("warning", `ctx ${ctxTok}/${ctxWin} ${ctxPct}`);
	const line3 = theme.fg("success", formatMoney(status.cost));
	const current = status.currentTool
		? `→ ${status.currentTool}`
		: status.preview
			? oneLine(status.preview)
			: oneLine(status.task);
	const line4 = theme.fg("dim", current);

	return [
		top,
		renderBoxContent(line1, inner, theme),
		renderBoxContent(line2, inner, theme),
		renderBoxContent(line3, inner, theme),
		renderBoxContent(line4, inner, theme),
		bottom,
	];
}

function joinBoxesInline(boxes: string[][], gap: string): string[] {
	if (boxes.length === 0) return [];
	const height = boxes[0].length;
	const result: string[] = [];
	for (let i = 0; i < height; i++) {
		result.push(boxes.map((box) => box[i] ?? "").join(gap));
	}
	return result;
}

function renderSubagentWidget(statuses: Iterable<RunningSubagentStatus>, theme: Theme, width: number): string[] {
	const running = [...statuses];
	if (running.length === 0 || width < 14) return [];

	const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
	const frame = frames[Math.floor(Date.now() / 120) % frames.length];
	const boxWidth = Math.min(26, Math.max(18, width));
	const gap = "  ";
	const perRow = Math.max(1, Math.floor((width + gap.length) / (boxWidth + gap.length)));

	const lines: string[] = [];
	for (let i = 0; i < running.length; i += perRow) {
		const row = running.slice(i, i + perRow).map((status) => renderSubagentBox(status, theme, frame, boxWidth));
		lines.push(...joinBoxesInline(row, gap));
	}
	return lines;
}

async function runSubagent(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	toolCallId: string,
	params: SubagentParamsType,
	onUpdate: ((partial: { content: Array<{ type: "text"; text: string }>; details?: Partial<SubagentDetails> }) => void) | undefined,
	statusSink?: SubagentStatusSink,
): Promise<SubagentDetails> {
	const cwd = path.resolve(ctx.cwd, normalizePathArgument(params.cwd ?? "."));
	const config = resolveRunConfig(params, cwd);
	const inheritedModel = ctx.model;
	const { provider, modelId } = parseModelOverride(config.model, inheritedModel?.provider);
	const resolvedModel = provider && modelId ? ctx.modelRegistry.find(provider, modelId) : inheritedModel;
	if (!resolvedModel) {
		throw new Error(
			config.model
				? `Could not resolve model override "${config.model}".`
				: "No active model is available for the subagent.",
		);
	}

	const timeoutController = new AbortController();
	let timeout: NodeJS.Timeout | undefined;
	if (params.timeoutSeconds && params.timeoutSeconds > 0) {
		timeout = setTimeout(() => timeoutController.abort(), params.timeoutSeconds * 1000);
	}

	let finalMessages: Message[] = [];
	let streamingText = "";
	let turns = 0;
	const toolCalls: Array<{ name: string; args: unknown; isError?: boolean }> = [];
	let session: Awaited<ReturnType<typeof createAgentSessionFromServices>>["session"] | undefined;
	const liveStatus: RunningSubagentStatus = {
		id: toolCallId,
		type: config.type,
		name: config.name,
		task: params.task,
		cwd,
		tools: config.tools,
		model: `${resolvedModel.provider}/${resolvedModel.id}`,
		startedAt: Date.now(),
		turns: 0,
		toolCalls,
		preview: "starting...",
		inputTokens: 0,
		outputTokens: 0,
		cacheTokens: 0,
		totalTokens: 0,
		cost: 0,
		contextTokens: null,
		contextWindow: 0,
		contextPercent: null,
		customAgentPath: config.filePath,
		customAgentSource: config.source,
	};

	const publishStatus = () => {
		if (session) {
			const usage = (session as { getContextUsage?: () => { tokens: number | null; contextWindow: number; percent: number | null } | undefined }).getContextUsage?.();
			if (usage) {
				liveStatus.contextTokens = usage.tokens;
				liveStatus.contextWindow = usage.contextWindow;
				liveStatus.contextPercent = usage.percent;
			}
		}
		liveStatus.turns = turns;
		statusSink?.({ ...liveStatus, toolCalls: [...toolCalls] });
	};

	try {
		const services = await createAgentSessionServices({
			cwd,
			modelRegistry: ctx.modelRegistry,
			resourceLoaderOptions: {
				// Keep child agents isolated and avoid recursively loading this extension.
				noExtensions: true,
				appendSystemPrompt: [config.prompt],
			},
		});

		const childSessionManager = SessionManager.inMemory(cwd);
		const created = await createAgentSessionFromServices({
			services,
			sessionManager: childSessionManager,
			model: resolvedModel,
			tools: config.tools,
			thinkingLevel: pi.getThinkingLevel(),
		});
		session = created.session;
		publishStatus();

		const abortChild = () => {
			void session?.abort();
		};
		ctx.signal?.addEventListener("abort", abortChild, { once: true });
		timeoutController.signal.addEventListener("abort", abortChild, { once: true });

		session.subscribe((event) => {
			switch (event.type) {
				case "agent_start": {
					liveStatus.preview = "agent session started";
					publishStatus();
					onUpdate?.({
						content: [{ type: "text", text: `Started ${config.type} subagent: ${config.name}` }],
						details: { type: config.type, name: config.name, task: params.task, cwd, tools: config.tools, status: "completed" },
					});
					break;
				}
				case "message_update": {
					const update = event.assistantMessageEvent as { type?: string; delta?: string };
					if (update.type === "text_delta" && typeof update.delta === "string") {
						streamingText += update.delta;
						const preview = streamingText.trim().slice(-1200) || "(thinking...)";
						liveStatus.preview = preview;
						publishStatus();
						onUpdate?.({
							content: [{ type: "text", text: `${statusLine(config, toolCalls, turns)}\n\n${preview}` }],
						});
					}
					break;
				}
				case "tool_execution_start": {
					toolCalls.push({ name: event.toolName, args: event.args });
					liveStatus.currentTool = event.toolName;
					liveStatus.preview = `running ${event.toolName}`;
					publishStatus();
					onUpdate?.({
						content: [{ type: "text", text: `${statusLine(config, toolCalls, turns)}\nRunning ${event.toolName}...` }],
					});
					break;
				}
				case "tool_execution_end": {
					const last = [...toolCalls].reverse().find((call) => call.name === event.toolName && call.isError === undefined);
					if (last) last.isError = event.isError;
					liveStatus.currentTool = undefined;
					liveStatus.preview = `${event.toolName} ${event.isError ? "failed" : "finished"}`;
					publishStatus();
					break;
				}
				case "message_end": {
					const message = event.message as Message;
					applyAssistantUsage(liveStatus, message);
					publishStatus();
					break;
				}
				case "turn_end": {
					turns += 1;
					publishStatus();
					break;
				}
				case "agent_end": {
					finalMessages = event.messages as Message[];
					liveStatus.preview = "finalizing...";
					publishStatus();
					break;
				}
			}
		});

		const prompt = `Task: ${params.task}\n\nReturn only the useful findings for the parent agent.`;
		await Promise.race([
			session.prompt(prompt),
			new Promise<never>((_, reject) => {
				ctx.signal?.addEventListener("abort", () => reject(new Error("Subagent was aborted.")), { once: true });
				timeoutController.signal.addEventListener(
					"abort",
					() => reject(new Error(`Subagent timed out after ${params.timeoutSeconds} seconds.`)),
					{ once: true },
				);
			}),
		]);

		const output = finalAssistantText(finalMessages) || streamingText.trim() || "(subagent completed with no output)";
		return {
			type: config.type,
			name: config.name,
			task: params.task,
			cwd,
			tools: config.tools,
			model: `${resolvedModel.provider}/${resolvedModel.id}`,
			status: "completed",
			output,
			turns,
			toolCalls,
			customAgentPath: config.filePath,
			customAgentSource: config.source,
			usage: {
				inputTokens: liveStatus.inputTokens,
				outputTokens: liveStatus.outputTokens,
				cacheTokens: liveStatus.cacheTokens,
				totalTokens: liveStatus.totalTokens,
				costUsd: liveStatus.cost,
				modelId: liveStatus.model,
			},
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			type: config.type,
			name: config.name,
			task: params.task,
			cwd,
			tools: config.tools,
			model: resolvedModel ? `${resolvedModel.provider}/${resolvedModel.id}` : undefined,
			status: "error",
			output: streamingText.trim(),
			error: message,
			turns,
			toolCalls,
			customAgentPath: config.filePath,
			customAgentSource: config.source,
			usage: {
				inputTokens: liveStatus.inputTokens,
				outputTokens: liveStatus.outputTokens,
				cacheTokens: liveStatus.cacheTokens,
				totalTokens: liveStatus.totalTokens,
				costUsd: liveStatus.cost,
				modelId: liveStatus.model,
			},
		};
	} finally {
		statusSink?.(undefined);
		if (timeout) clearTimeout(timeout);
		session?.dispose();
	}
}

export default function (pi: ExtensionAPI) {
	let subagentModeEnabled = false;
	const activeSubagents = new Map<string, RunningSubagentStatus>();
	let tuiRef: { requestRender: () => void } | undefined;
	let spinnerTimer: ReturnType<typeof setInterval> | undefined;

	// Shared global so other extensions (e.g. usage-footer) can render our status
	// and include real subagent billing in the session totals. Subagents run in
	// their own in-memory sessions, so their cost/tokens never appear in the
	// parent's sessionManager branch — we accumulate them here so the footer can
	// add them on top.
	const subagentState = ((globalThis as any).__subagent ??= {
		enabled: false,
		active: 0,
		label: "off",
		totalCostUsd: 0,
		totalTokens: 0,
		totalInputTokens: 0,
		totalOutputTokens: 0,
		totalCacheTokens: 0,
	}) as {
		enabled: boolean;
		active: number;
		label: string;
		totalCostUsd: number;
		totalTokens: number;
		totalInputTokens: number;
		totalOutputTokens: number;
		totalCacheTokens: number;
	};

	function publishStateLabel() {
		subagentState.enabled = subagentModeEnabled;
		subagentState.active = activeSubagents.size;
		if (!subagentModeEnabled) {
			subagentState.label = "off";
		} else if (activeSubagents.size > 0) {
			subagentState.label = `on · ${activeSubagents.size} running`;
		} else {
			subagentState.label = "on";
		}
	}
	publishStateLabel();

	const renderSubagentStatusWidget = () => {
		return (tui: { requestRender: () => void }, theme: Theme) => {
			tuiRef = tui;
			return {
				render(width: number): string[] {
					return renderSubagentWidget(activeSubagents.values(), theme, width);
				},
				invalidate() {},
			};
		};
	};

	function stopSpinner() {
		if (spinnerTimer) clearInterval(spinnerTimer);
		spinnerTimer = undefined;
	}

	function refreshSubagentStatusWidget(ctx: Pick<ExtensionContext, "hasUI" | "ui">) {
		publishStateLabel();
		if (!ctx.hasUI) return;
		if (activeSubagents.size === 0) {
			ctx.ui.setWidget("subagent-status", undefined);
			stopSpinner();
			return;
		}
		ctx.ui.setWidget("subagent-status", renderSubagentStatusWidget(), { placement: "aboveEditor" });
		if (!spinnerTimer) {
			spinnerTimer = setInterval(() => tuiRef?.requestRender(), 120);
			(spinnerTimer as { unref?: () => void }).unref?.();
		}
		tuiRef?.requestRender();
	}

	function setSubagentMode(enabled: boolean) {
		subagentModeEnabled = enabled;
		publishStateLabel();
		pi.appendEntry("subagent-mode", { enabled, timestamp: Date.now() });
	}

	pi.on("session_start", async (_event, ctx) => {
		subagentModeEnabled = false;
		activeSubagents.clear();
		// New session ⇒ reset accumulated subagent billing so the footer
		// doesn't carry costs over from a previous session.
		subagentState.totalCostUsd = 0;
		subagentState.totalTokens = 0;
		subagentState.totalInputTokens = 0;
		subagentState.totalOutputTokens = 0;
		subagentState.totalCacheTokens = 0;
		for (const entry of ctx.sessionManager.getEntries() as any[]) {
			if (entry.type === "custom" && entry.customType === "subagent-mode") {
				subagentModeEnabled = Boolean(entry.data?.enabled);
			}
		}
		refreshSubagentStatusWidget(ctx);
	});

	// Batch-coach: active only when subagent mode is enabled (MESO-001).
	// Detects three consecutive same-tool single-call turns that appear independent
	// and injects a steering message before the next LLM call.
	const batchCoachBuffer: BatchCoachTurnRecord[] = [];
	let batchCoachNudged = false;

	// Reset batch-coach state on new session.
	// (session_start handler above already clears subagentModeEnabled.)
	const origSessionStart = pi.on("session_start", async () => {
		batchCoachBuffer.length = 0;
		batchCoachNudged = false;
	});

	pi.on("turn_end", (event: TurnEndEvent) => {
		if (!subagentModeEnabled) return;

		const record = batchCoachSummarizeTurn(event);
		if (!record) return;

		batchCoachBuffer.push(record);
		if (batchCoachBuffer.length > BATCH_COACH_BUFFER_MAX) batchCoachBuffer.shift();

		// Reset nudge flag when the streak of same-tool turns breaks.
		if (batchCoachNudged && batchCoachBuffer.length >= BATCH_COACH_N) {
			const last3 = batchCoachBuffer.slice(-BATCH_COACH_N);
			const allSingleSameTool =
				last3.every((r) => r.toolCallCount === 1) &&
				new Set(last3.map((r) => r.toolName)).size === 1;
			if (!allSingleSameTool || !BATCH_COACH_TOOLS.has(last3[0].toolName ?? "")) {
				batchCoachNudged = false;
			}
		}

		if (batchCoachBuffer.length < BATCH_COACH_N) return;

		const last3 = batchCoachBuffer.slice(-BATCH_COACH_N);
		const allSingleSameTool =
			last3.every((r) => r.toolCallCount === 1) &&
			new Set(last3.map((r) => r.toolName)).size === 1;

		if (!allSingleSameTool) return;
		if (!BATCH_COACH_TOOLS.has(last3[0].toolName ?? "")) return;
		if (batchCoachHasDependency(last3)) return;
		if (batchCoachNudged) return;

		// Self-narration detection: scan visible text only, not thinking blocks.
		const recentText = last3.map((r) => r.visibleText).join("\n");
		const selfNarratedMatch = SELF_NARRATED_BATCHING_RE.exec(recentText)?.[0];

		pi.sendMessage(
			{
				customType: "subagent-batch-coach",
				content: batchCoachBuildNudge(last3, selfNarratedMatch),
				display: false,
			},
			{ deliverAs: "steer" },
		);
		batchCoachNudged = true;
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		activeSubagents.clear();
		refreshSubagentStatusWidget(ctx);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (!subagentModeEnabled) return;
		const customAgents = discoverCustomAgents(ctx.cwd)
			.slice(0, 20)
			.map((agent) => `- ${agent.name} (${agent.source}): ${agent.description || agent.filePath}`)
			.join("\n");
		const customAgentsText = customAgents.length > 0 ? customAgents : "- none discovered";
		return {
			systemPrompt:
				event.systemPrompt +
				`\n\n=== Subagent workflow mode is enabled ===\n\nYou have an extra capability in this session: the \\\`subagent\\\` tool. It spins up an isolated child Pi agent with its own context window, so investigations done inside a subagent do not consume your main context. The child returns only a concise summary.\n\n## PLAN FIRST, THEN FAN OUT WIDE\n\nBefore you start investigating, pause and ask: **\"Can I split this work into independent sub-questions that don't depend on each other's answers?\"** If yes, dispatch them as a SINGLE BATCH of parallel \\\`subagent\\\` calls in one assistant message. Subagents run concurrently — 4 subagents in parallel finish in roughly the same wall-clock time as 1. Sequential one-by-one investigation is the slow, wrong default.\n\nA good batch is typically 2–5 subagents, each with a narrow, well-scoped task. Don't be shy about going wide — if you can frame 4 independent questions, launch 4 subagents.\n\n### Example batches (do this)\n- Understanding a feature: launch 3 explores in parallel — (1) where the API route is defined, (2) where the DB model lives, (3) where the UI calls it.\n- Debugging a failing test: launch 2 in parallel — one \"shell\" to run the test and capture the stack, one \"explore\" to map the involved modules.\n- Refactor planning: one explore per affected layer (data, service, controller, view) all dispatched together.\n- Reviewing a PR-sized change: one explore per touched subsystem, fanned out simultaneously.\n\n### Anti-patterns (don't do this)\n- ❌ Run one subagent, wait for the result, then run the next one to ask a related-but-independent question. That doubles your wall-clock time for no reason.\n- ❌ Stuff every question into one giant subagent prompt. Narrow, focused tasks return faster and cleaner summaries than one bloated mega-task.\n- ❌ Use a subagent for a single \\\`read\\\` of a known file — just read it directly.\n\n## Available subagent types\n- type=\"explore\" — read-only codebase reconnaissance. The child only has read/grep/find/ls. Good for \"where is X defined\", \"how is Y wired\", \"explain this module\", or any multi-file investigation.\n- type=\"shell\" — same as explore plus \\\`bash\\\`. Good for running tests, inspecting logs, reproducing a failure, or any diagnosis that needs commands.\n- type=\"custom\" with \\\`customAgent\\\` — a specialized markdown-defined agent (see list below).\n\n## When a subagent is a good fit\n- The investigation will likely take more than a couple of read/grep calls.\n- The findings would otherwise clutter your main context with details you only need to summarize.\n- You need to run tests or other commands whose long output you do not want in your main context.\n- You have multiple independent questions — dispatch them as a parallel batch.\n\n## When direct read/grep/edit/bash from the main agent is fine\n- Reading a single known file before editing it.\n- A single targeted lookup at a known location.\n- Quick follow-ups after a subagent has already returned.\n\n## Available custom subagents\n${customAgentsText}`,
		};
	});

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description:
			"Run an isolated in-process Pi subagent. **BATCH IN PARALLEL**: emit multiple subagent calls in one assistant message and they run concurrently — always prefer a parallel batch over sequential one-by-one. Types: explore (read-only codebase investigation), shell (command-oriented investigation), custom (markdown agent from ~/.pi/agent/agents or .pi/agents).",
		promptSnippet: "Delegate focused investigation to an isolated in-process subagent (explore = read-only, shell = with bash, custom = specialized). **Always batch independent questions as parallel subagent calls in the SAME assistant message** — they run concurrently, so 4 in parallel ≈ wall-clock cost of 1.",
		promptGuidelines: [
			"**BATCH IN PARALLEL — this is the #1 rule.** Multiple `subagent` calls in the same assistant message execute concurrently. Before launching any subagent, ask: 'can I split this into 2–5 independent sub-questions?' If yes, emit them all in one message. Sequential one-by-one is almost always wrong.",
			"Concrete batch examples: understanding a feature → 3 parallel explores (API route, DB model, UI call site). Debugging → 1 shell (run test) + 1 explore (map modules), fanned out together. Refactor planning → one explore per affected layer, all dispatched at once.",
			"`subagent` spins up an isolated child agent with its own context window and returns a concise summary. Useful when an investigation would take more than a couple of read/grep calls or would clutter the main context.",
			"type=explore for read-only codebase questions (read/grep/find/ls). type=shell when commands, tests, or logs are needed. type=custom with `customAgent` for specialized agents.",
			"Keep each subagent's task NARROW and focused. Don't stuff multiple questions into one mega-task — narrow tasks return faster, cleaner summaries. Split first, batch second.",
			"For broad repo exploration, omit `timeoutSeconds` or use at least 600 seconds.",
			"Direct read/grep/edit in the main agent stays appropriate for single-file edits, targeted lookups, and quick follow-ups on subagent results — don't use a subagent to read one known file.",
		],
		parameters: SubagentParams,
		prepareArguments: normalizeTimeoutSeconds,
		async execute(toolCallId, params, _signal, onUpdate, ctx) {
			const result = await runSubagent(pi, ctx, toolCallId, params, onUpdate as any, (status) => {
				if (status) activeSubagents.set(toolCallId, status);
				else activeSubagents.delete(toolCallId);
				refreshSubagentStatusWidget(ctx);
			});
			// Accumulate real subagent billing into the shared global so the
			// usage-footer can include it in the session totals (subagents run
			// in their own sessions, invisible to ctx.sessionManager).
			const u = result.usage;
			if (u) {
				subagentState.totalCostUsd += u.costUsd ?? 0;
				subagentState.totalInputTokens += u.inputTokens ?? 0;
				subagentState.totalOutputTokens += u.outputTokens ?? 0;
				subagentState.totalCacheTokens += u.cacheTokens ?? 0;
				subagentState.totalTokens +=
					u.totalTokens ??
					(u.inputTokens ?? 0) + (u.outputTokens ?? 0) + (u.cacheTokens ?? 0);
			}
			if (result.status === "error") {
				return {
					content: [
						{
							type: "text",
							text: `Subagent ${result.type}:${result.name} failed: ${result.error}\n\n${truncateForToolResult(result.output)}`,
						},
					],
					details: { ...result },
				};
			}

			return {
				content: [{ type: "text", text: truncateForToolResult(result.output) }],
				details: { ...result },
			};
		},
		renderCall(args, theme) {
			const type = args.type ?? "...";
			const name = type === "custom" ? (args.customAgent ?? "...") : type;
			const task = args.task ? (args.task.length > 80 ? `${args.task.slice(0, 80)}...` : args.task) : "...";
			return new Text(
				`${theme.fg("toolTitle", theme.bold("subagent "))}${theme.fg("accent", `${type}:${name}`)}\n  ${theme.fg("dim", task)}`,
				0,
				0,
			);
		},
		renderResult(result, { expanded }, theme) {
			const details = result.details as SubagentDetails | undefined;
			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}
			const icon = details.status === "completed" ? theme.fg("success", "✓") : theme.fg("error", "✗");
			let text = `${icon} ${theme.fg("toolTitle", theme.bold(`${details.type}:${details.name}`))}`;
			text += theme.fg("dim", ` • ${details.turns} turn${details.turns === 1 ? "" : "s"}`);
			text += theme.fg("dim", ` • ${details.toolCalls.length} tool${details.toolCalls.length === 1 ? "" : "s"}`);
			if (details.error) text += `\n${theme.fg("error", details.error)}`;
			if (expanded) {
				text += `\n\n${theme.fg("muted", "Task:")} ${details.task}`;
				if (details.toolCalls.length > 0) {
					text += `\n\n${theme.fg("muted", "Tools:")}`;
					for (const call of details.toolCalls) {
						text += `\n  ${call.isError ? theme.fg("error", "✗") : theme.fg("success", "✓")} ${call.name}`;
					}
				}
				text += `\n\n${details.output || "(no output)"}`;
			} else {
				const preview = (details.output || "(no output)").split("\n").slice(0, 8).join("\n");
				text += `\n${preview}`;
				if ((details.output || "").split("\n").length > 8) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
			}
			return new Text(text, 0, 0);
		},
	} satisfies ToolDefinition<typeof SubagentParams, SubagentDetails>);

	pi.registerCommand("subagent", {
		description: "Enable, disable, or show session-level subagent workflow instructions",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();
			if (!action || action === "on" || action === "enable") {
				setSubagentMode(true);
				ctx.ui.notify(
					"Subagent workflow mode enabled. Future prompts will include instructions for when to use explore, shell, and custom subagents.",
					"info",
				);
				return;
			}
			if (action === "off" || action === "disable") {
				setSubagentMode(false);
				ctx.ui.notify("Subagent workflow mode disabled.", "info");
				return;
			}
			if (action === "status") {
				ctx.ui.notify(`Subagent workflow mode is ${subagentModeEnabled ? "enabled" : "disabled"}.`, "info");
				return;
			}
			ctx.ui.notify("Usage: /subagent [on|off|status]", "info");
		},
	});


	pi.registerCommand("subagents", {
		description: "List available custom subagents",
		handler: async (_args, ctx) => {
			const agents = discoverCustomAgents(ctx.cwd);
			if (agents.length === 0) {
				ctx.ui.notify(
					`No custom agents found. Add markdown files to ${path.join(os.homedir(), ".pi", "agent", "agents")} or .pi/agents/.`,
					"info",
				);
				return;
			}
			ctx.ui.notify(
				agents.map((agent) => `${agent.name} (${agent.source}) - ${agent.description || agent.filePath}`).join("\n"),
				"info",
			);
		},
	});
}
