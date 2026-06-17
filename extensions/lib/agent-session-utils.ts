/**
 * Reusable child-session runtime helpers for Driver and Navigator roles.
 *
 * Provides:
 * - Role-specific tool allowlists (driver, navigator)
 * - Model resolution with fail-fast for explicit role overrides
 * - Persistent child session creation (in-memory sessions, multiple prompts)
 * - Final assistant text extraction from session messages
 * - Per-role usage accumulation without touching __subagent
 * - Abort/dispose handling for parent abort or cleanup
 */

import {
	createAgentSessionFromServices,
	createAgentSessionServices,
	SessionManager,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Message } from "@earendil-works/pi-ai";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActiveModel = NonNullable<ExtensionContext["model"]>;

// ---------------------------------------------------------------------------
// Telemetry types (DEC-014, DEC-015, DEC-016, DEC-017)
// ---------------------------------------------------------------------------

export type TelemetryKind =
	| "skill_load"
	| "file_read"
	| "search"
	| "command"
	| "file_write"
	| "artifact_inspection";

/**
 * Normative telemetry summary shape. Stored in Pair Run State and used
 * for coordinator proof maps. Raw command strings are never stored here;
 * only sanitized previews are kept (DEC-015).
 */
export interface PairTelemetrySummary {
	/** Coordinator-stable hybrid ID, e.g. "driver-c1-t3", "nav-r2-t1", "nav-final-t2" */
	id: string;
	/** Raw Pi toolCallId — kept internally for correlation only */
	rawToolCallId: string;
	role: "driver" | "navigator";
	phase: string;
	cycle?: number;
	toolName: string;
	kind: TelemetryKind;
	/** File path or search pattern for non-command tools */
	targetPreview?: string;
	/** Redacted command preview for bash tool calls */
	commandPreview?: string;
	/** True when the raw command string was redacted (bash calls) */
	redacted: boolean;
	/** False for failed calls — retained as attempt evidence only */
	success: boolean;
	exitCode?: number;
	timestamp: string;
}

/** Internal state for in-flight tool call correlation. */
interface PendingTelemetryEntry {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	timestamp: string;
}

/** Per-session mutable telemetry state, owned by createRoleSession. */
export interface RoleTelemetryState {
	/** Current coordinator context for incoming tool calls */
	context: { phase: string; cycle?: number };
	/** In-flight tool calls awaiting their end event */
	pending: Map<string, PendingTelemetryEntry>;
	/** 1-based index within the current phase; resets on context change */
	phaseIndex: number;
}

export interface RoleSession {
	session: Awaited<ReturnType<typeof createAgentSessionFromServices>>["session"];
	model: ActiveModel;
	modelId: string;
	tools: string[];
	usage: RoleUsage;
	/** Accumulated telemetry summaries across all phases */
	telemetry: PairTelemetrySummary[];
	/** Internal mutable telemetry correlation state */
	_telemetry: RoleTelemetryState;
}

export interface RoleUsage {
	inputTokens: number;
	outputTokens: number;
	cacheTokens: number;
	totalTokens: number;
	costUsd: number;
	modelId: string;
}

