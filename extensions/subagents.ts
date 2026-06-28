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
import {
	createManagedExtension,
	loadCapabilityVisibilitySettings,
	type CapabilityVisibilitySettings,
} from "./lib/capability-visibility.ts";
import { StringEnum } from "@earendil-works/pi-ai";
import type { Message } from "@earendil-works/pi-ai";
import {
	createAgentSessionFromServices,
	createAgentSessionServices,
	getAgentDir,
	getSelectListTheme,
	getSettingsListTheme,
	keyText,
	parseFrontmatter,
	SessionManager,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	type Theme,
	type ToolDefinition,
	type TurnEndEvent,
} from "@earendil-works/pi-coding-agent";
import {
	Container,
	Input,
	SelectList,
	SettingsList,
	Spacer,
	Text,
	getKeybindings,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
	type SelectItem,
	type SettingItem,
} from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";

type SubagentType = "explore" | "shell" | "custom";
type AgentSource = "user" | "project";
type ActiveModel = NonNullable<ExtensionContext["model"]>;

interface CustomAgent {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	prompt: string;
	source: AgentSource;
	filePath: string;
}

type ModelPreference = { kind: "inherit" } | { kind: "model"; value: string };

interface CustomAgentModelConfig {
	defaultModel?: ModelPreference;
	agents: Partial<Record<string, ModelPreference>>;
}

interface SubagentTypeDefaults {
	default?: string;
}

interface EditableSubagentTypeDefault {
	id: "subagents:default";
	label: string;
	description: string;
	configDir: string;
	currentValue: string;
}

