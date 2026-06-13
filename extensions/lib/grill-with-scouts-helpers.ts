/**
 * grill-with-scouts-helpers.ts — pure helpers for Grill With Scouts session
 * scaffold and artifact store.
 *
 * Separated from the extension entrypoint so it can be unit-tested without
 * requiring the full ExtensionAPI.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Root path relative to ctx.cwd for all Grill With Scouts artifacts. */
export const ARTIFACT_ROOT = ".scratch/grill-with-scouts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A file path inspected by a scout's tool call during execution. */
export interface InspectedPath {
	/** The file or directory path that was accessed. */
	path: string;
	/** Which tool performed the access. */
	tool: "read" | "grep" | "find" | "ls";
	/** Discriminates a path actually read from a path searched/listed. */
	kind: "read" | "searched";
}

/** Verification status for a single area in the handoff. */
export type VerificationStatus = "path-verified, anchor-claimed" | "partial" | "unverified";

/** Per-area verification record for the Scout-Grounded Handoff. */
export interface AreaVerification {
	/** Area name (typically the scout profile name). */
	area: string;
	/** Determined verification status. */
	status: VerificationStatus;
	/** Tool-verified inspected paths for this area. */
	toolVerifiedPaths: InspectedPath[];
	/** Scout-claimed anchors (symbols/contracts/state names). */
	scoutClaimedAnchors: string[];
	/** Delta Verification instruction for to-prd consumption. */
	deltaInstruction: string;
}

// ---------------------------------------------------------------------------
// Scout Profile Types
// ---------------------------------------------------------------------------

export interface ScoutProfile {
	name: string;
	description: string;
	scope: string;
	triggerFit: string;
	evidenceRequirements: string;
	verdictFormat: string;
	forbiddenBehaviors: string;
	body: string;
}

export interface ScoutVerdict {
	verdict: "viable" | "risky" | "blocked" | "needs-decision";
	evidence: string;
	concern: string;
	requiredDecision: string;
	claimedAnchors: string;
	confidence: "verified" | "partial" | "unverified";
}

export interface ScoutGate {
	id: string;
	tier: "macro" | "meso" | "micro";
	decisionUnderReview: string;
	crossesBoundary: boolean;
	changesContractOrState: boolean;
	introducesLifecycle: boolean;
	hasRuntimeRisk: boolean;
	hasUnverifiedLayerAssumption: boolean;
	hasMeaningfulFailureCost: boolean;
	riskLevel: "low" | "medium" | "high";
	selectedScoutProfiles: string[];
	budgetAction: "call-now" | "ask-human" | "skip-with-reason";
	skipReason?: string;
}

export interface SessionState {
	id: string;
	goal: string;
	currentTier: string;
	currentDecision: string | null;
	acceptedDecisions: string[];
	scoutGates: ScoutGate[];
	durableScoutFindings: string[];
	scoutGaps: string[];
	contextPressure: number;
	checkpoints: string[];
	handoffReady: boolean;
	createdAt: string;
	nextQuestion: string | null;
	userAcceptedAssumptions: string[];
	glossaryDeltas: string[];
	adrCandidates: string[];
	contractArtifacts: string[];
	respawnCount?: number;
}

export interface CreateSessionResult {
	state: SessionState;
	created: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Slugify a string for use in file/directory names.
 * Lowercases, replaces non-alphanumeric runs with hyphens, trims, caps at 60.
 */
export function slugify(s: string): string {
	const slug = s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);
	return slug || "session";
}

/**
 * Generate a deterministic session ID from a goal and timestamp.
 * Format: YYYY-MM-DDTHHMMSS-<slug>
 */
export function generateSessionId(goal: string, now: Date = new Date()): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	const ts =
		`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
		`T${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
	return `${ts}-${slugify(goal)}`;
}

// ---------------------------------------------------------------------------
// Artifact content generators
// ---------------------------------------------------------------------------

function renderTranscript(state: SessionState): string {
	return [
		"# Grill With Scouts Transcript",
		"",
		`**Goal**: ${state.goal}`,
		`**Session**: ${state.id}`,
		`**Started**: ${state.createdAt}`,
		"",
		"---",
		"",
		"_Session initialized. Transcript entries will be appended below._",
		"",
	].join("\n");
}

function renderHandoff(state: SessionState): string {
	return [
		"# Handoff",
		"",
		`**Goal**: ${state.goal}`,
		`**Session**: ${state.id}`,
		`**Status**: In progress`,
		"",
		"## Decisions",
		"",
		"_No decisions accepted yet._",
		"",
		"## Scout Findings",
		"",
		"_No scout findings yet._",
		"",
		"## Next Steps",
		"",
		"_Session just started._",
		"",
	].join("\n");
}

function renderLatestHandoff(state: SessionState, sessionHandoffPath: string): string {
	return [
		"# Latest Grill With Scouts Handoff",
		"",
		`**Goal**: ${state.goal}`,
		`**Session**: ${state.id}`,
		`**Status**: In progress`,
		"",
		`> Full handoff: [${sessionHandoffPath}](${sessionHandoffPath})`,
		"",
		"## Decisions",
		"",
		"_No decisions accepted yet._",
		"",
		"## Scout Findings",
		"",
		"_No scout findings yet._",
		"",
	].join("\n");
}

// ---------------------------------------------------------------------------
// Main session creation
// ---------------------------------------------------------------------------

/**
 * Create a new Grill With Scouts session with full artifact tree.
 *
 * Idempotent: if a session with the same ID already exists (same goal + timestamp),
 * returns the existing state without overwriting any files.
 *
 * @param goal - The session goal text
 * @param cwd - The active target repo root (ctx.cwd)
 * @param now - Optional fixed timestamp for deterministic IDs (testing)
 */
