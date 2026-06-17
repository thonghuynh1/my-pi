import type { IssueTaskPacket } from "./issue-task-extractor.ts";

export type { IssueTaskPacket } from "./issue-task-extractor.ts";

// ---------------------------------------------------------------------------
// PairRunState — canonical coordinator-owned run state (DEC-004, DEC-005)
// ---------------------------------------------------------------------------

/** Proof class for an acceptance criterion — structural, runtime, or mixed. */
export type ProofClass = "structural" | "runtime" | "mixed";

/** One acceptance criterion extracted from Navigator preflight. */
export interface AcceptanceCriterion {
	text: string;
	proofClass: ProofClass;
}

/** Narrow amendment kinds (DEC-010). */
export type AmendmentKind =
	| "contradiction"
	| "ambiguity"
	| "implied_missing_requirement"
	| "safety_verification_gap";

/** One amendment record — Navigator may only amend within the narrow envelope. */
export interface Amendment {
	kind: AmendmentKind;
	description: string;
	accepted: boolean;
}

/** Compact evidence record produced by the Driver each cycle. */
export interface Evidence {
	cycleNumber: number;
	summary: string;
}

/** A loaded pstack leaf skill. */
export interface LoadedLeaf {
	name: string;
}

/** A skipped playbook step with rationale. */
export interface SkippedStep {
	step: string;
	reason: string;
}

/** Sanitized telemetry summary from a Navigator verification phase. */
export interface PairTelemetrySummary {
	phase: string;
	summary: string;
}

/** Non-blocking discovery preserved as a follow-up. */
export interface FollowUp {
	description: string;
}

/**
 * Canonical coordinator-owned run state.
 * Pinned by Navigator preflight and frozen by the coordinator (DEC-005).
 */
export interface PairRunState {
	task: string;
	taskFile?: { path: string; extractedPacket: IssueTaskPacket };
	endGoalToProve: string;
	acceptanceChecklist: AcceptanceCriterion[];
	initialPlaybookRecommendation: string;
	activePlaybook: string;
	playbookOverrideReason?: string;
	loadedLeaves: LoadedLeaf[];
	skippedPlaybookSteps: SkippedStep[];
	driverStartupCompleted: boolean;
	allowedAmendments: Amendment[];
	driverEvidence: Evidence[];
	navigatorVerificationTelemetry: PairTelemetrySummary[];
	followUps: FollowUp[];
	currentCycle: number;
	initialWorkspace?: WorkspaceSnapshot;
}

/** Create the initial (empty) PairRunState for a new run. */
export function createInitialPairRunState(
	task: string,
	taskFile?: { path: string; extractedPacket: IssueTaskPacket },
): PairRunState {
	return {
		task,
		taskFile,
		endGoalToProve: "",
		acceptanceChecklist: [],
		initialPlaybookRecommendation: "",
		activePlaybook: "",
		loadedLeaves: [],
		skippedPlaybookSteps: [],
		driverStartupCompleted: false,
		allowedAmendments: [],
		driverEvidence: [],
		navigatorVerificationTelemetry: [],
		followUps: [],
		currentCycle: 1,
	};
}

// ---------------------------------------------------------------------------
// validatePreflightEndGoal — standalone validation helper
// ---------------------------------------------------------------------------

export interface EndGoalValidationResult {
	valid: boolean;
	reason?: string;
}

/**
 * Validate the Navigator's End Goal To Prove text.
 *
 * - Always: must be non-empty.
 * - For issue-file tasks (DEC-007): must contain the extracted acceptance
 *   criteria text verbatim (each criterion line must appear in the end goal).
 */
export function validatePreflightEndGoal(
	endGoal: string,
	taskFile?: { path: string; extractedPacket: IssueTaskPacket },
): EndGoalValidationResult {
	if (!endGoal.trim()) {
		return { valid: false, reason: "End Goal To Prove must not be empty." };
	}

	if (taskFile) {
		// DEC-007: verbatim criterion check — each non-empty line of the AC must
		// appear somewhere in the end goal text.
		const acLines = taskFile.extractedPacket.acceptanceCriteria
			.split(/\r?\n/)
			.map((l) => l.replace(/^[-*+]\s+/, "").replace(/^\[.\]\s+/, "").trim())
			.filter((l) => l.length > 0);

		const missing = acLines.filter((line) => !endGoal.includes(line));
		if (missing.length > 0) {
			return {
				valid: false,
				reason:
					`Issue-file-driven End Goal To Prove must copy acceptance criteria verbatim. ` +
					`Missing: ${missing.slice(0, 3).join(" | ")}`,
			};
		}
	}

	return { valid: true };
}

// ---------------------------------------------------------------------------
// buildNavigatorPreflightPromptForState
// ---------------------------------------------------------------------------

/**
 * Build the Navigator preflight prompt from a PairRunState.
 * Includes the task file path and extracted packet when present.
 */
