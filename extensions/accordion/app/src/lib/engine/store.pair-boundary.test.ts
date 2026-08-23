import { describe, it, expect } from "vitest";
import { AccordionStore } from "./store.svelte";
import { noOpenToolPairAcrossPreGroupTail, computePreGroupFromIndex } from "$conductors/my-customize-conductor/chunked-compaction";
import type { Block, ParsedSession } from "./types";

// Regression fixture for the parallel-tool-calls transcript shape produced by
// gpt-5.6 in the benchmark: ONE assistant message with N tool_calls, followed
// by N tool_result messages. The newest tool_result is huge (~15k), all its
// siblings are also large. Pair-snap must pull ALL K tool_calls AND all K
// tool_results into the protected tail together, so that the pre-group /
// protected-tail boundary lands ABOVE the assistant thinking that opened the
// batch, not mid-batch. Otherwise noOpenToolPairAcrossPreGroupTail keeps
// returning false and the conductor refuses to roll over forever.
function parallelBatch(
	start: number,
	K: number,
	callIdOffset = 0,
	resultTokens = 15_000,
): { blocks: Block[]; next: number } {
	const blocks: Block[] = [];
	let idx = start;
	// One assistant message: [thinking, tool_call_0, tool_call_1, ..., tool_call_{K-1}]
	blocks.push({ ...blk(idx, "thinking", 200), id: `a:t${start}:p0` });
	idx++;
	for (let k = 0; k < K; k++) {
		const cid = `c${callIdOffset + k}`;
		blocks.push({
			...blk(idx, "tool_call", 200, { callId: cid, toolName: "read" }),
			id: `a:t${start}:p${k + 1}`,
		});
		idx++;
	}
	// K tool_result messages, biggest last so the tokens-walk starts at the newest.
	for (let k = 0; k < K; k++) {
		const cid = `c${callIdOffset + k}`;
		blocks.push({
			...blk(idx, "tool_result", resultTokens, { callId: cid, toolName: "read" }),
			id: `r:${cid}`,
		});
		idx++;
	}
	return { blocks, next: idx };
}

/*
 * The store header commits: "a folded block still exists and still carries its callId,
 * so a tool_call/result pair is never structurally broken." That invariant is enforced
 * at fold time. This file pins it at BOUNDARY CONSTRUCTION time too — protectedFromIndex
 * must not land between a tool_call and its paired tool_result.
 *
 * Background: pi's transcript places every tool_call in an assistant message immediately
 * followed by a separate tool_result message. When the newest block is a large tool_result
 * (whole file content), the tokens-based walk-back stops at blocks.length - 1, protecting
 * only the tool_result and leaving its paired tool_call foldable one step earlier. The
 * my-customize-conductor's noOpenToolPairAcrossPreGroupTail guard then refuses to roll
 * over indefinitely, and Accordion never folds.
 */

function blk(i: number, kind: Block["kind"] = "text", tokens = 1000, extra: Partial<Block> = {}): Block {
	return {
		id: `m${i}:p0`,
		kind,
		turn: i + 1,
		order: i,
		text: `block ${i} ` + "x".repeat(tokens * 4),
		tokens,
		override: null,
		autoFolded: false,
		by: null,
		...extra,
	};
}

function makeStore(blocks: Block[]): AccordionStore {
	const parsed: ParsedSession = {
		meta: { format: "pi", title: "t", cwd: "", model: "" },
		blocks,
		lineCount: 0,
		skipped: 0,
	};
	return new AccordionStore(parsed);
}

