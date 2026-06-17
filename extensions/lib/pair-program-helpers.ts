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
// Driver startup validation (DEC-011, DEC-012, DEC-013)
// ---------------------------------------------------------------------------

/** Required sections in a valid Driver first-turn response. */
export const DRIVER_STARTUP_REQUIRED_SECTIONS = [
	"Todo List",
	"Principles Read",
	"Selected Playbook",
	"Playbook Steps",
	"Loaded Leaves",
	"Skipped Steps",
] as const;

/** Override Packet required fields (when override is present). */
export const OVERRIDE_PACKET_REQUIRED_FIELDS = [
	"Recommended",
	"Chosen",
	"Evidence",
	"Pinned Goal",
] as const;

export interface DriverStartupValidationResult {
	valid: boolean;
	errors: string[];
	parsedPlaybook?: string;
	parsedLeaves?: string[];
	isOverride?: boolean;
	overridePacket?: {
		recommended: string;
		chosen: string;
		evidence: string;
		pinnedGoal: string;
	};
}

/**
 * Extract body text under a ## heading. Returns null when absent or blank.
 * Reimplemented inline to avoid circular dependency with pair-protocol.
 */
function extractStartupSection(markdown: string, heading: string): string | null {
	const lines = markdown.split(/\r?\n/);
	const normalizedTarget = heading.trim().toLowerCase();
	const start = lines.findIndex((line) => {
		const stripped = line.trim();
		if (!stripped.startsWith("## ")) return false;
		return stripped.slice(3).trim().toLowerCase().replace(/[.!?:,;]+$/, "") === normalizedTarget;
	});
	if (start < 0) return null;
	const body: string[] = [];
	for (let i = start + 1; i < lines.length; i++) {
		if (lines[i].startsWith("## ")) break;
		body.push(lines[i]);
	}
	return body.join("\n").trim() || null;
}

/**
 * Parse leaf names from Loaded Leaves section.
 * Expects list items like: `- architect` or `- poteto-mode/playbooks/bug-fix`
 */
function parseLeafList(raw: string): string[] {
	return raw
		.split(/\r?\n/)
		.map((l) => l.replace(/^[-*+]\s+/, "").trim())
		.filter((l) => l.length > 0 && !l.startsWith("#"));
}

/**
 * Parse Override Packet fields from the raw section body.
 * Returns null if the section is absent or unparseable.
 */
function parseOverridePacket(
	raw: string,
): { recommended: string; chosen: string; evidence: string; pinnedGoal: string } | null {
	const getField = (fieldName: string): string => {
		const pattern = new RegExp(`^${fieldName}:\\s*(.+)$`, "im");
		const match = raw.match(pattern);
		return match?.[1]?.trim() ?? "";
	};
	const recommended = getField("Recommended");
	const chosen = getField("Chosen");
	const evidence = getField("Evidence");
	const pinnedGoal = getField("Pinned Goal");
	if (!recommended && !chosen && !evidence && !pinnedGoal) return null;
	return { recommended, chosen, evidence, pinnedGoal };
}

/**
 * Validate a Driver first-turn response against the pstack startup ritual requirements.
 *
 * Checks:
 * - All required sections present and non-empty.
 * - Selected Playbook is a valid slug in the registry.
 * - Loaded Leaves are valid slugs in the registry.
 * - Override Packet (if present) has all four required fields.
 * - Override Packet (if present) has a chosen playbook that is valid in registry.
 */
