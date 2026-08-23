/*
 * conductor.compaction-naive.test.ts — state-machine tests for NaiveCompactionConductor.
 *
 * The redesigned conductor collapses the aged region into ONE `group` command whose
 * `digest` is an LLM-generated summary (sliding-window's shape, with a summary digest
 * instead of `null`). These tests pin that behaviour.
 *
 * Tests are purely unit-level: no AccordionStore, no file I/O, no real timers (one
 * store-level integration block at the end). Promises are resolved/rejected manually by
 * calling the captured resolve/reject closures so every test is fully deterministic.
 *
 * Test plan:
 *   1. Under threshold / no aged region → []; complete never called.
 *   2. First compaction: launch → null → resolve → ONE group(digest: summary) command.
 *   3. Idempotent re-emit: same group returned without calling complete again.
 *   4. Hysteresis: after a compaction, a new aged block does NOT re-trigger while the
 *      VISIBLE window is still below 90%; it re-triggers once visible refills to 90%.
 *   5. Recursive/amnesiac: second prompt = prior summary + newly-aged text, NOT the
 *      originals already compressed; the group covers ALL compacted blocks.
 *   6. No double-launch while a completion is in-flight.
 *   7. Unavailable path: can("complete")===false → preserve current state; no complete.
 *   8. detach() aborts an in-flight completion; re-attach resets state.
 *   9. Prompt construction (first + recursive); system prompt bakes user messages verbatim.
 *  10. Held / grouped blocks are excluded from the aged region.
 *  11. Threshold boundary (90% of the VISIBLE window).
 *  12. All kinds swallowed: user, tool_call, tool_result, thinking, text all appear in the
 *      prompt AND are covered by the single group (tool_call no longer excluded).
 *  13. Empty completion text is a failure: prior state preserved, no header-only group.
 *  14. attemptKey on newlyAged: shrink of aged set must not relaunch; a new block must.
 *  15. Degrade must not clobber an existing LLM summary (re-emit group; relaunch on recovery).
 *  16. DATA-LOSS-CLASS regression: vanished compacted blocks → group covers the survivors;
 *      all vanished → [] (no lone empties possible with the group shape).
 *  17. AccordionStore integration: the summary lands as a real folded group; user blocks are
 *      swallowed into the group (not left live); tool_call/result pair-balanced.
 */

import { describe, it, expect, vi } from "vitest";
import { NaiveCompactionConductor } from "$conductors/compaction-naive/compaction-naive";
import { MyCustomizeConductor } from "$conductors/my-customize-conductor/my-customize-conductor";
import * as chunkedCompaction from "$conductors/my-customize-conductor/chunked-compaction";
import { corpusContentHash } from "$conductors/my-customize-conductor/chunked-compaction";
import { humanTokens } from "$conductors/my-customize-conductor/constants";
import { AccordionStore } from "./store.svelte";
import type { Block, ParsedSession } from "./types";
import { resolveRecall } from "../live/plan";
import type {
	Command,
	ConductorHost,
	ConductorView,
	ViewBlock,
	CompletionRequest,
	CompletionResult,
	JSONValue,
} from "$conductors/contract";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal ViewBlock. */
function vb(
	id: string,
	opts: {
		tokens?: number;
		kind?: ViewBlock["kind"];
		text?: string;
		held?: boolean;
		grouped?: boolean;
		protected?: boolean;
		order?: number;
		toolName?: string;
	} = {},
): ViewBlock {
	return {
		id,
		kind: opts.kind ?? "text",
		turn: 1,
		order: opts.order ?? 0,
		tokens: opts.tokens ?? 1000,
		foldedTokens: 50,
		held: opts.held ?? false,
		folded: false,
		protected: opts.protected ?? false,
		grouped: opts.grouped ?? false,
		text: opts.text ?? `content of ${id}`,
		toolName: opts.toolName,
	};
}

/**
 * Build a ConductorView.
 *
 * @param agedBlocks  - blocks that are OLDER than the protected tail (i < protectedFromIndex)
 * @param tailBlocks  - blocks IN the protected tail (i >= protectedFromIndex)
 * @param budget      - token budget
 * @param liveTokens  - current RAW live token count (the host clears conductor folds first)
 */
function makeView(
	agedBlocks: ViewBlock[],
	tailBlocks: ViewBlock[],
	budget = 100_000,
	liveTokens?: number,
): ConductorView {
	const blocks = [...agedBlocks, ...tailBlocks];
	const total = liveTokens ?? blocks.reduce((s, b) => s + b.tokens, 0);
	return {
		blocks,
		budget,
		contextWindow: null,
		liveTokens: total,
		protectedFromIndex: agedBlocks.length,
		protectTokens: 20_000,
		frozenFromIndex: 0,
	};
}

/** Build a real engine Block for end-to-end AccordionStore regressions. */
function blk(
	i: number,
	kind: Block["kind"] = "text",
	tokens = 1000,
	extra: Partial<Block> = {},
): Block {
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

async function flushMicrotasks(times = 6): Promise<void> {
	for (let i = 0; i < times; i++) await Promise.resolve();
}

// ── Mock host ─────────────────────────────────────────────────────────────────

interface PendingCompletion {
	req: CompletionRequest;
	resolve: (r: CompletionResult) => void;
	reject: (e: unknown) => void;
}

interface MockHostOptions {
	canComplete?: boolean;
}

class MockHost implements ConductorHost {
	canComplete: boolean;
	completeCalls: CompletionRequest[] = [];
	requestRerunCalls = 0;
	countTokensCalls = 0;
	digestOfCalls: string[] = [];
	statusText = "";
	statusMetrics: Record<string, number | string | boolean> = {};
	statusCalls: Array<{
		text: string | null;
		metrics: Record<string, number | string | boolean>;
		details: JSONValue | undefined;
	}> = [];

	/** Pending in-flight completions. Pop and resolve/reject from tests. */
	pending: PendingCompletion[] = [];

	/**
	 * When set, calling requestRerun() immediately invokes this callback.
	 * Used by tests to simulate the host re-invoking conduct() after requestRerun.
	 */
	onRequestRerun: (() => void) | null = null;

	constructor(opts: MockHostOptions = {}) {
		this.canComplete = opts.canComplete ?? true;
	}

	can(cap: string): boolean {
		if (cap === "complete") return this.canComplete;
		return true; // countTokens, digest always available
	}

	complete(req: CompletionRequest): Promise<CompletionResult> {
		this.completeCalls.push(req);
		return new Promise<CompletionResult>((resolve, reject) => {
			this.pending.push({ req, resolve, reject });
		});
	}

	countTokens(text: string): number {
		this.countTokensCalls++;
		return Math.ceil(text.length / 4);
	}

	digestOf(id: string): string | null {
		this.digestOfCalls.push(id);
		return `{#digest FOLDED} digest of ${id}`;
	}

	setStatus(text: string | null, metrics: Record<string, number | string | boolean> = {}, details?: JSONValue): void {
		this.statusText = text ?? "";
		this.statusMetrics = text ? metrics : {};
		this.statusCalls.push({ text, metrics, details });
	}

	requestRerun(): void {
		this.requestRerunCalls++;
		this.onRequestRerun?.();
	}

	/** Resolve the oldest pending completion with the given text. */
	resolveNext(text: string): void {
		const p = this.pending.shift();
		if (!p) throw new Error("no pending completion to resolve");
		p.resolve({ text, model: "test-model" });
	}

	/** Reject the oldest pending completion. */
	rejectNext(err: unknown = new Error("test rejection")): void {
		const p = this.pending.shift();
		if (!p) throw new Error("no pending completion to reject");
		p.reject(err);
	}

	get lastReq(): CompletionRequest {
		return this.completeCalls[this.completeCalls.length - 1];
	}
}

// ── 1. Under threshold / no aged region → [] and no complete calls ────────────

describe("NaiveCompactionConductor — under threshold / no aged region", () => {
	it("returns [] when liveTokens < 90% budget with no aged blocks", () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		const view = makeView([], [vb("tail0")], 100_000, 10_000);
		const result = c.conduct(view);

		expect(result).toEqual([]);
		expect(host.completeCalls).toHaveLength(0);
	});

	it("returns [] when aged blocks exist but the visible window is below 90% (no prior summary)", () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		// liveTokens = 89999 < 90000 (90% of 100k). No summary → visible = liveTokens. No trigger.
		const view = makeView([vb("a0")], [vb("tail0")], 100_000, 89_999);
		const result = c.conduct(view);

		expect(result).toEqual([]);
		expect(host.completeCalls).toHaveLength(0);
	});

	it("returns [] with several aged blocks well under threshold (no prior summary)", () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		const aged = [vb("a0"), vb("a1")];
		const view = makeView(aged, [vb("tail0")], 100_000, 50_000);
		const result = c.conduct(view);

		expect(result).toEqual([]);
		expect(host.completeCalls).toHaveLength(0);
	});

	it("returns null when host is not provided (no attach call)", () => {
		const c = new NaiveCompactionConductor();
		const view = makeView([vb("a0")], [vb("tail0")], 100_000, 96_000);
		const result = c.conduct(view);

		expect(result).toBeNull();
	});
});

// ── 2. First compaction: launch → null → resolve → ONE group command ──────────

describe("NaiveCompactionConductor — first compaction cycle", () => {
	it("over threshold with aged blocks: first conduct launches exactly one complete and returns null", () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		const aged = [vb("a0"), vb("a1"), vb("a2")];
		// liveTokens = 96000 >= 90000 (90% of 100k). No summary → visible = 96000.
		const view = makeView(aged, [vb("tail0")], 100_000, 96_000);
		const result = c.conduct(view);

		// Must hold (return null) while the completion is in-flight
		expect(result).toBeNull();
		expect(host.completeCalls).toHaveLength(1);
		expect(host.pending).toHaveLength(1);
	});

	it("after completion resolves and requestRerun fires, next conduct returns ONE group command covering all aged blocks", async () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		const aged = [vb("a0", { order: 0 }), vb("a1", { order: 1 }), vb("a2", { order: 2 })];
		const view = makeView(aged, [vb("tail0")], 100_000, 96_000);

		c.conduct(view);
		expect(host.pending).toHaveLength(1);

		let conductCalledAfterRequestRerun = false;
		host.onRequestRerun = () => {
			conductCalledAfterRequestRerun = true;
		};
		host.resolveNext("Summary text from the model.");

		await Promise.resolve();

		expect(conductCalledAfterRequestRerun).toBe(true);
		expect(host.requestRerunCalls).toBe(1);

		// Now conduct again — should return exactly ONE group command.
		const result = c.conduct(view);

		expect(result).not.toBeNull();
		expect(Array.isArray(result)).toBe(true);
		const cmds = result!;

		// Exactly one command, and it is a group (no replace commands at all).
		expect(cmds).toHaveLength(1);
		const group = cmds[0];
		expect(group.kind).toBe("group");

		// The group spans the first to the last aged block (host snaps outward to whole
		// messages from these endpoints).
		const g = group as { ids: string[]; digest: string };
		expect(g.ids).toEqual(["a0", "a2"]);

		// The digest is the summary (preamble + model text), not an engine fold marker.
		expect(g.digest).toContain("Summary text from the model.");
		expect(g.digest).toContain("3 earlier message");
	});

	it("no replace commands are ever emitted (the group is the sole command shape)", async () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		const aged = [vb("a0"), vb("a1")];
		const view = makeView(aged, [vb("tail0")], 100_000, 96_000);

		c.conduct(view);
		host.resolveNext("Compact summary of the session.");
		await Promise.resolve();

		const result = c.conduct(view);
		expect(result).not.toBeNull();
		for (const cmd of result!) {
			expect(cmd.kind).not.toBe("replace");
			expect(cmd.kind).not.toBe("fold");
		}
		expect(result!.every((cmd) => cmd.kind === "group")).toBe(true);
	});
});

// ── 3. Idempotent re-emit ─────────────────────────────────────────────────────

describe("NaiveCompactionConductor — idempotent re-emit", () => {
	it("repeated conduct calls after a summary exists return the same group without calling complete again", async () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		const aged = [vb("a0"), vb("a1")];
		const view = makeView(aged, [vb("tail0")], 100_000, 96_000);

		c.conduct(view);
		host.resolveNext("The summary.");
		await Promise.resolve();

		const result1 = c.conduct(view);
		const result2 = c.conduct(view);
		const result3 = c.conduct(view);

		expect(host.completeCalls).toHaveLength(1); // complete called EXACTLY once total

		// All three return the same single group command.
		expect(result1).not.toBeNull();
		expect(result2).not.toBeNull();
		expect(result3).not.toBeNull();
		expect(JSON.stringify(result1)).toBe(JSON.stringify(result2));
		expect(JSON.stringify(result2)).toBe(JSON.stringify(result3));
		expect(result1!).toHaveLength(1);
		expect(result1![0].kind).toBe("group");
	});

	it("returns the same group even when liveTokens drops below threshold (once compacted, stays compacted)", async () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		const aged = [vb("a0"), vb("a1")];
		const view1 = makeView(aged, [vb("tail0")], 100_000, 96_000);

		c.conduct(view1);
		host.resolveNext("Summary.");
		await Promise.resolve();
		c.conduct(view1); // commit the summary

		// Now simulate liveTokens dropping below threshold.
		const view2 = makeView(aged, [vb("tail0")], 100_000, 50_000);
		const result = c.conduct(view2);

		expect(result).not.toBeNull();
		expect(result!).toHaveLength(1);
		expect(result![0].kind).toBe("group");
		expect(host.completeCalls).toHaveLength(1);
	});

	it("re-emits the group even while still over threshold, as long as nothing new has aged in", async () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		// Small blocks: after compaction the saving is tiny, so the visible window stays
		// above 90%. But newlyAged is empty → the conductor HOLDS (no relaunch).
		const aged = [vb("a0"), vb("a1")];
		const view = makeView(aged, [vb("tail0")], 100_000, 96_000);

		c.conduct(view);
		host.resolveNext("Summary.");
		await Promise.resolve();
		c.conduct(view); // commit

		// Still over threshold, same aged set (nothing new) → re-emit, no relaunch.
		const result = c.conduct(view);
		expect(result).not.toBeNull();
		expect(result![0].kind).toBe("group");
		expect(host.completeCalls).toHaveLength(1);
	});
});

