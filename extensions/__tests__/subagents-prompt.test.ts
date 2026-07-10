/**
 * Tests that the built-in explore subagent prompt includes the soft aiKnow hint.
 *
 * Run: node --test extensions/__tests__/subagents-prompt.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { EXPLORE_PROMPT } from "../prompts.ts";

test("explore prompt includes the soft aiKnow availability gate", () => {
	assert.ok(
		EXPLORE_PROMPT.includes("If aiKnow tools are available and this repo is indexed"),
		"prompt must include soft aiKnow availability gate",
	);
});

test("explore prompt includes aiknow_search in the hint", () => {
	assert.ok(EXPLORE_PROMPT.includes("aiknow_search"), "prompt must mention aiknow_search");
});

test("explore prompt includes aiknow_status in the hint", () => {
	assert.ok(EXPLORE_PROMPT.includes("aiknow_status"), "prompt must mention aiknow_status");
});

test("explore prompt includes tier='compact' in the hint", () => {
	assert.ok(EXPLORE_PROMPT.includes("tier='compact'"), "prompt must mention tier='compact'");
});

test("explore prompt has exactly one aiKnow hint block", () => {
	const marker = "If aiKnow tools are available and this repo is indexed";
	const occurrences = EXPLORE_PROMPT.split(marker).length - 1;
	assert.equal(occurrences, 1, "must have exactly one aiKnow hint, not duplicated");
});
