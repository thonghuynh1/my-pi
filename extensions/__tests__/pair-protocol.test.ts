import {
	buildDriverCyclePrompt,
	createInitialPairRunMemory,
	parseNavigatorDecision,
	runPairProtocolDryRun,
	statusFromNavigatorDecision,
} from "../pair-protocol.ts";

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
	const prompt = buildDriverCyclePrompt(createInitialPairRunMemory("demo"), "handoff", "npm run check");
	assert(prompt.includes("call or use skill-tdd"), "Driver prompt instructs Driver to use skill-tdd");
	assert(prompt.includes("must not edit files"), "Driver prompt forbids editing files in dry-run mode");
	assert(prompt.includes("install dependencies"), "Driver prompt forbids dependency installation in dry-run mode");
	assert(prompt.includes("## Summary"), "Driver prompt requires Summary heading");
	assert(prompt.includes("## Next Intent"), "Driver prompt requires Next Intent heading");
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

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
	console.error("\nFailures:");
	for (const f of failures) console.error(`  - ${f}`);
	process.exit(1);
} else {
	console.log("All tests passed.");
}
