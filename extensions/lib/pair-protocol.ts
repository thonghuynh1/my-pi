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
	if (stopReason === "navigator_blocked" || stopReason === "malformed_decision_after_repair" || stopReason === "repeated_revision_request") {
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

export function buildDriverCyclePrompt(memory: PairRunMemory, latestNavigatorHandoff: string | null, testCommand: string | undefined, currentWorkspace?: WorkspaceSnapshot): string {
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
				return finish("malformed_decision_after_repair", memory, malformedDecisionRepairs, cycles, finalNavigatorDecision, initialWorkspace, finalWorkspace, finalVerification);
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
							return finish("navigator_blocked", memory, malformedDecisionRepairs, cycles, finalNavigatorDecision, initialWorkspace, finalWorkspace, finalVerification);
						}
					}
				}
				if (options.collectFinalEvidence) finalWorkspace = await options.collectFinalEvidence();
				return finish(decision.value === "blocked" ? "navigator_blocked" : "navigator_final_approve", memory, malformedDecisionRepairs, cycles, finalNavigatorDecision, initialWorkspace, finalWorkspace, finalVerification);
			}

			if (decision.value === "approve_next") {
				memory = { ...memory, currentCycle: memory.currentCycle + 1 };
				break;
			}

			if (correctionUsed) {
				return finish("repeated_revision_request", memory, malformedDecisionRepairs, cycles, finalNavigatorDecision, initialWorkspace, finalWorkspace, finalVerification);
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
	return finish("max_cycles_without_final_approval", memory, malformedDecisionRepairs, cycles, finalNavigatorDecision, initialWorkspace, finalWorkspace, finalVerification);
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
