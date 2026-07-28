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
import type { Command, Conductor, ConductorHost, ConductorView, ViewBlock } from "../contract";
import { availableCap, contextWindowCap } from "../contract";
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
	toolResultSummary,
	type PstackIdentity,
} from "./mcp-summary";
import { riskFlags } from "../keel/ledger";
import * as chunkedCompaction from "./chunked-compaction";
import { DEFAULT_PRE_GROUP_TOKENS, humanTokens, PRE_GROUP_OVERFLOW_CAP } from "./constants";

export type { MyCustomizeConductorOpts } from "./chunked-compaction";

function isGroupBoundary(block: ViewBlock, pstackByBlockId: Map<string, PstackIdentity>): boolean {
	if (block.kind === "user" || block.held || block.protected || block.grouped) return true;
	const tool = (block.toolName ?? "").trim().toLowerCase();
	return tool === "mcp" || tool === "recall" || pstackByBlockId.has(block.id);
}

function isChunkedPreGroupBoundary(block: ViewBlock, pstackByBlockId: Map<string, PstackIdentity>): boolean {
	return block.proactivelyCompressed || isGroupBoundary(block, pstackByBlockId);
}

function isAccumulationBoundary(block: ViewBlock): boolean {
	return block.held || block.grouped || block.proactivelyCompressed;
}

/** Fraction of cap below which the current fold plan is held stable (epoch hold band). */
const HOLD_BAND = 0.9;
const POTETO_MODE_NAME = "poteto-mode";
const POTETO_OFF_PHRASES = ["exit poteto mode", "stop using poteto", "disable pstack mode"];

type SavedFold = { tokens: number; breakFrozen: boolean };

type ChunkedStatusMetrics = {
	preGroupTokens: number;
	preGroupFillPct: number;
	rolloverCount: number;
	tokensSavedByRollover: number;
	lastEstimatedGroupSaving: number;
	breakFrozenCount: number;
};

export const estimateDefaultGroupDigestCost = chunkedCompaction.estimateDefaultGroupDigestCost;

export class MyCustomizeConductor implements Conductor {
	readonly id = "my-customize-conductor";
	readonly label = "My Customize";

	// Epoch gating state: the plan from the last pass and the per-block token savings it applies.
	// Cleared when the view fits within cap (no folding needed) or when the hold band is crossed.
	private lastPlan: Command[] | null = null;
	private lastSavings = new Map<string, SavedFold>(); // block id → tokens saved
	private lastSemanticKey: string | null = null;
	private lastFrozenGroupEpochKey: string | null = null;
	private lastViewKey: string | null = null;
	private readonly opts: Required<chunkedCompaction.MyCustomizeConductorOpts>;
	private host: ConductorHost | null = null;
	private rolloverCount = 0;
	private tokensSavedByRollover = 0;
	private lastEstimatedGroupSaving = 0;
	/** Pre-group blocks needing restore, set per-conduct and consumed by finishConduct. */
	private pendingPreGroupRestore: string[] = [];

	constructor(opts: chunkedCompaction.MyCustomizeConductorOpts = {}) {
		this.opts = { preGroupTokens: opts.preGroupTokens ?? DEFAULT_PRE_GROUP_TOKENS };
	}

	attach(host: ConductorHost): void {
		this.host = host;
	}

	/**
	 * Return the previous non-rollover groups that can still be replayed after the host's
	 * conductor reset. Normally `clearConductorState()` removes mutable-suffix groups before
	 * this conductor gets its next view. That is correct for a complete replacement plan, but
	 * it is a bad fit for the pre-group fast/early-return paths: those paths intentionally return
	 * a rollover group and would otherwise make an older, still-valid suffix group flash open.
	 *
	 * Groups already visible in the view are owned by the store (chunked groups are preserved
	 * there), so they must not be replayed. A group that moved into the frozen prefix is only
	 * replayable when it carries an explicit digest; the host rejects an implicit digest there.
	 */
	private replayablePreviousGroups(
		view: ConductorView,
		excludedIds: ReadonlySet<string> = new Set(),
		priorPlan: Command[] | null = this.lastPlan,
	): Command[] {
		const groups = (priorPlan ?? []).filter((command): command is Extract<Command, { kind: "group" }> => command.kind === "group");
		if (groups.length === 0) return [];
		const byId = new Map(view.blocks.map((block) => [block.id, block]));
		return groups.filter((group) => {
			if (group.ids.length === 0 || group.ids.some((id) => excludedIds.has(id))) return false;
			return group.ids.every((id) => {
				const block = byId.get(id);
				if (!block || block.held || block.protected || block.grouped) return false;
				return block.order >= view.frozenFromIndex || typeof group.digest === "string" && group.digest.length > 0;
			});
		});
	}