export function buildNavigatorPreflightPromptForState(
	state: PairRunState,
	testCommand: string | undefined,
): string {
	const workspaceSection = state.initialWorkspace
		? `\nWorkspace snapshot at run start:\n${formatWorkspaceSnapshot(state.initialWorkspace)}\n`
		: "";

	let fileSection = "";
	if (state.taskFile) {
		const { path: filePath, extractedPacket: pkt } = state.taskFile;
		fileSection = [
			`\nSource file: ${filePath}`,
			`\n### Acceptance criteria\n${pkt.acceptanceCriteria}`,
			pkt.explicitConstraints.length
				? `\n### Constraints\n${pkt.explicitConstraints.map((c) => `- ${c}`).join("\n")}`
				: "",
			pkt.buildOrWiringNotes.length
				? `\n### Build notes\n${pkt.buildOrWiringNotes.map((n) => `- ${n}`).join("\n")}`
				: "",
			pkt.blockedBy ? `\n### Blocked by\n${pkt.blockedBy}` : "",
		]
			.filter(Boolean)
			.join("");
	}

	return `You are the Navigator Agent for a deterministic Pair Program Tool run.

Task:
${state.task}
${fileSection}
${workspaceSection}
Define the End Goal To Prove, acceptance checklist with proof classes, risks, initial playbook recommendation, and the first Driver cycle objective.

For issue-file-driven tasks, the End Goal To Prove MUST copy the acceptance criteria verbatim.
Each acceptance criterion must be tagged [structural], [runtime], or [mixed].

Return Markdown with these headings:
## End Goal To Prove
## Acceptance Checklist
## Risks
## Initial Playbook Recommendation
## First Cycle Objective`;
}

// ---------------------------------------------------------------------------
// freezePreflightIntoState
// ---------------------------------------------------------------------------

export interface FreezePreflightResult {
	frozenState: PairRunState;
	errors: string[];
}

const VALID_PROOF_CLASSES: ReadonlySet<string> = new Set(["structural", "runtime", "mixed"]);

/**
 * Parse and validate a Navigator preflight response, then freeze the result
 * into coordinator-owned PairRunState (DEC-005).
 *
 * Validation:
 * - End Goal To Prove must be non-empty.
 * - For issue-file tasks, End Goal must contain verbatim acceptance criteria.
 * - Each checklist item must carry a valid proof class.
 * - Initial Playbook Recommendation must be non-empty.
 *
 * Returns the frozen state and any validation error strings.
 * When errors is non-empty, the run should be blocked.
 */
export function freezePreflightIntoState(
	preflightText: string,
	baseState: PairRunState,
): FreezePreflightResult {
	const errors: string[] = [];

	// Extract End Goal To Prove
	const endGoalRaw = extractHeadingBody(preflightText, "End Goal To Prove") ?? "";
	const endGoal = endGoalRaw.trim();

	// Validate end goal
	const endGoalResult = validatePreflightEndGoal(endGoal, baseState.taskFile);
	if (!endGoalResult.valid) {
		errors.push(endGoalResult.reason ?? "End Goal To Prove is invalid.");
	}

	// Extract and parse Acceptance Checklist
	const checklistRaw = extractHeadingBody(preflightText, "Acceptance Checklist") ?? "";
	const acceptanceChecklist = parseAcceptanceChecklist(checklistRaw, errors);

	// Extract Initial Playbook Recommendation
	const playbookRaw = extractHeadingBody(preflightText, "Initial Playbook Recommendation") ?? "";
	const playbook = playbookRaw.trim();
	if (!playbook) {
		errors.push("Initial Playbook Recommendation must not be empty.");
	}

	const frozenState: PairRunState = {
		...baseState,
		endGoalToProve: endGoal,
		acceptanceChecklist,
		initialPlaybookRecommendation: playbook,
		activePlaybook: playbook,
	};

	return { frozenState, errors };
}

function parseAcceptanceChecklist(raw: string, errors: string[]): AcceptanceCriterion[] {
	if (!raw.trim()) return [];
	const items: AcceptanceCriterion[] = [];
	for (const line of raw.split(/\r?\n/)) {
		const stripped = line
			.replace(/^[-*+]\s+/, "")
			.replace(/^\[.\]\s+/, "")
			.trim();
		if (!stripped) continue;

		// Extract proof class tag: [structural], [runtime], or [mixed]
		const tagMatch = /\[(structural|runtime|mixed|[a-z_]+)\]\s*$/.exec(stripped);
		if (!tagMatch) {
			// Item has no tag — skip silently (may be a heading line or note)
			continue;
		}

		const proofClassRaw = tagMatch[1];
		const text = stripped.slice(0, tagMatch.index).trim().replace(/\.\s*$/, "") + ".";

		if (!VALID_PROOF_CLASSES.has(proofClassRaw)) {
			errors.push(`Invalid proof class "${proofClassRaw}" for criterion: ${text}`);
			continue;
		}

		items.push({ text, proofClass: proofClassRaw as ProofClass });
	}
	return items;
}

export interface PairRunMemory {
	task: string;
	acceptedConstraints: string[];
	unresolvedRisks: string[];
	currentCycle: number;
	currentObjective: string | null;
	acceptanceChecklistText: string | null;
	lastDriverReport: string | null;
	lastNavigatorReview: string | null;
	evidenceSummaries: string[];
	initialWorkspace?: WorkspaceSnapshot;
}

export type PairRuntimeStatus = "success" | "blocked" | "incomplete";

export type NavigatorDecisionValue = "approve_next" | "request_revision" | "blocked" | "final_approve";

export type NavigatorDecision =
	| { kind: "valid"; value: NavigatorDecisionValue }
	| { kind: "malformed"; reason: string };

