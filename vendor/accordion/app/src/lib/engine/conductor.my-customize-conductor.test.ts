import { describe, it, expect } from "vitest";
import { IN_PROCESS_CONDUCTORS, MyCustomizeConductor } from "$conductors";
import type { Command, ConductorView, ViewBlock } from "$conductors/contract";
import { foldTag } from "./digest";
import { compactPath, estSummaryTokens, foldCode, mcpSummary, normalizePstackName, pstackLabel } from "$conductors/my-customize-conductor/mcp-summary";
import { estimateDefaultGroupDigestCost } from "$conductors/my-customize-conductor/my-customize-conductor";

const POTETO_BEACON_LINES = [
	"Poteto mode active.",
	"- Apply pstack skills/principles/playbooks only with their full leaf visible in this prompt.",
	'- For skill-pstack(name=...): full leaf visible → use; folded exact match → recall most recent; absent → call skill-pstack(name=...).',
];

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

function groupedIdsOf(result: Command[] | null | undefined): Set<string> {
	const ids = new Set<string>();
	for (const c of result ?? []) if (c.kind === "group") for (const id of c.ids) ids.add(id);
	return ids;
}

function replaceOf(result: Command[] | null | undefined, id: string): Extract<Command, { kind: "replace" }> | undefined {
	for (const c of result ?? []) if (c.kind === "replace" && c.id === id) return c;
	return undefined;
}

/** Live tokens after applying the conductor's fold, replace, and group commands. */
function projected(view: ConductorView, result: Command[] | null): number {
	const folded = foldIdsOf(result);
	const groups = (result ?? []).filter((c): c is Extract<Command, { kind: "group" }> => c.kind === "group");
	const grouped = new Set(groups.flatMap((group) => group.ids));
	let live = view.liveTokens;
	for (const b of view.blocks) {
		if (grouped.has(b.id)) continue;
		if (folded.has(b.id)) {
			live += b.foldedTokens - b.tokens;
			continue;
		}
		const rep = replaceOf(result, b.id);
		if (rep) live -= b.tokens - estSummaryTokens(rep.content);
	}
	for (const group of groups) {
		const members = group.ids.map((id) => view.blocks.find((b) => b.id === id)).filter((b): b is ViewBlock => b !== undefined);
		const residue = members.reduce((total, b) => {
			const replacement = replaceOf(result, b.id);
			if (replacement) return total + estSummaryTokens(replacement.content);
			const foldable = b.kind === "text" || b.kind === "thinking" || b.kind === "tool_result";
			return total + (folded.has(b.id) || (foldable && b.foldedTokens < b.tokens) ? b.foldedTokens : b.tokens);
		}, 0);
		const original = members.reduce((total, b) => total + b.tokens, 0);
		live += residue - original;
		live += estimateDefaultGroupDigestCost(members) - residue;
	}
	return live;
}

function pstackCall(id: string, order: number, name: string): ViewBlock {
	return vb(id, "tool_call", order, 50, 50, {
		toolName: "mcp",
		callId: id,
		text: `mcp ${JSON.stringify({ server: "engineering-skills", tool: "skill-pstack", args: JSON.stringify({ name }) })}`,
	});
}

function pstackResult(id: string, order: number, callId: string, text = "full pstack leaf"): ViewBlock {
	return vb(id, "tool_result", order, 1500, 40, { toolName: "mcp", callId, text });
}

function expectBeacon(text: string): void {
	for (const line of POTETO_BEACON_LINES) expect(text).toContain(line);
}

