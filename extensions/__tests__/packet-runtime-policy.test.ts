import assert from "node:assert/strict";
import { test } from "node:test";
import { canStartSourceOperation, initialPacketRuntimeState, packetTimeoutSeconds, reportToolsOnly, transitionPacketRuntime } from "../lib/packet-runtime-policy.ts";
import { normalizeTimeoutSeconds } from "../subagents.ts";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const fixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "evidence-packet-v1.json"), "utf8"));

test("15/29 transition and 16/30 totals", () => {
	let state = initialPacketRuntimeState();
	for (let i = 0; i < 14; i++) state = transitionPacketRuntime(state, { type: "turn-end" });
	for (let i = 0; i < 28; i++) state = transitionPacketRuntime(state, { type: "source-call-start" });
	assert.equal(canStartSourceOperation(state), true);
	state = transitionPacketRuntime(state, { type: "source-call-start" });
	assert.equal(reportToolsOnly(state), true);
	state = transitionPacketRuntime(state, { type: "turn-end" });
	state = transitionPacketRuntime(state, { type: "report-call-start" });
	state = transitionPacketRuntime(state, { type: "turn-end" });
	assert.deepEqual({ turns: state.turns, toolCalls: state.toolCalls, reportCalls: state.reportCalls }, { turns: 16, toolCalls: 30, reportCalls: 1 });
	assert.equal(canStartSourceOperation(state), false);
});

test("packet timeout versus prose normalization", () => {
	assert.equal(packetTimeoutSeconds(undefined), 300);
	assert.equal(packetTimeoutSeconds(120), 120);
	assert.equal(normalizeTimeoutSeconds({ type: "explore", task: "x", evidencePacket: fixture, timeoutSeconds: 120 }).timeoutSeconds, 120);
	assert.equal(normalizeTimeoutSeconds({ type: "explore", task: "x", timeoutSeconds: 120 }).timeoutSeconds, 600);
	assert.equal(normalizeTimeoutSeconds({ type: "explore", task: "x", evidencePacket: { version: 2 }, timeoutSeconds: 120 }).timeoutSeconds, 600);
});