export interface PairProtocolSessions {
	navigatorPreflight(prompt: string): Promise<string>;
	driverCycle(prompt: string): Promise<string>;
	navigatorReview(prompt: string): Promise<string>;
	navigatorDecisionRepair(prompt: string): Promise<string>;
	driverCorrection(prompt: string): Promise<string>;
	navigatorClarification?(prompt: string): Promise<string>;
	/** Used for Driver startup repair when first-turn output is malformed. */
	driverStartupRepair?(prompt: string): Promise<string>;
}

export interface PairProtocolEvent {
	role: "coordinator" | "driver" | "navigator";
	phase: string;
	text: string;
}

export interface PairCycleRecord {
	cycle: number;
	driverReport?: string;
	navigatorReview?: string;
	navigatorDecision?: NavigatorDecisionValue | "malformed";
	correctionReport?: string;
	clarificationAnswer?: string;
	driverStartupReport?: string;
	driverStartupRepairReport?: string;
}

export interface PairProtocolResult {
	status: PairRuntimeStatus;
	stopReason: string;
	memory: PairRunMemory;
	cyclesCompleted: number;
	malformedDecisionRepairs: number;
	cycles: PairCycleRecord[];
	finalNavigatorDecision?: NavigatorDecisionValue;
	initialWorkspace?: WorkspaceSnapshot;
	finalWorkspace?: WorkspaceSnapshot;
	finalVerification?: FinalVerification;
	driverStartupCompleted: boolean;
	activePlaybook?: string;
	loadedLeaves?: LoadedLeaf[];
	skippedPlaybookSteps?: SkippedStep[];
	playbookOverrideReason?: string;
}

export interface WorkspaceSnapshot {
	gitStatusShort: string;
	gitDiffStat: string;
	gitDiff: string;
}

export interface FinalVerification {
	command: string;
	exitCode: number;
	summary: string;
}

export interface RunPairProtocolOptions {
	task: string;
	maxCycles: number;
	testCommand?: string;
	onEvent?: (event: PairProtocolEvent) => void;
	collectEvidence?: () => Promise<WorkspaceSnapshot>;
	collectFinalEvidence?: () => Promise<WorkspaceSnapshot>;
	runFinalVerification?: (command: string) => Promise<FinalVerification>;
	currentWorkspace?: WorkspaceSnapshot;
	/** Pstack registry snapshot for startup/playbook validation. */
	pstackRegistry?: PstackRegistryForProtocol;
	/** Navigator's initial playbook recommendation (set by preflight freeze). */
	initialPlaybookRecommendation?: string;
	/** Render the driver first-turn prompt given run state context. */
	renderDriverFirstTurn?: (context: DriverFirstTurnContext) => string;
}

/** Minimal pstack registry interface needed by the protocol. */
export interface PstackRegistryForProtocol {
	allNames: ReadonlySet<string>;
	skills: ReadonlyArray<{ name: string; slug: string }>;
	playbooks: ReadonlyArray<{ name: string; slug: string }>;
}

/** Context provided to the driver first-turn renderer. */
export interface DriverFirstTurnContext {
	task: string;
	initialPlaybook: string;
	registrySummary: string;
	preflightEndGoal: string;
	runStateText: string;
}

const VALID_NAVIGATOR_DECISIONS: ReadonlySet<NavigatorDecisionValue> = new Set([
	"approve_next",
	"request_revision",
	"blocked",
	"final_approve",
]);

const TDD_REVIEW_RUBRIC = [
	"one behavior at a time",
	"RED before GREEN",
	"RED failed for the intended reason",
	"minimal implementation for the current behavior",
	"public behavior tests",
	"no horizontal slicing",
	"failing-before and passing-after evidence",
	"edge cases and checklist coverage reviewed",
];

export function createInitialPairRunMemory(task: string): PairRunMemory {
	return {
		task,
		acceptedConstraints: [
			"Mode is tdd.",
			"Driver must call or use skill-tdd before implementation work.",
			"Driver may edit and write files. Run tests to verify changes.",
		],
		unresolvedRisks: [],
		currentCycle: 1,
		currentObjective: null,
		acceptanceChecklistText: null,
		lastDriverReport: null,
		lastNavigatorReview: null,
		evidenceSummaries: [],
	};
}

// ---------------------------------------------------------------------------
// Heading normalization and generalized section extraction
// ---------------------------------------------------------------------------

/**
 * Normalize a markdown heading for comparison: trim whitespace, lowercase,
 * and remove any trailing punctuation characters (. ! ? : , ;).
 */
export function normalizeHeading(heading: string): string {
	return heading.trim().toLowerCase().replace(/[.!?:,;]+$/, "");
}

/**
 * Extract the body text of a section identified by a level-2 heading.
 *
 * Heading matching is normalized: both the target `heading` string and the
 * headings found in `markdown` are normalized before comparison, so trailing
 * punctuation, extra whitespace, and letter case differences are ignored.
 *
 * Returns `null` if the heading is not found or if the section body is blank.
 */
export function extractSection(markdown: string, heading: string): string | null {
	const normalizedTarget = normalizeHeading(heading);
	const lines = markdown.split(/\r?\n/);
	const start = lines.findIndex((line) => {
		const stripped = line.trim();
		if (!stripped.startsWith("## ")) return false;
		return normalizeHeading(stripped.slice(3)) === normalizedTarget;
	});
	if (start < 0) return null;
	const body: string[] = [];
	for (let i = start + 1; i < lines.length; i++) {
		if (lines[i].startsWith("## ")) break;
		body.push(lines[i]);
	}
	return body.join("\n").trim() || null;
}