// ── 4. Hysteresis: visible-window band ────────────────────────────────────────

describe("NaiveCompactionConductor — hysteresis (visible-window band)", () => {
	it("after a compaction with large saving, a new aged block does NOT re-trigger while visible < 90%", async () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		// Large aged blocks so the summary saving is significant.
		const a0 = vb("a0", { tokens: 40_000, order: 0 });
		const a1 = vb("a1", { tokens: 40_000, order: 1 });
		const tail0 = vb("tail0", { tokens: 4_000 });

		// liveTokens = 96000 >= 90000 → first compaction triggers.
		const view1 = makeView([a0, a1], [tail0], 100_000, 96_000);
		c.conduct(view1);
		host.resolveNext("FIRST SUMMARY");
		await Promise.resolve();
		c.conduct(view1); // commit

		// After compaction: survivors = [a0, a1] (80k tokens), summary cost is tiny.
		// savedTokens ≈ 80k → visible ≈ 96000 - 80000 = 16000, well below 90000.
		// A new block b0 ages in (newlyAged = [b0]) but visible is still below 90% → NO relaunch.
		const b0 = vb("b0", { tokens: 5_000, order: 2 });
		const view2 = makeView([a0, a1, b0], [tail0], 100_000, 101_000);
		const result = c.conduct(view2);

		// No second completion launched.
		expect(host.completeCalls).toHaveLength(1);
		// The conductor re-emits the existing summary group (covers a0, a1; b0 stays live).
		expect(result).not.toBeNull();
		const groups = result!.filter((cmd) => cmd.kind === "group") as Array<{
			ids: string[];
			digest: string;
		}>;
		expect(groups).toHaveLength(1);
		expect(groups[0].ids).toEqual(["a0", "a1"]);
		expect(groups[0].digest).toContain("FIRST SUMMARY");
	});

	it("re-triggers once the visible window refills to 90% (new aged content pushes it over)", async () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		const a0 = vb("a0", { tokens: 40_000, order: 0 });
		const a1 = vb("a1", { tokens: 40_000, order: 1 });
		const tail0 = vb("tail0", { tokens: 4_000 });

		const view1 = makeView([a0, a1], [tail0], 100_000, 96_000);
		c.conduct(view1);
		host.resolveNext("FIRST SUMMARY");
		await Promise.resolve();
		c.conduct(view1); // commit; visible ≈ 16000

		// New block b0 aged in, but visible still below 90%.
		const b0 = vb("b0", { tokens: 5_000, order: 2 });
		const view2 = makeView([a0, a1, b0], [tail0], 100_000, 101_000);
		c.conduct(view2); // no relaunch
		expect(host.completeCalls).toHaveLength(1);

		// Now grow the raw window until visible >= 90000.
		// visible = liveTokens - savedTokens(≈80000) >= 90000 → liveTokens >= 170000.
		const view3 = makeView([a0, a1, b0], [tail0], 100_000, 171_000);
		c.conduct(view3); // visible ≈ 91000 >= 90000, newlyAged=[b0] → relaunch

		expect(host.completeCalls).toHaveLength(2);
		const secondPrompt = host.completeCalls[1].prompt;
		// Amnesia: the second prompt reads the prior summary + b0, NOT a0/a1 originals.
		expect(secondPrompt).toContain("FIRST SUMMARY");
		expect(secondPrompt).toContain("content of b0");
	});
});

// ── 5. Recursive / amnesiac prompt ───────────────────────────────────────────

describe("NaiveCompactionConductor — recursive compaction (amnesia)", () => {
	it("second compaction prompt contains prior summary and newly aged text but NOT original first-batch text", async () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		const a0 = vb("a0", { text: "ORIGINAL BLOCK A0 CONTENT" });
		const a1 = vb("a1", { text: "ORIGINAL BLOCK A1 CONTENT" });
		const tail0 = vb("tail0", { protected: true });

		const view1 = makeView([a0, a1], [tail0], 100_000, 96_000);
		c.conduct(view1);
		host.resolveNext("FIRST SUMMARY OUTPUT");
		await Promise.resolve();
		c.conduct(view1); // commit

		// b0 ages in; small blocks so visible stays over 90% → relaunch.
		const b0 = vb("b0", { text: "NEW BLOCK B0 CONTENT" });
		const view2 = makeView([a0, a1, b0], [tail0], 100_000, 96_000);
		c.conduct(view2);

		expect(host.completeCalls).toHaveLength(2);
		const secondPrompt = host.completeCalls[1].prompt;

		expect(secondPrompt).toContain("FIRST SUMMARY OUTPUT");
		expect(secondPrompt).toContain("NEW BLOCK B0 CONTENT");
		// Amnesia: the originals already compressed are NOT re-read.
		expect(secondPrompt).not.toContain("ORIGINAL BLOCK A0 CONTENT");
		expect(secondPrompt).not.toContain("ORIGINAL BLOCK A1 CONTENT");
	});

	it("second compaction uses the <previous-summary> and <conversation> wrappers with merge instructions", async () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		const aged = [vb("a0"), vb("a1")];
		const view1 = makeView(aged, [vb("tail0")], 100_000, 96_000);

		c.conduct(view1);
		host.resolveNext("SUMMARY ONE");
		await Promise.resolve();
		c.conduct(view1);

		const b0 = vb("b0");
		const view2 = makeView([...aged, b0], [vb("tail0")], 100_000, 96_000);
		c.conduct(view2);

		expect(host.completeCalls).toHaveLength(2);
		const prompt2 = host.completeCalls[1].prompt;

		expect(prompt2).toContain("<previous-summary>");
		expect(prompt2).toContain("</previous-summary>");
		expect(prompt2).toContain("<conversation>");
		expect(prompt2).toContain("</conversation>");
		// Merge instructions carry the prior summary forward (no silent drop) and keep
		// verbatim user messages intact across compactions.
		expect(prompt2).toContain("PRESERVE");
		expect(prompt2).toMatch(/verbatim/i);
	});

	it("after the second compaction resolves, the group covers ALL aged blocks (a0+a1+b0)", async () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		const a0 = vb("a0", { order: 0 });
		const a1 = vb("a1", { order: 1 });
		const view1 = makeView([a0, a1], [vb("tail0")], 100_000, 96_000);
		c.conduct(view1);
		host.resolveNext("Summary 1");
		await Promise.resolve();
		c.conduct(view1);

		const b0 = vb("b0", { order: 2 });
		const view2 = makeView([a0, a1, b0], [vb("tail0")], 100_000, 96_000);
		c.conduct(view2); // launches second completion
		host.resolveNext("Summary 2");
		await Promise.resolve();

		const result = c.conduct(view2);
		expect(result).not.toBeNull();

		// ONE group spanning a0..b0, digest = Summary 2.
		expect(result!).toHaveLength(1);
		const g = result![0] as { kind: string; ids: string[]; digest: string };
		expect(g.kind).toBe("group");
		expect(g.ids).toEqual(["a0", "b0"]);
		expect(g.digest).toContain("Summary 2");
	});
});

// ── 6. No double-launch while in-flight ───────────────────────────────────────

describe("NaiveCompactionConductor — no double-launch while in-flight", () => {
	it("while a complete is pending, further conduct calls do not call complete again", () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		const aged = [vb("a0"), vb("a1")];
		const view = makeView(aged, [vb("tail0")], 100_000, 96_000);

		c.conduct(view); // launches
		c.conduct(view); // must NOT launch again
		c.conduct(view); // must NOT launch again

		expect(host.completeCalls).toHaveLength(1);
		expect(host.pending).toHaveLength(1);
	});

	it("the first conduct returns null (no summary yet); later conducts while in-flight also return null", () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		const aged = [vb("a0"), vb("a1")];
		const view = makeView(aged, [vb("tail0")], 100_000, 96_000);

		const r1 = c.conduct(view);
		const r2 = c.conduct(view);
		const r3 = c.conduct(view);

		expect(r1).toBeNull();
		expect(r2).toBeNull();
		expect(r3).toBeNull();
	});

	it("after rejection, does NOT re-launch on the next conduct with the SAME newly-aged set", async () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		const aged = [vb("a0"), vb("a1")];
		const view = makeView(aged, [vb("tail0")], 100_000, 96_000);

		c.conduct(view); // launch #1
		host.rejectNext(new Error("network error"));
		await Promise.resolve();

		// Same aged set → newlyAged unchanged → attempt key unchanged → no relaunch.
		const result = c.conduct(view);
		expect(host.completeCalls).toHaveLength(1);
		// No summary yet → definite "nothing applied" answer → [] (not null).
		expect(result).toEqual([]);
	});

	it("after rejection, returns [] (not null) on subsequent conducts with the same aged set", async () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		const aged = [vb("a0"), vb("a1")];
		const view = makeView(aged, [vb("tail0")], 100_000, 96_000);

		c.conduct(view);
		host.rejectNext(new Error("error"));
		await Promise.resolve();

		const r1 = c.conduct(view);
		const r2 = c.conduct(view);
		expect(host.completeCalls).toHaveLength(1);
		expect(r1).toEqual([]);
		expect(r2).toEqual([]);
	});

	it("after rejection, DOES re-launch when a NEW aged block arrives (attempt key changes)", async () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		const aged = [vb("a0"), vb("a1")];
		const view1 = makeView(aged, [vb("tail0")], 100_000, 96_000);

		c.conduct(view1); // launch #1
		host.rejectNext(new Error("error"));
		await Promise.resolve();

		const b0 = vb("b0");
		const view2 = makeView([...aged, b0], [vb("tail0")], 100_000, 96_000);
		c.conduct(view2); // newlyAged grows → new key → launch #2

		expect(host.completeCalls).toHaveLength(2);
	});
});

// ── 7. Unavailable path ───────────────────────────────────────────────────────

describe("NaiveCompactionConductor — unavailable path (can(complete)===false)", () => {
	it("returns [] and never calls complete when can returns false before a summary exists", () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost({ canComplete: false });
		c.attach(host);

		const aged = [vb("a0"), vb("a1"), vb("a2")];
		const view = makeView(aged, [vb("tail0")], 100_000, 96_000);
		const result = c.conduct(view);

		expect(host.completeCalls).toHaveLength(0);
		expect(result).toEqual([]);
		expect(host.statusText).toContain("waiting for live model link");
	});

	it("does not fall back to a deterministic group command in degrade mode", () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost({ canComplete: false });
		c.attach(host);

		const aged = [vb("first0"), vb("mid1"), vb("last2")];
		const view = makeView(aged, [vb("tail0")], 100_000, 96_000);
		const result = c.conduct(view)!;

		expect(result.some((cmd) => cmd.kind === "group")).toBe(false);
		expect(result).toEqual([]);
	});

	it("degrade with 0 aged blocks returns []", () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost({ canComplete: false });
		c.attach(host);

		const view = makeView([], [vb("tail0")], 100_000, 96_000);
		const result = c.conduct(view);

		expect(result).toEqual([]);
	});
});

// ── 8. detach() aborts in-flight completion ─────────────────────────────────

