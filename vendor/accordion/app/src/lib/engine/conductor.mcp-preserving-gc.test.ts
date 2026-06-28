import { describe, it, expect } from "vitest";
import { IN_PROCESS_CONDUCTORS, McpPreservingGcConductor } from "$conductors";
import type { Command, ConductorView, ViewBlock } from "$conductors/contract";

function vb(
	id: string,
	kind: ViewBlock["kind"],
	order: number,
	tokens: number,
	foldedTokens: number,
	opts: { held?: boolean; protected?: boolean; grouped?: boolean; callId?: string; toolName?: string; text?: string } = {},
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
	if (!result?.length || result[0].kind !== "fold") return new Set();
	return new Set(result[0].ids);
}

function projected(view: ConductorView, result: Command[] | null): number {
	let live = view.liveTokens;
	const ids = foldIdsOf(result);
	for (const b of view.blocks) {
		if (ids.has(b.id)) live += b.foldedTokens - b.tokens;
	}
	return live;
}

describe("McpPreservingGcConductor", () => {
	it("is registered as a collaborative in-process conductor", () => {
		const entry = IN_PROCESS_CONDUCTORS.find((c) => c.id === "mcp-preserving-gc");
		expect(entry).toBeDefined();
		expect(entry!.label).toBe("MCP-preserving GC");
		expect(entry!.locks).toBeUndefined();
		const c = entry!.create();
		expect(c.id).toBe("mcp-preserving-gc");
	});

	it("does not fold MCP tool results even under budget pressure", () => {
		const blocks = [
			vb("u:0", "user", 0, 200, 200, { text: "task" }),
			vb("r:mcp", "tool_result", 1, 1500, 40, { toolName: "mcp", text: "# Poteto mode\nimportant instruction" }),
			vb("r:bash", "tool_result", 2, 1500, 40, { toolName: "bash", text: "large noisy output" }),
			vb("a:1:p0", "thinking", 3, 1000, 40, { text: "thoughts" }),
		];
		const view = makeView(blocks, 2_500, 4_200);
		const result = new McpPreservingGcConductor().conduct(view);
		const folded = foldIdsOf(result);
		expect(folded.has("r:mcp")).toBe(false);
		expect(folded.has("r:bash") || folded.has("a:1:p0")).toBe(true);
		expect(projected(view, result)).toBeLessThanOrEqual(view.budget);
	});

	it("matches MCP tool names case-insensitively", () => {
		const blocks = [
			vb("u:0", "user", 0, 200, 200, { text: "task" }),
			vb("r:mcp", "tool_result", 1, 1500, 40, { toolName: "MCP", text: "# Poteto mode" }),
			vb("r:bash", "tool_result", 2, 1500, 40, { toolName: "bash", text: "large noisy output" }),
		];
		const view = makeView(blocks, 2_000, 3_200);
		const folded = foldIdsOf(new McpPreservingGcConductor().conduct(view));
		expect(folded.has("r:mcp")).toBe(false);
		expect(folded.has("r:bash")).toBe(true);
	});
});
