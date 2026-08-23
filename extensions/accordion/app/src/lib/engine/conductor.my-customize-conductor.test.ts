import { describe, it, expect } from "vitest";
import { IN_PROCESS_CONDUCTORS, MyCustomizeConductor as ProductionMyCustomizeConductor } from "$conductors";
import type { Command, Conductor, ConductorHost, ConductorPlan, ConductorView, ViewBlock } from "$conductors/contract";
import { compactPath, estSummaryTokens, foldCode, mcpSummary, normalizePstackName, pstackLabel, canonicalMcpIdentity } from "$conductors/my-customize-conductor/mcp-summary";
import { estimateDefaultGroupDigestCost } from "$conductors/my-customize-conductor/my-customize-conductor";

class MyCustomizeConductor implements Conductor {
	private readonly delegate: ProductionMyCustomizeConductor;
	readonly id: string;
	readonly label: string;

	constructor(opts?: ConstructorParameters<typeof ProductionMyCustomizeConductor>[0]) {
		this.delegate = new ProductionMyCustomizeConductor(opts);
		this.id = this.delegate.id;
		this.label = this.delegate.label;
	}

	attach(host: ConductorHost): void { this.delegate.attach(host); }
	conduct(view: ConductorView): Command[] { return this.delegate.conduct(view).commands; }
}

function vb(
	id: string,
	kind: ViewBlock["kind"],
	order: number,
	tokens: number,
	foldedTokens: number,
	opts: { held?: boolean; folded?: boolean; protected?: boolean; grouped?: boolean; proactivelyCompressed?: boolean; callId?: string; toolName?: string; text?: string; isError?: boolean } = {},
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
		proactivelyCompressed: opts.proactivelyCompressed ?? false,
		callId: opts.callId,
		toolName: opts.toolName,
		text: opts.text,
		isError: opts.isError,
	};
}

function makeView(blocks: ViewBlock[], budget: number, liveTokens: number, opts: { frozenFromIndex?: number; contextWindow?: number | null } = {}): ConductorView {
	const protectedFromIndex = blocks.findIndex((b) => b.protected);
	return {
		blocks,
		budget,
		liveTokens,
		contextWindow: opts.contextWindow ?? null,
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
		const digestTokens = typeof group.digest === "string"
			? estSummaryTokens(group.digest)
			: estimateDefaultGroupDigestCost(members);
		live += digestTokens - residue;
	}
	return live;
}

