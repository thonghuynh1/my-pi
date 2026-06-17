/**
 * Pure unit tests for issue-task-extractor: file reference detection,
 * markdown extraction, and IssueTaskPacket parsing.
 *
 * Also covers pair-protocol PairRunState creation and preflight freezing,
 * and vague-task blocking during preflight validation.
 *
 * Run: npx tsx extensions/__tests__/issue-task-extractor.test.ts
 */

import * as path from "node:path";
import * as url from "node:url";
import {
	detectFileReference,
	extractIssueTaskPacket,
	readIssueTaskFile,
} from "../lib/issue-task-extractor.ts";
import {
	createInitialPairRunState,
	freezePreflightIntoState,
	buildNavigatorPreflightPromptForState,
	validatePreflightEndGoal,
	type PairRunState,
	type AcceptanceCriterion,
	type Amendment,
} from "../lib/pair-protocol.ts";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string) {
	if (condition) {
		passed++;
	} else {
		failed++;
		failures.push(message);
		console.error(`  FAIL: ${message}`);
	}
}

function assertEqual<T>(actual: T, expected: T, message: string) {
	if (actual === expected) {
		passed++;
	} else {
		failed++;
		const msg = `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
		failures.push(msg);
		console.error(`  FAIL: ${msg}`);
	}
}

// ---------------------------------------------------------------------------
// detectFileReference — file:// URLs
// ---------------------------------------------------------------------------

console.log("detectFileReference — file:// URLs");

{
	// POSIX file URL
	const ref = detectFileReference("Implement the issue described in file:///home/user/issues/09-fix.md");
	assertEqual(ref, "/home/user/issues/09-fix.md", "POSIX file URL extracts path");
}

{
	// Windows file URL with drive letter
	const ref = detectFileReference("See file:///C:/GitRepos/my-pi/issues/03-build.md for details.");
	assertEqual(ref, "C:/GitRepos/my-pi/issues/03-build.md", "Windows file URL strips leading slash before drive letter");
}

{
	// file:// with two slashes (not three)
	const ref = detectFileReference("file://C:/path/to/issue.md");
	assertEqual(ref, "C:/path/to/issue.md", "two-slash Windows file URL extracts path");
}

// ---------------------------------------------------------------------------
// detectFileReference — Windows absolute paths
// ---------------------------------------------------------------------------

console.log("detectFileReference — Windows absolute paths");

{
	const ref = detectFileReference("Task: C:\\GitRepos\\my-pi\\issues\\03-build.md");
	assert(ref !== null && ref.includes("03-build.md"), "Windows backslash path detected");
}

{
	const ref = detectFileReference("Task: C:/GitRepos/my-pi/issues/03-build.md");
	assert(ref !== null && ref.includes("03-build.md"), "Windows forward-slash path detected");
}

{
	const ref = detectFileReference("no path here");
	assertEqual(ref, null, "no path returns null");
}

// ---------------------------------------------------------------------------
// detectFileReference — Unix absolute paths
// ---------------------------------------------------------------------------

console.log("detectFileReference — Unix absolute paths");

{
	const ref = detectFileReference("Implement /home/user/scratch/my-pi/issues/03-build.md please");
	assert(ref !== null && ref.includes("03-build.md"), "Unix absolute path detected");
}

// ---------------------------------------------------------------------------
// extractIssueTaskPacket — fixture parsing
// ---------------------------------------------------------------------------

console.log("extractIssueTaskPacket — fixture parsing");

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, "fixtures", "sample-issue.md");

import * as fs from "node:fs";
const fixtureContent = fs.readFileSync(fixturePath, "utf8");

{
	const packet = extractIssueTaskPacket(fixturePath, fixtureContent);
	assertEqual(packet.sourcePath, fixturePath, "sourcePath is set");
}

{
	const packet = extractIssueTaskPacket(fixturePath, fixtureContent);
	assert(packet.acceptanceCriteria.includes("Tracker state is read from disk"), "acceptance criteria extracted");
	assert(packet.acceptanceCriteria.includes("terminal reason string"), "multiple criteria in acceptance text");
}

{
	const packet = extractIssueTaskPacket(fixturePath, fixtureContent);
	assert(packet.explicitConstraints.length > 0, "constraints extracted");
	assert(packet.explicitConstraints.some(c => c.includes("synchronous file I/O")), "constraint text captured");
}

{
	const packet = extractIssueTaskPacket(fixturePath, fixtureContent);
	assert(packet.buildOrWiringNotes.length > 0, "build notes extracted");
	assert(packet.buildOrWiringNotes.some(n => n.includes("AtomicWriter")), "build note text captured");
}

{
	const packet = extractIssueTaskPacket(fixturePath, fixtureContent);
	assert(packet.blockedBy !== undefined, "blocked-by extracted");
	assert(packet.blockedBy!.includes("08-add-atomic-writer-utility.md"), "blocked-by link captured");
}

// ---------------------------------------------------------------------------
// extractIssueTaskPacket — minimal content (only acceptance criteria)
// ---------------------------------------------------------------------------

console.log("extractIssueTaskPacket — minimal content");

{
	const minimal = `# Title\n\n## Acceptance criteria\n\n- [ ] Thing is done.\n`;
	const packet = extractIssueTaskPacket("/path/to/issue.md", minimal);
	assert(packet.acceptanceCriteria.includes("Thing is done"), "minimal AC extracted");
	assertEqual(packet.explicitConstraints.length, 0, "no constraints in minimal");
	assertEqual(packet.buildOrWiringNotes.length, 0, "no build notes in minimal");
	assertEqual(packet.blockedBy, undefined, "no blocked-by in minimal");
}

// ---------------------------------------------------------------------------
// readIssueTaskFile — reads from fixture path
// ---------------------------------------------------------------------------

console.log("readIssueTaskFile");

{
	const task = `Implement the issue described in ${fixturePath}`;
	const packet = readIssueTaskFile(task);
	assert(packet !== null, "returns packet when path found in task");
	assert(packet!.acceptanceCriteria.includes("Tracker state is read from disk"), "file content extracted");
}

{
	const task = "no file reference here, just plain text task";
	const packet = readIssueTaskFile(task);
	assertEqual(packet, null, "returns null when no file reference in task");
}

{
	const task = "/nonexistent/path/to/issue.md";
	const packet = readIssueTaskFile(task);
	assertEqual(packet, null, "returns null when file does not exist");
}

// ---------------------------------------------------------------------------
// createInitialPairRunState
// ---------------------------------------------------------------------------

console.log("createInitialPairRunState");

{
	const state = createInitialPairRunState("do the thing");
	assertEqual(state.task, "do the thing", "task is preserved");
	assertEqual(state.endGoalToProve, "", "endGoalToProve starts empty");
	assertEqual(state.acceptanceChecklist.length, 0, "acceptanceChecklist starts empty");
	assertEqual(state.activePlaybook, "", "activePlaybook starts empty");
	assertEqual(state.initialPlaybookRecommendation, "", "initialPlaybookRecommendation starts empty");
	assertEqual(state.driverStartupCompleted, false, "driverStartupCompleted starts false");
	assertEqual(state.loadedLeaves.length, 0, "loadedLeaves starts empty");
	assertEqual(state.skippedPlaybookSteps.length, 0, "skippedPlaybookSteps starts empty");
	assertEqual(state.allowedAmendments.length, 0, "allowedAmendments starts empty");
	assertEqual(state.driverEvidence.length, 0, "driverEvidence starts empty");
	assertEqual(state.navigatorVerificationTelemetry.length, 0, "navigatorVerificationTelemetry starts empty");
	assertEqual(state.followUps.length, 0, "followUps starts empty");
	assertEqual(state.taskFile, undefined, "taskFile is undefined by default");
	assertEqual(state.currentCycle, 1, "currentCycle starts at 1");
}

{
	const packet = extractIssueTaskPacket(fixturePath, fixtureContent);
	const state = createInitialPairRunState("implement this", { path: fixturePath, extractedPacket: packet });
	assert(state.taskFile !== undefined, "taskFile is set when provided");
	assertEqual(state.taskFile!.path, fixturePath, "taskFile.path is correct");
	assert(state.taskFile!.extractedPacket.acceptanceCriteria.includes("Tracker state"), "taskFile.extractedPacket is set");
}

// ---------------------------------------------------------------------------
// buildNavigatorPreflightPromptForState — includes task file sections
// ---------------------------------------------------------------------------

console.log("buildNavigatorPreflightPromptForState");

{
	const state = createInitialPairRunState("plain text task");
	const prompt = buildNavigatorPreflightPromptForState(state, "npm run check");
	assert(prompt.includes("plain text task"), "prompt includes task text");
	assert(prompt.includes("End Goal To Prove"), "prompt requires End Goal To Prove section");
	assert(prompt.includes("Acceptance Checklist"), "prompt requires Acceptance Checklist section");
	assert(prompt.includes("Initial Playbook Recommendation"), "prompt requires Initial Playbook Recommendation section");
}

{
	const packet = extractIssueTaskPacket(fixturePath, fixtureContent);
	const state = createInitialPairRunState("implement this", { path: fixturePath, extractedPacket: packet });
	const prompt = buildNavigatorPreflightPromptForState(state, undefined);
	assert(prompt.includes(fixturePath), "prompt includes raw file path");
	assert(prompt.includes("Acceptance criteria"), "prompt includes extracted acceptance criteria heading");
	assert(prompt.includes("Tracker state is read from disk"), "prompt includes extracted AC text");
}

// ---------------------------------------------------------------------------
// freezePreflightIntoState — valid preflight
// ---------------------------------------------------------------------------

console.log("freezePreflightIntoState — valid preflight");

{
	const preflightText = `## End Goal To Prove
All acceptance criteria are proven with tests.

## Acceptance Checklist
- [ ] The module parses file references correctly. [structural]
- [ ] File content is extracted into a packet. [runtime]

## Risks
- File system access could fail on permission issues.

## Initial Playbook Recommendation
skill-tdd

## First Cycle Objective
Write failing tests for detectFileReference.`;

	const state = createInitialPairRunState("parse file references");
	const { frozenState, errors } = freezePreflightIntoState(preflightText, state);
	assertEqual(errors.length, 0, "no errors for valid preflight");
	assertEqual(frozenState.endGoalToProve, "All acceptance criteria are proven with tests.", "endGoalToProve frozen from preflight");
	assertEqual(frozenState.acceptanceChecklist.length, 2, "two acceptance criteria parsed");
	assertEqual(frozenState.acceptanceChecklist[0].text, "The module parses file references correctly.", "first criterion text");
	assertEqual(frozenState.acceptanceChecklist[0].proofClass, "structural", "first criterion proof class");
	assertEqual(frozenState.acceptanceChecklist[1].text, "File content is extracted into a packet.", "second criterion text");
	assertEqual(frozenState.acceptanceChecklist[1].proofClass, "runtime", "second criterion proof class");
	assertEqual(frozenState.initialPlaybookRecommendation, "skill-tdd", "initialPlaybookRecommendation frozen");
	assertEqual(frozenState.activePlaybook, "skill-tdd", "activePlaybook set from recommendation");
}

// ---------------------------------------------------------------------------
// freezePreflightIntoState — mixed proof class
// ---------------------------------------------------------------------------

{
	const preflightText = `## End Goal To Prove
Feature is proven.

## Acceptance Checklist
- [ ] Integration test passes. [mixed]

## Initial Playbook Recommendation
skill-tdd

## First Cycle Objective
write test`;

	const state = createInitialPairRunState("feature");
	const { frozenState, errors } = freezePreflightIntoState(preflightText, state);
	assertEqual(errors.length, 0, "mixed proof class is valid");
	assertEqual(frozenState.acceptanceChecklist[0].proofClass, "mixed", "mixed proof class parsed");
}

// ---------------------------------------------------------------------------
// freezePreflightIntoState — multiple acceptance bullets (one vertical slice)
// ---------------------------------------------------------------------------

{
	const preflightText = `## End Goal To Prove
The extraction module is complete.

## Acceptance Checklist
- [ ] File URL detection works. [structural]
- [ ] Windows path detection works. [structural]
- [ ] Unix path detection works. [structural]
- [ ] AC extraction works. [runtime]
- [ ] Constraints extraction works. [structural]

## Initial Playbook Recommendation
skill-tdd

## First Cycle Objective
Start with detection tests`;

	const state = createInitialPairRunState("build extractor");
	const { frozenState, errors } = freezePreflightIntoState(preflightText, state);
	assertEqual(errors.length, 0, "multiple bullets for one slice produce no errors");
	assertEqual(frozenState.acceptanceChecklist.length, 5, "five criteria parsed");
}

// ---------------------------------------------------------------------------
// freezePreflightIntoState — missing End Goal To Prove (vague task blocking)
// ---------------------------------------------------------------------------

console.log("freezePreflightIntoState — vague task blocking");

{
	const preflightText = `## Acceptance Checklist
- [ ] Something. [structural]

## Initial Playbook Recommendation
skill-tdd

## First Cycle Objective
start`;

	const state = createInitialPairRunState("do something vague");
	const { errors } = freezePreflightIntoState(preflightText, state);
	assert(errors.length > 0, "missing End Goal To Prove produces errors");
	assert(errors.some(e => e.toLowerCase().includes("end goal")), "error mentions end goal");
}

{
	const preflightText = `## End Goal To Prove

## Acceptance Checklist
- [ ] Something. [structural]

## Initial Playbook Recommendation
skill-tdd

## First Cycle Objective
start`;

	const state = createInitialPairRunState("do something vague");
	const { errors } = freezePreflightIntoState(preflightText, state);
	assert(errors.length > 0, "empty End Goal To Prove produces errors");
}

// ---------------------------------------------------------------------------
// freezePreflightIntoState — invalid proof class
// ---------------------------------------------------------------------------

{
	const preflightText = `## End Goal To Prove
Feature done.

## Acceptance Checklist
- [ ] Thing works. [fuzzy]

## Initial Playbook Recommendation
skill-tdd

## First Cycle Objective
start`;

	const state = createInitialPairRunState("feature");
	const { errors } = freezePreflightIntoState(preflightText, state);
	assert(errors.length > 0, "invalid proof class produces errors");
	assert(errors.some(e => e.toLowerCase().includes("proof class")), "error mentions proof class");
}

// ---------------------------------------------------------------------------
// freezePreflightIntoState — missing Initial Playbook Recommendation
// ---------------------------------------------------------------------------

{
	const preflightText = `## End Goal To Prove
Feature done.

## Acceptance Checklist
- [ ] Thing works. [structural]

## First Cycle Objective
start`;

	const state = createInitialPairRunState("feature");
	const { errors } = freezePreflightIntoState(preflightText, state);
	assert(errors.length > 0, "missing Initial Playbook Recommendation produces errors");
}

// ---------------------------------------------------------------------------
// freezePreflightIntoState — issue-file task: End Goal must copy AC verbatim
// ---------------------------------------------------------------------------

console.log("freezePreflightIntoState — issue-file verbatim end goal");

{
	const packet = extractIssueTaskPacket(fixturePath, fixtureContent);
	// Build a preflight that copies the AC verbatim
	const acText = packet.acceptanceCriteria;
	const preflightText = `## End Goal To Prove
${acText}

## Acceptance Checklist
- [ ] Tracker state is read from disk at initialize and written on every mutation. [runtime]
- [ ] Each undo entry records a terminal reason string (at most 200 chars). [structural]
- [ ] Tests cover missing state file, corrupted state file, and normal round-trip. [structural]
- [ ] npm run check passes with zero type errors. [structural]

## Initial Playbook Recommendation
skill-tdd

## First Cycle Objective
write failing tests`;

	const state = createInitialPairRunState(
		"implement issue",
		{ path: fixturePath, extractedPacket: packet },
	);
	const { frozenState, errors } = freezePreflightIntoState(preflightText, state);
	assertEqual(errors.length, 0, "verbatim AC copy in end goal produces no errors for issue-file task");
	assert(frozenState.taskFile !== undefined, "taskFile preserved in frozen state");
}

{
	const packet = extractIssueTaskPacket(fixturePath, fixtureContent);
	// Non-verbatim end goal for issue-file task
	const preflightText = `## End Goal To Prove
The implementation will be good.

## Acceptance Checklist
- [ ] Thing works. [structural]

## Initial Playbook Recommendation
skill-tdd

## First Cycle Objective
start`;

	const state = createInitialPairRunState(
		"implement issue",
		{ path: fixturePath, extractedPacket: packet },
	);
	const { errors } = freezePreflightIntoState(preflightText, state);
	assert(errors.length > 0, "non-verbatim end goal for issue-file task produces errors");
	assert(errors.some(e => e.toLowerCase().includes("verbatim") || e.toLowerCase().includes("acceptance criteria")), "error mentions verbatim or acceptance criteria");
}

// ---------------------------------------------------------------------------
// validatePreflightEndGoal — standalone validation
// ---------------------------------------------------------------------------

console.log("validatePreflightEndGoal");

{
	const result = validatePreflightEndGoal("All tests pass and the module is complete.", undefined);
	assert(result.valid, "concrete end goal is valid for plain-text task");
}

{
	const result = validatePreflightEndGoal("", undefined);
	assert(!result.valid, "empty end goal is invalid");
	assert(result.reason !== undefined, "reason provided for invalid end goal");
}

{
	const result = validatePreflightEndGoal("   ", undefined);
	assert(!result.valid, "whitespace-only end goal is invalid");
}

{
	const packet = extractIssueTaskPacket(fixturePath, fixtureContent);
	const acText = packet.acceptanceCriteria;
	const result = validatePreflightEndGoal(acText, { path: fixturePath, extractedPacket: packet });
	assert(result.valid, "AC verbatim copy is valid for issue-file task");
}

{
	const packet = extractIssueTaskPacket(fixturePath, fixtureContent);
	const result = validatePreflightEndGoal("Implementation looks good.", { path: fixturePath, extractedPacket: packet });
	assert(!result.valid, "non-verbatim end goal is invalid for issue-file task");
}

// ---------------------------------------------------------------------------
// Amendment types
// ---------------------------------------------------------------------------

console.log("Amendment types");

{
	const amendment: Amendment = {
		kind: "contradiction",
		description: "Step X contradicts constraint Y.",
		accepted: false,
	};
	assertEqual(amendment.kind, "contradiction", "contradiction amendment kind");
	assertEqual(amendment.accepted, false, "amendment starts not accepted");
}

{
	const validKinds: Amendment["kind"][] = [
		"contradiction",
		"ambiguity",
		"implied_missing_requirement",
		"safety_verification_gap",
	];
	assert(validKinds.length === 4, "four amendment kinds defined");
}

// ---------------------------------------------------------------------------
// PairRunState — serializable to JSON (auditability)
// ---------------------------------------------------------------------------

console.log("PairRunState — JSON serializable");

{
	const state = createInitialPairRunState("test task");
	const json = JSON.stringify(state);
	const parsed = JSON.parse(json) as PairRunState;
	assertEqual(parsed.task, "test task", "state round-trips through JSON");
	assertEqual(parsed.currentCycle, 1, "currentCycle round-trips");
	assert(Array.isArray(parsed.acceptanceChecklist), "acceptanceChecklist is array after JSON");
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
	console.error("\nFailures:");
	for (const f of failures) console.error(`  - ${f}`);
	process.exit(1);
} else {
	console.log("All tests passed.");
}