// ---------------------------------------------------------------------------
// Section-specific validator scaffolding
// ---------------------------------------------------------------------------

/**
 * Result of a structured section validation pass.
 *
 * `valid` is true only when there are no errors. `errors` lists all
 * individual validation failures found. Validators are pure and do not
 * mutate state.
 */
export interface SectionValidationResult {
	valid: boolean;
	errors: string[];
}

/**
 * Validate a Navigator review response.
 *
 * Rules (in addition to the exact one-DECISION-line rule):
 * - Exactly one DECISION line must be present.
 * - When the decision is `request_revision`, both `## Correction Packet` and
 *   `## Required Evidence` sections must be present and non-blank.
 */
export function validateNavigatorReview(text: string): SectionValidationResult {
	const errors: string[] = [];

	// Reuse the existing one-DECISION-line check
	const decision = parseNavigatorDecision(text);
	if (decision.kind === "malformed") {
		if (decision.reason.toLowerCase().includes("multiple")) {
			errors.push("Multiple DECISION lines found; exactly one is required.");
		} else {
			errors.push(decision.reason);
		}
		return { valid: false, errors };
	}

	// request_revision requires Correction Packet and Required Evidence
	if (decision.value === "request_revision") {
		if (!extractSection(text, "Correction Packet")) {
			errors.push("Missing required section: ## Correction Packet (required when DECISION: request_revision).");
		}
		if (!extractSection(text, "Required Evidence")) {
			errors.push("Missing required section: ## Required Evidence (required when DECISION: request_revision).");
		}
	}

	return { valid: errors.length === 0, errors };
}

/**
 * Validate a Driver cycle report.
 *
 * Required sections: Summary, Changed Files, Tests Run, Evidence,
 * Acceptance Checklist Progress, Next Intent.
 */
export function validateDriverCycleReport(text: string): SectionValidationResult {
	const errors: string[] = [];
	const required = [
		"Summary",
		"Changed Files",
		"Tests Run",
		"Evidence",
		"Acceptance Checklist Progress",
		"Next Intent",
	];
	for (const section of required) {
		if (!extractSection(text, section)) {
			errors.push(`Missing required section: ## ${section}.`);
		}
	}
	return { valid: errors.length === 0, errors };
}

/**
 * Validate a Navigator preflight response.
 *
 * Required sections: Acceptance Checklist, Risks, First Cycle Objective.
 */
export function validateNavigatorPreflight(text: string): SectionValidationResult {
	const errors: string[] = [];
	const required = ["Acceptance Checklist", "Risks", "First Cycle Objective"];
	for (const section of required) {
		if (!extractSection(text, section)) {
			errors.push(`Missing required section: ## ${section}.`);
		}
	}
	return { valid: errors.length === 0, errors };
}

export function parseNavigatorDecision(text: string): NavigatorDecision {
	const matches = [...text.matchAll(/^\s*DECISION:\s*(\S+)\s*$/gim)];
	if (matches.length === 0) return { kind: "malformed", reason: "Missing DECISION line." };
	if (matches.length > 1) return { kind: "malformed", reason: "Multiple DECISION lines." };

	const value = matches[0][1];
	if (VALID_NAVIGATOR_DECISIONS.has(value as NavigatorDecisionValue)) {
		return { kind: "valid", value: value as NavigatorDecisionValue };
	}
	return { kind: "malformed", reason: `Unsupported DECISION value: ${value}` };
}

export function statusFromNavigatorDecision(decision: NavigatorDecisionValue): PairRuntimeStatus | null {
	switch (decision) {
	case "blocked":
		return "blocked";
	case "final_approve":
		return "success";
	case "approve_next":
	case "request_revision":
		return null;
	default: {
		const _exhaustive: never = decision;
		return _exhaustive;
	}
	}
}

export function statusFromStopReason(stopReason: string): PairRuntimeStatus {
	if (stopReason === "navigator_blocked" || stopReason === "malformed_decision_after_repair" || stopReason === "repeated_revision_request" || stopReason === "driver_startup_failed") {
		return "blocked";
	}
	if (stopReason === "navigator_final_approve") return "success";
	return "incomplete";
}

export function buildNavigatorPreflightPrompt(memory: PairRunMemory, testCommand: string | undefined): string {
	const workspaceSection = memory.initialWorkspace
		? `\nWorkspace snapshot at run start:\n${formatWorkspaceSnapshot(memory.initialWorkspace)}\n`
		: "";
	return `You are the Navigator Agent for a deterministic Pair Program Tool run.

Task:
${memory.task}

Mode: TDD.
Test command: ${testCommand ?? "not specified"}
${workspaceSection}
Define the acceptance checklist, main risks, and the first Driver cycle objective.

Return Markdown with these headings:
## Acceptance Checklist
## Risks
## First Cycle Objective

If you need to change the checklist later, include:
## Checklist Amendment`;
}

