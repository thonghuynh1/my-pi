import * as fs from "node:fs";
import { randomUUID } from "node:crypto";
import { DurableJobStore, durableSessionDirectory, hasRecordedUserMessage } from "./lib/durable-jobs.ts";
import * as os from "node:os";
import * as path from "node:path";
import {
	createManagedExtension,
	loadCapabilityVisibilitySettings,
	type CapabilityVisibilitySettings,
} from "./lib/capability-visibility.ts";
import { StringEnum } from "@earendil-works/pi-ai";
import {
	createAgentSessionFromServices,
	createAgentSessionServices,
	getAgentDir,
	getSelectListTheme,
	getSettingsListTheme,
	keyText,
	parseFrontmatter,
	SessionManager,
	SettingsManager,
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
import {
	validateVerificationReport,
	type EvidencePacketV1,
	type VerificationReportV1,
} from "./lib/evidence-packet.ts";
import {
	buildEvidencePacketPrompt,
	formatPacketResultForParent,
	projectPacketResult,
	resolveEvidencePacket,
	type PacketSelection,
} from "./lib/subagent-runtime.ts";
import {
	PACKET_RUNTIME_CAPS,
	canStartSourceOperation,
	initialPacketRuntimeState,
	packetTimeoutSeconds,
	reportToolsOnly,
	transitionPacketRuntime,
	type PacketEffectiveLimits,
	type PacketRuntimeState,
} from "./lib/packet-runtime-policy.ts";
import { type PacketTermination } from "./lib/reconciliation.ts";
import {
	BackgroundJobRegistry,
	DELIVERY_HEADER,
	DEFAULT_BACKGROUND_TIMEOUT_SECONDS,
	MAX_BACKGROUND_SUBAGENTS,
	clampWaitSeconds,
	durationSeconds,
	formatDeliveryMessage,
	formatJobResult,
	longTtlWanted,
	resolveWaitTargets,
	selectDeliverable,
	selectWaitResults,
	shouldApplyLongCacheTtl,
	withLongCacheTtl,
	type BackgroundJob,
	type StoredBackgroundJob,
	type SubagentMode,
	type SubagentReport,
	resolveSubagentMode,
	buildRecoveryTask,
} from "./lib/subagent-background.ts";
import {
	parseRoutingConfig,
	resolveRoutingConfig,
	type EffectiveRoutingConfig,
} from "./lib/routing-policy.ts";

import {
	childContextPolicy, followupReset, buildFollowupHandoff, isReusableChild,
	type ChildConfig, type ChildReuse, type ChildContext, type ChildSessionPlan,
} from "./lib/subagent-context.ts";

/** SDK factory boundary; production uses the installed SDK, tests can supply local providers. */
export interface SubagentSdk {
	createServices: typeof createAgentSessionServices;
	createSession: typeof createAgentSessionFromServices;
}
const defaultSdk: SubagentSdk = { createServices: createAgentSessionServices, createSession: createAgentSessionFromServices };

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
	routing: EffectiveRoutingConfig;
	source?: AgentSource;
	filePath?: string;
}


interface ModelSelection {
	model?: ActiveModel;
	requestedModel?: string;
	usedFallback: boolean;
}

interface SubagentDetails extends SubagentReport {
	persistenceError?: string;
	mode?: SubagentMode;
	jobId?: string;
	reuse?: ChildReuse;
	followedFrom?: string;
	report?: SubagentReport;
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

const BATCH_COACH_TOOLS: ReadonlySet<string> = new Set(["bash", "read", "grep", "ls", "mcp"]);
const BATCH_COACH_BUFFER_MAX = 10;
const BATCH_COACH_N = 3;
const DEPENDENCY_MIN_CHARS = 6;
const SELF_NARRATED_BATCHING_RE =
	/\b(in parallel|concurrently|simultaneously|in one (call|message|turn)|batch (these|them|the)|batched)\b/i;

interface BatchCoachTurnRecord {
	turnIndex: number;
	toolCallCount: number;
	toolName?: string;
	inputSummary?: string;
	outputSample?: string;
	visibleText: string;
	isError: boolean;
}

function batchCoachExtractToolInputSummary(toolName: string, args: Record<string, unknown>): string {
	if (toolName === "bash") return String(args.command ?? "").slice(0, 120);
	if (toolName === "read") return String(args.path ?? "").slice(0, 120);
	if (toolName === "grep") return String(args.pattern ?? args.query ?? "").slice(0, 120);
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

	return { turnIndex: event.turnIndex, toolCallCount, toolName, inputSummary, outputSample, visibleText, isError };
}

function batchCoachInputDependsOnPriorOutput(priorRecords: BatchCoachTurnRecord[], nextRecord: BatchCoachTurnRecord): boolean {
	const nextInput = nextRecord.inputSummary;
	if (!nextInput) return false;
	for (const priorRecord of priorRecords) {
		const outputSample = priorRecord.outputSample;
		if (!outputSample || outputSample.length < DEPENDENCY_MIN_CHARS) continue;
		if (nextInput.includes(outputSample)) return true;
		if (outputSample.includes(nextInput)) return true;
		const words = outputSample.split(/\s+/).filter((w) => w.length >= DEPENDENCY_MIN_CHARS);
		if (words.some((w) => nextInput.includes(w))) return true;
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

function batchCoachBuildNudge(records: BatchCoachTurnRecord[], selfNarratedMatch: string | undefined): string {
	const slice = records.slice(-BATCH_COACH_N);
	let text = "";
	if (selfNarratedMatch) {
		text += `You wrote "${selfNarratedMatch}" but then executed the calls sequentially.\n\n`;
	}
	text += "Your last turns were independent single-call probes:\n";
	for (let i = 0; i < slice.length; i++) {
		const r = slice[i];
		text += `${i + 1}. ${r.toolName}(${r.inputSummary ?? "..."})\n`;
	}
	text += `\nBefore your next tool call, plan the next 2\u20133 calls together. If independent, batch them via:\n`;
	text += `- one chained bash command: \`cmd1 && cmd2\`\n`;
	text += `- multiple tool calls in the same assistant message\n`;
	text += `- a focused subagent when the work spans several files\n`;
	text += `\nContinue your work \u2014 but batched.`;
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
	checkpointOutput?: string;
	sessionFilePath?: string;
	inputTokens: number;
	outputTokens: number;
	cacheTokens: number;
	totalTokens: number;
	cost: number;
	contextTokens?: number | null;
	contextWindow?: number;
	contextPercent?: number | null;
	context?: ChildContext;
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
			description: "Optional timeout in seconds. Packet calls honor up to 300 seconds; ordinary calls use a 600-second minimum; calls without a timeout default to 1800 seconds.",
			minimum: 1,
		}),
	),
	evidencePacket: Type.Optional(Type.Unknown({ description: "Optional selected EvidencePacketV1 slice. Invalid packets visibly fall back to prose." })),
	mode: Type.Optional(StringEnum(["joined", "detached"] as const, { description: "Defaults to joined: required result returned after child cleanup. Detached is only for optional results delivered later." })),
	background: Type.Optional(
		Type.Boolean({
			description: "Legacy alias: true=detached, false=joined. Must agree with mode; omission defaults to joined.",
		}),
	),
});

type SubagentParamsType = Static<typeof SubagentParams>;

const SubagentWaitParams = Type.Object({
	waitFor: Type.Optional(StringEnum(["all", "any"] as const, { description: "Defaults to all. Any returns after at least one targeted terminal outcome." })),
	jobIds: Type.Optional(Type.Array(Type.String(), { description: "Child job ids (e.g. 'sa-1'). Defaults to running and undelivered finished jobs." })),
	timeoutSeconds: Type.Optional(Type.Number({ description: "Maximum seconds to wait. Default 120, max 240." })),
});

const SubagentFollowupParams = Type.Object({
	jobId: Type.String({ description: "Successful normal child to reuse explicitly; never an interrupted or packet child." }),
	task: Type.String({ description: "Explicit related follow-up assignment." }),
	mode: Type.Optional(StringEnum(["joined", "detached"] as const)),
	background: Type.Optional(Type.Boolean({ description: "Legacy mode alias: true=detached, false=joined." })),
	timeoutSeconds: Type.Optional(Type.Number({ minimum: 1 })),
});
type SubagentFollowupParamsType = Static<typeof SubagentFollowupParams>;

type SubagentWaitParamsType = Static<typeof SubagentWaitParams>;

const SubagentStatusParams = Type.Object({
	jobId: Type.Optional(Type.String({ description: "Child job id. Omit for all jobs." })),
});

type SubagentStatusParamsType = Static<typeof SubagentStatusParams>;

const SubagentCancelParams = Type.Object({
	jobId: Type.String({ description: "Child job id to cancel (e.g. 'sa-1')." }),
});

type SubagentCancelParamsType = Static<typeof SubagentCancelParams>;

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

