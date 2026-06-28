/*
 * mcp-preserving-gc.ts — a mark-and-sweep conductor for agent sessions that keeps
 * MCP tool results live.
 *
 * Data shape:
 *   ViewBlock is the only input. A block may be a tool_result with toolName === "mcp";
 *   those blocks often contain loaded skills, principles, or other durable instruction
 *   context. This conductor treats those MCP results as non-candidates, then
 *   garbage-collects the rest using the same reachability graph as the standard GC.
 */
import type { Command, Conductor, ConductorView, ViewBlock } from "../contract";
import { FOLD_RANK } from "../builtin/builtin";
import { FOLDABLE_KINDS } from "../cold-score/score";
import { buildGraph, markReachable } from "../garbage-collector/edges";

function normalizedToolName(b: ViewBlock): string {
	return (b.toolName ?? "").trim().toLowerCase();
}

export function isProtectedMcpResult(b: ViewBlock): boolean {
	return b.kind === "tool_result" && normalizedToolName(b) === "mcp";
}

export class McpPreservingGcConductor implements Conductor {
	readonly id = "mcp-preserving-gc";
	readonly label = "MCP-preserving GC";

	conduct(view: ConductorView): Command[] {
		if (view.liveTokens <= view.budget) return [];

		const roots: string[] = [];
		let firstUserSeen = false;
		for (const b of view.blocks) {
			const isFirstUser = !firstUserSeen && b.kind === "user";
			if (isFirstUser) firstUserSeen = true;
			if (b.protected || b.held || isFirstUser) roots.push(b.id);
		}
		const marked = markReachable(buildGraph(view.blocks), roots);

		const candidates = view.blocks.filter(
			(b) =>
				!b.held &&
				!b.protected &&
				!b.grouped &&
				!isProtectedMcpResult(b) &&
				b.foldedTokens < b.tokens &&
				FOLDABLE_KINDS.has(b.kind),
		);

		const sorted = candidates.sort(
			(a, b) =>
				(marked.has(a.id) ? 1 : 0) - (marked.has(b.id) ? 1 : 0) ||
				FOLD_RANK[a.kind] - FOLD_RANK[b.kind] ||
				a.order - b.order,
		);

		let live = view.liveTokens;
		const ids: string[] = [];
		for (const b of sorted) {
			if (live <= view.budget) break;
			ids.push(b.id);
			live += b.foldedTokens - b.tokens;
		}
		return ids.length ? [{ kind: "fold", ids }] : [];
	}
}