export function buildDriverCyclePrompt(memory: PairRunMemory, latestNavigatorHandoff: string | null, testCommand: string | undefined, currentWorkspace?: WorkspaceSnapshot, _driverStartupCompleted?: boolean): string {
	const workspaceSection = currentWorkspace
		? `\nCurrent workspace evidence:\n${formatWorkspaceSnapshot(currentWorkspace)}\n`
		: "";
	return `You are the Driver Agent in a TDD pair-programming session.

Before implementation planning, call or use skill-tdd and follow red-green-refactor discipline.

You may edit and write files. Run tests to verify your changes.

Task:
${memory.task}

Compact Pair Run Memory:
${formatMemoryForPrompt(memory)}

Latest Navigator handoff:
${latestNavigatorHandoff ?? "Navigator preflight is the current handoff."}
${workspaceSection}
Test command: ${testCommand ?? "not specified"}

Return only Markdown with these exact headings:
## Summary
## Changed Files
## Tests Run
## Evidence
## Acceptance Checklist Progress
## Next Intent`;
}

export function buildDriverCorrectionPrompt(memory: PairRunMemory, navigatorReview: string, testCommand: string | undefined, currentWorkspace?: WorkspaceSnapshot): string {
	const workspaceSection = currentWorkspace
		? `\nCurrent workspace evidence:\n${formatWorkspaceSnapshot(currentWorkspace)}\n`
		: "";
	return `You are the Driver Agent handling one correction packet for the current TDD cycle.

Use skill-tdd discipline. You may edit and write files. Run tests to verify your changes.

Task:
${memory.task}

Compact Pair Run Memory:
${formatMemoryForPrompt(memory)}

Navigator review and correction packet:
${navigatorReview}
${workspaceSection}
Test command: ${testCommand ?? "not specified"}

Return only Markdown with these exact headings:
## Correction Packet Addressed
## Changed Files
## Tests Run
## Evidence
## Remaining Risk

If you cannot proceed safely, return only:
## Clarification Needed`;
}

export function buildNavigatorReviewPrompt(memory: PairRunMemory, driverReport: string, currentWorkspace?: WorkspaceSnapshot): string {
	const workspaceSection = currentWorkspace
		? `\nCurrent workspace evidence:\n${formatWorkspaceSnapshot(currentWorkspace)}\n`
		: "";
	return `You are the Navigator Agent reviewing the Driver Agent's current TDD cycle.

Compact Pair Run Memory:
${formatMemoryForPrompt(memory)}

Driver report:
${driverReport}
${workspaceSection}
Compact TDD review rubric:
${TDD_REVIEW_RUBRIC.map((item) => `- ${item}`).join("\n")}

Decision contract. Include exactly one DECISION line:
DECISION: approve_next
DECISION: request_revision
DECISION: blocked
DECISION: final_approve

Use DECISION: request_revision only when the issue is likely fixable in one correction packet. Then include:
## Correction Packet
## Required Evidence

If you change the checklist, include:
## Checklist Amendment`;
}

export function buildNavigatorDecisionRepairPrompt(previousReview: string, parseError: string): string {
	return `Your previous Navigator review did not satisfy the decision contract.

Problem: ${parseError}

Previous review:
${previousReview}

Return the corrected review now. Include exactly one of these lines:
DECISION: approve_next
DECISION: request_revision
DECISION: blocked
DECISION: final_approve

If you choose DECISION: request_revision, include:
## Correction Packet
## Required Evidence`;
}

// ---------------------------------------------------------------------------
// Driver startup validation for the protocol loop (DEC-011, DEC-012)
// ---------------------------------------------------------------------------

export interface DriverStartupOutcome {
	completed: boolean;
	activePlaybook: string;
	loadedLeaves: LoadedLeaf[];
	skippedSteps: SkippedStep[];
	overrideUsed: boolean;
	overrideReason?: string;
	errors: string[];
}

/**
 * Parse skipped steps from the Skipped Steps section.
 * Expects lines like: `- step name: reason` or `- skip: reason`
 */
function parseSkippedSteps(raw: string): SkippedStep[] {
	const results: SkippedStep[] = [];
	for (const line of raw.split(/\r?\n/)) {
		const stripped = line.replace(/^[-*+]\s+/, "").trim();
		if (!stripped) continue;
		const colonIdx = stripped.indexOf(":");
		if (colonIdx > 0) {
			results.push({
				step: stripped.slice(0, colonIdx).trim(),
				reason: stripped.slice(colonIdx + 1).trim(),
			});
		} else {
			results.push({ step: stripped, reason: "" });
		}
	}
	return results;
}

/**
 * Build a driver startup repair prompt for malformed first-turn output.
 */
export function buildDriverStartupRepairPrompt(originalResponse: string, errors: string[]): string {
	return `Your previous Driver startup response did not satisfy the startup ritual contract.

Problems:
${errors.map((e) => `- ${e}`).join("\n")}

Original response (truncated):
${originalResponse.slice(0, 2000)}

Return the corrected startup response now with all required sections:
## Todo List
## Principles Read
## Selected Playbook
## Playbook Steps
## Loaded Leaves
## Skipped Steps
## Override Packet (only if overriding the recommended playbook)`;
}

