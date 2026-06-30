/*
 * my-customize-conductor.ts — a mark-and-sweep conductor for agent sessions that folds
 * MCP tool results LAST, and into a recoverable, identity-bearing summary.
 *
 * Data shape:
 *   ViewBlock is the only input. A `tool_result` with toolName === "mcp" is an MCP call's
 *   output — often a loaded skill, principle, or other durable instruction context. Older
 *   versions PINNED those (never folded). This conductor instead lets them fold under real
 *   budget pressure, but only AFTER everything else, and via a `replace` whose body names
 *   the MCP call (server / tool / args) and is recoverable — so the agent can `unfold`/
 *   `recall` the original instead of re-calling MCP for the same thing.
 *
 * Ordering: non-MCP folds first (unreachable-first, then kind-rank, then age, the standard
 * GC order); MCP results are the last tier. The budget guarantee is the hard invariant —
 * reachability and the MCP tier are the ORDERING, never a veto.
 */
import type { Command, Conductor, ConductorView, ViewBlock } from "../contract";
import { FOLD_RANK } from "../builtin/builtin";
import { FOLDABLE_KINDS } from "../cold-score/score";
import { buildGraph, markReachable } from "../garbage-collector/edges";
import { isMcpResult, mcpSummary, estSummaryTokens } from "./mcp-summary";

export class MyCustomizeConductor implements Conductor {
	readonly id = "my-customize-conductor";
	readonly label = "My Customize";

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

		const callById = new Map<string, ViewBlock>();
		for (const b of view.blocks) {
			if (b.kind === "tool_call" && b.callId) callById.set(b.callId, b);
		}

		const candidates = view.blocks.filter(
			(b) =>
				!b.held &&
				!b.protected &&
				!b.grouped &&
				b.foldedTokens < b.tokens &&
				FOLDABLE_KINDS.has(b.kind),
		);

		const sorted = candidates.sort(
			(a, b) =>
				(isMcpResult(a) ? 1 : 0) - (isMcpResult(b) ? 1 : 0) ||
				(marked.has(a.id) ? 1 : 0) - (marked.has(b.id) ? 1 : 0) ||
				FOLD_RANK[a.kind] - FOLD_RANK[b.kind] ||
				a.order - b.order,
		);

		let live = view.liveTokens;
		const foldIds: string[] = [];
		const replaces: Command[] = [];
		for (const b of sorted) {
			if (live <= view.budget) break;
			if (isMcpResult(b)) {
				const summary = mcpSummary(b, b.callId ? callById.get(b.callId) : undefined);
				const substTokens = estSummaryTokens(summary);
				if (substTokens < b.tokens) {
					replaces.push({ kind: "replace", id: b.id, content: summary, recoverable: true });
					live -= b.tokens - substTokens;
					continue;
				}
			}
			foldIds.push(b.id);
			live += b.foldedTokens - b.tokens;
		}

		const cmds: Command[] = [...replaces];
		if (foldIds.length) cmds.push({ kind: "fold", ids: foldIds });
		return cmds;
	}
}
