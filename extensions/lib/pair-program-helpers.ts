/**
 * Pure helpers for the pair_program tool: parameter normalization, the
 * single-active-run guard, and pstack registry prerequisite verification.
 *
 * These helpers contain no Pi/MCP runtime dependencies so they can be
 * unit-tested without spawning child sessions, MCP servers, or git
 * processes. The pair_program extension wires them to the live runtime.
 */

// ---------------------------------------------------------------------------
// Defaults (MICRO-001, MESO-014)
// ---------------------------------------------------------------------------

export const DEFAULT_MAX_CYCLES = 4;

// ---------------------------------------------------------------------------
// Parameter normalization (MICRO-001)
// ---------------------------------------------------------------------------

export interface PairProgramRawParams {
	task: string;
	maxCycles?: number;
	driverModel?: string;
	navigatorModel?: string;
}

export interface PairProgramNormalizedParams {
	task: string;
	maxCycles: number;
	driverModel?: string;
	navigatorModel?: string;
}

/**
 * Pure normalizer for pair_program parameters.
 *
 * - `maxCycles` defaults to 4 (callers should still reject < 1 if needed; the
 *   TypeBox schema enforces `minimum: 1` for explicit values).
 */
export function normalizeParams(raw: PairProgramRawParams): PairProgramNormalizedParams {
	return {
		task: raw.task,
		maxCycles: raw.maxCycles ?? DEFAULT_MAX_CYCLES,
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
// Pstack registry types (DEC-011, DEC-012, DEC-013, DEC-015)
// ---------------------------------------------------------------------------

export interface PstackEntry {
	/** Full canonical name as it appears in MCP metadata. */
	name: string;
	/** Human-facing short slug (last path segment for playbooks, same as name for skills). */
	slug: string;
	type: "skill" | "playbook";
}

export interface PstackRegistry {
	skills: readonly PstackEntry[];
	playbooks: readonly PstackEntry[];
	/** All full names and all slugs — useful for fast membership checks. */
	allNames: ReadonlySet<string>;
}

export type PstackRegistryResult =
	| { available: true; registry: PstackRegistry }
	| { available: false; reason: string };

export interface PstackToolInfo {
	name: string;
	description?: string;
}

export interface PstackRegistryResolverOptions {
	/** Enumerates currently registered Pi tools. The preferred and only accepted mechanism. */
	getAllTools?: () => PstackToolInfo[];
}

// ---------------------------------------------------------------------------
// Slug normalization (DEC-012)
// ---------------------------------------------------------------------------

/**
 * Normalizes a pstack name to a human-facing short slug.
 *
 * - `poteto-mode/playbooks/bug-fix` → `bug-fix`   (last path segment)
 * - `architect`                     → `architect`  (no path, unchanged)
 * - `""`                            → `""`          (empty, unchanged)
 */
export function normalizePlaybookSlug(fullName: string): string {
	if (!fullName) return fullName;
	const segments = fullName.split("/");
	return segments[segments.length - 1] ?? fullName;
}

// ---------------------------------------------------------------------------
// Pstack registry description parser
// ---------------------------------------------------------------------------

/**
 * Parses the pstack skill/playbook list from the description text emitted by
 * the `engineering_skills_skill-pstack` MCP tool's metadata.
 *
 * Expected format (sections separated by blank lines):
 * ```
 * Skills:
 *   - architect
 *   - figure-it-out
 * Playbooks:
 *   - poteto-mode/playbooks/bug-fix
 * ```
 */
export function parsePstackRegistry(description: string): PstackRegistry {
	const lines = description.split("\n");

	const skills: PstackEntry[] = [];
	const playbooks: PstackEntry[] = [];

	type Section = "none" | "skills" | "playbooks";
	let section: Section = "none";

	for (const rawLine of lines) {
		const line = rawLine.trim();

		if (/^Skills:/i.test(line)) {
			section = "skills";
			continue;
		}
		if (/^Playbooks:/i.test(line)) {
			section = "playbooks";
			continue;
		}
		// Any other header-like line (e.g. "Parameters:") ends the known sections.
		if (/^\w[^-].*:/.test(line) && line.endsWith(":")) {
			section = "none";
			continue;
		}

		if (section === "none") continue;

		const match = line.match(/^-\s+(.+)$/);
		if (!match) continue;
		const name = match[1].trim();
		if (!name) continue;

		if (section === "skills") {
			skills.push({ name, slug: normalizePlaybookSlug(name), type: "skill" });
		} else {
			playbooks.push({ name, slug: normalizePlaybookSlug(name), type: "playbook" });
		}
	}

	const allNames = new Set<string>();
	for (const s of skills) {
		allNames.add(s.name);
		allNames.add(s.slug);
	}
	for (const p of playbooks) {
		allNames.add(p.name);
		allNames.add(p.slug);
	}

	return { skills, playbooks, allNames };
}

// ---------------------------------------------------------------------------
// Pstack registry resolution (DEC-013)
// ---------------------------------------------------------------------------

const SKILL_PSTACK_PATTERN = /skill[-_]pstack/i;

/**
 * Resolves the pstack skill/playbook registry by locating the
 * `skill-pstack` tool in the registered Pi tool set and parsing its
 * description metadata. The registry is intended to be snapshotted once
 * per run at startup and then treated as immutable for that run.
 *
 * Returns `{ available: false, reason }` when:
 *   - `getAllTools` is not provided.
 *   - No tool matching the skill-pstack pattern is found.
 *   - The matched tool has an empty or missing description.
 *   - `getAllTools` throws.
 */
export function resolvePstackRegistry(opts: PstackRegistryResolverOptions): PstackRegistryResult {
	if (!opts.getAllTools) {
		return { available: false, reason: "No tool resolver provided; cannot locate skill-pstack metadata." };
	}

	let tools: PstackToolInfo[];
	try {
		tools = opts.getAllTools() ?? [];
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		return { available: false, reason: `Failed to enumerate tools: ${message}` };
	}

	const pstackTool = tools.find(
		(t) => t && typeof t.name === "string" && SKILL_PSTACK_PATTERN.test(t.name),
	);

	if (!pstackTool) {
		return {
			available: false,
			reason:
				"skill-pstack tool not found in the Pi tool registry. " +
				"Ensure the engineering-skills MCP server is connected.",
		};
	}

	const description = pstackTool.description ?? "";
	if (!description.trim()) {
		return {
			available: false,
			reason:
				`skill-pstack tool found (${pstackTool.name}) but its description is empty; ` +
				"cannot resolve the pstack registry.",
		};
	}

	const registry = parsePstackRegistry(description);
	return { available: true, registry };
}

// ---------------------------------------------------------------------------
// Runtime status mapping (MICRO-003)
// ---------------------------------------------------------------------------

export type PairProgramStatus = "success" | "blocked" | "incomplete" | "error";

/**
 * Map a (loose) reason string to one of the four user-facing runtime statuses.
 * Useful for the registry-unavailable / concurrency early-return paths.
 */
export function mapEarlyReturnStatus(
	reason: "already_active" | "registry_unavailable" | "incomplete",
): PairProgramStatus {
	switch (reason) {
	case "already_active":
		return "error";
	case "registry_unavailable":
		return "blocked";
	case "incomplete":
		return "incomplete";
	default: {
		const _exhaustive: never = reason;
		return _exhaustive;
	}
	}
}