export async function runPairProtocolDryRun(
	sessions: PairProtocolSessions,
	options: RunPairProtocolOptions,
): Promise<PairProtocolResult> {
	let memory = createInitialPairRunMemory(options.task);
	let malformedDecisionRepairs = 0;
	let initialWorkspace: WorkspaceSnapshot | undefined;
	let finalWorkspace: WorkspaceSnapshot | undefined;
	let finalVerification: FinalVerification | undefined;
	let finalNavigatorDecision: NavigatorDecisionValue | undefined;
	const cycles: PairCycleRecord[] = [];

	const cycleRecord = (n: number): PairCycleRecord => {
		let rec = cycles.find((c) => c.cycle === n);
		if (!rec) {
			rec = { cycle: n };
			cycles.push(rec);
		}
		return rec;
	};

	options.onEvent?.({ role: "coordinator", phase: "start", text: "skill-tdd prerequisite verified" });

	if (options.collectEvidence) {
		initialWorkspace = await options.collectEvidence();
		memory = { ...memory, initialWorkspace };
		options.onEvent?.({ role: "coordinator", phase: "initial_workspace", text: formatWorkspaceSnapshot(initialWorkspace) });
	}

	const preflightPrompt = buildNavigatorPreflightPrompt(memory, options.testCommand);
	const preflight = await sessions.navigatorPreflight(preflightPrompt);
	memory = {
		...memory,
		acceptanceChecklistText: preflight,
		currentObjective: extractHeadingBody(preflight, "First Cycle Objective") ?? preflight.trim(),
		lastNavigatorReview: preflight,
	};
	options.onEvent?.({ role: "navigator", phase: "preflight", text: preflight });

	// -----------------------------------------------------------------------
	// Driver startup gate (DEC-011, DEC-012, DEC-013)
	// -----------------------------------------------------------------------
	let driverStartupCompleted = false;
	let activePlaybook = options.initialPlaybookRecommendation ?? "";
	let loadedLeaves: LoadedLeaf[] = [];
	let skippedPlaybookSteps: SkippedStep[] = [];
	let playbookOverrideReason: string | undefined;

	if (options.pstackRegistry && options.renderDriverFirstTurn) {
		const registrySummary = [
			`Skills: ${options.pstackRegistry.skills.map((s) => s.slug).join(", ")}`,
			`Playbooks: ${options.pstackRegistry.playbooks.map((p) => p.slug).join(", ")}`,
		].join("\n");

		const firstTurnPrompt = options.renderDriverFirstTurn({
			task: options.task,
			initialPlaybook: activePlaybook,
			registrySummary,
			preflightEndGoal: memory.acceptanceChecklistText ?? "",
			runStateText: `Cycle: ${memory.currentCycle}, Objective: ${memory.currentObjective ?? "not set"}`,
		});

		let startupResponse = await sessions.driverCycle(firstTurnPrompt);
		options.onEvent?.({ role: "driver", phase: "startup", text: startupResponse });
		cycleRecord(1).driverStartupReport = startupResponse;

		// Import validation inline to avoid circular deps
		const { validateDriverStartup } = await import("./pair-program-helpers.ts");
		let validation = validateDriverStartup(startupResponse, options.pstackRegistry as any, activePlaybook);

		// One repair pass if malformed
		if (!validation.valid && (sessions.driverStartupRepair ?? sessions.driverCycle)) {
			const repairFn = sessions.driverStartupRepair ?? sessions.driverCycle;
			const repairPrompt = buildDriverStartupRepairPrompt(startupResponse, validation.errors);
			startupResponse = await repairFn(repairPrompt);
			options.onEvent?.({ role: "driver", phase: "startup_repair", text: startupResponse });
			cycleRecord(1).driverStartupRepairReport = startupResponse;
			validation = validateDriverStartup(startupResponse, options.pstackRegistry as any, activePlaybook);
		}

		if (!validation.valid) {
			options.onEvent?.({ role: "coordinator", phase: "startup_failed", text: `Driver startup validation failed: ${validation.errors.join("; ")}` });
			if (options.collectFinalEvidence) finalWorkspace = await options.collectFinalEvidence();
			return finish("driver_startup_failed", memory, malformedDecisionRepairs, cycles, finalNavigatorDecision, initialWorkspace, finalWorkspace, finalVerification, false, activePlaybook, loadedLeaves, skippedPlaybookSteps, playbookOverrideReason);
		}

		// Startup validated — record state
		driverStartupCompleted = true;
		if (validation.parsedPlaybook) {
			activePlaybook = validation.parsedPlaybook;
		}
		if (validation.isOverride && validation.overridePacket) {
			activePlaybook = validation.overridePacket.chosen || activePlaybook;
			playbookOverrideReason = `${validation.overridePacket.evidence} | ${validation.overridePacket.pinnedGoal}`;
		}
		if (validation.parsedLeaves) {
			loadedLeaves = validation.parsedLeaves.map((name) => ({ name }));
		}

		// Parse skipped steps
		const skippedRaw = extractHeadingBody(startupResponse, "Skipped Steps");
		if (skippedRaw) {
			skippedPlaybookSteps = parseSkippedSteps(skippedRaw);
		}

		options.onEvent?.({ role: "coordinator", phase: "startup_completed", text: `Startup validated. Active playbook: ${activePlaybook}. Loaded leaves: ${loadedLeaves.map((l) => l.name).join(", ") || "none"}.` });
	} else {
		// No pstack registry provided — skip startup gate (legacy/test mode)
		driverStartupCompleted = true;
	}

	while (memory.currentCycle <= options.maxCycles) {
		let correctionUsed = false;
		let currentWorkspaceEvidence = options.currentWorkspace ?? initialWorkspace;
		let driverReport = await sessions.driverCycle(
			buildDriverCyclePrompt(memory, memory.lastNavigatorReview, options.testCommand, currentWorkspaceEvidence),
		);
		memory = updateMemoryAfterDriver(memory, driverReport);
		cycleRecord(memory.currentCycle).driverReport = driverReport;
		options.onEvent?.({ role: "driver", phase: `cycle_${memory.currentCycle}`, text: driverReport });

		while (true) {
			let review = await sessions.navigatorReview(buildNavigatorReviewPrompt(memory, driverReport, currentWorkspaceEvidence));
			let decision = parseNavigatorDecision(review);

			if (decision.kind === "malformed") {
				malformedDecisionRepairs += 1;
				review = await sessions.navigatorDecisionRepair(buildNavigatorDecisionRepairPrompt(review, decision.reason));
				decision = parseNavigatorDecision(review);
			}

			memory = updateMemoryAfterNavigator(memory, review);
			const rec = cycleRecord(memory.currentCycle);
			rec.navigatorReview = review;
			rec.navigatorDecision = decision.kind === "valid" ? decision.value : "malformed";
			options.onEvent?.({ role: "navigator", phase: `review_${memory.currentCycle}`, text: review });

			if (decision.kind === "malformed") {
				return finish("malformed_decision_after_repair", memory, malformedDecisionRepairs, cycles, finalNavigatorDecision, initialWorkspace, finalWorkspace, finalVerification, driverStartupCompleted, activePlaybook, loadedLeaves, skippedPlaybookSteps, playbookOverrideReason);
			}

			finalNavigatorDecision = decision.value;

			const mappedStatus = statusFromNavigatorDecision(decision.value);
			if (mappedStatus) {
				if (decision.value === "final_approve" && options.runFinalVerification && options.testCommand) {
					finalVerification = await options.runFinalVerification(options.testCommand);
					options.onEvent?.({ role: "coordinator", phase: "final_verification", text: formatFinalVerification(finalVerification) });

					if (finalVerification.exitCode !== 0 && sessions.navigatorClarification) {
						const classificationPrompt = `Final verification failed with exit code ${finalVerification.exitCode}.\n\nCommand: ${finalVerification.command}\nOutput:\n${truncateText(finalVerification.summary, 2000)}\n\nClassify this failure: is it a blocker (DECISION: blocked) or should the Driver retry (DECISION: request_revision with ## Correction Packet and ## Required Evidence)?`;
						const classification = await sessions.navigatorClarification(classificationPrompt);
						const classificationDecision = parseNavigatorDecision(classification);
						if (classificationDecision.kind === "valid" && classificationDecision.value === "blocked") {
							finalNavigatorDecision = "blocked";
							if (options.collectFinalEvidence) finalWorkspace = await options.collectFinalEvidence();
							return finish("navigator_blocked", memory, malformedDecisionRepairs, cycles, finalNavigatorDecision, initialWorkspace, finalWorkspace, finalVerification, driverStartupCompleted, activePlaybook, loadedLeaves, skippedPlaybookSteps, playbookOverrideReason);
						}
					}
				}
				if (options.collectFinalEvidence) finalWorkspace = await options.collectFinalEvidence();
				return finish(decision.value === "blocked" ? "navigator_blocked" : "navigator_final_approve", memory, malformedDecisionRepairs, cycles, finalNavigatorDecision, initialWorkspace, finalWorkspace, finalVerification, driverStartupCompleted, activePlaybook, loadedLeaves, skippedPlaybookSteps, playbookOverrideReason);
			}

			if (decision.value === "approve_next") {
				memory = { ...memory, currentCycle: memory.currentCycle + 1 };
				break;
			}

			if (correctionUsed) {
				return finish("repeated_revision_request", memory, malformedDecisionRepairs, cycles, finalNavigatorDecision, initialWorkspace, finalWorkspace, finalVerification, driverStartupCompleted, activePlaybook, loadedLeaves, skippedPlaybookSteps, playbookOverrideReason);
			}

			correctionUsed = true;
			let correctionReport = await sessions.driverCorrection(buildDriverCorrectionPrompt(memory, review, options.testCommand, currentWorkspaceEvidence));

			if (extractHeadingBody(correctionReport, "Clarification Needed") && sessions.navigatorClarification) {
				const clarificationPrompt = `The Driver needs clarification before addressing the correction packet.\n\nDriver report:\n${correctionReport}\n\nProvide a targeted answer to unblock the Driver.`;
				const clarificationAnswer = await sessions.navigatorClarification(clarificationPrompt);
				cycleRecord(memory.currentCycle).clarificationAnswer = clarificationAnswer;
				options.onEvent?.({ role: "navigator", phase: `clarification_${memory.currentCycle}`, text: clarificationAnswer });
				correctionReport = await sessions.driverCorrection(
					`Navigator clarification:\n${clarificationAnswer}\n\nNow address the correction packet.` + buildDriverCorrectionPrompt(memory, review, options.testCommand, currentWorkspaceEvidence),
				);
				correctionUsed = false;
			}

			memory = updateMemoryAfterDriver(memory, correctionReport);
			cycleRecord(memory.currentCycle).correctionReport = correctionReport;
			options.onEvent?.({ role: "driver", phase: `correction_${memory.currentCycle}`, text: correctionReport });
		}
	}

	if (options.collectFinalEvidence) finalWorkspace = await options.collectFinalEvidence();
	return finish("max_cycles_without_final_approval", memory, malformedDecisionRepairs, cycles, finalNavigatorDecision, initialWorkspace, finalWorkspace, finalVerification, driverStartupCompleted, activePlaybook, loadedLeaves, skippedPlaybookSteps, playbookOverrideReason);
}