describe("NaiveCompactionConductor — detach() lifecycle", () => {
	it("detach() aborts the AbortSignal passed to in-flight complete", async () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		const aged = [vb("a0"), vb("a1")];
		const view = makeView(aged, [vb("tail0")], 100_000, 96_000);

		c.conduct(view); // launches completion

		expect(host.pending).toHaveLength(1);
		const signal = host.pending[0].req.signal;
		expect(signal).toBeDefined();
		expect(signal!.aborted).toBe(false);

		c.detach();

		expect(signal!.aborted).toBe(true);
	});

	it("after detach(), a late-rejecting completion does not cause errors", async () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		const aged = [vb("a0"), vb("a1")];
		const view = makeView(aged, [vb("tail0")], 100_000, 96_000);

		c.conduct(view);
		const pending = host.pending[0];

		c.detach();

		await expect(async () => {
			pending.reject(new Error("aborted"));
			await Promise.resolve();
		}).not.toThrow();
	});

	it("detach() with no in-flight completion is a no-op (does not throw)", () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		expect(() => c.detach()).not.toThrow();
	});

	it("after detach(), conduct() returns null (no host)", () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);
		c.detach();

		const aged = [vb("a0")];
		const view = makeView(aged, [vb("tail0")], 100_000, 96_000);
		const result = c.conduct(view);

		expect(result).toBeNull();
	});

	it("reattach resets prior summary, compacted ids, and retry key", async () => {
		const c = new NaiveCompactionConductor();
		const host1 = new MockHost();
		c.attach(host1);

		const oldView = makeView([vb("old0"), vb("old1")], [vb("tail0")], 100_000, 96_000);
		c.conduct(oldView);
		host1.resolveNext("old summary");
		await Promise.resolve();
		expect(c.conduct(oldView)).not.toEqual([]);

		c.detach();
		const host2 = new MockHost();
		c.attach(host2);

		// Same ids in a later session must not inherit the old summary/compactedIds.
		const newView = makeView([vb("old0"), vb("old1")], [vb("tail0")], 100_000, 50_000);
		expect(c.conduct(newView)).toEqual([]);

		// A failed attempt key from the prior lifetime must not suppress a fresh launch either.
		const overBudget = makeView([vb("old0"), vb("old1")], [vb("tail0")], 100_000, 96_000);
		expect(c.conduct(overBudget)).toBeNull();
		expect(host2.completeCalls).toHaveLength(1);
	});

	it("a stale completion resolving after re-attach does NOT corrupt the new session (guard)", async () => {
		const c = new NaiveCompactionConductor();
		const host1 = new MockHost();
		c.attach(host1);

		// Launch completion A in the first lifetime.
		const viewA = makeView([vb("a0"), vb("a1")], [vb("tail0")], 100_000, 96_000);
		c.conduct(viewA);
		expect(host1.pending).toHaveLength(1);
		const stalePending = host1.pending[0];

		// Detach mid-flight (aborts A's controller) and re-attach a fresh host. A's promise is
		// still pending — the MockHost does not auto-reject on abort, simulating a completer
		// that resolves regardless of the signal.
		c.detach();
		const host2 = new MockHost();
		c.attach(host2);

		// Launch completion B in the new lifetime (same ids, fresh attempt key).
		c.conduct(viewA);
		expect(host2.pending).toHaveLength(1);
		expect(host2.completeCalls).toHaveLength(1);

		// Now A resolves LATE. The stale-completion guard must bail: B is still in-flight, so
		// A's result must not overwrite summary/compactedIds or clear B's inflight.
		stalePending.resolve({ text: "STALE SUMMARY FROM A", model: "old-model" });
		await Promise.resolve();

		// B is still pending (in-flight), and no summary has been committed.
		expect(host2.pending).toHaveLength(1);
		const holdWhileBInFlight = c.conduct(viewA);
		expect(holdWhileBInFlight).toBeNull(); // no summary yet → hold

		// B resolves: its summary commits (NOT A's stale one).
		host2.resolveNext("FRESH SUMMARY FROM B");
		await Promise.resolve();

		const result = c.conduct(viewA);
		expect(result).not.toBeNull();
		const g = result!.find((cmd) => cmd.kind === "group") as { digest: string } | undefined;
		expect(g).toBeDefined();
		expect(g!.digest).toContain("FRESH SUMMARY FROM B");
		expect(g!.digest).not.toContain("STALE SUMMARY FROM A");
	});

	it("a stale completion rejecting after re-attach does NOT clobber the new in-flight controller", async () => {
		const c = new NaiveCompactionConductor();
		const host1 = new MockHost();
		c.attach(host1);

		const view = makeView([vb("a0"), vb("a1")], [vb("tail0")], 100_000, 96_000);
		c.conduct(view);
		const stalePending = host1.pending[0];

		c.detach();
		const host2 = new MockHost();
		c.attach(host2);
		c.conduct(view); // launch B
		expect(host2.pending).toHaveLength(1);

		// A rejects late. The guard must bail — B's controller stays in-flight.
		stalePending.reject(new Error("stale abort"));
		await Promise.resolve();

		// B is still pending (the stale reject did not clear it).
		expect(host2.pending).toHaveLength(1);
		// conduct still holds (B in-flight) → null (no summary yet).
		expect(c.conduct(view)).toBeNull();

		// B can still resolve normally.
		host2.resolveNext("B SUMMARY");
		await Promise.resolve();
		const result = c.conduct(view);
		expect(result).not.toBeNull();
		expect((result!.find((cmd) => cmd.kind === "group") as { digest: string } | undefined)!.digest).toContain("B SUMMARY");
	});
});

// ── 9. Prompt construction & system prompt ────────────────────────────────────

describe("NaiveCompactionConductor — prompt construction", () => {
	it("first prompt contains the section header and block text for all aged blocks", () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		const aged = [
			vb("a0", { text: "user: do the thing", kind: "user" }),
			vb("a1", { text: "assistant reply text", kind: "text" }),
		];
		const view = makeView(aged, [vb("tail0")], 100_000, 96_000);
		c.conduct(view);

		expect(host.completeCalls).toHaveLength(1);
		const prompt = host.completeCalls[0].prompt;

		expect(prompt).toContain("<conversation>");
		expect(prompt).toContain("</conversation>");
		expect(prompt).toContain("do the thing");
		expect(prompt).toContain("assistant reply text");
	});

	it("system prompt is the compaction template and instructs VERBATIM user-message preservation", () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		const view = makeView([vb("a0")], [vb("tail0")], 100_000, 96_000);
		c.conduct(view);

		expect(host.completeCalls).toHaveLength(1);
		const { system } = host.completeCalls[0];
		expect(system).toBeDefined();
		expect(system!.length).toBeGreaterThan(50);
		// Guard: must summarize, not continue the conversation.
		expect(system).toMatch(/do NOT continue the conversation/i);
		// Structured output sections.
		expect(system).toContain("Goal");
		expect(system).toContain("Progress");
		expect(system).toContain("Relevant files");
		// The sacred rule: user messages reproduced verbatim.
		expect(system).toContain("User messages".toLowerCase());
		expect(system).toMatch(/VERBATIM/i);
	});

	it("maxOutputTokens is set to a positive number", () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		const view = makeView([vb("a0")], [vb("tail0")], 100_000, 96_000);
		c.conduct(view);

		const { maxOutputTokens } = host.completeCalls[0];
		expect(maxOutputTokens).toBeDefined();
		expect(maxOutputTokens!).toBeGreaterThan(0);
	});

	it("AbortSignal is passed to each complete call", () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		const view = makeView([vb("a0")], [vb("tail0")], 100_000, 96_000);
		c.conduct(view);

		const { signal } = host.completeCalls[0];
		expect(signal).toBeDefined();
		expect(signal).toBeInstanceOf(AbortSignal);
	});
});

// ── 10. Held / grouped blocks are excluded from the aged region ────────────────

describe("NaiveCompactionConductor — held / grouped block exclusion", () => {
	it("held blocks (human override) are not included in the aged region", () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		const held = vb("held0", { held: true });
		const aged = vb("aged0");
		const view = makeView([held, aged], [vb("tail0")], 100_000, 96_000);

		c.conduct(view);
		expect(host.completeCalls).toHaveLength(1);

		const prompt = host.completeCalls[0].prompt;
		expect(prompt).toContain(`content of ${aged.id}`);
	});

	it("grouped blocks are not included in the aged region", () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		const grouped = vb("grp0", { grouped: true });
		const aged = vb("aged0");
		const view = makeView([grouped, aged], [vb("tail0")], 100_000, 96_000);

		c.conduct(view);
		expect(host.completeCalls).toHaveLength(1);
		const prompt = host.completeCalls[0].prompt;
		expect(prompt).toContain(`content of ${aged.id}`);
	});

	it("when ALL aged blocks are held, the aged region is empty → returns [] with no complete", () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		const aged = [vb("h0", { held: true }), vb("h1", { held: true })];
		const view = makeView(aged, [vb("tail0")], 100_000, 96_000);

		const result = c.conduct(view);
		expect(result).toEqual([]);
		expect(host.completeCalls).toHaveLength(0);
	});
});

// ── 11. Threshold boundary (90% of the visible window) ────────────────────────

describe("NaiveCompactionConductor — threshold boundary (90%)", () => {
	it("triggers at exactly 90% (liveTokens === 0.90 * budget, no prior summary)", () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		const view = makeView([vb("a0"), vb("a1")], [vb("tail0")], 100_000, 90_000);
		const result = c.conduct(view);

		expect(result).toBeNull(); // null = completion in-flight
		expect(host.completeCalls).toHaveLength(1);
	});

	it("does NOT trigger at 89.999% (just below threshold) — returns []", () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		const view = makeView([vb("a0"), vb("a1")], [vb("tail0")], 100_000, 89_999);
		const result = c.conduct(view);

		expect(result).toEqual([]);
		expect(host.completeCalls).toHaveLength(0);
	});
});

// ── 12. All kinds swallowed (user, tool_call, tool_result, thinking, text) ────

describe("NaiveCompactionConductor — all block kinds are swallowed", () => {
	it("user, tool_call, tool_result, thinking, and text blocks ALL appear in the compaction prompt", () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		const aged = [
			vb("u0", { kind: "user", text: "USER INTENT TEXT", tokens: 500 }),
			vb("t0", { kind: "text", text: "assistant prose", tokens: 500 }),
			vb("th0", { kind: "thinking", text: "private reasoning", tokens: 500 }),
			vb("tc0", { kind: "tool_call", text: "TOOL_CALL_BODY", toolName: "bash", tokens: 500 }),
			vb("tr0", { kind: "tool_result", text: "TOOL_RESULT_BODY", toolName: "bash", tokens: 500 }),
		];
		const view = makeView(aged, [vb("tail0")], 100_000, 96_000);
		c.conduct(view);

		expect(host.completeCalls).toHaveLength(1);
		const prompt = host.completeCalls[0].prompt;

		// Every kind — including tool_call, which the old design excluded — is now fed to the LLM.
		expect(prompt).toContain("USER INTENT TEXT");
		expect(prompt).toContain("assistant prose");
		expect(prompt).toContain("private reasoning");
		expect(prompt).toContain("TOOL_CALL_BODY");
		expect(prompt).toContain("TOOL_RESULT_BODY");
	});

	it("the single group covers ALL kinds in the aged region (none left live by conductor choice)", async () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		const aged = [
			vb("u0", { kind: "user", order: 0, tokens: 500 }),
			vb("t0", { kind: "text", order: 1, tokens: 500 }),
			vb("tc0", { kind: "tool_call", order: 2, tokens: 500 }),
			vb("tr0", { kind: "tool_result", order: 3, tokens: 500 }),
		];
		const view = makeView(aged, [vb("tail0")], 100_000, 96_000);
		c.conduct(view);
		host.resolveNext("the summary");
		await Promise.resolve();

		const result = c.conduct(view);
		expect(result).not.toBeNull();
		expect(result!).toHaveLength(1);
		const g = result![0] as { kind: string; ids: string[]; digest: string };
		expect(g.kind).toBe("group");
		// The group spans the first (u0) to the last (tr0) aged block — every kind is inside.
		expect(g.ids).toEqual(["u0", "tr0"]);
	});

	it("an aged region that is ONLY tool_call blocks still triggers and emits a group (the host owns pair-balance)", () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		const tc1 = vb("tc1", { kind: "tool_call", tokens: 50_000 });
		const tc2 = vb("tc2", { kind: "tool_call", tokens: 46_000 });
		const view = makeView([tc1, tc2], [vb("tail0")], 100_000, 96_000);
		const result = c.conduct(view);

		// No longer excluded → a completion launches (returns null while in-flight).
		expect(result).toBeNull();
		expect(host.completeCalls).toHaveLength(1);
	});
});

// ── 13. Empty completion text is a failure ────────────────────────────────────

describe("NaiveCompactionConductor — empty completion result", () => {
	it("empty completion text is treated as failure: prior state preserved, no header-only group", async () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		const aged = [vb("a0"), vb("a1")];
		const view = makeView(aged, [vb("tail0")], 100_000, 96_000);

		expect(c.conduct(view)).toBeNull();
		host.resolveNext("   \n\t  ");
		await Promise.resolve();
		expect(host.statusText).toContain("empty summary");

		// No summary committed → clear to raw, no group emitted.
		const result = c.conduct(view);
		expect(result).toEqual([]);
		expect(host.requestRerunCalls).toBe(0);
	});

	it("an empty result does NOT clobber a prior committed summary", async () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		const aged = [vb("a0"), vb("a1")];
		const view = makeView(aged, [vb("tail0")], 100_000, 96_000);

		// First, commit a real summary.
		c.conduct(view);
		host.resolveNext("REAL SUMMARY");
		await Promise.resolve();
		c.conduct(view);

		// Force a second launch by aging in a new block, then return empty.
		const b0 = vb("b0");
		const view2 = makeView([...aged, b0], [vb("tail0")], 100_000, 96_000);
		c.conduct(view2); // launch #2
		expect(host.completeCalls).toHaveLength(2);
		host.resolveNext("   ");
		await Promise.resolve();

		// The prior REAL SUMMARY must still be emitted (not replaced by an empty/header group).
		const result = c.conduct(view2);
		expect(result).not.toBeNull();
		const g = result!.find((cmd) => cmd.kind === "group") as { digest: string } | undefined;
		expect(g).toBeDefined();
		expect(g!.digest).toContain("REAL SUMMARY");
	});
});

