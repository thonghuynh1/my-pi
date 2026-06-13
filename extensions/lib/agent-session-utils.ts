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



export interface RoleSession {
	session: Awaited<ReturnType<typeof createAgentSessionFromServices>>["session"];
	model: ActiveModel;
	modelId: string;
	tools: string[];
	usage: RoleUsage;
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

	const roleSession: RoleSession = {
		session: created.session,
		model,
		modelId,
		tools,
		usage: zeroUsage(modelId),
	};

	// Subscribe to accumulate usage across prompts.
	created.session.subscribe((event) => {
		if (event.type === "message_end") {
			const message = event.message as Message;
			roleSession.usage = accumulateUsage(roleSession.usage, message);
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