function finish(
	stopReason: string,
	memory: PairRunMemory,
	malformedDecisionRepairs: number,
	cycles: PairCycleRecord[],
	finalNavigatorDecision: NavigatorDecisionValue | undefined,
	initialWorkspace?: WorkspaceSnapshot,
	finalWorkspace?: WorkspaceSnapshot,
	finalVerification?: FinalVerification,
	driverStartupCompleted = false,
	activePlaybook?: string,
	loadedLeaves?: LoadedLeaf[],
	skippedPlaybookSteps?: SkippedStep[],
	playbookOverrideReason?: string,
): PairProtocolResult {
	return {
		status: statusFromStopReason(stopReason),
		stopReason,
		memory,
		cyclesCompleted: Math.max(0, memory.currentCycle - 1),
		malformedDecisionRepairs,
		cycles,
		finalNavigatorDecision,
		initialWorkspace,
		finalWorkspace,
		finalVerification,
		driverStartupCompleted,
		activePlaybook,
		loadedLeaves,
		skippedPlaybookSteps,
		playbookOverrideReason,
	};
}

function formatMemoryForPrompt(memory: PairRunMemory): string {
	return [
		`Task: ${memory.task}`,
		`Accepted constraints: ${memory.acceptedConstraints.join(" | ")}`,
		`Unresolved risks: ${memory.unresolvedRisks.length ? memory.unresolvedRisks.join(" | ") : "none recorded"}`,
		`Current cycle: ${memory.currentCycle}`,
		`Current objective: ${memory.currentObjective ?? "not set"}`,
		`Acceptance checklist: ${memory.acceptanceChecklistText ?? "not set"}`,
		`Evidence summaries: ${memory.evidenceSummaries.length ? memory.evidenceSummaries.join(" | ") : "none recorded"}`,
	].join("\n");
}