	private rememberReplayableGroups(groups: Command[]): void {
		this.lastPlan = groups.length > 0 ? groups : null;
		this.lastSavings.clear();
		this.lastSemanticKey = null;
		this.lastFrozenGroupEpochKey = null;
		this.lastViewKey = null;
	}

	private finishConduct(
		plan: Command[],
		preGroupTokens: number,
		preGroupTarget: number,
		rolloverJustFired: boolean,
	): Command[] {
		if (this.host) {
			const preGroupFillPct = preGroupTarget === 0 ? 0 : Math.round((preGroupTokens / preGroupTarget) * 100);
			const metrics: ChunkedStatusMetrics = {
				preGroupTokens,
				preGroupFillPct,
				rolloverCount: this.rolloverCount,
				tokensSavedByRollover: this.tokensSavedByRollover,
				lastEstimatedGroupSaving: this.lastEstimatedGroupSaving,
				breakFrozenCount: this.rolloverCount,
			};
			const text = rolloverJustFired
				? `chunked · rollover · ${this.rolloverCount} rollover(s) · ${humanTokens(this.tokensSavedByRollover)} saved · pregroup ${preGroupTokens} → 0`
				: `chunked · ${preGroupFillPct}% pregroup · ${this.rolloverCount} rollovers · ${humanTokens(this.tokensSavedByRollover)} saved`;
			this.host.setStatus(text, metrics, null);
		}
		// Prepend restore for pre-group blocks that were folded while in the frozen prefix
		// (clearConductorState preserves those folds, but the pre-group contract is "full until grouped").
		const restoreIds = this.pendingPreGroupRestore;
		this.pendingPreGroupRestore = [];
		if (restoreIds.length > 0) {
			return [{ kind: "restore", ids: restoreIds }, ...plan];
		}
		return plan;
	}

