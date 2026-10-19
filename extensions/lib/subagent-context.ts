import type { ExtensionAPI, CompactionSettings } from "@earendil-works/pi-coding-agent";
import type { EffectiveRoutingConfig } from "./routing-policy.ts";

export const CHILD_CONTEXT_BUDGET = 150_000;
export const CHILD_MAX_ASSIGNMENTS = 3;
export const CHILD_MAX_TRANSCRIPT_BYTES = 1024 * 1024;
export const CHILD_HANDOFF_REPORT_CHARS = 8_000;

export interface ChildConfig {
	type: "explore" | "shell" | "custom";
	name: string;
	description: string;
	cwd: string;
	model: string;
	prompt: string;
	tools: string[];
	thinkingLevel: ReturnType<ExtensionAPI["getThinkingLevel"]>;
	routing: EffectiveRoutingConfig;
	source?: "user" | "project";
	filePath?: string;
}

export type ChildReuse =
	| { kind: "unavailable"; reason: "packet" | "unresolved-model" }
	| { kind: "transcript"; config: ChildConfig; lineageId: string; originalGoal: string; assignments: number; generation: number };

export type ContextReset = "none" | "assignment-limit" | "transcript-limit" | "unsafe-context";
export interface ChildContext {
	tokens: number | null;
	window: number | null;
	budget: number;
	reset: ContextReset;
	compactionError?: string;
}

export type ChildSessionPlan =
	| { kind: "fresh"; reset: "none" }
	| { kind: "handoff"; reset: Exclude<ContextReset, "none">; handoff: string }
	| { kind: "reopen"; transcript: string; reset: "none" };

/** Native SDK threshold is window - reserve; settings are child-local only. */
export function childContextPolicy(window: number): { budget: number; compaction: CompactionSettings } {
	if (!Number.isSafeInteger(window) || window < 2048) throw new Error("Child model context window is unknown or too small (minimum 2048 tokens).");
	const responseReserve = Math.min(8192, Math.max(512, Math.floor(window / 4)));
	const budget = Math.min(CHILD_CONTEXT_BUDGET, window - responseReserve);
	return {
		budget,
		compaction: { enabled: true, reserveTokens: window - budget, keepRecentTokens: Math.min(12_000, Math.floor(budget / 4)) },
	};
}

export function followupReset(reuse: Extract<ChildReuse, { kind: "transcript" }>, bytes: number, context?: ChildContext): ContextReset {
	if (reuse.assignments >= CHILD_MAX_ASSIGNMENTS) return "assignment-limit";
	if (bytes >= CHILD_MAX_TRANSCRIPT_BYTES) return "transcript-limit";
	if (!context || typeof context.tokens !== "number" || !Number.isFinite(context.tokens) || context.tokens < 0 || typeof context.window !== "number" || !Number.isFinite(context.window) || context.window <= 0 || context.compactionError) return "unsafe-context";
	return "none";
}

export function buildFollowupHandoff(goal: string, report: string, transcript: string): string {
	if (goal.length > 8_000) throw new Error("Original goal exceeds the bounded handoff limit. Start an explicit new subagent with a reviewed goal instead.");
	return [
		"Fresh-session handoff, NOT full conversation memory.",
		`Original goal: ${goal}`,
		`Evidence / full audit transcript: ${transcript}`,
		"Previous report (bounded; verify facts against current state):",
		report.slice(0, CHILD_HANDOFF_REPORT_CHARS),
		"Do not replay uncertain side effects. Inspect current state before acting; report uncertainty if necessary.",
	].join("\n");
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Saved reuse metadata is untrusted at the disk boundary; legacy jobs fail closed. */
export function isReusableChild(value: unknown): value is Extract<ChildReuse, { kind: "transcript" }> {
	if (!record(value) || value.kind !== "transcript" || !record(value.config)) return false;
	const config = value.config;
	return typeof value.lineageId === "string" && value.lineageId.length > 0 && typeof value.originalGoal === "string"
		&& typeof value.assignments === "number" && Number.isSafeInteger(value.assignments) && value.assignments >= 1
		&& typeof value.generation === "number" && Number.isSafeInteger(value.generation) && value.generation >= 1
		&& typeof config.type === "string" && ["explore", "shell", "custom"].includes(config.type)
		&& ["name", "description", "cwd", "model", "prompt"].every((key) => typeof config[key] === "string")
		&& Array.isArray(config.tools) && config.tools.every((tool) => typeof tool === "string")
		&& typeof config.thinkingLevel === "string" && ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(config.thinkingLevel)
		&& (config.source === undefined || config.source === "user" || config.source === "project")
		&& (config.filePath === undefined || typeof config.filePath === "string")
		&& record(config.routing)
		&& ["directMaxFiles", "directMaxAnchors", "maxTurns", "maxToolCalls", "timeoutSeconds"].every((key) => {
			const n = config.routing && record(config.routing) ? config.routing[key] : undefined;
			return typeof n === "number" && Number.isSafeInteger(n) && n > 0;
		});
}
