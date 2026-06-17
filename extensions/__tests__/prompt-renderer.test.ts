/**
 * Tests for prompt-renderer.ts (marker rendering, missing-marker failures,
 * per-phase payload selection) and the updated pair-protocol heading
 * normalization and section-validator scaffolding.
 */

import {
	renderPrompt,
} from "../lib/prompt-renderer.ts";

import {
	normalizeHeading,
	extractSection,
	validateNavigatorReview,
	validateDriverCycleReport,
	validateNavigatorPreflight,
	type SectionValidationResult,
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
// renderPrompt — marker substitution
// ---------------------------------------------------------------------------

console.log("renderPrompt — marker substitution");

{
	const template = "Hello <!-- NAME -->!";
	const result = renderPrompt(template, { NAME: "World" });
	assertEqual(result, "Hello World!", "single marker replaced with payload");
}

{
	const template = "<!-- A --> and <!-- B -->";
	const result = renderPrompt(template, { A: "alpha", B: "beta" });
	assertEqual(result, "alpha and beta", "multiple markers each replaced");
}

{
	const template = "<!-- TASK -->\n\n<!-- RUN_STATE -->";
	const result = renderPrompt(template, { TASK: "build X", RUN_STATE: "cycle 1" });
	assertEqual(result, "build X\n\ncycle 1", "multiline template markers replaced");
}

{
	const template = "<!-- TASK -->";
	const result = renderPrompt(template, { TASK: "my task", EXTRA: "ignored" });
	assertEqual(result, "my task", "extra payloads not in template are silently ignored");
}

{
	const template = "Static content only.";
	const result = renderPrompt(template, {});
	assertEqual(result, "Static content only.", "template with no markers returned unchanged");
}

{
	const template = "<!-- TASK --> and <!-- TASK -->";
	const result = renderPrompt(template, { TASK: "X" });
	assertEqual(result, "X and X", "repeated marker replaced at every occurrence");
}

// ---------------------------------------------------------------------------
// renderPrompt — missing required marker fails fast
// ---------------------------------------------------------------------------

console.log("renderPrompt — missing required marker fails fast");

{
	const template = "Hello <!-- NAME -->!";
	let threw = false;
	let errorMsg = "";
	try {
		renderPrompt(template, {});
	} catch (e) {
		threw = true;
		errorMsg = (e as Error).message;
	}
	assert(threw, "throws when required marker has no payload");
	assert(errorMsg.includes("NAME"), "error message names the missing marker");
}

{
	const template = "<!-- A --> and <!-- B -->";
	let threw = false;
	let errorMsg = "";
	try {
		renderPrompt(template, { A: "provided" });
	} catch (e) {
		threw = true;
		errorMsg = (e as Error).message;
	}
	assert(threw, "throws when one of multiple markers is missing");
	assert(errorMsg.includes("B"), "error message names the missing marker B");
}

{
	const template = "<!-- TASK -->";
	let threw = false;
	try {
		renderPrompt(template, { TASK: "" });
	} catch (e) {
		threw = true;
	}
	assert(!threw, "empty string payload is valid (does not throw)");
}

// ---------------------------------------------------------------------------
// normalizeHeading
// ---------------------------------------------------------------------------

console.log("normalizeHeading");

assertEqual(normalizeHeading("Summary"), "summary", "lowercases heading");
assertEqual(normalizeHeading("  Summary  "), "summary", "trims whitespace");
assertEqual(normalizeHeading("Summary."), "summary", "removes trailing period");
assertEqual(normalizeHeading("Summary!"), "summary", "removes trailing exclamation");
assertEqual(normalizeHeading("Summary?"), "summary", "removes trailing question mark");
assertEqual(normalizeHeading("Summary:"), "summary", "removes trailing colon");
assertEqual(normalizeHeading("Summary,"), "summary", "removes trailing comma");
assertEqual(normalizeHeading("Summary;"), "summary", "removes trailing semicolon");
assertEqual(normalizeHeading("DECISION CONTRACT"), "decision contract", "multi-word heading normalized");
assertEqual(normalizeHeading("  Checklist Amendment!  "), "checklist amendment", "trims and removes punct from multi-word");
assertEqual(normalizeHeading("already normalized"), "already normalized", "already normalized heading unchanged");
assertEqual(normalizeHeading(""), "", "empty string returns empty string");

// ---------------------------------------------------------------------------
// extractSection — normalized heading extractor
// ---------------------------------------------------------------------------

console.log("extractSection — normalized heading extractor");

{
	const md = "## Summary\nbody text\n## Next";
	const body = extractSection(md, "Summary");
	assertEqual(body, "body text", "extracts body under exact heading");
}

{
	const md = "## Summary\nbody text\n## Next";
	const body = extractSection(md, "summary");
	assertEqual(body, "body text", "extracts body with lowercase query");
}

{
	const md = "## Summary.\nbody text\n## Next";
	const body = extractSection(md, "Summary");
	assertEqual(body, "body text", "matches heading with trailing period");
}

{
	const md = "## Summary:\nbody text\n## Next";
	const body = extractSection(md, "Summary");
	assertEqual(body, "body text", "matches heading with trailing colon");
}

{
	const md = "##  Summary  \nbody text";
	const body = extractSection(md, "Summary");
	assertEqual(body, "body text", "matches heading with extra spaces");
}

{
	const md = "## Other\nother body";
	const body = extractSection(md, "Summary");
	assertEqual(body, null, "returns null when heading not present");
}

{
	const md = "## Summary\n\n   \n## Next";
	const body = extractSection(md, "Summary");
	assertEqual(body, null, "returns null when section body is blank");
}

{
	const md = "## Summary\nfirst line\nsecond line\n## Next\nother";
	const body = extractSection(md, "Summary");
	assertEqual(body, "first line\nsecond line", "captures multi-line body");
}

{
	const md = "## Section One\nline a\n## Section Two\nline b";
	const one = extractSection(md, "Section One");
	const two = extractSection(md, "Section Two");
	assertEqual(one, "line a", "extracts first section");
	assertEqual(two, "line b", "extracts second section");
}

// ---------------------------------------------------------------------------
// validateNavigatorReview — section-specific validator
// ---------------------------------------------------------------------------

console.log("validateNavigatorReview — section-specific validator");

{
	const text = "Good review.\nDECISION: approve_next";
	const result = validateNavigatorReview(text);
	assert(result.valid, "valid review with approve_next passes");
	assertEqual(result.errors.length, 0, "no errors for valid approve_next review");
}

{
	const text = "Good review.\nDECISION: final_approve";
	const result = validateNavigatorReview(text);
	assert(result.valid, "valid review with final_approve passes");
}

{
	const text = "DECISION: request_revision\n## Correction Packet\nfix it\n## Required Evidence\nshow it";
	const result = validateNavigatorReview(text);
	assert(result.valid, "request_revision with required sections passes");
}

{
	const text = "DECISION: request_revision";
	const result = validateNavigatorReview(text);
	assert(!result.valid, "request_revision without Correction Packet fails");
	assert(result.errors.some((e) => e.toLowerCase().includes("correction packet")), "error mentions Correction Packet");
}

{
	const text = "DECISION: request_revision\n## Correction Packet\nfix it";
	const result = validateNavigatorReview(text);
	assert(!result.valid, "request_revision without Required Evidence fails");
	assert(result.errors.some((e) => e.toLowerCase().includes("required evidence")), "error mentions Required Evidence");
}

{
	const text = "No decision here.";
	const result = validateNavigatorReview(text);
	assert(!result.valid, "missing DECISION line fails");
	assert(result.errors.some((e) => e.toLowerCase().includes("decision")), "error mentions DECISION");
}

{
	const text = "DECISION: approve_next\nDECISION: final_approve";
	const result = validateNavigatorReview(text);
	assert(!result.valid, "multiple DECISION lines fails");
	assert(result.errors.some((e) => e.toLowerCase().includes("multiple")), "error mentions multiple decisions");
}

// ---------------------------------------------------------------------------
// validateDriverCycleReport — section-specific validator
// ---------------------------------------------------------------------------

console.log("validateDriverCycleReport — section-specific validator");

{
	const text = [
		"## Summary",
		"did the thing",
		"## Changed Files",
		"src/foo.ts",
		"## Tests Run",
		"npm test",
		"## Evidence",
		"all green",
		"## Acceptance Checklist Progress",
		"covered",
		"## Next Intent",
		"finish",
	].join("\n");
	const result = validateDriverCycleReport(text);
	assert(result.valid, "complete driver report passes");
	assertEqual(result.errors.length, 0, "no errors for complete driver report");
}

{
	const text = "## Summary\ndid the thing";
	const result = validateDriverCycleReport(text);
	assert(!result.valid, "driver report missing required sections fails");
	assert(result.errors.length > 0, "errors reported for missing sections");
}

{
	const missingEvidence = [
		"## Summary",
		"did the thing",
		"## Changed Files",
		"src/foo.ts",
		"## Tests Run",
		"npm test",
		"## Acceptance Checklist Progress",
		"covered",
		"## Next Intent",
		"finish",
	].join("\n");
	const result = validateDriverCycleReport(missingEvidence);
	assert(!result.valid, "report missing Evidence section fails");
	assert(result.errors.some((e) => e.toLowerCase().includes("evidence")), "error mentions Evidence section");
}

// ---------------------------------------------------------------------------
// validateNavigatorPreflight — section-specific validator
// ---------------------------------------------------------------------------

console.log("validateNavigatorPreflight — section-specific validator");

{
	const text = [
		"## Acceptance Checklist",
		"- criterion one",
		"## Risks",
		"- none identified",
		"## First Cycle Objective",
		"implement feature X",
	].join("\n");
	const result = validateNavigatorPreflight(text);
	assert(result.valid, "complete preflight passes");
	assertEqual(result.errors.length, 0, "no errors for complete preflight");
}

{
	const text = "## Risks\n- none\n## First Cycle Objective\ngo";
	const result = validateNavigatorPreflight(text);
	assert(!result.valid, "preflight missing Acceptance Checklist fails");
	assert(result.errors.some((e) => e.toLowerCase().includes("acceptance checklist")), "error mentions Acceptance Checklist");
}

{
	const text = "## Acceptance Checklist\n- done\n## Risks\n- none";
	const result = validateNavigatorPreflight(text);
	assert(!result.valid, "preflight missing First Cycle Objective fails");
	assert(result.errors.some((e) => e.toLowerCase().includes("first cycle objective")), "error mentions First Cycle Objective");
}

// ---------------------------------------------------------------------------
// Summary
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