// ── 14. attemptKey on newlyAged ───────────────────────────────────────────────

describe("NaiveCompactionConductor — attemptKey keyed on newlyAged", () => {
	it("after a successful compaction, shrinking the aged set (human pins a newly-aged block) does NOT relaunch", async () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		const x0 = vb("x0", { order: 0 });
		const x1 = vb("x1", { order: 1 });
		const viewFirst = makeView([x0, x1], [vb("tail0")], 100_000, 96_000);

		// Successful first compaction.
		c.conduct(viewFirst);
		host.resolveNext("summary");
		await Promise.resolve();
		c.conduct(viewFirst); // commit

		// b0 ages in → newlyAged = [b0] → launch #2.
		const b0 = vb("b0", { order: 2 });
		const viewWithB0 = makeView([x0, x1, b0], [vb("tail0")], 100_000, 96_000);
		c.conduct(viewWithB0);
		expect(host.completeCalls).toHaveLength(2);

		host.rejectNext(new Error("error"));
		await Promise.resolve();

		// Shrink: b0 becomes held → agedBlocks no longer contains b0 → newlyAged = [].
		// needSummary = false (newlyAged empty) → no relaunch.
		const b0Held = { ...b0, held: true };
		const viewShrunk = makeView([x0, x1, b0Held], [vb("tail0")], 100_000, 96_000);
		c.conduct(viewShrunk);

		expect(host.completeCalls).toHaveLength(2); // still 2, no new launch
	});

	it("after rejection, adding a genuinely NEW aged block relaunches (attempt key changes)", async () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		const a0 = vb("a0");
		const a1 = vb("a1");
		const view1 = makeView([a0, a1], [vb("tail0")], 100_000, 96_000);

		c.conduct(view1); // launch #1
		host.rejectNext(new Error("error"));
		await Promise.resolve();

		c.conduct(view1); // same set → no relaunch
		expect(host.completeCalls).toHaveLength(1);

		const b0 = vb("b0");
		const view2 = makeView([a0, a1, b0], [vb("tail0")], 100_000, 96_000);
		c.conduct(view2); // newlyAged grows → launch #2

		expect(host.completeCalls).toHaveLength(2);
	});

	it("after a successful compaction, a new block ages in → relaunch; same newlyAged after a reject does not", async () => {
		const c = new NaiveCompactionConductor();
		const host = new MockHost();
		c.attach(host);

		const a0 = vb("a0");
		const a1 = vb("a1");
		const view1 = makeView([a0, a1], [vb("tail0")], 100_000, 96_000);

		c.conduct(view1);
		host.resolveNext("summary one");
		await Promise.resolve();
		c.conduct(view1); // commit

		const b0 = vb("b0");
		const view2 = makeView([a0, a1, b0], [vb("tail0")], 100_000, 96_000);
		c.conduct(view2); // launches #2, key = "b0"
		expect(host.completeCalls).toHaveLength(2);

		host.rejectNext(new Error("error"));
		await Promise.resolve();

		c.conduct(view2); // same newlyAged=[b0] → no relaunch
		expect(host.completeCalls).toHaveLength(2);

		const c0 = vb("c0");
		const view3 = makeView([a0, a1, b0, c0], [vb("tail0")], 100_000, 96_000);
		c.conduct(view3); // newlyAged=[b0,c0] → new key → launch #3
		expect(host.completeCalls).toHaveLength(3);
	});
});

// ── 15. Degrade must not clobber an existing LLM summary ──────────────────────

describe("NaiveCompactionConductor — degrade must not clobber an existing LLM summary", () => {
	async function setupWithSummary(): Promise<{
		conductor: NaiveCompactionConductor;
		host: MockHost;
		a0: ViewBlock;
		a1: ViewBlock;
		summaryText: string;
	}> {
		const conductor = new NaiveCompactionConductor();
		const host = new MockHost({ canComplete: true });
		conductor.attach(host);

		// Small blocks (1k each) with a large raw liveTokens: after compaction the saving is
		// tiny, so the VISIBLE window stays well over 90%. That lets the degrade tests push
		// `needSummary` true (over threshold + newly-aged) while the model link is down — the
		// exact path that surfaces the "waiting for live model link" status.
		const a0 = vb("a0", { order: 0, tokens: 1_000 });
		const a1 = vb("a1", { order: 1, tokens: 1_000 });
		const tail0 = vb("tail0", { tokens: 4_000 });

		const view = makeView([a0, a1], [tail0], 100_000, 96_000);

		conductor.conduct(view);
		expect(host.completeCalls).toHaveLength(1);

		const summaryText = "LLM GENERATED SUMMARY — DO NOT CLOBBER";
		host.resolveNext(summaryText);
		await Promise.resolve();

		const committed = conductor.conduct(view);
		expect(committed).not.toBeNull();
		const g = (committed as Array<{ kind: string; digest: string }>).find((c) => c.kind === "group");
		expect(g).toBeDefined();
		expect(g!.digest).toContain(summaryText);

		return { conductor, host, a0, a1, summaryText };
	}

	it("when the model link drops and a newly-aged block keeps visible over threshold, re-emits the existing summary group — no relaunch", async () => {
		const { conductor, host, a0, a1, summaryText } = await setupWithSummary();

		host.canComplete = false;

		// A new block ages in; the prior saving is small so visible is still over 90% →
		// needSummary is true. But the link is down → degrade: re-emit the existing summary
		// group, surface the "waiting" status, and do NOT launch.
		const newBlock = vb("new1", { order: 2, tokens: 2_000 });
		const viewOverThreshold = makeView(
			[a0, a1, newBlock],
			[vb("tail0", { tokens: 4_000 })],
			100_000,
			98_000,
		);

		const result = conductor.conduct(viewOverThreshold);

		expect(result).not.toBeNull();
		expect(Array.isArray(result)).toBe(true);
		const cmds = result!;

		// The existing LLM summary group is re-emitted (covers a0, a1).
		const groups = cmds.filter((cmd) => cmd.kind === "group") as Array<{
			ids: string[];
			digest: string;
		}>;
		expect(groups).toHaveLength(1);
		expect(groups[0].digest).toContain(summaryText);
		expect(groups[0].ids).toEqual(["a0", "a1"]);

		// No new complete call while the link is down.
		expect(host.completeCalls).toHaveLength(1);
		expect(host.statusText).toContain("waiting for live model link");
	});

	it("when the model link drops but visible is below threshold, re-emits the existing summary group", async () => {
		const { conductor, host, a0, a1, summaryText } = await setupWithSummary();

		host.canComplete = false;

		const viewUnder = makeView([a0, a1], [vb("tail0")], 100_000, 50_000);
		const result = conductor.conduct(viewUnder);

		expect(Array.isArray(result)).toBe(true);
		const cmds = result! as Array<{ kind: string; ids: string[]; digest: string }>;
		const groups = cmds.filter((c) => c.kind === "group");
		expect(groups).toHaveLength(1);
		expect(groups[0].digest).toContain(summaryText);
	});

	it("after the model link recovers, the next conduct relaunches to pick up newly-aged blocks", async () => {
		const { conductor, host, a0, a1 } = await setupWithSummary();

		host.canComplete = false;
		const newBlock = vb("new3", { order: 2, tokens: 2_000 });
		const viewDegraded = makeView([a0, a1, newBlock], [vb("tail0")], 100_000, 96_000);
		conductor.conduct(viewDegraded);
		expect(host.completeCalls).toHaveLength(1); // no new launch while link is down

		// Restore the link — visible is over 90% (large raw window) and newlyAged=[new3] → relaunch.
		host.canComplete = true;
		conductor.conduct(viewDegraded);
		expect(host.completeCalls).toHaveLength(2);
	});
});

// ── 16. DATA-LOSS-CLASS regression: vanished compacted blocks ─────────────────
//
// With the group shape there is no "empty replace without a summary head" failure mode
// (a group either collapses to the summary or is clamped and the blocks stay live). These
// tests pin the graceful re-derivation: vanished blocks simply drop out of the survivor
// run; the group re-homes to the remaining survivors; if all vanish, [] (clear to raw).

describe("NaiveCompactionConductor — vanished compacted blocks (regression)", () => {
	async function setupCompacted(): Promise<{
		conductor: NaiveCompactionConductor;
		host: MockHost;
		a: ViewBlock;
		b: ViewBlock;
		c: ViewBlock;
	}> {
		const conductor = new NaiveCompactionConductor();
		const host = new MockHost();
		conductor.attach(host);

		const a = vb("a", { order: 0 });
		const b = vb("b", { order: 1 });
		const c = vb("c", { order: 2 });

		const view = makeView([a, b, c], [vb("tail0")], 100_000, 96_000);
		conductor.conduct(view);
		host.resolveNext("THE SUMMARY");
		await Promise.resolve();
		conductor.conduct(view); // commit

		return { conductor, host, a, b, c };
	}

	it("when the first survivor vanishes, the group re-homes to the remaining contiguous survivors", async () => {
		const { conductor, b, c } = await setupCompacted();

		// a is gone; b and c survive.
		const view = makeView([b, c], [vb("tail0")], 100_000, 96_000);
		const result = conductor.conduct(view);

		expect(result).not.toBeNull();
		expect(result!).toHaveLength(1);
		const g = result![0] as { kind: string; ids: string[]; digest: string };
		expect(g.kind).toBe("group");
		expect(g.ids).toEqual(["b", "c"]);
		expect(g.digest).toContain("THE SUMMARY");
	});

	it("when the last survivor vanishes, the group spans the remaining prefix", async () => {
		const { conductor, a, b } = await setupCompacted();

		const view = makeView([a, b], [vb("tail0")], 100_000, 96_000);
		const result = conductor.conduct(view);

		expect(result).not.toBeNull();
		const g = result![0] as { ids: string[] };
		expect(g.ids).toEqual(["a", "b"]);
	});

	it("when ALL compacted blocks vanish, returns [] (clear to raw; no lone empties possible)", async () => {
		const { conductor } = await setupCompacted();

		const viewAllGone = makeView([], [vb("tail0")], 100_000, 10_000);
		const result = conductor.conduct(viewAllGone);

		expect(Array.isArray(result)).toBe(true);
		expect(result).toEqual([]);
	});

	it("a held block splitting the survivors yields one group per side (no span across the held block)", async () => {
		const { conductor, a, b, c } = await setupCompacted();

		// b becomes held → it splits [a, b, c] into [a] and [c]. The conductor walks the FULL
		// aged prefix (including the held block), so it flushes a run at b: one group over [a]
		// and one over [c], each carrying the summary. Spanning a..c instead would make the host
		// clamp the whole group `human-override`, dropping the summary for ALL survivors.
		const bHeld = { ...b, held: true };
		const view = makeView([a, bHeld, c], [vb("tail0")], 100_000, 96_000);
		const result = conductor.conduct(view);

		expect(result).not.toBeNull();
		const groups = result!.filter((cmd) => cmd.kind === "group") as Array<{
			ids: string[];
			digest: string;
		}>;
		expect(groups).toHaveLength(2);
		// First group covers a alone; second covers c alone. b is in neither.
		expect(groups[0].ids).toEqual(["a", "a"]);
		expect(groups[1].ids).toEqual(["c", "c"]);
		for (const g of groups) expect(g.digest).toContain("THE SUMMARY");
		const allIds = groups.flatMap((g) => g.ids);
		expect(allIds).not.toContain("b");
		// No replace commands ever — the group shape emits no empties.
		expect(result!.every((cmd) => cmd.kind === "group")).toBe(true);
	});
});

// ── 17. AccordionStore integration ────────────────────────────────────────────