export interface PairUsageSummary {
	driverUsage: RoleUsage;
	navigatorUsage: RoleUsage;
	totalUsage: {
		totalTokens: number;
		costUsd: number;
	};
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

// ---------------------------------------------------------------------------
// Telemetry constants (DEC-015)
// ---------------------------------------------------------------------------

export const COMMAND_PREVIEW_MAX_LENGTH = 60;

// ---------------------------------------------------------------------------
// Tool allowlists (decision artifact: MESO-003, MICRO-001)
// ---------------------------------------------------------------------------

export const DRIVER_TOOLS: readonly string[] = ["read", "grep", "find", "ls", "bash", "edit", "write"];
export const NAVIGATOR_TOOLS: readonly string[] = ["read", "grep", "find", "ls", "bash"];

export function getRoleTools(role: "driver"): string[];
export function getRoleTools(role: "navigator"): string[];
export function getRoleTools(role: "driver" | "navigator"): string[] {
	if (role === "driver") {
		return [...DRIVER_TOOLS];
	}
	return [...NAVIGATOR_TOOLS];
}

// ---------------------------------------------------------------------------
// Telemetry pure logic (DEC-014, DEC-015, DEC-016, DEC-017)
// ---------------------------------------------------------------------------

/**
 * Generate a stable coordinator telemetry ID.
 *
 * Format: `{rolePrefix}-{phaseCode}-t{index}`
 *
 * Role prefix: driver → "driver", navigator → "nav"
 * Phase codes:
 *   "cycle"     + cycle n → "c{n}"
 *   "review"    + cycle n → "r{n}"
 *   "final"               → "final"
 *   "preflight"           → "preflight"
 *   other                 → sanitized lowercase phase string
 *
 * Index: 1-based sequential number within the phase (resets on context change).
 */
export function generateTelemetryId(
	role: "driver" | "navigator",
	phase: string,
	cycle: number | undefined,
	index: number,
): string {
	const rolePrefix = role === "driver" ? "driver" : "nav";

	let phaseCode: string;
	switch (phase) {
		case "cycle":
			phaseCode = `c${cycle ?? 1}`;
			break;
		case "review":
			phaseCode = `r${cycle ?? 1}`;
			break;
		case "final":
			phaseCode = "final";
			break;
		case "preflight":
			phaseCode = "preflight";
			break;
		default:
			phaseCode = phase.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
			break;
	}

	return `${rolePrefix}-${phaseCode}-t${index}`;
}

/**
 * Map a Pi tool name to a normalized telemetry kind (DEC-014).
 *
 * read               → file_read
 * grep, find, ls     → search
 * bash               → command
 * edit, write        → file_write
 * anything else      → artifact_inspection
 */
export function normalizeTelemetryKind(toolName: string): TelemetryKind {
	switch (toolName) {
		case "read":
			return "file_read";
		case "grep":
		case "find":
		case "ls":
			return "search";
		case "bash":
			return "command";
		case "edit":
		case "write":
			return "file_write";
		default:
			return "artifact_inspection";
	}
}

/**
 * Produce a redacted command preview (DEC-015).
 *
 * Keeps at most COMMAND_PREVIEW_MAX_LENGTH chars, appending "…" if truncated.
 * Raw command strings must never be stored in Pair Run State.
 */
export function redactCommandPreview(command: string): string {
	if (typeof command !== "string") return "[redacted]";
	if (command.length <= COMMAND_PREVIEW_MAX_LENGTH) return command;
	return command.slice(0, COMMAND_PREVIEW_MAX_LENGTH) + "\u2026";
}

function extractTargetPreview(
	toolName: string,
	args: Record<string, unknown>,
): string | undefined {
	if (toolName === "bash") return undefined;
	const pathArg =
		typeof args["path"] === "string" ? args["path"] :
		typeof args["pattern"] === "string" ? args["pattern"] :
		undefined;
	return pathArg;
}

interface TelemetryStartRaw {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	timestamp: string;
}

interface TelemetryEndRaw {
	toolCallId: string;
	args: Record<string, unknown>;
	exitCode?: number;
	error?: unknown;
}

/**
 * Build a PairTelemetrySummary from correlated start and end events.
 * Called after a pending entry is matched by toolCallId.
 */
export function buildTelemetrySummary(
	role: "driver" | "navigator",
	context: { phase: string; cycle?: number },
	index: number,
	start: TelemetryStartRaw,
	end: TelemetryEndRaw,
): PairTelemetrySummary {
	const kind = normalizeTelemetryKind(start.toolName);
	const isBash = start.toolName === "bash";
	const rawCommand = typeof start.args["command"] === "string" ? start.args["command"] : undefined;

	const redacted = isBash && rawCommand !== undefined;
	const commandPreview = isBash && rawCommand !== undefined
		? redactCommandPreview(rawCommand)
		: undefined;
	const targetPreview = extractTargetPreview(start.toolName, start.args);
	const hasError = end.error !== undefined && end.error !== null;

	return {
		id: generateTelemetryId(role, context.phase, context.cycle, index),
		rawToolCallId: start.toolCallId,
		role,
		phase: context.phase,
		cycle: context.cycle,
		toolName: start.toolName,
		kind,
		targetPreview,
		commandPreview,
		redacted,
		success: !hasError,
		exitCode: typeof end.exitCode === "number" ? end.exitCode : undefined,
		timestamp: start.timestamp,
	};
}

/**
 * Returns true if a telemetry entry can serve as write proof.
 *
 * Navigator is non-writing by design; any file_write entry from navigator
 * cannot satisfy a review proof (DEC-003). Failed entries are attempt
 * evidence only and also cannot satisfy proof.
 */
export function canSatisfyWriteProof(entry: PairTelemetrySummary): boolean {
	if (entry.role === "navigator" && entry.kind === "file_write") return false;
	if (!entry.success) return false;
	return entry.kind === "file_write";
}

/**
 * Set the active telemetry context for a role session.
 *
 * Called by the protocol runner before each role prompt to associate
 * subsequent tool calls with the correct phase and cycle.
 * Resets the per-phase tool index counter.
 */
export function setActiveTelemetryContext(
	roleSession: RoleSession,
	phase: string,
	cycle?: number,
): void {
	roleSession._telemetry.context = { phase, cycle };
	roleSession._telemetry.phaseIndex = 0;
}

// ---------------------------------------------------------------------------
// Model resolution (MESO-001, MESO-002: fail-fast for explicit overrides)
// ---------------------------------------------------------------------------

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

/**
 * Resolve a model for a role session.
 *
 * - If `requestedModel` is provided and available → use it.
 * - If `requestedModel` is provided but unavailable/unauthenticated → throw.
 * - If no `requestedModel` → use inheritedModel.
 */
export function resolveRoleModel(
	requestedModel: string | undefined,
	inheritedModel: ExtensionContext["model"],
	modelRegistry: ExtensionContext["modelRegistry"],
): ActiveModel {
	const trimmed = requestedModel?.trim();
	if (!trimmed) {
		if (!inheritedModel) {
			throw new Error("No active model is available for this role.");
		}
		return inheritedModel;
	}

	const currentProviderOverrideModel = inheritedModel?.provider
		? modelRegistry.find(inheritedModel.provider, trimmed)
		: undefined;
	const { provider, modelId } = parseModelOverride(trimmed, inheritedModel?.provider);
	const overrideModel = currentProviderOverrideModel ?? (provider && modelId ? modelRegistry.find(provider, modelId) : undefined);
	const overrideModelIsReady = Boolean(overrideModel && modelRegistry.hasConfiguredAuth(overrideModel));

	if (overrideModel && overrideModelIsReady) {
		return overrideModel;
	}

	// Fail-fast: do not silently fall back when an explicit override was requested.
	throw new Error(
		`Model override "${trimmed}" is not available or not authenticated. ` +
		"Pair-programming requires the specified role model to be usable. " +
		"Remove the override or configure the model before starting.",
	);
}

// ---------------------------------------------------------------------------
// Text extraction
// ---------------------------------------------------------------------------

export function extractText(message: unknown): string {
	const msg = message as { role?: string; content?: unknown };
	if (msg.role !== "assistant" || !Array.isArray(msg.content)) return "";
	let text = "";
	for (const part of msg.content as Array<{ type?: string; text?: string }>) {
		if (part.type === "text" && typeof part.text === "string") text += part.text;
	}
	return text;
}

export function finalAssistantText(messages: unknown[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const text = extractText(messages[i]);
		if (text.trim()) return text.trim();
	}
	return "";
}

// ---------------------------------------------------------------------------
// Usage accumulation (MESO-014: separate from __subagent)
// ---------------------------------------------------------------------------

function zeroUsage(modelId: string): RoleUsage {
	return {
		inputTokens: 0,
		outputTokens: 0,
		cacheTokens: 0,
		totalTokens: 0,
		costUsd: 0,
		modelId,
	};
}

export function accumulateUsage(current: RoleUsage, message: Message): RoleUsage {
	if (message.role !== "assistant") return current;
	const usage = (message as { usage?: AssistantUsage }).usage;
	if (!usage) return current;

	const input = usage.input ?? 0;
	const output = usage.output ?? 0;
	const cache = (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
	return {
		inputTokens: current.inputTokens + input,
		outputTokens: current.outputTokens + output,
		cacheTokens: current.cacheTokens + cache,
		totalTokens: current.totalTokens + (usage.totalTokens ?? input + output + cache),
		costUsd: current.costUsd + totalCostOf(usage),
		modelId: current.modelId,
	};
}

export function getUsageSummary(role: "driver" | "navigator", usage: RoleUsage): RoleUsage {
	return { ...usage };
}

// ---------------------------------------------------------------------------
// Pair usage summary
// ---------------------------------------------------------------------------

export function buildPairUsageSummary(driverUsage: RoleUsage, navigatorUsage: RoleUsage): PairUsageSummary {
	return {
		driverUsage: { ...driverUsage },
		navigatorUsage: { ...navigatorUsage },
		totalUsage: {
			totalTokens: driverUsage.totalTokens + navigatorUsage.totalTokens,
			costUsd: driverUsage.costUsd + navigatorUsage.costUsd,
		},
	};
}

// ---------------------------------------------------------------------------
// Child session creation (MACRO-001, MESO-003: persistent in-memory sessions)
// ---------------------------------------------------------------------------

/**
 * Create a persistent child session for a role.
 *
 * The returned session stays alive across multiple `prompt()` calls,
 * allowing the pair-program tool to send repeated prompts without
 * recreating the session each time.
 *
 * Usage is accumulated on the returned `RoleSession.usage` via the
 * session's event subscription (message_end events).
 *
 * On parent abort, the child session is aborted and disposed.
 */
export async function createRoleSession(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	role: "driver" | "navigator",
	modelOverride?: string,
	extraSystemPrompt?: string[],
): Promise<RoleSession> {
	const cwd = ctx.cwd;
	const model = resolveRoleModel(modelOverride, ctx.model, ctx.modelRegistry);
	const modelId = `${model.provider}/${model.id}`;
	const tools = role === "driver"
		? getRoleTools("driver")
		: getRoleTools("navigator");

	const services = await createAgentSessionServices({
		cwd,
		modelRegistry: ctx.modelRegistry,
		resourceLoaderOptions: {
			noExtensions: true,
			appendSystemPrompt: extraSystemPrompt ?? [],
		},
	});

	const created = await createAgentSessionFromServices({
		services,
		sessionManager: SessionManager.inMemory(cwd),
		model,
		tools,
		thinkingLevel: pi.getThinkingLevel(),
	});

	const telemetryState: RoleTelemetryState = {
		context: { phase: "preflight" },
		pending: new Map<string, PendingTelemetryEntry>(),
		phaseIndex: 0,
	};

	const roleSession: RoleSession = {
		session: created.session,
		model,
		modelId,
		tools,
		usage: zeroUsage(modelId),
		telemetry: [],
		_telemetry: telemetryState,
	};

	// Subscribe to accumulate usage and capture tool telemetry across prompts.
	created.session.subscribe((event) => {
		if (event.type === "message_end") {
			const message = event.message as Message;
			roleSession.usage = accumulateUsage(roleSession.usage, message);
		} else if (event.type === "tool_execution_start") {
			// Correlate by toolCallId: record the pending entry.
			const ev = event as unknown as {
				toolCallId: string;
				toolName: string;
				args: Record<string, unknown>;
			};
			if (ev.toolCallId && ev.toolName) {
				roleSession._telemetry.pending.set(ev.toolCallId, {
					toolCallId: ev.toolCallId,
					toolName: ev.toolName,
					args: ev.args ?? {},
					timestamp: new Date().toISOString(),
				});
			}
		} else if (event.type === "tool_execution_end") {
			// Correlate by toolCallId: complete the pending entry.
			const ev = event as unknown as {
				toolCallId: string;
				toolName: string;
				args: Record<string, unknown>;
				exitCode?: number;
				error?: unknown;
			};
			const pending = ev.toolCallId
				? roleSession._telemetry.pending.get(ev.toolCallId)
				: undefined;
			if (pending) {
				roleSession._telemetry.pending.delete(ev.toolCallId);
				roleSession._telemetry.phaseIndex += 1;
				const summary = buildTelemetrySummary(
					role,
					roleSession._telemetry.context,
					roleSession._telemetry.phaseIndex,
					pending,
					{
						toolCallId: ev.toolCallId,
						args: ev.args ?? {},
						exitCode: ev.exitCode,
						error: ev.error,
					},
				);
				roleSession.telemetry.push(summary);
			}
		}
	});

	// Abort and dispose child on parent abort.
	const abortChild = () => {
		void created.session.abort();
		void created.session.dispose();
	};
	ctx.signal?.addEventListener("abort", abortChild, { once: true });

	return roleSession;
}

// ---------------------------------------------------------------------------
// Prompt and finalize
// ---------------------------------------------------------------------------

/**
 * Send a prompt to a persistent role session and wait for completion.
 *
 * Returns the final assistant text from the session's messages.
 */
export async function promptRoleSession(
	roleSession: RoleSession,
	prompt: string,
): Promise<string> {
	const finalMessages: unknown[] = [];

	const unsub = roleSession.session.subscribe((event) => {
		if (event.type === "agent_end") {
			finalMessages.push(...(event.messages as unknown[]));
		}
	});

	try {
		await roleSession.session.prompt(prompt);
	} finally {
		unsub();
	}

	const text = finalAssistantText(finalMessages);
	return text || "(no output)";
}

/**
 * Dispose a role session and return its final usage.
 */
export function disposeRoleSession(roleSession: RoleSession): RoleUsage {
	const usage = { ...roleSession.usage };
	void roleSession.session.dispose();
	return usage;
}

/**
 * Abort and dispose a role session, returning its usage at time of abort.
 */
export function abortRoleSession(roleSession: RoleSession): RoleUsage {
	const usage = { ...roleSession.usage };
	void roleSession.session.abort();
	void roleSession.session.dispose();
	return usage;
}
