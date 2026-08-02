import { describe, expect, it } from "vitest";
import { SCENARIOS } from "./scenarios";
import { createHelloFrame, createSyncFrame, generateBlocks } from "./inject";
import { evaluateResult } from "./report";

const scenario = SCENARIOS[0];

describe("browser performance harness", () => {
	it("defines six valid scenarios", () => {
		expect(SCENARIOS).toHaveLength(6);
		for (const candidate of SCENARIOS) expect(candidate.name).toBeTruthy();
	});

	it("creates protocol-correct hello and sync frames", () => {
		const hello = createHelloFrame();
		const sync = createSyncFrame(scenario);
		expect(hello).toMatchObject({ type: "hello", protocolVersion: 1, sessionId: "perf-bench" });
		expect(hello.meta).toMatchObject({ title: "Perf Benchmark", cwd: "/tmp", model: "benchmark" });
		expect(sync).toMatchObject({ type: "sync", reqId: 1, full: true, contextWindow: 200_000 });
		expect(sync.blocks).toHaveLength(scenario.setup.blockCount);
	});

	it("generates unique wire blocks with required fields", () => {
		const blocks = generateBlocks({ blockCount: 12, tokensPerBlock: 42 });
		expect(new Set(blocks.map((block) => block.id)).size).toBe(12);
		for (const block of blocks) expect(block).toMatchObject({ id: expect.any(String), kind: "text", turn: expect.any(Number), order: expect.any(Number), text: expect.any(String), tokens: 42, proactivelyCompressed: false });
	});

	it("evaluates long-task thresholds", () => {
		expect(evaluateResult({ ...scenario, thresholds: { maxLongTask: 200 } }, { longestTask: 100, totalBlocking: 0 }).passed).toBe(true);
		expect(evaluateResult({ ...scenario, thresholds: { maxLongTask: 200 } }, { longestTask: 300, totalBlocking: 0 }).passed).toBe(false);
	});
});