describe("NaiveCompactionConductor — AccordionStore integration", () => {
	it("delivers the summary as a single folded group covering the aged region (user blocks swallowed, tail untouched)", async () => {
		const blocks = [
			blk(0, "user", 1000, { text: "opening user request" }),
			blk(1, "text", 2000, { text: "assistant progress" }),
			blk(2, "thinking", 1000, { text: "private reasoning" }),
			blk(3, "tool_result", 1000, { text: "tool output" }),
			blk(4, "text", 500, { text: "protected tail" }),
		];
		const s = makeStore(blocks);
		s.setProtect(500);
		s.setBudget(5_000);
		s.completer = async () => ({ text: "STORE LEVEL SUMMARY", model: "test-model" });

		s.attach(new NaiveCompactionConductor());
		await flushMicrotasks();

		// Exactly one conductor-owned group, folded, carrying the LLM summary verbatim.
		expect(s.groups.length).toBe(1);
		const g = s.groups[0];
		expect(g.folded).toBe(true);
		expect(g.by).toBe("auto");
		expect(s.isDropGroup(g)).toBe(false);
		expect(s.groupSummary(g)).toContain("STORE LEVEL SUMMARY");

		// The group covers the whole aged region (blocks 0–3) — including the user block,
		// which the old replace-based design left live. The protected tail (block 4) is NOT a member.
		expect(g.memberIds).toContain("m0:p0"); // user
		expect(g.memberIds).toContain("m1:p0"); // text
		expect(g.memberIds).toContain("m2:p0"); // thinking
		expect(g.memberIds).toContain("m3:p0"); // tool_result
		expect(g.memberIds).not.toContain("m4:p0"); // tail

		// The summary actually lands on the wire (the carrier renders the digest), and no
		// invalid-group / not-foldable clamp fired in the happy path.
		expect(s.lastReports.some((r) => r.reason === "invalid-group")).toBe(false);
		expect(s.lastReports.some((r) => r.reason === "not-foldable")).toBe(false);
	});

	it("re-compacts recursively when new blocks age in over the high-water mark", async () => {
		// Start: an aged region of two blocks, a tiny tail, a tight budget.
		const blocks = [
			blk(0, "text", 2000, { text: "first aged block" }),
			blk(1, "text", 2000, { text: "second aged block" }),
			blk(2, "text", 200, { text: "tail" }),
		];
		const s = makeStore(blocks);
		s.setProtect(200);
		s.setBudget(4_000);
		let callCount = 0;
		s.completer = async () => ({ text: `SUMMARY ${++callCount}`, model: "test-model" });

		s.attach(new NaiveCompactionConductor());
		await flushMicrotasks();

		// First compaction: one group over blocks 0–1.
		expect(s.groups.length).toBe(1);
		expect(s.groupSummary(s.groups[0])).toContain("SUMMARY 1");
		expect(s.groups[0].memberIds).toContain("m0:p0");
		expect(s.groups[0].memberIds).toContain("m1:p0");
		expect(callCount).toBe(1);

		// Append fresh content: a large newly-aged block (m3) plus a new tail (m4). The raw
		// window grows past 90% again, newlyAged becomes non-empty → a second compaction fires.
		s.appendBlocks([
			blk(3, "text", 4000, { text: "newly aged content" }),
			blk(4, "text", 200, { text: "new tail" }),
		]);
		s.setProtect(200);
		await flushMicrotasks();

		// Second compaction fired: the group now also covers the newly-aged block, with the
		// recursive summary. (Amnesia is exercised at the prompt level in the unit tests above.)
		expect(callCount).toBe(2);
		expect(s.groups.length).toBe(1);
		const g2 = s.groups[0];
		expect(s.groupSummary(g2)).toContain("SUMMARY 2");
		expect(g2.memberIds).toContain("m3:p0");
	});
});

// ── 18. AccordionStore.dispose() — outgoing-store cleanup ─────────────────────
//
// Regression: when `session.store` is reassigned to a fresh AccordionStore (session swap,
// file reload, live hello / full-sync reset), the OUTGOING store must `dispose()` so its
// conductor's `detach()` runs and aborts any in-flight `host.complete()`. Without it, a
// naive-compaction summary call caught mid-flight runs to completion against an orphaned
// store — uncancelled, billable, and a lifecycle leak.