function updateMemoryAfterDriver(memory: PairRunMemory, driverReport: string): PairRunMemory {
	const evidence = extractHeadingBody(driverReport, "Evidence") ?? extractHeadingBody(driverReport, "Tests Run");
	return {
		...memory,
		lastDriverReport: driverReport,
		evidenceSummaries: evidence ? [...memory.evidenceSummaries, evidence.trim()] : memory.evidenceSummaries,
	};
}

function updateMemoryAfterNavigator(memory: PairRunMemory, review: string): PairRunMemory {
	const amendment = extractHeadingBody(review, "Checklist Amendment");
	return {
		...memory,
		acceptanceChecklistText: amendment ? `${memory.acceptanceChecklistText ?? ""}\n\nChecklist amendment:\n${amendment}`.trim() : memory.acceptanceChecklistText,
		lastNavigatorReview: review,
	};
}

function extractHeadingBody(markdown: string, heading: string): string | null {
	const lines = markdown.split(/\r?\n/);
	const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading}`.toLowerCase());
	if (start < 0) return null;
	const body: string[] = [];
	for (let i = start + 1; i < lines.length; i++) {
		if (lines[i].startsWith("## ")) break;
		body.push(lines[i]);
	}
	return body.join("\n").trim() || null;
}

export function truncateText(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text;
	const suffix = "\n...(truncated)";
	return text.slice(0, maxLength - suffix.length) + suffix;
}

function formatWorkspaceSnapshot(snapshot: WorkspaceSnapshot): string {
	return [
		"Initial workspace snapshot:",
		snapshot.gitStatusShort ? `git status:\n${snapshot.gitStatusShort}` : "git status: (clean)",
		snapshot.gitDiffStat ? `git diff stat:\n${snapshot.gitDiffStat}` : "git diff stat: (no changes)",
		snapshot.gitDiff ? `git diff (truncated):\n${snapshot.gitDiff}` : "git diff: (no changes)",
	].join("\n");
}

function formatFinalVerification(verification: FinalVerification): string {
	return [
		"Final verification:",
		`command: ${verification.command}`,
		`exit code: ${verification.exitCode}`,
		`summary: ${verification.summary}`,
	].join("\n");
}

/**
 * Parse changed file paths from `git status --short` output.
 *
 * Each line has a 2-char status code, a space, then the path. Renames use
 * `R old -> new` and we keep the new path. Unchanged or empty input returns [].
 */
export function parseChangedFilesFromGitStatus(gitStatusShort: string): string[] {
	if (!gitStatusShort) return [];
	const out: string[] = [];
	for (const raw of gitStatusShort.split(/\r?\n/)) {
		const line = raw.replace(/\r$/, "");
		if (line.length < 4) continue;
		const rest = line.slice(3).trim();
		if (!rest) continue;
		const arrow = rest.indexOf(" -> ");
		const path = arrow >= 0 ? rest.slice(arrow + 4).trim() : rest;
		const unquoted = path.startsWith("\"") && path.endsWith("\"") ? path.slice(1, -1) : path;
		if (unquoted) out.push(unquoted);
	}
	return out;
}

/** Build the shared base filename for a transcript pair (`.md` and `.json`). */
export function buildTranscriptBasename(task: string, now: Date = new Date()): string {
	const slug = task
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 60) || "task";
	const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
	return `${timestamp}-${slug}`;
}
