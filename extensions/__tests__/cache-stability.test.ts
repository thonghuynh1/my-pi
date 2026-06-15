/**
 * Proof that the grill-with-scouts prompt-cache fix works.
 *
 * Root cause (pre-fix): `before_agent_start` appended a prompt block whose head
 * carried volatile planning state (decision count, findings, gaps, next
 * question, ledger, checkpoint). The system prompt is the cached prefix, and
 * Anthropic prompt caching matches the longest common prefix. A changed prefix
 * on nearly every turn forced a full re-write of system + history (cacheWrite),
 * instead of a cacheRead of the stable prefix.
 *
 * This probe exercises the REAL builders and models that exact cache mechanism:
 *   - buildStaticLeadGrillerPrompt must be byte-identical across state changes.
 *   - buildDynamicStateMessage must still reflect state (nothing lost).
 *   - the pre-fix shape (reconstructed) must change every turn (the regression).
 *   - simulated cacheWrite tokens must drop sharply with the static prefix.
 *
 * Run: node --test extensions/__tests__/cache-stability.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSession, compactDecisionLedger, type SessionState } from "../lib/grill-with-scouts-helpers.ts";
import { buildStaticLeadGrillerPrompt, buildDynamicStateMessage } from "../grill-with-scouts.ts";

/** Pre-fix prompt shape: volatile head prepended to the stable tail. */
function legacyVolatilePrompt(state: SessionState): string {
	const ledger = state.acceptedDecisions.length > 0 ? compactDecisionLedger(state) : "";
	const volatileHead = [
		`Current tier: ${state.currentTier}`,
		`Decisions accepted: ${state.acceptedDecisions.length}`,
		state.durableScoutFindings.length > 0 ? `Scout findings: ${state.durableScoutFindings.join("; ")}` : "",
		state.scoutGaps.length > 0 ? `Scout gaps: ${state.scoutGaps.join("; ")}` : "",
		state.nextQuestion ? `Resume from: ${state.nextQuestion}` : "",
		ledger ? `\nDecision ledger:\n${ledger}` : "",
	].join("\n");
	return volatileHead + "\n" + buildStaticLeadGrillerPrompt(state);
}

/** Drive a session through N turns, mutating exactly what changes turn to turn. */
function simulateTurns(state: SessionState, turns: number): SessionState[] {
	const tiers = ["discovery", "macro", "meso", "micro"];
	const snapshots: SessionState[] = [];
	for (let t = 0; t < turns; t++) {
		state.acceptedDecisions.push(`decision ${t}: pick approach ${t}`);
		state.currentTier = tiers[Math.min(t, tiers.length - 1)];
		state.nextQuestion = `what about edge case ${t}?`;
		if (t % 2 === 0) state.durableScoutFindings.push(`backend: finding ${t} | evidence: src/f${t}.ts:1`);
		if (t % 3 === 0) state.scoutGaps.push(`qa: gap ${t}`);
		snapshots.push(JSON.parse(JSON.stringify(state)));
	}
	return snapshots;
}

const approxTokens = (s: string) => Math.ceil(s.length / 4);

/**
 * Model Anthropic longest-common-prefix caching over a session.
 * Each turn: systemPrompt is the prefix, history grows by ~4k tokens.
 * If the prefix matches the previous turn -> prior span is cacheRead and only
 * the new history delta is cacheWrite. If it differs -> full cacheWrite.
 */
function simulateCacheCost(prompts: string[]): { cacheWrite: number; cacheRead: number } {
	const HISTORY_DELTA = 4000;
	let cacheWrite = 0;
	let cacheRead = 0;
	let prevPrefix: string | null = null;
	let cachedSpan = 0;
	for (let i = 0; i < prompts.length; i++) {
		const prefixTokens = approxTokens(prompts[i]);
		const historyTokens = i * HISTORY_DELTA;
		if (prompts[i] === prevPrefix) {
			cacheRead += cachedSpan;
			cacheWrite += HISTORY_DELTA;
		} else {
			cacheWrite += prefixTokens + historyTokens;
		}
		cachedSpan = prefixTokens + historyTokens;
		prevPrefix = prompts[i];
	}
	return { cacheWrite, cacheRead };
}

test("static system-prompt prefix is byte-identical across state mutations (cache stays warm)", () => {
	const dir = mkdtempSync(join(tmpdir(), "grill-cache-"));
	try {
		const { state } = createSession("prove cache fix", dir);
		const snaps = simulateTurns(state, 20);

		const staticOutputs = snaps.map(buildStaticLeadGrillerPrompt);
		const uniqueStatic = new Set(staticOutputs);
		assert.equal(uniqueStatic.size, 1, "static prefix must be invariant across all turns");

		const dynamicOutputs = snaps.map(buildDynamicStateMessage);
		const uniqueDynamic = new Set(dynamicOutputs);
		assert.equal(uniqueDynamic.size, snaps.length, "volatile state must still be carried in the tail message");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("reproduces the pre-fix regression: volatile prefix changed every turn", () => {
	const dir = mkdtempSync(join(tmpdir(), "grill-cache-"));
	try {
		const { state } = createSession("prove cache fix", dir);
		const snaps = simulateTurns(state, 20);
		const legacyOutputs = snaps.map(legacyVolatilePrompt);
		assert.equal(new Set(legacyOutputs).size, snaps.length, "pre-fix prefix changed on every turn (the bug)");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("simulated cacheWrite drops sharply with the static prefix", () => {
	const dir = mkdtempSync(join(tmpdir(), "grill-cache-"));
	try {
		const { state } = createSession("prove cache fix", dir);
		const snaps = simulateTurns(state, 20);

		const before = simulateCacheCost(snaps.map(legacyVolatilePrompt));
		const after = simulateCacheCost(snaps.map(buildStaticLeadGrillerPrompt));

		const ratio = before.cacheWrite / Math.max(after.cacheWrite, 1);
		console.log(`cacheWrite tokens  before=${before.cacheWrite}  after=${after.cacheWrite}  reduction=${ratio.toFixed(1)}x`);
		console.log(`cacheRead  tokens  before=${before.cacheRead}  after=${after.cacheRead}`);

		assert.ok(after.cacheWrite < before.cacheWrite, "static prefix must write fewer cache tokens");
		assert.ok(ratio >= 5, `expected >=5x cacheWrite reduction, got ${ratio.toFixed(1)}x`);
		assert.ok(after.cacheRead > before.cacheRead, "static prefix must enable cache reads");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