export function createSession(goal: string, cwd: string, now?: Date): CreateSessionResult {
	const id = generateSessionId(goal, now);
	const rootDir = join(cwd, ARTIFACT_ROOT);
	const sessionDir = join(rootDir, "sessions", id);
	const sessionJsonPath = join(sessionDir, "session.json");

	// Idempotency guard: if session already exists, return existing state
	if (existsSync(sessionJsonPath)) {
		const existing: SessionState = JSON.parse(readFileSync(sessionJsonPath, "utf8"));
		return { state: existing, created: false };
	}

	// Build initial session state
	const state: SessionState = {
		id,
		goal,
		currentTier: "discovery",
		currentDecision: null,
		acceptedDecisions: [],
		scoutGates: [],
		durableScoutFindings: [],
		scoutGaps: [],
		contextPressure: 0,
		checkpoints: [],
		handoffReady: false,
		createdAt: (now ?? new Date()).toISOString(),
		nextQuestion: null,
		userAcceptedAssumptions: [],
		glossaryDeltas: [],
		adrCandidates: [],
		contractArtifacts: [],
	};

	// Create directory tree
	mkdirSync(sessionDir, { recursive: true });
	mkdirSync(join(sessionDir, "checkpoints"), { recursive: true });
	mkdirSync(join(sessionDir, "scouts"), { recursive: true });

	// Write session.json
	writeFileSync(sessionJsonPath, JSON.stringify(state, null, 2), "utf8");

	// Write transcript.md
	writeFileSync(join(sessionDir, "transcript.md"), renderTranscript(state), "utf8");

	// Write handoff.md
	writeFileSync(join(sessionDir, "handoff.md"), renderHandoff(state), "utf8");

	// Write/update latest-handoff.md
	const relativeHandoffPath = `sessions/${id}/handoff.md`;
	const latestHandoffPath = join(rootDir, "latest-handoff.md");
	writeFileSync(latestHandoffPath, renderLatestHandoff(state, relativeHandoffPath), "utf8");

	return { state, created: true };
}

// ---------------------------------------------------------------------------
// Scout Budget Policy
// ---------------------------------------------------------------------------

/**
 * Deterministic budget routing based on risk level.
 * - high → call-now
 * - medium → ask-human
 * - low → skip-with-reason
 */
export function determineBudgetAction(
	riskLevel: ScoutGate["riskLevel"],
): ScoutGate["budgetAction"] {
	switch (riskLevel) {
		case "high":
			return "call-now";
		case "medium":
			return "ask-human";
		case "low":
			return "skip-with-reason";
	}
}

// ---------------------------------------------------------------------------
// Record Scout Gate
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Anchor-Level Verification — Pure Functions
// ---------------------------------------------------------------------------

const INSPECTION_TOOLS = new Set(["read", "grep", "find", "ls"]);

/**
 * Derive inspected paths from a set of tool calls recorded during scout execution.
 *
 * Only extracts paths from read/grep/find/ls calls. Defensively handles
 * missing or malformed args. Distinguishes "read" (tool=read) from
 * "searched" (tool=grep/find/ls).
 */
export function deriveInspectedPaths(
	toolCalls: Array<{ name: string; args: unknown }>,
): InspectedPath[] {
	const results: InspectedPath[] = [];

	for (const call of toolCalls) {
		if (!INSPECTION_TOOLS.has(call.name)) continue;

		// Defensively extract path from args
		if (call.args == null || typeof call.args !== "object") continue;
		const args = call.args as Record<string, unknown>;
		const pathValue = args["path"];
		if (typeof pathValue !== "string" || pathValue.length === 0) continue;

		const tool = call.name as InspectedPath["tool"];
		const kind: InspectedPath["kind"] = tool === "read" ? "read" : "searched";

		results.push({ path: pathValue, tool, kind });
	}

	return results;
}

/**
 * Compute the verification status for a single area.
 *
 * Rules:
 * - `path-verified, anchor-claimed` if ≥1 tool-verified path AND ≥1 claimed anchor AND no relevant scout gaps.
 * - `partial` if some evidence exists (paths or anchors, but not both) OR a relevant gap exists.
 * - `unverified` if no tool evidence at all and no claimed anchors.
 *
 * Scout Gaps mentioning the area name force that area to at most `partial`.
 */
export function computeAreaVerification(
	area: string,
	inspectedPaths: InspectedPath[],
	claimedAnchors: string[],
	scoutGaps: string[],
): AreaVerification {
	const hasPaths = inspectedPaths.length > 0;
	const hasAnchors = claimedAnchors.length > 0;

	// Check if any gap mentions this area
	const areaLower = area.toLowerCase();
	const hasRelevantGap = scoutGaps.some(g => g.toLowerCase().includes(areaLower));

	let status: VerificationStatus;

	if (!hasPaths && !hasAnchors) {
		status = "unverified";
	} else if (hasPaths && hasAnchors && !hasRelevantGap) {
		status = "path-verified, anchor-claimed";
	} else {
		// Some evidence but incomplete, or gap blocks full verification
		status = "partial";
	}

	return {
		area,
		status,
		toolVerifiedPaths: inspectedPaths,
		scoutClaimedAnchors: claimedAnchors,
		deltaInstruction: deltaVerificationInstruction(status),
	};
}

/**
 * Return the Delta Verification instruction string for a given verification status.
 *
 * Contract:
 * - verified → spot-check claimed anchors
 * - partial → targeted follow-up
 * - unverified → normal discovery
 */
export function deltaVerificationInstruction(status: VerificationStatus): string {
	switch (status) {
		case "path-verified, anchor-claimed":
			return "Spot-check claimed anchors; paths already tool-verified.";
		case "partial":
			return "Targeted follow-up required; some evidence exists but verification is incomplete.";
		case "unverified":
			return "Normal discovery required; no tool evidence available for this area.";
	}
}

/**
 * Format a Scout Gate entry for appending to transcript.md.
 */
function renderScoutGateTranscriptEntry(gate: ScoutGate): string {
	const lines: string[] = [
		"",
		`## Scout Gate: ${gate.id}`,
		"",
		`**Decision**: ${gate.decisionUnderReview}`,
		`**Tier**: ${gate.tier}`,
		`**Risk Level**: ${gate.riskLevel}`,
		`**Budget Action**: ${gate.budgetAction}`,
	];

	if (gate.skipReason) {
		lines.push(`**Skip Reason**: ${gate.skipReason}`);
	}

	lines.push("", "### Trigger Fields", "");
	lines.push(`- crossesBoundary: ${gate.crossesBoundary}`);
	lines.push(`- changesContractOrState: ${gate.changesContractOrState}`);
	lines.push(`- introducesLifecycle: ${gate.introducesLifecycle}`);
	lines.push(`- hasRuntimeRisk: ${gate.hasRuntimeRisk}`);
	lines.push(`- hasUnverifiedLayerAssumption: ${gate.hasUnverifiedLayerAssumption}`);
	lines.push(`- hasMeaningfulFailureCost: ${gate.hasMeaningfulFailureCost}`);

	if (gate.selectedScoutProfiles.length > 0) {
		lines.push("", "### Selected Scouts", "");
		for (const profile of gate.selectedScoutProfiles) {
			lines.push(`- ${profile}`);
		}
	}

	lines.push("", "---", "");
	return lines.join("\n");
}

