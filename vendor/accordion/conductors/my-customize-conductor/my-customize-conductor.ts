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
 * Ordering: non-MCP folds first (unreachable-first, then risk-sparse-first, then kind-rank,
 * then age); MCP results are the last tier. The budget guarantee is the hard invariant —
 * reachability and the MCP tier are the ORDERING, never a veto.
 *
 * Epoch gating: if the previous fold plan, re-applied to the current view, would hold live
 * tokens to ≤ 0.9 × cap, the plan is returned unchanged. This keeps the KV prefix stable
 * across passes where nothing meaningful has changed.
 */
import type { Command, Conductor, ConductorView, ViewBlock } from "../contract";
import { availableCap } from "../contract";
import { FOLD_RANK } from "../builtin/builtin";
import { FOLDABLE_KINDS } from "../cold-score/score";
import { buildGraph, markReachable } from "../garbage-collector/edges";
import {
	estSummaryTokens,
	foldCode,
	genericRecallSummary,
	isMcpResult,
	mcpSummary,
	pstackIdentityFromDigest,
	pstackIdentityFromMcpCall,
	pstackRecallSummary,
	recallCodes,
	type PstackIdentity,
} from "./mcp-summary";
import { riskFlags } from "../keel/ledger";

/** Fraction of cap below which the current fold plan is held stable (epoch hold band). */
const HOLD_BAND = 0.9;

export class MyCustomizeConductor implements Conductor {
	readonly id = "my-customize-conductor";
	readonly label = "My Customize";

	// Epoch gating state: the plan from the last pass and the per-block token savings it applies.
	// Cleared when the view fits within cap (no folding needed) or when the hold band is crossed.
	private lastPlan: Command[] | null = null;
	private lastSavings = new Map<string, number>(); // block id → tokens saved

	conduct(view: ConductorView): Command[] {
		// Fold toward the REAL available space (budget capped by window − harness − reply reserve,
		// then calibrated to real tokens), not the raw budget — else the true request overflows.
		const cap = availableCap(view);
		if (view.liveTokens <= cap) {
			this.lastPlan = null;
			this.lastSavings.clear();
			return [];
		}

		// Build a lookup used for both the epoch hold check and the savings record below.
		const byId = new Map(view.blocks.map((b) => [b.id, b]));

		// Epoch hold: if re-applying the previous plan to the current view still lands within
		// HOLD_BAND × cap, return it unchanged — keeps the KV prefix stable.
		if (this.lastPlan !== null) {
			let projectedHeld = view.liveTokens;
			for (const [id, saving] of this.lastSavings) {
				const b = byId.get(id);
				if (b && !b.held && !b.protected && !b.grouped && b.order >= view.frozenFromIndex) projectedHeld -= saving;
			}
			if (projectedHeld <= HOLD_BAND * cap) return this.lastPlan;
			this.lastPlan = null;
			this.lastSavings.clear();
		}

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
		const pstackByFoldCode = new Map<string, PstackIdentity>();
		for (const b of view.blocks) {
			if (isMcpResult(b)) {
				const identity = pstackIdentityFromMcpCall(b.callId ? callById.get(b.callId)?.text : undefined);
				if (identity) pstackByFoldCode.set(foldCode(b.id), identity);
			}
			const digestIdentity = pstackIdentityFromDigest(b.text);
			if (digestIdentity && !pstackByFoldCode.has(digestIdentity.code)) {
				pstackByFoldCode.set(digestIdentity.code, digestIdentity.identity);
			}
		}

		const candidates = view.blocks.filter(
			(b) =>
				!b.held &&
				!b.protected &&
				!b.grouped &&
				b.order >= view.frozenFromIndex &&
				b.foldedTokens < b.tokens &&
				FOLDABLE_KINDS.has(b.kind),
		);

		// Scan each candidate's text once so the sort comparator doesn't redo it per comparison.
		const riskCount = new Map(candidates.map((b) => [b.id, riskFlags(b.text ?? "").length]));

		const sorted = [...candidates].sort(
			(a, b) =>
				(isMcpResult(a) ? 1 : 0) - (isMcpResult(b) ? 1 : 0) ||
				(marked.has(a.id) ? 1 : 0) - (marked.has(b.id) ? 1 : 0) ||
				(riskCount.get(a.id) ?? 0) - (riskCount.get(b.id) ?? 0) ||
				FOLD_RANK[a.kind] - FOLD_RANK[b.kind] ||
				a.order - b.order,
		);

		let live = view.liveTokens;
		const foldIds: string[] = [];
		const replaces: Command[] = [];
		for (const b of sorted) {
			if (live <= cap) break;
			let summary: string | undefined;
			if (isMcpResult(b)) {
				summary = mcpSummary(b, b.callId ? callById.get(b.callId) : undefined);
			} else if (isRecallResult(b)) {
				const codes = b.callId ? recallCodes(callById.get(b.callId)?.text) : undefined;
				const identity = codes?.length === 1 ? pstackByFoldCode.get(codes[0]) : undefined;
				summary = identity ? pstackRecallSummary(identity) : genericRecallSummary(codes);
			}
			if (summary) {
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

		// Record the plan and per-block savings for the next-pass epoch hold check.
		const savings = new Map<string, number>();
		for (const c of cmds) {
			if (c.kind === "fold") {
				for (const id of c.ids) {
					const b = byId.get(id);
					if (b) savings.set(id, b.tokens - b.foldedTokens);
				}
			} else if (c.kind === "replace") {
				const b = byId.get(c.id);
				if (b) savings.set(c.id, b.tokens - estSummaryTokens(c.content));
			}
		}
		this.lastPlan = cmds;
		this.lastSavings = savings;

		return cmds;
	}
}

function isRecallResult(b: ViewBlock): boolean {
	return b.kind === "tool_result" && (b.toolName ?? "").trim().toLowerCase() === "recall";
}