describe("MyCustomizeConductor — deterministic chunked-compaction rollover", () => {
	function chunkedBlock(id: string, order: number, tokens = 2_000, extra: Partial<ViewBlock> = {}): ViewBlock {
		return {
			id,
			kind: "text",
			turn: order + 1,
			order,
			tokens,
			foldedTokens: 50,
			held: false,
			folded: false,
			protected: false,
			grouped: false,
			text: `chunk ${id}`,
			...extra,
		};
	}

	function rolloverView(blocks: ViewBlock[], contextWindow: number | null = 200_000): ConductorView {
		const protectedFromIndex = blocks.findIndex((block) => block.protected);
		return {
			blocks,
			budget: 100_000,
			contextWindow,
			liveTokens: blocks.reduce((sum, block) => sum + block.tokens, 0),
			protectedFromIndex: protectedFromIndex < 0 ? blocks.length : protectedFromIndex,
			protectTokens: 20_000,
			frozenFromIndex: 0,
			harnessOverhead: 5_000,
		};
	}

	function rolloverBlocks(): ViewBlock[] {
		return [
			...Array.from({ length: 8 }, (_, i) => chunkedBlock(`c${i}`, i)),
			chunkedBlock("tail", 8, 100, { kind: "user", protected: true }),
		];
	}

	it("attach and setStatus fire on every conduct pass", () => {
		const host = new MockHost();
		const setStatus = vi.spyOn(host, "setStatus");
		const conductor = new MyCustomizeConductor();
		const blocks = rolloverBlocks();
		const nonRolloverBlocks = [...blocks.slice(0, 7), blocks[8]];
		conductor.attach(host);

		conductor.conduct(rolloverView(nonRolloverBlocks));
		conductor.conduct(rolloverView(blocks));

		expect(setStatus).toHaveBeenCalledTimes(2);
		const nonRolloverMetrics = setStatus.mock.calls[0]?.[1];
		const rolloverCall = setStatus.mock.calls[1];
		const rolloverMetrics = rolloverCall?.[1];
		expect(Object.keys(nonRolloverMetrics ?? {}).sort()).toEqual([
			"breakFrozenCount",
			"lastEstimatedGroupSaving",
			"newPreGroupTokens",
			"preGroupFillPct",
			"preGroupPhase",
			"preGroupTargetTokens",
			"preGroupTokens",
			"rolloverBlockedReason",
			"rolloverCount",
			"tokensSavedByRollover",
		]);
		expect(typeof nonRolloverMetrics?.preGroupTokens).toBe("number");
		expect(typeof nonRolloverMetrics?.preGroupFillPct).toBe("number");
		expect(typeof nonRolloverMetrics?.newPreGroupTokens).toBe("number");
		expect(typeof nonRolloverMetrics?.rolloverBlockedReason).toBe("string");
		expect(rolloverMetrics?.preGroupTokens).toBeTypeOf("number");
		expect(rolloverMetrics?.newPreGroupTokens).toBeTypeOf("number");
		expect(rolloverMetrics?.rolloverBlockedReason).toBe("none");
		expect(rolloverMetrics?.rolloverCount).toBe(1);
		expect(rolloverMetrics?.breakFrozenCount).toBe(1);
		expect(rolloverCall?.[2]).toBeNull();
	});

	it("reports why a full pre-group is waiting at an open tool-pair boundary", () => {
		const host = new MockHost();
		const conductor = new MyCustomizeConductor();
		conductor.attach(host);
		const call = { ...vb("call", { tokens: 500, kind: "tool_call" }), callId: "c1" };
		const result = { ...vb("result", { tokens: 100, kind: "tool_result" }), callId: "c1" };
		conductor.conduct(makeView([
			vb("old:0", { tokens: 10_000 }),
			vb("old:1", { tokens: 10_000 }),
			call,
		], [result], 100_000, 110_000));

		expect(host.statusMetrics.newPreGroupTokens).toBeGreaterThanOrEqual(15_000);
		expect(host.statusMetrics.rolloverBlockedReason).toBe("open-tool-pair");
	});

	it("bounds a large dynamic pre-group target", () => {
		const host = new MockHost();
		const conductor = new MyCustomizeConductor();
		conductor.attach(host);
		const view = rolloverView([
			...Array.from({ length: 10 }, (_, i) => chunkedBlock(`bounded:${i}`, i, 2_000)),
			chunkedBlock("bounded:tail", 10, 100, { kind: "user", protected: true }),
		]);
		// The normal cap is 100k; a 250k live estimate would previously create a 150k target.
		view.liveTokens = 250_000;

		conductor.conduct(view);

		expect(host.statusMetrics.preGroupTargetTokens).toBe(30_000);
		expect(host.statusMetrics.preGroupPhase).toBe("accumulating");
		expect(host.statusMetrics.rolloverBlockedReason).toBe("below-target");
	});

	it("rollover-pass setStatus text uses the rollover template", () => {
		const host = new MockHost();
		const setStatus = vi.spyOn(host, "setStatus");
		const conductor = new MyCustomizeConductor();
		conductor.attach(host);
		const blocks = rolloverBlocks();
		conductor.conduct(rolloverView([...blocks.slice(0, 7), blocks[8]]));
		conductor.conduct(rolloverView(blocks));

		expect(setStatus.mock.calls[0]?.[0]).toMatch(/^chunked · \d+% pregroup · \d+ rollovers · [\d.]+[kmb]? saved/);
		expect(setStatus.mock.calls[1]?.[0]).toMatch(/^chunked · rollover · \d+ rollover\(s\) · [\d.]+[kmb]? saved · pregroup \d+ → 0$/);
	});

	it("setStatus fires on small-context sessions with zero counters", () => {
		const host = new MockHost();
		const setStatus = vi.spyOn(host, "setStatus");
		const conductor = new MyCustomizeConductor();
		conductor.attach(host);
		const view = rolloverView(rolloverBlocks(), 32_000);

		conductor.conduct(view);
		conductor.conduct(view);

		expect(setStatus).toHaveBeenCalledTimes(1);
		for (const [text, metrics] of setStatus.mock.calls) {
			expect(text).toMatch(/^chunked · 0% pregroup · 0 rollovers · 0 saved/);
			expect(metrics?.preGroupTokens).toBe(0);
			expect(metrics?.rolloverCount).toBe(0);
			expect(metrics?.tokensSavedByRollover).toBe(0);
			expect(metrics?.breakFrozenCount).toBe(0);
		}
	});

	it("attach replaces the current host", () => {
		const host1 = new MockHost();
		const host2 = new MockHost();
		const status1 = vi.spyOn(host1, "setStatus");
		const status2 = vi.spyOn(host2, "setStatus");
		const conductor = new MyCustomizeConductor();
		conductor.attach(host1);
		conductor.attach(host2);

		conductor.conduct(rolloverView(rolloverBlocks(), 32_000));

		expect(status1).not.toHaveBeenCalled();
		expect(status2).toHaveBeenCalledTimes(1);
	});

	it("humanTokens formats compact token counts deterministically", () => {
		expect(humanTokens(42)).toBe("42");
		expect(humanTokens(1_500)).toBe("1.5k");
		expect(humanTokens(15_338)).toBe("15.3k");
		expect(humanTokens(1_050_000)).toBe("1.05m");
	});

	it("budget reduction applies one atomic rebase through AccordionStore", () => {
		const blocks = [...Array.from({ length: 24 }, (_, i) => blk(i, "text", 4_000)), blk(24, "user", 100)];
		const store = makeStore(blocks);
		store.setProtect(100);
		store.attach(new MyCustomizeConductor());
		store.setBudget(70_000);
		expect(store.groups).toHaveLength(1);
		expect(store.lastReports.some((report) => report.reason !== "noop")).toBe(false);
		expect(store.liveTokens).toBeLessThanOrEqual(55_000);
	});

	it("observed budget reduction triggers atomic rebase", () => {
		const blocks = [...Array.from({ length: 24 }, (_, i) => chunkedBlock(`observed-${i}`, i, 4_000)), chunkedBlock("observed-tail", 24, 100, { kind: "user", protected: true })];
		const conductor = new MyCustomizeConductor();
		conductor.conduct({ ...rolloverView(blocks), budget: 100_000, liveTokens: 50_000 });
		const plan = conductor.conduct({ ...rolloverView(blocks), budget: 70_000, liveTokens: 100_000 });
		expect(plan.commands.filter((command) => command.kind === "group" && command.lifecycle === "rollover")).toHaveLength(1);
	});

	it("later budget reduction can trigger a new rebase", () => {
		const conductor = new MyCustomizeConductor();
		const firstBlocks = [...Array.from({ length: 24 }, (_, i) => chunkedBlock(`later-a-${i}`, i, 4_000)), chunkedBlock("later-tail", 24, 100, { kind: "user", protected: true })];
		const secondBlocks = [...Array.from({ length: 24 }, (_, i) => chunkedBlock(`later-b-${i}`, i, 4_000)), chunkedBlock("later-tail-b", 24, 100, { kind: "user", protected: true })];
		const first = conductor.conduct({ ...rolloverView(firstBlocks), budget: 70_000, liveTokens: 100_000 });
		const second = conductor.conduct({ ...rolloverView(secondBlocks), budget: 60_000, liveTokens: 100_000 });
		expect(first.commands.filter((command) => command.kind === "group" && command.lifecycle === "rollover")).toHaveLength(1);
		expect(second.commands.filter((command) => command.kind === "group" && command.lifecycle === "rollover")).toHaveLength(1);
	});

	it("atomic rebase keeps complete turns in canonical order", () => {
		const blocks = [...Array.from({ length: 8 }, (_, i) => chunkedBlock(`turn-${i}`, i, 4_000)), chunkedBlock("turn-tail", 8, 100, { kind: "user", protected: true })];
		const plan = new MyCustomizeConductor().conduct({ ...rolloverView(blocks), budget: 70_000, liveTokens: 100_000 });
		const group = plan.commands.find((command): command is Extract<Command, { kind: "group" }> => command.kind === "group" && command.lifecycle === "rollover");
		expect(group?.ids).toEqual(blocks.slice(0, 8).map((block) => block.id));
	});

	for (const [name, barrier] of [
		["held blocks", { held: true }],
		["existing groups", { grouped: true }],
	] as const) {
		it(`atomic rebase stops at ${name}`, () => {
			const blocks = [...Array.from({ length: 6 }, (_, i) => chunkedBlock(`${name}-${i}`, i, 4_000)), chunkedBlock(`${name}-barrier`, 6, 4_000, barrier), ...Array.from({ length: 4 }, (_, i) => chunkedBlock(`${name}-after-${i}`, i + 7, 4_000)), chunkedBlock(`${name}-tail`, 11, 100, { kind: "user", protected: true })];
			const plan = new MyCustomizeConductor().conduct({ ...rolloverView(blocks), budget: 70_000, liveTokens: 100_000 });
			const group = plan.commands.find((command): command is Extract<Command, { kind: "group" }> => command.kind === "group" && command.lifecycle === "rollover");
			expect(group?.ids).toEqual(blocks.slice(0, 6).map((block) => block.id));
		});
	}

	it("atomic rebase leaves the protected tail raw", () => {
		const blocks = [...Array.from({ length: 8 }, (_, i) => chunkedBlock(`protected-${i}`, i, 4_000)), chunkedBlock("protected-tail", 8, 100, { kind: "user", protected: true })];
		const plan = new MyCustomizeConductor().conduct({ ...rolloverView(blocks), budget: 70_000, liveTokens: 100_000 });
		const acted = plan.commands.flatMap((command) => command.kind === "group" || command.kind === "fold" ? command.ids : command.kind === "replace" ? [command.id] : []);
		expect(acted).not.toContain("protected-tail");
	});

	it("atomic rebase falls back below the pre-group target", () => {
		const blocks = [...Array.from({ length: 8 }, (_, i) => chunkedBlock(`low-${i}`, i, 4_000)), chunkedBlock("low-tail", 8, 100, { kind: "user", protected: true })];
		const plan = new MyCustomizeConductor().conduct({ ...rolloverView(blocks), budget: 10_000, liveTokens: 20_000 });
		expect(plan.commands.some((command) => command.kind === "group" && command.lifecycle === "rollover")).toBe(false);
	});

	it("atomic rebase falls back when no safe group exists", () => {
		const blocks = [chunkedBlock("unsafe", 0, 20_000, { held: true }), chunkedBlock("unsafe-tail", 1, 100, { kind: "user", protected: true })];
		const plan = new MyCustomizeConductor().conduct({ ...rolloverView(blocks), budget: 10_000, liveTokens: 20_100 });
		expect(plan.commands.some((command) => command.kind === "group" && command.lifecycle === "rollover")).toBe(false);
	});

	it("normal batching resumes after atomic rebase", () => {
		const blocks = [...Array.from({ length: 25 }, (_, i) => chunkedBlock(`resume-${i}`, i, 4_000)), chunkedBlock("resume-tail", 25, 100, { kind: "user", protected: true })];
		const conductor = new MyCustomizeConductor();
		const first = conductor.conduct({ ...rolloverView(blocks), budget: 70_000, liveTokens: 100_000 });
		conductor.markDirty();
		const second = conductor.conduct({ ...rolloverView(blocks.map((block) => ({ ...block, grouped: block.id !== "resume-tail" }))), budget: 70_000, liveTokens: 55_000 });
		expect(first.commands.filter((command) => command.kind === "group" && command.lifecycle === "rollover")).toHaveLength(1);
		expect(second.commands.filter((command) => command.kind === "group" && command.lifecycle === "rollover")).toHaveLength(0);
	});

	it("walking skeleton emits one chunked-compaction group", () => {
		const plan = new MyCustomizeConductor().conduct(rolloverView(rolloverBlocks()));
		expect(plan.commands).toHaveLength(1);
		expect(plan.commands[0].kind).toBe("group");
		if (plan.commands[0].kind !== "group") return;
		expect(plan.commands[0].ids).toHaveLength(8);
		expect(plan.commands[0].digest).toMatch(/^group /);
	});

	it("chunked-compaction digest is byte-identical on replay", () => {
		const view = rolloverView(rolloverBlocks());
		const first = new MyCustomizeConductor().conduct(view);
		const second = new MyCustomizeConductor().conduct(view);
		expect(first.commands[0].kind).toBe("group");
		expect(second.commands[0].kind).toBe("group");
		if (first.commands[0].kind !== "group" || second.commands[0].kind !== "group") return;
		expect(first.commands[0].digest).toBe(second.commands[0].digest);
	});

	it("no repeat chunked-compaction emission on next conduct pass", () => {
		const blocks = rolloverBlocks();
		const first = new MyCustomizeConductor().conduct(rolloverView(blocks));
		const grouped = blocks.map((block) => first.commands[0].kind === "group" && first.commands[0].ids.includes(block.id) ? { ...block, grouped: true } : block);
		const second = new MyCustomizeConductor().conduct(rolloverView(grouped));
		expect(second.commands.filter((command) => command.kind === "group" && command.lifecycle === "rollover")).toHaveLength(0);
	});

	it("tail-appended recall blocks are not immediately re-grouped", () => {
		const blocks = rolloverBlocks();
		const conductor = new MyCustomizeConductor();
		const first = conductor.conduct(rolloverView(blocks));
		expect(first.commands[0].kind).toBe("group");
		const group = first.commands[0];
		if (group.kind !== "group") return;
		const tailAppendedIds = ["recall:a:chunked-member:p0:0:call", "recall:a:chunked-member:p0:0:result"];
		const afterRecall = [
			...blocks.map((block) => group.ids.includes(block.id) ? { ...block, grouped: true } : block),
			chunkedBlock(tailAppendedIds[0], 9, 20, { kind: "tool_call", toolName: "recall" }),
			chunkedBlock(tailAppendedIds[1], 10, 2_000, { kind: "tool_result", toolName: "recall" }),
		];
		const nextPlan = conductor.conduct(rolloverView(afterRecall));
		const overlappingGroups = nextPlan.commands.filter(
			(command) => command.kind === "group" && command.lifecycle === "rollover" && command.ids.some((id) => tailAppendedIds.includes(id)),
		);
		expect(overlappingGroups).toHaveLength(0);
	});

	it("chunked-compaction is inert below the context-window gate", () => {
		for (const contextWindow of [32_000, 64_000, null]) {
			const plan = new MyCustomizeConductor().conduct(rolloverView(rolloverBlocks(), contextWindow));
			expect(plan.commands.some((command) => command.kind === "group" && command.lifecycle === "rollover")).toBe(false);
		}
	});

	it("chunked-compaction does not add a third trigger for open tool pairs", () => {
		const preGroup = Array.from({ length: 8 }, (_, i) => chunkedBlock(`p${i}`, i));
		preGroup.push(chunkedBlock("call", 8, 2_000, { kind: "tool_call", callId: "pair", toolName: "bash" }));
		const tail = chunkedBlock("result", 9, 100, { kind: "tool_result", callId: "pair", toolName: "bash", protected: true });
		const plan = new MyCustomizeConductor().conduct(rolloverView([...preGroup, tail]));

		expect(plan.commands.filter((command) => command.kind === "group" && command.lifecycle === "rollover")).toHaveLength(0);
	});

	it("trimOpenToolPairs removes the in-group half of straddling pairs", () => {
		const preGroup = Array.from({ length: 8 }, (_, i) => chunkedBlock(`p${i}`, i));
		const call = chunkedBlock("call", 8, 2_000, { kind: "tool_call", callId: "pair", toolName: "bash" });
		const tail = chunkedBlock("result", 9, 100, { kind: "tool_result", callId: "pair", toolName: "bash", protected: true });
		const ids = [...preGroup, call].map((block) => block.id);

		expect(chunkedCompaction.trimOpenToolPairs(ids, [...preGroup, call, tail])).toEqual(preGroup.map((block) => block.id));
	});

	it("pre-existing frozen-grouping pressure valve is unaffected", () => {
		const frozen = [
			chunkedBlock("f0", 0, 5_000, { foldedTokens: 5_000 }),
			chunkedBlock("f1", 1, 5_000, { foldedTokens: 5_000 }),
		];
		const protectedTail = Array.from({ length: 19 }, (_, i) => chunkedBlock(`tail${i}`, i + 2, 10_000, { protected: true }));
		const view = rolloverView([...frozen, ...protectedTail]);
		view.liveTokens = 250_000;
		view.frozenFromIndex = 2;
		view.budget = 100_000;
		const plan = new MyCustomizeConductor({ preGroupTokens: 200_000 }).conduct(view);
		const groups = plan.commands.filter((command): command is Extract<typeof command, { kind: "group" }> => command.kind === "group");
		expect(groups.length).toBeGreaterThan(0);
		expect(groups.some((group) => group.lifecycle === "transient")).toBe(true);
	});

	it("chunked-compaction group.ids has balanced tool pairs (property)", () => {
		let seed = 0x01_02_03_04;
		const random = (): number => {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
			return seed / 0x1_0000_0000;
		};
		let emitted = 0;
		for (let sample = 0; sample < 100; sample++) {
			const blocks = Array.from({ length: 12 }, (_, i) => chunkedBlock(`r${sample}-${i}`, i, 1_500 + Math.floor(random() * 1_000)));
			if (random() < 0.5) {
				blocks[2] = { ...blocks[2], kind: "tool_call", callId: `inside-${sample}`, toolName: "bash" };
				blocks[3] = { ...blocks[3], kind: "tool_result", callId: `inside-${sample}`, toolName: "bash" };
			}
			if (random() < 0.5) {
				blocks[11] = { ...blocks[11], kind: "tool_call", callId: `cross-${sample}`, toolName: "bash" };
			}
			blocks.push(chunkedBlock(`r${sample}-tail`, 12, 100, {
				kind: blocks[11].kind === "tool_call" ? "tool_result" : "user",
				callId: blocks[11].kind === "tool_call" ? blocks[11].callId : undefined,
				toolName: blocks[11].kind === "tool_call" ? "bash" : undefined,
				protected: true,
			}));
			const plan = new MyCustomizeConductor({ preGroupTokens: 10_000 }).conduct(rolloverView(blocks));
			for (const command of plan.commands) {
				if (command.kind !== "group" || command.lifecycle !== "rollover") continue;
				emitted += 1;
				const ids = new Set(command.ids);
				for (const callId of new Set(blocks.flatMap((block) => block.callId ? [block.callId] : []))) {
					const halves = blocks.filter((block) => block.callId === callId);
					const selected = halves.filter((block) => ids.has(block.id));
					expect(selected.length === 0 || selected.length === halves.length, `sample ${sample}, callId ${callId}`).toBe(true);
				}
			}
		}
		expect(emitted).toBeGreaterThan(0);
	});

	it("walking skeleton group is applied by the engine across the frozen boundary", () => {
		const blocks = Array.from({ length: 10 }, (_, i) => blk(i, "text", 2_000));
		blocks.push(blk(10, "user", 100, { text: "tail" }));
		const store = makeStore(blocks);
		store.setProtect(100);
		store.frozenFromIndex = 8;
		const viewBlocks = blocks.map((block, order) => chunkedBlock(block.id, order, block.tokens, { kind: block.kind, text: block.text, protected: order === 10 }));
		const plan = new MyCustomizeConductor().conduct(rolloverView(viewBlocks));
		expect(plan.commands).toHaveLength(1);
		const reports = store.applyCommands(plan.commands, "conductor");
		expect(reports.some((report) => report.reason === "frozen")).toBe(false);
		expect(store.groups).toHaveLength(1);
		if (plan.commands[0].kind === "group") expect(store.groups[0].memberIds).toHaveLength(plan.commands[0].ids.length);
	});

	it("transient semantic groups cannot rewrite the frozen prefix", () => {
		const blocks = Array.from({ length: 10 }, (_, i) => blk(i, "text", 2_000));
		blocks.push(blk(10, "user", 100, { text: "tail" }));
		const store = makeStore(blocks);
		store.setProtect(100);
		store.frozenFromIndex = 8;

		const reports = store.applyCommands([{
			kind: "group",
			ids: blocks.slice(0, 8).map((block) => block.id),
			digest: "group · semantic pressure summary",
			lifecycle: "transient",
		}], "conductor");

		expect(reports).toContainEqual(expect.objectContaining({ reason: "frozen" }));
		expect(store.groups).toHaveLength(0);
	});

	it("corpus content hash produces a stable fingerprint", () => {
		expect(corpusContentHash([])).toBe("fnv:811c9dc5");
	});

	it("pre-group blocks are excluded from fold candidates under budget pressure", () => {
		const blocks = [
			chunkedBlock("pg0", 0, 2_000),
			chunkedBlock("pg1", 1, 2_000),
			chunkedBlock("pg2", 2, 2_000),
			chunkedBlock("pg3", 3, 2_000),
			chunkedBlock("pg4", 4, 2_000),
			chunkedBlock("tail", 5, 100, { kind: "user", protected: true }),
		];
		const view = rolloverView(blocks, 200_000);
		view.liveTokens = 110_000;
		const plan = new MyCustomizeConductor().conduct(view);
		const preGroupIds = new Set(["pg0", "pg1", "pg2", "pg3", "pg4"]);
		for (const cmd of plan.commands) {
			if (cmd.kind === "fold") {
				for (const id of cmd.ids) expect(preGroupIds.has(id), `fold must not target pre-group block ${id}`).toBe(false);
			} else if (cmd.kind === "replace") {
				expect(preGroupIds.has(cmd.id), `replace must not target pre-group block ${cmd.id}`).toBe(false);
			}
		}
	});

	it("pre-group zone crosses user blocks without exposing tool results to folding", () => {
		const blocks = [
			chunkedBlock("tool0", 0, 4_000, { kind: "tool_result" }),
			chunkedBlock("user1", 1, 4_000, { kind: "user" }),
			chunkedBlock("tool2", 2, 4_000, { kind: "tool_result" }),
			chunkedBlock("tail", 3, 100, { kind: "user", protected: true }),
		];
		const view = rolloverView(blocks);
		view.liveTokens = 110_000;
		const plan = new MyCustomizeConductor().conduct(view);
		const actedOnIds = plan.commands.flatMap((cmd) =>
			cmd.kind === "fold" ? cmd.ids : cmd.kind === "replace" ? [cmd.id] : [],
		);

		expect(actedOnIds).not.toContain("tool0");
		expect(actedOnIds).not.toContain("user1");
		expect(actedOnIds).not.toContain("tool2");
	});

	it("pre-group zone crosses MCP result blocks without exposing tool results to folding", () => {
		const blocks = [
			chunkedBlock("tool0", 0, 4_000, { kind: "tool_result" }),
			chunkedBlock("mcp1", 1, 4_000, { kind: "tool_result", toolName: "mcp" }),
			chunkedBlock("tool2", 2, 4_000, { kind: "tool_result" }),
			chunkedBlock("tail", 3, 100, { kind: "user", protected: true }),
		];
		const view = rolloverView(blocks);
		view.liveTokens = 110_000;
		const plan = new MyCustomizeConductor().conduct(view);
		const actedOnIds = plan.commands.flatMap((cmd) =>
			cmd.kind === "fold" ? cmd.ids : cmd.kind === "replace" ? [cmd.id] : [],
		);

		expect(actedOnIds).not.toContain("tool0");
		expect(actedOnIds).not.toContain("mcp1");
		expect(actedOnIds).not.toContain("tool2");
	});

	it("pre-group zone crosses recall result blocks without exposing earlier blocks to folding", () => {
		const blocks = [
			chunkedBlock("tool0", 0, 4_000, { kind: "tool_result" }),
			chunkedBlock("recall1", 1, 4_000, { kind: "tool_result", toolName: "recall" }),
			chunkedBlock("tool2", 2, 4_000, { kind: "tool_result" }),
			chunkedBlock("tail", 3, 100, { kind: "user", protected: true }),
		];
		const view = rolloverView(blocks);
		view.liveTokens = 110_000;

		const plan = new MyCustomizeConductor().conduct(view);
		const actedOnIds = plan.commands.flatMap((cmd) =>
			cmd.kind === "fold" ? cmd.ids : cmd.kind === "replace" ? [cmd.id] : [],
		);

		expect(actedOnIds).not.toContain("tool0");
		expect(actedOnIds).not.toContain("recall1");
		expect(actedOnIds).not.toContain("tool2");
	});

	it("pre-group zone crosses pstack blocks without exposing earlier blocks to folding", () => {
		const blocks = [
			chunkedBlock("tool0", 0, 4_000, { kind: "tool_result" }),
			chunkedBlock("pstack1", 1, 4_000, {
				text: '{#abc123 FOLDED} tool_result:mcp skill-pstack(name="architect")',
			}),
			chunkedBlock("tool2", 2, 4_000, { kind: "tool_result" }),
			chunkedBlock("tail", 3, 100, { kind: "user", protected: true }),
		];
		const view = rolloverView(blocks);
		view.liveTokens = 110_000;

		const plan = new MyCustomizeConductor().conduct(view);
		const actedOnIds = plan.commands.flatMap((cmd) =>
			cmd.kind === "fold" ? cmd.ids : cmd.kind === "replace" ? [cmd.id] : [],
		);

		expect(actedOnIds).not.toContain("tool0");
		expect(actedOnIds).not.toContain("pstack1");
		expect(actedOnIds).not.toContain("tool2");
	});

	it("pre-group zone still stops at held blocks", () => {
		const blocks = [
			chunkedBlock("tool0", 0, 5_000, { kind: "tool_result" }),
			chunkedBlock("held1", 1, 100, { held: true }),
			chunkedBlock("tool2", 2, 5_000, { kind: "tool_result" }),
			chunkedBlock("tail", 3, 100, { kind: "user", protected: true }),
		];
		const view = rolloverView(blocks);
		view.liveTokens = 110_000;
		const plan = new MyCustomizeConductor().conduct(view);
		const actedOnIds = plan.commands.flatMap((cmd) =>
			cmd.kind === "fold" ? cmd.ids : cmd.kind === "replace" ? [cmd.id] : [],
		);

		expect(actedOnIds).toContain("tool0");
		expect(actedOnIds).not.toContain("held1");
		expect(actedOnIds).not.toContain("tool2");
	});

	it("conductor emits a group and no folds when only pre-group blocks would be candidates and over budget", () => {
		const blocks = [
			chunkedBlock("pg0", 0, 2_000),
			chunkedBlock("pg1", 1, 2_000),
			chunkedBlock("pg2", 2, 2_000),
			chunkedBlock("tail", 3, 100, { kind: "user", protected: true }),
		];
		const view = rolloverView(blocks, 200_000);
		view.liveTokens = 110_000;
		const plan = new MyCustomizeConductor().conduct(view);
		const foldOrReplace = plan.commands.filter((cmd) => cmd.kind === "fold" || cmd.kind === "replace");
		expect(foldOrReplace).toHaveLength(0);
		expect(plan.commands[0].kind).toBe("group");
	});

	it("keeps a suffix group when a later pre-group pass is under budget", () => {
		// The host clears mutable conductor groups before each pass. A preserved frozen fold can
		// make the cleared baseline fit the budget, even though the previous suffix group is still
		// part of the desired view. The group must not flash open for one turn.
		const blocks = [
			chunkedBlock("old0", 0, 2_000, { foldedTokens: 2_000 }),
			chunkedBlock("old1", 1, 2_000, { foldedTokens: 2_000 }),
			chunkedBlock("pre", 2, 2_000, { foldedTokens: 2_000 }),
			chunkedBlock("tail", 3, 100, { kind: "user", protected: true }),
		];
		const conductor = new MyCustomizeConductor({ preGroupTokens: 1 });
		const first = conductor.conduct({ ...rolloverView(blocks), liveTokens: 110_000 });
		const firstGroups = first.commands.filter((command): command is Extract<typeof command, { kind: "group" }> => command.kind === "group");
		expect(firstGroups).toHaveLength(1);
		expect(firstGroups[0].digest).toContain("group ·");

		const second = conductor.conduct({ ...rolloverView(blocks), liveTokens: 90_000 });
		const secondGroups = second.commands.filter((command) => command.kind === "group");
		expect(secondGroups).toHaveLength(1);
		expect(secondGroups[0]).toEqual(firstGroups[0]);
	});

	it("retains an older suffix group when a new pre-group rollover fires", () => {
		const firstBlocks = [
			chunkedBlock("old0", 0, 4_000, { foldedTokens: 4_000 }),
			chunkedBlock("old1", 1, 4_000, { foldedTokens: 4_000 }),
			chunkedBlock("barrier", 2, 100, { foldedTokens: 100, held: true }),
			chunkedBlock("pre0", 3, 6_000, { foldedTokens: 6_000 }),
			chunkedBlock("tail", 4, 100, { kind: "user", protected: true }),
		];
		const conductor = new MyCustomizeConductor({ preGroupTokens: 12_000 });
		const first = conductor.conduct({ ...rolloverView(firstBlocks), liveTokens: 110_000 });
		expect(first.commands.some((command) => command.kind === "group" && command.ids.includes("old0"))).toBe(true);

		const secondBlocks = [...firstBlocks.slice(0, 4), chunkedBlock("pre1", 4, 6_000, { foldedTokens: 6_000, turn: 6 }), firstBlocks[4]];
		const second = conductor.conduct({ ...rolloverView(secondBlocks), liveTokens: 110_000 });
		const groups = second.commands.filter((command): command is Extract<typeof command, { kind: "group" }> => command.kind === "group");
		expect(groups.some((group) => group.ids.includes("old0"))).toBe(true);
		expect(groups.some((group) => group.lifecycle === "rollover" && group.ids.includes("pre0"))).toBe(true);
	});

	it("retains an older suffix group when the later early-rollover path fires", () => {
		const firstBlocks = [
			chunkedBlock("old0", 0, 4_000, { foldedTokens: 4_000 }),
			chunkedBlock("old1", 1, 4_000, { foldedTokens: 4_000 }),
			chunkedBlock("barrier", 2, 100, { foldedTokens: 100, held: true }),
			chunkedBlock("pre0", 3, 6_000),
			chunkedBlock("tail", 4, 100, { kind: "user", protected: true }),
		];
		const conductor = new MyCustomizeConductor({ preGroupTokens: 20_000 });
		const first = conductor.conduct({ ...rolloverView(firstBlocks), liveTokens: 110_000 });
		expect(first.commands.some((command) => command.kind === "group" && command.ids.includes("old0"))).toBe(true);

		const secondBlocks = [...firstBlocks.slice(0, 4), chunkedBlock("pre1", 4, 6_000, { turn: 6 }), firstBlocks[4]];
		const second = conductor.conduct({ ...rolloverView(secondBlocks), liveTokens: 110_000 });
		const groups = second.commands.filter((command): command is Extract<typeof command, { kind: "group" }> => command.kind === "group");
		expect(groups.some((group) => group.ids.includes("old0"))).toBe(true);
		expect(groups.some((group) => group.lifecycle === "rollover" && group.ids.includes("pre0"))).toBe(true);
	});

	it("early rollover emits a chunked-compaction group when liveTokens exceeds cap and pre-group has enough saving", () => {
		// Pre-group zone: 2 blocks × 6_000 tokens = 12_000 < preGroupTarget (15_000) so the fast path does not fire.
		// No non-pre-group candidates exist, so the main fold loop leaves live unchanged.
		// DEC-002 early rollover then fires because live (110_000) > cap (100_000).
		const blocks = [
			chunkedBlock("pg0", 0, 6_000),
			chunkedBlock("pg1", 1, 6_000),
			chunkedBlock("tail", 2, 100, { kind: "user", protected: true }),
		];
		const view = rolloverView(blocks, 200_000);
		view.liveTokens = 110_000;
		const plan = new MyCustomizeConductor().conduct(view);
		expect(plan.commands[0].kind).toBe("group");
		if (plan.commands[0].kind !== "group") return;
		expect(plan.commands[0].digest).toMatch(/^group ·/);
	});

	it("early rollover groups a pre-group zone in the frozen prefix", () => {
		const blocks = [
			chunkedBlock("pg0", 0, 6_000),
			chunkedBlock("pg1", 1, 6_000),
			chunkedBlock("tail", 2, 100, { kind: "user", protected: true }),
		];
		const view = rolloverView(blocks, 200_000);
		view.liveTokens = 110_000;
		view.frozenFromIndex = 2;

		const plan = new MyCustomizeConductor().conduct(view);

		expect(plan.commands).toHaveLength(1);
		expect(plan.commands[0]).toMatchObject({ kind: "group", ids: ["pg0", "pg1"] });
	});

	it("early rollover is skipped when liveTokens does not exceed cap", () => {
		const blocks = [
			chunkedBlock("pg0", 0, 6_000),
			chunkedBlock("pg1", 1, 6_000),
			chunkedBlock("tail", 2, 100, { kind: "user", protected: true }),
		];
		const view = rolloverView(blocks, 200_000);
		view.liveTokens = 90_000; // below cap (100_000) — no early rollover
		const plan = new MyCustomizeConductor().conduct(view);
		const groupCmds = plan.commands.filter((cmd) => cmd.kind === "group");
		expect(groupCmds).toHaveLength(0);
	});

	it("early rollover is skipped when pre-group saving is below the minimum threshold", () => {
		// 2 blocks × 100 tokens = 200 total. Saving ≈ 170 < max(2_000, 0.05 × 100_000) = 5_000.
		const blocks = [
			chunkedBlock("pg0", 0, 100),
			chunkedBlock("pg1", 1, 100),
			chunkedBlock("tail", 2, 100, { kind: "user", protected: true }),
		];
		const view = rolloverView(blocks, 200_000);
		view.liveTokens = 110_000;
		const plan = new MyCustomizeConductor().conduct(view);
		const groupCmds = plan.commands.filter((cmd) => cmd.kind === "group");
		expect(groupCmds).toHaveLength(0);
	});

	it("early rollover group includes non-foldable block kinds such as user", () => {
		// user is not in FOLDABLE_KINDS so it would never be a fold candidate.
		// Grouping via DEC-002 must still include it.
		const blocks = [
			chunkedBlock("tr0", 0, 4_000, { kind: "tool_result" }),
			chunkedBlock("u1", 1, 4_000, { kind: "user" }),
			chunkedBlock("t2", 2, 4_000),
			chunkedBlock("tail", 3, 100, { kind: "user", protected: true }),
		];
		const view = rolloverView(blocks, 200_000);
		view.liveTokens = 110_000;
		const plan = new MyCustomizeConductor().conduct(view);
		expect(plan.commands[0].kind).toBe("group");
		if (plan.commands[0].kind !== "group") return;
		expect(plan.commands[0].ids).toContain("u1");
	});

	it("early rollover trims a tool_call that has an open partner in the protected tail", () => {
		// tc0 (callId X) has its matching tool_result in the protected tail.
		// trimOpenToolPairs must remove tc0 so the group stays pair-balanced.
		const blocks = [
			chunkedBlock("tc0", 0, 4_000, { kind: "tool_call", callId: "X" }),
			chunkedBlock("tr1", 1, 4_000, { kind: "tool_result", callId: "Y" }),
			chunkedBlock("t2", 2, 4_000),
			chunkedBlock("protected_tr", 3, 100, { kind: "tool_result", callId: "X", protected: true }),
		];
		const view = rolloverView(blocks, 200_000);
		view.liveTokens = 110_000;
		const plan = new MyCustomizeConductor().conduct(view);
		expect(plan.commands[0].kind).toBe("group");
		if (plan.commands[0].kind !== "group") return;
		expect(plan.commands[0].ids).not.toContain("tc0");
	});

	it("pre-group zone crosses user blocks and keeps earlier blocks out of fold candidates", () => {
		const blocks = [
			chunkedBlock("old0", 0, 3_000, { kind: "tool_result" }),
			chunkedBlock("boundary", 1, 100, { kind: "user" }),
			chunkedBlock("pg0", 2, 2_000),
			chunkedBlock("pg1", 3, 2_000),
			chunkedBlock("tail", 4, 100, { kind: "user", protected: true }),
		];
		const view = rolloverView(blocks, 200_000);
		view.liveTokens = 110_000;
		const plan = new MyCustomizeConductor().conduct(view);
		const foldedIds = plan.commands.flatMap((cmd) => cmd.kind === "fold" ? cmd.ids : cmd.kind === "replace" ? [cmd.id] : []);
		expect(foldedIds).not.toContain("old0");
		expect(foldedIds).not.toContain("pg0");
		expect(foldedIds).not.toContain("pg1");
	});

	it("pre-group exemption is a no-op when context window is below the chunked compaction gate", () => {
		const blocks = [
			chunkedBlock("c0", 0, 2_000),
			chunkedBlock("c1", 1, 2_000),
			chunkedBlock("c2", 2, 2_000),
			chunkedBlock("tail", 3, 100, { kind: "user", protected: true }),
		];
		const targetIds = new Set(["c0", "c1", "c2"]);
		for (const contextWindow of [32_000, 64_000, null] as const) {
			const view = rolloverView(blocks, contextWindow);
			view.liveTokens = 110_000;
			const plan = new MyCustomizeConductor().conduct(view);
			const actedOnIds = plan.commands.flatMap((cmd) =>
				cmd.kind === "fold" ? cmd.ids : cmd.kind === "replace" ? [cmd.id] : cmd.kind === "group" ? cmd.ids : [],
			);
			const hit = actedOnIds.some((id) => targetIds.has(id));
			expect(hit, `contextWindow=${contextWindow} should still act on pre-group-position blocks`).toBe(true);
		}
	});
	it("restores folded pre-group blocks that are in the frozen prefix", () => {
		// A block that was folded when in the frozen prefix enters the pre-group range.
		// The conductor must emit a restore for it (clearConductorState preserves frozen folds).
		const blocks = [
			chunkedBlock("pg0", 0, 2_000, { folded: true }),
			chunkedBlock("pg1", 1, 2_000, { folded: true }),
			chunkedBlock("pg2", 2, 2_000),
			chunkedBlock("tail", 3, 100, { kind: "user", protected: true }),
		];
		const view = rolloverView(blocks, 200_000);
		// Put frozenFromIndex above the folded blocks so they are in the frozen prefix
		view.frozenFromIndex = 2;
		const plan = new MyCustomizeConductor().conduct(view);
		const restoreCmd = plan.commands.find((cmd) => cmd.kind === "restore");
		expect(restoreCmd).toBeDefined();
		expect(restoreCmd!.ids).toContain("pg0");
		expect(restoreCmd!.ids).toContain("pg1");
		// pg2 is above frozenFromIndex, so clearConductorState handles it — no restore needed
		expect(restoreCmd!.ids).not.toContain("pg2");
	});

	it("keeps complete turns together at the protected boundary", () => {
		// Two blocks in turn 1, one protected block in turn 2.
		// selectCompactionRange must include only turn 1; turn 2 is the current partial turn.
		const blocks = [
			chunkedBlock("a0", 0, 2_000, { turn: 1 }),
			chunkedBlock("a1", 1, 2_000, { turn: 1 }),
			chunkedBlock("tail", 2, 100, { kind: "user", protected: true, turn: 2 }),
		];
		const view = rolloverView(blocks);

		const range = chunkedCompaction.selectCompactionRange(view, 0);

		expect(range).not.toBeNull();
		// Both turn-1 blocks are included; the protected turn-2 block is excluded.
		expect(range!.fromIndex).toBe(0);
		expect(range!.toIndexExclusive).toBe(2);
		// No selected block shares a turn with the protected tail.
		const protectedTurn = view.blocks[view.protectedFromIndex].turn;
		for (let i = range!.fromIndex; i < range!.toIndexExclusive; i++) {
			expect(view.blocks[i].turn, `block ${i} must not share turn with protected tail`).not.toBe(protectedTurn);
		}
	});

	it("includes MCP recall pstack and user blocks but stops at hard barriers", () => {
		// User and MCP blocks may belong to an eligible turn; held blocks are hard barriers.
		const blocks = [
			chunkedBlock("user1", 0, 500, { kind: "user", turn: 1 }),
			chunkedBlock("mcp1", 1, 5_000, { kind: "tool_result", toolName: "mcp", turn: 1 }),
			chunkedBlock("held1", 2, 3_000, { held: true, turn: 2 }),
			chunkedBlock("tail", 3, 100, { kind: "user", protected: true, turn: 3 }),
		];
		const view = rolloverView(blocks);

		const range = chunkedCompaction.selectCompactionRange(view, 0);

		expect(range).not.toBeNull();
		// user1 and mcp1 are included (not hard barriers).
		expect(range!.fromIndex).toBe(0);
		expect(range!.toIndexExclusive).toBe(2);
		// held1 and tail are excluded.
		const ids = blocks.slice(range!.fromIndex, range!.toIndexExclusive).map((b) => b.id);
		expect(ids).toContain("user1");
		expect(ids).toContain("mcp1");
		expect(ids).not.toContain("held1");
		expect(ids).not.toContain("tail");
	});

	it("compacts a complete MCP-bearing turn and recalls its grouped member without unfolding", () => {
		const mcpCallText = JSON.stringify({
			tool: "skill-reference",
			server: "engineering-skills",
			args: { name: "poteto-mode" },
		});

		// Complete turn 1: user + MCP tool_call + tool_result (large enough to trigger rollover).
		// Protected turn 2: user.
		const viewBlocks: ViewBlock[] = [
			chunkedBlock("u:t1", 0, 500, { kind: "user", turn: 1, text: "load poteto mode" }),
			chunkedBlock("a:t1:p0", 1, 100, { kind: "tool_call", turn: 1, callId: "c1", toolName: "mcp", text: mcpCallText }),
			chunkedBlock("r:c1", 2, 14_600, { kind: "tool_result", turn: 1, callId: "c1", toolName: "mcp", text: "MCP result: " + "x".repeat(60_000) }),
			chunkedBlock("u:t2", 3, 100, { kind: "user", turn: 2, protected: true }),
		];
		const view = rolloverView(viewBlocks);

		// Run conductor — must emit exactly one GROUP command.
		const plan = new MyCustomizeConductor().conduct(view);
		const groupCmds = plan.commands.filter((cmd) => cmd.kind === "group");
		expect(groupCmds).toHaveLength(1);
		const groupCmd = groupCmds[0];
		if (groupCmd.kind !== "group") return;

		// All parts of the completed turn are members; the protected turn is not.
		expect(groupCmd.ids).toContain("u:t1");
		expect(groupCmd.ids).toContain("a:t1:p0");
		expect(groupCmd.ids).toContain("r:c1");
		expect(groupCmd.ids).not.toContain("u:t2");

		expect(groupCmd.digest).toMatch(/^group ·/);
		expect(groupCmd.digest).toContain("[MCP Index]");
		expect(groupCmd.digest).toContain("engineering-skills/skill-reference");

		// Apply to AccordionStore.
		const storeBlocks: Block[] = [
			{ id: "u:t1", kind: "user", turn: 1, order: 0, tokens: 500, text: "load poteto mode", override: null, autoFolded: false, by: null },
			{ id: "a:t1:p0", kind: "tool_call", turn: 1, order: 1, tokens: 100, text: mcpCallText, callId: "c1", toolName: "mcp", override: null, autoFolded: false, by: null },
			{ id: "r:c1", kind: "tool_result", turn: 1, order: 2, tokens: 16_000, text: "MCP result: " + "x".repeat(60_000), callId: "c1", toolName: "mcp", override: null, autoFolded: false, by: null },
			{ id: "u:t2", kind: "user", turn: 2, order: 3, tokens: 100, text: "continue", override: null, autoFolded: false, by: null },
		];
		const store = makeStore(storeBlocks);
		store.setProtect(100);
		store.setBudget(1_000_000);

		const g = store.createGroup(
			groupCmd.ids[0],
			groupCmd.ids[groupCmd.ids.length - 1],
			"you",
			groupCmd.digest,
			groupCmd.lifecycle,
		);
		expect(g).not.toBeNull();
		expect(g!.folded).toBe(true);
		// All completed-turn members in group; protected turn not.
		for (const id of groupCmd.ids) expect(g!.memberIds).toContain(id);
		expect(g!.memberIds).not.toContain("u:t2");
		// Mark the group as the immutable frozen prefix.
		store.frozenFromIndex = storeBlocks.findIndex((b) => b.id === "u:t2");

		// Read the member code from the emitted MCP retrieval index.
		expect(groupCmd.digest).toBeDefined();
		const indexLine = groupCmd.digest!.split("\n").find((line) => line.startsWith("  engineering-skills/skill-reference · "));
		expect(indexLine).toBeDefined();
		const codeMatch = indexLine!.match(/→ ([a-z0-9]+)/);
		expect(codeMatch).not.toBeNull();
		const memberCode = codeMatch![1];
		expect(memberCode).toBe(chunkedCompaction.foldCode("r:c1"));

		// Recall the MCP result by its member code — read-only, group stays folded.
		const beforeDigest = store.groupById(g!.id)!.digest;
		const beforeFolded = store.groupById(g!.id)!.folded;
		const beforeBlockCount = store.blocks.length;

		const { restored, missing } = resolveRecall(store, [memberCode]);

		expect(missing).toEqual([]);
		expect(restored).toHaveLength(1);
		expect(restored[0].ids).toEqual(["r:c1"]);
		expect(restored[0].text).toContain("MCP result:");
		// Group digest, folded state, and block count are all unchanged after recall.
		expect(store.groupById(g!.id)!.folded).toBe(beforeFolded);
		expect(store.groupById(g!.id)!.digest).toBe(beforeDigest);
		expect(store.blocks.length).toBe(beforeBlockCount);
	});
});

