/**
 * Pure unit tests for pair_program parameter normalization, single-active-run
 * concurrency guard, pstack registry resolution, and early-return status mapping.
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
	isRunActive,
	mapEarlyReturnStatus,
	normalizeParams,
	normalizePlaybookSlug,
	parsePstackRegistry,
	releaseRun,
	resolvePstackRegistry,
	tryAcquireRun,
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
// normalizeParams — no mode, no testCommand
// ---------------------------------------------------------------------------

console.log("normalizeParams");

{
	const result = normalizeParams({ task: "do thing" });
	assertEqual(result.task, "do thing", "task is preserved");
	assertEqual(result.maxCycles, DEFAULT_MAX_CYCLES, "maxCycles defaults to 4");
	assertEqual(result.maxCycles, 4, "maxCycles default literal is 4");
	assertEqual(result.driverModel, undefined, "driverModel stays undefined when omitted");
	assertEqual(result.navigatorModel, undefined, "navigatorModel stays undefined when omitted");
	// mode and testCommand must NOT be present on the normalized type
	assert(!("mode" in result), "mode is not present on normalized params");
	assert(!("testCommand" in result), "testCommand is not present on normalized params");
}

{
	const result = normalizeParams({
		task: "explicit",
		maxCycles: 7,
		driverModel: "openai/gpt-4",
		navigatorModel: "anthropic/claude-3",
	});
	assertEqual(result.maxCycles, 7, "explicit maxCycles is preserved");
	assertEqual(result.driverModel, "openai/gpt-4", "driverModel preserved");
	assertEqual(result.navigatorModel, "anthropic/claude-3", "navigatorModel preserved");
	assert(!("mode" in result), "mode absent from normalized result");
	assert(!("testCommand" in result), "testCommand absent from normalized result");
}

{
	// Same input -> same output (pure function).
	const a = normalizeParams({ task: "x" });
	const b = normalizeParams({ task: "x" });
	assertEqual(JSON.stringify(a), JSON.stringify(b), "normalizeParams is pure");
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
// normalizePlaybookSlug
// ---------------------------------------------------------------------------

console.log("normalizePlaybookSlug");

{
	// Full pstack playbook paths are sliced to their last segment.
	assertEqual(normalizePlaybookSlug("poteto-mode/playbooks/bug-fix"), "bug-fix", "full path -> slug");
	assertEqual(normalizePlaybookSlug("poteto-mode/playbooks/refactoring"), "refactoring", "refactoring slug");
	assertEqual(normalizePlaybookSlug("poteto-mode/playbooks/session-pickup"), "session-pickup", "session-pickup slug");
	// Already-slug names are returned unchanged.
	assertEqual(normalizePlaybookSlug("architect"), "architect", "bare skill is unchanged");
	assertEqual(normalizePlaybookSlug("bug-fix"), "bug-fix", "bare slug is unchanged");
	// Empty string edge case
	assertEqual(normalizePlaybookSlug(""), "", "empty string is unchanged");
}

// ---------------------------------------------------------------------------
// parsePstackRegistry — parse description text from MCP metadata
// ---------------------------------------------------------------------------

console.log("parsePstackRegistry");

const SAMPLE_DESCRIPTION = `pstack skill reference (vendored from poteto's pstack). Available names:

Skills:
  - architect
  - figure-it-out
  - how
  - poteto-mode
  - show-me-your-work
  - unslop

Playbooks:
  - poteto-mode/playbooks/bug-fix
  - poteto-mode/playbooks/refactoring
  - poteto-mode/playbooks/session-pickup

Parameters:
  name (string) *required* - pstack skill or playbook name`;

{
	const registry = parsePstackRegistry(SAMPLE_DESCRIPTION);

	// Skills
	assert(registry.skills.length === 6, `skills count: expected 6, got ${registry.skills.length}`);
	const skillNames = registry.skills.map((s) => s.name);
	assert(skillNames.includes("architect"), "architect in skills");
	assert(skillNames.includes("poteto-mode"), "poteto-mode in skills");

	// Playbooks
	assert(registry.playbooks.length === 3, `playbooks count: expected 3, got ${registry.playbooks.length}`);
	const playbookNames = registry.playbooks.map((p) => p.name);
	assert(playbookNames.includes("poteto-mode/playbooks/bug-fix"), "full playbook name in registry");

	// Slug normalization on playbooks
	const bugFix = registry.playbooks.find((p) => p.name === "poteto-mode/playbooks/bug-fix");
	assertEqual(bugFix?.slug, "bug-fix", "playbook slug normalized to last segment");

	// Skills have slug equal to name (no path segments)
	const architect = registry.skills.find((s) => s.name === "architect");
	assertEqual(architect?.slug, "architect", "skill slug equals name");

	// allNames includes full names and slugs
	assert(registry.allNames.has("architect"), "allNames has skill name");
	assert(registry.allNames.has("poteto-mode/playbooks/bug-fix"), "allNames has full playbook name");
	assert(registry.allNames.has("bug-fix"), "allNames has playbook slug");
}

{
	// Empty description -> empty registry (no crash)
	const registry = parsePstackRegistry("");
	assert(registry.skills.length === 0, "empty input -> no skills");
	assert(registry.playbooks.length === 0, "empty input -> no playbooks");
	assert(registry.allNames.size === 0, "empty input -> empty allNames");
}

{
	// Only skills section
	const registry = parsePstackRegistry("Skills:\n  - how\n  - why\n");
	assert(registry.skills.length === 2, "only skills parsed when no Playbooks section");
	assert(registry.playbooks.length === 0, "no playbooks when section missing");
}

// ---------------------------------------------------------------------------
// resolvePstackRegistry
// ---------------------------------------------------------------------------

console.log("resolvePstackRegistry");

{
	// Success: skill-pstack tool is in the registry with a description.
	const result = resolvePstackRegistry({
		getAllTools: () => [
			{ name: "read", description: "read a file" },
			{ name: "engineering_skills_skill-pstack", description: SAMPLE_DESCRIPTION },
			{ name: "bash", description: "run commands" },
		],
	});
	assert(result.available, "registry resolved when skill-pstack tool is present");
	if (result.available) {
		assert(result.registry.skills.length > 0, "skills populated in resolved registry");
		assert(result.registry.playbooks.length > 0, "playbooks populated in resolved registry");
	}
}

{
	// Hyphen-normalised variant: engineering-skills_skill-pstack
	const result = resolvePstackRegistry({
		getAllTools: () => [
			{ name: "engineering-skills_skill-pstack", description: SAMPLE_DESCRIPTION },
		],
	});
	assert(result.available, "hyphen-variant tool name matched");
}

{
	// Bare tool name
	const result = resolvePstackRegistry({
		getAllTools: () => [{ name: "skill-pstack", description: SAMPLE_DESCRIPTION }],
	});
	assert(result.available, "bare skill-pstack tool name matched");
}

{
	// skill-pstack present in active MCP tools; description comes from the fallback metadata source.
	const result = resolvePstackRegistry({
		getAllTools: () => [{ name: "read", description: "read a file" }],
		getActiveTools: () => ["read", "engineering_skills_skill-pstack"],
		getPstackDescription: (toolName) => toolName === "engineering_skills_skill-pstack" ? SAMPLE_DESCRIPTION : undefined,
	});
	assert(result.available, "registry resolved from active MCP tool plus fallback description");
	if (result.available) {
		assert(result.registry.skills.length > 0, "fallback description populated skills");
		assert(result.registry.playbooks.length > 0, "fallback description populated playbooks");
	}
}

{
	// getAllTools can omit or fail for MCP tools; active tools still prove the MCP tool is available.
	const result = resolvePstackRegistry({
		getAllTools: () => {
			throw new Error("configured tool metadata excludes MCP");
		},
		getActiveTools: () => ["engineering_skills_skill-pstack"],
		getPstackDescription: () => SAMPLE_DESCRIPTION,
	});
	assert(result.available, "active MCP tool resolves even when getAllTools fails");
}

{
	// Proxy-only MCP sessions expose only the mcp gateway; the configured repo still supplies pstack metadata.
	const result = resolvePstackRegistry({
		getAllTools: () => [{ name: "mcp", description: "MCP gateway" }],
		getActiveTools: () => ["read", "mcp"],
		getPstackDescription: () => SAMPLE_DESCRIPTION,
	});
	assert(result.available, "registry resolved from configured pstack metadata when MCP is proxy-only");
}

{
	// Configured metadata alone is not enough when no MCP tool surface is active.
	const result = resolvePstackRegistry({
		getAllTools: () => [{ name: "read", description: "read a file" }],
		getActiveTools: () => ["read"],
		getPstackDescription: () => SAMPLE_DESCRIPTION,
	});
	assert(!result.available, "configured metadata without an MCP tool surface stays unavailable");
}

{
	// skill-pstack present but no description -> unavailable
	const result = resolvePstackRegistry({
		getAllTools: () => [{ name: "engineering_skills_skill-pstack", description: "" }],
	});
	assert(!result.available, "unavailable when description is empty");
	if (!result.available) {
		assert(result.reason.length > 0, "failure reason provided when description is empty");
	}
}

{
	// No skill-pstack in the registry -> unavailable
	const result = resolvePstackRegistry({
		getAllTools: () => [{ name: "read" }, { name: "bash" }],
	});
	assert(!result.available, "unavailable when no skill-pstack tool found");
	if (!result.available) {
		assert(result.reason.length > 0, "failure reason provided when tool not found");
	}
}

{
	// getAllTools throws -> unavailable with reason
	const result = resolvePstackRegistry({
		getAllTools: () => {
			throw new Error("registry unavailable");
		},
	});
	assert(!result.available, "unavailable when getAllTools throws");
	if (!result.available) {
		assert(result.reason.includes("registry unavailable"), "error message propagated to reason");
	}
}

{
	// No options -> unavailable
	const result = resolvePstackRegistry({});
	assert(!result.available, "unavailable when no resolver options provided");
}

// ---------------------------------------------------------------------------
// Early-return status mapping
// ---------------------------------------------------------------------------

console.log("mapEarlyReturnStatus");

assertEqual(mapEarlyReturnStatus("already_active"), "error", "already_active -> error");
assertEqual(mapEarlyReturnStatus("registry_unavailable"), "blocked", "registry_unavailable -> blocked");
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
