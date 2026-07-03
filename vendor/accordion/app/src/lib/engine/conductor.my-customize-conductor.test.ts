import { describe, it, expect } from "vitest";
import { IN_PROCESS_CONDUCTORS, MyCustomizeConductor } from "$conductors";
import type { Command, ConductorView, ViewBlock } from "$conductors/contract";
import { foldTag } from "./digest";
import { estSummaryTokens, mcpSummary, normalizePstackName, pstackLabel } from "$conductors/my-customize-conductor/mcp-summary";

function vb(
	id: string,
	kind: ViewBlock["kind"],
	order: number,
	tokens: number,
	foldedTokens: number,
	opts: { held?: boolean; folded?: boolean; protected?: boolean; grouped?: boolean; callId?: string; toolName?: string; text?: string; isError?: boolean } = {},
): ViewBlock {
	return {
		id,
		kind,
		turn: order + 1,
		order,
		tokens,
		foldedTokens,
		held: opts.held ?? false,
		folded: opts.folded ?? false,
		protected: opts.protected ?? false,
		grouped: opts.grouped ?? false,
		callId: opts.callId,
		toolName: opts.toolName,
		text: opts.text,
		isError: opts.isError,
	};
}

function makeView(blocks: ViewBlock[], budget: number, liveTokens: number, opts: { frozenFromIndex?: number } = {}): ConductorView {
	const protectedFromIndex = blocks.findIndex((b) => b.protected);
	return {
		blocks,
		budget,
		liveTokens,
		contextWindow: null,
		protectedFromIndex: protectedFromIndex < 0 ? blocks.length : protectedFromIndex,
		protectTokens: 0,
		frozenFromIndex: opts.frozenFromIndex ?? 0,
	};
}

function foldIdsOf(result: Command[] | null | undefined): Set<string> {
	const ids = new Set<string>();
	for (const c of result ?? []) if (c.kind === "fold") for (const id of c.ids) ids.add(id);
	return ids;
}

function replaceOf(result: Command[] | null | undefined, id: string): Extract<Command, { kind: "replace" }> | undefined {
	for (const c of result ?? []) if (c.kind === "replace" && c.id === id) return c;
	return undefined;
}

/** Live tokens after applying the conductor's fold + replace commands. */
function projected(view: ConductorView, result: Command[] | null): number {
	const folded = foldIdsOf(result);
	let live = view.liveTokens;
	for (const b of view.blocks) {
		if (folded.has(b.id)) {
			live += b.foldedTokens - b.tokens;
			continue;
		}
		const rep = replaceOf(result, b.id);
		if (rep) live -= b.tokens - estSummaryTokens(rep.content);
	}
	return live;
}

