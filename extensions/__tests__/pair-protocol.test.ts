import {
	buildDriverCyclePrompt,
	buildTranscriptBasename,
	createInitialPairRunMemory,
	parseChangedFilesFromGitStatus,
	parseNavigatorDecision,
	runPairProtocolDryRun,
	statusFromNavigatorDecision,
	truncateText,
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

console.log("parseNavigatorDecision");

{
	const parsed = parseNavigatorDecision("Looks good.\nDECISION: approve_next");
	assert(parsed.kind === "valid", "parses approve_next decision");
	if (parsed.kind === "valid") assertEqual(parsed.value, "approve_next", "returns approve_next value");
}

{
	const parsed = parseNavigatorDecision("DECISION: request_revision\n## Correction Packet\nDo this.\n## Required Evidence\nShow that.");
	assert(parsed.kind === "valid", "parses request_revision decision");
	if (parsed.kind === "valid") assertEqual(parsed.value, "request_revision", "returns request_revision value");
}

{
	const parsed = parseNavigatorDecision("DECISION: blocked");
	assert(parsed.kind === "valid", "parses blocked decision");
	if (parsed.kind === "valid") assertEqual(parsed.value, "blocked", "returns blocked value");
}

{
	const parsed = parseNavigatorDecision("DECISION: final_approve");
	assert(parsed.kind === "valid", "parses final_approve decision");
	if (parsed.kind === "valid") assertEqual(parsed.value, "final_approve", "returns final_approve value");
}

{
	const parsed = parseNavigatorDecision("No decision here.");
	assertEqual(parsed.kind, "malformed", "missing decision is malformed");
}

{
	const parsed = parseNavigatorDecision("DECISION: maybe");
	assertEqual(parsed.kind, "malformed", "unknown decision is malformed");
}

{
	const parsed = parseNavigatorDecision("DECISION: approve_next\nDECISION: final_approve");
	assertEqual(parsed.kind, "malformed", "multiple decisions are malformed");
}

console.log("statusFromNavigatorDecision");

assertEqual(statusFromNavigatorDecision("blocked"), "blocked", "blocked maps to runtime blocked");
assertEqual(statusFromNavigatorDecision("final_approve"), "success", "final_approve maps to runtime success");
assertEqual(statusFromNavigatorDecision("approve_next"), null, "approve_next keeps loop running");
assertEqual(statusFromNavigatorDecision("request_revision"), null, "request_revision keeps loop running");

console.log("buildDriverCyclePrompt");

{
	const prompt = buildDriverCyclePrompt(createInitialPairRunMemory("demo"), "handoff", "npm run check", undefined, true);
	assert(prompt.includes("call or use skill-tdd"), "Driver prompt instructs Driver to use skill-tdd");
	assert(prompt.includes("must not edit files"), "dry-run Driver prompt forbids editing files");
	assert(prompt.includes("install dependencies"), "dry-run Driver prompt forbids dependency installation");
	assert(prompt.includes("## Summary"), "Driver prompt requires Summary heading");
	assert(prompt.includes("## Next Intent"), "Driver prompt requires Next Intent heading");
}

{
	const prompt = buildDriverCyclePrompt(createInitialPairRunMemory("demo"), "handoff", "npm run check", undefined, false);
	assert(prompt.includes("may edit and write files"), "work-mode Driver prompt allows editing files");
	assert(!prompt.includes("must not edit files"), "work-mode Driver prompt does not forbid editing");
}

console.log("runPairProtocolDryRun");

{
	let repairPrompts = 0;
	const result = await runPairProtocolDryRun(
		{
			navigatorPreflight: async () => "## Acceptance Checklist\n- done\n## Risks\n- none\n## First Cycle Objective\ninspect",
			driverCycle: async () => "## Summary\nchecked\n## Changed Files\nnone\n## Tests Run\nnone\n## Evidence\ndry run\n## Acceptance Checklist Progress\ncovered\n## Next Intent\nfinish",
			navigatorReview: async () => "Looks fine but malformed.",
			navigatorDecisionRepair: async () => {
				repairPrompts++;
				return "Corrected.\nDECISION: final_approve";
			},
			driverCorrection: async () => "should not be called",
		},
		{ task: "demo", maxCycles: 1 },
	);
	assertEqual(repairPrompts, 1, "malformed Navigator output triggers exactly one repair prompt");
	assertEqual(result.malformedDecisionRepairs, 1, "result records one malformed decision repair");
	assertEqual(result.status, "success", "repaired final_approve maps to success");
}

{
	let repairPrompts = 0;
	const result = await runPairProtocolDryRun(
		{
			navigatorPreflight: async () => "## Acceptance Checklist\n- done\n## Risks\n- none\n## First Cycle Objective\ninspect",
			driverCycle: async () => "## Summary\nchecked\n## Changed Files\nnone\n## Tests Run\nnone\n## Evidence\ndry run\n## Acceptance Checklist Progress\ncovered\n## Next Intent\nfinish",
			navigatorReview: async () => "No decision.",
			navigatorDecisionRepair: async () => {
				repairPrompts++;
				return "Still no decision.";
			},
			driverCorrection: async () => "should not be called",
		},
		{ task: "demo", maxCycles: 1 },
	);
	assertEqual(repairPrompts, 1, "malformed output is repaired only once");
	assertEqual(result.status, "blocked", "repeated malformed Navigator output blocks runtime");
	assertEqual(result.stopReason, "malformed_decision_after_repair", "blocked reason names malformed repair failure");
}

{
	let cycles = 0;
	const result = await runPairProtocolDryRun(
		{
			navigatorPreflight: async () => "## Acceptance Checklist\n- done\n## Risks\n- none\n## First Cycle Objective\ninspect",
			driverCycle: async () => {
				cycles++;
				return "## Summary\nchecked\n## Changed Files\nnone\n## Tests Run\nnone\n## Evidence\ndry run\n## Acceptance Checklist Progress\npartial\n## Next Intent\ncontinue";
			},
			navigatorReview: async () => "DECISION: approve_next",
			navigatorDecisionRepair: async () => "should not be called",
			driverCorrection: async () => "should not be called",
		},
		{ task: "demo", maxCycles: 2 },
	);
	assertEqual(cycles, 2, "max cycles runs exactly the configured cycle count");
	assertEqual(result.status, "incomplete", "max cycles without final approval maps to incomplete");
	assertEqual(result.stopReason, "max_cycles_without_final_approval", "incomplete reason names max cycles");
}

{
	let corrections = 0;
	const result = await runPairProtocolDryRun(
		{
			navigatorPreflight: async () => "## Acceptance Checklist\n- done\n## Risks\n- none\n## First Cycle Objective\ninspect",
			driverCycle: async () => "## Summary\nchecked\n## Changed Files\nnone\n## Tests Run\nnone\n## Evidence\ndry run\n## Acceptance Checklist Progress\npartial\n## Next Intent\nrevise",
			navigatorReview: async () => corrections === 0 ? "DECISION: request_revision\n## Correction Packet\nclarify\n## Required Evidence\nreport" : "DECISION: final_approve",
			navigatorDecisionRepair: async () => "should not be called",
			driverCorrection: async () => {
				corrections++;
				return "## Correction Packet Addressed\nclarified\n## Changed Files\nnone\n## Tests Run\nnone\n## Evidence\nreported\n## Remaining Risk\nnone";
			},
		},
		{ task: "demo", maxCycles: 1 },
	);
	assertEqual(corrections, 1, "request_revision triggers one Driver correction packet");
	assertEqual(result.status, "success", "final approval after correction maps to success");
}

console.log("collectEvidence + finalVerification");

{
	let evidenceCalls = 0;
	let verificationCommand = "";
	const result = await runPairProtocolDryRun(
		{
			navigatorPreflight: async () => "## Acceptance Checklist\n- done\n## Risks\n- none\n## First Cycle Objective\ninspect",
			driverCycle: async () => "## Summary\nchecked\n## Changed Files\nnone\n## Tests Run\nnone\n## Evidence\ndry run\n## Acceptance Checklist Progress\ncovered\n## Next Intent\nfinish",
			navigatorReview: async () => "DECISION: final_approve",
			navigatorDecisionRepair: async () => "should not be called",
			driverCorrection: async () => "should not be called",
		},
		{
			task: "demo with evidence",
			maxCycles: 1,
			testCommand: "npm test",
			collectEvidence: async () => {
				evidenceCalls++;
				return { gitStatusShort: "M file.ts", gitDiffStat: "1 file changed", gitDiff: "+line1\n+line2" };
			},
			runFinalVerification: async (cmd) => {
				verificationCommand = cmd;
				return { command: cmd, exitCode: 0, summary: "all tests passed" };
			},
		},
	);
	assertEqual(evidenceCalls, 1, "collectEvidence called once at start");
	assertEqual(verificationCommand, "npm test", "final verification uses testCommand");
	assert(result.initialWorkspace !== undefined, "result includes initialWorkspace");
	assertEqual(result.initialWorkspace?.gitStatusShort, "M file.ts", "workspace snapshot has git status");
	assertEqual(result.initialWorkspace?.gitDiff, "+line1\n+line2", "workspace snapshot has git diff");
	assert(result.finalVerification !== undefined, "result includes finalVerification when final_approve");
	assertEqual(result.finalVerification?.exitCode, 0, "final verification exit code captured");
}

{
	let verificationCalled = false;
	const result = await runPairProtocolDryRun(
		{
			navigatorPreflight: async () => "## Acceptance Checklist\n- done\n## Risks\n- none\n## First Cycle Objective\ninspect",
			driverCycle: async () => "## Summary\nchecked\n## Changed Files\nnone\n## Tests Run\nnone\n## Evidence\ndry run\n## Acceptance Checklist Progress\ncovered\n## Next Intent\nfinish",
			navigatorReview: async () => "DECISION: approve_next",
			navigatorDecisionRepair: async () => "should not be called",
			driverCorrection: async () => "should not be called",
		},
		{
			task: "no verify on approve_next",
			maxCycles: 1,
			testCommand: "npm test",
			runFinalVerification: async () => {
				verificationCalled = true;
				return { command: "npm test", exitCode: 0, summary: "ok" };
			},
		},
	);
	assertEqual(verificationCalled, false, "final verification not called on approve_next (max cycles)");
	assertEqual(result.finalVerification, undefined, "no finalVerification in result when not final_approve");
}

console.log("truncateText");

{
	const result = truncateText("short", 100);
	assertEqual(result, "short", "returns text unchanged when under max length");
}

{
	const result = truncateText("a".repeat(100), 50);
	assert(result.length < 100, "truncates text exceeding max length");
	assert(result.endsWith("...(truncated)"), "truncated text ends with indicator");
	assertEqual(result.length, 50, "truncated text equals max length");
}

{
	const result = truncateText("exact", 5);
	assertEqual(result, "exact", "returns text unchanged when exactly at max length");
}

console.log("clarification flow");

{
	let clarificationCalls = 0;
	let correctionCalls = 0;
	let correctionResolved = false;
	const result = await runPairProtocolDryRun(
		{
			navigatorPreflight: async () => "## Acceptance Checklist\n- done\n## Risks\n- none\n## First Cycle Objective\ninspect",
			driverCycle: async () => "## Summary\nchecked\n## Changed Files\nnone\n## Tests Run\nnone\n## Evidence\ndry run\n## Acceptance Checklist Progress\npartial\n## Next Intent\nrevise",
			navigatorReview: async () => correctionResolved
				? "DECISION: final_approve"
				: "DECISION: request_revision\n## Correction Packet\nfix this\n## Required Evidence\nshow that",
			navigatorDecisionRepair: async () => "should not be called",
			driverCorrection: async () => {
				correctionCalls++;
				if (correctionCalls === 1) return "## Clarification Needed\nwhat exactly?";
				correctionResolved = true;
				return "## Correction Packet Addressed\nfixed\n## Changed Files\nnone\n## Tests Run\nnone\n## Evidence\nreported\n## Remaining Risk\nnone";
			},
			navigatorClarification: async (prompt) => {
				clarificationCalls++;
				assert(prompt.includes("Driver needs clarification"), "clarification prompt mentions Driver need");
				return "The answer is X.";
			},
		},
		{ task: "demo with clarification", maxCycles: 1 },
	);
	assertEqual(clarificationCalls, 1, "navigator clarification called once");
	assertEqual(correctionCalls, 2, "driver correction called twice (clarification + correction)");
	assertEqual(result.status, "success", "flow completes successfully after clarification");
}

console.log("verification failure sent to Navigator");

{
	let classificationCalls = 0;
	const result = await runPairProtocolDryRun(
		{
			navigatorPreflight: async () => "## Acceptance Checklist\n- done\n## Risks\n- none\n## First Cycle Objective\ninspect",
			driverCycle: async () => "## Summary\nchecked\n## Changed Files\nnone\n## Tests Run\nnone\n## Evidence\ndry run\n## Acceptance Checklist Progress\ncovered\n## Next Intent\nfinish",
			navigatorReview: async () => "DECISION: final_approve",
			navigatorDecisionRepair: async () => "should not be called",
			driverCorrection: async () => "should not be called",
			navigatorClarification: async (prompt) => {
				classificationCalls++;
				assert(prompt.includes("Final verification failed"), "classification prompt mentions verification failure");
				assert(prompt.includes("exit code 1"), "classification prompt includes exit code");
				return "DECISION: blocked";
			},
		},
		{
			task: "demo with failed verification",
			maxCycles: 1,
			testCommand: "npm test",
			runFinalVerification: async () => ({ command: "npm test", exitCode: 1, summary: "tests failed" }),
		},
	);
	assertEqual(classificationCalls, 1, "Navigator classification called on verification failure");
	assertEqual(result.status, "blocked", "blocked when Navigator classifies verification failure as blocker");
	assertEqual(result.stopReason, "navigator_blocked", "stop reason is navigator_blocked");
}

console.log("blocked only from Navigator");

{
	const result = await runPairProtocolDryRun(
		{
			navigatorPreflight: async () => "## Acceptance Checklist\n- done\n## Risks\n- none\n## First Cycle Objective\ninspect",
			driverCycle: async () => "## Summary\nchecked\n## Changed Files\nnone\n## Tests Run\nnone\n## Evidence\ndry run\n## Acceptance Checklist Progress\npartial\n## Next Intent\ncontinue",
			navigatorReview: async () => "DECISION: approve_next",
			navigatorDecisionRepair: async () => "should not be called",
			driverCorrection: async () => "should not be called",
		},
		{ task: "demo not blocked", maxCycles: 1 },
	);
	assert(result.status !== "blocked", "status is not blocked when Navigator does not say blocked");
}

console.log("cycles + finalNavigatorDecision");

{
	const result = await runPairProtocolDryRun(
		{
			navigatorPreflight: async () => "## Acceptance Checklist\n- done\n## Risks\n- none\n## First Cycle Objective\ninspect",
			driverCycle: async () => "## Summary\nchecked\n## Changed Files\nnone\n## Tests Run\nnone\n## Evidence\ndry run\n## Acceptance Checklist Progress\ncovered\n## Next Intent\nfinish",
			navigatorReview: async () => "DECISION: final_approve",
			navigatorDecisionRepair: async () => "should not be called",
			driverCorrection: async () => "should not be called",
		},
		{ task: "structured cycles", maxCycles: 1 },
	);
	assertEqual(result.cycles.length, 1, "exactly one cycle record on single-cycle final_approve");
	assertEqual(result.cycles[0].cycle, 1, "cycle record numbered 1");
	assert(typeof result.cycles[0].driverReport === "string" && result.cycles[0].driverReport!.includes("## Summary"), "cycle record captures driver report");
	assert(typeof result.cycles[0].navigatorReview === "string" && result.cycles[0].navigatorReview!.includes("DECISION: final_approve"), "cycle record captures navigator review");
	assertEqual(result.cycles[0].navigatorDecision, "final_approve", "cycle record captures decision value");
	assertEqual(result.finalNavigatorDecision, "final_approve", "result records final_approve as final decision");
}

{
	const result = await runPairProtocolDryRun(
		{
			navigatorPreflight: async () => "## Acceptance Checklist\n- done\n## Risks\n- none\n## First Cycle Objective\ninspect",
			driverCycle: async () => "## Summary\nchecked\n## Changed Files\nnone\n## Tests Run\nnone\n## Evidence\ndry run\n## Acceptance Checklist Progress\ncovered\n## Next Intent\nfinish",
			navigatorReview: async () => "DECISION: blocked",
			navigatorDecisionRepair: async () => "should not be called",
			driverCorrection: async () => "should not be called",
		},
		{ task: "blocked decision", maxCycles: 1 },
	);
	assertEqual(result.finalNavigatorDecision, "blocked", "result records blocked as final decision");
}

{
	const result = await runPairProtocolDryRun(
		{
			navigatorPreflight: async () => "## Acceptance Checklist\n- done\n## Risks\n- none\n## First Cycle Objective\ninspect",
			driverCycle: async () => "## Summary\nchecked\n## Changed Files\nnone\n## Tests Run\nnone\n## Evidence\ndry run\n## Acceptance Checklist Progress\ncovered\n## Next Intent\nfinish",
			navigatorReview: async () => "No decision here.",
			navigatorDecisionRepair: async () => "Still no decision.",
			driverCorrection: async () => "should not be called",
		},
		{ task: "malformed final", maxCycles: 1 },
	);
	assertEqual(result.cycles.length, 1, "malformed result still produces a cycle record");
	assertEqual(result.cycles[0].navigatorDecision, "malformed", "malformed decision recorded as 'malformed'");
	assertEqual(result.finalNavigatorDecision, undefined, "no finalNavigatorDecision when last review is malformed");
}

console.log("collectFinalEvidence");

{
	let initialCalls = 0;
	let finalCalls = 0;
	const result = await runPairProtocolDryRun(
		{
			navigatorPreflight: async () => "## Acceptance Checklist\n- done\n## Risks\n- none\n## First Cycle Objective\ninspect",
			driverCycle: async () => "## Summary\nchecked\n## Changed Files\nnone\n## Tests Run\nnone\n## Evidence\ndry run\n## Acceptance Checklist Progress\ncovered\n## Next Intent\nfinish",
			navigatorReview: async () => "DECISION: final_approve",
			navigatorDecisionRepair: async () => "should not be called",
			driverCorrection: async () => "should not be called",
		},
		{
			task: "with final evidence",
			maxCycles: 1,
			collectEvidence: async () => {
				initialCalls++;
				return { gitStatusShort: "", gitDiffStat: "", gitDiff: "" };
			},
			collectFinalEvidence: async () => {
				finalCalls++;
				return { gitStatusShort: " M extensions/foo.ts", gitDiffStat: "1 file changed", gitDiff: "+ added" };
			},
		},
	);
	assertEqual(initialCalls, 1, "initial collectEvidence called once");
	assertEqual(finalCalls, 1, "collectFinalEvidence called once on final_approve");
	assert(result.finalWorkspace !== undefined, "result includes finalWorkspace");
	assertEqual(result.finalWorkspace?.gitStatusShort, " M extensions/foo.ts", "finalWorkspace captured");
}

{
	let finalCalls = 0;
	const result = await runPairProtocolDryRun(
		{
			navigatorPreflight: async () => "## Acceptance Checklist\n- done\n## Risks\n- none\n## First Cycle Objective\ninspect",
			driverCycle: async () => "## Summary\nchecked\n## Changed Files\nnone\n## Tests Run\nnone\n## Evidence\ndry run\n## Acceptance Checklist Progress\npartial\n## Next Intent\ncontinue",
			navigatorReview: async () => "DECISION: approve_next",
			navigatorDecisionRepair: async () => "should not be called",
			driverCorrection: async () => "should not be called",
		},
		{
			task: "max cycles final evidence",
			maxCycles: 1,
			collectFinalEvidence: async () => {
				finalCalls++;
				return { gitStatusShort: "", gitDiffStat: "", gitDiff: "" };
			},
		},
	);
	assertEqual(finalCalls, 1, "collectFinalEvidence called once on max-cycles exit");
	assertEqual(result.status, "incomplete", "max-cycles still maps to incomplete");
}

console.log("parseChangedFilesFromGitStatus");

assertEqual(parseChangedFilesFromGitStatus("").length, 0, "empty status yields empty list");
{
	const files = parseChangedFilesFromGitStatus(" M src/a.ts\nM  src/b.ts\n?? new.txt");
	assertEqual(files.length, 3, "three changed paths parsed");
	assertEqual(files[0], "src/a.ts", "modified path captured");
	assertEqual(files[1], "src/b.ts", "staged-modified path captured");
	assertEqual(files[2], "new.txt", "untracked path captured");
}
{
	const files = parseChangedFilesFromGitStatus("R  old.ts -> new.ts");
	assertEqual(files.length, 1, "rename produces one path");
	assertEqual(files[0], "new.ts", "rename keeps new path");
}
{
	const files = parseChangedFilesFromGitStatus("D  removed.ts\n");
	assertEqual(files[0], "removed.ts", "deleted path captured");
}

console.log("buildTranscriptBasename");

{
	const base = buildTranscriptBasename("Implement transcripts!", new Date("2025-06-01T12:34:56.789Z"));
	assertEqual(base, "2025-06-01T12-34-56-implement-transcripts", "produces timestamp + slug");
}

{
	const base = buildTranscriptBasename("", new Date("2025-06-01T12:34:56.789Z"));
	assertEqual(base, "2025-06-01T12-34-56-task", "empty task slug falls back to 'task'");
}

{
	const base = buildTranscriptBasename("a".repeat(120), new Date("2025-06-01T12:34:56.789Z"));
	assert(base.endsWith("-" + "a".repeat(60)), "long task is truncated to 60 chars");
}

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
	console.error("\nFailures:");
	for (const f of failures) console.error(`  - ${f}`);
	process.exit(1);
} else {
	console.log("All tests passed.");
}