function expectNoBeacon(result: Command[] | null | undefined): void {
	for (const c of result ?? []) {
		if (c.kind === "replace") expect(c.content).not.toContain("Poteto mode active.");
	}
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

	it("holds the plan even when a previously folded block becomes frozen (breakFrozen applies it)", () => {
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

		// frozenFromIndex moves past r:3 — hold still fires because breakFrozen covers it.
		const frozenView = makeView(blocks, 2_000, 4_700, { frozenFromIndex: 5 });
		const second = conductor.conduct(frozenView);
		expect(second).toBe(first);
	});

	it("breaks frozen prefix under pressure rather than returning empty", () => {
		const blocks = [
			vb("u:0", "user", 0, 200, 200, { text: "task" }),
			vb("r:1", "tool_result", 1, 1_500, 40, { toolName: "bash", text: "output 1" }),
			vb("r:2", "tool_result", 2, 1_500, 40, { toolName: "bash", text: "output 2" }),
		];
		const view = makeView(blocks, 500, 3_200, { frozenFromIndex: 3 });
		const result = new MyCustomizeConductor().conduct(view);
		expect(result.length).toBeGreaterThan(0);
		const foldCmd = result.find((c) => c.kind === "fold");
		expect(foldCmd).toBeDefined();
		expect((foldCmd as any).breakFrozen).toBe(true);
		expect((foldCmd as any).ids).toContain("r:1");
		expect((foldCmd as any).ids).toContain("r:2");
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

	it("adds Poteto mode beacon to newest eligible poteto-mode result", () => {
		const blocks = [
			vb("u:0", "user", 0, 200, 200, { text: "task" }),
			pstackCall("c:poteto", 1, "poteto-mode"),
			pstackResult("r:poteto", 2, "c:poteto", "# Poteto mode\nfull leaf"),
		];
		const result = new MyCustomizeConductor().conduct(makeView(blocks, 320, 1_750));
		const rep = replaceOf(result, "r:poteto");
		expect(rep).toBeDefined();
		expect(rep!.content).toContain('tool_result:mcp skill-pstack(name="poteto-mode")');
		expect(rep!.content).toContain("Label: Poteto Mode skill");
		expectBeacon(rep!.content);
	});

	it("disables Poteto beacon after explicit user off phrase", () => {
		const blocks = [
			vb("u:0", "user", 0, 200, 200, { text: "load poteto" }),
			pstackCall("c:poteto", 1, "poteto-mode"),
			pstackResult("r:poteto", 2, "c:poteto", "# Poteto mode\nfull leaf"),
			vb("u:1", "user", 3, 120, 120, { text: "Please exit poteto mode now." }),
		];
		const result = new MyCustomizeConductor().conduct(makeView(blocks, 440, 1_870));
		expectNoBeacon(result);
	});

	it("uses last Poteto mode event in conversation order", () => {
		const offThenLoad = [
			vb("u:0", "user", 0, 120, 120, { text: "disable pstack mode" }),
			pstackCall("c:poteto", 1, "poteto-mode"),
			pstackResult("r:poteto", 2, "c:poteto", "# Poteto mode\nfull leaf"),
		];
		const offThenLoadResult = new MyCustomizeConductor().conduct(makeView(offThenLoad, 320, 1_670));
		expectBeacon(replaceOf(offThenLoadResult, "r:poteto")!.content);

		const loadThenOff = [
			vb("u:0", "user", 0, 120, 120, { text: "load poteto" }),
			pstackCall("c:poteto", 1, "poteto-mode"),
			pstackResult("r:poteto", 2, "c:poteto", "# Poteto mode\nfull leaf"),
			vb("u:1", "user", 3, 120, 120, { text: "stop using poteto" }),
		];
		const loadThenOffResult = new MyCustomizeConductor().conduct(makeView(loadThenOff, 440, 1_790));
		expectNoBeacon(loadThenOffResult);
	});

	it("does not re-enable Poteto mode from recall result", () => {
		const sourceId = "r:poteto-source";
		const digestCode = foldTag(sourceId).slice(2, 8);
		const blocks = [
			vb("u:0", "user", 0, 120, 120, { text: "load poteto" }),
			pstackCall("c:poteto", 1, "poteto-mode"),
			pstackResult("r:poteto-live", 2, "c:poteto", "# Poteto mode\nfull leaf"),
			vb("u:1", "user", 3, 120, 120, { text: "exit poteto mode" }),
			vb(sourceId, "tool_result", 4, 1500, 40, {
				toolName: "mcp",
				text: `${foldTag(sourceId)} tool_result:mcp skill-pstack(name="poteto-mode")\nLabel: Poteto Mode skill`,
				folded: true,
				held: true,
			}),
			vb("c:recall", "tool_call", 5, 50, 50, { toolName: "recall", callId: "c:recall", text: `recall ${JSON.stringify({ codes: [digestCode] })}` }),
			vb("r:recall", "tool_result", 6, 1500, 40, { toolName: "recall", callId: "c:recall", text: "# Poteto mode\nrecalled leaf" }),
		];
		const result = new MyCustomizeConductor().conduct(makeView(blocks, 3_000, 4_910));
		const rep = replaceOf(result, "r:recall");
		expect(rep).toBeDefined();
		expect(rep!.content).toContain('Contains: skill-pstack(name="poteto-mode")');
		expect(rep!.content).toContain("Label: Poteto Mode skill");
		expect(rep!.content).not.toContain("Poteto mode active.");
	});

	it("puts beacon only on newest poteto-mode copy", () => {
		const blocks = [
			vb("u:0", "user", 0, 120, 120, { text: "load poteto" }),
			pstackCall("c:poteto:1", 1, "poteto-mode"),
			pstackResult("r:poteto:1", 2, "c:poteto:1", "older poteto leaf"),
			pstackCall("c:poteto:2", 3, "poteto-mode"),
			pstackResult("r:poteto:2", 4, "c:poteto:2", "newer poteto leaf"),
		];
		const result = new MyCustomizeConductor().conduct(makeView(blocks, 900, 3_220));
		const older = replaceOf(result, "r:poteto:1");
		const newer = replaceOf(result, "r:poteto:2");
		expect(older).toBeDefined();
		expect(newer).toBeDefined();
		expect(older!.content).toContain('tool_result:mcp skill-pstack(name="poteto-mode")');
		expect(older!.content).not.toContain("Poteto mode active.");
		expectBeacon(newer!.content);
	});

	it("does not move beacon to older block when newest is protected", () => {
		const makeProtectedCase = (opts: { newest: Partial<ViewBlock>; frozenFromIndex?: number }) => {
			const blocks = [
				vb("u:0", "user", 0, 120, 120, { text: "load poteto" }),
				pstackCall("c:poteto:1", 1, "poteto-mode"),
				pstackResult("r:poteto:1", 2, "c:poteto:1", "older poteto leaf"),
				pstackCall("c:poteto:2", 3, "poteto-mode"),
				vb("r:poteto:2", "tool_result", 4, 1500, 40, {
					toolName: "mcp",
					callId: "c:poteto:2",
					text: "newer poteto leaf",
					...opts.newest,
				}),
			];
			return new MyCustomizeConductor().conduct(makeView(blocks, 900, 3_220, { frozenFromIndex: opts.frozenFromIndex }));
		};

		expectNoBeacon(makeProtectedCase({ newest: { protected: true } }));
		expectNoBeacon(makeProtectedCase({ newest: { held: true } }));
		expectNoBeacon(makeProtectedCase({ newest: { grouped: true } }));
		expectNoBeacon(makeProtectedCase({ newest: {}, frozenFromIndex: 5 }));
	});

	it("recomputes plan when Poteto beacon state changes", () => {
		const conductor = new MyCustomizeConductor();
		const activeBlocks = [
			vb("u:0", "user", 0, 120, 120, { text: "load poteto" }),
			pstackCall("c:poteto", 1, "poteto-mode"),
			pstackResult("r:poteto", 2, "c:poteto", "# Poteto mode\nfull leaf"),
		];
		const firstView = makeView(activeBlocks, 320, 1_670);
		const first = conductor.conduct(firstView);
		expectBeacon(replaceOf(first, "r:poteto")!.content);

		const secondView = makeView([...activeBlocks, vb("u:1", "user", 3, 120, 120, { text: "exit poteto mode" })], 440, 1_790);
		const second = conductor.conduct(secondView);
		expect(second).not.toBe(first);
		expect(replaceOf(second, "r:poteto")!.content).not.toContain("Poteto mode active.");
	});

	it("does not group pstack identity blocks while Poteto mode is active", () => {
		const blocks = [
			vb("u:0", "user", 0, 120, 120, { text: "load poteto" }),
			pstackCall("c:poteto", 1, "poteto-mode"),
			pstackResult("r:poteto", 2, "c:poteto", "# Poteto mode\nfull leaf"),
			vb("r:bash:1", "tool_result", 3, 1_500, 40, { toolName: "bash", text: "older noisy output" }),
			vb("r:bash:2", "tool_result", 4, 1_500, 40, { toolName: "bash", text: "newer noisy output" }),
			vb("r:bash:3", "tool_result", 5, 1_500, 40, { toolName: "bash", text: "newest noisy output" }),
		];
		const result = new MyCustomizeConductor().conduct(makeView(blocks, 1_600, 6_170));
		expect(result.some((c) => c.kind === "group" && c.ids.includes("r:poteto"))).toBe(false);
	});

	it("does not drop pstack identity blocks while Poteto mode is active", () => {
		const blocks = [
			vb("u:0", "user", 0, 120, 120, { text: "load poteto" }),
			pstackCall("c:poteto", 1, "poteto-mode"),
			pstackResult("r:poteto", 2, "c:poteto", "# Poteto mode\nfull leaf"),
			vb("r:bash:1", "tool_result", 3, 1_500, 40, { toolName: "bash", text: "older noisy output" }),
			vb("r:bash:2", "tool_result", 4, 1_500, 40, { toolName: "bash", text: "newer noisy output" }),
			vb("r:bash:3", "tool_result", 5, 1_500, 40, { toolName: "bash", text: "newest noisy output" }),
		];
		const result = new MyCustomizeConductor().conduct(makeView(blocks, 1_600, 6_170));
		expect(result.some((c) => c.kind === "group" && (c.digest === null || c.digest === ""))).toBe(false);
	});

	it("keeps pstack identity visible as recoverable replace", () => {
		const blocks = [
			vb("u:0", "user", 0, 120, 120, { text: "load poteto" }),
			pstackCall("c:poteto", 1, "poteto-mode"),
			pstackResult("r:poteto", 2, "c:poteto", "# Poteto mode\nfull leaf"),
			vb("r:bash:1", "tool_result", 3, 1_500, 40, { toolName: "bash", text: "older noisy output" }),
			vb("r:bash:2", "tool_result", 4, 1_500, 40, { toolName: "bash", text: "newer noisy output" }),
			vb("r:bash:3", "tool_result", 5, 1_500, 40, { toolName: "bash", text: "newest noisy output" }),
		];
		const result = new MyCustomizeConductor().conduct(makeView(blocks, 1_600, 6_170));
		const rep = replaceOf(result, "r:poteto");
		expect(rep).toBeDefined();
		expect(rep!.recoverable).toBe(true);
		expect(rep!.content).toContain('tool_result:mcp skill-pstack(name="poteto-mode")');
		expect(foldIdsOf(result).has("r:poteto")).toBe(false);
	});

	it("does not fight human grouped pstack blocks", () => {
		const blocks = [
			vb("u:0", "user", 0, 120, 120, { text: "load poteto" }),
			pstackCall("c:poteto", 1, "poteto-mode"),
			vb("r:poteto", "tool_result", 2, 1_500, 40, {
				toolName: "mcp",
				callId: "c:poteto",
				text: "# Poteto mode\nfull leaf",
				grouped: true,
			}),
			vb("r:bash:1", "tool_result", 3, 1_500, 40, { toolName: "bash", text: "older noisy output" }),
			vb("r:bash:2", "tool_result", 4, 1_500, 40, { toolName: "bash", text: "newer noisy output" }),
			vb("r:bash:3", "tool_result", 5, 1_500, 40, { toolName: "bash", text: "newest noisy output" }),
		];
		const result = new MyCustomizeConductor().conduct(makeView(blocks, 1_600, 6_170));
		expect(result.some((c) => c.kind === "replace" && c.id === "r:poteto")).toBe(false);
		expect(result.some((c) => c.kind === "fold" && c.ids.includes("r:poteto"))).toBe(false);
		expect(result.some((c) => c.kind === "group" && c.ids.includes("r:poteto"))).toBe(false);
	});


	it("pstack MCP summary includes exact recall code and not-unfold wording", () => {
		const resultId = "r:pstack";
		const expectedCode = foldCode(resultId);
		const summary = mcpSummary(
			vb(resultId, "tool_result", 1, 1500, 40, { toolName: "mcp", callId: "c1", text: "result" }),
			vb("c1", "tool_call", 0, 50, 50, {
				toolName: "mcp",
				callId: "c1",
				text: `mcp ${JSON.stringify({ server: "engineering-skills", tool: "skill-pstack", args: JSON.stringify({ name: "principle-prove-it-works" }) })}`,
			}),
		);
		expect(summary).toContain(`recall({"codes":["${expectedCode}"]})`);
		expect(summary).toContain("not unfold");
	});

	it("generic MCP summary includes exact recall code and no not-unfold wording", () => {
		const resultId = "r:generic";
		const expectedCode = foldCode(resultId);
		const summary = mcpSummary(
			vb(resultId, "tool_result", 1, 1500, 40, { toolName: "mcp", callId: "c2", text: "result" }),
			vb("c2", "tool_call", 0, 50, 50, {
				toolName: "mcp",
				callId: "c2",
				text: `mcp ${JSON.stringify({ tool: "some_lookup", args: { project: "my-pi" } })}`,
			}),
		);
		expect(summary).toContain(`recall({"codes":["${expectedCode}"]})`);
		expect(summary).not.toContain("not unfold");
	});

	it("read tool result is folded via a recoverable replace", () => {
		const blocks = [
			vb("u:0", "user", 0, 200, 200, { text: "task" }),
			vb("c:read", "tool_call", 1, 30, 30, { toolName: "read", callId: "c:read", text: `read ${JSON.stringify({ path: "/some/path/file.ts" })}` }),
			vb("r:read", "tool_result", 2, 1500, 40, { toolName: "read", callId: "c:read", text: "line one\nline two\nline three" }),
		];
		const view = makeView(blocks, 400, 1_730);
		const result = new MyCustomizeConductor().conduct(view);
		const rep = replaceOf(result, "r:read");
		expect(rep, "read result is replaced, not plain-folded").toBeDefined();
		expect(rep!.recoverable, "replace is recoverable").toBe(true);
		expect(foldIdsOf(result).has("r:read"), "read result is not in plain fold list").toBe(false);
		expect(projected(view, result)).toBeLessThanOrEqual(view.budget);
	});

	it("read summary includes compacted path, signals, Shape, exact recall code, and snapshot wording", () => {
		const resultId = "r:read2";
		const expectedCode = foldCode(resultId);
		const blocks = [
			vb("u:0", "user", 0, 200, 200, { text: "task" }),
			vb("c:read", "tool_call", 1, 30, 30, {
				toolName: "read", callId: "c:read",
				text: `read ${JSON.stringify({ path: "/home/user/project/src/service.ts" })}`,
			}),
			vb(resultId, "tool_result", 2, 1500, 40, {
				toolName: "read", callId: "c:read",
				text: "# Service\nexport class ServiceManager {\n  setup() {}\n}\nexport function start() {}",
			}),
		];
		const view = makeView(blocks, 400, 1_730);
		const rep = replaceOf(new MyCustomizeConductor().conduct(view), resultId);
		expect(rep).toBeDefined();
		expect(rep!.content).toMatch(/tool_result:read path="[^"]+"/);
		expect(rep!.content).toContain("Shape:");
		expect(rep!.content).toContain(`recall({"codes":["${expectedCode}"]})`);
		expect(rep!.content).toContain("prior read snapshot");
		expect(rep!.content).toContain("re-read if the file may have changed");
	});

	it("subagent result is folded via a recoverable replace", () => {
		const blocks = [
			vb("u:0", "user", 0, 200, 200, { text: "task" }),
			vb("c:sub", "tool_call", 1, 50, 50, {
				toolName: "subagent",
				callId: "c:sub",
				text: `subagent ${JSON.stringify({ type: "explore", task: "Find all TypeScript entry points", cwd: "/home/user/project" })}`,
			}),
			vb("r:sub", "tool_result", 2, 1500, 40, {
				toolName: "subagent",
				callId: "c:sub",
				text: "- Found src/index.ts\n- Found src/lib/core.ts\n- Both use strict mode",
			}),
		];
		const view = makeView(blocks, 400, 1_750);
		const result = new MyCustomizeConductor().conduct(view);
		const rep = replaceOf(result, "r:sub");
		expect(rep, "subagent result is replaced, not plain-folded").toBeDefined();
		expect(rep!.recoverable, "replace is recoverable").toBe(true);
		expect(foldIdsOf(result).has("r:sub"), "subagent result is not in plain fold list").toBe(false);
		expect(projected(view, result)).toBeLessThanOrEqual(view.budget);
	});

	it("subagent summary includes type, capped task, compacted cwd, and exact recall code", () => {
		const resultId = "r:sub:meta";
		const expectedCode = foldCode(resultId);
		const blocks = [
			vb("u:0", "user", 0, 200, 200, { text: "task" }),
			vb("c:sub:meta", "tool_call", 1, 50, 50, {
				toolName: "subagent",
				callId: "c:sub:meta",
				text: `subagent ${JSON.stringify({ type: "shell", task: "Run tests and capture failures", cwd: "C:\\Users\\Admin\\project" })}`,
			}),
			vb(resultId, "tool_result", 2, 1500, 40, {
				toolName: "subagent",
				callId: "c:sub:meta",
				text: "All tests pass.",
			}),
		];
		const rep = replaceOf(new MyCustomizeConductor().conduct(makeView(blocks, 400, 1_750)), resultId);
		expect(rep).toBeDefined();
		expect(rep!.content).toContain('type="shell"');
		expect(rep!.content).toContain("Task: Run tests and capture failures");
		expect(rep!.content).toContain('cwd="~/project"');
		expect(rep!.content).toContain(`recall({"codes":["${expectedCode}"]})`);
		expect(rep!.content).not.toContain("unfold");
	});

	it("subagent summary: bullet-preferred findings skip headings and separators", () => {
		const resultId = "r:sub:bullets";
		const text = [
			"## Investigation Results",
			"---",
			"Here is what was found:",
			"- Entry point is src/index.ts",
			"- Core logic lives in src/lib/core.ts",
			"- Tests are under src/__tests__",
			"- Additional file src/utils.ts",
		].join("\n");
		const blocks = [
			vb("u:0", "user", 0, 200, 200, { text: "task" }),
			vb("c:sub:bullets", "tool_call", 1, 50, 50, {
				toolName: "subagent",
				callId: "c:sub:bullets",
				text: `subagent ${JSON.stringify({ type: "explore", task: "Map repo structure" })}`,
			}),
			vb(resultId, "tool_result", 2, 1500, 40, { toolName: "subagent", callId: "c:sub:bullets", text }),
		];
		const rep = replaceOf(new MyCustomizeConductor().conduct(makeView(blocks, 400, 1_750)), resultId);
		expect(rep).toBeDefined();
		expect(rep!.content).toContain("Findings:");
		// Bullet content (not headings or separators) appears in findings.
		expect(rep!.content).toContain("Entry point is src/index.ts");
		expect(rep!.content).not.toContain("Investigation Results");
		// Findings capped at 3; the 4th bullet does not appear.
		expect(rep!.content).not.toContain("Additional file src/utils.ts");
		// Preamble prose line does not appear when bullets exist.
		expect(rep!.content).not.toContain("Here is what was found");
	});

	it("subagent summary: prose-only output falls back to first useful prose lines", () => {
		const resultId = "r:sub:prose";
		const text = [
			"## Overview",
			"---",
			"The repo uses a monorepo layout with three packages.",
			"Each package has its own tsconfig and vitest config.",
			"The root package.json orchestrates builds via turborepo.",
			"A fourth package was added recently for shared types.",
		].join("\n");
		const blocks = [
			vb("u:0", "user", 0, 200, 200, { text: "task" }),
			vb("c:sub:prose", "tool_call", 1, 50, 50, {
				toolName: "subagent",
				callId: "c:sub:prose",
				text: `subagent ${JSON.stringify({ type: "explore", task: "Describe repo layout" })}`,
			}),
			vb(resultId, "tool_result", 2, 1500, 40, { toolName: "subagent", callId: "c:sub:prose", text }),
		];
		const rep = replaceOf(new MyCustomizeConductor().conduct(makeView(blocks, 400, 1_750)), resultId);
		expect(rep).toBeDefined();
		expect(rep!.content).toContain("Findings:");
		// First prose line (after heading/separator skip) is included.
		expect(rep!.content).toContain("The repo uses a monorepo layout");
		// Heading is not included.
		expect(rep!.content).not.toContain("Overview");
		// Findings capped at 3; the 4th prose line does not appear.
		expect(rep!.content).not.toContain("A fourth package");
	});

	it("subagent custom type includes customAgent identity", () => {
		const resultId = "r:sub:custom";
		const blocks = [
			vb("u:0", "user", 0, 200, 200, { text: "task" }),
			vb("c:sub:custom", "tool_call", 1, 50, 50, {
				toolName: "subagent",
				callId: "c:sub:custom",
				text: `subagent ${JSON.stringify({ type: "custom", customAgent: "my-agent", task: "Run specialized analysis" })}`,
			}),
			vb(resultId, "tool_result", 2, 1500, 40, { toolName: "subagent", callId: "c:sub:custom", text: "Analysis complete." }),
		];
		const rep = replaceOf(new MyCustomizeConductor().conduct(makeView(blocks, 400, 1_750)), resultId);
		expect(rep).toBeDefined();
		expect(rep!.content).toContain('type="custom"');
		expect(rep!.content).toContain('customAgent="my-agent"');
	});

	it("subagent without cwd omits cwd from summary", () => {
		const resultId = "r:sub:nocwd";
		const blocks = [
			vb("u:0", "user", 0, 200, 200, { text: "task" }),
			vb("c:sub:nocwd", "tool_call", 1, 50, 50, {
				toolName: "subagent",
				callId: "c:sub:nocwd",
				text: `subagent ${JSON.stringify({ type: "explore", task: "Check types" })}`,
			}),
			vb(resultId, "tool_result", 2, 1500, 40, { toolName: "subagent", callId: "c:sub:nocwd", text: "Types are clean." }),
		];
		const rep = replaceOf(new MyCustomizeConductor().conduct(makeView(blocks, 400, 1_750)), resultId);
		expect(rep).toBeDefined();
		expect(rep!.content).toContain('type="explore"');
		expect(rep!.content).not.toContain('cwd=');
	});

	it("grep result is folded via a recoverable replace", () => {
		const blocks = [
			vb("u:0", "user", 0, 200, 200, { text: "task" }),
			vb("c:grep", "tool_call", 1, 30, 30, { toolName: "grep", callId: "c:grep", text: `grep ${JSON.stringify({ pattern: "foldCode", path: "./src" })}` }),
			vb("r:grep", "tool_result", 2, 1500, 40, { toolName: "grep", callId: "c:grep", text: "src/lib/engine.ts:10:foldCode('x')\nsrc/lib/store.ts:42:foldCode('y')" }),
		];
		const view = makeView(blocks, 400, 1_730);
		const result = new MyCustomizeConductor().conduct(view);
		const rep = replaceOf(result, "r:grep");
		expect(rep, "grep result is replaced, not plain-folded").toBeDefined();
		expect(rep!.recoverable, "replace is recoverable").toBe(true);
		expect(foldIdsOf(result).has("r:grep"), "grep result is not in plain fold list").toBe(false);
		expect(projected(view, result)).toBeLessThanOrEqual(view.budget);
	});

	it("grep summary includes pattern identity, path, signals, Shape, exact recall code, and search wording", () => {
		const resultId = "r:grep2";
		const expectedCode = foldCode(resultId);
		const blocks = [
			vb("u:0", "user", 0, 200, 200, { text: "task" }),
			vb("c:grep", "tool_call", 1, 30, 30, {
				toolName: "grep", callId: "c:grep",
				text: `grep ${JSON.stringify({ pattern: "MyClass", path: "/home/user/project/src" })}`,
			}),
			vb(resultId, "tool_result", 2, 1500, 40, {
				toolName: "grep", callId: "c:grep",
				text: "src/service.ts:5:class MyClass {\nsrc/service.ts:15:  new MyClass()\nsrc/util.ts:3:export { MyClass }",
			}),
		];
		const view = makeView(blocks, 400, 1_730);
		const rep = replaceOf(new MyCustomizeConductor().conduct(view), resultId);
		expect(rep).toBeDefined();
		expect(rep!.content).toContain('tool_result:grep pattern="MyClass"');
		expect(rep!.content).toContain('path="~/project/src"');
		expect(rep!.content).toContain("Contains:");
		expect(rep!.content).toContain("Shape:");
		expect(rep!.content).toContain(`recall({"codes":["${expectedCode}"]})`);
		expect(rep!.content).toContain("before repeating this search");
		expect(rep!.content).not.toContain("unfold");
	});

	it("find result is folded via a recoverable replace", () => {
		const blocks = [
			vb("u:0", "user", 0, 200, 200, { text: "task" }),
			vb("c:find", "tool_call", 1, 30, 30, { toolName: "find", callId: "c:find", text: `find ${JSON.stringify({ path: "./src", pattern: "*.ts" })}` }),
			vb("r:find", "tool_result", 2, 1500, 40, { toolName: "find", callId: "c:find", text: "src/a.ts\nsrc/b.ts\nsrc/c.ts" }),
		];
		const view = makeView(blocks, 400, 1_730);
		const result = new MyCustomizeConductor().conduct(view);
		const rep = replaceOf(result, "r:find");
		expect(rep, "find result is replaced, not plain-folded").toBeDefined();
		expect(rep!.recoverable, "replace is recoverable").toBe(true);
		expect(foldIdsOf(result).has("r:find"), "find result is not in plain fold list").toBe(false);
		expect(projected(view, result)).toBeLessThanOrEqual(view.budget);
	});

	it("find summary includes path, glob pattern, signals, Shape, exact recall code, and file discovery wording", () => {
		const resultId = "r:find2";
		const expectedCode = foldCode(resultId);
		const blocks = [
			vb("u:0", "user", 0, 200, 200, { text: "task" }),
			vb("c:find", "tool_call", 1, 30, 30, {
				toolName: "find", callId: "c:find",
				text: `find ${JSON.stringify({ path: "/home/user/project", pattern: "*.ts" })}`,
			}),
			vb(resultId, "tool_result", 2, 1500, 40, {
				toolName: "find", callId: "c:find",
				text: "src/a.ts\nsrc/b.ts\nlib/c.ts\nlib/d.ts\ntest/e.ts",
			}),
		];
		const view = makeView(blocks, 400, 1_730);
		const rep = replaceOf(new MyCustomizeConductor().conduct(view), resultId);
		expect(rep).toBeDefined();
		expect(rep!.content).toMatch(/tool_result:find path="[^"]+"/);
		expect(rep!.content).toContain('path="~/project"');
		expect(rep!.content).toContain('pattern="*.ts"');
		expect(rep!.content).toContain("Contains:");
		expect(rep!.content).toContain("Shape:");
		expect(rep!.content).toContain(`recall({"codes":["${expectedCode}"]})`);
		expect(rep!.content).toContain("before repeating this file discovery");
		expect(rep!.content).not.toContain("unfold");
	});

	it("ls result is folded via a recoverable replace", () => {
		const blocks = [
			vb("u:0", "user", 0, 200, 200, { text: "task" }),
			vb("c:ls", "tool_call", 1, 30, 30, { toolName: "ls", callId: "c:ls", text: `ls ${JSON.stringify({ path: "./src" })}` }),
			vb("r:ls", "tool_result", 2, 1500, 40, { toolName: "ls", callId: "c:ls", text: "index.ts\nutils.ts\nmodels/\ntypes.ts" }),
		];
		const view = makeView(blocks, 400, 1_730);
		const result = new MyCustomizeConductor().conduct(view);
		const rep = replaceOf(result, "r:ls");
		expect(rep, "ls result is replaced, not plain-folded").toBeDefined();
		expect(rep!.recoverable, "replace is recoverable").toBe(true);
		expect(foldIdsOf(result).has("r:ls"), "ls result is not in plain fold list").toBe(false);
		expect(projected(view, result)).toBeLessThanOrEqual(view.budget);
	});

	it("ls summary includes path, signals, Shape, exact recall code, and listing wording", () => {
		const resultId = "r:ls2";
		const expectedCode = foldCode(resultId);
		const blocks = [
			vb("u:0", "user", 0, 200, 200, { text: "task" }),
			vb("c:ls", "tool_call", 1, 30, 30, {
				toolName: "ls", callId: "c:ls",
				text: `ls ${JSON.stringify({ path: "/home/user/project/src" })}`,
			}),
			vb(resultId, "tool_result", 2, 1500, 40, {
				toolName: "ls", callId: "c:ls",
				text: "index.ts\nutils.ts\nmodels/\ntypes.ts\nhelpers/",
			}),
		];
		const view = makeView(blocks, 400, 1_730);
		const rep = replaceOf(new MyCustomizeConductor().conduct(view), resultId);
		expect(rep).toBeDefined();
		expect(rep!.content).toMatch(/tool_result:ls path="[^"]+"/);
		expect(rep!.content).toContain("Contains:");
		expect(rep!.content).toContain("Shape:");
		expect(rep!.content).toContain(`recall({"codes":["${expectedCode}"]})`);
		expect(rep!.content).toContain("before repeating this listing");
		expect(rep!.content).not.toContain("unfold");
	});

	it("unknown (bash) tool result falls back to plain fold, not replace", () => {
		const blocks = [
			vb("u:0", "user", 0, 200, 200, { text: "task" }),
			vb("r:bash", "tool_result", 1, 1500, 40, { toolName: "bash", text: "some output" }),
		];
		const result = new MyCustomizeConductor().conduct(makeView(blocks, 400, 1_700));
		expect(foldIdsOf(result).has("r:bash"), "bash result is plain-folded").toBe(true);
		expect(replaceOf(result, "r:bash"), "bash result has no replace").toBeUndefined();
	});

	it("does not group when folds already reach the cap", () => {
		const blocks = [
			vb("u:0", "user", 0, 100, 100, { text: "task" }),
			vb("r:1", "text", 1, 1_000, 200, { text: "old one" }),
			vb("r:2", "text", 2, 1_000, 200, { text: "old two" }),
			vb("r:3", "text", 3, 1_000, 200, { text: "old three" }),
		];
		const result = new MyCustomizeConductor().conduct(makeView(blocks, 700, 3_100));
		expect(result.some((command) => command.kind === "group")).toBe(false);
	});

	it("groups a non-frozen run only after fold residue remains over cap", () => {
		const blocks = [
			vb("u:0", "user", 0, 100, 100, { text: "task" }),
			vb("r:1", "text", 1, 1_000, 200, { text: "old one" }),
			vb("r:2", "text", 2, 1_000, 200, { text: "old two" }),
			vb("r:3", "text", 3, 1_000, 200, { text: "old three" }),
		];
		const result = new MyCustomizeConductor().conduct(makeView(blocks, 500, 3_100));
		const view = makeView(blocks, 500, 3_100);
		const groups = result.filter((command): command is Extract<Command, { kind: "group" }> => command.kind === "group");
		expect(groups.length).toBeGreaterThan(0);
		const plannedResidue = groups[0].ids.reduce((total, id) => total + view.blocks.find((block) => block.id === id)!.foldedTokens, 0);
		const estimatedSaving = plannedResidue - estimateDefaultGroupDigestCost(groups[0].ids.map((id) => view.blocks.find((block) => block.id === id)!));
		const projectedAfterFolds = view.liveTokens - blocks.slice(1).reduce((total, block) => total + (block.tokens - block.foldedTokens), 0);
		expect(projectedAfterFolds - projected(view, result)).toBe(estimatedSaving);
		expect(projected(view, result)).toBe(projectedAfterFolds - estimatedSaving);
		for (const group of groups) expect(group.digest).toBeUndefined();
	});

	it("uses rich replacement residue instead of original tokens when grouping", () => {
		const blocks = [
			vb("u:0", "user", 0, 100, 100, { text: "task" }),
			vb("c:read", "tool_call", 1, 30, 30, { toolName: "read", callId: "c:read", text: 'read {"path":"/src/file.ts"}' }),
			vb("r:read", "tool_result", 2, 2_000, 1, { toolName: "read", callId: "c:read", text: "compact source snapshot" }),
			vb("r:text", "text", 3, 1_000, 1, { text: "old context" }),
		];
		const view = makeView(blocks, 100, 3_130);
		const result = new MyCustomizeConductor().conduct(view);
		const group = result.find((command): command is Extract<Command, { kind: "group" }> => command.kind === "group");
		expect(group?.ids).toContain("r:read");
		expect(replaceOf(result, "r:read"), "a grouped member has no replacement residue command").toBeUndefined();
		const members = group!.ids.map((id) => view.blocks.find((block) => block.id === id)!);
		const groupCost = estimateDefaultGroupDigestCost(members);
		const originalResidue = members.reduce((total, block) => total + block.tokens, 0);
		const foldedResidue = members.reduce((total, block) => total + block.foldedTokens, 0);
		expect(foldedResidue).toBeLessThanOrEqual(groupCost);
		expect(originalResidue).toBeGreaterThan(groupCost);
		expect(projected(view, result)).toBe(view.liveTokens - originalResidue + groupCost);
	});

	it("does not group a run whose planned residue cannot beat the default digest", () => {
		const blocks = [
			vb("u:0", "user", 0, 100, 100, { text: "task" }),
			vb("r:1", "text", 1, 10, 9, { text: "a" }),
			vb("r:2", "text", 2, 10, 9, { text: "b" }),
		];
		const result = new MyCustomizeConductor().conduct(makeView(blocks, 100, 120));
		expect(result.some((command) => command.kind === "group")).toBe(false);
	});

	it("keeps user and MCP blocks out of group runs", () => {
		const blocks = [
			vb("u:0", "user", 0, 100, 100, { text: "task" }),
			vb("r:1", "text", 1, 1_000, 200, { text: "old one" }),
			vb("u:1", "user", 2, 100, 100, { text: "keep intent" }),
			vb("r:mcp-call", "tool_call", 3, 50, 50, { toolName: "mcp", callId: "mcp-call", text: "mcp call" }),
			vb("r:mcp", "tool_result", 4, 1_000, 200, { toolName: "mcp", callId: "mcp-call", text: "identity" }),
			vb("r:2", "text", 5, 1_000, 200, { text: "old two" }),
			vb("r:3", "text", 6, 1_000, 200, { text: "old three" }),
		];
		const result = new MyCustomizeConductor().conduct(makeView(blocks, 300, 4_250));
		for (const command of result) {
			if (command.kind !== "group") continue;
			expect(command.ids).not.toContain("u:1");
			expect(command.ids).not.toContain("r:mcp-call");
			expect(command.ids).not.toContain("r:mcp");
		}
		expect(groupedIdsOf(result).has("r:2")).toBe(true);
		expect(groupedIdsOf(result).has("r:3")).toBe(true);
	});

	it("keeps recall, pstack provenance, held, protected, and grouped blocks out of groups", () => {
		const blocks = [
			vb("u:0", "user", 0, 100, 100, { text: "task" }),
			vb("r:before", "text", 1, 1_000, 200, { text: "before" }),
			vb("r:recall", "tool_result", 2, 1_000, 200, { toolName: "recall", text: "recalled content" }),
			vb("r:pstack", "text", 3, 1_000, 200, { text: `${foldTag("r:pstack")} tool_result:mcp skill-pstack(name="architect")` }),
			vb("r:held", "text", 4, 1_000, 200, { held: true, text: "held" }),
			vb("r:protected", "text", 5, 1_000, 200, { protected: true, text: "protected" }),
			vb("r:grouped", "text", 6, 1_000, 200, { grouped: true, text: "already grouped" }),
			vb("r:after", "text", 7, 1_000, 200, { text: "after" }),
			vb("r:after2", "text", 8, 1_000, 200, { text: "after two" }),
		];
		const result = new MyCustomizeConductor().conduct(makeView(blocks, 300, 7_100));
		const grouped = groupedIdsOf(result);
		for (const id of ["r:recall", "r:pstack", "r:held", "r:protected", "r:grouped"]) expect(grouped.has(id)).toBe(false);
		expect(grouped.has("r:after")).toBe(true);
		expect(grouped.has("r:after2")).toBe(true);
	});

	it("allows non-MCP tool calls and results in a safe group run", () => {
		const blocks = [
			vb("u:0", "user", 0, 100, 100, { text: "task" }),
			vb("c:bash", "tool_call", 1, 50, 50, { toolName: "bash", callId: "c:bash", text: "bash command" }),
			vb("r:bash", "tool_result", 2, 1_500, 40, { toolName: "bash", callId: "c:bash", text: "large output" }),
			vb("r:text", "text", 3, 1_500, 200, { text: "more context" }),
		];
		const result = new MyCustomizeConductor().conduct(makeView(blocks, 300, 3_150));
		const group = result.find((command): command is Extract<Command, { kind: "group" }> => command.kind === "group");
		expect(group).toBeDefined();
		expect(group!.ids).toEqual(expect.arrayContaining(["c:bash", "r:bash", "r:text"]));
	});

	it("does not give a block both a group and another structural disposition", () => {
		const blocks = [
			vb("u:0", "user", 0, 100, 100, { text: "task" }),
			vb("c:read", "tool_call", 1, 30, 30, { toolName: "read", callId: "c:read", text: 'read {"path":"/src/file.ts"}' }),
			vb("r:read", "tool_result", 2, 2_000, 40, { toolName: "read", callId: "c:read", text: "source" }),
			vb("r:text", "text", 3, 1_000, 200, { text: "context" }),
		];
		const result = new MyCustomizeConductor().conduct(makeView(blocks, 300, 3_130));
		const groupIds = groupedIdsOf(result);
		for (const command of result) {
			if (command.kind === "fold") for (const id of command.ids) expect(groupIds.has(id)).toBe(false);
			if (command.kind === "replace") expect(groupIds.has(command.id)).toBe(false);
		}
		for (const command of result) {
			if (command.kind === "group") expect(command.digest).toBeUndefined();
		}
	});

	it("does not group frozen blocks when non-frozen planning reaches the cap", () => {
		const blocks = [
			vb("f:1", "text", 0, 1_000, 200, { text: "cached one" }),
			vb("f:2", "text", 1, 1_000, 200, { text: "cached two" }),
			vb("n:1", "text", 2, 1_000, 200, { text: "new one" }),
			vb("n:2", "text", 3, 1_000, 200, { text: "new two" }),
		];
		const result = new MyCustomizeConductor().conduct(makeView(blocks, 400, 4_000, { frozenFromIndex: 2 }));
		expect(result.some((command) => command.kind === "group")).toBe(false);
	});

	it("does not emit frozen groups below the significant-savings threshold", () => {
		const blocks = [
			vb("f:1", "text", 0, 1_000, 200, { text: "cached one" }),
			vb("f:2", "text", 1, 1_000, 200, { text: "cached two" }),
			vb("tail", "user", 2, 5_000, 5_000, { protected: true, text: "working tail" }),
		];
		const result = new MyCustomizeConductor().conduct(makeView(blocks, 5_000, 7_000, { frozenFromIndex: 2 }));
		expect(result.some((command) => command.kind === "group")).toBe(false);
	});

	it("batches significant frozen savings into a recoverable group epoch", () => {
		const frozen = Array.from({ length: 30 }, (_, i) => vb(`f:${i}`, "text", i, 3_000, 100, { text: `cached ${i}` }));
		const tail = vb("tail", "user", 30, 5_000, 5_000, { protected: true, text: "working tail" });
		const view = makeView([...frozen, tail], 5_000, 95_000, { frozenFromIndex: frozen.length });
		const conductor = new MyCustomizeConductor();
		const first = conductor.conduct(view);
		const group = first.find((command): command is Extract<Command, { kind: "group" }> => command.kind === "group");
		expect(group?.ids).toEqual(frozen.map((block) => block.id));
		expect(group?.digest).toBeUndefined();
	});

	it("does not emit a second frozen grouping epoch for an identical view", () => {
		const frozen = Array.from({ length: 30 }, (_, i) => vb(`f:${i}`, "text", i, 3_000, 100, { text: `cached ${i}` }));
		const tail = vb("tail", "user", 30, 5_000, 5_000, { protected: true, text: "working tail" });
		const view = makeView([...frozen, tail], 5_000, 95_000, { frozenFromIndex: frozen.length });
		const conductor = new MyCustomizeConductor();
		const first = conductor.conduct(view);
		const second = conductor.conduct(view);
		expect(second).toBe(first);
		expect(second.filter((command) => command.kind === "group")).toEqual(first.filter((command) => command.kind === "group"));
	});

	it("resets the frozen grouping epoch after a semantic-key change", () => {
		const frozen = Array.from({ length: 30 }, (_, i) => vb(`f:${i}`, "text", i, 3_000, 100, { text: `cached ${i}` }));
		const firstUser = vb("u:1", "user", 30, 100, 100, { text: "load poteto" });
		const call = pstackCall("c:poteto", 31, "poteto-mode");
		const result = pstackResult("r:poteto", 32, "c:poteto", "full pstack leaf");
		const tail = vb("tail", "user", 33, 5_000, 5_000, { protected: true, text: "working tail" });
		const conductor = new MyCustomizeConductor();
		const first = conductor.conduct(makeView([...frozen, tail], 5_000, 95_000, { frozenFromIndex: frozen.length }));
		const changed = conductor.conduct(makeView([...frozen, firstUser, call, result, tail], 5_000, 95_000 + 1_720, { frozenFromIndex: frozen.length + 3 }));
		expect(first.some((command) => command.kind === "group")).toBe(true);
		expect(changed.some((command) => command.kind === "group")).toBe(true);
	});

	it("allows a later frozen grouping epoch after projected tokens return under cap", () => {
		const frozen = Array.from({ length: 30 }, (_, i) => vb(`f:${i}`, "text", i, 3_000, 100, { text: `cached ${i}` }));
		const tail = vb("tail", "user", 30, 5_000, 5_000, { protected: true, text: "working tail" });
		const conductor = new MyCustomizeConductor();
		const overCap = makeView([...frozen, tail], 5_000, 95_000, { frozenFromIndex: frozen.length });
		const first = conductor.conduct(overCap);
		const underCap = makeView([...frozen, tail], 5_000, 4_900, { frozenFromIndex: frozen.length });
		expect(conductor.conduct(underCap)).toEqual([]);
		const later = conductor.conduct(overCap);
		expect(later.some((command) => command.kind === "group")).toBe(true);
		expect(first.some((command) => command.kind === "group")).toBe(true);
	});

	it("keeps frozen grouped IDs out of fold and replace commands", () => {
		const frozen = Array.from({ length: 30 }, (_, i) => vb(`f:${i}`, "text", i, 3_000, 100, { text: `cached ${i}` }));
		const tail = vb("tail", "user", 30, 5_000, 5_000, { protected: true, text: "working tail" });
		const result = new MyCustomizeConductor().conduct(makeView([...frozen, tail], 5_000, 95_000, { frozenFromIndex: frozen.length }));
		const grouped = groupedIdsOf(result);
		for (const command of result) {
			if (command.kind === "fold") for (const id of command.ids) expect(grouped.has(id)).toBe(false);
			if (command.kind === "replace") expect(grouped.has(command.id)).toBe(false);
		}
	});

	it("compactPath normalises slashes and abbreviates home prefix", () => {
		expect(compactPath("C:/Users/Admin/project/file.ts")).toBe("~/project/file.ts");
		expect(compactPath("/home/user/project/file.ts")).toBe("~/project/file.ts");
		expect(compactPath(String.raw`C:\Users\Admin\project\file.ts`)).toBe("~/project/file.ts");
		const long = "~/a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q/r/s/t/u/v/w/x/y/z/file.ts";
		const compacted = compactPath(long);
		expect(compacted.length).toBeLessThanOrEqual(60);
		expect(compacted).toContain("file.ts");
	});
});
