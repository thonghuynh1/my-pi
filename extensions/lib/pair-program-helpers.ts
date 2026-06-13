/**
 * Pure helpers for the pair_program tool: parameter normalization, the
 * single-active-run guard, and skill-tdd prerequisite verification.
 *
 * These helpers contain no Pi/MCP runtime dependencies so they can be
 * unit-tested without spawning child sessions, MCP servers, or git
 * processes. The pair_program extension wires them to the live runtime.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Defaults (MICRO-001, MESO-014)
// ---------------------------------------------------------------------------

export const DEFAULT_MODE = "tdd" as const;
export const DEFAULT_MAX_CYCLES = 4;
export const DEFAULT_DRY_RUN = true;

// ---------------------------------------------------------------------------
// Parameter normalization (MICRO-001)
// ---------------------------------------------------------------------------

export interface PairProgramRawParams {
	task: string;
	mode?: string;
	maxCycles?: number;
	testCommand?: string;
	dryRun?: boolean;
	driverModel?: string;
	navigatorModel?: string;
}

export interface PairProgramNormalizedParams {
	task: string;
	mode: string;
	maxCycles: number;
	testCommand?: string;
	dryRun: boolean;
	driverModel?: string;
	navigatorModel?: string;
}

/**
 * Pure normalizer for pair_program parameters.
 *
 * - `mode` defaults to "tdd".
 * - `maxCycles` defaults to 4 (callers should still reject < 1 if needed; the
 *   TypeBox schema enforces `minimum: 1` for explicit values).
 * - `dryRun` defaults to true so Driver does not get edit/write tools unless
 *   the caller explicitly opts in by passing `dryRun: false`.
 */
export function normalizeParams(raw: PairProgramRawParams): PairProgramNormalizedParams {
	return {
		task: raw.task,
		mode: raw.mode ?? DEFAULT_MODE,
		maxCycles: raw.maxCycles ?? DEFAULT_MAX_CYCLES,
		testCommand: raw.testCommand,
		dryRun: raw.dryRun ?? DEFAULT_DRY_RUN,
		driverModel: raw.driverModel,
		navigatorModel: raw.navigatorModel,
	};
}

// ---------------------------------------------------------------------------
// Active-run guard (MESO-017)
// ---------------------------------------------------------------------------

let activeRunId: string | undefined;

export function tryAcquireRun(runId = "active"): boolean {
	if (activeRunId) return false;
	activeRunId = runId;
	return true;
}

export function releaseRun(): void {
	activeRunId = undefined;
}

export function isRunActive(): boolean {
	return activeRunId !== undefined;
}

/** Test-only helper to reset the module-scoped guard between unit tests. */
export function __resetActiveRunForTests(): void {
	activeRunId = undefined;
}

// ---------------------------------------------------------------------------
// skill-tdd prerequisite verification (MESO-016, MICRO-002)
// ---------------------------------------------------------------------------

/*
 * skill-tdd verification mechanisms (preferred first):
 *
 *   1. Preferred: enumerate registered Pi tools via `pi.getAllTools()` and
 *      look for any tool whose name contains "skill-tdd" or "skill_tdd"
 *      (case-insensitive). When the engineering-skills MCP server is
 *      connected, pi-mcp-adapter registers each MCP tool as a direct Pi
 *      tool with a server-prefixed name (e.g. `engineering-skills_skill-tdd`
 *      or its underscore-normalized variant). This is the most accurate
 *      runtime signal that skill-tdd is actually callable.
 *
 *   2. Fallback: check whether the `engineering-skills` MCP server is
 *      *configured* in any of the well-known MCP config files. This is a
 *      pre-startup proxy: if the server is configured, skill-tdd is
 *      *expected* to be available once the MCP adapter finishes connecting.
 *      It is used when getAllTools() is unavailable or the MCP adapter has
 *      not yet finished its lazy connect.
 *
 * Why prefer (1): config presence does not prove the server actually
 *   started or that the skill-tdd tool registered without error. The tool
 *   registry is the source of truth at call time.
 *
 * Why keep (2): pi-mcp-adapter uses `lifecycle: "lazy"`, so at the moment
 *   pair_program is invoked the direct tool may not yet be registered.
 *   Config presence lets us proceed (with a warning-grade signal) rather
 *   than blocking the first run after a fresh Pi start.
 *
 * No SKILL.md filesystem path appears in this verification.
 */

