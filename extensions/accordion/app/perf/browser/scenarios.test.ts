import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "../../src/lib/live/protocol";
import { SCENARIOS } from "./scenarios";
import { createHelloFrame, createSyncFrame, generateBlocks } from "./inject";
import { evaluateResult, formatSummary } from "./report";

const scenario = SCENARIOS[0];

describe("browser performance harness", () => {
	it("defines seven valid scenarios", () => {
		expect(SCENARIOS).toHaveLength(7);
		expect(SCENARIOS.map((candidate) => candidate.name)).toEqual([
			"one-message-at-scale",
			"full-reset-at-scale",
			"rapid-fire-10",
			"ghost-idle",
			"budget-drag",
			"group-large-range",
			"rollover-at-500k",
		]);
		for (const candidate of SCENARIOS) expect(candidate.name).toBeTruthy();
	});

	it("creates protocol-correct hello and sync frames", () => {
		const hello = createHelloFrame();
		const sync = createSyncFrame(scenario);
		expect(hello).toMatchObject({ type: "hello", protocolVersion: PROTOCOL_VERSION, sessionId: "perf-bench" });
		expect(hello.meta).toMatchObject({ title: "Perf Benchmark", cwd: "/tmp", model: "benchmark", format: "pi" });
		expect(sync).toMatchObject({ type: "sync", reqId: 1, full: true, contextWindow: 200_000 });
		expect(sync.blocks).toHaveLength(scenario.setup.blockCount);
	});

	it("generates unique wire blocks with required fields", () => {
		const blocks = generateBlocks({ blockCount: 12, tokensPerBlock: 42 });
		expect(new Set(blocks.map((block) => block.id)).size).toBe(12);
		for (const block of blocks) expect(block).toMatchObject({ id: expect.any(String), kind: "text", turn: expect.any(Number), order: expect.any(Number), text: expect.any(String), tokens: 42, proactivelyCompressed: false });
	});

	it("evaluates per-scenario thresholds and the global hard ceiling", () => {
		expect(evaluateResult({ ...scenario, thresholds: { maxLongTask: 200 } }, { longestTask: 100, totalBlocking: 0 })).toMatchObject({ passed: true });
		expect(evaluateResult({ ...scenario, thresholds: { maxLongTask: 200 } }, { longestTask: 300, totalBlocking: 0 })).toMatchObject({ passed: false });
		expect(evaluateResult({ ...scenario, thresholds: { maxLongTask: 1_000 } }, { longestTask: 501, totalBlocking: 0 })).toMatchObject({ passed: false });
	});

	it("formats a pass count for all scenario results", () => {
		const output = formatSummary([
			{ scenario: "a", passed: true, longestTask: 1, totalBlocking: 2, details: "all thresholds passed" },
			{ scenario: "b", passed: false, longestTask: 501, totalBlocking: 2, details: "hard ceiling" },
		]);
		expect(output).toContain("Summary: 1/2 passed");
	});
});