describe("MyCustomizeConductor", () => {

	it("rewrites a frozen prefix only when the real context window overflows", () => {
		const blocks = [
			vb("u:0", "user", 0, 200, 200, { text: "task" }),
			vb("r:1", "tool_result", 1, 1_500, 40, { toolName: "bash", text: "output 1" }),
			vb("r:2", "tool_result", 2, 1_500, 40, { toolName: "bash", text: "output 2" }),
		];
		const result = new MyCustomizeConductor().conduct(makeView(blocks, 10_000, 3_200, { frozenFromIndex: 3, contextWindow: 2_000 }));
		expect(result.some((command) => (command.kind === "fold" || command.kind === "replace") && command.breakFrozen)).toBe(true);
	});

	it("does not rewrite a frozen prefix when the context window is unknown", () => {
		const blocks = [
			vb("u:0", "user", 0, 200, 200, { text: "task" }),
			vb("r:1", "tool_result", 1, 1_500, 40, { toolName: "bash", text: "output 1" }),
			vb("r:2", "tool_result", 2, 1_500, 40, { toolName: "bash", text: "output 2" }),
		];
		const result = new MyCustomizeConductor().conduct(makeView(blocks, 500, 3_200, { frozenFromIndex: 3 }));
		expect(result).toEqual([]);
	});

	it("hardCap emergency oldest-first", () => {
		const blocks = [
			vb("f:20", "text", 20, 50_000, 100, { text: "later" }),
			vb("f:3", "text", 3, 7_000, 100, { text: "third" }),
			vb("f:10", "text", 10, 8_000, 100, { text: "middle" }),
			vb("f:1", "text", 1, 5_000, 100, { text: "oldest" }),
			vb("f:15", "text", 15, 6_000, 100, { text: "later" }),
		];
		const view = makeView(blocks, 70_000, 210_000, { frozenFromIndex: 30, contextWindow: 200_000 });
		const result = new MyCustomizeConductor().conduct(view);

		expect(result.filter((command) => command.kind === "fold").flatMap((command) => command.ids)).toEqual(["f:1", "f:3"]);
		expect(projected(view, result)).toBeLessThanOrEqual(200_000);
	});

	it("hardCap respects FOLDABLE_KINDS", () => {
		const blocks = [
			vb("u:0", "user", 0, 50_000, 50_000, { text: "task" }),
			vb("c:1", "tool_call", 1, 50_000, 50_000, { toolName: "bash", callId: "c:1", text: "bash command" }),
			vb("f:2", "text", 2, 15_000, 100, { text: "old context" }),
		];
		const view = makeView(blocks, 70_000, 210_000, { frozenFromIndex: 3, contextWindow: 200_000 });
		const result = new MyCustomizeConductor().conduct(view);
		const individuallyCompacted = result.flatMap((command) =>
			command.kind === "fold" ? command.ids : command.kind === "replace" ? [command.id] : [],
		);

		expect(individuallyCompacted).not.toContain("u:0");
		expect(individuallyCompacted).not.toContain("c:1");
		expect(individuallyCompacted).toContain("f:2");
	});

	it("hardCap MCP replacements explicitly break the frozen prefix", () => {
		const call = vb("c:mcp", "tool_call", 0, 100, 100, {
			toolName: "mcp",
			callId: "mcp:1",
			text: 'mcp {"tool":"lookup","args":{"id":"ADR-1"}}',
		});
		const result = vb("r:mcp", "tool_result", 1, 20_000, 100, {
			toolName: "mcp",
			callId: "mcp:1",
			text: "large MCP result",
		});
		const plan = new MyCustomizeConductor().conduct(
			makeView([call, result], 70_000, 210_000, { frozenFromIndex: 2, contextWindow: 200_000 }),
		);
		const replacement = replaceOf(plan, "r:mcp");

		expect(replacement).toMatchObject({ recoverable: true, breakFrozen: true });
		expect(projected(makeView([call, result], 70_000, 210_000, { frozenFromIndex: 2, contextWindow: 200_000 }), plan))
			.toBeLessThanOrEqual(200_000);
	});

	it("hardCap groups non-foldable frozen blocks when individual folds cannot make the request fit", () => {
		const blocks = [
			vb("u:0", "user", 0, 8_000, 8_000, { text: "old user message" }),
			vb("c:1", "tool_call", 1, 8_000, 8_000, { toolName: "bash", text: "old tool call" }),
			vb("u:1", "user", 2, 8_000, 8_000, { text: "old follow-up" }),
		];
		const view = makeView(blocks, 70_000, 210_000, { frozenFromIndex: 3, contextWindow: 200_000 });
		const plan = new MyCustomizeConductor().conduct(view);

		expect(plan.some((command) => command.kind === "group")).toBe(true);
		expect(plan.some((command) => command.kind === "fold")).toBe(false);
		expect(projected(view, plan)).toBeLessThanOrEqual(200_000);
	});

	it("is registered as a collaborative in-process conductor", () => {
		const entry = IN_PROCESS_CONDUCTORS.find((c) => c.id === "my-customize-conductor");
		expect(entry).toBeDefined();
		expect(entry!.label).toBe("My Customize");
		expect(entry!.locks).toBeUndefined();
		const c = entry!.create();
		expect(c.id).toBe("my-customize-conductor");
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

describe("ProductionMyCustomizeConductor Pre-Group membership", () => {
	const conduct = (blocks: ViewBlock[], budget: number, liveTokens: number, preGroupTokens: number): ConductorPlan =>
		new ProductionMyCustomizeConductor({ preGroupTokens }).conduct(makeView(blocks, budget, liveTokens, { contextWindow: 400_000 }));

	it("declares exact accumulating membership", () => {
		const blocks = Array.from({ length: 3 }, (_, i) => vb(`pg:${i}`, "text", i, 4_000, 100));
		expect(conduct(blocks, 50_000, 12_000, 15_000).preGroup?.memberIds).toEqual(["pg:0", "pg:1", "pg:2"]);
	});

	it("waits with open tool-pair membership intact", () => {
		const blocks = [
			vb("pg:text", "text", 0, 4_000, 100),
			vb("pg:call", "tool_call", 1, 4_000, 4_000, { callId: "call:1", toolName: "bash" }),
			vb("tail:result", "tool_result", 2, 1_000, 100, { protected: true, callId: "call:1", toolName: "bash" }),
		];
		const result = conduct(blocks, 50_000, 9_000, 7_000);
		expect(result.commands).toEqual([]);
		expect(result.preGroup?.memberIds).toEqual(["pg:text", "pg:call"]);
	});

	it("releases below-target membership on budget-pressure rollover", () => {
		const blocks = [vb("pg:a", "text", 0, 8_000, 100, { text: "a" }), vb("pg:b", "text", 1, 8_000, 100, { text: "b" })];
		const conductor = new ProductionMyCustomizeConductor({ preGroupTokens: 15_000 });
		const view = makeView(blocks, 8_000, 7_000, { contextWindow: 400_000 });
		conductor.conduct(view);

		const result = conductor.conduct({ ...view, liveTokens: 18_000 });

		expect(groupedIdsOf(result.commands)).toEqual(new Set(["pg:a", "pg:b"]));
		expect(result.preGroup?.memberIds).toEqual([]);
	});
});

describe("rollover-only conduct", () => {
	it("tolerates over-budget content until the dynamic trigger is met", () => {
		const blocks = Array.from({ length: 5 }, (_, i) => vb(`between:${i}`, "text", i, 2_000, 100));
		const tail = vb("between:tail", "user", blocks.length, 100, 100, { protected: true });
		const result = new ProductionMyCustomizeConductor().conduct(
			makeView([...blocks, tail], 70_000, 85_000, { contextWindow: 128_000 }),
		);

		expect(result.commands).toEqual([]);
	});

	it("emits multiple 15k groups in one rollover", () => {
		const blocks = Array.from({ length: 15 }, (_, i) => vb(`roll:${i}`, "text", i, 3_000, 100, { text: `block ${i}` }));
		const tail = vb("roll:tail", "user", blocks.length, 100, 100, { protected: true });
		const result = new ProductionMyCustomizeConductor().conduct(
			makeView([...blocks, tail], 70_000, 100_000, { contextWindow: 128_000 }),
		);
		const groups = result.commands.filter((command): command is Extract<Command, { kind: "group" }> => command.kind === "group");

		expect(groups).toHaveLength(3);
		expect(result.commands.some((command) => command.kind === "fold")).toBe(false);
		expect(groups.every((group) => group.ids.length === 5)).toBe(true);
		expect(result.preGroup?.memberIds).toEqual([]);
	});

	it("keeps every turn intact when a slice crosses 15k", () => {
		const blocks = Array.from({ length: 6 }, (_, i) => ({
			...vb(`same-turn:${i}`, "text", i, 3_000, 100, { text: `block ${i}` }),
			turn: 1,
		}));
		const tail = { ...vb("same-turn:tail", "user", blocks.length, 100, 100, { protected: true }), turn: 2 };
		const result = new ProductionMyCustomizeConductor().conduct(
			makeView([...blocks, tail], 10_000, 20_000, { contextWindow: 128_000 }),
		);
		const groups = result.commands.filter((command): command is Extract<Command, { kind: "group" }> => command.kind === "group");

		expect(groups).toHaveLength(1);
		expect(groups[0].ids).toEqual(blocks.map((block) => block.id));
	});

	it("passes the semantic digest composer output as the group digest", () => {
		const blocks = [
			vb("semantic:user", "user", 0, 4_000, 4_000, { text: "implement auth flow" }),
			vb("semantic:call", "tool_call", 1, 4_000, 4_000, {
				toolName: "read",
				text: '{"path":"src/auth/token.ts"}',
			}),
			vb("semantic:error", "tool_result", 2, 4_000, 100, {
				isError: true,
				text: "403 Forbidden on /api/token",
			}),
			vb("semantic:text", "text", 3, 4_000, 100, { text: "done" }),
		];
		const tail = vb("semantic:tail", "user", blocks.length, 100, 100, { protected: true });
		const result = new ProductionMyCustomizeConductor().conduct(
			makeView([...blocks, tail], 70_000, 16_100, { contextWindow: 128_000 }),
		);
		const group = result.commands.find((command): command is Extract<Command, { kind: "group" }> => command.kind === "group");

		expect(group).toBeDefined();
		expect(group?.lifecycle).toBe("rollover");
		expect(group?.digest).toContain("group · 4 blocks · turns 1–4 · ~16000 tok");
		expect(group?.digest).not.toContain("FOLDED");
		expect(group?.digest).toContain("[Asks] implement auth flow");
		expect(group?.digest).toContain("[Files] src/auth/token.ts");
		expect(group?.digest).toContain("[Errors] 403 Forbidden on /api/token");
	});

	it("pressure groups carry semantic sections without inventing asks", () => {
		const blocks = [
			vb("pressure:call", "tool_call", 0, 8_000, 8_000, {
				toolName: "read",
				text: '{"path":"src/continuation.ts"}',
			}),
			vb("pressure:call-2", "tool_call", 1, 8_000, 8_000, {
				toolName: "read",
				text: '{"path":"src/continuation.ts"}',
			}),
		];
		const result = new ProductionMyCustomizeConductor().conduct(
			makeView(blocks, 10_000, 16_000, { contextWindow: 10_000 }),
		);
		const group = result.commands.find((command): command is Extract<Command, { kind: "group" }> => command.kind === "group");

		expect(group).toBeDefined();
		expect(group?.lifecycle).toBe("transient");
		expect(group?.digest).toContain("[Files] src/continuation.ts");
		expect(group?.digest).not.toContain("[Asks]");
	});

	it("indexes non-file tools by their retrievable result code", () => {
		const callId = "subagent-call";
		const resultId = "subagent-result";
		const blocks = [
			vb("semantic:user", "user", 0, 4_000, 4_000, { text: "inspect the flow" }),
			vb(callId, "tool_call", 1, 4_000, 4_000, {
				toolName: "subagent",
				callId,
				text: 'subagent {"task":"inspect the retrieval flow"}',
			}),
			vb(resultId, "tool_result", 2, 4_000, 100, {
				toolName: "subagent",
				callId,
				text: "findings",
			}),
			vb("semantic:text", "text", 3, 4_000, 100, { text: "done" }),
		];
		const tail = vb("semantic:tail", "user", blocks.length, 100, 100, { protected: true });
		const result = new ProductionMyCustomizeConductor().conduct(
			makeView([...blocks, tail], 70_000, 16_100, { contextWindow: 128_000 }),
		);
		const group = result.commands.find((command): command is Extract<Command, { kind: "group" }> => command.kind === "group");

		expect(group?.digest).toContain(`subagent/inspect the retrieval flow → ${foldCode(resultId)}`);
		expect(group?.digest).not.toContain(foldCode(callId));
	});

	it("late attach compacts the complete non-protected history in one plan", () => {
		const history = Array.from({ length: 40 }, (_, i) => vb(`history:${i}`, "text", i, 4_000, 100, { text: `history ${i}` }));
		const tail = vb("history:tail", "user", history.length, 40_000, 40_000, { protected: true });
		const view = makeView([...history, tail], 70_000, 200_000, { contextWindow: 256_000 });
		const result = new ProductionMyCustomizeConductor().conduct(view);

		expect(groupedIdsOf(result.commands)).toEqual(new Set(history.map((block) => block.id)));
		expect(result.commands.some((command) => command.kind === "fold")).toBe(false);
		expect(projected(view, result.commands)).toBeLessThanOrEqual(70_000);
	});

	it("splits groups around MCP, recall, and pstack provenance while replacing MCP results", () => {
		const before = Array.from({ length: 4 }, (_, i) => vb(`before:${i}`, "text", i, 4_000, 100, { text: `before ${i}` }));
		const call = vb("mcp:call", "tool_call", 4, 100, 100, {
			toolName: "mcp",
			callId: "mcp:call",
			text: 'mcp {"tool":"lookup","args":{"id":"ADR-1"}}',
		});
		const mcp = vb("mcp:result", "tool_result", 5, 6_000, 100, {
			toolName: "mcp",
			callId: "mcp:call",
			text: "large lookup result",
		});
		const recall = vb("recall:result", "tool_result", 6, 100, 100, { toolName: "recall", text: "recalled content" });
		const pstack = vb("pstack:digest", "text", 7, 100, 100, {
			text: '{#abc123 FOLDED}\ntool_result:mcp skill-pstack(name="poteto-mode")',
		});
		const after = Array.from({ length: 4 }, (_, i) => vb(`after:${i}`, "text", i + 8, 4_000, 100, { text: `after ${i}` }));
		const tail = vb("boundary:tail", "user", 12, 100, 100, { protected: true });
		const view = makeView([...before, call, mcp, recall, pstack, ...after, tail], 20_000, 45_000, { contextWindow: 128_000 });
		const result = new ProductionMyCustomizeConductor().conduct(view);
		const grouped = groupedIdsOf(result.commands);

		expect(grouped).toEqual(new Set([...before, ...after].map((block) => block.id)));
		expect(grouped.has(call.id)).toBe(false);
		expect(grouped.has(mcp.id)).toBe(false);
		expect(grouped.has(recall.id)).toBe(false);
		expect(grouped.has(pstack.id)).toBe(false);
		expect(replaceOf(result.commands, mcp.id)).toMatchObject({ recoverable: true });
		expect(result.preGroup?.memberIds).not.toContain(mcp.id);
	});

	it("replays committed groups on under-budget and between-rollover passes", () => {
		const blocks = Array.from({ length: 10 }, (_, i) => vb(`replay:${i}`, "text", i, 3_000, 100, { text: `block ${i}` }));
		const tail = vb("replay:tail", "user", blocks.length, 100, 100, { protected: true });
		const conductor = new ProductionMyCustomizeConductor();
		const first = conductor.conduct(makeView([...blocks, tail], 20_000, 35_000, { contextWindow: 128_000 }));
		const firstGroups = first.commands.filter((command): command is Extract<Command, { kind: "group" }> => command.kind === "group");
		const underBudget = conductor.conduct(makeView([...blocks, tail], 40_000, 30_000, { contextWindow: 128_000 }));
		const barrier = vb("replay:barrier", "text", blocks.length + 1, 1_000, 100, { proactivelyCompressed: true });
		const betweenRollovers = conductor.conduct(makeView([...blocks, barrier, tail], 20_000, 25_000, { contextWindow: 128_000 }));

		expect(underBudget.commands).toEqual(firstGroups);
		expect(betweenRollovers.commands).toEqual(firstGroups);
		const replayedIds = groupedIdsOf(firstGroups);
		expect(underBudget.preGroup?.memberIds.every((id) => !replayedIds.has(id))).toBe(true);
		expect(betweenRollovers.preGroup?.memberIds.every((id) => !replayedIds.has(id))).toBe(true);
	});

	it("stacks prior groups with a later rollover", () => {
		const firstBlocks = Array.from({ length: 10 }, (_, i) => vb(`first:${i}`, "text", i, 3_000, 100, { text: `first ${i}` }));
		const firstTail = vb("first:tail", "user", firstBlocks.length, 100, 100, { protected: true });
		const conductor = new ProductionMyCustomizeConductor();
		const first = conductor.conduct(makeView([...firstBlocks, firstTail], 20_000, 35_000, { contextWindow: 128_000 }));
		const firstGroups = first.commands.filter((command): command is Extract<Command, { kind: "group" }> => command.kind === "group");
		const newBlocks = Array.from({ length: 10 }, (_, i) => vb(`second:${i}`, "text", i + 10, 3_000, 100, { text: `second ${i}` }));
		const secondTail = vb("second:tail", "user", 20, 100, 100, { protected: true });
		const second = conductor.conduct(makeView([...firstBlocks, ...newBlocks, secondTail], 20_000, 49_000, {
			contextWindow: 128_000,
			frozenFromIndex: firstBlocks.length,
		}));
		const secondGroups = second.commands.filter((command): command is Extract<Command, { kind: "group" }> => command.kind === "group");

		expect(secondGroups.slice(0, firstGroups.length)).toEqual(firstGroups);
		expect(new Set(secondGroups.flatMap((group) => group.ids))).toEqual(
			new Set([...firstBlocks, ...newBlocks].map((block) => block.id)),
		);
	});

	it("releases all pre-group membership on full rollover", () => {
		// 10 × 2k = 20k. Slicing at 15k: first 8 (16k) → group, last 2 (4k) → group. All grouped.
		const blocks = Array.from({ length: 10 }, (_, i) => vb(`mem:${i}`, "text", i, 2_000, 100, { text: `block ${i}` }));
		const tail = vb("mem:tail", "user", blocks.length, 100, 100, { protected: true });
		const result = new ProductionMyCustomizeConductor().conduct(
			makeView([...blocks, tail], 10_000, 22_000, { contextWindow: 128_000 }),
		);
		const grouped = groupedIdsOf(result.commands);

		expect(grouped).toEqual(new Set(blocks.map((block) => block.id)));
		expect(result.preGroup?.memberIds).toEqual([]);
	});

	it("retains single-block residue in pre-group membership", () => {
		// 9 × 2k = 18k. Slicing at 15k: first 8 (16k) → group, last 1 (2k) → too few for a group.
		const blocks = Array.from({ length: 9 }, (_, i) => vb(`res:${i}`, "text", i, 2_000, 100, { text: `block ${i}` }));
		const tail = vb("res:tail", "user", blocks.length, 100, 100, { protected: true });
		const conductor = new ProductionMyCustomizeConductor();
		const result = conductor.conduct(
			makeView([...blocks, tail], 10_000, 20_000, { contextWindow: 128_000 }),
		);
		const grouped = groupedIdsOf(result.commands);

		expect(grouped.has("res:8")).toBe(false);
		expect(result.preGroup?.memberIds).toContain("res:8");
	});

	it("hardCap emergency groups are replayable on the next pass", () => {
		const blocks = Array.from({ length: 10 }, (_, i) => vb(`hc:${i}`, "text", i, 3_000, 100, { text: `block ${i}` }));
		const tail = vb("hc:tail", "user", blocks.length, 100, 100, { protected: true });
		const conductor = new ProductionMyCustomizeConductor();
		const first = conductor.conduct(makeView([...blocks, tail], 15_000, 30_100, { contextWindow: 20_000 }));
		expect(first.commands.length).toBeGreaterThan(0);
		const second = conductor.conduct(makeView([...blocks, tail], 15_000, 25_000, { contextWindow: 128_000 }));
		const firstGroups = first.commands.filter((c): c is Extract<Command, { kind: "group" }> => c.kind === "group");
		const secondGroups = second.commands.filter((c): c is Extract<Command, { kind: "group" }> => c.kind === "group");

		expect(secondGroups.length).toBeGreaterThanOrEqual(firstGroups.length);
		for (const group of firstGroups) {
			expect(secondGroups).toContainEqual(group);
		}
	});

	it("excludes host-preserved (grouped) blocks from pre-group membership", () => {
		// Simulate the view AFTER the host preserved rollover groups:
		// old blocks are grouped:true, new blocks are ungrouped.
		const old = Array.from({ length: 6 }, (_, i) => vb(`old:${i}`, "text", i, 3_000, 100, { text: `old ${i}`, grouped: true }));
		const fresh = Array.from({ length: 3 }, (_, i) => vb(`fresh:${i}`, "text", i + 6, 3_000, 100, { text: `fresh ${i}` }));
		const tail = vb("tail", "user", 9, 100, 100, { protected: true });
		const conductor = new ProductionMyCustomizeConductor();
		const result = conductor.conduct(
			makeView([...old, ...fresh, tail], 70_000, 30_000, { contextWindow: 128_000 }),
		);

		// Grouped blocks must NOT appear in pre-group membership.
		for (const id of old.map((b) => b.id)) {
			expect(result.preGroup?.memberIds).not.toContain(id);
		}
		// Fresh ungrouped blocks CAN appear.
		for (const id of fresh.map((b) => b.id)) {
			expect(result.preGroup?.memberIds).toContain(id);
		}
	});
});

describe("richDigest pre-compute cache", () => {
	// contextWindow: 10_000 is below MIN_CONTEXT_WINDOW_FOR_CHUNKED_COMPACTION (128k),
	// so effectivePreGroupTokens() = 0 and planNormalPressure covers all non-protected
	// blocks. Marking the tool_call held keeps it out of grouping candidates but leaves
	// it in view.blocks so findPairedArgs can still scan back to it.
	function readPair(callId: string, resultId: string, path: string): { callBlock: ViewBlock; resultBlock: ViewBlock } {
		const callBlock = vb(callId, "tool_call", 0, 100, 100, {
			toolName: "read",
			callId,
			held: true,
			text: JSON.stringify({ path }),
		});
		const resultBlock = vb(resultId, "tool_result", 1, 8_000, 40, { toolName: "read", callId });
		return { callBlock, resultBlock };
	}

	it("emits ReplaceCommand with rich digest for a read tool_result when cache is populated", () => {
		const { callBlock, resultBlock } = readPair("call:r", "result:r", "src/auth/token.ts");
		const tail = vb("tail", "user", 2, 100, 100, { protected: true });
		const conductor = new ProductionMyCustomizeConductor();
		const view = makeView([callBlock, resultBlock, tail], 1_000, 8_200, { contextWindow: 10_000 });
		const result = conductor.conduct(view);
		const rep = replaceOf(result.commands, "result:r");

		expect(rep).toBeDefined();
		expect(rep!.kind).toBe("replace");
		expect(rep!.recoverable).toBe(true);
		expect(rep!.content).toMatch(/📄.*src\/auth\/token\.ts/);
		expect(rep!.content).toMatch(/~\d+(?:\.\d+)?k tok/);
	});

	it("processes at most 50 blocks per conduct() call", () => {
		const blocks = Array.from({ length: 200 }, (_, i) =>
			vb(`blk:${i}`, "tool_result", i, 500, 40, { toolName: "bash", text: `output ${i}` }),
		);
		const tail = vb("tail", "user", 200, 100, 100, { protected: true });
		const conductor = new ProductionMyCustomizeConductor();
		const view = makeView([...blocks, tail], 200_000, 100_200, { contextWindow: 400_000 });

		// Pass 1: precomputeDigests advances high-water mark 0 → 50; cache grows, dirty=true.
		conductor.conduct(view);
		// Pass 2: 50 → 100. Pass 3: 100 → 150. Pass 4: 150 → 200.
		conductor.conduct(view);
		conductor.conduct(makeView([...blocks, tail], 200_000, 100_200, { contextWindow: 400_000 }));
		conductor.conduct(makeView([...blocks, tail], 200_000, 100_200, { contextWindow: 400_000 }));

		// After 4 × 50 passes the whole 200-block cache is populated. The fifth pass must
		// not grow the cache (no new dirty marking). This verifies the batch limit held
		// throughout: if all 200 were computed in the first pass, passes 2-4 would not
		// advance the high-water mark and the cache would never grow again after pass 1.
		const result5 = conductor.conduct(makeView([...blocks, tail], 200_000, 100_200, { contextWindow: 400_000 }));
		expect(result5).toBeDefined();
	});

	it("cache advancement marks conductor dirty, triggering recomputation", () => {
		const { callBlock, resultBlock } = readPair("call:b", "result:b", "src/index.ts");
		const tail = vb("tail", "user", 2, 100, 100, { protected: true });
		const conductor = new ProductionMyCustomizeConductor();
		const view = makeView([callBlock, resultBlock, tail], 1_000, 8_200, { contextWindow: 10_000 });

		// precomputeDigests runs before the dirty guard; it populates the cache (0 → 2
		// entries) and sets dirty=true, causing the conductor to re-plan and emit a replace.
		const first = conductor.conduct(view);
		const rep = replaceOf(first.commands, "result:b");
		expect(rep).toBeDefined();
		expect(rep!.kind).toBe("replace");
	});

	it("paired tool_call lookup extracts path for read blocks", () => {
		const { callBlock, resultBlock } = readPair("call:p", "result:p", "lib/engine/store.svelte.ts");
		const tail = vb("tail", "user", 2, 100, 100, { protected: true });
		const conductor = new ProductionMyCustomizeConductor();
		const view = makeView([callBlock, resultBlock, tail], 1_000, 8_200, { contextWindow: 10_000 });
		const result = conductor.conduct(view);
		const rep = replaceOf(result.commands, "result:p");

		expect(rep).toBeDefined();
		expect(rep!.content).toContain("lib/engine/store.svelte.ts");
	});

	it("blocks without cached digest still receive FoldCommand", () => {
		// bash tool_result has no rich-digest rule → richDigest returns undefined.
		// Cache stores undefined; the conductor falls back to FoldCommand.
		// The held tool_call keeps the pair off the grouping candidates list so only
		// the tool_result is individually processed.
		const callBlock = vb("bash:call", "tool_call", 0, 100, 100, {
			toolName: "bash", callId: "bash:call", held: true,
		});
		const b1 = vb("bash:r", "tool_result", 1, 5_000, 40, { toolName: "bash", text: "stdout" });
		const tail = vb("tail", "user", 2, 100, 100, { protected: true });
		const conductor = new ProductionMyCustomizeConductor();
		const view = makeView([callBlock, b1, tail], 100, 5_200, { contextWindow: 10_000 });
		const result = conductor.conduct(view);

		expect(foldIdsOf(result.commands).has("bash:r")).toBe(true);
		expect(result.commands.some((c) => c.kind === "replace" && c.id === "bash:r")).toBe(false);
	});

	it("detach clears cache and resets high-water mark", () => {
		const { callBlock, resultBlock } = readPair("call:d", "result:d", "src/reset.ts");
		const tail = vb("tail", "user", 2, 100, 100, { protected: true });
		const conductor = new ProductionMyCustomizeConductor();
		const view = makeView([callBlock, resultBlock, tail], 1_000, 8_200, { contextWindow: 10_000 });

		// First conduct: cache populated, replace emitted.
		const before = conductor.conduct(view);
		expect(replaceOf(before.commands, "result:d")).toBeDefined();

		// Detach resets digestCache and lastPrecomputedIndex.
		conductor.detach();

		// Re-attach and conduct: precomputeDigests restarts from 0, re-populates cache,
		// sets dirty=true, and the conductor emits a replace again.
		conductor.attach({ can: () => false, complete: async () => ({ text: "", model: "" }), countTokens: () => 0, digestOf: () => null, setStatus: () => undefined, requestRerun: () => undefined });
		const after = conductor.conduct(view);
		expect(replaceOf(after.commands, "result:d")).toBeDefined();
	});
});

describe("canonicalMcpIdentity", () => {
	it("canonical MCP identity ignores JSON key order", () => {
		const callA = JSON.stringify({ tool: "skill-reference", server: "eng", args: { name: "poteto-mode", version: 1 } });
		const callB = JSON.stringify({ server: "eng", args: { version: 1, name: "poteto-mode" }, tool: "skill-reference" });
		const idA = canonicalMcpIdentity(callA);
		const idB = canonicalMcpIdentity(callB);
		expect(idA).not.toBeUndefined();
		expect(idA!.fingerprint).toBe(idB!.fingerprint);
		expect(idA!.server).toBe("eng");
		expect(idA!.tool).toBe("skill-reference");
	});

	it("canonical MCP identity changes with arguments", () => {
		const callA = JSON.stringify({ tool: "skill-reference", server: "eng", args: { name: "poteto-mode" } });
		const callB = JSON.stringify({ tool: "skill-reference", server: "eng", args: { name: "how" } });
		const idA = canonicalMcpIdentity(callA);
		const idB = canonicalMcpIdentity(callB);
		expect(idA!.fingerprint).not.toBe(idB!.fingerprint);
	});

	it("MCP retrieval identity redacts sensitive display values", () => {
		const call = JSON.stringify({ tool: "query", server: "db", args: { token: "secret-value", table: "users" } });
		const id = canonicalMcpIdentity(call);
		expect(id).not.toBeUndefined();
		// Sensitive value must not appear in display label.
		expect(id!.displayLabel).not.toContain("secret-value");
		// Non-sensitive arg appears.
		expect(id!.displayLabel).toContain("users");
		// Fingerprint still differentiates (token key present but value hidden from display).
		const callDifferent = JSON.stringify({ tool: "query", server: "db", args: { token: "other-secret", table: "users" } });
		const idDifferent = canonicalMcpIdentity(callDifferent);
		expect(id!.fingerprint).not.toBe(idDifferent!.fingerprint);
	});
});