describe("AccordionStore.dispose() — outgoing-store cleanup", () => {
	it("aborts an in-flight naive-compaction completion when the store is disposed", async () => {
		// Aged region over the 90% threshold so the conductor launches a summary completion
		// (mirrors the integration harness above).
		const blocks = [
			blk(0, "text", 2000, { text: "first aged block" }),
			blk(1, "text", 2000, { text: "second aged block" }),
			blk(2, "text", 200, { text: "tail" }),
		];
		const s = makeStore(blocks);
		s.setProtect(200);
		s.setBudget(4_000);

		// A completer that captures the request's AbortSignal and NEVER settles — the call
		// stays in-flight, exactly like a slow model round-trip caught mid-session-swap.
		let captured: AbortSignal | undefined;
		s.completer = (req: CompletionRequest) => {
			captured = req.signal;
			return new Promise<CompletionResult>(() => {}); // never settles
		};

		s.attach(new NaiveCompactionConductor());
		await flushMicrotasks();

		// The completion launched and is still in flight (not yet aborted).
		expect(captured).toBeInstanceOf(AbortSignal);
		expect(captured!.aborted).toBe(false);

		// Retire the store — the exact action the four `session.store = new AccordionStore(...)`
		// sites now perform on the outgoing store before discarding it.
		s.dispose();

		// The in-flight model call was cancelled instead of running on against the orphan.
		expect(captured!.aborted).toBe(true);
		// A disposed store carries no conductor.
		expect(s.conductor).toBeNull();
	});

	it("is a harmless no-op for a store on the default (pure) conductor, and is idempotent", () => {
		const s = makeStore([blk(0, "text", 100), blk(1, "text", 100)]);
		// The default conductor is the pure built-in (no `detach` hook) — dispose must not throw.
		expect(() => s.dispose()).not.toThrow();
		expect(s.conductor).toBeNull();
		// Second dispose detaches a null conductor — still a no-op.
		expect(() => s.dispose()).not.toThrow();
		expect(s.conductor).toBeNull();
	});
});