describe("MyCustomizeConductor", () => {
	it("folds risk-sparse blocks before risk-dense blocks of the same age", () => {
		// Block A: generic prose, no facts
		// Block B: contains key=value and decision language → higher risk count → folds later
		const blocks = [
			vb("u:0", "user", 0, 100, 100, { text: "task" }),
			vb("r:sparse", "tool_result", 1, 1000, 40, { toolName: "bash", text: "some generic output with no facts" }),
			vb("r:dense", "tool_result", 2, 1000, 40, { toolName: "bash", text: "model=gpt-4o\ndecided to use pnpm\n$ npm install" }),
		];
		const view = makeView(blocks, 1_500, 2_100);
		const result = new MyCustomizeConductor().conduct(view);

		const folded = foldIdsOf(result);
		// Risk-sparse block folds first; risk-dense block should be untouched if sparse alone suffices.
		expect(folded.has("r:sparse"), "risk-sparse block is folded").toBe(true);
		expect(folded.has("r:dense"), "risk-dense block is spared").toBe(false);
		expect(projected(view, result)).toBeLessThanOrEqual(view.budget);
	});

	it("returns the same plan on a second pass when projected live tokens stay within 0.9 × cap", () => {
		const blocks = [
			vb("u:0", "user", 0, 200, 200, { text: "task" }),
			vb("r:a", "tool_result", 1, 1500, 40, { toolName: "bash", text: "output a" }),
			vb("r:b", "tool_result", 2, 1500, 40, { toolName: "bash", text: "output b" }),
		];
		const view = makeView(blocks, 2_000, 3_200);
		const conductor = new MyCustomizeConductor();

		const first = conductor.conduct(view);
		expect(first.length, "first pass folds something").toBeGreaterThan(0);

		// Second pass: same view (projected still well within 0.9 × cap after applying first plan).
		const second = conductor.conduct(view);
		expect(second, "second pass returns the exact same plan object").toBe(first);
	});

	it("recomputes the plan when live tokens grow past the hold band", () => {
		const blocks = [
			vb("u:0", "user", 0, 200, 200, { text: "task" }),
			vb("r:a", "tool_result", 1, 1500, 40, { toolName: "bash", text: "output a" }),
			vb("r:b", "tool_result", 2, 1500, 40, { toolName: "bash", text: "output b" }),
		];
		const cap = 2_000;
		const viewFirst = makeView(blocks, cap, 3_200);
		const conductor = new MyCustomizeConductor();

		const first = conductor.conduct(viewFirst);
		expect(first.length).toBeGreaterThan(0);

		// Simulate new content arriving that pushes past 0.9 × cap after applying the old plan.
		// Old plan saves ~1460 tokens (1500-40). projectedHeld = 4900 - 1460 = 3440 >> 0.9×2000=1800.
		// Both blocks together save 2920, so projected = 4900 - 2920 = 1980 ≤ cap.
		const viewGrown = makeView(blocks, cap, 4_900);
		const second = conductor.conduct(viewGrown);
		expect(second, "a new plan is computed when the band is crossed").not.toBe(first);
		expect(projected(viewGrown, second)).toBeLessThanOrEqual(cap);
	});

	it("skips blocks in the frozen prefix when choosing fold candidates", () => {
		const blocks = Array.from({ length: 10 }, (_, i) => vb(`m${i}`, "text", i, 1_000, 50, { text: `block ${i}` }));
		const view = makeView(blocks, 5_250, 10_000, { frozenFromIndex: 5 });
		const folded = foldIdsOf(new MyCustomizeConductor().conduct(view));

		for (let i = 0; i < 5; i++) expect(folded.has(`m${i}`)).toBe(false);
		for (let i = 5; i < 10; i++) expect(folded.has(`m${i}`)).toBe(true);
	});

	it("recomputes the plan when a previously folded block is now frozen", () => {
		const blocks = [
			vb("u:0", "user", 0, 200, 200, { text: "task" }),
			vb("r:3", "tool_result", 3, 1_500, 40, { toolName: "bash", text: "older output" }),
			vb("r:5", "tool_result", 5, 1_500, 40, { toolName: "bash", text: "newer output" }),
			vb("r:6", "tool_result", 6, 1_500, 40, { toolName: "bash", text: "newest output" }),
		];
		const conductor = new MyCustomizeConductor();
		const firstView = makeView(blocks, 2_000, 4_700);
		const first = conductor.conduct(firstView);
		expect(foldIdsOf(first).has("r:3")).toBe(true);

		const frozenView = makeView(blocks, 2_000, 4_700, { frozenFromIndex: 5 });
		const second = conductor.conduct(frozenView);
		const secondFolded = foldIdsOf(second);
		expect(second).not.toBe(first);
		expect(secondFolded.has("r:3")).toBe(false);
		expect(secondFolded.has("r:5")).toBe(true);
		expect(secondFolded.has("r:6")).toBe(true);
	});

	it("returns [] when every foldable block is frozen", () => {
		const blocks = [
			vb("u:0", "user", 0, 200, 200, { text: "task" }),
			vb("r:1", "tool_result", 1, 1_500, 40, { toolName: "bash", text: "output 1" }),
			vb("r:2", "tool_result", 2, 1_500, 40, { toolName: "bash", text: "output 2" }),
		];
		const view = makeView(blocks, 500, 3_200, { frozenFromIndex: 3 });
		expect(new MyCustomizeConductor().conduct(view)).toEqual([]);
	});

	it("is registered as a collaborative in-process conductor", () => {
		const entry = IN_PROCESS_CONDUCTORS.find((c) => c.id === "my-customize-conductor");
		expect(entry).toBeDefined();
		expect(entry!.label).toBe("My Customize");
		expect(entry!.locks).toBeUndefined();
		const c = entry!.create();
		expect(c.id).toBe("my-customize-conductor");
	});

	it("folds cheaper non-MCP blocks before touching MCP results", () => {
		const blocks = [
			vb("u:0", "user", 0, 200, 200, { text: "task" }),
			vb("r:mcp", "tool_result", 1, 1500, 40, { toolName: "mcp", text: "# Poteto mode\nimportant instruction" }),
			vb("r:bash", "tool_result", 2, 1500, 40, { toolName: "bash", text: "large noisy output" }),
			vb("a:1:p0", "thinking", 3, 1000, 40, { text: "thoughts" }),
		];
		const view = makeView(blocks, 2_500, 4_200);
		const result = new MyCustomizeConductor().conduct(view);

		expect(foldIdsOf(result).has("r:mcp")).toBe(false);
		expect(replaceOf(result, "r:mcp")).toBeUndefined();
		expect(foldIdsOf(result).has("r:bash")).toBe(true);
		expect(projected(view, result)).toBeLessThanOrEqual(view.budget);
	});

	it("formats pstack MCP results with canonical skill-pstack identity", () => {
		const blocks = [
			vb("u:0", "user", 0, 200, 200, { text: "task" }),
			vb("c1", "tool_call", 1, 50, 50, {
				toolName: "mcp",
				callId: "c1",
				text: 'mcp {"server":"engineering-skills","tool":"skill-pstack","args":"{\\"name\\":\\"principle-prove-it-works\\"}"}',
			}),
			vb("r:mcp", "tool_result", 2, 1500, 40, { toolName: "mcp", callId: "c1", text: "# Prove It Works\nline two\nline three" }),
		];
		const view = makeView(blocks, 320, 1_750);
		const result = new MyCustomizeConductor().conduct(view);

		const rep = replaceOf(result, "r:mcp");
		expect(rep, "MCP result is folded via a replace, not a plain fold").toBeDefined();
		expect(rep!.recoverable, "the summary is unfoldable").toBe(true);
		expect(rep!.content).toContain('tool_result:mcp skill-pstack(name="principle-prove-it-works")');
		expect(rep!.content).toContain("Label: Prove It Works principle");
		expect(rep!.content).toContain("not unfold, before re-calling this exact MCP tool");
		expect(foldIdsOf(result).has("r:mcp")).toBe(false);
		expect(projected(view, result)).toBeLessThanOrEqual(view.budget);
	});

	it("normalizes pstack names with trim and lowercase", () => {
		expect(normalizePstackName(" Poteto-Mode ")).toBe("poteto-mode");
		const summary = mcpSummary(
			vb("r:mcp", "tool_result", 1, 1500, 40, { toolName: "mcp", callId: "c1", text: "result" }),
			vb("c1", "tool_call", 0, 50, 50, {
				toolName: "mcp",
				callId: "c1",
				text: 'mcp {"tool":"skill-pstack","args":{"name":" Poteto-Mode "}}',
			}),
		);
		expect(summary).toContain('skill-pstack(name="poteto-mode")');
	});

	it("derives pstack labels from slug patterns", () => {
		expect(pstackLabel("principle-prove-it-works")).toBe("Prove It Works principle");
		expect(pstackLabel("poteto-mode/playbooks/bug-fix")).toBe("Bug Fix playbook");
		expect(pstackLabel("architect")).toBe("Architect skill");
	});

	it("formats generic MCP fallback with capped redacted primitive args", () => {
		const summary = mcpSummary(
			vb("r:mcp", "tool_result", 1, 1500, 40, { toolName: "mcp", callId: "c1", text: "result" }),
			vb("c1", "tool_call", 0, 50, 50, {
				toolName: "mcp",
				callId: "c1",
				text: `mcp ${JSON.stringify({
					tool: "some_lookup",
					args: {
						project: "x".repeat(60),
						secretToken: "super-secret",
						id: "ADR-0016",
						mode: "summary",
						nested: { skip: true },
						ok: true,
					},
				})}`,
			}),
		);
		expect(summary).toContain('tool_result:mcp some_lookup(project="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx…", secretToken="[redacted]", id="ADR-0016")');
		expect(summary).not.toContain('mode="summary"');
		expect(summary).not.toContain("ok=true");
	});

	it("uses weak exact-result wording for generic MCP", () => {
		const summary = mcpSummary(
			vb("r:mcp", "tool_result", 1, 1500, 40, { toolName: "mcp", callId: "c1", text: "result" }),
			vb("c1", "tool_call", 0, 50, 50, {
				toolName: "mcp",
				callId: "c1",
				text: 'mcp {"tool":"some_lookup","args":{"project":"my-pi"}}',
			}),
		);
		expect(summary).toContain("if you need this exact prior result");
		expect(summary).not.toContain("before re-calling this exact MCP tool");
	});

	it("summarizes an MCP result with no recoverable call identity as plain `mcp`", () => {
		const blocks = [
			vb("u:0", "user", 0, 200, 200, { text: "task" }),
			vb("r:mcp", "tool_result", 1, 1500, 40, { toolName: "mcp", text: "some mcp output\nwith two lines" }),
		];
		const view = makeView(blocks, 300, 1_700);
		const result = new MyCustomizeConductor().conduct(view);

		const rep = replaceOf(result, "r:mcp");
		expect(rep).toBeDefined();
		expect(rep!.content.startsWith("tool_result:mcp mcp\n")).toBe(true);
		expect(projected(view, result)).toBeLessThanOrEqual(view.budget);
	});

	it("enriches single-code recall results from folded pstack provenance", () => {
		const sourceId = "r:pstack";
		const sourceDigest = [
			`${foldTag(sourceId)} tool_result:mcp skill-pstack(name="principle-prove-it-works")`,
			"Label: Prove It Works principle",
			"Full result preserved. Use recall({\"codes\":[\"<code>\"]}), not unfold, before re-calling this exact MCP tool.",
		].join("\n");
		const digestCode = foldTag(sourceId).slice(2, 8);
		const blocks = [
			vb("u:0", "user", 0, 200, 200, { text: "task" }),
			vb(sourceId, "tool_result", 1, 1500, 40, {
				toolName: "mcp",
				text: sourceDigest,
				folded: true,
				held: true,
			}),
			vb("c:recall", "tool_call", 2, 50, 50, { toolName: "recall", callId: "c:recall", text: `recall ${JSON.stringify({ codes: [digestCode] })}` }),
			vb("r:recall", "tool_result", 3, 1500, 40, { toolName: "recall", callId: "c:recall", text: "# Prove It Works\nfull recalled skill leaf" }),
		];
		const view = makeView(blocks, 1_900, 3_250);
		const result = new MyCustomizeConductor().conduct(view);

		const rep = replaceOf(result, "r:recall");
		expect(rep).toBeDefined();
		expect(rep!.recoverable).toBe(true);
		expect(rep!.content).toContain("tool_result:recall");
		expect(rep!.content).toContain('Contains: skill-pstack(name="principle-prove-it-works")');
		expect(rep!.content).toContain("Label: Prove It Works principle");
		expect(projected(view, result)).toBeLessThanOrEqual(view.budget);
	});

	it("omits source code in pstack recall digest", () => {
		const sourceId = "r:pstack";
		const digestCode = foldTag(sourceId).slice(2, 8);
		const blocks = [
			vb("u:0", "user", 0, 200, 200, { text: "task" }),
			vb(sourceId, "tool_result", 1, 1500, 40, {
				toolName: "mcp",
				text: `${foldTag(sourceId)} tool_result:mcp skill-pstack(name="principle-prove-it-works")\nLabel: Prove It Works principle`,
				folded: true,
				held: true,
			}),
			vb("c:recall", "tool_call", 2, 50, 50, { toolName: "recall", callId: "c:recall", text: `recall ${JSON.stringify({ codes: [digestCode] })}` }),
			vb("r:recall", "tool_result", 3, 1500, 40, { toolName: "recall", callId: "c:recall", text: "full recalled skill leaf" }),
		];
		const rep = replaceOf(new MyCustomizeConductor().conduct(makeView(blocks, 1_900, 3_250)), "r:recall");
		expect(rep).toBeDefined();
		expect(rep!.content).not.toContain(`code="${digestCode}"`);
	});

	it("uses pstack leaf wording for pstack recall digests", () => {
		const sourceId = "r:pstack";
		const digestCode = foldTag(sourceId).slice(2, 8);
		const blocks = [
			vb("u:0", "user", 0, 200, 200, { text: "task" }),
			vb(sourceId, "tool_result", 1, 1500, 40, {
				toolName: "mcp",
				text: `${foldTag(sourceId)} tool_result:mcp skill-pstack(name="principle-prove-it-works")\nLabel: Prove It Works principle`,
				folded: true,
				held: true,
			}),
			vb("c:recall", "tool_call", 2, 50, 50, { toolName: "recall", callId: "c:recall", text: `recall ${JSON.stringify({ codes: [digestCode] })}` }),
			vb("r:recall", "tool_result", 3, 1500, 40, { toolName: "recall", callId: "c:recall", text: "full recalled skill leaf" }),
		];
		const rep = replaceOf(new MyCustomizeConductor().conduct(makeView(blocks, 1_900, 3_250)), "r:recall");
		expect(rep).toBeDefined();
		expect(rep!.content).toContain("to re-read this exact pstack leaf");
		expect(rep!.content).not.toContain("before re-calling this exact MCP tool");
	});

	it("keeps multi-code recall generic", () => {
		const sourceId = "r:pstack";
		const code = foldTag(sourceId).slice(2, 8);
		const blocks = [
			vb("u:0", "user", 0, 200, 200, { text: "task" }),
			vb(sourceId, "tool_result", 1, 1500, 40, {
				toolName: "mcp",
				text: `${foldTag(sourceId)} tool_result:mcp skill-pstack(name="principle-prove-it-works")\nLabel: Prove It Works principle`,
				folded: true,
				held: true,
			}),
			vb("c:recall", "tool_call", 2, 50, 50, {
				toolName: "recall",
				callId: "c:recall",
				text: `recall ${JSON.stringify({ codes: [code, "other99"] })}`,
			}),
			vb("r:recall", "tool_result", 3, 1500, 40, { toolName: "recall", callId: "c:recall", text: "full recalled skill leaf" }),
		];
		const rep = replaceOf(new MyCustomizeConductor().conduct(makeView(blocks, 1_900, 3_250)), "r:recall");
		expect(rep).toBeDefined();
		expect(rep!.content).not.toContain("Contains: skill-pstack");
	});

	it("formats unknown single-code recall generically", () => {
		const blocks = [
			vb("u:0", "user", 0, 200, 200, { text: "task" }),
			vb("c:recall", "tool_call", 1, 50, 50, { toolName: "recall", callId: "c:recall", text: `recall ${JSON.stringify({ codes: ["missing123"] })}` }),
			vb("r:recall", "tool_result", 2, 1500, 40, { toolName: "recall", callId: "c:recall", text: "full recalled unknown leaf" }),
		];
		const rep = replaceOf(new MyCustomizeConductor().conduct(makeView(blocks, 300, 1_750)), "r:recall");
		expect(rep).toBeDefined();
		expect(rep!.content).toContain('tool_result:recall code="missing123"');
		expect(rep!.content).not.toContain("Contains: skill-pstack");
	});
});
