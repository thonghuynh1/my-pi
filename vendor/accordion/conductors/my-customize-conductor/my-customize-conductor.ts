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
const POTETO_MODE_NAME = "poteto-mode";
const POTETO_OFF_PHRASES = ["exit poteto mode", "stop using poteto", "disable pstack mode"];

type SavedFold = { tokens: number; breakFrozen: boolean };

export class MyCustomizeConductor implements Conductor {
	readonly id = "my-customize-conductor";
	readonly label = "My Customize";

	// Epoch gating state: the plan from the last pass and the per-block token savings it applies.
	// Cleared when the view fits within cap (no folding needed) or when the hold band is crossed.
	private lastPlan: Command[] | null = null;
	private lastSavings = new Map<string, SavedFold>(); // block id → tokens saved
	private lastSemanticKey: string | null = null;

	conduct(view: ConductorView): Command[] {
		// Fold toward the REAL available space (budget capped by window − harness − reply reserve,
		// then calibrated to real tokens), not the raw budget — else the true request overflows.
		const cap = availableCap(view);
		if (view.liveTokens <= cap) {
			this.lastPlan = null;
			this.lastSavings.clear();
			this.lastSemanticKey = null;
			return [];
		}

		// Build lookups used for semantic state, the epoch hold check, and savings recording.
		const byId = new Map(view.blocks.map((b) => [b.id, b]));
		const callById = new Map<string, ViewBlock>();
		for (const b of view.blocks) {
			if (b.kind === "tool_call" && b.callId) callById.set(b.callId, b);
		}
		const pstackByFoldCode = new Map<string, PstackIdentity>();
		const originalPstackByBlockId = new Map<string, PstackIdentity>();
		const pstackByBlockId = new Map<string, PstackIdentity>();
		for (const b of view.blocks) {
			if (isMcpResult(b)) {
				const identity = pstackIdentityFromMcpCall(b.callId ? callById.get(b.callId)?.text : undefined);
				if (identity) {
					originalPstackByBlockId.set(b.id, identity);
					pstackByBlockId.set(b.id, identity);
					pstackByFoldCode.set(foldCode(b.id), identity);
				}
			}
			const digestIdentity = pstackIdentityFromDigest(b.text);
			if (digestIdentity) {
				pstackByBlockId.set(b.id, digestIdentity.identity);
				if (!pstackByFoldCode.has(digestIdentity.code)) pstackByFoldCode.set(digestIdentity.code, digestIdentity.identity);
			}
		}
		for (const b of view.blocks) {
			if (!isRecallResult(b)) continue;
			const codes = b.callId ? recallCodes(callById.get(b.callId)?.text) : undefined;
			const identity = codes?.length === 1 ? pstackByFoldCode.get(codes[0]) : undefined;
			if (identity) pstackByBlockId.set(b.id, identity);
		}

		const allCandidates = view.blocks.filter(
			(b) => !b.held && !b.protected && !b.grouped && b.foldedTokens < b.tokens && FOLDABLE_KINDS.has(b.kind),
		);
		const candidates = allCandidates.filter((b) => b.order >= view.frozenFromIndex);
		const candidateIds = new Set(candidates.map((b) => b.id));
		let potetoModeActive = false;
		let newestPotetoBlock: ViewBlock | undefined;
		for (const b of [...view.blocks].sort((a, b) => a.order - b.order)) {
			const identity = pstackByBlockId.get(b.id);
			if (identity?.name === POTETO_MODE_NAME) newestPotetoBlock = b;
			if (isPotetoModeOffUserBlock(b)) potetoModeActive = false;
			if (originalPstackByBlockId.get(b.id)?.name === POTETO_MODE_NAME) potetoModeActive = true;
		}
		const beaconCarrierId = potetoModeActive && newestPotetoBlock && candidateIds.has(newestPotetoBlock.id) ? newestPotetoBlock.id : undefined;
		const semanticKey = `${potetoModeActive ? "active" : "inactive"}|${newestPotetoBlock?.id ?? "-"}|${beaconCarrierId ?? "-"}`;

		// Epoch hold: if re-applying the previous plan to the current view still lands within
		// HOLD_BAND × cap, return it unchanged — keeps the KV prefix stable. Semantic state changes
		// invalidate the hold so stale beacon text does not survive mode changes or newer poteto blocks.
		if (this.lastPlan !== null && this.lastSemanticKey === semanticKey) {
			let projectedHeld = view.liveTokens;
			for (const [id, saving] of this.lastSavings) {
				const b = byId.get(id);
				if (b && !b.held && !b.protected && !b.grouped) projectedHeld -= saving.tokens;
			}
			if (projectedHeld <= HOLD_BAND * cap) return this.lastPlan;
		}
		this.lastPlan = null;
		this.lastSavings.clear();
		this.lastSemanticKey = null;

		const roots: string[] = [];
		let firstUserSeen = false;
		for (const b of view.blocks) {
			const isFirstUser = !firstUserSeen && b.kind === "user";
			if (isFirstUser) firstUserSeen = true;
			if (b.protected || b.held || isFirstUser) roots.push(b.id);
		}
		const marked = markReachable(buildGraph(view.blocks), roots);

		// Scan each candidate's text once so the sort comparator doesn't redo it per comparison.
		const riskCount = new Map(allCandidates.map((b) => [b.id, riskFlags(b.text ?? "").length]));
		const sortCandidates = (items: ViewBlock[]): ViewBlock[] =>
			[...items].sort(
				(a, b) =>
					(isMcpResult(a) ? 1 : 0) - (isMcpResult(b) ? 1 : 0) ||
					(marked.has(a.id) ? 1 : 0) - (marked.has(b.id) ? 1 : 0) ||
					(riskCount.get(a.id) ?? 0) - (riskCount.get(b.id) ?? 0) ||
					FOLD_RANK[a.kind] - FOLD_RANK[b.kind] ||
					a.order - b.order,
			);

		let live = view.liveTokens;
		const foldIds: string[] = [];
		const breakFoldIds: string[] = [];
		const replaces: Command[] = [];
		const alreadyPlanned = new Set<string>();
		const applyCandidate = (b: ViewBlock, breakFrozen: boolean): void => {
			let summary: string | undefined;
			if (isMcpResult(b)) {
				summary = mcpSummary(b, b.callId ? callById.get(b.callId) : undefined, { potetoBeacon: b.id === beaconCarrierId });
			} else if (isRecallResult(b)) {
				const codes = b.callId ? recallCodes(callById.get(b.callId)?.text) : undefined;
				const identity = pstackByBlockId.get(b.id) ?? (codes?.length === 1 ? pstackByFoldCode.get(codes[0]) : undefined);
				summary = identity ? pstackRecallSummary(identity, { potetoBeacon: b.id === beaconCarrierId }) : genericRecallSummary(codes);
			}
			if (summary) {
				const substTokens = estSummaryTokens(summary);
				if (substTokens < b.tokens) {
					replaces.push({ kind: "replace", id: b.id, content: summary, recoverable: true, ...(breakFrozen ? { breakFrozen: true } : {}) });
					live -= b.tokens - substTokens;
					alreadyPlanned.add(b.id);
					return;
				}
			}
			(breakFrozen ? breakFoldIds : foldIds).push(b.id);
			live += b.foldedTokens - b.tokens;
			alreadyPlanned.add(b.id);
		};

		for (const b of sortCandidates(candidates)) {
			if (live <= cap) break;
			applyCandidate(b, false);
		}
		// If the unfrozen suffix cannot meet cap, deliberately break the cached prefix once.
		// This is cheaper than repeatedly returning an empty plan and sending raw context forever.
		if (live > cap) {
			for (const b of sortCandidates(allCandidates.filter((b) => b.order < view.frozenFromIndex && !alreadyPlanned.has(b.id)))) {
				if (live <= cap) break;
				applyCandidate(b, true);
			}
		}

		const cmds: Command[] = [...replaces];
		if (foldIds.length) cmds.push({ kind: "fold", ids: foldIds });
		if (breakFoldIds.length) cmds.push({ kind: "fold", ids: breakFoldIds, breakFrozen: true });

		// Record the plan and per-block savings for the next-pass epoch hold check.
		const savings = new Map<string, SavedFold>();
		for (const c of cmds) {
			if (c.kind === "fold") {
				for (const id of c.ids) {
					const b = byId.get(id);
					if (b) savings.set(id, { tokens: b.tokens - b.foldedTokens, breakFrozen: c.breakFrozen ?? false });
				}
			} else if (c.kind === "replace") {
				const b = byId.get(c.id);
				if (b) savings.set(c.id, { tokens: b.tokens - estSummaryTokens(c.content), breakFrozen: c.breakFrozen ?? false });
			}
		}
		this.lastPlan = cmds;
		this.lastSavings = savings;
		this.lastSemanticKey = semanticKey;


		return cmds;
	}
}

function isRecallResult(b: ViewBlock): boolean {
	return b.kind === "tool_result" && (b.toolName ?? "").trim().toLowerCase() === "recall";
}

function isPotetoModeOffUserBlock(b: ViewBlock): boolean {
	if (b.kind !== "user" || typeof b.text !== "string") return false;
	const text = b.text.toLowerCase();
	return POTETO_OFF_PHRASES.some((phrase) => text.includes(phrase));
}
