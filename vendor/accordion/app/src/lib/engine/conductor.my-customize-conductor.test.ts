import { describe, it, expect } from "vitest";
import { IN_PROCESS_CONDUCTORS, MyCustomizeConductor } from "$conductors";
import type { Command, ConductorView, ViewBlock } from "$conductors/contract";
import { estSummaryTokens } from "$conductors/my-customize-conductor/mcp-summary";

function vb(
	id: string,
	kind: ViewBlock["kind"],
	order: number,
	tokens: number,
	foldedTokens: number,
	opts: { held?: boolean; protected?: boolean; grouped?: boolean; callId?: string; toolName?: string; text?: string; isError?: boolean } = {},
): ViewBlock {
	return {
		id,
		kind,
		turn: order + 1,
		order,
		tokens,
		foldedTokens,
		held: opts.held ?? false,
		folded: false,
		protected: opts.protected ?? false,
		grouped: opts.grouped ?? false,
		callId: opts.callId,
		toolName: opts.toolName,
		text: opts.text,
		isError: opts.isError,
	};
}

function makeView(blocks: ViewBlock[], budget: number, liveTokens: number): ConductorView {
	const protectedFromIndex = blocks.findIndex((b) => b.protected);
	return {
		blocks,
		budget,
		liveTokens,
		contextWindow: null,
		protectedFromIndex: protectedFromIndex < 0 ? blocks.length : protectedFromIndex,
		protectTokens: 0,
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

	it("folds an MCP result into a recoverable, identity-bearing summary under heavy pressure", () => {
		const blocks = [
			vb("u:0", "user", 0, 200, 200, { text: "task" }),
			vb("c1", "tool_call", 1, 50, 50, {
				toolName: "mcp",
				callId: "c1",
				text: 'mcp {"server":"engineering-skills","tool":"skill-pstack","args":"{\\"name\\":\\"poteto-mode\\"}"}',
			}),
			vb("r:mcp", "tool_result", 2, 1500, 40, { toolName: "mcp", callId: "c1", text: "# Poteto mode\nline two\nline three" }),
		];
		const view = makeView(blocks, 300, 1_750);
		const result = new MyCustomizeConductor().conduct(view);

		const rep = replaceOf(result, "r:mcp");
		expect(rep, "MCP result is folded via a replace, not a plain fold").toBeDefined();
		expect(rep!.recoverable, "the summary is unfoldable").toBe(true);
		expect(rep!.content).toContain("engineering-skills/skill-pstack");
		expect(rep!.content).toContain('args {"name":"poteto-mode"}');
		expect(rep!.content).toContain("unfold to reuse");
		expect(foldIdsOf(result).has("r:mcp")).toBe(false);
		expect(projected(view, result)).toBeLessThanOrEqual(view.budget);
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
		expect(rep!.content.startsWith("mcp · mcp ·")).toBe(true);
		expect(projected(view, result)).toBeLessThanOrEqual(view.budget);
	});
});