export type SkillTddMechanism = "tool-registry" | "mcp-config" | "none";

export interface SkillTddToolInfo {
	name: string;
}

export interface SkillTddVerifierOptions {
	/** Enumerates currently registered Pi tools. Preferred mechanism. */
	getAllTools?: () => SkillTddToolInfo[];
	/** Checks whether the engineering-skills MCP server is configured. Fallback. */
	isMcpConfigured?: () => boolean;
}

export interface SkillTddVerificationResult {
	available: boolean;
	mechanism: SkillTddMechanism;
	matchedToolName?: string;
}

const SKILL_TDD_PATTERNS = [/skill[-_]tdd/i];

export function verifySkillTddAvailable(opts: SkillTddVerifierOptions): SkillTddVerificationResult {
	if (opts.getAllTools) {
		try {
			const tools = opts.getAllTools() ?? [];
			for (const tool of tools) {
				if (!tool || typeof tool.name !== "string") continue;
				for (const pattern of SKILL_TDD_PATTERNS) {
					if (pattern.test(tool.name)) {
						return { available: true, mechanism: "tool-registry", matchedToolName: tool.name };
					}
				}
			}
		} catch {
			// Fall through to the MCP-config fallback below.
		}
	}

	if (opts.isMcpConfigured) {
		try {
			if (opts.isMcpConfigured()) {
				return { available: true, mechanism: "mcp-config" };
			}
		} catch {
			// Treat any failure as "not configured".
		}
	}

	return { available: false, mechanism: "none" };
}

// ---------------------------------------------------------------------------
// engineering-skills MCP config discovery (fallback helper)
// ---------------------------------------------------------------------------

const SERVER_NAME = "engineering-skills";
const GLOBAL_MCP_CONFIG = path.join(homedir(), ".config", "mcp", "mcp.json");

interface McpConfigFile {
	mcpServers?: Record<string, unknown>;
	[key: string]: unknown;
}

function readJsonFile(filePath: string): McpConfigFile {
	if (!fs.existsSync(filePath)) return {};
	try {
		const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

export function isEngineeringSkillsConfigured(): boolean {
	const candidates = [
		GLOBAL_MCP_CONFIG,
		path.join(homedir(), ".pi", "agent", "mcp.json"),
		path.resolve(process.cwd(), ".mcp.json"),
		path.resolve(process.cwd(), ".pi", "mcp.json"),
	];
	for (const candidate of candidates) {
		const config = readJsonFile(candidate);
		if (
			config.mcpServers &&
			Object.prototype.hasOwnProperty.call(config.mcpServers, SERVER_NAME)
		) {
			return true;
		}
	}
	return false;
}

// ---------------------------------------------------------------------------
// Runtime status mapping (MICRO-003)
// ---------------------------------------------------------------------------

export type PairProgramStatus = "success" | "blocked" | "incomplete" | "error";

/**
 * Map a (loose) reason string to one of the four user-facing runtime statuses.
 * Useful for the skill-tdd / unsupported-mode / concurrency early-return paths.
 */
export function mapEarlyReturnStatus(
	reason: "unsupported_mode" | "already_active" | "skill_tdd_missing" | "incomplete",
): PairProgramStatus {
	switch (reason) {
	case "unsupported_mode":
	case "already_active":
		return "error";
	case "skill_tdd_missing":
		return "blocked";
	case "incomplete":
		return "incomplete";
	default: {
		const _exhaustive: never = reason;
		return _exhaustive;
	}
	}
}