/**
 * Record a Scout Gate into the session.
 *
 * - Reads session.json, pushes the gate, writes back.
 * - Appends a formatted block to transcript.md.
 *
 * @param gate - The ScoutGate record to persist
 * @param cwd - The active target repo root
 * @param sessionId - The session ID to record the gate into
 */
export function recordScoutGate(gate: ScoutGate, cwd: string, sessionId: string): void {
	const sessionDir = join(cwd, ARTIFACT_ROOT, "sessions", sessionId);
	const sessionJsonPath = join(sessionDir, "session.json");
	const transcriptPath = join(sessionDir, "transcript.md");

	// Update session.json
	const state: SessionState = JSON.parse(readFileSync(sessionJsonPath, "utf8"));
	state.scoutGates.push(gate);
	writeFileSync(sessionJsonPath, JSON.stringify(state, null, 2), "utf8");

	// Append to transcript.md
	appendFileSync(transcriptPath, renderScoutGateTranscriptEntry(gate), "utf8");
}

// ---------------------------------------------------------------------------
// Context Pressure Tracking
// ---------------------------------------------------------------------------

/**
 * Update the context pressure (0–100) on a session state.
 * Clamps to [0, 100]. Mutates and returns the same state object.
 */
export function updateContextPressure(state: SessionState, percent: number): SessionState {
	state.contextPressure = Math.max(0, Math.min(100, Math.round(percent)));
	return state;
}

// ---------------------------------------------------------------------------
// Checkpoint Creation
// ---------------------------------------------------------------------------

/**
 * Render the Markdown content of a Grill Checkpoint.
 * Includes all required sections; full scout outputs are referenced by path only.
 */
function renderCheckpointContent(state: SessionState, checkpointNumber: number): string {
	const lines: string[] = [];

	lines.push(`# Grill Checkpoint ${checkpointNumber}`);
	lines.push("");
	lines.push(`**Goal**: ${state.goal}`);
	lines.push(`**Current Tier**: ${state.currentTier}`);
	lines.push(`**Context Pressure**: ${state.contextPressure}%`);
	lines.push(`**Created**: ${new Date().toISOString()}`);
	lines.push("");

	// Accepted decisions
	lines.push("## Accepted Decisions");
	lines.push("");
	if (state.acceptedDecisions.length > 0) {
		for (const d of state.acceptedDecisions) lines.push(`- ${d}`);
	} else {
		lines.push("_None yet._");
	}
	lines.push("");

	// User-accepted assumptions
	lines.push("## User-Accepted Assumptions");
	lines.push("");
	if (state.userAcceptedAssumptions.length > 0) {
		for (const a of state.userAcceptedAssumptions) lines.push(`- ${a}`);
	} else {
		lines.push("_None yet._");
	}
	lines.push("");

	// Unresolved material questions
	lines.push("## Unresolved Material Questions");
	lines.push("");
	if (state.nextQuestion) {
		lines.push(`- ${state.nextQuestion}`);
	} else {
		lines.push("_None._");
	}
	lines.push("");

	// Durable Scout Findings
	lines.push("## Durable Scout Findings");
	lines.push("");
	if (state.durableScoutFindings.length > 0) {
		for (const f of state.durableScoutFindings) lines.push(`- ${f}`);
	} else {
		lines.push("_None yet._");
	}
	lines.push("");

	// Scout Gaps
	lines.push("## Scout Gaps");
	lines.push("");
	if (state.scoutGaps.length > 0) {
		for (const g of state.scoutGaps) lines.push(`- ${g}`);
	} else {
		lines.push("_None._");
	}
	lines.push("");

	// Glossary Deltas
	lines.push("## Glossary Deltas");
	lines.push("");
	if (state.glossaryDeltas.length > 0) {
		for (const g of state.glossaryDeltas) lines.push(`- ${g}`);
	} else {
		lines.push("_None._");
	}
	lines.push("");

	// ADR Candidates
	lines.push("## ADR Candidates");
	lines.push("");
	if (state.adrCandidates.length > 0) {
		for (const a of state.adrCandidates) lines.push(`- ${a}`);
	} else {
		lines.push("_None._");
	}
	lines.push("");

	// Contract Artifacts (references only, no raw scout output)
	lines.push("## Contract Artifacts");
	lines.push("");
	if (state.contractArtifacts.length > 0) {
		for (const c of state.contractArtifacts) lines.push(`- [${c}](${c})`);
	} else {
		lines.push("_None._");
	}
	lines.push("");

	// Next Question
	lines.push("## Next Question");
	lines.push("");
	lines.push(state.nextQuestion ?? "_None — awaiting next tier question._");
	lines.push("");

	return lines.join("\n");
}

/**
 * Create a formal Grill Checkpoint.
 *
 * - Writes `checkpoints/<n>.md` (sequentially numbered)
 * - Writes `checkpoints/latest.md` (same content as the latest numbered file)
 * - Updates `state.checkpoints` array with the relative path
 * - Persists updated state to session.json
 *
 * Mutates and returns the state.
 */
export function createCheckpoint(state: SessionState, cwd: string, sessionId: string): SessionState {
	const sessionDir = join(cwd, ARTIFACT_ROOT, "sessions", sessionId);
	const checkpointsDir = join(sessionDir, "checkpoints");
	mkdirSync(checkpointsDir, { recursive: true });

	const checkpointNumber = state.checkpoints.length + 1;
	const content = renderCheckpointContent(state, checkpointNumber);

	const numberedPath = join(checkpointsDir, `${checkpointNumber}.md`);
	const latestPath = join(checkpointsDir, "latest.md");

	writeFileSync(numberedPath, content, "utf8");
	writeFileSync(latestPath, content, "utf8");

	// Update state
	const relativePath = `checkpoints/${checkpointNumber}.md`;
	state.checkpoints.push(relativePath);

	// Persist state to session.json
	const sessionJsonPath = join(sessionDir, "session.json");
	writeFileSync(sessionJsonPath, JSON.stringify(state, null, 2), "utf8");

	return state;
}

// ---------------------------------------------------------------------------
// Compact Decision Ledger
// ---------------------------------------------------------------------------

/**
 * Produce a compact decision ledger string from current session state.
 * Used at ~50% context pressure to maintain a minimal summary that can be
 * injected into session context without consuming excessive tokens.
 *
 * Returns a short-form text (no Markdown headings) suitable for inline use.
 */
