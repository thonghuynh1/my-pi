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

test("turn threshold reserves the report turn", () => {
	let state = initialPacketRuntimeState();
	for (let i = 0; i < 15; i++) state = transitionPacketRuntime(state, { type: "turn-end" });
	assert.equal(state.turns, 15);
	assert.equal(reportToolsOnly(state), true);
	assert.equal(canStartSourceOperation(state), false);
	state = transitionPacketRuntime(state, { type: "report-call-start" });
	state = transitionPacketRuntime(state, { type: "report-accepted" });
	state = transitionPacketRuntime(state, { type: "turn-end" });
	assert.equal(state.turns, 16);
	assert.equal(state.toolCalls, 1);
	assert.equal(state.reportCalls, 1);
	state = transitionPacketRuntime(state, { type: "turn-end" });
	assert.equal(state.turns, 16);
});

test("lower packet limits still reserve one report operation", () => {
	let state = initialPacketRuntimeState({ maxTurns: 1, maxToolCalls: 1 });
	assert.equal(reportToolsOnly(state), true);
	assert.equal(canStartSourceOperation(state), false);
	state = transitionPacketRuntime(state, { type: "source-call-start" });
	assert.deepEqual({ turns: state.turns, toolCalls: state.toolCalls }, { turns: 0, toolCalls: 0 });
	state = transitionPacketRuntime(state, { type: "report-call-start" });
	state = transitionPacketRuntime(state, { type: "report-accepted" });
	state = transitionPacketRuntime(state, { type: "turn-end" });
	assert.deepEqual({ turns: state.turns, toolCalls: state.toolCalls, reportCalls: state.reportCalls }, { turns: 1, toolCalls: 1, reportCalls: 1 });
});

test("finished state does not accept extra operations", () => {
	let state = initialPacketRuntimeState();
	for (let i = 0; i < 15; i++) state = transitionPacketRuntime(state, { type: "turn-end" });
	state = transitionPacketRuntime(state, { type: "report-call-start" });
	state = transitionPacketRuntime(state, { type: "report-accepted" });
	state = transitionPacketRuntime(state, { type: "source-call-start" });
	state = transitionPacketRuntime(state, { type: "report-call-start" });
	state = transitionPacketRuntime(state, { type: "turn-end" });
	state = transitionPacketRuntime(state, { type: "turn-end" });
	assert.deepEqual({ turns: state.turns, toolCalls: state.toolCalls, reportCalls: state.reportCalls }, { turns: 16, toolCalls: 1, reportCalls: 1 });
});

test("packet timeout versus prose normalization", () => {
	assert.equal(packetTimeoutSeconds(undefined), 300);
	assert.equal(packetTimeoutSeconds(120), 120);
	assert.equal(packetTimeoutSeconds(301), 300);
	assert.equal(normalizeTimeoutSeconds({ type: "explore", task: "x", evidencePacket: fixture, timeoutSeconds: 120 }).timeoutSeconds, 120);
	assert.equal(normalizeTimeoutSeconds({ type: "explore", task: "x", timeoutSeconds: 120 }).timeoutSeconds, 600);
	assert.equal(normalizeTimeoutSeconds({ type: "explore", task: "x", evidencePacket: { version: 2 }, timeoutSeconds: 120 }).timeoutSeconds, 600);
});

test("early report submission during investigating phase transitions to report-only", () => {
	let state = initialPacketRuntimeState();
	// Simulate a few source calls (well below limits)
	state = transitionPacketRuntime(state, { type: "source-call-start" });
	state = transitionPacketRuntime(state, { type: "source-call-start" });
	state = transitionPacketRuntime(state, { type: "turn-end" });
	assert.equal(state.phase, "investigating");
	assert.equal(state.turns, 1);
	assert.equal(state.toolCalls, 2);
	// Child finishes early and submits report while still investigating
	state = transitionPacketRuntime(state, { type: "report-call-start" });
	assert.equal(state.phase, "report-only");
	assert.equal(state.reportCalls, 1);
	assert.equal(state.toolCalls, 3);
	// Report accepted transitions to finished
	state = transitionPacketRuntime(state, { type: "report-accepted" });
	assert.equal(state.phase, "finished");
});