export function validateDriverStartup(
	responseText: string,
	registry: PstackRegistry,
	initialPlaybookRecommendation: string,
): DriverStartupValidationResult {
	const errors: string[] = [];

	// Check required sections
	for (const section of DRIVER_STARTUP_REQUIRED_SECTIONS) {
		if (!extractStartupSection(responseText, section)) {
			errors.push(`Missing required section: ## ${section}.`);
		}
	}

	// Parse Selected Playbook
	const selectedPlaybookRaw = extractStartupSection(responseText, "Selected Playbook");
	const parsedPlaybook = selectedPlaybookRaw?.split(/\r?\n/)[0]?.replace(/^[-*+]\s+/, "").replace(/\*\*/g, "").trim() ?? "";

	// Validate playbook against registry
	if (parsedPlaybook && !registry.allNames.has(parsedPlaybook) && !registry.allNames.has(normalizePlaybookSlug(parsedPlaybook))) {
		errors.push(`Selected playbook "${parsedPlaybook}" is not in the pstack registry.`);
	}

	// Parse Loaded Leaves
	const leavesRaw = extractStartupSection(responseText, "Loaded Leaves");
	const parsedLeaves = leavesRaw ? parseLeafList(leavesRaw) : [];

	// Validate leaves against registry
	for (const leaf of parsedLeaves) {
		const slug = normalizePlaybookSlug(leaf);
		if (!registry.allNames.has(leaf) && !registry.allNames.has(slug)) {
			errors.push(`Loaded leaf "${leaf}" is not in the pstack registry.`);
		}
	}

	// Parse and validate Override Packet
	const overrideRaw = extractStartupSection(responseText, "Override Packet");
	let isOverride = false;
	let overridePacket: DriverStartupValidationResult["overridePacket"];

	if (overrideRaw) {
		isOverride = true;
		const parsed = parseOverridePacket(overrideRaw);
		if (!parsed) {
			errors.push("Override Packet section is present but could not be parsed.");
		} else {
			overridePacket = parsed;
			for (const field of OVERRIDE_PACKET_REQUIRED_FIELDS) {
				const key = field === "Pinned Goal" ? "pinnedGoal" : field.toLowerCase() as keyof typeof parsed;
				if (!parsed[key]) {
					errors.push(`Override Packet missing required field: ${field}.`);
				}
			}
			// Validate chosen playbook in registry
			if (parsed.chosen && !registry.allNames.has(parsed.chosen) && !registry.allNames.has(normalizePlaybookSlug(parsed.chosen))) {
				errors.push(`Override Packet chosen playbook "${parsed.chosen}" is not in the pstack registry.`);
			}
		}
	}

	return {
		valid: errors.length === 0,
		errors,
		parsedPlaybook: parsedPlaybook || undefined,
		parsedLeaves: parsedLeaves.length > 0 ? parsedLeaves : undefined,
		isOverride,
		overridePacket,
	};
}

// ---------------------------------------------------------------------------
// Playbook switch amendment validation (DEC-023)
// ---------------------------------------------------------------------------

export interface PlaybookSwitchRequest {
	newPlaybook: string;
	reason: string;
	isFirstTurn: boolean;
	startupOverrideUsed: boolean;
}

export interface PlaybookSwitchResult {
	allowed: boolean;
	reason?: string;
}

/**
 * Determine whether a playbook switch is allowed.
 *
 * Policy:
 * - First turn: one override allowed if startup override was not already used.
 * - After first turn: switch requires a blocker or contradiction reason.
 */
export function validatePlaybookSwitch(
	request: PlaybookSwitchRequest,
	registry: PstackRegistry,
): PlaybookSwitchResult {
	// Validate new playbook against registry
	const slug = normalizePlaybookSlug(request.newPlaybook);
	if (!registry.allNames.has(request.newPlaybook) && !registry.allNames.has(slug)) {
		return { allowed: false, reason: `Playbook "${request.newPlaybook}" is not in the pstack registry.` };
	}

	if (request.isFirstTurn) {
		if (request.startupOverrideUsed) {
			return { allowed: false, reason: "First-turn playbook override already used." };
		}
		return { allowed: true };
	}

	// After first turn: must be blocker/contradiction
	const reason = request.reason.toLowerCase();
	const hasBlocker = reason.includes("blocker") || reason.includes("contradiction") || reason.includes("blocked");
	if (!hasBlocker) {
		return {
			allowed: false,
			reason: "Post-first-turn playbook switches require a blocker or contradiction amendment.",
		};
	}
	return { allowed: true };
}

// ---------------------------------------------------------------------------
// Telemetry cross-check for loaded leaves (DEC-015)
// ---------------------------------------------------------------------------

export interface LeafTelemetryCheckResult {
	verified: string[];
	unverified: string[];
}

/**
 * Cross-check Driver's loaded-leaf claims against available telemetry.
 *
 * A leaf is "verified" if the telemetry contains a skill_load kind entry
 * whose targetPreview or commandPreview matches the leaf slug. Otherwise
 * it is "unverified" (Markdown-only claim).
 */
export function crossCheckLeavesAgainstTelemetry(
	claimedLeaves: string[],
	telemetryEntries: Array<{ kind: string; targetPreview?: string; commandPreview?: string }>,
): LeafTelemetryCheckResult {
	const verified: string[] = [];
	const unverified: string[] = [];

	for (const leaf of claimedLeaves) {
		const slug = normalizePlaybookSlug(leaf);
		const found = telemetryEntries.some((entry) => {
			if (entry.kind !== "skill_load") return false;
			const preview = (entry.targetPreview ?? entry.commandPreview ?? "").toLowerCase();
			return preview.includes(slug.toLowerCase()) || preview.includes(leaf.toLowerCase());
		});
		if (found) {
			verified.push(leaf);
		} else {
			unverified.push(leaf);
		}
	}

	return { verified, unverified };
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