export function compactDecisionLedger(state: SessionState): string {
	const lines: string[] = [];

	lines.push(`Goal: ${state.goal}`);
	lines.push(`Tier: ${state.currentTier}`);

	if (state.acceptedDecisions.length > 0) {
		lines.push(`Decisions: ${state.acceptedDecisions.join("; ")}`);
	}

	if (state.durableScoutFindings.length > 0) {
		lines.push(`Findings: ${state.durableScoutFindings.join("; ")}`);
	}

	if (state.scoutGaps.length > 0) {
		lines.push(`Gaps: ${state.scoutGaps.join("; ")}`);
	}

	if (state.nextQuestion) {
		lines.push(`Next: ${state.nextQuestion}`);
	}

	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Grill Respawn
// ---------------------------------------------------------------------------

/**
 * Perform a Grill Respawn: produce a fresh continuation state seeded from the
 * latest checkpoint. Preserves accumulated knowledge, tier, and next question.
 * Resets context pressure to 0 (fresh context window).
 *
 * Requires that at least one checkpoint has been created.
 * Mutates and returns the state.
 */
export function performGrillRespawn(state: SessionState, _cwd: string, _sessionId: string): SessionState {
	// Reset context pressure (fresh session context)
	state.contextPressure = 0;

	// Increment respawn counter
	state.respawnCount = (state.respawnCount ?? 0) + 1;

	// Preserve: id, goal, currentTier, nextQuestion, acceptedDecisions,
	// durableScoutFindings, scoutGaps, userAcceptedAssumptions, glossaryDeltas,
	// adrCandidates, contractArtifacts, checkpoints
	// Reset: scoutGates (no longer in context), currentDecision, handoffReady
	state.scoutGates = [];
	state.currentDecision = null;
	state.handoffReady = false;

	return state;
}

// ---------------------------------------------------------------------------
// Respawn Status Event
// ---------------------------------------------------------------------------

/**
 * Render a compact Respawn Status Event string for Scout Room display.
 * Shows: checkpoint created, fresh continuation, tier preserved, next question.
 */
export function renderRespawnStatusEvent(state: SessionState): string {
	const cpRef = state.checkpoints.length > 0
		? state.checkpoints[state.checkpoints.length - 1]
		: "none";
	const lines: string[] = [
		`Grill Respawn #${state.respawnCount ?? 1} — continued from checkpoint (${cpRef})`,
		`Tier preserved: ${state.currentTier}`,
		`Next question: ${state.nextQuestion ?? "none"}`,
	];
	return lines.join(" | ");
}

// ---------------------------------------------------------------------------
// Scout Room Summary
// ---------------------------------------------------------------------------

export interface ScoutRoomSummaryOptions {
	expanded: boolean;
}

/**
 * Render a Scout Room Summary for display.
 *
 * Compact mode shows: tier, current decision, active gate id, selected scouts,
 * verdict placeholders, context pressure, handoff readiness.
 *
 * Expanded mode additionally shows: all trigger boolean fields and budget action.
 *
 * Follows the compact/expanded rendering pattern from subagents.ts renderResult.
 */
export function renderScoutRoomSummary(
	state: SessionState,
	options: ScoutRoomSummaryOptions,
): string {
	const activeGate = state.scoutGates.length > 0
		? state.scoutGates[state.scoutGates.length - 1]
		: null;

	const lines: string[] = [];

	// Header
	lines.push("Scout Room Summary");
	lines.push("");

	// Core fields (always shown)
	lines.push(`Tier: ${state.currentTier}`);
	lines.push(`Decision: ${state.currentDecision ?? "none"}`);
	lines.push(`Active Gate: ${activeGate ? activeGate.id : "none"}`);

	// Selected scouts and verdicts
	if (activeGate && activeGate.selectedScoutProfiles.length > 0) {
		const scoutList = activeGate.selectedScoutProfiles.join(", ");
		lines.push(`Scouts: ${scoutList}`);

		// Show actual verdicts from findings/gaps, or "pending" if not yet resolved
		const verdictParts: string[] = [];
		for (const profile of activeGate.selectedScoutProfiles) {
			const finding = state.durableScoutFindings.find(f => f.startsWith(`${profile}:`));
			const gap = state.scoutGaps.find(g => g.includes(` ${profile}:`));
			if (finding) {
				// Extract verdict keyword from finding (format: "profile: verdict — ...")
				const match = finding.match(/^[^:]+:\s*(\S+)/);
				verdictParts.push(match ? match[1] : "done");
			} else if (gap) {
				verdictParts.push("GAP");
			} else {
				verdictParts.push("pending");
			}
		}
		lines.push(`Verdicts: ${verdictParts.join(", ")}`);
	} else {
		lines.push("Scouts: none");
		lines.push("Verdicts: none");
	}

	// Durable findings (always shown if present)
	if (state.durableScoutFindings.length > 0) {
		lines.push("");
		lines.push("Findings:");
		for (const f of state.durableScoutFindings) {
			lines.push(`  - ${f}`);
		}
	}

	// Scout Gaps (always shown if present)
	if (state.scoutGaps.length > 0) {
		lines.push("");
		lines.push("Scout Gaps:");
		for (const g of state.scoutGaps) {
			lines.push(`  - ${g}`);
		}
	}

	// Context pressure and handoff
	lines.push(`Context Pressure: ${state.contextPressure}`);
	lines.push(`Handoff Ready: ${state.handoffReady ? "yes" : "no"}`);

	// Respawn status (compact: one-liner; expanded: with checkpoint details)
	if (state.respawnCount && state.respawnCount > 0) {
		lines.push(`Respawn: #${state.respawnCount} (tier: ${state.currentTier}, next: ${state.nextQuestion ?? "none"})`);
	}

	// Expanded: trigger fields and budget action
	if (options.expanded && activeGate) {
		lines.push("");
		lines.push("Trigger Fields:");
		lines.push(`  crossesBoundary: ${activeGate.crossesBoundary}`);
		lines.push(`  changesContractOrState: ${activeGate.changesContractOrState}`);
		lines.push(`  introducesLifecycle: ${activeGate.introducesLifecycle}`);
		lines.push(`  hasRuntimeRisk: ${activeGate.hasRuntimeRisk}`);
		lines.push(`  hasUnverifiedLayerAssumption: ${activeGate.hasUnverifiedLayerAssumption}`);
		lines.push(`  hasMeaningfulFailureCost: ${activeGate.hasMeaningfulFailureCost}`);
		lines.push("");
		lines.push(`Budget Action: ${activeGate.budgetAction}`);
	}

	// Expanded: checkpoint details (expandable, not in compact summary)
	if (options.expanded && state.checkpoints.length > 0) {
		lines.push("");
		lines.push("Checkpoints:");
		for (const cp of state.checkpoints) {
			lines.push(`  - ${cp}`);
		}
	}

	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Record Scout Result
// ---------------------------------------------------------------------------

export interface RecordScoutResultInput {
	cwd: string;
	sessionId: string;
	gateId: string;
	profileName: string;
	rawOutput: string;
	/** Optional tool calls from the scout's child session for deriving inspected paths. */
	toolCalls?: Array<{ name: string; args: unknown }>;
}

export interface ScoutResultRecord {
	gateId: string;
	profileName: string;
	verdict: ScoutVerdict | null;
	outputPath: string;
	finding: string | null;
	gap: string | null;
	/** Tool-verified inspected paths derived from the scout's tool calls. */
	inspectedPaths: InspectedPath[];
	/** Claimed anchors parsed from the verdict (comma-separated → string[]). */
	claimedAnchors: string[];
}

// ---------------------------------------------------------------------------
// Parse Claimed Anchors
// ---------------------------------------------------------------------------

/**
 * Split a comma-separated "Claimed anchors" string into a trimmed string array.
 * Returns empty array for "none" or empty input.
 */
export function parseClaimedAnchors(raw: string): string[] {
	const trimmed = raw.trim();
	if (!trimmed || trimmed.toLowerCase() === "none") return [];
	return trimmed.split(",").map(s => s.trim()).filter(s => s.length > 0);
}

/**
 * Record a scout result: persist output, parse verdict, extract finding or gap.
 *
 * If the verdict parses successfully → produces a Durable Scout Finding (one-liner).
 * If the verdict is unusable (null) → produces a Scout Gap.
 *
 * The full output is always persisted to disk (for debugging/audit).
 * Returns a ScoutResultRecord with all extracted information including
 * inspectedPaths (from toolCalls) and claimedAnchors (from verdict).
 */
export function recordScoutResult(input: RecordScoutResultInput): ScoutResultRecord {
	const { cwd, sessionId, gateId, profileName, rawOutput, toolCalls } = input;

	// Always persist full output
	const outputPath = persistScoutOutput({ cwd, sessionId, gateId, profileName, rawOutput });

	// Parse verdict
	const verdict = parseScoutVerdict(rawOutput);

	// Derive inspected paths from tool calls
	const inspectedPaths = toolCalls ? deriveInspectedPaths(toolCalls) : [];

	// Parse claimed anchors from verdict
	const claimedAnchors = verdict ? parseClaimedAnchors(verdict.claimedAnchors) : [];

	let finding: string | null = null;
	let gap: string | null = null;

	if (verdict) {
		// Extract durable finding: compact one-liner
		finding = `${profileName}: ${verdict.verdict} — ${verdict.confidence}` +
			(verdict.concern !== "none" ? ` | concern: ${verdict.concern}` : "") +
			(verdict.evidence !== "not found" ? ` | evidence: ${verdict.evidence}` : "");
	} else {
		// Unusable output → Scout Gap
		gap = recordScoutGap({ gateId, profileName, reason: "unusable" });
	}

	return { gateId, profileName, verdict, outputPath, finding, gap, inspectedPaths, claimedAnchors };
}

// ---------------------------------------------------------------------------
// Record Scout Gap
// ---------------------------------------------------------------------------

export interface RecordScoutGapInput {
	gateId: string;
	profileName: string;
	reason: "timeout" | "failed" | "skipped" | "unusable";
	detail?: string;
}

/**
 * Produce a Scout Gap string for a failed/timed-out/skipped/unusable scout.
 * Format: "[<gateId>] <profile>: <reason>" with optional detail suffix.
 */
export function recordScoutGap(input: RecordScoutGapInput): string {
	const { gateId, profileName, reason, detail } = input;
	let gap = `[${gateId}] ${profileName}: ${reason}`;
	if (detail) {
		gap += ` — ${detail}`;
	}
	return gap;
}

// ---------------------------------------------------------------------------
// Update Handoff
// ---------------------------------------------------------------------------

/**
 * Re-render handoff.md with current session state (findings, gaps, decisions).
 * Overwrites the existing handoff.md in the session directory.
 */
export function updateHandoff(state: SessionState, cwd: string, sessionId: string): void {
	const sessionDir = join(cwd, ARTIFACT_ROOT, "sessions", sessionId);
	const handoffPath = join(sessionDir, "handoff.md");

	const lines: string[] = [];

	lines.push("# Handoff");
	lines.push("");
	lines.push(`**Goal**: ${state.goal}`);
	lines.push(`**Session**: ${state.id}`);
	lines.push(`**Status**: ${state.handoffReady ? "Ready" : "In progress"}`);
	lines.push("");

	// Decisions
	lines.push("## Decisions");
	lines.push("");
	if (state.acceptedDecisions.length > 0) {
		for (const d of state.acceptedDecisions) lines.push(`- ${d}`);
	} else {
		lines.push("_No decisions accepted yet._");
	}
	lines.push("");

	// Scout Findings
	lines.push("## Scout Findings");
	lines.push("");
	if (state.durableScoutFindings.length > 0) {
		for (const f of state.durableScoutFindings) lines.push(`- ${f}`);
	} else {
		lines.push("_No scout findings yet._");
	}
	lines.push("");

	// Scout Gaps
	lines.push("## Scout Gaps");
	lines.push("");
	if (state.scoutGaps.length > 0) {
		for (const g of state.scoutGaps) lines.push(`- ${g}`);
	} else {
		lines.push("_No scout gaps._");
	}
	lines.push("");

	// Next Steps
	lines.push("## Next Steps");
	lines.push("");
	if (state.nextQuestion) {
		lines.push(`- Next question: ${state.nextQuestion}`);
	} else if (state.handoffReady) {
		lines.push("_Handoff ready — session complete._");
	} else {
		lines.push("_Continuing session._");
	}
	lines.push("");

	writeFileSync(handoffPath, lines.join("\n"), "utf8");
}

// ---------------------------------------------------------------------------
// Execute Scout Gate
// ---------------------------------------------------------------------------

/**
 * A function that runs a single scout and returns its raw output.
 * Injected as a dependency for testability.
 */
export type RunScoutFn = (prompt: string, profileName: string) => Promise<string>;

export interface ExecuteScoutGateInput {
	state: SessionState;
	gate: ScoutGate;
	cwd: string;
	checkpointContent: string;
	anchors: string[];
	runScout: RunScoutFn;
}

export interface ExecuteScoutGateResult {
	results: ScoutResultRecord[];
	findings: string[];
	gaps: string[];
	updatedState: SessionState;
}

/**
 * Orchestrate full scout execution for a Scout Gate.
 *
 * For each selected scout profile:
 * 1. Loads the profile (falls back to a minimal stub if unavailable)
 * 2. Builds a compact prompt
 * 3. Invokes the runScout function (injected for testability)
 * 4. Records the result (persist output, extract finding or gap)
 *
 * After all scouts complete, updates state with findings/gaps,
 * re-renders handoff.md, and persists session.json.
 *
 * Returns the full set of results plus the updated state.
 */
export async function executeScoutGate(input: ExecuteScoutGateInput): Promise<ExecuteScoutGateResult> {
	const { state, gate, cwd, checkpointContent, anchors, runScout } = input;

	const results: ScoutResultRecord[] = [];
	const findings: string[] = [];
	const gaps: string[] = [];

	for (const profileName of gate.selectedScoutProfiles) {
		// Load profile (or use minimal stub)
		const profile = loadScoutProfile(profileName) ?? {
			name: profileName,
			description: `${profileName} scout`,
			scope: `${profileName} layer concerns`,
			triggerFit: "general",
			evidenceRequirements: "file paths with line ranges",
			verdictFormat: "standard",
			forbiddenBehaviors: "Do not modify source code.",
			body: `Investigate ${profileName} aspects of the decision.`,
		};

		// Build prompt
		const prompt = buildScoutPrompt({
			profile,
			checkpointContent,
			decision: gate.decisionUnderReview,
			anchors,
		});

		try {
			// Execute scout
			const rawOutput = await runScout(prompt, profileName);

			// Record result (persist + parse + extract finding/gap)
			const result = recordScoutResult({
				cwd,
				sessionId: state.id,
				gateId: gate.id,
				profileName,
				rawOutput,
			});

			results.push(result);
			if (result.finding) findings.push(result.finding);
			if (result.gap) gaps.push(result.gap);
		} catch (error) {
			// Scout failed (timeout, crash, etc.) → record gap
			const reason = error instanceof Error && error.message.toLowerCase().includes("timeout")
				? "timeout" as const
				: "failed" as const;
			const detail = error instanceof Error ? error.message : String(error);
			const gap = recordScoutGap({ gateId: gate.id, profileName, reason, detail });
			gaps.push(gap);

			// Still produce a result record (with null verdict)
			results.push({
				gateId: gate.id,
				profileName,
				verdict: null,
				outputPath: "",
				finding: null,
				gap,
				inspectedPaths: [],
				claimedAnchors: [],
			});
		}
	}

	// Update state
	for (const f of findings) state.durableScoutFindings.push(f);
	for (const g of gaps) state.scoutGaps.push(g);

	// Persist session.json
	const sessionDir = join(cwd, ARTIFACT_ROOT, "sessions", state.id);
	const sessionJsonPath = join(sessionDir, "session.json");
	writeFileSync(sessionJsonPath, JSON.stringify(state, null, 2), "utf8");

	// Update handoff
	updateHandoff(state, cwd, state.id);

	return { results, findings, gaps, updatedState: state };
}

// ---------------------------------------------------------------------------
// Scout Prompt Builder
// ---------------------------------------------------------------------------

export interface BuildScoutPromptInput {
	profile: ScoutProfile;
	checkpointContent: string;
	decision: string;
	anchors: string[];
}

/**
 * Build a compact, stateless prompt for a scout subagent.
 * Assembles: profile scope, checkpoint context, decision under review,
 * known anchors, investigation protocol, and required verdict format.
 */
export function buildScoutPrompt(input: BuildScoutPromptInput): string {
	const { profile, checkpointContent, decision, anchors } = input;

	const lines: string[] = [];

	// Role and scope
	lines.push(`You are the ${profile.name} scout. Your scope: ${profile.scope}`);
	lines.push("");

	// Decision under review
	lines.push("## Decision Under Review");
	lines.push("");
	lines.push(decision);
	lines.push("");

	// Current checkpoint context
	lines.push("## Current Checkpoint");
	lines.push("");
	lines.push(checkpointContent);
	lines.push("");

	// Known anchors
	lines.push("## Known Anchors");
	lines.push("");
	if (anchors.length > 0) {
		lines.push(anchors.join(", "));
	} else {
		lines.push("none");
	}
	lines.push("");

	// Investigation protocol from profile body
	lines.push("## Investigation Protocol");
	lines.push("");
	lines.push(profile.body);
	lines.push("");

	// Forbidden behaviors
	lines.push("## Constraints");
	lines.push("");
	lines.push(profile.forbiddenBehaviors);
	lines.push("");

	// Required verdict format
	lines.push("## Required Verdict Format");
	lines.push("");
	lines.push("You MUST end your response with exactly these fields:");
	lines.push("");
	lines.push("```");
	lines.push("Verdict: viable | risky | blocked | needs-decision");
	lines.push("Evidence: <specific files/docs/patterns, or \"not found\">");
	lines.push("Concern: <one concrete issue, or \"none\">");
	lines.push("Required decision: <one question for the Lead Griller to ask, or \"none\">");
	lines.push("Claimed anchors: <symbols/contracts/events/state names, or \"none\">");
	lines.push("Confidence: verified | partial | unverified");
	lines.push("```");

	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Scout Output Persistence
// ---------------------------------------------------------------------------

export interface PersistScoutOutputInput {
	cwd: string;
	sessionId: string;
	gateId: string;
	profileName: string;
	rawOutput: string;
}

/**
 * Persist full scout output to the session's scouts/ directory.
 * File pattern: sessions/<session-id>/scouts/<gate-id>-<profile>.md
 *
 * Creates the scouts/ directory if needed.
 * Returns the absolute path to the written file.
 */
export function persistScoutOutput(input: PersistScoutOutputInput): string {
	const { cwd, sessionId, gateId, profileName, rawOutput } = input;
	const sessionDir = join(cwd, ARTIFACT_ROOT, "sessions", sessionId);
	const scoutsDir = join(sessionDir, "scouts");
	mkdirSync(scoutsDir, { recursive: true });

	const filename = `${gateId}-${profileName}.md`;
	const filePath = join(scoutsDir, filename);
	writeFileSync(filePath, rawOutput, "utf8");

	return filePath;
}

// ---------------------------------------------------------------------------
// Scout Profile Loading
// ---------------------------------------------------------------------------

/** MCP config file structure (minimal, for profile resolution). */
interface McpConfigFile {
	mcpServers?: Record<string, { command?: string; args?: string[] }>;
}

/** Cache for loaded scout profiles. */
const scoutProfileCache = new Map<string, ScoutProfile | undefined>();

/** Resolved repo root for the engineering-skills MCP (cached). */
let resolvedRepoRoot: string | null | undefined; // undefined=not resolved yet, null=not found

/**
 * Parse simple YAML frontmatter from a Markdown file.
 * Returns { data, content } where data is a key-value map and content is the body.
 */
function parseProfileFrontmatter(raw: string): { data: Record<string, string>; content: string } {
	const data: Record<string, string> = {};
	if (!raw.startsWith("---")) return { data, content: raw };

	const endIdx = raw.indexOf("\n---", 3);
	if (endIdx === -1) return { data, content: raw };

	const frontBlock = raw.slice(4, endIdx); // skip leading ---\n
	const body = raw.slice(endIdx + 4).replace(/^\r?\n/, ""); // skip closing ---\n

	for (const line of frontBlock.split("\n")) {
		const colonIdx = line.indexOf(":");
		if (colonIdx === -1) continue;
		const key = line.slice(0, colonIdx).trim();
		let value = line.slice(colonIdx + 1).trim();
		// Strip surrounding quotes
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		if (key) data[key] = value;
	}

	return { data, content: body };
}

/**
 * Resolve the Engineering Skills MCP repo root from the global MCP config.
 * Looks for the `engineering-skills` server entry, reads its `args[0]` (dist/index.js path),
 * and derives the repo root.
 */
function resolveEngineeringSkillsRepoRoot(): string | null {
	if (resolvedRepoRoot !== undefined) return resolvedRepoRoot;

	const GLOBAL_MCP_CONFIG = join(homedir(), ".config", "mcp", "mcp.json");
	const candidates = [
		GLOBAL_MCP_CONFIG,
		join(homedir(), ".pi", "agent", "mcp.json"),
	];

	for (const configPath of candidates) {
		if (!existsSync(configPath)) continue;
		try {
			const raw = readFileSync(configPath, "utf8");
			const config: McpConfigFile = JSON.parse(raw);
			const serverEntry = config.mcpServers?.["engineering-skills"];
			if (!serverEntry?.args?.[0]) continue;

			// args[0] is the dist/index.js path — derive repo root
			// Normalize to forward slashes for path operations
			const distIndexPath = serverEntry.args[0].replace(/\\/g, "/");
			// Go up from dist/index.js → dist → repo root
			const repoRoot = dirname(dirname(distIndexPath));
			if (existsSync(join(repoRoot, "scouts"))) {
				resolvedRepoRoot = repoRoot;
				return repoRoot;
			}
		} catch {
			// Malformed config, skip
		}
	}

	resolvedRepoRoot = null;
	return null;
}

/**
 * Load a Scout Profile by name from the Engineering Skills MCP configured repo.
 * Uses filesystem access to the MCP server's repo (resolved from mcp.json args[0]).
 *
 * Profiles live at `<repo-root>/scouts/<name>/PROFILE.md` with YAML frontmatter.
 *
 * Returns undefined if the profile is not found or the MCP is not configured.
 * Results are cached for the process lifetime.
 */
export function loadScoutProfile(profileName: string): ScoutProfile | undefined {
	if (scoutProfileCache.has(profileName)) {
		return scoutProfileCache.get(profileName);
	}

	const repoRoot = resolveEngineeringSkillsRepoRoot();
	if (!repoRoot) {
		scoutProfileCache.set(profileName, undefined);
		return undefined;
	}

	const profilePath = join(repoRoot, "scouts", profileName, "PROFILE.md");
	if (!existsSync(profilePath)) {
		scoutProfileCache.set(profileName, undefined);
		return undefined;
	}

	try {
		const raw = readFileSync(profilePath, "utf8");
		const { data, content } = parseProfileFrontmatter(raw);

		const profile: ScoutProfile = {
			name: data["name"] ?? profileName,
			description: data["description"] ?? "",
			scope: data["scope"] ?? "",
			triggerFit: data["trigger-fit"] ?? "",
			evidenceRequirements: data["evidence-requirements"] ?? "",
			verdictFormat: data["verdict-format"] ?? "",
			forbiddenBehaviors: data["forbidden-behaviors"] ?? "",
			body: content.trim(),
		};

		scoutProfileCache.set(profileName, profile);
		return profile;
	} catch {
		scoutProfileCache.set(profileName, undefined);
		return undefined;
	}
}

// ---------------------------------------------------------------------------
// Scout Verdict Parsing
// ---------------------------------------------------------------------------

const VALID_VERDICTS = new Set(["viable", "risky", "blocked", "needs-decision"]);
const VALID_CONFIDENCE = new Set(["verified", "partial", "unverified"]);

/**
 * Extract a structured ScoutVerdict from raw scout output text.
 * The scout is expected to produce lines matching:
 *   Verdict: <value>
 *   Evidence: <value>
 *   Concern: <value>
 *   Required decision: <value>
 *   Claimed anchors: <value>
 *   Confidence: <value>
 *
 * Returns null if the output doesn't contain a valid complete verdict.
 */
export function parseScoutVerdict(rawOutput: string): ScoutVerdict | null {
	const lines = rawOutput.split("\n");

	let verdict: string | undefined;
	let evidence: string | undefined;
	let concern: string | undefined;
	let requiredDecision: string | undefined;
	let claimedAnchors: string | undefined;
	let confidence: string | undefined;

	for (const line of lines) {
		const trimmed = line.trim();
		const extractField = (prefix: string): string | undefined => {
			if (trimmed.toLowerCase().startsWith(prefix.toLowerCase())) {
				return trimmed.slice(prefix.length).trim();
			}
			return undefined;
		};

		const v = extractField("Verdict:");
		if (v !== undefined) { verdict = v; continue; }

		const e = extractField("Evidence:");
		if (e !== undefined) { evidence = e; continue; }

		const c = extractField("Concern:");
		if (c !== undefined) { concern = c; continue; }

		const rd = extractField("Required decision:");
		if (rd !== undefined) { requiredDecision = rd; continue; }

		const ca = extractField("Claimed anchors:");
		if (ca !== undefined) { claimedAnchors = ca; continue; }

		const conf = extractField("Confidence:");
		if (conf !== undefined) { confidence = conf; continue; }
	}

	// All fields must be present
	if (
		verdict === undefined ||
		evidence === undefined ||
		concern === undefined ||
		requiredDecision === undefined ||
		claimedAnchors === undefined ||
		confidence === undefined
	) {
		return null;
	}

	// Validate enum values
	if (!VALID_VERDICTS.has(verdict)) return null;
	if (!VALID_CONFIDENCE.has(confidence)) return null;

	return {
		verdict: verdict as ScoutVerdict["verdict"],
		evidence,
		concern,
		requiredDecision,
		claimedAnchors,
		confidence: confidence as ScoutVerdict["confidence"],
	};
}

// ---------------------------------------------------------------------------
// Mark Handoff Ready
// ---------------------------------------------------------------------------

/**
 * Mark the session state as handoff-ready.
 * Mutates and returns the same state object.
 * Reflected in renderScoutRoomSummary ("Handoff Ready: yes").
 */
export function markHandoffReady(state: SessionState): SessionState {
	state.handoffReady = true;
	return state;
}

// ---------------------------------------------------------------------------
// Render Final Scout-Grounded Handoff
// ---------------------------------------------------------------------------

/**
 * Render the final Scout-Grounded Handoff Markdown.
 *
 * Uses exact normative section headings consumable by `to-prd` Delta Verification.
 * Includes: accepted decisions, user-accepted assumptions, Scout Gates,
 * Durable Scout Findings, Scout Gaps, tool-verified inspected paths,
 * scout-claimed anchors, verification status by area, Delta Verification
 * instructions, do-not-reopen decisions.
 */
export function renderFinalHandoff(
	state: SessionState,
	areaVerifications: AreaVerification[],
): string {
	const lines: string[] = [];

	lines.push("# Scout-Grounded Handoff");
	lines.push("");
	lines.push(`**Goal**: ${state.goal}`);
	lines.push(`**Session**: ${state.id}`);
	lines.push(`**Status**: ${state.handoffReady ? "Ready" : "In progress"}`);
	lines.push(`**Created**: ${state.createdAt}`);
	lines.push("");

	// Accepted Decisions
	lines.push("## Accepted Decisions");
	lines.push("");
	if (state.acceptedDecisions.length > 0) {
		for (const d of state.acceptedDecisions) lines.push(`- ${d}`);
	} else {
		lines.push("_None._");
	}
	lines.push("");

	// User-Accepted Assumptions
	lines.push("## User-Accepted Assumptions");
	lines.push("");
	if (state.userAcceptedAssumptions.length > 0) {
		for (const a of state.userAcceptedAssumptions) lines.push(`- ${a}`);
	} else {
		lines.push("_None._");
	}
	lines.push("");

	// Scout Gates
	lines.push("## Scout Gates");
	lines.push("");
	if (state.scoutGates.length > 0) {
		for (const gate of state.scoutGates) {
			lines.push(`- **${gate.id}** (${gate.tier}): ${gate.decisionUnderReview} [→ ${gate.budgetAction}]`);
		}
	} else {
		lines.push("_None._");
	}
	lines.push("");

	// Durable Scout Findings
	lines.push("## Durable Scout Findings");
	lines.push("");
	if (state.durableScoutFindings.length > 0) {
		for (const f of state.durableScoutFindings) lines.push(`- ${f}`);
	} else {
		lines.push("_None._");
	}
	lines.push("");

	// Scout Gaps
	lines.push("## Scout Gaps");
	lines.push("");
	if (state.scoutGaps.length > 0) {
		for (const g of state.scoutGaps) lines.push(`- ${g}`);
	} else {
		lines.push("_None._");
	}
	lines.push("");

	// Verification Status by Area
	lines.push("## Verification Status by Area");
	lines.push("");
	if (areaVerifications.length > 0) {
		for (const av of areaVerifications) {
			lines.push(`### Area: ${av.area}`);
			lines.push("");
			lines.push(`**Verification status**: ${av.status}`);
			lines.push("");

			// Tool-verified paths
			lines.push("**Tool-verified paths**:");
			if (av.toolVerifiedPaths.length > 0) {
				for (const p of av.toolVerifiedPaths) {
					lines.push(`- ${p.path} (${p.tool}, ${p.kind})`);
				}
			} else {
				lines.push("- _none_");
			}
			lines.push("");

			// Scout-claimed anchors
			lines.push("**Scout-claimed anchors**:");
			if (av.scoutClaimedAnchors.length > 0) {
				for (const a of av.scoutClaimedAnchors) {
					lines.push(`- ${a}`);
				}
			} else {
				lines.push("- _none_");
			}
			lines.push("");
		}
	} else {
		lines.push("_No area verifications computed._");
		lines.push("");
	}

	// Delta Verification Instructions
	lines.push("## Delta Verification Instructions");
	lines.push("");
	lines.push("Instructions for `to-prd` Delta Verification per area:");
	lines.push("");
	if (areaVerifications.length > 0) {
		for (const av of areaVerifications) {
			lines.push(`- **${av.area}** (${av.status}): ${av.deltaInstruction}`);
		}
	} else {
		lines.push("_No areas to verify._");
	}
	lines.push("");
	lines.push("**Contradiction rule**: If tool-verified paths contradict scout-claimed anchors, stop PRD generation and report repair needed.");
	lines.push("");

	// Do-Not-Reopen Decisions
	lines.push("## Do-Not-Reopen Decisions");
	lines.push("");
	lines.push("The following decisions are accepted and should not be reopened unless Delta Verification reveals a contradiction:");
	lines.push("");
	if (state.acceptedDecisions.length > 0) {
		for (const d of state.acceptedDecisions) lines.push(`- ${d}`);
	} else {
		lines.push("_None._");
	}
	lines.push("");

	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Write Final Handoff
// ---------------------------------------------------------------------------

/**
 * Write the final Scout-Grounded Handoff to disk.
 *
 * - Overwrites `handoff.md` in the session directory with the final rendering.
 * - Overwrites `latest-handoff.md` at ARTIFACT_ROOT with the same content.
 */
export function writeFinalHandoff(
	state: SessionState,
	cwd: string,
	sessionId: string,
	areaVerifications: AreaVerification[],
): void {
	const content = renderFinalHandoff(state, areaVerifications);

	const sessionDir = join(cwd, ARTIFACT_ROOT, "sessions", sessionId);
	const handoffPath = join(sessionDir, "handoff.md");
	writeFileSync(handoffPath, content, "utf8");

	const latestHandoffPath = join(cwd, ARTIFACT_ROOT, "latest-handoff.md");
	writeFileSync(latestHandoffPath, content, "utf8");
}