	conduct(view: ConductorView): Command[] {
		// Fold toward the REAL available space (budget capped by window − harness − reply reserve,
		// then calibrated to real tokens), not the raw budget — else the true request overflows.
		const cap = availableCap(view);
		const hardCap = contextWindowCap(view);
		// Preserve the previous plan for early-return paths. The normal replan path clears
		// lastPlan before reaching those paths, but valid suffix groups may still need replay.
		const priorPlan = this.lastPlan;
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

		const preGroupTarget = chunkedCompaction.effectivePreGroupTokens(view, this.opts);
		const preGroupFromIndex = preGroupTarget > 0
			? chunkedCompaction.computePreGroupFromIndex(view, preGroupTarget, isAccumulationBoundary)
			: view.protectedFromIndex;
		const preGroupBlocks = view.blocks.slice(preGroupFromIndex, view.protectedFromIndex);
		const preGroupBlockIds = new Set(preGroupBlocks.map((b) => b.id));
		// Pre-group blocks that are currently folded (e.g. from a prior pass when they were in
		// the frozen prefix) must be actively restored — clearConductorState preserves folds in
		// the frozen range, but the pre-group contract is "never fold until grouped".
		const preGroupRestoreIds = preGroupBlocks
			.filter((b) => b.folded && !b.held && b.order < view.frozenFromIndex)
			.map((b) => b.id);
		this.pendingPreGroupRestore = preGroupRestoreIds;
		let preGroupTokens = 0;
		// Helper: attempt to emit a GROUP command from a candidate block list.
		// Defined at method scope so the early rollover check (DEC-002) after the main fold
		// loop can call it in addition to the pre-group fast path inside the block below.
		const tryEmitGroup = (candidates: readonly ViewBlock[]): Command[] | null => {
			const ids = chunkedCompaction.trimOpenToolPairs(candidates.map((b) => b.id), view.blocks);
			if (ids.length < 2) return null;
			const members = view.blocks.filter((b) => ids.includes(b.id));
			const digestCost = chunkedCompaction.estimateDefaultGroupDigestCost(members);
			const trimmedTokens = members.reduce((sum, b) => sum + b.tokens, 0);
			const estimatedGroupSaving = trimmedTokens - digestCost;
			const minSaving = Math.max(2_000, 0.05 * cap);
			if (estimatedGroupSaving < minSaving) return null;
			const turnRange: [number, number] = [
				Math.min(...members.map((b) => b.turn)),
				Math.max(...members.map((b) => b.turn)),
			];
			const mcpIndex = chunkedCompaction.buildMcpRetrievalIndex(members, callById);
			const baseDigest = chunkedCompaction.composeDigest(
				chunkedCompaction.digestHeader(chunkedCompaction.corpusContentHash(members), ids.length, turnRange),
				chunkedCompaction.digestBody(members),
				chunkedCompaction.digestMembersFooter(ids.map(foldCode)),
			);
			const digest = mcpIndex ? baseDigest + "\n\n" + mcpIndex : baseDigest;
			this.rolloverCount += 1;
			this.tokensSavedByRollover += estimatedGroupSaving;
			this.lastEstimatedGroupSaving = estimatedGroupSaving;
			return [{ kind: "group", ids, digest }];
		};
		if (preGroupTarget > 0) {
			preGroupTokens = preGroupBlocks.reduce((sum, block) => sum + block.tokens, 0);
			const nextBlock = view.blocks[view.protectedFromIndex];
			const preGroupEndsOnTurnBoundary = nextBlock?.kind === "user" || view.protectedFromIndex === view.blocks.length;
			const noOpen = chunkedCompaction.noOpenToolPairAcrossPreGroupTail(view, preGroupFromIndex);
			const fastPathFires = preGroupTokens >= preGroupTarget && preGroupEndsOnTurnBoundary && noOpen;
			const escapeValveFires = preGroupTokens > preGroupTarget * PRE_GROUP_OVERFLOW_CAP;

			if (fastPathFires || escapeValveFires) {
				// Use selectCompactionRange to form the contiguous member list (keeps complete turns
				// together; includes user/MCP/recall blocks that the pre-group boundary excluded).
				const range = chunkedCompaction.selectCompactionRange(view, preGroupFromIndex);
				const candidates = range
					? view.blocks.slice(range.fromIndex, range.toIndexExclusive)
					: preGroupBlocks;
				const cmds = tryEmitGroup(candidates);
				if (cmds) {
					const newIds = new Set(cmds.flatMap((command) => command.kind === "group" ? command.ids : []));
					const retained = this.replayablePreviousGroups(view, newIds);
					this.rememberReplayableGroups(retained);
					return this.finishConduct([...retained, ...cmds], preGroupTokens, preGroupTarget, true);
				}
			}

			// If the traditional pre-group trigger did not fire (e.g. because MCP results
			// stopped the pre-group boundary walk), try a broader selectCompactionRange from
			// the frozen boundary — it includes user/MCP/recall/pstack blocks in complete turns.
			if (!fastPathFires && !escapeValveFires) {
				const range = chunkedCompaction.selectCompactionRange(view, view.frozenFromIndex);
				if (range) {
					const rangeBlocks = view.blocks.slice(range.fromIndex, range.toIndexExclusive);
					const rangeTokens = rangeBlocks.reduce((sum, b) => sum + b.tokens, 0);
					const rangeNoOpen = chunkedCompaction.noOpenToolPairAcrossPreGroupTail(view, range.fromIndex);
					const altFast = rangeTokens >= preGroupTarget && rangeNoOpen;
					const altEscape = rangeTokens > preGroupTarget * PRE_GROUP_OVERFLOW_CAP;
					if (altFast || altEscape) {
						const cmds = tryEmitGroup(rangeBlocks);
						if (cmds) {
							const newIds = new Set(cmds.flatMap((command) => command.kind === "group" ? command.ids : []));
							const retained = this.replayablePreviousGroups(view, newIds);
							this.rememberReplayableGroups(retained);
							return this.finishConduct([...retained, ...cmds], rangeTokens, preGroupTarget, true);
						}
					}
				}
			}
		}

		if (view.liveTokens <= cap) {
			// A previous suffix group may have been removed by the host reset even though the
			// current baseline is now under budget (for example, preserved frozen folds absorb
			// the pressure). Keep that group stable instead of briefly exposing the whole range.
			const retained = this.replayablePreviousGroups(view);
			if (retained.length > 0) {
				this.rememberReplayableGroups(retained);
				return this.finishConduct(retained, preGroupTokens, preGroupTarget, false);
			}
			this.lastPlan = null;
			this.lastSavings.clear();
			this.lastSemanticKey = null;
			this.lastFrozenGroupEpochKey = null;
			this.lastViewKey = null;
			return this.finishConduct([], preGroupTokens, preGroupTarget, false);
		}

		const allCandidates = view.blocks.filter(
			(b) => !b.held && !b.protected && !b.grouped && b.foldedTokens < b.tokens && FOLDABLE_KINDS.has(b.kind) && !preGroupBlockIds.has(b.id),
		);
		const candidates = allCandidates.filter(
			(b) => b.order >= view.frozenFromIndex && !b.proactivelyCompressed,
		);
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
		const viewKey = JSON.stringify([
			view.liveTokens,
			view.budget,
			view.contextWindow,
			view.frozenFromIndex,
			...view.blocks.map((b) => [b.id, b.kind, b.order, b.tokens, b.foldedTokens, b.held, b.folded, b.protected, b.grouped, b.toolName, b.callId]),
		]);

		// Epoch hold: if re-applying the previous plan to the current view still lands within
		// HOLD_BAND × cap, return it unchanged — keeps the KV prefix stable. Semantic state changes
		// invalidate the hold so stale beacon text does not survive mode changes or newer poteto blocks.
		if (this.lastSemanticKey !== null && this.lastSemanticKey !== semanticKey) this.lastFrozenGroupEpochKey = null;
		if (this.lastPlan !== null && this.lastSemanticKey === semanticKey && this.lastViewKey === viewKey) {
			return this.finishConduct(this.lastPlan, preGroupTokens, preGroupTarget, false);
		}
		if (this.lastPlan !== null && this.lastSemanticKey === semanticKey) {
			let projectedHeld = view.liveTokens;
			for (const [id, saving] of this.lastSavings) {
				const b = byId.get(id);
				if (b && !b.held && !b.protected && !b.grouped) projectedHeld -= saving.tokens;
			}
			if (projectedHeld <= HOLD_BAND * cap) {
				return this.finishConduct(this.lastPlan, preGroupTokens, preGroupTarget, false);
			}
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
		const plannedContribution = new Map(view.blocks.map((b) => [b.id, b.tokens]));
		const alreadyPlanned = new Set<string>();
		const applyCandidate = (b: ViewBlock, breakFrozen: boolean): void => {
			let summary: string | undefined;
			if (isMcpResult(b)) {
				summary = mcpSummary(b, b.callId ? callById.get(b.callId) : undefined, { potetoBeacon: b.id === beaconCarrierId });
			} else if (isRecallResult(b)) {
				const codes = b.callId ? recallCodes(callById.get(b.callId)?.text) : undefined;
				const identity = pstackByBlockId.get(b.id) ?? (codes?.length === 1 ? pstackByFoldCode.get(codes[0]) : undefined);
				summary = identity ? pstackRecallSummary(identity, { potetoBeacon: b.id === beaconCarrierId, resultId: b.id }) : genericRecallSummary(codes);
			} else {
				summary = toolResultSummary(b, b.callId ? callById.get(b.callId) : undefined);
			}
			if (summary) {
				const substTokens = estSummaryTokens(summary);
				if (substTokens < b.tokens) {
					replaces.push({ kind: "replace", id: b.id, content: summary, recoverable: true, ...(breakFrozen ? { breakFrozen: true } : {}) });
					live -= b.tokens - substTokens;
					plannedContribution.set(b.id, substTokens);
					alreadyPlanned.add(b.id);
					return;
				}
			}
			(breakFrozen ? breakFoldIds : foldIds).push(b.id);
			live += b.foldedTokens - b.tokens;
			plannedContribution.set(b.id, b.foldedTokens);
			alreadyPlanned.add(b.id);
		};

		for (const b of sortCandidates(candidates)) {
			if (live <= cap) break;
			applyCandidate(b, false);
		}
		// Only a real context-window overflow may reset the cached prefix.
		if (live > hardCap) {
			for (const b of sortCandidates(allCandidates.filter((b) => b.order < view.frozenFromIndex && !alreadyPlanned.has(b.id)))) {
				if (live <= hardCap) break;
				applyCandidate(b, true);
			}
		}

		// Early rollover: flush pre-group zone under budget pressure (DEC-002).
		if (live > cap && preGroupBlocks.length >= 2) {
			const range = chunkedCompaction.selectCompactionRange(view, preGroupFromIndex);
			const earlyCandidates = range
				? view.blocks.slice(range.fromIndex, range.toIndexExclusive)
				: preGroupBlocks;
			const cmds = tryEmitGroup(earlyCandidates);
			if (cmds) {
				const newIds = new Set(cmds.flatMap((command) => command.kind === "group" ? command.ids : []));
				const retained = this.replayablePreviousGroups(view, newIds, priorPlan);
				this.rememberReplayableGroups(retained);
				return this.finishConduct([...retained, ...cmds], preGroupTokens, preGroupTarget, true);
			}
		}

		// Group only the non-frozen suffix, and only after all rich replacements and folds are planned.
		const groups: Command[] = [];
		const groupedIds = new Set<string>();
		const groupRuns = (blocks: ViewBlock[], shouldInclude: (block: ViewBlock) => boolean): ViewBlock[][] => {
			const runs: ViewBlock[][] = [];
			let run: ViewBlock[] = [];
			const flush = (): void => {
				if (run.length >= 2) runs.push(run);
				run = [];
			};
			for (const block of blocks) {
				if (!shouldInclude(block) || isGroupBoundary(block, pstackByBlockId)) flush();
				else run.push(block);
			}
			flush();
			return runs;
		};
		const emitGroup = (run: ViewBlock[]): number => {
			const residue = run.reduce((total, block) => total + (plannedContribution.get(block.id) ?? block.tokens), 0);
			const saving = residue - chunkedCompaction.estimateDefaultGroupDigestCost(run);
			if (saving <= 0) return 0;
			groups.push({ kind: "group", ids: run.map((block) => block.id) });
			for (const block of run) groupedIds.add(block.id);
			live -= saving;
			return saving;
		};

		if (live > cap) {
			for (const run of groupRuns(view.blocks, (block) => block.order >= view.frozenFromIndex && !preGroupBlockIds.has(block.id))) {
				if (live <= cap) break;
				emitGroup(run);
			}
		}

		// Frozen grouping is a rare pressure valve. Gather all eligible frozen savings before
		// emitting any of them so one cache-invalidating rewrite is worth the threshold.
		if (live > hardCap) {
			const frozenRuns = groupRuns(view.blocks, (block) => block.order < view.frozenFromIndex);
			const savings = frozenRuns.map((run) => ({ run, saving: run.reduce((total, block) => total + (plannedContribution.get(block.id) ?? block.tokens), 0) - chunkedCompaction.estimateDefaultGroupDigestCost(run) }));
			const frozenEpochKey = savings.map(({ run }) => run.map((block) => `${block.id}:${plannedContribution.get(block.id) ?? block.tokens}`).join(",")).join("|");
			const totalFrozenSaving = savings.reduce((total, candidate) => total + Math.max(0, candidate.saving), 0);
			const threshold = Math.max(2_000, 0.05 * cap);
			if (frozenEpochKey !== this.lastFrozenGroupEpochKey && totalFrozenSaving >= threshold) {
				const emittedRuns: ViewBlock[][] = [];
				for (const candidate of savings) {
					if (live <= hardCap) break;
					if (candidate.saving > 0) {
						emitGroup(candidate.run);
						emittedRuns.push(candidate.run);
					}
				}
				if (emittedRuns.length > 0) this.lastFrozenGroupEpochKey = frozenEpochKey;
			}
		}

		const plannedReplaces = replaces.filter(
			(command): command is Extract<Command, { kind: "replace" }> => command.kind === "replace" && !groupedIds.has(command.id),
		);
		const plannedFoldIds = foldIds.filter((id) => !groupedIds.has(id));
		const plannedBreakFoldIds = breakFoldIds.filter((id) => !groupedIds.has(id));
		const cmds: Command[] = [...plannedReplaces, ...groups];
		if (plannedFoldIds.length) cmds.push({ kind: "fold", ids: plannedFoldIds });
		if (plannedBreakFoldIds.length) cmds.push({ kind: "fold", ids: plannedBreakFoldIds, breakFrozen: true });

		// Record the plan and per-block savings for the next-pass epoch hold check.
		const savings = new Map<string, SavedFold>();
		for (const c of cmds) {
			if (c.kind === "group") {
				const firstId = c.ids[0];
				if (firstId) {
					const members = c.ids.map((id) => byId.get(id)).filter((b): b is ViewBlock => b !== undefined);
					const originalResidue = members.reduce((total, block) => total + block.tokens, 0);
					const saving = originalResidue - chunkedCompaction.estimateDefaultGroupDigestCost(members);
					savings.set(firstId, { tokens: Math.max(0, saving), breakFrozen: false });
				}
			} else if (c.kind === "fold") {
				for (const id of c.ids) {
					const b = byId.get(id);
					if (b) savings.set(id, { tokens: b.tokens - b.foldedTokens, breakFrozen: c.breakFrozen ?? false });
				}
			} else if (c.kind === "replace") {
				const b = byId.get(c.id);
				if (b && !groupedIds.has(c.id)) savings.set(c.id, { tokens: b.tokens - estSummaryTokens(c.content), breakFrozen: c.breakFrozen ?? false });
			}
		}
		if (live <= hardCap) this.lastFrozenGroupEpochKey = null;
		this.lastPlan = cmds;
		this.lastSavings = savings;
		this.lastSemanticKey = semanticKey;
		this.lastViewKey = viewKey;

		return this.finishConduct(cmds, preGroupTokens, preGroupTarget, false);
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
