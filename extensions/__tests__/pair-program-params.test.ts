/**
 * Pure unit tests for pair_program parameter normalization, single-active-run
 * concurrency guard, skill-tdd prerequisite verification, and early-return
 * status mapping.
 *
 * These tests exercise extensions/lib/pair-program-helpers.ts directly. No
 * child sessions, MCP servers, git commands, or filesystem writes are
 * performed.
 *
 * Run: npx tsx extensions/__tests__/pair-program-params.test.ts
 */

import {
	__resetActiveRunForTests,
	DEFAULT_MAX_CYCLES,
	DEFAULT_MODE,
	isRunActive,
	mapEarlyReturnStatus,
	normalizeParams,
	releaseRun,
	tryAcquireRun,
	verifySkillTddAvailable,
} from "../lib/pair-program-helpers.ts";

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
// normalizeParams
// ---------------------------------------------------------------------------

console.log("normalizeParams");

{
	const result = normalizeParams({ task: "do thing" });
	assertEqual(result.task, "do thing", "task is preserved");
	assertEqual(result.mode, DEFAULT_MODE, "mode defaults to tdd");
	assertEqual(result.mode, "tdd", "mode default literal is tdd");
	assertEqual(result.maxCycles, DEFAULT_MAX_CYCLES, "maxCycles defaults to 4");
	assertEqual(result.maxCycles, 4, "maxCycles default literal is 4");
	assertEqual(result.testCommand, undefined, "testCommand stays undefined when omitted");
	assertEqual(result.driverModel, undefined, "driverModel stays undefined when omitted");
	assertEqual(result.navigatorModel, undefined, "navigatorModel stays undefined when omitted");
}

{
	const result = normalizeParams({
		task: "explicit",
		mode: "tdd",
		maxCycles: 7,
		testCommand: "npm test",
		driverModel: "openai/gpt-4",
		navigatorModel: "anthropic/claude-3",
	});
	assertEqual(result.mode, "tdd", "explicit tdd is preserved");
	assertEqual(result.maxCycles, 7, "explicit maxCycles is preserved");
	assertEqual(result.testCommand, "npm test", "explicit testCommand preserved");
	assertEqual(result.driverModel, "openai/gpt-4", "driverModel preserved");
	assertEqual(result.navigatorModel, "anthropic/claude-3", "navigatorModel preserved");
}

{
	// Same input -> same output (pure function).
	const a = normalizeParams({ task: "x" });
	const b = normalizeParams({ task: "x" });
	assertEqual(JSON.stringify(a), JSON.stringify(b), "normalizeParams is pure");
}

{
	// Unsupported mode is NOT silently coerced; it round-trips so the caller
	// can return its own error with the offending value.
	const result = normalizeParams({ task: "x", mode: "debug" });
	assertEqual(result.mode, "debug", "unsupported mode value is preserved for caller-side rejection");
	assert(result.mode !== "tdd", "unsupported mode is not silently coerced to tdd");
}

// ---------------------------------------------------------------------------
// Concurrency guard (single active pair run per Pi session)
// ---------------------------------------------------------------------------

console.log("concurrency guard");

{
	__resetActiveRunForTests();
	assert(!isRunActive(), "starts with no active run");
	assert(tryAcquireRun("first"), "first acquire succeeds");
	assert(isRunActive(), "is active after first acquire");
	assert(!tryAcquireRun("second"), "second concurrent acquire is rejected");
	assert(isRunActive(), "first run remains active after rejected second attempt");
	releaseRun();
	assert(!isRunActive(), "release frees the guard");
	assert(tryAcquireRun("third"), "acquire works again after release");
	releaseRun();
}

// ---------------------------------------------------------------------------
// verifySkillTddAvailable
// ---------------------------------------------------------------------------

console.log("verifySkillTddAvailable");

{
	// Preferred: tool registry exposes a server-prefixed skill-tdd tool.
	const result = verifySkillTddAvailable({
		getAllTools: () => [
			{ name: "read" },
			{ name: "engineering-skills_skill-tdd" },
			{ name: "engineering-skills_other-thing" },
		],
		isMcpConfigured: () => {
			throw new Error("should not be called when registry hit succeeds");
		},
	});
	assert(result.available, "skill-tdd is available when registered as a direct tool");
	assertEqual(result.mechanism, "tool-registry", "preferred mechanism is tool-registry");
	assertEqual(result.matchedToolName, "engineering-skills_skill-tdd", "matched tool name is reported");
}

{
	// Underscore-normalized variant.
	const result = verifySkillTddAvailable({
		getAllTools: () => [{ name: "engineering_skills_skill_tdd" }],
	});
	assert(result.available, "skill_tdd underscore variant matches");
	assertEqual(result.mechanism, "tool-registry", "underscore variant uses tool-registry");
}

{
	// Bare tool name (no server prefix).
	const result = verifySkillTddAvailable({
		getAllTools: () => [{ name: "skill-tdd" }],
	});
	assert(result.available, "bare skill-tdd tool name matches");
}

{
	// Fallback: registry has no skill-tdd, MCP server is configured.
	const result = verifySkillTddAvailable({
		getAllTools: () => [{ name: "read" }, { name: "bash" }],
		isMcpConfigured: () => true,
	});
	assert(result.available, "available via mcp-config fallback");
	assertEqual(result.mechanism, "mcp-config", "fallback mechanism is mcp-config");
	assertEqual(result.matchedToolName, undefined, "fallback does not report a matched tool");
}

{
	// Neither registry nor config has it.
	const result = verifySkillTddAvailable({
		getAllTools: () => [{ name: "read" }],
		isMcpConfigured: () => false,
	});
	assert(!result.available, "not available when neither mechanism finds it");
	assertEqual(result.mechanism, "none", "mechanism is 'none' when both fail");
}

{
	// getAllTools throwing falls through to config check.
	const result = verifySkillTddAvailable({
		getAllTools: () => {
			throw new Error("registry unavailable");
		},
		isMcpConfigured: () => true,
	});
	assert(result.available, "registry throw falls back to mcp-config");
	assertEqual(result.mechanism, "mcp-config", "fallback used when registry throws");
}

{
	// No mechanism provided -> not available, no crash.
	const result = verifySkillTddAvailable({});
	assert(!result.available, "no mechanism means not available");
	assertEqual(result.mechanism, "none", "no mechanism reports 'none'");
}

// ---------------------------------------------------------------------------
// Early-return status mapping
// ---------------------------------------------------------------------------

console.log("mapEarlyReturnStatus");

assertEqual(mapEarlyReturnStatus("unsupported_mode"), "error", "unsupported_mode -> error");
assertEqual(mapEarlyReturnStatus("already_active"), "error", "already_active -> error");
assertEqual(mapEarlyReturnStatus("skill_tdd_missing"), "blocked", "skill_tdd_missing -> blocked");
assertEqual(mapEarlyReturnStatus("incomplete"), "incomplete", "incomplete passthrough");

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