interface EditableCustomAgent {
	id: string;
	name: string;
	description: string;
	source: AgentSource;
	filePath: string;
	configDir: string;
	currentValue: string;
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

interface ModelSelection {
	model?: ActiveModel;
	requestedModel?: string;
	usedFallback: boolean;
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

// --- Batch-coach detection state and helpers ---
// This hook lives in subagents.ts because it is intentionally gated by subagentModeEnabled (MESO-001).

const BATCH_COACH_TOOLS: ReadonlySet<string> = new Set(["bash", "find", "grep", "ls", "mcp", "read"]);
const BATCH_COACH_BUFFER_MAX = 10;
const BATCH_COACH_N = 3;
const DEPENDENCY_MIN_CHARS = 6;
const SELF_NARRATED_BATCHING_RE =
	/\b(in parallel|concurrently|simultaneously|in one (call|message|turn)|batch (these|them|the)|batched)\b/i;

interface BatchCoachToolProbe {
	name: string;
	inputSummary: string;
}

interface BatchCoachTurnRecord {
	turnIndex: number;
	toolCallCount: number;
	toolName?: string;
	inputSummary?: string;
	batchableToolCalls: BatchCoachToolProbe[];
	hasSubagentCall: boolean;
	outputSample?: string;
	visibleText: string;
	isError: boolean;
}

function batchCoachExtractToolInputSummary(toolName: string, args: Record<string, unknown>): string {
	if (toolName === "bash") return String(args.command ?? "").slice(0, 120);
	if (toolName === "read") return String(args.path ?? "").slice(0, 120);
	if (toolName === "grep") return String(args.pattern ?? args.query ?? "").slice(0, 120);
	if (toolName === "find") return String(args.pattern ?? args.path ?? "").slice(0, 120);
	if (toolName === "ls") return String(args.path ?? "").slice(0, 120);
	const fallback = args.path ?? args.query ?? args.command ?? args.tool ?? "";
	return String(fallback).slice(0, 120);
}

function batchCoachSummarizeTurn(event: TurnEndEvent): BatchCoachTurnRecord | undefined {
	const msg = event.message as { role?: string; content?: unknown } | undefined;
	if (!msg || msg.role !== "assistant" || !Array.isArray(msg.content)) return undefined;

	const content = msg.content as Array<{ type?: string; text?: string; name?: string; arguments?: Record<string, unknown> }>;
	const toolCalls = content.filter((p) => p.type === "toolCall");
	const toolCallCount = toolCalls.length;
	const toolName = toolCalls.length === 1 ? toolCalls[0].name : undefined;
	const hasSubagentCall = toolCalls.some((toolCall) => toolCall.name === "subagent");
	const batchableToolCalls = toolCalls
		.filter((toolCall): toolCall is { type?: string; text?: string; name: string; arguments?: Record<string, unknown> } =>
			typeof toolCall.name === "string" && BATCH_COACH_TOOLS.has(toolCall.name),
		)
		.map((toolCall) => ({
			name: toolCall.name,
			inputSummary: batchCoachExtractToolInputSummary(toolCall.name, toolCall.arguments ?? {}),
		}));

	// Scan visible text content blocks only, not thinking blocks (issue 03 requirement).
	let visibleText = "";
	for (const part of content) {
		if (part.type === "text" && typeof part.text === "string") visibleText += part.text;
	}

	let inputSummary: string | undefined;
	if (toolCalls.length === 1 && toolName) {
		inputSummary = batchCoachExtractToolInputSummary(toolName, toolCalls[0].arguments ?? {});
	}

	let outputSample: string | undefined;
	let isError = false;
	if (event.toolResults.length > 0) {
		const first = event.toolResults[0];
		isError = first.isError;
		for (const part of first.content) {
			if (typeof part === "object" && part !== null && "text" in part) {
				outputSample = String((part as { text: string }).text).slice(0, 200);
				break;
			}
		}
	}

	return {
		turnIndex: event.turnIndex,
		toolCallCount,
		toolName,
		inputSummary,
		batchableToolCalls,
		hasSubagentCall,
		outputSample,
		visibleText,
		isError,
	};
}

function batchCoachRecordInputSummaries(record: BatchCoachTurnRecord): string[] {
	if (record.batchableToolCalls.length > 0) return record.batchableToolCalls.map((toolCall) => toolCall.inputSummary);
	return record.inputSummary ? [record.inputSummary] : [];
}

function batchCoachInputDependsOnPriorOutput(priorRecords: BatchCoachTurnRecord[], nextRecord: BatchCoachTurnRecord): boolean {
	const nextInputs = batchCoachRecordInputSummaries(nextRecord);
	if (nextInputs.length === 0) return false;
	for (const priorRecord of priorRecords) {
		const outputSample = priorRecord.outputSample;
		if (!outputSample || outputSample.length < DEPENDENCY_MIN_CHARS) continue;
		for (const nextInput of nextInputs) {
			if (nextInput.includes(outputSample)) return true;
			if (outputSample.includes(nextInput)) return true;
			const words = outputSample.split(/\s+/).filter((w) => w.length >= DEPENDENCY_MIN_CHARS);
			if (words.some((w) => nextInput.includes(w))) return true;
		}
	}
	return false;
}

function batchCoachHasDependency(results: BatchCoachTurnRecord[]): boolean {
	const slice = results.slice(-BATCH_COACH_N);
	for (let i = 0; i < slice.length - 1; i++) {
		if (batchCoachInputDependsOnPriorOutput(slice.slice(i, i + 1), slice[i + 1])) return true;
		for (let j = i + 2; j < slice.length; j++) {
			if (batchCoachInputDependsOnPriorOutput([slice[i]], slice[j])) return true;
		}
	}
	return false;
}

function batchCoachSelectNudgeRecords(records: BatchCoachTurnRecord[]): BatchCoachTurnRecord[] | undefined {
	let lastSubagentIndex = -1;
	for (let i = records.length - 1; i >= 0; i--) {
		if (records[i].hasSubagentCall) {
			lastSubagentIndex = i;
			break;
		}
	}
	const sinceLastSubagent = records.slice(lastSubagentIndex + 1);
	if (sinceLastSubagent.length === 0) return undefined;

	const selected: BatchCoachTurnRecord[] = [];
	let probeCount = 0;
	for (let i = sinceLastSubagent.length - 1; i >= 0 && probeCount < BATCH_COACH_N; i--) {
		const record = sinceLastSubagent[i];
		if (record.batchableToolCalls.length === 0) break;
		selected.unshift(record);
		probeCount += record.batchableToolCalls.length;
	}

	if (probeCount < BATCH_COACH_N) return undefined;
	if (batchCoachHasDependency(selected)) return undefined;
	return selected;
}

function batchCoachBuildNudge(records: BatchCoachTurnRecord[], selfNarratedMatch: string | undefined): string {
	const probes = records.flatMap((record) => record.batchableToolCalls).slice(-BATCH_COACH_N);
	let text = "";
	if (selfNarratedMatch) {
		text += `You wrote "${selfNarratedMatch}" but then executed the calls sequentially.\n\n`;
	}
	text += "Subagent mode is on. You just used several direct exploration tools without calling a subagent:\n";
	for (let i = 0; i < probes.length; i++) {
		const probe = probes[i];
		text += `${i + 1}. ${probe.name}(${probe.inputSummary || "..."})\n`;
	}
	text += "\nFor broad or multi-file investigation, stop direct exploration and spawn 2 to 4 parallel subagents unless this is now a narrow follow-up.\n";
	text += "Use explore for code mapping. Use shell for commands, tests, logs, git history, reproduction, or generated output.";
	return text;
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseModelPreference(value: unknown): ModelPreference | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	if (trimmed === "inherit") return { kind: "inherit" };
	return { kind: "model", value: trimmed };
}

const INHERIT_MODEL_CHOICE = "inherit";

function getCustomAgentModelsPath(dir: string): string {
	return path.join(dir, "models.json");
}

function readJsonObjectFile(filePath: string): Record<string, unknown> | undefined {
	if (!fs.existsSync(filePath)) return undefined;
	try {
		const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function getJsonObjectFileError(filePath: string): string | undefined {
	if (!fs.existsSync(filePath)) return undefined;
	try {
		const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
		return isRecord(parsed) ? undefined : "expected a top level JSON object";
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

function getCustomAgentModelConfigError(dir: string): string | undefined {
	const filePath = getCustomAgentModelsPath(dir);
	const error = getJsonObjectFileError(filePath);
	return error ? `${filePath}: ${error}` : undefined;
}

function readCustomAgentModelConfig(dir: string): CustomAgentModelConfig {
	const parsed = readJsonObjectFile(getCustomAgentModelsPath(dir));
	if (!parsed) return { agents: {} };

	const agents: Partial<Record<string, ModelPreference>> = {};
	if (isRecord(parsed.agents)) {
		for (const [name, value] of Object.entries(parsed.agents)) {
			const preference = parseModelPreference(value);
			if (preference) agents[name] = preference;
		}
	}

	return {
		defaultModel: parseModelPreference(parsed.defaultModel),
		agents,
	};
}

function resolveConfiguredModel(agent: CustomAgent, config: CustomAgentModelConfig): string | undefined {
	const agentPreference = config.agents[agent.name];
	if (agentPreference) return agentPreference.kind === "model" ? agentPreference.value : undefined;
	if (config.defaultModel) return config.defaultModel.kind === "model" ? config.defaultModel.value : undefined;
	return agent.model;
}

// Returns the canonical list of dirs to consult for subagent type defaults,
// from least to most specific. Mirrors discoverCustomAgents' walk: package
// (bundled my-pi/agents/), user (~/.pi/agent/agents/), project (.pi/agents/).
// Missing dirs are returned as undefined so the reader can skip them.
export function getSubagentDefaultsSearchDirs(cwd: string): Array<string | undefined> {
	return [getPackageAgentsDir(), path.join(getAgentDir(), "agents"), findProjectAgentsDir(cwd)];
}

// Resolves subagents.default across the package -> user -> project layering.
// A more specific "model" preference replaces a less specific one. An explicit
// "inherit" preference at a more specific level clears the parent default,
// letting the runner fall back to the parent agent's currently active model.
export function readSubagentTypeDefaults(cwd: string): SubagentTypeDefaults {
	const merged: SubagentTypeDefaults = {};
	for (const dir of getSubagentDefaultsSearchDirs(cwd)) {
		if (!dir) continue;
		const raw = readJsonObjectFile(getCustomAgentModelsPath(dir));
		const block = raw && isRecord(raw.subagents) ? raw.subagents : undefined;
		if (!block) continue;
		const preference = parseModelPreference(block.default);
		if (!preference) continue;
		if (preference.kind === "model") merged.default = preference.value;
		else merged.default = undefined;
	}
	return merged;
}

// Picks the canonical dir to write subagents.default into when the user saves
// from the /subagents-model editor. Always writes to the user agents dir so
// that choices persist across package updates. The package dir may ship a
// default that the user dir overrides (position [1] beats position [0] in
// readSubagentTypeDefaults).
export function getSubagentDefaultsWriteDir(): string {
	return path.join(getAgentDir(), "agents");
}

// Writes subagents.default into <dir>/models.json, merging with any existing
// content. Pass INHERIT_MODEL_CHOICE to set "inherit" explicitly (so a more
// specific dir clears a parent default); pass undefined to remove the field.
export function writeSubagentDefaultModel(dir: string, value: string | undefined): string {
	const filePath = getCustomAgentModelsPath(dir);
	const parsed = readJsonObjectFile(filePath) ?? {};
	const nextSubagents = isRecord(parsed.subagents) ? { ...parsed.subagents } : {};
	if (value === undefined) {
		delete nextSubagents.default;
	} else {
		nextSubagents.default = value;
	}
	const nextConfig: Record<string, unknown> = { ...parsed, subagents: nextSubagents };
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
	return filePath;
}

export function buildEditableSubagentTypeDefault(cwd: string): EditableSubagentTypeDefault {
	const resolved = readSubagentTypeDefaults(cwd);
	const configDir = getSubagentDefaultsWriteDir();
	const raw = readJsonObjectFile(getCustomAgentModelsPath(configDir));
	const block = raw && isRecord(raw.subagents) ? raw.subagents : undefined;
	const explicit = parseModelPreference(block?.default);
	const currentValue = explicit
		? explicit.kind === "model" ? explicit.value : INHERIT_MODEL_CHOICE
		: resolved.default ?? INHERIT_MODEL_CHOICE;
	return {
		id: "subagents:default",
		label: "generic explore / shell",
		description: "Default model for type=explore and type=shell subagents.",
		configDir,
		currentValue,
	};
}

function loadCustomAgentsFromDir(dir: string, source: AgentSource): CustomAgent[] {
	if (!fs.existsSync(dir)) return [];
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}

	const modelConfig = readCustomAgentModelConfig(dir);
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
		const prompt = body.trim();
		if (!prompt) continue;

		const frontmatterModel = typeof frontmatter.model === "string" ? frontmatter.model.trim() : undefined;
		const agent: CustomAgent = {
			name,
			description,
			tools: parseTools(frontmatter.tools),
			model: frontmatterModel && frontmatterModel !== INHERIT_MODEL_CHOICE ? frontmatterModel : undefined,
			prompt,
			source,
			filePath,
		};
		agents.push({ ...agent, model: resolveConfiguredModel(agent, modelConfig) });
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

function getPackageAgentsDir(): string {
	// Resolve the agents/ directory bundled with this package (sibling to extensions/)
	// Works whether loaded via jiti (__dirname) or native ESM (import.meta)
	const thisDir = typeof __dirname !== "undefined" ? __dirname : path.dirname(new URL(import.meta.url).pathname);
	return path.resolve(thisDir, "..", "agents");
}

export function discoverCustomAgents(cwd: string): CustomAgent[] {
	const packageDir = getPackageAgentsDir();
	const userDir = path.join(getAgentDir(), "agents");
	const projectDir = findProjectAgentsDir(cwd);
	const byName = new Map<string, CustomAgent>();
	// Package-bundled agents (lowest priority — overridable by user or project)
	for (const agent of loadCustomAgentsFromDir(packageDir, "user")) byName.set(agent.name, agent);
	// User-global agents (~/.pi/agent/agents/)
	for (const agent of loadCustomAgentsFromDir(userDir, "user")) byName.set(agent.name, agent);
	// Project-local agents (.pi/agents/)
	if (projectDir) {
		for (const agent of loadCustomAgentsFromDir(projectDir, "project")) byName.set(agent.name, agent);
	}
	// Apply user-dir model config as an overlay on package-bundled agents.
	// This ensures /subagents-model writes (which go to user dir) are picked
	// up at runtime even when the agent .md lives in the package dir.
	const userModelConfig = readCustomAgentModelConfig(userDir);
	for (const [name, agent] of byName) {
		if (path.dirname(agent.filePath) === packageDir) {
			const overrideModel = resolveConfiguredModel(agent, userModelConfig);
			if (overrideModel !== agent.model) {
				byName.set(name, { ...agent, model: overrideModel });
			}
		}
	}
	return [...byName.values()];
}

function prioritizeCustomAgentsForDisplay(agents: CustomAgent[]): CustomAgent[] {
	return [...agents].sort((a, b) => {
		if (a.source !== b.source) return a.source === "project" ? -1 : 1;
		return a.name.localeCompare(b.name);
	});
}

export function buildEditableCustomAgents(cwd: string): EditableCustomAgent[] {
	const packageDir = getPackageAgentsDir();
	const userDir = path.join(getAgentDir(), "agents");
	const configCache = new Map<string, CustomAgentModelConfig>();
	return prioritizeCustomAgentsForDisplay(discoverCustomAgents(cwd)).map((agent) => {
		// For package-bundled agents, redirect config to user dir so that
		// /subagents-model writes persist across package updates.
		const agentDir = path.dirname(agent.filePath);
		const configDir = agentDir === packageDir ? userDir : agentDir;
		const config = configCache.get(configDir) ?? readCustomAgentModelConfig(configDir);
		configCache.set(configDir, config);
		const explicitPreference = config.agents[agent.name];
		const currentValue = explicitPreference
			? explicitPreference.kind === "model" ? explicitPreference.value : INHERIT_MODEL_CHOICE
			: agent.model ?? INHERIT_MODEL_CHOICE;
		return {
			id: `${agent.source}:${agent.name}`,
			name: agent.name,
			description: agent.description,
			source: agent.source,
			filePath: agent.filePath,
			configDir,
			currentValue,
		};
	});
}

function sortRecordKeys(record: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}

function centerText(text: string, width: number): string {
	const textWidth = visibleWidth(text);
	if (textWidth >= width) return text;
	const leftPad = Math.floor((width - textWidth) / 2);
	return " ".repeat(leftPad) + text;
}

function wrapInBox(lines: string[], theme: Theme, width: number): string[] {
	const w = Math.min(width, 120);
	const innerW = w - 2;
	const pad = (s: string) => s + " ".repeat(Math.max(0, innerW - visibleWidth(s)));
	const bordered = (content: string) => theme.fg("border", "│") + pad(content) + theme.fg("border", "│");
	const result: string[] = [];
	result.push(theme.fg("border", `╭${"─".repeat(innerW)}╮`));
	for (const line of lines) result.push(bordered(line));
	result.push(theme.fg("border", `╰${"─".repeat(innerW)}╯`));
	return result;
}

export function writeCustomAgentModelChoices(agents: ReadonlyArray<EditableCustomAgent>): string[] {
	const byDir = new Map<string, EditableCustomAgent[]>();
	for (const agent of agents) {
		const group = byDir.get(agent.configDir) ?? [];
		group.push(agent);
		byDir.set(agent.configDir, group);
	}

	const writtenPaths: string[] = [];
	for (const [dir, group] of byDir) {
		const filePath = getCustomAgentModelsPath(dir);
		const parsed = readJsonObjectFile(filePath) ?? {};
		const nextAgents = isRecord(parsed.agents) ? { ...parsed.agents } : {};
		for (const agent of group) nextAgents[agent.name] = agent.currentValue;
		const nextConfig: Record<string, unknown> = {
			...parsed,
			agents: sortRecordKeys(nextAgents),
		};
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(filePath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
		writtenPaths.push(filePath);
	}
	return writtenPaths.sort((left, right) => left.localeCompare(right));
}

function buildModelSelectItems(models: ReadonlyArray<ActiveModel>, ctx: ExtensionContext): SelectItem[] {
	const items: SelectItem[] = [
		{
			value: INHERIT_MODEL_CHOICE,
			label: INHERIT_MODEL_CHOICE,
			description: "Use the normal subagent fallback chain.",
		},
	];
	for (const model of [...models].sort((left, right) => {
		const provider = left.provider.localeCompare(right.provider);
		return provider !== 0 ? provider : left.id.localeCompare(right.id);
	})) {
		const providerLabel = ctx.modelRegistry.getProviderDisplayName(model.provider);
		items.push({
			value: `${model.provider}/${model.id}`,
			label: model.id,
			description: `${providerLabel} · ${model.name}`,
		});
	}
	return items;
}

class SubagentModelPicker extends Container {
	private readonly searchInput = new Input();
	private readonly listContainer = new Container();
	private selectList: SelectList;

	constructor(
		private readonly theme: Theme,
		private readonly title: string,
		private readonly items: SelectItem[],
		private readonly onSelectValue: (value: string) => void,
		private readonly onCancelValue: () => void,
		currentValue: string,
	) {
		super();
		this.addChild(new Text(centerText(theme.fg("accent", theme.bold(this.title)), 120), 0, 0));
		this.addChild(new Spacer(1));
		this.addChild(this.searchInput);
		this.addChild(new Spacer(1));
		this.addChild(this.listContainer);
		this.addChild(new Spacer(1));
		this.addChild(new Text(centerText(theme.fg("dim", "Type to filter. Enter selects. Esc goes back."), 120), 0, 0));
		this.searchInput.onSubmit = () => {
			const item = this.selectList.getSelectedItem();
			if (item) this.onSelectValue(item.value);
		};
		this.selectList = new SelectList([], 10, getSelectListTheme());
		this.rebuildList(currentValue);
	}

	render(width: number): string[] {
		const lines = super.render(width);
		return wrapInBox(lines, this.theme, width);
	}

	private filterItems(query: string): SelectItem[] {
		const trimmed = query.trim().toLowerCase();
		if (!trimmed) return this.items;
		return this.items.filter((item) => [item.value, item.label, item.description ?? ""]
			.join(" ")
			.toLowerCase()
			.includes(trimmed));
	}

	private rebuildList(currentValue: string | undefined): void {
		const filteredItems = this.filterItems(this.searchInput.getValue());
		this.listContainer.clear();
		this.selectList = new SelectList(filteredItems, Math.min(Math.max(filteredItems.length, 1), 10), getSelectListTheme());
		const currentIndex = currentValue ? filteredItems.findIndex((item) => item.value === currentValue) : -1;
		if (currentIndex >= 0) this.selectList.setSelectedIndex(currentIndex);
		this.selectList.onSelect = (item) => this.onSelectValue(item.value);
		this.selectList.onCancel = this.onCancelValue;
		this.listContainer.addChild(this.selectList);
	}

	handleInput(data: string): void {
		const kb = getKeybindings();
		const isSelectKey =
			kb.matches(data, "tui.select.up") ||
			kb.matches(data, "tui.select.down") ||
			kb.matches(data, "tui.select.confirm") ||
			kb.matches(data, "tui.select.cancel");
		if (isSelectKey) {
			this.selectList.handleInput(data);
			return;
		}
		const currentValue = this.selectList.getSelectedItem()?.value;
		this.searchInput.handleInput(data);
		this.rebuildList(currentValue);
	}
}

class SubagentModelsEditor extends Container {
	private readonly settingsList: SettingsList;

	constructor(
		private readonly agents: EditableCustomAgent[],
		modelItems: SelectItem[],
		private readonly onSaveValue: (agents: EditableCustomAgent[], typeDefault: EditableSubagentTypeDefault | undefined) => void,
		private readonly matchesSave: (data: string) => boolean,
		onCancelValue: () => void,
		private readonly theme: Theme,
		parentDone?: (result: { agents: EditableCustomAgent[]; typeDefault: EditableSubagentTypeDefault | undefined } | undefined) => void,
		private typeDefault?: EditableSubagentTypeDefault,
	) {
		super();
		this.addChild(new Text(centerText(theme.fg("accent", theme.bold("Subagent models")), 120), 0, 0));
		this.addChild(new Spacer(1));
		const typeDefaultItem: SettingItem | undefined = typeDefault
			? {
				id: typeDefault.id,
				label: typeDefault.label,
				description: typeDefault.description,
				currentValue: typeDefault.currentValue,
				submenu: (currentValue, done) => new SubagentModelPicker(
					theme,
					"Generic subagent default model",
					modelItems,
					(value) => done(value),
					() => done(),
					currentValue,
				),
			}
			: undefined;
		const agentItems: SettingItem[] = agents.map((agent) => ({
			id: agent.id,
			label: `${agent.name} [${agent.source}]`,
			description: agent.description || agent.filePath,
			currentValue: agent.currentValue,
			submenu: (currentValue, done) => new SubagentModelPicker(
				theme,
				`${agent.name} model`,
				modelItems,
				(value) => done(value),
				() => done(),
				currentValue,
			),
		}));
		const saveItem: SettingItem = {
			id: "_save",
			label: "save",
			description: "Save current model choices to models.json",
			currentValue: "",
			values: [""],
		};
		const items = typeDefaultItem ? [typeDefaultItem, ...agentItems, saveItem] : [...agentItems, saveItem];
		this.settingsList = new SettingsList(
			items,
			Math.min(items.length + 2, 15),
			getSettingsListTheme(),
			(id, _newValue) => {
				if (id === "_save") {
					this.onSaveValue(this.agents, this.typeDefault);
					if (parentDone) parentDone({
						agents: this.agents.map((agent) => ({ ...agent })),
						typeDefault: this.typeDefault ? { ...this.typeDefault } : undefined,
					});
					return;
				}
				if (this.typeDefault && id === this.typeDefault.id) {
					this.typeDefault = { ...this.typeDefault, currentValue: _newValue };
					return;
				}
				const agent = this.agents.find((entry) => entry.id === id);
				if (agent) agent.currentValue = _newValue;
			},
			onCancelValue,
			{ enableSearch: true },
		);
		this.addChild(this.settingsList);
		this.addChild(new Spacer(1));
		this.addChild(new Text(centerText(theme.fg("dim", `Enter picks a model. ${keyText("app.models.save")} or the save row saves. Esc cancels.`), 120), 0, 0));
	}

	render(width: number): string[] {
		const lines = super.render(width);
		return wrapInBox(lines, this.theme, width);
	}

	handleInput(data: string): void {
		if (this.matchesSave(data)) {
			this.onSaveValue(this.agents, this.typeDefault);
			return;
		}
		this.settingsList.handleInput(data);
	}
}

function resolveRunConfig(params: SubagentParamsType, cwd: string): RunConfig {
	if (params.type === "explore") {
		const defaults = readSubagentTypeDefaults(cwd);
		return {
			type: "explore",
			name: "explore",
			description: "Read-only codebase exploration",
			prompt: EXPLORE_PROMPT,
			tools: ["read", "grep", "find", "ls"],
			model: params.model ?? defaults.default,
		};
	}

	if (params.type === "shell") {
		const defaults = readSubagentTypeDefaults(cwd);
		return {
			type: "shell",
			name: "shell",
			description: "Shell-oriented investigation",
			prompt: SHELL_PROMPT,
			tools: ["read", "grep", "find", "ls", "bash"],
			model: params.model ?? defaults.default,
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

function sameModel(left: ActiveModel | undefined, right: ActiveModel | undefined): boolean {
	return Boolean(left && right && left.provider === right.provider && left.id === right.id);
}

export function selectSubagentModel(
	requestedModel: string | undefined,
	inheritedModel: ExtensionContext["model"],
	modelRegistry: ExtensionContext["modelRegistry"],
): ModelSelection {
	const trimmedRequestedModel = requestedModel?.trim();
	if (!trimmedRequestedModel) {
		return { model: inheritedModel ?? undefined, usedFallback: false };
	}

	const currentProviderOverrideModel = inheritedModel?.provider
		? modelRegistry.find(inheritedModel.provider, trimmedRequestedModel)
		: undefined;
	const { provider, modelId } = parseModelOverride(trimmedRequestedModel, inheritedModel?.provider);
	const overrideModel = currentProviderOverrideModel ?? (provider && modelId ? modelRegistry.find(provider, modelId) : undefined);
	const overrideModelIsReady = Boolean(overrideModel && modelRegistry.hasConfiguredAuth(overrideModel));
	if (overrideModel && overrideModelIsReady) {
		return { model: overrideModel, requestedModel: trimmedRequestedModel, usedFallback: false };
	}

	return {
		model: inheritedModel ?? undefined,
		requestedModel: trimmedRequestedModel,
		usedFallback: true,
	};
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
	// Show model name (strip provider prefix if present)
	const modelDisplay = status.model ? (status.model.includes("/") ? status.model.split("/")[1] : status.model) : "?";
	const line3 = theme.fg("muted", modelDisplay);
	const line4 = theme.fg("success", formatMoney(status.cost));
	const current = status.currentTool
		? `→ ${status.currentTool}`
		: status.preview
			? oneLine(status.preview)
			: oneLine(status.task);
	const line5 = theme.fg("dim", current);

	return [
		top,
		renderBoxContent(line1, inner, theme),
		renderBoxContent(line2, inner, theme),
		renderBoxContent(line3, inner, theme),
		renderBoxContent(line4, inner, theme),
		renderBoxContent(line5, inner, theme),
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
	const modelSelection = selectSubagentModel(config.model, inheritedModel, ctx.modelRegistry);
	const selectedModel = modelSelection.model;
	if (!selectedModel) {
		throw new Error(
			modelSelection.requestedModel
				? `Could not resolve model override "${modelSelection.requestedModel}" and no active model is available for fallback.`
				: "No active model is available for the subagent.",
		);
	}
	let resolvedModel: ActiveModel = selectedModel;

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
		preview: modelSelection.usedFallback && modelSelection.requestedModel
			? `override ${modelSelection.requestedModel} unavailable, using inherited model`
			: "starting...",
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

		const createChildSession = (model: ActiveModel) =>
			createAgentSessionFromServices({
				services,
				sessionManager: SessionManager.inMemory(cwd),
				model,
				tools: config.tools,
				thinkingLevel: pi.getThinkingLevel(),
			});
		let created: Awaited<ReturnType<typeof createAgentSessionFromServices>>;
		try {
			created = await createChildSession(resolvedModel);
		} catch (error) {
			const fallbackModel = inheritedModel;
			const canFallbackToInheritedModel = Boolean(
				config.model && fallbackModel && !sameModel(resolvedModel, fallbackModel),
			);
			if (!canFallbackToInheritedModel || !fallbackModel) throw error;
			resolvedModel = fallbackModel;
			liveStatus.model = `${resolvedModel.provider}/${resolvedModel.id}`;
			liveStatus.preview = `override ${config.model} failed, using inherited model`;
			publishStatus();
			created = await createChildSession(resolvedModel);
		}
		const resetAttemptState = () => {
			finalMessages = [];
			streamingText = "";
			turns = 0;
			toolCalls.length = 0;
			liveStatus.currentTool = undefined;
			liveStatus.inputTokens = 0;
			liveStatus.outputTokens = 0;
			liveStatus.cacheTokens = 0;
			liveStatus.totalTokens = 0;
			liveStatus.cost = 0;
			liveStatus.contextTokens = null;
			liveStatus.contextWindow = 0;
			liveStatus.contextPercent = null;
		};

		const abortChild = () => {
			void session?.abort();
		};
		ctx.signal?.addEventListener("abort", abortChild, { once: true });
		timeoutController.signal.addEventListener("abort", abortChild, { once: true });

		const bindSession = (nextSession: Awaited<ReturnType<typeof createAgentSessionFromServices>>["session"]) => {
			session = nextSession;
			publishStatus();
			nextSession.subscribe((event) => {
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
		};

		bindSession(created.session);

		const prompt = `Task: ${params.task}\n\nReturn only the useful findings for the parent agent.`;
		const runPrompt = () =>
			Promise.race([
				session!.prompt(prompt),
				new Promise<never>((_, reject) => {
					ctx.signal?.addEventListener("abort", () => reject(new Error("Subagent was aborted.")), { once: true });
					timeoutController.signal.addEventListener(
						"abort",
						() => reject(new Error(`Subagent timed out after ${params.timeoutSeconds} seconds.`)),
						{ once: true },
					);
				}),
			]);
		try {
			await runPrompt();
		} catch (error) {
			const fallbackModel = inheritedModel;
			const canRetryPromptWithInheritedModel = Boolean(
				config.model && fallbackModel && !sameModel(resolvedModel, fallbackModel) && turns === 0 && toolCalls.length === 0,
			);
			if (!canRetryPromptWithInheritedModel || !fallbackModel) throw error;
			await session?.abort();
			resetAttemptState();
			resolvedModel = fallbackModel;
			liveStatus.model = `${resolvedModel.provider}/${resolvedModel.id}`;
			liveStatus.preview = `override ${config.model} failed, using inherited model`;
			const retryCreated = await createChildSession(resolvedModel);
			bindSession(retryCreated.session);
			await runPrompt();
		}

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

export const piExtension = { id: "subagents" };

export default function (pi: ExtensionAPI) {
	// Allow non-interactive runs (e.g. ralph-loop spawning pi) to start with
	// subagent workflow mode already enabled, so the model is steered to use the
	// `subagent` tool without anyone typing `/subagent on`.
	//
	// Two supported mechanisms:
	//   1. CLI flag `--subagents` (the documented pi.registerFlag mechanism) —
	//      spawn with `pi --subagents ...`.
	//   2. Env var `PI_SUBAGENT_MODE=1` — convenient for process spawners that
	//      already pass an env map.
	pi.registerFlag("subagents", {
		description: "Start with subagent workflow mode enabled (explore/shell fan-out)",
		type: "boolean",
		default: false,
	});
	const subagentModeEnvDefault = /^(1|true|yes|on)$/i.test(
		process.env.PI_SUBAGENT_MODE ?? "",
	);
	// Resolves the startup default from CLI flag (preferred) or env var. getFlag
	// is only reliable once flags are parsed, so callers use this at session_start.
	const resolveSubagentModeDefault = (): boolean =>
		pi.getFlag("subagents") === true || subagentModeEnvDefault;
	let subagentModeEnabled = subagentModeEnvDefault;
	const activeSubagents = new Map<string, RunningSubagentStatus>();
	let tuiRef: { requestRender: () => void } | undefined;
	let spinnerTimer: ReturnType<typeof setInterval> | undefined;

	let _piSettings: CapabilityVisibilitySettings = {};
	const visibilityResult = loadCapabilityVisibilitySettings();
	for (const warning of visibilityResult.warnings) {
		console.warn(`[subagents] capability-visibility: ${warning.message}`);
	}
	_piSettings = visibilityResult.settings;
	const managed = createManagedExtension(pi, { id: piExtension.id, visibility: _piSettings });

	// Shared global so other extensions (e.g. usage-footer) can render our status
	// and include real subagent billing in the session totals. Subagents run in
	// their own in-memory sessions, so their cost/tokens never appear in the
	// parent's sessionManager branch — we accumulate them here so the footer can
	// add them on top.
	const subagentState = ((globalThis as any).__subagent ??= {
		enabled: false,
		active: 0,
		label: "off",
		statuses: [],
		totalCostUsd: 0,
		totalTokens: 0,
		totalInputTokens: 0,
		totalOutputTokens: 0,
		totalCacheTokens: 0,
	}) as {
		enabled: boolean;
		active: number;
		label: string;
		statuses: RunningSubagentStatus[];
		totalCostUsd: number;
		totalTokens: number;
		totalInputTokens: number;
		totalOutputTokens: number;
		totalCacheTokens: number;
	};

	function publishStateLabel() {
		subagentState.enabled = subagentModeEnabled;
		subagentState.active = activeSubagents.size;
		subagentState.statuses = [...activeSubagents.values()];
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

	function resetBatchCoachState() {
		batchCoachBuffer.length = 0;
		batchCoachNudged = false;
	}

	function setSubagentMode(enabled: boolean) {
		subagentModeEnabled = enabled;
		resetBatchCoachState();
		publishStateLabel();
		pi.appendEntry("subagent-mode", { enabled, timestamp: Date.now() });
		// Re-register tool with updated prompting metadata
		managed.registerTool({ ...buildSubagentToolDef(enabled), defaultVisibility: "agent-visible" as const });
	}

	pi.on("session_start", async (_event, ctx) => {
		subagentModeEnabled = resolveSubagentModeDefault();
		activeSubagents.clear();
		resetBatchCoachState();
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
		// Sync the tool's prompting metadata with the resolved mode so a flag/env
		// enabled run gets the steering snippet from the first turn.
		managed.registerTool({ ...buildSubagentToolDef(subagentModeEnabled), defaultVisibility: "agent-visible" as const });
		refreshSubagentStatusWidget(ctx);
	});

	// Batch-coach: active only when subagent mode is enabled (MESO-001).
	// Detects direct exploration stretches that should have started with subagents
	// and injects a steering message before the next LLM call.
	const batchCoachBuffer: BatchCoachTurnRecord[] = [];
	let batchCoachNudged = false;

	pi.on("turn_end", (event: TurnEndEvent) => {
		if (!subagentModeEnabled) return;

		const record = batchCoachSummarizeTurn(event);
		if (!record) return;

		batchCoachBuffer.push(record);
		if (batchCoachBuffer.length > BATCH_COACH_BUFFER_MAX) batchCoachBuffer.shift();

		const nudgeRecords = batchCoachSelectNudgeRecords(batchCoachBuffer);
		if (!nudgeRecords) {
			batchCoachNudged = false;
			return;
		}
		if (batchCoachNudged) return;

		// Self-narration detection: scan visible text only, not thinking blocks.
		const recentText = nudgeRecords.map((r) => r.visibleText).join("\n");
		const selfNarratedMatch = SELF_NARRATED_BATCHING_RE.exec(recentText)?.[0];

		// display: false keeps the nudge out of the TUI but it IS model-visible.
		// pi's convertToLlm() converts all CustomMessages to user messages
		// regardless of the display flag. display only gates TUI rendering.
		// Verified against @earendil-works/pi-coding-agent dist/core/messages.js
		// and docs/session-format.md ("CustomMessageEntry — Extension-injected
		// messages that DO participate in LLM context").
		//
		// Manual verification recipe:
		//   1. Run pi with /subagent on.
		//   2. Trigger 3+ direct exploration calls across read, grep, find,
		//      ls, bash, or mcp without a subagent call between them.
		//   3. Confirm the model reacts to the nudge by spawning subagents
		//      when the work is still broad.
		//   4. Run pi with /subagent off, repeat the same pattern.
		//   5. Confirm no nudge fires because of the mode guard.
		pi.sendMessage(
			{
				customType: "subagent-batch-coach",
				content: batchCoachBuildNudge(nudgeRecords, selfNarratedMatch),
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

	// Helper to build tool definition based on mode state
	// When OFF: bare description, no prompting metadata → LLM has no nudge to use subagents
	// When ON: full description + promptSnippet + promptGuidelines → behavioral push to batch
	function buildSubagentToolDef(enabled: boolean) {
		return {
			name: "subagent",
			label: "Subagent",
			description: enabled
				? "Run an isolated in-process Pi subagent. **BATCH IN PARALLEL**: emit multiple subagent calls in one assistant message and they run concurrently — always prefer a parallel batch over sequential one-by-one. Types: explore (read-only codebase investigation), shell (command-oriented investigation), custom (markdown agent from ~/.pi/agent/agents or .pi/agents)."
				: "Run an isolated in-process Pi subagent.",
			promptSnippet: enabled
				? "When subagent mode is enabled, start broad work with subagents by default. Delegate focused investigation to an isolated in-process subagent (explore = read-only, shell = with bash, custom = specialized). **Always batch independent questions as parallel subagent calls in the SAME assistant message** — they run concurrently, so 4 in parallel ≈ wall-clock cost of 1."
				: "",
			promptGuidelines: enabled
				? [
					"**BATCH IN PARALLEL — this is the #1 rule.** Multiple `subagent` calls in the same assistant message execute concurrently. Before launching any subagent, ask: 'can I split this work into 2–5 independent sub-questions?' If yes, emit them all in one message before doing direct repo exploration. Sequential one-by-one is almost always wrong.",
					"When subagent mode is enabled, start broad work with subagents by default. Use `subagent` first if the task may touch more than 2 files, asks to investigate/debug/review/trace/explain why or how, needs evidence from multiple areas, may produce long tool output, or would likely take more than 2 direct read/search/list/shell commands.",
					"Use direct tools only for narrow work: reading one known file, inspecting one known symbol, making a small edit in one known location, a quick follow-up after a subagent result, or one focused command with small output.",
					"Concrete batch examples: understanding a feature → 3 parallel explores (API route, DB model, UI call site). Debugging → 1 shell (run test) + 1 explore (map modules), fanned out together. Refactor planning → one explore per affected layer, all dispatched at once.",
					"Default broad-investigation split: use 2–4 subagents before direct exploration. Use type=explore for codebase mapping, call paths, files, docs, config, and read-only history searches. Use type=shell for commands, tests, logs, git history, reproduction, or generated output.",
					"Keep each subagent's task NARROW and focused. Don't stuff multiple questions into one mega-task — narrow, focused tasks return faster, cleaner summaries. Split first, batch second.",
					"For broad repo exploration, omit `timeoutSeconds` or use at least 600 seconds.",
				]
				: [],
			parameters: SubagentParams,
			prepareArguments: normalizeTimeoutSeconds,
			execute: async (toolCallId, params, _signal, onUpdate, ctx) => {
				const result = await runSubagent(pi, ctx, toolCallId, params, onUpdate as any, (status) => {
					if (status) activeSubagents.set(toolCallId, status);
					else activeSubagents.delete(toolCallId);
					refreshSubagentStatusWidget(ctx);
				});
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
		} satisfies ToolDefinition<typeof SubagentParams, SubagentDetails>;
	}

	pi.on("before_agent_start", async (event, ctx) => {
		if (!subagentModeEnabled) return;
		const customAgents = prioritizeCustomAgentsForDisplay(discoverCustomAgents(ctx.cwd))
			.slice(0, 20)
			.map((agent) => `- ${agent.name} (${agent.source}): ${agent.description || agent.filePath}`)
			.join("\n");
		const customAgentsText = customAgents.length > 0 ? customAgents : "- none discovered";
		return {
			systemPrompt:
				event.systemPrompt +
				`

=== Subagent workflow mode is enabled ===

You have an extra capability in this session: the \`subagent\` tool. It spins up an isolated child Pi agent with its own context window, so investigations done inside a subagent do not consume your main context. The child returns only a concise summary.

## Start broad work with subagents

Before you use direct \`read\`, \`grep\`, \`find\`, \`ls\`, \`bash\`, or \`mcp\` for investigation, classify the task. If the task is broad, spawn subagents first.

Use \`subagent\` first when any of these are true:
- The task may touch more than 2 files.
- The task asks to investigate, debug, review, trace, explain why, or explain how.
- You expect more than 2 search, read, list, shell, or MCP calls.
- The answer needs evidence from multiple areas.
- Tool output may be long.
- There are independent angles that can run in parallel.

Use direct tools only for narrow work:
- Read one known file.
- Inspect one known symbol.
- Make a small edit in one known location.
- Follow up on a subagent result.
- Run one focused command whose output is small.

## Batch in parallel

If using subagents, dispatch them as a SINGLE BATCH in one assistant message. Do not run one subagent, wait, then run another independent subagent. A good batch is usually 2 to 4 narrow tasks.

Default split:
- type=\"explore\" for codebase mapping, call paths, files, docs, config, and read-only history searches.
- type=\"shell\" for commands, tests, logs, git history, reproduction, or generated output.
- type=\"custom\" with \`customAgent\` for a specialized markdown-defined agent.

Examples:
- Understanding a feature: launch 3 explores in parallel. One for the API route, one for the data model, and one for the UI call site.
- Debugging a failure: launch 1 shell to run or reproduce it, plus 1 explore to map involved modules.
- Investigating two displayed numbers: launch one explore for each subsystem and one shell for git history or command evidence.
- Reviewing a PR-sized change: launch one explore per touched subsystem.

Anti-patterns:
- Do not use a subagent for a single \`read\` of a known file. Read it directly.
- Do not stuff every question into one giant subagent prompt. Split first, batch second.
- Do not do a broad direct grep/read sweep before spawning subagents. That defeats the point of this mode.

For broad repo exploration, omit \`timeoutSeconds\` or use at least 600 seconds.

## Available custom subagents
${customAgentsText}`,
		};
	});

	// Initial registration. Defaults OFF unless PI_SUBAGENT_MODE enables it, in
	// which case the prompting metadata is included from startup.
	managed.registerTool({ ...buildSubagentToolDef(subagentModeEnvDefault), defaultVisibility: "agent-visible" as const });

	managed.registerCommand("subagent", {
		description: "Enable, disable, or show session-level subagent workflow instructions",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
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


	managed.registerCommand("subagents", {
		description: "List available custom subagents",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
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

	managed.registerCommand("subagents-model", {
		description: "Open a TUI editor for per-subagent model choices",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			if (!ctx.hasUI || ctx.mode !== "tui") {
				ctx.ui.notify("/subagents-model requires TUI mode.", "error");
				return;
			}

			const editableAgents = buildEditableCustomAgents(ctx.cwd);
			const typeDefault = buildEditableSubagentTypeDefault(ctx.cwd);
			const configDirsToValidate = new Set<string>([typeDefault.configDir, ...editableAgents.map((agent) => agent.configDir)]);
			for (const configDir of configDirsToValidate) {
				const configError = getCustomAgentModelConfigError(configDir);
				if (configError) ctx.ui.notify(`Ignoring invalid subagent models config. ${configError}.`, "warning");
			}

			ctx.modelRegistry.refresh();
			const registryError = ctx.modelRegistry.getError();
			if (registryError) ctx.ui.notify(registryError, "warning");
			const availableModels = await ctx.modelRegistry.getAvailable();
			if (availableModels.length === 0) {
				ctx.ui.notify("No configured models are available. You can still save inherit.", "warning");
			}
			const modelItems = buildModelSelectItems(availableModels, ctx);

			type EditorResult = { agents: EditableCustomAgent[]; typeDefault: EditableSubagentTypeDefault | undefined } | undefined;
			const result = await ctx.ui.custom<EditorResult>(
				(_tui, theme, keybindings, done) => new SubagentModelsEditor(
					editableAgents.map((agent) => ({ ...agent })),
					modelItems,
					(agents, savedTypeDefault) => done({
						agents: agents.map((agent) => ({ ...agent })),
						typeDefault: savedTypeDefault ? { ...savedTypeDefault } : undefined,
					}),
					(data) => keybindings.matches(data, "app.models.save"),
					() => done(undefined),
					theme,
					done,
					{ ...typeDefault },
				),
				{ overlay: true, overlayOptions: { anchor: "center", width: "90%" } },
			);
			if (!result) return;

			const writtenPaths = writeCustomAgentModelChoices(result.agents);
			if (result.typeDefault) {
				const savedValue = result.typeDefault.currentValue === INHERIT_MODEL_CHOICE
					? INHERIT_MODEL_CHOICE
					: result.typeDefault.currentValue;
				const typeDefaultPath = writeSubagentDefaultModel(result.typeDefault.configDir, savedValue);
				if (!writtenPaths.includes(typeDefaultPath)) writtenPaths.push(typeDefaultPath);
			}
			writtenPaths.sort((left, right) => left.localeCompare(right));
			if (writtenPaths.length === 0) {
				ctx.ui.notify("No subagent model choices to save.", "info");
				return;
			}
			ctx.ui.notify(`Saved subagent model choices to ${writtenPaths.join(", ")}.`, "info");
		},
	});
}