describe("protectedFromIndex snaps to keep tool_call/tool_result pairs whole", () => {
	it("swallows the paired tool_call when the tail's newest block is a heavy tool_result", () => {
		// pi-shaped transcript: 8 old text turns, then one assistant(tool_call) + tool_result pair.
		// The tool_result is heavy (file contents); the paired tool_call is small.
		const older = Array.from({ length: 8 }, (_, i) => blk(i, "text", 3_000));
		const toolCall = blk(8, "tool_call", 500, { callId: "cX", toolName: "read" });
		const toolResult = blk(9, "tool_result", 8_000, { callId: "cX" });
		const s = makeStore([...older, toolCall, toolResult]);
		s.setProtect(3_000);

		// Newest block alone (8000) is already ≥ target (3000). Without pair-snap the boundary
		// would land at index 9 and split the pair. With pair-snap the tool_call joins the tail.
		expect(s.protectedFromIndex).toBe(8);
		expect(s.isProtected(s.get("m8:p0")!)).toBe(true);
		expect(s.isProtected(s.get("m9:p0")!)).toBe(true);
	});

	it("swallows a paired tool_call when the walk-back stops mid-sequence at target", () => {
		// Smaller newest block; walk crosses target on the pair member. Still must not split.
		const older = Array.from({ length: 8 }, (_, i) => blk(i, "text", 3_000));
		const toolCall = blk(8, "tool_call", 1_500, { callId: "cY", toolName: "read" });
		const toolResult = blk(9, "tool_result", 3_000, { callId: "cY" });
		const s = makeStore([...older, toolCall, toolResult]);
		s.setProtect(3_000);

		// Newest (3000) ≥ target (3000) → walk stops at index 9. Pair-snap pulls it to 8.
		expect(s.protectedFromIndex).toBe(8);
	});

	it("no callId in the tail: boundary stays at the token-driven index (no false pair-snap)", () => {
		// Regression guard: pair-snap must only activate when a callId truly straddles.
		const blocks = Array.from({ length: 10 }, (_, i) => blk(i, "text", 3_000));
		const s = makeStore(blocks);
		s.setProtect(3_000);
		// Newest 3000 ≥ target 3000 → tail starts at index 9, no callIds anywhere.
		expect(s.protectedFromIndex).toBe(9);
	});

	it("chain of pair members: snap keeps walking until no straddle remains", () => {
		// Rare but possible: assistant emits two tool_calls in one message (call_A, call_B),
		// then two tool_results follow. If the boundary lands mid-chain, snap must clear both.
		const older = Array.from({ length: 6 }, (_, i) => blk(i, "text", 3_000));
		const callA = blk(6, "tool_call", 300, { callId: "cA", toolName: "read" });
		const callB = blk(7, "tool_call", 300, { callId: "cB", toolName: "read" });
		const resultA = blk(8, "tool_result", 4_000, { callId: "cA" });
		const resultB = blk(9, "tool_result", 4_000, { callId: "cB" });
		const s = makeStore([...older, callA, callB, resultA, resultB]);
		s.setProtect(3_000);

		// Newest 4000 ≥ target → walk stops at 9. Pair-snap must pull past callB's result (8),
		// then past callB itself (7), then past callA's result-mate straddle... net: 6.
		expect(s.protectedFromIndex).toBe(6);
	});

	it("does not extend below the oldest block (defensive: chain longer than history)", () => {
		// Pathological: the entire history is one giant tool span. Snap must clamp at 0.
		const call = blk(0, "tool_call", 500, { callId: "c0", toolName: "read" });
		const result = blk(1, "tool_result", 10_000, { callId: "c0" });
		const s = makeStore([call, result]);
		s.setProtect(3_000);

		expect(s.protectedFromIndex).toBe(0);
	});
});

describe("parallel tool_calls: benchmark-shaped transcript", () => {
	it("pulls the whole assistant(K tool_calls) + K tool_results batch into the tail so no pair straddles", () => {
		// pi transcript from the benchmark: 8 old text blocks, then one assistant message
		// with 8 parallel tool_calls, then 8 tool_result messages. Newest tool_result is huge.
		const older = Array.from({ length: 8 }, (_, i) => blk(i, "text", 3_000));
		const { blocks: batch } = parallelBatch(8, 8, 0, 15_000);
		const s = makeStore([...older, ...batch]);
		// Realistic tail target — one whole file result is already above it.
		s.setProtect(3_000);

		const pf = s.protectedFromIndex;
		// Batch is 1 (thinking) + 8 (tool_calls) + 8 (tool_results) = 17 blocks at indices 8..24.
		// After pair-snap the boundary must be at index 9 (first tool_call) or lower — never
		// splitting a call/result pair. Any of {9, 8} is acceptable; anything > 9 is a bug.
		expect(pf).toBeLessThanOrEqual(9);

		// The invariant the conductor actually reads: pair check on the boundary.
		const view = {
			blocks: s.blocks.map((b) => ({
				id: b.id,
				kind: b.kind,
				turn: b.turn,
				order: b.order,
				tokens: b.tokens,
				text: b.text,
				callId: b.callId,
				toolName: b.toolName,
				held: false,
				folded: false,
				grouped: false,
				messageKey: b.id,
			})),
			protectedFromIndex: pf,
			frozenFromIndex: 0,
			liveTokens: 999_999,
			protectTokens: 3_000,
		} as unknown as Parameters<typeof noOpenToolPairAcrossPreGroupTail>[0];

		// Pre-group starts at the newest block just before the tail. If snap did its job the
		// tail contains BOTH members of every callId in the batch, so pair check must pass.
		const preGroupFromIndex = computePreGroupFromIndex(view, 50_000, (b) => b.held || b.folded);
		expect(noOpenToolPairAcrossPreGroupTail(view, preGroupFromIndex)).toBe(true);
	});
});
