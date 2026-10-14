import assert from "node:assert/strict";
import test from "node:test";
import { resolveSubagentThinkingLevel, splitModelThinking } from "../subagents.ts";

test("splitModelThinking recognizes supported suffix names without misreading model identifiers", () => {
	assert.deepEqual(splitModelThinking("provider/model:high"), { model: "provider/model", thinkingLevel: "high" });
	assert.deepEqual(splitModelThinking("provider/model:off"), { model: "provider/model", thinkingLevel: "off" });
	assert.deepEqual(splitModelThinking("provider/model"), { model: "provider/model" });
	assert.deepEqual(splitModelThinking("provider/model:unknown"), { model: "provider/model:unknown" });
	assert.deepEqual(splitModelThinking("provider/model:variant:high"), { model: "provider/model:variant", thinkingLevel: "high" });
	assert.deepEqual(splitModelThinking("inherit"), { model: "inherit" });
});

test("resolveSubagentThinkingLevel applies supported preferences and otherwise inherits", () => {
	type ActiveModel = Parameters<typeof resolveSubagentThinkingLevel>[1];
	const reasoningModel = { reasoning: true, thinkingLevelMap: { xhigh: null, max: null } } as ActiveModel;
	const nonReasoningModel = { reasoning: false } as ActiveModel;

	assert.equal(resolveSubagentThinkingLevel("high", reasoningModel, "medium"), "high");
	assert.equal(resolveSubagentThinkingLevel("xhigh", reasoningModel, "medium"), "medium");
	assert.equal(resolveSubagentThinkingLevel(undefined, reasoningModel, "low"), "low");
	assert.equal(resolveSubagentThinkingLevel("high", nonReasoningModel, "minimal"), "minimal");
	assert.equal(resolveSubagentThinkingLevel("off", nonReasoningModel, "high"), "off");
});
