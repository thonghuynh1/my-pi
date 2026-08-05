import { describe, expect, it } from "vitest";
import { blk, makeStore, mockHarness } from "../fixtures/helpers";
import type { Block } from "../../src/lib/engine/types";

/**
 * Rollover timing tests — validate that the three conductor fixes
 * (#03 O(1) pre-guard, #07 eliminate second buildView, #08 planFoldsToCap
 * in early over-cap path) keep sync processing under 50ms at 500 blocks
 * with a 500k context window and active conductor-driven rollovers.
 *
 * Issue: accordion-broker-freeze/issues/06-browser-perf-validation-with-rollovers.md
 */

function make500kStore(): { store: ReturnType<typeof makeStore>; blocks: Block[] } {
	// 500 blocks × 1000 tokens = 500k total context
	const blocks = Array.from({ length: 500 }, (_, i) => blk(i, "text", 1000));
	const store = makeStore(blocks);
	store.setContextWindow(500_000);
	store.setBudget(400_000); // budget < total → conductor will trigger rollovers
	return { store, blocks };
}

describe("Rollover timing at 500 blocks / 500k context", () => {
	it("applySync with one new block stays under 50ms (conductor active)", () => {
		const { store } = make500kStore();

		// Add a new block — triggers conductor run with rollover processing
		const start = performance.now();
		store.applySync({ harness: mockHarness, blocks: [blk(500, "text", 1000)] });
		const elapsed = performance.now() - start;

		expect(elapsed).toBeLessThan(50);
	});

	it("10 rapid-fire single-block syncs each stay under 50ms", () => {
		const { store } = make500kStore();
		const timings: number[] = [];

		for (let i = 0; i < 10; i++) {
			const start = performance.now();
			store.applySync({
				harness: mockHarness,
				blocks: [blk(500 + i, "text", 1000)],
			});
			timings.push(performance.now() - start);
		}

		const maxTime = Math.max(...timings);
		const avgTime = timings.reduce((sum, t) => sum + t, 0) / timings.length;
		console.log(`Rapid-fire rollover timings: max=${maxTime.toFixed(2)}ms avg=${avgTime.toFixed(2)}ms`);
		console.log(`  Per-sync: ${timings.map((t) => t.toFixed(1)).join(", ")}ms`);

		for (const [index, time] of timings.entries()) {
			expect(time, `sync ${index} took ${time.toFixed(1)}ms`).toBeLessThan(50);
		}
	});

	it("full sync reset at 500 blocks / 500k context stays under 100ms", () => {
		const { store } = make500kStore();

		// Full reset — replaces all blocks, triggers full conductor pass
		const newBlocks = Array.from({ length: 500 }, (_, i) => blk(i, "text", 1000));
		const start = performance.now();
		store.applySync({
			harness: mockHarness,
			blocks: newBlocks,
			contextWindow: 500_000,
		});
		const elapsed = performance.now() - start;

		console.log(`Full sync reset at 500k: ${elapsed.toFixed(2)}ms`);
		expect(elapsed).toBeLessThan(100);
	});
});
