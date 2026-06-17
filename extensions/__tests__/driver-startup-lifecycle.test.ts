/**
 * Tests for Driver pstack startup ritual and playbook lifecycle enforcement.
 *
 * Covers: DEC-011, DEC-012, DEC-013, DEC-023
 * Acceptance criteria: startup validation, repair, playbook override policy,
 * switch amendment policy, and registry/telemetry cross-checking.
 *
 * Run: npx tsx extensions/__tests__/driver-startup-lifecycle.test.ts
 */

import {
	validateDriverStartup,
	validatePlaybookSwitch,
	crossCheckLeavesAgainstTelemetry,
	DRIVER_STARTUP_REQUIRED_SECTIONS,
	OVERRIDE_PACKET_REQUIRED_FIELDS,
	normalizePlaybookSlug,
	parsePstackRegistry,
	type PstackRegistry,
	type DriverStartupValidationResult,
} from "../lib/pair-program-helpers.ts";

import {
	buildDriverStartupRepairPrompt,
	runPairProtocolDryRun,
	type PstackRegistryForProtocol,
	type DriverFirstTurnContext,
} from "../lib/pair-protocol.ts";

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string): void {
	if (condition) {
		passed++;
	} else {
		failed++;
		failures.push(message);
		console.error(`  FAIL: ${message}`);
	}
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
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
// Shared fixtures
// ---------------------------------------------------------------------------

const SAMPLE_DESCRIPTION = `pstack skill reference. Available names:

Skills:
  - architect
  - figure-it-out
  - how
  - poteto-mode
  - show-me-your-work
  - unslop
  - typescript-best-practices
  - principle-prove-it-works
  - principle-laziness-protocol

Playbooks:
  - poteto-mode/playbooks/bug-fix
  - poteto-mode/playbooks/refactoring
  - poteto-mode/playbooks/session-pickup
  - poteto-mode/playbooks/investigation`;

const registry: PstackRegistry = parsePstackRegistry(SAMPLE_DESCRIPTION);

function makeValidStartup(overrides?: { playbook?: string; leaves?: string[]; override?: boolean }): string {
	const playbook = overrides?.playbook ?? "bug-fix";
	const leaves = overrides?.leaves ?? ["poteto-mode", "principle-prove-it-works"];
	const overrideSection = overrides?.override
		? `## Override Packet\nRecommended: investigation\nChosen: ${playbook}\nEvidence: task is a bug, not an investigation\nPinned Goal: fix the root cause faster`
		: "";

	return [
		"## Todo List",
		"1. Read principles",
		"2. Load playbook",
		"3. Implement",
		"## Principles Read",
		"- principle-prove-it-works",
		"- principle-laziness-protocol",
		`## Selected Playbook`,
		`${playbook}`,
		"## Playbook Steps",
		"1. Reproduce the bug",
		"2. Root cause",
		"3. Fix and verify",
		"## Loaded Leaves",
		...leaves.map((l) => `- ${l}`),
		"## Skipped Steps",
		"- trace forensics: not needed for this fix",
		overrideSection,
	].filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------------
// validateDriverStartup tests
// ---------------------------------------------------------------------------

console.log("validateDriverStartup — valid startup");

{
	const result = validateDriverStartup(makeValidStartup(), registry, "bug-fix");
	assert(result.valid, "complete valid startup passes");
	assertEqual(result.errors.length, 0, "no errors for valid startup");
	assertEqual(result.parsedPlaybook, "bug-fix", "parsed playbook extracted");
	assert(result.parsedLeaves !== undefined, "parsed leaves extracted");
	assertEqual(result.parsedLeaves?.length, 2, "two leaves parsed");
	assertEqual(result.isOverride, false, "no override when section absent");
}

console.log("validateDriverStartup — missing sections");

{
	const incomplete = "## Todo List\n1. Read principles\n## Principles Read\n- done";
	const result = validateDriverStartup(incomplete, registry, "bug-fix");
	assert(!result.valid, "incomplete startup fails");
	assert(result.errors.length > 0, "errors reported for missing sections");
	assert(result.errors.some((e) => e.includes("Selected Playbook")), "error mentions missing Selected Playbook");
	assert(result.errors.some((e) => e.includes("Playbook Steps")), "error mentions missing Playbook Steps");
	assert(result.errors.some((e) => e.includes("Loaded Leaves")), "error mentions missing Loaded Leaves");
	assert(result.errors.some((e) => e.includes("Skipped Steps")), "error mentions missing Skipped Steps");
}

console.log("validateDriverStartup — invalid playbook slug");

{
	const result = validateDriverStartup(makeValidStartup({ playbook: "nonexistent-playbook" }), registry, "bug-fix");
	assert(!result.valid, "invalid playbook slug fails");
	assert(result.errors.some((e) => e.includes("nonexistent-playbook") && e.includes("not in the pstack registry")), "error names the invalid playbook");
}

console.log("validateDriverStartup — invalid leaf slug");

{
	const result = validateDriverStartup(makeValidStartup({ leaves: ["poteto-mode", "fake-leaf"] }), registry, "bug-fix");
	assert(!result.valid, "invalid leaf slug fails");
	assert(result.errors.some((e) => e.includes("fake-leaf") && e.includes("not in the pstack registry")), "error names the invalid leaf");
}

console.log("validateDriverStartup — valid leaves with full path");

{
	const result = validateDriverStartup(makeValidStartup({ leaves: ["poteto-mode/playbooks/bug-fix", "architect"] }), registry, "bug-fix");
	assert(result.valid, "full-path leaf names are valid");
}

console.log("validateDriverStartup — override packet");

{
	const result = validateDriverStartup(
		makeValidStartup({ playbook: "bug-fix", override: true }),
		registry,
		"investigation",
	);
	assert(result.valid, "valid override passes");
	assert(result.isOverride === true, "isOverride is true when override section present");
	assert(result.overridePacket !== undefined, "overridePacket is parsed");
	assertEqual(result.overridePacket?.recommended, "investigation", "override recommended field parsed");
	assertEqual(result.overridePacket?.chosen, "bug-fix", "override chosen field parsed");
	assert((result.overridePacket?.evidence?.length ?? 0) > 0, "override evidence field parsed");
	assert((result.overridePacket?.pinnedGoal?.length ?? 0) > 0, "override pinnedGoal field parsed");
}

console.log("validateDriverStartup — override with missing fields");

{
	const badOverride = makeValidStartup() + "\n## Override Packet\nRecommended: investigation\nChosen: bug-fix";
	const result = validateDriverStartup(badOverride, registry, "investigation");
	assert(!result.valid, "override with missing fields fails");
	assert(result.errors.some((e) => e.includes("Evidence")), "error mentions missing Evidence field");
	assert(result.errors.some((e) => e.includes("Pinned Goal")), "error mentions missing Pinned Goal field");
}

console.log("validateDriverStartup — override with invalid chosen playbook");

{
	const badChosen = [
		"## Todo List\n1. done",
		"## Principles Read\n- done",
		"## Selected Playbook\nnonexistent",
		"## Playbook Steps\n1. step",
		"## Loaded Leaves\n- poteto-mode",
		"## Skipped Steps\n- none: n/a",
		"## Override Packet\nRecommended: investigation\nChosen: nonexistent\nEvidence: reason\nPinned Goal: goal",
	].join("\n");
	const result = validateDriverStartup(badChosen, registry, "investigation");
	assert(!result.valid, "override with invalid chosen playbook fails");
	assert(result.errors.some((e) => e.includes("nonexistent") && e.includes("Override Packet")), "error mentions invalid override chosen");
}

// ---------------------------------------------------------------------------
// buildDriverStartupRepairPrompt tests
// ---------------------------------------------------------------------------

console.log("buildDriverStartupRepairPrompt");

{
	const prompt = buildDriverStartupRepairPrompt("bad response", ["Missing section: ## Todo List"]);
	assert(prompt.includes("did not satisfy"), "repair prompt explains the problem");
	assert(prompt.includes("Missing section: ## Todo List"), "repair prompt lists the error");
	assert(prompt.includes("bad response"), "repair prompt includes the original response");
	assert(prompt.includes("## Todo List"), "repair prompt lists required sections");
	assert(prompt.includes("## Loaded Leaves"), "repair prompt lists Loaded Leaves");
}

// ---------------------------------------------------------------------------
// validatePlaybookSwitch tests
// ---------------------------------------------------------------------------

console.log("validatePlaybookSwitch — first turn");

{
	const result = validatePlaybookSwitch(
		{ newPlaybook: "bug-fix", reason: "task is a bug", isFirstTurn: true, startupOverrideUsed: false },
		registry,
	);
	assert(result.allowed, "first-turn override allowed when not already used");
}

{
	const result = validatePlaybookSwitch(
		{ newPlaybook: "bug-fix", reason: "task is a bug", isFirstTurn: true, startupOverrideUsed: true },
		registry,
	);
	assert(!result.allowed, "first-turn override rejected when already used");
	assert(result.reason!.includes("already used"), "reason mentions already used");
}

console.log("validatePlaybookSwitch — post first turn");

{
	const result = validatePlaybookSwitch(
		{ newPlaybook: "refactoring", reason: "blocker: tests cannot run in current structure", isFirstTurn: false, startupOverrideUsed: false },
		registry,
	);
	assert(result.allowed, "post-first-turn switch allowed with blocker reason");
}

{
	const result = validatePlaybookSwitch(
		{ newPlaybook: "refactoring", reason: "contradiction: prior playbook assumptions invalid", isFirstTurn: false, startupOverrideUsed: false },
		registry,
	);
	assert(result.allowed, "post-first-turn switch allowed with contradiction reason");
}

{
	const result = validatePlaybookSwitch(
		{ newPlaybook: "refactoring", reason: "just prefer this one", isFirstTurn: false, startupOverrideUsed: false },
		registry,
	);
	assert(!result.allowed, "post-first-turn switch rejected without blocker/contradiction");
	assert(result.reason!.includes("blocker or contradiction"), "reason explains the requirement");
}

console.log("validatePlaybookSwitch — invalid playbook");

{
	const result = validatePlaybookSwitch(
		{ newPlaybook: "nonexistent", reason: "blocker", isFirstTurn: false, startupOverrideUsed: false },
		registry,
	);
	assert(!result.allowed, "switch to invalid playbook rejected");
	assert(result.reason!.includes("not in the pstack registry"), "reason mentions registry");
}

// ---------------------------------------------------------------------------
// crossCheckLeavesAgainstTelemetry tests
// ---------------------------------------------------------------------------

console.log("crossCheckLeavesAgainstTelemetry");

{
	const result = crossCheckLeavesAgainstTelemetry(
		["poteto-mode", "architect"],
		[
			{ kind: "skill_load", targetPreview: "poteto-mode" },
			{ kind: "file_read", targetPreview: "/src/foo.ts" },
		],
	);
	assertEqual(result.verified.length, 1, "one leaf verified by telemetry");
	assertEqual(result.verified[0], "poteto-mode", "poteto-mode verified");
	assertEqual(result.unverified.length, 1, "one leaf unverified");
	assertEqual(result.unverified[0], "architect", "architect unverified (no matching telemetry)");
}

{
	const result = crossCheckLeavesAgainstTelemetry(
		["poteto-mode/playbooks/bug-fix"],
		[{ kind: "skill_load", targetPreview: "bug-fix" }],
	);
	assertEqual(result.verified.length, 1, "full-path leaf verified by slug match");
}

{
	const result = crossCheckLeavesAgainstTelemetry(
		["architect", "how"],
		[],
	);
	assertEqual(result.verified.length, 0, "no telemetry means nothing verified");
	assertEqual(result.unverified.length, 2, "all leaves unverified without telemetry");
}

{
	const result = crossCheckLeavesAgainstTelemetry(
		["architect"],
		[{ kind: "command", targetPreview: "architect" }],
	);
	assertEqual(result.verified.length, 0, "non-skill_load kind does not verify a leaf");
	assertEqual(result.unverified.length, 1, "leaf remains unverified for wrong kind");
}

// ---------------------------------------------------------------------------
// runPairProtocolDryRun with startup gate tests
// ---------------------------------------------------------------------------

console.log("runPairProtocolDryRun — startup gate validates and completes");

{
	const registryForProtocol: PstackRegistryForProtocol = {
		allNames: registry.allNames,
		skills: registry.skills,
		playbooks: registry.playbooks,
	};

	let firstTurnCalled = false;
	let normalCycleCalls = 0;

	const result = await runPairProtocolDryRun(
		{
			navigatorPreflight: async () => "## Acceptance Checklist\n- done\n## Risks\n- none\n## First Cycle Objective\ninspect",
			driverCycle: async (prompt) => {
				if (!firstTurnCalled) {
					firstTurnCalled = true;
					return makeValidStartup();
				}
				normalCycleCalls++;
				return "## Summary\nchecked\n## Changed Files\nnone\n## Tests Run\nnone\n## Evidence\ndry run\n## Acceptance Checklist Progress\ncovered\n## Next Intent\nfinish";
			},
			navigatorReview: async () => "DECISION: final_approve",
			navigatorDecisionRepair: async () => "should not be called",
			driverCorrection: async () => "should not be called",
		},
		{
			task: "demo startup",
			maxCycles: 1,
			pstackRegistry: registryForProtocol,
			initialPlaybookRecommendation: "bug-fix",
			renderDriverFirstTurn: (ctx) => `First turn for: ${ctx.task}`,
		},
	);
	assert(firstTurnCalled, "driver first-turn prompt was sent");
	assertEqual(normalCycleCalls, 1, "normal cycle ran after startup");
	assertEqual(result.driverStartupCompleted, true, "driverStartupCompleted is true");
	assertEqual(result.activePlaybook, "bug-fix", "activePlaybook set from startup");
	assert(result.loadedLeaves !== undefined && result.loadedLeaves.length > 0, "loadedLeaves populated");
	assertEqual(result.status, "success", "run completes successfully");
}

console.log("runPairProtocolDryRun — startup fails and blocks");

{
	const registryForProtocol: PstackRegistryForProtocol = {
		allNames: registry.allNames,
		skills: registry.skills,
		playbooks: registry.playbooks,
	};

	const result = await runPairProtocolDryRun(
		{
			navigatorPreflight: async () => "## Acceptance Checklist\n- done\n## Risks\n- none\n## First Cycle Objective\ninspect",
			driverCycle: async () => "malformed response with no sections",
			navigatorReview: async () => "should not be called",
			navigatorDecisionRepair: async () => "should not be called",
			driverCorrection: async () => "should not be called",
		},
		{
			task: "demo startup failure",
			maxCycles: 1,
			pstackRegistry: registryForProtocol,
			initialPlaybookRecommendation: "bug-fix",
			renderDriverFirstTurn: (ctx) => `First turn for: ${ctx.task}`,
		},
	);
	assertEqual(result.driverStartupCompleted, false, "driverStartupCompleted false when startup fails");
	assertEqual(result.status, "blocked", "status is blocked when startup fails");
	assertEqual(result.stopReason, "driver_startup_failed", "stop reason is driver_startup_failed");
}

console.log("runPairProtocolDryRun — startup repair succeeds");

{
	const registryForProtocol: PstackRegistryForProtocol = {
		allNames: registry.allNames,
		skills: registry.skills,
		playbooks: registry.playbooks,
	};

	let driverCalls = 0;
	const result = await runPairProtocolDryRun(
		{
			navigatorPreflight: async () => "## Acceptance Checklist\n- done\n## Risks\n- none\n## First Cycle Objective\ninspect",
			driverCycle: async () => {
				driverCalls++;
				if (driverCalls === 1) return "malformed first attempt";
				if (driverCalls === 2) return makeValidStartup(); // repair succeeds
				return "## Summary\nchecked\n## Changed Files\nnone\n## Tests Run\nnone\n## Evidence\ndry run\n## Acceptance Checklist Progress\ncovered\n## Next Intent\nfinish";
			},
			navigatorReview: async () => "DECISION: final_approve",
			navigatorDecisionRepair: async () => "should not be called",
			driverCorrection: async () => "should not be called",
		},
		{
			task: "demo startup repair",
			maxCycles: 1,
			pstackRegistry: registryForProtocol,
			initialPlaybookRecommendation: "bug-fix",
			renderDriverFirstTurn: (ctx) => `First turn for: ${ctx.task}`,
		},
	);
	assertEqual(driverCalls, 3, "driver called 3 times: startup + repair + normal cycle");
	assertEqual(result.driverStartupCompleted, true, "startup completed after repair");
	assertEqual(result.status, "success", "run succeeds after repair");
	assert(result.cycles[0]?.driverStartupReport !== undefined, "startup report recorded");
	assert(result.cycles[0]?.driverStartupRepairReport !== undefined, "repair report recorded");
}

console.log("runPairProtocolDryRun — startup repair fails then blocks");

{
	const registryForProtocol: PstackRegistryForProtocol = {
		allNames: registry.allNames,
		skills: registry.skills,
		playbooks: registry.playbooks,
	};

	let driverCalls = 0;
	const result = await runPairProtocolDryRun(
		{
			navigatorPreflight: async () => "## Acceptance Checklist\n- done\n## Risks\n- none\n## First Cycle Objective\ninspect",
			driverCycle: async () => {
				driverCalls++;
				return "still malformed after repair";
			},
			navigatorReview: async () => "should not be called",
			navigatorDecisionRepair: async () => "should not be called",
			driverCorrection: async () => "should not be called",
		},
		{
			task: "demo startup repair fail",
			maxCycles: 1,
			pstackRegistry: registryForProtocol,
			initialPlaybookRecommendation: "bug-fix",
			renderDriverFirstTurn: (ctx) => `First turn for: ${ctx.task}`,
		},
	);
	assertEqual(driverCalls, 2, "driver called twice: startup + repair");
	assertEqual(result.driverStartupCompleted, false, "startup not completed after failed repair");
	assertEqual(result.status, "blocked", "run blocked after failed repair");
}

console.log("runPairProtocolDryRun — override records override reason");

{
	const registryForProtocol: PstackRegistryForProtocol = {
		allNames: registry.allNames,
		skills: registry.skills,
		playbooks: registry.playbooks,
	};

	const result = await runPairProtocolDryRun(
		{
			navigatorPreflight: async () => "## Acceptance Checklist\n- done\n## Risks\n- none\n## First Cycle Objective\ninspect",
			driverCycle: async (prompt) => {
				if (prompt.includes("First turn")) {
					return makeValidStartup({ playbook: "bug-fix", override: true });
				}
				return "## Summary\nchecked\n## Changed Files\nnone\n## Tests Run\nnone\n## Evidence\ndry run\n## Acceptance Checklist Progress\ncovered\n## Next Intent\nfinish";
			},
			navigatorReview: async () => "DECISION: final_approve",
			navigatorDecisionRepair: async () => "should not be called",
			driverCorrection: async () => "should not be called",
		},
		{
			task: "demo override",
			maxCycles: 1,
			pstackRegistry: registryForProtocol,
			initialPlaybookRecommendation: "investigation",
			renderDriverFirstTurn: (ctx) => `First turn for: ${ctx.task}`,
		},
	);
	assertEqual(result.driverStartupCompleted, true, "startup completed with override");
	assertEqual(result.activePlaybook, "bug-fix", "active playbook set to override chosen");
	assert(result.playbookOverrideReason !== undefined, "override reason recorded");
	assert(result.playbookOverrideReason!.includes("bug"), "override reason contains evidence");
}

console.log("runPairProtocolDryRun — no registry skips startup gate");

{
	const result = await runPairProtocolDryRun(
		{
			navigatorPreflight: async () => "## Acceptance Checklist\n- done\n## Risks\n- none\n## First Cycle Objective\ninspect",
			driverCycle: async () => "## Summary\nchecked\n## Changed Files\nnone\n## Tests Run\nnone\n## Evidence\ndry run\n## Acceptance Checklist Progress\ncovered\n## Next Intent\nfinish",
			navigatorReview: async () => "DECISION: final_approve",
			navigatorDecisionRepair: async () => "should not be called",
			driverCorrection: async () => "should not be called",
		},
		{ task: "demo no registry", maxCycles: 1 },
	);
	assertEqual(result.driverStartupCompleted, true, "startup considered complete when no registry");
	assertEqual(result.status, "success", "legacy mode still works");
}

console.log("runPairProtocolDryRun — driverStartupRepair session used");

{
	const registryForProtocol: PstackRegistryForProtocol = {
		allNames: registry.allNames,
		skills: registry.skills,
		playbooks: registry.playbooks,
	};

	let repairSessionUsed = false;
	const result = await runPairProtocolDryRun(
		{
			navigatorPreflight: async () => "## Acceptance Checklist\n- done\n## Risks\n- none\n## First Cycle Objective\ninspect",
			driverCycle: async () => "malformed startup",
			navigatorReview: async () => "DECISION: final_approve",
			navigatorDecisionRepair: async () => "should not be called",
			driverCorrection: async () => "should not be called",
			driverStartupRepair: async () => {
				repairSessionUsed = true;
				return makeValidStartup();
			},
		},
		{
			task: "demo repair session",
			maxCycles: 1,
			pstackRegistry: registryForProtocol,
			initialPlaybookRecommendation: "bug-fix",
			renderDriverFirstTurn: (ctx) => `First turn for: ${ctx.task}`,
		},
	);
	assert(repairSessionUsed, "driverStartupRepair session was invoked");
	assertEqual(result.driverStartupCompleted, true, "startup completed via repair session");
}

// ---------------------------------------------------------------------------
// Driver first-turn prompt uses renderDriverFirstTurn context
// ---------------------------------------------------------------------------

console.log("renderDriverFirstTurn context");

{
	const registryForProtocol: PstackRegistryForProtocol = {
		allNames: registry.allNames,
		skills: registry.skills,
		playbooks: registry.playbooks,
	};

	let capturedContext: DriverFirstTurnContext | undefined;
	await runPairProtocolDryRun(
		{
			navigatorPreflight: async () => "## Acceptance Checklist\n- done\n## Risks\n- none\n## First Cycle Objective\ninspect",
			driverCycle: async () => makeValidStartup(),
			navigatorReview: async () => "DECISION: final_approve",
			navigatorDecisionRepair: async () => "unused",
			driverCorrection: async () => "unused",
		},
		{
			task: "context check",
			maxCycles: 1,
			pstackRegistry: registryForProtocol,
			initialPlaybookRecommendation: "investigation",
			renderDriverFirstTurn: (ctx) => {
				capturedContext = ctx;
				return `rendered: ${ctx.task}`;
			},
		},
	);
	assert(capturedContext !== undefined, "renderDriverFirstTurn was called");
	assertEqual(capturedContext!.task, "context check", "context.task matches run task");
	assertEqual(capturedContext!.initialPlaybook, "investigation", "context.initialPlaybook matches recommendation");
	assert(capturedContext!.registrySummary.includes("architect"), "registrySummary includes skills");
	assert(capturedContext!.registrySummary.includes("bug-fix"), "registrySummary includes playbook slugs");
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