export function readSubagentRoutingConfig(cwd: string): EffectiveRoutingConfig {
	const layers = getSubagentDefaultsSearchDirs(cwd).map((dir) => {
		if (!dir) return undefined;
		const raw = readJsonObjectFile(getCustomAgentModelsPath(dir));
		const block = raw && isRecord(raw.subagents) ? raw.subagents : undefined;
		return parseRoutingConfig(block?.routing);
	});
	return resolveRoutingConfig({ package: layers[0], user: layers[1], project: layers[2] });
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
	const routing = readSubagentRoutingConfig(cwd);
	if (params.type === "explore") {
		const defaults = readSubagentTypeDefaults(cwd);
		return {
			type: "explore",
			name: "explore",
			description: "Read-only codebase exploration",
			prompt: EXPLORE_PROMPT,
			tools: ["read", "grep", "find", "ls"],
			model: params.model ?? defaults.default,
			routing,
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
			routing,
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
		routing,
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

function sameTranscript(left: string | undefined, right: string | undefined): boolean {
	if (!left || !right) return false;
	const canonical = (value: string) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
	return canonical(left) === canonical(right);
}

function sameModelId(id: string, model: ExtensionContext["model"]): boolean {
	return Boolean(model && id === `${model.provider}/${model.id}`);
}
function findSavedModel(id: string, registry: ExtensionContext["modelRegistry"]): ActiveModel | undefined {
	const slash = id.indexOf("/");
	return slash > 0 ? registry.find(id.slice(0, slash), id.slice(slash + 1)) : undefined;
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

export function normalizeTimeoutSeconds(params: unknown): SubagentParamsType {
	if (!params || typeof params !== "object") return params as SubagentParamsType;
	const input = params as Record<string, unknown>;
	const packet = resolveEvidencePacket(input.evidencePacket);
	if (packet.mode === "packet") {
		const requested = input.timeoutSeconds;
		if (typeof requested === "number" && requested > 0) {
			return { ...input, timeoutSeconds: packetTimeoutSeconds(requested) } as SubagentParamsType;
		}
		return { ...input, timeoutSeconds: PACKET_RUNTIME_CAPS.timeoutSeconds } as SubagentParamsType;
	}
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

function assistantFailureReason(messages: unknown[]): string | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i] as { role?: string; stopReason?: string; errorMessage?: string } | undefined;
		if (message?.role !== "assistant") continue;
		if (message.stopReason === "error") return message.errorMessage || "The subagent model returned an error.";
		if (message.stopReason === "aborted") return "The subagent was aborted.";
	}
	return undefined;
}

function packetLimitTermination(state: PacketRuntimeState): PacketTermination {
	if (state.turns >= state.limits.maxSourceTurns) return "turn-limit";
	if (state.toolCalls >= state.limits.maxSourceToolCalls) return "tool-limit";
	return "error";
}

function truncateForToolResult(text: string, maxBytes = 50 * 1024): string {
	if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
	let truncated = text.slice(0, maxBytes);
	while (Buffer.byteLength(truncated, "utf8") > maxBytes) truncated = truncated.slice(0, -1);
	return `${truncated}\n\n[Subagent output truncated to ${maxBytes} bytes.]`;
}

interface CompletedChildToolOutput {
	name: string;
	isError: boolean;
	text: string;
}

const RETAINED_TOOL_OUTPUT_MAX_BYTES = 40 * 1024;

export function extractToolResultText(result: unknown): string {
	if (!isRecord(result) || !Array.isArray(result.content)) return "";
	const text: string[] = [];
	for (const part of result.content) {
		if (isRecord(part) && part.type === "text" && typeof part.text === "string") text.push(part.text);
	}
	return text.join("\n");
}

export function appendRetainedToolOutput({
	assistantOutput,
	toolOutputs,
}: {
	assistantOutput: string;
	toolOutputs: ReadonlyArray<CompletedChildToolOutput>;
}): string {
	if (toolOutputs.length === 0) return assistantOutput;
	const retained = toolOutputs
		.map((output) => `${output.name} (${output.isError ? "failed" : "completed"}):\n${output.text}`)
		.join("\n\n");
	const assistantSection = assistantOutput ? `\n\nPartial assistant output before termination:\n\n${assistantOutput}` : "";
	return `Completed child tool results before termination:\n\n${retained}${assistantSection}`;
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

function applyAssistantUsage(status: RunningSubagentStatus, message: { role: string; usage?: AssistantUsage }): void {
	if (message.role !== "assistant") return;
	const usage = message.usage;
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
	ctx: Pick<ExtensionContext, "cwd" | "model" | "modelRegistry" | "signal">,
	toolCallId: string,
	params: SubagentParamsType,
	onUpdate: ((partial: { content: Array<{ type: "text"; text: string }>; details?: Partial<SubagentDetails> }) => void) | undefined,
	statusSink?: SubagentStatusSink,
	signal?: AbortSignal,
	durableDirectory?: string,
	checkpointControl?: { flush?: () => void },
	control?: { config: ChildConfig; plan: ChildSessionPlan; resolvedModel: (model: string) => void; allowFallback: boolean },
	sdk: SubagentSdk = defaultSdk,
): Promise<SubagentDetails> {
	const packetSelection: PacketSelection = resolveEvidencePacket(params.evidencePacket);
	params = normalizeTimeoutSeconds(params);
	const cwd = path.resolve(ctx.cwd, normalizePathArgument(params.cwd ?? "."));
	const config = control?.config ?? resolveRunConfig(params, cwd);
	const packet = packetSelection.mode === "packet" ? packetSelection.packet : undefined;
	const inheritedModel = ctx.model;
	const modelSelection = control
		? { model: sameModelId(control.config.model, inheritedModel) ? inheritedModel : findSavedModel(control.config.model, ctx.modelRegistry), usedFallback: false, requestedModel: config.model }
		: selectSubagentModel(config.model, inheritedModel, ctx.modelRegistry);
	const selectedModel = modelSelection.model;
	if (!selectedModel) {
		throw new Error(
			modelSelection.requestedModel
				? `Could not resolve model override "${modelSelection.requestedModel}" and no active model is available for fallback.`
				: "No active model is available for the subagent.",
		);
	}
	let resolvedModel: ActiveModel = selectedModel;
	const policy = childContextPolicy(resolvedModel.contextWindow);
	const context: ChildContext = { tokens: null, window: resolvedModel.contextWindow, budget: policy.budget, reset: control?.plan.reset ?? "none" };
	const priorAttemptUsage = { inputTokens: 0, outputTokens: 0, cacheTokens: 0, totalTokens: 0, costUsd: 0 };
	let initialStats: ReturnType<Awaited<ReturnType<typeof createAgentSessionFromServices>>["session"]["getSessionStats"]> | undefined;
	const readSegmentUsage = () => {
		if (!session || !initialStats) return;
		const stats = session.getSessionStats();
		liveStatus.inputTokens = priorAttemptUsage.inputTokens + Math.max(0, stats.tokens.input - initialStats.tokens.input);
		liveStatus.outputTokens = priorAttemptUsage.outputTokens + Math.max(0, stats.tokens.output - initialStats.tokens.output);
		liveStatus.cacheTokens = priorAttemptUsage.cacheTokens + Math.max(0, stats.tokens.cacheRead + stats.tokens.cacheWrite - initialStats.tokens.cacheRead - initialStats.tokens.cacheWrite);
		liveStatus.totalTokens = priorAttemptUsage.totalTokens + Math.max(0, stats.tokens.total - initialStats.tokens.total);
		liveStatus.cost = priorAttemptUsage.costUsd + Math.max(0, stats.cost - initialStats.cost);
	};

	const timeoutController = new AbortController();
	let timeout: NodeJS.Timeout | undefined;
	let finalMessages: unknown[] = [];
	let streamingText = "";
	let turns = 0;
	const toolCalls: Array<{ name: string; args: unknown; isError?: boolean }> = [];
	const completedToolOutputs: CompletedChildToolOutput[] = [];
	let retainedToolOutputBytes = 0;
	let session: Awaited<ReturnType<typeof createAgentSessionFromServices>>["session"] | undefined;
	let unsubscribeSession: (() => void) | undefined;
	let verificationReport: VerificationReportV1 | undefined;
	let runtimeState: PacketRuntimeState | undefined = packet ? initialPacketRuntimeState(packet.limits, config.routing) : undefined;
	let termination: PacketTermination = "completed";
	let reportPromptSent = false;
	let reportOnlyRequested = false;
	let reportAbortPromise: Promise<void> | undefined;
	const timeoutSeconds = packet
		? packetTimeoutSeconds(packet.limits?.timeoutSeconds ?? params.timeoutSeconds, Math.min(PACKET_RUNTIME_CAPS.timeoutSeconds, config.routing.timeoutSeconds))
		: params.timeoutSeconds;
	const effectiveLimits: PacketEffectiveLimits | undefined = packet && runtimeState
		? { ...runtimeState.limits, timeoutSeconds: timeoutSeconds ?? PACKET_RUNTIME_CAPS.timeoutSeconds }
		: undefined;
	const abortChild = (): Promise<void> => session?.abort() ?? Promise.resolve();
	const markTermination = (reason: Exclude<PacketTermination, "completed" | "turn-limit" | "tool-limit">): void => {
		if (verificationReport) return;
		if (termination === "completed") termination = reason;
		if (runtimeState) runtimeState = transitionPacketRuntime(runtimeState, { type: "terminate" });
		void abortChild();
	};
	const onCancelled = () => markTermination("cancelled");
	const onTimedOut = () => markTermination("timeout");
	ctx.signal?.addEventListener("abort", onCancelled, { once: true });
	if (signal && signal !== ctx.signal) signal.addEventListener("abort", onCancelled, { once: true });
	timeoutController.signal.addEventListener("abort", onTimedOut, { once: true });
	if (ctx.signal?.aborted || signal?.aborted) onCancelled();
	if (timeoutSeconds && timeoutSeconds > 0) timeout = setTimeout(() => timeoutController.abort(), timeoutSeconds * 1000);
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
		contextWindow: resolvedModel.contextWindow,
		contextPercent: null,
		customAgentPath: config.filePath,
		customAgentSource: config.source,
	};

	let lastCheckpointAt = 0;
	const publishStatus = (forceCheckpoint = false) => {
		if (session) {
			const usage = session.getContextUsage();
			if (usage) {
				liveStatus.contextTokens = usage.tokens;
				liveStatus.contextWindow = usage.contextWindow;
				liveStatus.contextPercent = usage.percent;
				context.tokens = usage.tokens;
				context.window = usage.contextWindow;
			}
		}
		liveStatus.turns = turns;
		const checkpointDue = durableDirectory && (forceCheckpoint || Date.now() - lastCheckpointAt >= 1000);
		if (checkpointDue) lastCheckpointAt = Date.now();
		statusSink?.({
			...liveStatus, toolCalls: [...toolCalls], sessionFilePath: session?.sessionFile, context: { ...context },
			checkpointOutput: checkpointDue
				? appendRetainedToolOutput({ assistantOutput: streamingText.trim(), toolOutputs: completedToolOutputs })
				: undefined,
		});
	};
	if (checkpointControl) checkpointControl.flush = () => publishStatus(true);

	try {
		const services = await sdk.createServices({
			cwd,
			settingsManager: SettingsManager.inMemory({ compaction: policy.compaction }),
			resourceLoaderOptions: {
				// Keep child agents isolated and avoid recursively loading this extension.
				noExtensions: true,
				appendSystemPrompt: [config.prompt],
			},
		});

		const reportTool = packet ? {
			name: "report_verification",
			label: "Report verification",
			description: "Submit exactly one structured outcome for every owned evidence claim.",
			parameters: Type.Object({
				claims: Type.Array(Type.Object({ claimId: Type.String(), status: Type.Union([Type.Literal("confirmed"), Type.Literal("contradicted"), Type.Literal("unresolved")]), explanation: Type.String(), evidence: Type.Array(Type.Object({ path: Type.String(), line: Type.Integer({ minimum: 1 }), endLine: Type.Optional(Type.Integer({ minimum: 1 })), symbol: Type.String() })) })),
				newLeads: Type.Array(Type.Object({ id: Type.String(), summary: Type.String(), material: Type.Boolean(), anchors: Type.Array(Type.Object({ path: Type.String(), line: Type.Integer({ minimum: 1 }), endLine: Type.Optional(Type.Integer({ minimum: 1 })), symbol: Type.String(), kind: Type.Optional(Type.String()) })) })),
			}),
			execute: async (_toolCallId: string, report: VerificationReportV1) => {
				if (!runtimeState || runtimeState.phase !== "report-only" || runtimeState.reportCalls !== 1) {
					return { content: [{ type: "text" as const, text: "Invalid verification report: the reserved report operation is not active." }], details: { valid: false, errors: ["report operation is not active"] } };
				}
				const validated = validateVerificationReport(report, packet);
				if (!validated.ok) return { content: [{ type: "text" as const, text: `Invalid verification report: ${validated.errors.join("; ")}` }], details: { valid: false, errors: validated.errors } };
				verificationReport = validated.value;
				runtimeState = transitionPacketRuntime(runtimeState, { type: "report-accepted" });
				session?.setActiveToolsByName([]);
				queueMicrotask(() => { void abortChild(); });
				return { content: [{ type: "text" as const, text: "Verification report accepted." }], details: { valid: true } };
			},
		} satisfies ToolDefinition<any, unknown> : undefined;
		const createChildSession = (model: ActiveModel) =>
			sdk.createSession({
				services,
				sessionManager: control?.plan.kind === "reopen" ? SessionManager.open(control.plan.transcript) : durableDirectory ? SessionManager.create(cwd, durableDirectory) : SessionManager.inMemory(cwd),
				model,
				tools: packet
					? (runtimeState && reportToolsOnly(runtimeState) ? ["report_verification"] : [...config.tools, "report_verification"])
					: config.tools,
				customTools: reportTool ? [reportTool] : undefined,
				thinkingLevel: control?.config.thinkingLevel ?? pi.getThinkingLevel(),
			});
		let created: Awaited<ReturnType<typeof createAgentSessionFromServices>>;
		try {
			if (termination !== "completed") throw new Error(`Subagent ${termination} before session creation.`);
			created = await createChildSession(resolvedModel);
		} catch (error) {
			const fallbackModel = inheritedModel;
			const canFallbackToInheritedModel = Boolean(
				termination === "completed" && (control?.allowFallback ?? true) && config.model && fallbackModel && !sameModel(resolvedModel, fallbackModel),
			);
			if (!canFallbackToInheritedModel || !fallbackModel) throw error;
			resolvedModel = fallbackModel;
			liveStatus.model = `${resolvedModel.provider}/${resolvedModel.id}`;
			liveStatus.preview = `override ${config.model} failed, using inherited model`;
			publishStatus();
			created = await createChildSession(resolvedModel);
		}
		if (termination !== "completed") {
			await created.session.abort();
			created.session.dispose();
			throw new Error(`Subagent ${termination} before prompt.`);
		}
		const resetAttemptState = () => {
			finalMessages = [];
			streamingText = "";
			turns = 0;
			toolCalls.length = 0;
			liveStatus.currentTool = undefined;
			liveStatus.inputTokens = priorAttemptUsage.inputTokens;
			liveStatus.outputTokens = priorAttemptUsage.outputTokens;
			liveStatus.cacheTokens = priorAttemptUsage.cacheTokens;
			liveStatus.totalTokens = priorAttemptUsage.totalTokens;
			liveStatus.cost = priorAttemptUsage.costUsd;
			liveStatus.contextTokens = null;
			liveStatus.contextWindow = resolvedModel.contextWindow;
			liveStatus.contextPercent = null;
		};

		const activateReportOnly = (abortCurrentTurn = false) => {
			if (!packet || !session || !runtimeState || !reportToolsOnly(runtimeState)) return;
			reportOnlyRequested = true;
			session.setActiveToolsByName(["report_verification"]);
			liveStatus.preview = "source limits reached; report verification only";
			publishStatus();
			if (abortCurrentTurn) reportAbortPromise = abortChild().catch(() => undefined);
		};

		const bindSession = (nextSession: Awaited<ReturnType<typeof createAgentSessionFromServices>>["session"]) => {
			unsubscribeSession?.();
			session = nextSession;
			initialStats = nextSession.getSessionStats();
			control?.resolvedModel(`${resolvedModel.provider}/${resolvedModel.id}`);
			const nextPolicy = childContextPolicy(resolvedModel.contextWindow);
			services.settingsManager.applyOverrides({ compaction: nextPolicy.compaction });
			context.window = resolvedModel.contextWindow;
			context.budget = nextPolicy.budget;
			publishStatus();
			unsubscribeSession = nextSession.subscribe((event) => {
				switch (event.type) {
				case "agent_start": {
					liveStatus.preview = "agent session started";
					publishStatus();
					onUpdate?.({
						content: [{ type: "text", text: `Started ${config.type} subagent: ${config.name}` }],
						details: { type: config.type, name: config.name, task: params.task, cwd, tools: config.tools, status: "running" },
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
					const isReport = event.toolName === "report_verification";
					const operationAllowed = !runtimeState || (isReport
						? (runtimeState.phase === "report-only" || runtimeState.phase === "investigating") && runtimeState.reportCalls === 0 && runtimeState.toolCalls < runtimeState.limits.maxToolCalls && runtimeState.turns < runtimeState.limits.maxTurns
						: canStartSourceOperation(runtimeState));
					if (!operationAllowed) {
						activateReportOnly(true);
						break;
					}
					if (runtimeState) {
						runtimeState = transitionPacketRuntime(runtimeState, { type: isReport ? "report-call-start" : "source-call-start" });
						if (reportToolsOnly(runtimeState)) activateReportOnly(!isReport);
					}
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
					const text = extractToolResultText(event.result);
					if (text && retainedToolOutputBytes < RETAINED_TOOL_OUTPUT_MAX_BYTES) {
						const remainingBytes = RETAINED_TOOL_OUTPUT_MAX_BYTES - retainedToolOutputBytes;
						const retainedText = truncateForToolResult(text, remainingBytes);
						completedToolOutputs.push({ name: event.toolName, isError: event.isError, text: retainedText });
						retainedToolOutputBytes += Buffer.byteLength(retainedText, "utf8");
					}
					liveStatus.currentTool = undefined;
					liveStatus.preview = `${event.toolName} ${event.isError ? "failed" : "finished"}`;
					publishStatus(true);
					break;
				}
				case "message_end": {
					const message = event.message;
					if (message.role === "assistant") finalMessages.push(message);
					applyAssistantUsage(liveStatus, message);
					publishStatus(true);
					break;
				}
				case "turn_end": {
					if (runtimeState) {
						runtimeState = transitionPacketRuntime(runtimeState, { type: "turn-end" });
						turns = runtimeState.turns;
						if (reportToolsOnly(runtimeState)) activateReportOnly();
						if (!verificationReport && runtimeState.turns >= runtimeState.limits.maxTurns) {
							termination = termination === "completed" ? packetLimitTermination(runtimeState) : termination;
							runtimeState = transitionPacketRuntime(runtimeState, { type: "terminate" });
							void abortChild();
						}
					} else {
						turns += 1;
					}
					publishStatus();
					break;
				}
				case "compaction_end": {
					readSegmentUsage();
					if (event.errorMessage || event.aborted) context.compactionError = event.errorMessage ?? "Child compaction aborted; explicit fresh handoff required.";
					publishStatus(true);
					break;
				}
				case "agent_end": {
					readSegmentUsage();
					liveStatus.preview = "finalizing...";
					publishStatus(true);
					break;
				}
				}
			});
		};

		bindSession(created.session);
		if (runtimeState && reportToolsOnly(runtimeState)) activateReportOnly();

		const prompt = packet ? `${buildEvidencePacketPrompt(packet, effectiveLimits)}\n\nParent task: ${params.task}` : `Task: ${params.task}\n\nReturn only the useful findings for the parent agent.`;
		const runPrompt = async (promptText: string) => {
			const signals = [ctx.signal, signal, timeoutController.signal].filter((value): value is AbortSignal => Boolean(value));
			let rejectCancelled: (reason: Error) => void = () => {};
			const cancelled = new Promise<never>((_, reject) => { rejectCancelled = reject; });
			const onAbort = () => rejectCancelled(new Error(timeoutController.signal.aborted ? `Subagent timed out after ${timeoutSeconds ?? 0} seconds.` : "Subagent was aborted."));
			for (const source of signals) source.addEventListener("abort", onAbort, { once: true });
			try {
				if (signals.some((source) => source.aborted)) throw new Error("Subagent was aborted before prompt.");
				await Promise.race([session!.prompt(promptText), cancelled]);
			} finally {
				for (const source of signals) source.removeEventListener("abort", onAbort);
			}
		};
		if (control?.plan.kind === "reopen") {
			const current = session!.getContextUsage();
			if (current?.tokens === null || !current) throw new Error("Reopened child context is unknown. Start a reviewed fresh handoff instead.");
			if (current.tokens > context.budget) {
				try { await session!.compact("Preserve the original goal, verified facts, evidence paths, and unresolved constraints."); }
				catch (error) { throw new Error(`Child compaction failed; explicit fresh handoff required: ${error instanceof Error ? error.message : String(error)}`); }
				const after = session!.getContextUsage();
				if (after?.tokens !== null && after?.tokens !== undefined && after.tokens > context.budget) throw new Error("Child remains over its context budget after compaction; explicit fresh handoff required.");
			}
		}

		try {
			await runPrompt(control?.plan.kind === "handoff" ? `${control.plan.handoff}

${prompt}` : prompt);
		} catch (error) {
			const fallbackModel = inheritedModel;
			const canRetryPromptWithInheritedModel = Boolean(
				termination === "completed" && (control?.allowFallback ?? true) && !reportOnlyRequested && config.model && fallbackModel && !sameModel(resolvedModel, fallbackModel) && turns === 0 && toolCalls.length === 0,
			);
			if (reportOnlyRequested && termination === "completed") {
				await reportAbortPromise;
			} else if (!canRetryPromptWithInheritedModel || !fallbackModel) {
				throw error;
			} else {
				await session?.abort();
				readSegmentUsage();
				Object.assign(priorAttemptUsage, { inputTokens: liveStatus.inputTokens, outputTokens: liveStatus.outputTokens, cacheTokens: liveStatus.cacheTokens, totalTokens: liveStatus.totalTokens, costUsd: liveStatus.cost });
				session?.dispose();
				unsubscribeSession?.();
				unsubscribeSession = undefined;
				resetAttemptState();
				resolvedModel = fallbackModel;
				liveStatus.model = `${resolvedModel.provider}/${resolvedModel.id}`;
				liveStatus.preview = `override ${config.model} failed, using inherited model`;
				const retryCreated = await createChildSession(resolvedModel);
				if (termination !== "completed") {
					await retryCreated.session.abort();
					retryCreated.session.dispose();
					throw new Error(`Subagent ${termination} before retry prompt.`);
				}
				bindSession(retryCreated.session);
				await runPrompt(prompt);
			}
		}
		if (packet && reportOnlyRequested && !verificationReport && !reportPromptSent && termination === "completed") {
			reportPromptSent = true;
			activateReportOnly();
			await reportAbortPromise;
			try {
				await runPrompt("Source investigation is complete. Use report_verification now. Report every owned claim exactly once. Do not call any source tools.");
			} catch (error) {
				if (!verificationReport || termination !== "completed") throw error;
			}
		}

		if (packet && !verificationReport && termination === "completed") {
			termination = runtimeState ? packetLimitTermination(runtimeState) : "error";
		}
		if (termination === "completed" && !verificationReport) {
			const failure = assistantFailureReason(finalMessages);
			if (failure) termination = "error";
		}
		readSegmentUsage();
		publishStatus(true);
		const { mode: evidenceMode, ...packetFields } = projectPacketResult(packetSelection, verificationReport, termination, effectiveLimits);
		const packetProjection = { evidenceMode, ...packetFields };
		const output = finalAssistantText(finalMessages) || streamingText.trim() || "(subagent completed with no output)";
		const parentOutput = formatPacketResultForParent(packetSelection, { mode: evidenceMode, ...packetFields }, output);
		const failure = assistantFailureReason(finalMessages);
		const runFailed = Boolean(context.compactionError) || termination === "timeout" || termination === "cancelled" || termination === "error" || Boolean(failure && !verificationReport) || Boolean(packetProjection.incomplete);
		return {
			type: config.type,
			name: config.name,
			...packetProjection,
			task: params.task,
			cwd,
			tools: config.tools,
			model: `${resolvedModel.provider}/${resolvedModel.id}`,
			status: runFailed ? "error" : "completed",
			output: runFailed
				? appendRetainedToolOutput({ assistantOutput: parentOutput, toolOutputs: completedToolOutputs })
				: parentOutput,
			...(runFailed ? { error: context.compactionError ?? failure ?? (packetProjection.incomplete ? `Structured verification incomplete (${termination}).` : `Subagent terminated (${termination}).`) } : {}),
			turns,
			toolCalls,
			customAgentPath: config.filePath,
			customAgentSource: config.source,
			transcript: session?.sessionFile,
			context: { ...context },
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
		await session?.abort();
		const message = error instanceof Error ? error.message : String(error);
		if (packet && termination === "completed") termination = runtimeState ? packetLimitTermination(runtimeState) : "error";
		readSegmentUsage();
		publishStatus(true);
		const { mode: evidenceMode, ...packetFields } = projectPacketResult(packetSelection, verificationReport, termination, effectiveLimits);
		const packetProjection = { evidenceMode, ...packetFields };
		const output = appendRetainedToolOutput({ assistantOutput: streamingText.trim(), toolOutputs: completedToolOutputs });
		return {
			type: config.type,
			name: config.name,
			...packetProjection,
			task: params.task,
			cwd,
			tools: config.tools,
			model: resolvedModel ? `${resolvedModel.provider}/${resolvedModel.id}` : undefined,
			status: "error",
			output: formatPacketResultForParent(packetSelection, { mode: evidenceMode, ...packetFields }, output),
			error: message,
			turns,
			toolCalls,
			customAgentPath: config.filePath,
			customAgentSource: config.source,
			transcript: session?.sessionFile,
			context: { ...context },
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
		try { if (durableDirectory) publishStatus(true); }
		catch (error) { console.error(`[subagents] checkpoint failed for ${toolCallId}`, error); }
		if (checkpointControl) checkpointControl.flush = undefined;
		statusSink?.(undefined);
		if (timeout) clearTimeout(timeout);
		ctx.signal?.removeEventListener("abort", onCancelled);
		signal?.removeEventListener("abort", onCancelled);
		timeoutController.signal.removeEventListener("abort", onTimedOut);
		unsubscribeSession?.();
		try {
			await session?.abort();
		} catch {
			// The result is already settled; disposal below is the final cleanup boundary.
		}
		session?.dispose();
	}
}

export const piExtension = { id: "subagents" };

/** Startup default for subagent workflow mode. On unless PI_SUBAGENT_MODE is 0/false/no/off. */
export function isSubagentModeDefaultEnabled(envValue: string | undefined = process.env.PI_SUBAGENT_MODE): boolean {
	return !/^(0|false|no|off)$/i.test(envValue ?? "");
}

export default function (pi: ExtensionAPI, sdk: SubagentSdk = defaultSdk) {
	// Subagent workflow mode is ON by default so the model is steered to use the
	// `subagent` tool without anyone typing `/subagent on`.
	//
	// Opt out:
	//   - `/subagent off` (session-level; persisted in the session)
	//   - env `PI_SUBAGENT_MODE=0` (also false/no/off)
	//
	// `--subagents` and `PI_SUBAGENT_MODE=1` remain accepted for compatibility.
	pi.registerFlag("subagents", {
		description: "Start with subagent workflow mode enabled (on by default)",
		type: "boolean",
		default: true,
	});
	const resolveSubagentModeDefault = (): boolean => isSubagentModeDefaultEnabled() && pi.getFlag?.("subagents") !== false;
	let subagentModeEnabled = resolveSubagentModeDefault();
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
	// their own isolated sessions, so their cost/tokens never appear in the
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

	let backgroundJobs = new BackgroundJobRegistry();
	const fallbackSessionId = randomUUID();
	let backgroundStore: DurableJobStore<StoredBackgroundJob> | undefined;
	let backgroundActive = true;
	const backgroundCheckpoints = new Map<string, () => void>();
	const childRuns = new Map<BackgroundJob, Promise<void>>();

	function initializeBackgroundStore(ctx: ExtensionContext): void {
		const directory = durableSessionDirectory(ctx, "subagents", fallbackSessionId);
		if (childRuns.size > 0 && (!backgroundActive || backgroundStore?.directory !== directory)) throw new Error("Previous child generation is still cleaning up. Retry after the session transition completes.");
		if (backgroundStore?.directory === directory && backgroundActive) return;
		const store = new DurableJobStore<StoredBackgroundJob>(directory);
		const snapshot = store.load();
		backgroundStore = store;
		backgroundJobs = new BackgroundJobRegistry((state) => store.save(state.counter, state.jobs));
		if (snapshot) backgroundJobs.restore(snapshot);
		backgroundActive = true;
	}
	let isAgentBusy = false;
	let hasUserTurnPending = false;
	const parentRunId = randomUUID();
	let parentTurnSeq = 0;
	let deliveryTimer: ReturnType<typeof setTimeout> | undefined;
	let lastUiCtx: Pick<ExtensionContext, "hasUI" | "ui"> | undefined;
	let lastSessionCtx: ExtensionContext | undefined;
	let deliveryMessage: string | undefined;
	// Delivery handshake: pi.sendUserMessage is fire-and-forget (prompt() rejections
	// are swallowed into emitError), so jobs are only marked delivered after the
	// exact follow-up user message appears in the persisted session transcript.
	let deliveryInFlight: string[] | undefined;
	let deliveryAccepted = false;
	let deliveryInFlightTimer: ReturnType<typeof setTimeout> | undefined;
	const DELIVERY_CONFIRM_TIMEOUT_MS = 60_000;
	// Manual/auto compaction rejects prompts and does not fire agent_start.
	let compactionInProgress = false;
	// Custom agents are snapshotted once per session so the system prompt stays stable.
	let customAgentsSnapshot: CustomAgent[] | undefined;

	function recordSubagentUsage(result: SubagentDetails) {
		const u = result.usage;
		if (!u) return;
		subagentState.totalCostUsd += u.costUsd ?? 0;
		subagentState.totalInputTokens += u.inputTokens ?? 0;
		subagentState.totalOutputTokens += u.outputTokens ?? 0;
		subagentState.totalCacheTokens += u.cacheTokens ?? 0;
		subagentState.totalTokens +=
			u.totalTokens ??
			(u.inputTokens ?? 0) + (u.outputTokens ?? 0) + (u.cacheTokens ?? 0);
	}

	function safeRefreshWidget() {
		if (!lastUiCtx) {
			publishStateLabel();
			return;
		}
		try {
			refreshSubagentStatusWidget(lastUiCtx);
		} catch {
			// A captured ctx can go stale after session replacement; the state label is still updated.
			publishStateLabel();
		}
	}

	function clearDeliveryTimer() {
		if (deliveryTimer) clearTimeout(deliveryTimer);
		deliveryTimer = undefined;
	}

	function clearDeliveryInFlight() {
		if (deliveryInFlightTimer) clearTimeout(deliveryInFlightTimer);
		deliveryInFlightTimer = undefined;
		deliveryInFlight = undefined;
		deliveryAccepted = false;
		deliveryMessage = undefined;
	}

	/** Admission is insufficient; confirm only a recorded follow-up user entry. */
	function confirmDeliveryInFlight() {
		if (!deliveryInFlight || !deliveryMessage || !hasRecordedUserMessage(lastSessionCtx, deliveryMessage)) return;
		try { backgroundJobs.markDelivered(deliveryInFlight); }
		catch (error) { console.error("[subagents] delivery receipt persistence failed", error); return; }
		clearDeliveryInFlight();
	}

	function confirmRecordedWaitResults() {
		if (!backgroundJobs.undelivered().length) return;
		const ids = new Set<string>();
		for (const entry of lastSessionCtx?.sessionManager.getEntries() ?? []) {
			if (entry.type !== "message" || entry.message.role !== "toolResult") continue;
			const receipt = entry.message;
			const details: unknown = receipt.details;
			if (!isRecord(details)) continue;
			if (receipt.toolName === "subagent_wait" && Array.isArray(details.finished)) {
				for (const id of details.finished) {
					if (typeof id !== "string") continue;
					const job = backgroundJobs.get(id);
					if (job && job.status !== "running" && !job.delivered) ids.add(id);
				}
			} else if (["subagent", "subagent_followup"].includes(receipt.toolName) && details.mode === "joined" && typeof details.jobId === "string" && ["completed", "error"].includes(String(details.status))) {
				const job = backgroundJobs.get(details.jobId);
				if (job?.mode === "joined" && job.requestId === receipt.toolCallId && job.status !== "running" && !job.delivered) ids.add(job.id);
			}
		}
		if (ids.size) {
			try { backgroundJobs.markDelivered(ids); }
			catch (error) { console.error("[subagents] tool receipt persistence failed", error); }
		}
	}

	function flushBackgroundDeliveries() {
		clearDeliveryTimer();
		const now = Date.now();
		const selection = selectDeliverable(backgroundJobs.list(), now);
		if (selection.nextCheckAt !== undefined) {
			deliveryTimer = setTimeout(flushBackgroundDeliveries, Math.max(0, selection.nextCheckAt - now));
			(deliveryTimer as { unref?: () => void }).unref?.();
		}
		// Busy, compacting, or a delivery prompt not yet confirmed: keep everything
		// queued (never drop); agent_settled / compaction end / handshake timeout retry.
		if (!backgroundActive || isAgentBusy || hasUserTurnPending || compactionInProgress || deliveryInFlight) return;
		if (selection.ready.length === 0) return;
		// Not marked delivered yet: only a confirmed prompt counts as delivery.
		deliveryInFlight = selection.ready.map((job) => job.id);
		deliveryAccepted = false;
		deliveryInFlightTimer = setTimeout(() => {
			// Check the persisted transcript before retrying a slow/failed prompt.
			confirmDeliveryInFlight();
			clearDeliveryInFlight();
			flushBackgroundDeliveries();
		}, DELIVERY_CONFIRM_TIMEOUT_MS);
		(deliveryInFlightTimer as { unref?: () => void }).unref?.();
		deliveryMessage = formatDeliveryMessage(selection.ready, (text) => truncateForToolResult(text));
		pi.sendUserMessage(deliveryMessage, { deliverAs: "followUp" });
	}

	async function abortAllBackgroundJobs() {
		clearDeliveryTimer();
		clearDeliveryInFlight();
		for (const flush of backgroundCheckpoints.values()) {
			try { flush(); } catch (error) { console.error("[subagents] final checkpoint failed", error); }
		}
		backgroundCheckpoints.clear();
		backgroundActive = false;
		try { backgroundJobs.interruptRunning(); }
		finally { await Promise.allSettled([...childRuns.values()]); }
	}

	function backgroundDisplayName(params: SubagentParamsType): string {
		return params.type === "custom" ? (params.customAgent ?? "custom") : params.type;
	}

	function launchBackgroundSubagent(
		params: SubagentParamsType, ctx: ExtensionContext, mode: SubagentMode, requestId: string,
		signal?: AbortSignal, recovery?: BackgroundJob,
		followup?: { previous: BackgroundJob; reuse: Extract<ChildReuse, { kind: "transcript" }>; plan: ChildSessionPlan },
	) {
		initializeBackgroundStore(ctx);
		lastUiCtx = ctx;
		lastSessionCtx = ctx;
		const existing = backgroundJobs.list().find((job) => job.requestId === requestId);
		if (existing) {
			if (existing.task !== params.task || existing.type !== params.type || existing.mode !== mode || existing.resumedFrom !== recovery?.id || existing.followedFrom !== followup?.previous.id) throw new Error("Subagent request ID reused with different task or mode.");
			return returnAdmission(existing, signal, ctx.signal);
		}
		if (backgroundJobs.running().length >= MAX_BACKGROUND_SUBAGENTS) throw new Error(`Subagent capacity reached (${MAX_BACKGROUND_SUBAGENTS} running). Wait for a child to finish; mode was not changed.`);
		let reuse: ChildReuse = followup?.reuse ?? { kind: "unavailable", reason: "unresolved-model" };
		if (!followup) {
			const cwd = path.resolve(ctx.cwd, normalizePathArgument(params.cwd ?? "."));
			const config = resolveRunConfig(params, cwd);
			const selected = ctx.model ? selectSubagentModel(config.model, ctx.model, ctx.modelRegistry).model : undefined;
			if (selected) reuse = {
				kind: "transcript", config: { ...config, cwd, model: `${selected.provider}/${selected.id}`, thinkingLevel: pi.getThinkingLevel() },
				lineageId: randomUUID(), originalGoal: params.task, assignments: 1, generation: 1,
			};
		}
		const executionConfig = reuse.kind === "transcript" ? reuse.config : undefined;
		if (params.evidencePacket !== undefined) reuse = { kind: "unavailable", reason: "packet" };
		const job = backgroundJobs.launch({
			mode, requestId, reuse, type: params.type, name: executionConfig?.name ?? backgroundDisplayName(params), task: params.task,
			batchId: `turn-${parentRunId}-${parentTurnSeq}`, startedAt: Date.now(),
			resumeParams: { ...params, cwd: executionConfig?.cwd ?? path.resolve(ctx.cwd, normalizePathArgument(params.cwd ?? ".")), model: executionConfig?.model ?? params.model },
			resumedFrom: recovery?.id, followedFrom: followup?.previous.id,
			sessionFilePath: followup?.plan.kind === "reopen" ? followup.plan.transcript : undefined,
		});
		const runCtx = { cwd: ctx.cwd, model: ctx.model, modelRegistry: ctx.modelRegistry, signal: undefined };
		const runParams = { ...params, task: recovery ? buildRecoveryTask(recovery) : params.task, timeoutSeconds: params.timeoutSeconds ?? DEFAULT_BACKGROUND_TIMEOUT_SECONDS };
		const registry = backgroundJobs;
		const isCurrent = () => backgroundActive && registry === backgroundJobs && registry.get(job.id) === job && job.status === "running";
		const statusSink: SubagentStatusSink = (status) => {
			if (!isCurrent()) return;
			if (status) {
				activeSubagents.set(job.id, status);
				job.turns = status.turns;
				job.toolCount = status.toolCalls.length;
				job.preview = status.currentTool ? `running ${status.currentTool}` : oneLine(status.preview).slice(0, 160);
				if (status.checkpointOutput !== undefined) registry.checkpoint(job.id, {
					output: status.checkpointOutput, turns: job.turns, toolCount: job.toolCount, preview: job.preview,
					sessionFilePath: status.sessionFilePath, context: status.context,
					usage: { costUsd: status.cost, inputTokens: status.inputTokens, outputTokens: status.outputTokens, cacheTokens: status.cacheTokens, totalTokens: status.totalTokens },
				});
			} else activeSubagents.delete(job.id);
			safeRefreshWidget();
		};
		const checkpointControl: { flush?: () => void } = {};
		backgroundCheckpoints.set(job.id, () => checkpointControl.flush?.());
		const control = executionConfig ? {
			config: executionConfig, allowFallback: !followup, plan: followup?.plan ?? { kind: "fresh" as const, reset: "none" as const },
			resolvedModel(model: string) {
				if (!isCurrent()) return;
				executionConfig.model = model;
				registry.checkpoint(job.id, { reuse: job.reuse, resumeParams: { ...runParams, cwd: executionConfig.cwd, model } });
			},
		} : undefined;
		const run = runSubagent(pi, runCtx, job.id, runParams, undefined, statusSink, job.abort.signal, path.join(backgroundStore!.directory, job.id, "transcripts"), checkpointControl, control, sdk)
			.then((result) => {
				if (!isCurrent()) return;
				registry.complete(job.id, {
					status: result.status === "completed" ? "completed" : "error", output: result.output, error: result.error,
					turns: result.turns, toolCount: result.toolCalls.length, endedAt: Date.now(),
					report: result, usage: result.usage, context: result.context, sessionFilePath: result.transcript ?? job.sessionFilePath,
				});
				recordSubagentUsage(result);
			}, (error: unknown) => {
				if (!isCurrent()) return;
				registry.complete(job.id, { status: "error", output: "", error: error instanceof Error ? error.message : String(error), turns: job.turns, toolCount: job.toolCount, endedAt: Date.now() });
			})
			.finally(() => {
				childRuns.delete(job);
				if (registry !== backgroundJobs || !backgroundActive) return;
				backgroundCheckpoints.delete(job.id);
				activeSubagents.delete(job.id);
				safeRefreshWidget();
				flushBackgroundDeliveries();
			});
		childRuns.set(job, run);
		void run.catch((error) => console.error(`[subagents] failed to commit job ${job.id}`, error));
		return returnAdmission(job, signal, ctx.signal);
	}

	function jobResult(job: BackgroundJob, launching = false) {
		const type = job.type === "explore" || job.type === "shell" || job.type === "custom" ? job.type : "custom";
		const running = job.status === "running";
		const text = running && launching
			? `Detached subagent started: ${job.id} (${job.type}:${job.name})
Optional results will be delivered later. Continue independent work; do not poll.`
			: formatJobResult(job, truncateForToolResult);
		const details: SubagentDetails = {
			...(job.report ?? { type, name: job.name, task: job.task, cwd: "", tools: [], output: job.output ?? "", turns: job.turns, toolCalls: [] }),
			mode: job.mode, jobId: job.id, transcript: job.sessionFilePath, usage: job.usage, persistenceError: job.persistenceError,
			context: job.context, reuse: job.reuse, followedFrom: job.followedFrom, report: job.report,
			status: running ? "background" : job.status === "completed" ? "completed" : "error",
			error: job.error,
		};
		return { content: [{ type: "text" as const, text }], details };
	}

	function returnAdmission(job: BackgroundJob, ...sources: Array<AbortSignal | undefined>) {
		if (job.mode === "detached") return Promise.resolve(jobResult(job, true));
		const registry = backgroundJobs;
		const signals = [...new Set(sources.filter((source): source is AbortSignal => Boolean(source)))];
		let cancellationError: unknown;
		const cancel = () => {
			if (registry.get(job.id) !== job) return;
			try { registry.cancel(job.id); }
			catch (error) { cancellationError = error; job.abort.abort(); }
		};
		for (const source of signals) source.addEventListener("abort", cancel, { once: true });
		if (signals.some((source) => source.aborted)) cancel();
		return (childRuns.get(job) ?? Promise.resolve())
			.then(() => { if (cancellationError) throw cancellationError; return jobResult(job); })
			.finally(() => { for (const source of signals) source.removeEventListener("abort", cancel); });
	}

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
		await abortAllBackgroundJobs();
		initializeBackgroundStore(ctx);
		isAgentBusy = false;
		hasUserTurnPending = false;
		compactionInProgress = false;
		lastUiCtx = ctx;
		lastSessionCtx = ctx;
		try {
			customAgentsSnapshot = discoverCustomAgents(ctx.cwd);
		} catch {
			customAgentsSnapshot = undefined;
		}
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
		for (const job of backgroundJobs.list()) {
			if (job.usage) recordSubagentUsage({ usage: job.usage } as SubagentDetails);
		}
		refreshSubagentStatusWidget(ctx);
		confirmRecordedWaitResults();
		flushBackgroundDeliveries();
	});

	// Batch-coach: active only when subagent mode is enabled (MESO-001).
	// Detects three consecutive same-tool single-call turns that appear independent
	// and injects a steering message before the next LLM call.
	const batchCoachBuffer: BatchCoachTurnRecord[] = [];
	let batchCoachNudged = false;

	pi.on("turn_end", (event: TurnEndEvent) => {
		confirmRecordedWaitResults();
		confirmDeliveryInFlight();
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
			const isIndependentBatchableStretch =
				allSingleSameTool &&
				BATCH_COACH_TOOLS.has(last3[0].toolName ?? "") &&
				!batchCoachHasDependency(last3);
			if (!isIndependentBatchableStretch) {
				const currentRecord = last3[last3.length - 1];
				const currentRecordCanStartNewStretch =
					currentRecord.toolCallCount === 1 &&
					BATCH_COACH_TOOLS.has(currentRecord.toolName ?? "") &&
					!batchCoachInputDependsOnPriorOutput(last3.slice(0, -1), currentRecord);
				batchCoachNudged = false;
				batchCoachBuffer.length = 0;
				if (currentRecordCanStartNewStretch) batchCoachBuffer.push(currentRecord);
				return;
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

		// display: false keeps the nudge out of the TUI but it IS model-visible.
		// pi's convertToLlm() converts all CustomMessages to user messages
		// regardless of the display flag. display only gates TUI rendering.
		// Verified against @earendil-works/pi-coding-agent dist/core/messages.js
		// and docs/session-format.md ("CustomMessageEntry — Extension-injected
		// messages that DO participate in LLM context").
		//
		// Manual verification recipe:
		//   1. Run pi with /subagent on.
		//   2. Trigger 3+ consecutive single-call tool turns on a batchable tool
		//      (e.g. grep, read, ls) without dependencies between them.
		//   3. Confirm the model reacts to the nudge (e.g. starts batching
		//      subagent calls) on the next turn.
		//   4. Run pi with /subagent off, repeat the same pattern.
		//   5. Confirm no nudge fires (batch-coach returns early at the
		//      subagentModeEnabled guard).
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
		await abortAllBackgroundJobs();
		activeSubagents.clear();
		refreshSubagentStatusWidget(ctx);
	});

	// Parent lifecycle tracking for background delivery (mirrors background-jobs.ts).
	pi.on("agent_start", () => {
		isAgentBusy = true;
		// Our delivery prompt passed input, model and auth checks and is running.
		if (deliveryAccepted) confirmDeliveryInFlight();
	});

	pi.on("turn_start", () => {
		isAgentBusy = true;
		parentTurnSeq += 1;
	});

	pi.on("input", (event) => {
		const isOurDelivery = Boolean(deliveryInFlight) && event.source === "extension" && event.text.startsWith(DELIVERY_HEADER);
		if (!isOurDelivery) {
			hasUserTurnPending = true;
			return;
		}
		// Input/agent_start may precede persistence. The confirmation helper checks
		// the transcript; turn_end/settle or the retry timer checks again later.
		if (event.streamingBehavior) confirmDeliveryInFlight();
		else deliveryAccepted = true;
	});

	pi.on("agent_settled", () => {
		isAgentBusy = false;
		hasUserTurnPending = false;
		// Acknowledgement requires a recorded result/message, not just admission.
		confirmRecordedWaitResults();
		confirmDeliveryInFlight();
		clearDeliveryInFlight();
		flushBackgroundDeliveries();
	});

	pi.on("session_before_compact", () => {
		compactionInProgress = true;
	});

	const onCompactionEnd = () => {
		compactionInProgress = false;
		// pi clears its compaction guard right after these events resolve; flush on the next tick.
		const timer = setTimeout(flushBackgroundDeliveries, 0);
		(timer as { unref?: () => void }).unref?.();
	};
	pi.on("session_compact", onCompactionEnd);
	pi.on("session_compact_failed", onCompactionEnd);

	// 1h cache TTL while background subagents run, so the parent's prompt cache
	// survives the gap between launching jobs and receiving their results.
	pi.on("before_provider_request", (event, ctx) => {
		const model = ctx.model as { api?: string; compat?: { supportsLongCacheRetention?: boolean } } | undefined;
		const apply = shouldApplyLongCacheTtl({
			api: model?.api,
			supportsLongCacheRetention: model?.compat?.supportsLongCacheRetention,
			// Decided per request: 1h only while background jobs are running.
			windowActive: longTtlWanted({ running: backgroundJobs.running().length }),
			optOutEnv: process.env.PI_SUBAGENT_LONG_CACHE,
		});
		if (!apply) return undefined;
		return withLongCacheTtl(event.payload);
	});

	const subagentCapabilityGuidelines = [
		"CHOOSE BY DEPENDENCY: use mode=joined (default) for findings needed before your next edit, decision, or answer. The call returns the report after cleanup; no extra join is needed. Use mode=detached only for optional work whose result is not a prerequisite for the current answer.",
		"BATCH IN PARALLEL: split independent work into 2–5 narrow assignments. Use an available parallel tool wrapper or codemode Promise.all([tools.subagent(...), tools.subagent(...)]); otherwise emit a true multi-tool-call message. Do not await independent calls one by one. Never batch a dependent edit/command alongside the child finding it needs; read the prerequisite report first.",
		"FOLLOW UP instead of restarting related investigation: subagent_followup({ jobId, task }) reopens a successful normal child's saved conversation with the same model/tools/prompt. Use the latest returned job ID, not an ancestor. Only one assignment may own a transcript lineage at a time; do not batch follow-ups on the same lineage. There is no automatic continuation.",
		"SELF-CONTAINED TASKS: a fresh child does not inherit your parent conversation. Supply its goal, known facts/code anchors, constraints, and expected report. Optional evidencePacket gives claims to verify and bounded source guidance; supplied claims are not proof. Packet children cannot be followed up.",
		"ISOLATED CONTEXT, shared filesystem: children are not sandboxed worktrees. Assign one owner for coupled implementation files; parallelize read-only investigations or truly disjoint work. Do not perform the same owned task yourself while its child is running.",
		"CHILD TOOLS: explore has read/grep/find/ls; shell adds bash; custom uses its configured tool set. Children load no extensions: do not assume parent MCP, subagent, or Accordion tools are available. Choose a role that can actually perform the task.",
		"REPORTS AND CONTROLS: inspect returned findings, errors, verification evidence, and durability warnings before acting; runtime completion is not proof of correctness. subagent_wait retrieves missing/recovered or detached reports (all by default; any after one finishes); timeout/abort stops waiting, not children. subagent_cancel stops a child. subagent_status is for requested progress/recovery discovery, never polling or sleep loops.",
		"CONTEXT LIMITS: child-local native compaction uses a 50k-token target, not a hard per-request ceiling. After 3 assignments, 1 MiB transcript, or unsafe/unknown context, follow-up uses a clearly marked fresh handoff with goal/report/transcript pointers, not full memory. Respect reset reasons and unknown context values.",
		"RECOVERY: use subagent_resume only when the user requests recovery of interrupted work, after checking transcripts/checkpoints and possible side effects. Results/history persist, but in-process children cannot survive host exit. Never automatically replay uncertain work. A failed lineage requires a reviewed new-child handoff, not reuse of an older success.",
		"CAPACITY: 6 running slots shared by joined/detached; overflow fails explicitly, with no queue or silent mode switch. Finish existing work before admitting another batch. Request-ID deduplication is not semantic task deduplication.",
		"USE DELEGATION WHERE IT HELPS: several source lookups, substantial logs, independent subsystem reviews, or a related follow-up. Read one known file or make a small targeted edit directly. Keep assignments narrow; for broad exploration omit timeoutSeconds or use at least 600 seconds. The parent owns integration and final verification.",
	];

	function buildSubagentToolDef(enabled: boolean) {
		return {
			name: "subagent",
			label: "Subagent",
			executionMode: "parallel" as const,
			description: enabled
				? "Run an isolated in-process Pi subagent. JOINED by default: required reports return after cleanup. Detached mode is only for optional results delivered later. Use subagent_followup for related successful work with saved conversation/configuration. Batch independent calls with a real parallel tool batch; never batch dependent edits with prerequisite research. Isolated context, shared filesystem. Capacity 6 across both modes; overflow fails explicitly. Types: explore (read-only), shell (commands/logs), custom (configured markdown agent)."
				: "Run an isolated in-process Pi subagent. Joined by default; detached only for optional results. Capacity 6; excess admission fails.",
			promptSnippet: enabled
				? "Choose joined for prerequisites, detached only for optional results, and subagent_followup for related successful work. Batch independent assignments with a real parallel tool batch. Children have isolated conversations but share your filesystem; provide self-contained tasks and avoid overlapping ownership."
				: "",
			promptGuidelines: enabled ? subagentCapabilityGuidelines : [],
			parameters: SubagentParams,
			prepareArguments: normalizeTimeoutSeconds,
			execute: async (toolCallId, params, signal, _onUpdate, ctx) => {
				const mode = resolveSubagentMode(params.mode, params.background);
				return launchBackgroundSubagent(params, ctx, mode, toolCallId, signal);
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
				if (details.status === "background") {
					return new Text(
						`${theme.fg("warning", "⧗")} ${theme.fg("dim", `background ${details.jobId ?? "?"}`)} ${theme.fg("toolTitle", theme.bold(`${details.type}:${details.name}`))}`,
						0,
						0,
					);
				}
				const icon = details.status === "completed"
					? theme.fg("success", "✓")
					: details.status === "error" ? theme.fg("error", "✗") : theme.fg("warning", "…");
				let text = `${icon} ${theme.fg("toolTitle", theme.bold(`${details.type}:${details.name}`))}`;
				if (details.evidenceMode === "prose-fallback") text += theme.fg("warning", " • prose fallback");
				if (details.evidenceMode === "packet" && details.packetId && details.groupId) {
					text += theme.fg("dim", ` • packet ${details.packetId}/${details.groupId}`);
				}
				if (details.incomplete) text += theme.fg("warning", ` • incomplete${details.termination ? ` (${details.termination})` : ""}`);
				else if (details.termination) text += theme.fg("dim", ` • ${details.termination}`);
				text += theme.fg("dim", ` • ${details.turns} turn${details.turns === 1 ? "" : "s"}`);
				text += theme.fg("dim", ` • ${details.toolCalls.length} tool${details.toolCalls.length === 1 ? "" : "s"}`);
				if (details.error) text += `\n${theme.fg("error", details.error)}`;
				if (details.evidenceMode === "prose-fallback" && details.packetDiagnostics?.length) text += `\n${theme.fg("warning", details.packetDiagnostics[0])}`;
				if (expanded) {
					text += `\n\n${theme.fg("muted", "Task:")} ${details.task}`;
					if (details.evidenceMode === "packet") {
						const claimCount = details.verification?.claims.length ?? 0;
						const leadCount = details.verification?.newLeads.length ?? 0;
						text += `\n\n${theme.fg("muted", "Packet:")} ${details.packetId ?? "?"}/${details.groupId ?? "?"}`;
						if (details.effectiveLimits) {
							const limits = details.effectiveLimits;
							text += `\n${theme.fg("muted", "Effective limits:")} ${limits.maxTurns} turns, ${limits.maxToolCalls} tools, ${limits.timeoutSeconds}s`;
						}
						text += `\n${theme.fg("muted", "Outcome:")} ${details.incomplete ? "incomplete" : "complete"}${details.termination ? ` (${details.termination})` : ""} • ${claimCount} claims • ${leadCount} leads`;
					}
					if (details.usage) {
						const usage = details.usage;
						text += `\n\n${theme.fg("muted", "Usage:")} ${compactNumber(usage.inputTokens)} input, ${compactNumber(usage.outputTokens)} output, ${compactNumber(usage.cacheTokens)} cache, ${compactNumber(usage.totalTokens)} total, ${formatMoney(usage.costUsd)}`;
					}
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
		customAgentsSnapshot ??= discoverCustomAgents(ctx.cwd);
		const customAgents = prioritizeCustomAgentsForDisplay(customAgentsSnapshot)
			.slice(0, 20)
			.map((agent) => `- ${agent.name} (${agent.source}): ${agent.description || agent.filePath}`)
			.join("\n");
		return {
			systemPrompt: [
				event.systemPrompt,
				"=== Subagent workflow mode is enabled ===",
				"## Capability selection and safeguards",
				...subagentCapabilityGuidelines.map((line) => `- ${line}`),
				"## Concrete delegation patterns\n- Feature investigation: batch independent route, data-model, and UI explorers; integrate their reports before editing.\n- Related detail after success: follow up the latest child job instead of restating the investigation from scratch.\n- Optional review/log research: detach only if the current answer does not depend on it.\n- Coupled implementation: one owner; other children investigate or review, not duplicate its edits.",
				"## Available custom subagents",
				customAgents || "- none discovered",
			].join("\n\n"),
		};
	});

	// Initial registration. Defaults ON unless PI_SUBAGENT_MODE disables it, so
	// prompting metadata is included from startup.
	managed.registerTool({ ...buildSubagentToolDef(subagentModeEnabled), defaultVisibility: "agent-visible" as const });

	// Background job tools: registered once with fixed, mode-independent
	// descriptions. Re-registering would change the tool list and break the
	// prompt cache.
	const formatResult = (job: BackgroundJob) => formatJobResult(job, (text) => truncateForToolResult(text));

	managed.registerTool({
		name: "subagent_resume",
		label: "Recover Subagent",
		defaultVisibility: "agent-visible" as const,
		description: "Only when the user requests recovery: recover an interrupted subagent into a NEW background run using its saved task and checkpoint. Inspect possible side effects first. This is a checkpoint handoff, not exact execution replay; never automatically rerun interrupted shell actions.",
		parameters: Type.Object({ jobId: Type.String() }),
		async execute(_id: string, params: { jobId: string }, _signal: AbortSignal | undefined, _update: unknown, ctx: ExtensionContext) {
			initializeBackgroundStore(ctx);
			const job = backgroundJobs.get(params.jobId);
			if (!job || job.status !== "interrupted") throw new Error("Only interrupted background subagents can be recovered.");
			const saved = job.resumeParams as SubagentParamsType | undefined;
			if (!saved || !["explore", "shell", "custom"].includes(saved.type) || typeof saved.task !== "string") throw new Error("Saved launch configuration is unavailable.");
			const child = backgroundJobs.list().find((other) => other.resumedFrom === job.id);
			if (child && child.requestId !== _id) throw new Error("This job already has a recovery run; inspect that run instead of duplicating work.");
			if (!child && backgroundJobs.running().length >= MAX_BACKGROUND_SUBAGENTS) throw new Error("Background subagent cap reached.");
			return launchBackgroundSubagent({ ...saved, mode: "detached", background: true }, ctx, "detached", _id, undefined, job);
		},
	});

	managed.registerTool({
		name: "subagent_followup",
		label: "Follow up Subagent",
		executionMode: "parallel" as const,
		defaultVisibility: "agent-visible" as const,
		description: "Explicit related follow-up for a successful normal child. Reuses its saved model/tools/prompt and disk transcript exclusively, never interrupted work. Joined by default; bounded fresh handoff after 3 assignments, 1 MiB, or unsafe context. No implicit reuse.",
		parameters: SubagentFollowupParams,
		async execute(id: string, params: SubagentFollowupParamsType, signal: AbortSignal | undefined, _update: unknown, ctx: ExtensionContext) {
			initializeBackgroundStore(ctx);
			const mode = resolveSubagentMode(params.mode, params.background);
			const duplicate = backgroundJobs.list().find((job) => job.requestId === id);
			if (duplicate) {
				if (duplicate.followedFrom !== params.jobId || duplicate.task !== params.task || duplicate.mode !== mode) throw new Error("Subagent request ID reused with different follow-up.");
				return returnAdmission(duplicate, signal, ctx.signal);
			}
			const previous = backgroundJobs.get(params.jobId);
			if (!previous) throw new Error(`Unknown subagent job ${params.jobId}.`);
			if (previous.status !== "completed" || typeof previous.sessionFilePath !== "string" || !previous.sessionFilePath || !isReusableChild(previous.reuse)) throw new Error("Only successful normal children with a saved transcript and resolved configuration support follow-up. Failed, cancelled, interrupted, packet, and legacy jobs cannot be reused.");
			const reuse = previous.reuse;
			if (backgroundJobs.running().some((job) => isReusableChild(job.reuse) && job.reuse.lineageId === reuse.lineageId || sameTranscript(job.sessionFilePath, previous.sessionFilePath)) || [...childRuns.keys()].some((job) => job === previous || sameTranscript(job.sessionFilePath, previous.sessionFilePath) || (isReusableChild(job.reuse) && job.reuse.lineageId === reuse.lineageId))) throw new Error("This transcript lineage is already in use. Wait for that child to finish cleanup before following up, including via ancestor job IDs.");
			// Ancestor IDs are not immutable transcript snapshots; the latest assignment must succeed.
			const latest = backgroundJobs.list().filter((job) => isReusableChild(job.reuse) && job.reuse.lineageId === reuse.lineageId).at(-1);
			if (latest !== previous) {
				if (latest && latest.status !== "completed") throw new Error(`The latest lineage job ${latest.id} is ${latest.status}. Start a new child with a reviewed handoff; older transcripts may have changed. Interrupted work can only be explicitly resumed after inspecting possible side effects.`);
				throw new Error(`Use the latest lineage job ${latest?.id ?? "unknown"}, not an ancestor with stale report/accounting.`);
			}
			const model = sameModelId(reuse.config.model, ctx.model) ? ctx.model : findSavedModel(reuse.config.model, ctx.modelRegistry);
			if (!model || !ctx.modelRegistry.hasConfiguredAuth(model)) throw new Error(`Saved child model ${reuse.config.model} is unavailable. Follow-up never silently switches models.`);
			childContextPolicy(model.contextWindow);
			let bytes: number;
			try { bytes = fs.statSync(previous.sessionFilePath).size; }
			catch { throw new Error("Saved transcript is unavailable; start an explicit new child with a reviewed handoff."); }
			const reset = followupReset(reuse, bytes, previous.context);
			const plan: ChildSessionPlan = reset === "none"
				? { kind: "reopen", transcript: previous.sessionFilePath, reset }
				: { kind: "handoff", reset, handoff: buildFollowupHandoff(reuse.originalGoal, previous.output ?? "", previous.sessionFilePath) };
			const nextReuse: Extract<ChildReuse, { kind: "transcript" }> = { ...reuse, config: { ...reuse.config, tools: [...reuse.config.tools] }, assignments: reset === "none" ? reuse.assignments + 1 : 1, generation: reuse.generation + (reset === "none" ? 0 : 1) };
			return launchBackgroundSubagent({ type: reuse.config.type, customAgent: reuse.config.type === "custom" ? reuse.config.name : undefined, task: params.task, cwd: reuse.config.cwd, model: reuse.config.model, timeoutSeconds: params.timeoutSeconds }, ctx, mode, id, signal, undefined, { previous, reuse: nextReuse, plan });
		},
	});

	managed.registerTool({
		name: "subagent_wait",
		label: "Wait for Subagents",
		description: "Retrieve joined or detached child reports. waitFor=all (default) waits for every target; any returns after at least one terminal outcome. No IDs includes running and undelivered finished jobs. Timeout defaults to 120s, max 240s; timeout/abort stops waiting, never children. Detached results also deliver later; joined results do not.",
		parameters: SubagentWaitParams,
		defaultVisibility: "agent-visible" as const,
		async execute(_toolCallId: string, params: SubagentWaitParamsType, signal: AbortSignal | undefined) {
			if (params.waitFor !== undefined && params.waitFor !== "all" && params.waitFor !== "any") throw new Error("waitFor must be all or any.");
			const registry = backgroundJobs;
			const timeoutSeconds = clampWaitSeconds(params.timeoutSeconds);
			const targets = resolveWaitTargets(registry, params.jobIds);
			if (targets.length === 0) {
				return {
					content: [{ type: "text" as const, text: params.jobIds?.length ? `Unknown job ids: ${params.jobIds.join(", ")}` : "No subagent jobs to wait for." }],
					details: { finished: [], stillRunning: [], unknownIds: params.jobIds ?? [] },
				};
			}
			await new Promise<void>((resolve) => {
				const done = () => params.waitFor === "any" ? targets.some((job) => job.status !== "running") : targets.every((job) => job.status !== "running");
				if (done() || signal?.aborted) return resolve();
				let unsubscribe: () => void = () => {};
				const finish = () => {
					clearTimeout(timer);
					unsubscribe();
					signal?.removeEventListener("abort", finish);
					resolve();
				};
				const timer = setTimeout(finish, timeoutSeconds * 1000);
				unsubscribe = registry.onChange(() => {
					if (done()) finish();
				});
				signal?.addEventListener("abort", finish, { once: true });
			});
			const selection = selectWaitResults(registry, targets, params.jobIds);
			// Do not acknowledge before the tool result is recorded: a crash between
			// returning and persistence must leave these outcomes recoverable.
			// turn_end/settle/start confirmRecordedWaitResults() commits the receipt.
			const parts: string[] = [];
			if (selection.finished.length > 0) parts.push(formatDeliveryMessage(selection.finished, (text) => truncateForToolResult(text)));
			if (selection.alreadyDelivered.length > 0) {
				parts.push(`Already acknowledged (explicit retrieval):
${selection.alreadyDelivered.map(formatResult).join("\n\n")}`);
			}
			if (selection.cleared.length > 0) {
				parts.push(`Cancelled by session reset (no results will be delivered): ${selection.cleared.map((job) => job.id).join(", ")}`);
			}
			if (selection.unknownIds.length > 0) parts.push(`Unknown job ids: ${selection.unknownIds.join(", ")}`);
			if (selection.stillRunning.length > 0) {
				parts.push(
					`Still running: ${selection.stillRunning.map((job) => `${job.id} (${job.mode})`).join(", ")}${signal?.aborted ? " (wait aborted)" : ""}. Children continue: joined launch receipts remain pending; detached results deliver later.`,
				);
			}
			if (parts.length === 0) parts.push("No results.");
			return {
				content: [{ type: "text" as const, text: parts.join("\n\n") }],
				details: {
					finished: selection.finished.map((job) => job.id),
					stillRunning: selection.stillRunning.map((job) => job.id),
					waitFor: params.waitFor ?? "all",
					jobs: [...selection.finished, ...selection.alreadyDelivered].map((job) => jobResult(job).details),
				},
			};
		},
	});

	managed.registerTool({
		name: "subagent_status",
		label: "Subagent Status",
		description: "Snapshot of durable joined/detached children, context usage (unknown when unavailable), transcripts and reuse metadata. Do not poll; call only for requested progress or explicit recovery discovery. Joined outcomes are retrieved by their launch receipt or subagent_wait, never automatically redelivered.",
		parameters: SubagentStatusParams,
		defaultVisibility: "agent-visible" as const,
		async execute(_toolCallId: string, params: SubagentStatusParamsType) {
			const now = Date.now();
			const jobs = params.jobId ? [backgroundJobs.get(params.jobId)].filter((job): job is BackgroundJob => Boolean(job)) : backgroundJobs.list();
			if (jobs.length === 0) {
				return {
					content: [{ type: "text" as const, text: params.jobId ? `Subagent job '${params.jobId}' not found.` : "No subagent jobs." }],
					details: {},
				};
			}
			const rows = jobs.map((job) => {
				const live = activeSubagents.get(job.id);
				const turns = live?.turns ?? job.turns;
				const tools = live?.toolCalls.length ?? job.toolCount;
				const preview = job.status === "running" ? job.preview : oneLine(job.output ?? job.error ?? "").slice(0, 120);
				const delivered = job.status !== "running" ? (job.delivered ? ", acknowledged" : job.mode === "joined" ? ", pending receipt/retrieval" : ", pending delivery") : "";
				const context = live?.context ?? job.context;
				const persistence = job.persistenceError ? ", snapshot unconfirmed; retrieve with subagent_wait" : "";
				return `- ${job.id} ${job.type}:${job.name} (${job.mode}) ctx ${context?.tokens ?? "unknown"}/${context?.window ?? "unknown"} [${job.status}${delivered}${persistence}] ${durationSeconds(job, now)}s, ${turns} turns, ${tools} tools${preview ? ` — ${preview}` : ""}`;
			});
			return {
				content: [{ type: "text" as const, text: `Subagent jobs (${jobs.length}):\n${rows.join("\n")}\n\nDo not poll. Joined results return through their launching tool or explicit wait; only detached results deliver automatically.` }],
				details: { total: jobs.length, jobs: jobs.map((job) => jobResult(job).details) },
			};
		},
	});

	managed.registerTool({
		name: "subagent_cancel",
		label: "Cancel Subagent",
		description: "Cancel a running child. Joined cancellation awaits cleanup and returns its terminal report; detached cancellation requests delivery of the partial outcome later.",
		parameters: SubagentCancelParams,
		defaultVisibility: "agent-visible" as const,
		async execute(_toolCallId: string, params: SubagentCancelParamsType) {
			const job = backgroundJobs.get(params.jobId);
			if (!job) return { content: [{ type: "text" as const, text: `Background subagent job '${params.jobId}' not found.` }], details: {} };
			if (!backgroundJobs.cancel(params.jobId)) {
				return { content: [{ type: "text" as const, text: `Background subagent job '${job.id}' is not running (status: ${job.status}).` }], details: {} };
			}
			if (job.mode === "joined") {
				await childRuns.get(job);
				return jobResult(job);
			}
			return {
				content: [{ type: "text" as const, text: `Cancelling background subagent job '${job.id}' (${job.type}:${job.name}). It will be delivered as cancelled, unless it had already finished.` }],
				details: { jobId: job.id },
			};
		},
	});

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

			await ctx.modelRegistry.refresh();
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
