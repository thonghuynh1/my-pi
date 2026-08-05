/* Rollover-only conductor. It accumulates a dynamic pre-group window, then emits one
 * cache-invalidating batch of turn-aligned groups and MCP replacements.
 *
 * DEC-001: Rollover skips leading held blocks so a user fold at the frozen prefix
 *          doesn't collapse the compaction range to zero.
 * DEC-002: Stable plan with dirty triggers — conduct() short-circuits when nothing
 *          material changed, avoiding cache-thrashing ungroup-then-regroup cycles.
 * DEC-003: O(1) dirty detection via markDirty() from the store, not O(n) scanning.
 */
import type { Command, Conductor, ConductorHost, ConductorPlan, ConductorView, ViewBlock } from "../contract";
import { availableCap, contextWindowCap } from "../contract";
import { FOLDABLE_KINDS } from "../cold-score/score";
import {
	estSummaryTokens,
	foldCode,
	isMcpResult,
	mcpSummary,
	pstackIdentityFromDigest,
} from "./mcp-summary";
import * as chunkedCompaction from "./chunked-compaction";
import { DEFAULT_PRE_GROUP_TOKENS, MAX_DYNAMIC_PRE_GROUP_TOKENS, humanTokens } from "./constants";

export type { MyCustomizeConductorOpts } from "./chunked-compaction";

type GroupCommand = Extract<Command, { kind: "group" }>;
type PlannedGroup = { command: GroupCommand; saving: number };

type RolloverBlockedReason =
	| "inactive"
	| "under-cap"
	| "below-target"
	| "open-tool-pair"
	| "eligible"
	| "none"
	| "stable-plan"
	| "no-group-produced"
	| "mcp-recovery"
	| "hard-cap-emergency"
	| "exhausted";

type RolloverDiagnostics = {
	newPreGroupTokens: number;
	rolloverBlockedReason: RolloverBlockedReason;
};

type ChunkedStatusMetrics = {
	preGroupTokens: number;
	preGroupTargetTokens: number;
	preGroupFillPct: number;
	preGroupPhase: "inactive" | "accumulating" | "waiting-safe-rollover" | "rolled-over";
	newPreGroupTokens: number;
	rolloverBlockedReason: RolloverBlockedReason;
	rolloverCount: number;
	tokensSavedByRollover: number;
	lastEstimatedGroupSaving: number;
	breakFrozenCount: number;
};

function rolloverBlockedReason(
	liveTokens: number,
	cap: number,
	preGroupTarget: number,
	newPreGroupTokens: number,
	pairSafe: boolean,
): RolloverBlockedReason {
	if (preGroupTarget <= 0) return "inactive";
	if (liveTokens <= cap) return "under-cap";
	if (newPreGroupTokens < preGroupTarget) return "below-target";
	return pairSafe ? "eligible" : "open-tool-pair";
}

function isAccumulationBoundary(block: ViewBlock): boolean {
	return block.held || block.folded || block.proactivelyCompressed;
}

function isRolloverGroupBoundary(block: ViewBlock): boolean {
	if (block.kind === "user" || block.held || block.protected || block.grouped) return true;
	const tool = (block.toolName ?? "").trim().toLowerCase();
	return tool === "mcp" || tool === "recall" || pstackIdentityFromDigest(block.text) !== undefined;
}

function commandIds(commands: readonly Command[]): Set<string> {
	return new Set(commands.flatMap((command) => {
		if (command.kind === "group" || command.kind === "fold" || command.kind === "restore" || command.kind === "pin") return command.ids;
		return [command.id];
	}));
}

export const estimateDefaultGroupDigestCost = chunkedCompaction.estimateDefaultGroupDigestCost;

export class MyCustomizeConductor implements Conductor {
	readonly id = "my-customize-conductor";
	readonly label = "My Customize";
	private readonly opts: Required<chunkedCompaction.MyCustomizeConductorOpts>;
	private host: ConductorHost | null = null;
	private rolloverCount = 0;
	private tokensSavedByRollover = 0;
	private lastEstimatedGroupSaving = 0;
	private lastPlan: Command[] | null = null;
	private lastResult: ConductorPlan | null = null;
	private lastResultCommands: Command[] | null = null;
	private lastResultMemberKey: string | null = null;

	// DEC-002/003: stable-plan dirty tracking
	private dirty = true;
	private lastCap = 0;
	private lastBlockCount = 0;
	private lastViewKey: string | null = null;

	constructor(opts: chunkedCompaction.MyCustomizeConductorOpts = {}) {
		this.opts = { preGroupTokens: opts.preGroupTokens ?? DEFAULT_PRE_GROUP_TOKENS };
	}

	attach(host: ConductorHost): void {
		this.host = host;
	}

	/** DEC-003: store calls this from fold/pin/unpin/unfold to signal held-state changed. */
	markDirty(): void {
		this.dirty = true;
	}

	private replayPriorCommands(view: ConductorView, excluded: ReadonlySet<string> = new Set()): Command[] {
		if (!this.lastPlan) return [];
		const blockById = new Map(view.blocks.map((block) => [block.id, block]));
		const replayable: Command[] = [];

		for (const command of this.lastPlan) {
			if (command.kind === "group") {
				const valid = command.ids.length > 0 && command.ids.every((id) => {
					if (excluded.has(id)) return false;
					const block = blockById.get(id);
					return block !== undefined && !block.held && !block.protected && !block.grouped &&
						(block.order >= view.frozenFromIndex || typeof command.digest === "string" && command.digest.length > 0);
				});
				if (valid) replayable.push(command);
			} else if (command.kind === "replace") {
				if (excluded.has(command.id)) continue;
				const block = blockById.get(command.id);
				if (block && !block.held && !block.protected && !block.grouped) {
					replayable.push(command);
				}
			}
		}
		return replayable;
	}

	private finishConduct(
		plan: Command[],
		preGroupTokens: number,
		preGroupTarget: number,
		rollover: boolean,
		memberIds: string[],
		diagnostics: RolloverDiagnostics,
	): ConductorPlan {
		if (this.host) {
			const fill = preGroupTarget === 0 ? 0 : Math.round(preGroupTokens / preGroupTarget * 100);
			let phase: ChunkedStatusMetrics["preGroupPhase"];
			if (preGroupTarget === 0) phase = "inactive";
			else if (rollover) phase = "rolled-over";
			else if (preGroupTokens >= preGroupTarget) phase = "waiting-safe-rollover";
			else phase = "accumulating";
			const metrics: ChunkedStatusMetrics = {
				preGroupTokens,
				preGroupTargetTokens: preGroupTarget,
				preGroupFillPct: fill,
				preGroupPhase: phase,
				newPreGroupTokens: diagnostics.newPreGroupTokens,
				rolloverBlockedReason: diagnostics.rolloverBlockedReason,
				rolloverCount: this.rolloverCount,
				tokensSavedByRollover: this.tokensSavedByRollover,
				lastEstimatedGroupSaving: this.lastEstimatedGroupSaving,
				breakFrozenCount: this.rolloverCount,
			};
			const text = rollover
				? `chunked · rollover · ${this.rolloverCount} rollover(s) · ${humanTokens(this.tokensSavedByRollover)} saved · pregroup ${preGroupTokens} → 0`
				: `chunked · ${fill}% pregroup · ${this.rolloverCount} rollovers · ${humanTokens(this.tokensSavedByRollover)} saved`;
			this.host.setStatus(text, metrics, null);
		}

		const memberKey = memberIds.join("\u0000");
		if (this.lastResult && this.lastResultCommands === plan && this.lastResultMemberKey === memberKey) {
			return this.lastResult;
		}
		this.lastResult = { commands: plan, preGroup: { memberIds } };
		this.lastResultCommands = plan;
		this.lastResultMemberKey = memberKey;
		return this.lastResult;
	}

	private createGroup(
		candidates: readonly ViewBlock[],
		view: ConductorView,
		callById: ReadonlyMap<string, ViewBlock>,
		minimumSaving: number,
	): PlannedGroup | null {
		const ids = chunkedCompaction.trimOpenToolPairs(candidates.map((block) => block.id), view.blocks);
		if (ids.length < 2) return null;

		const selectedIds = new Set(ids);
		// Filter from candidates (not view.blocks) — candidates is already a small subset.
		const blocks = candidates.filter((block) => selectedIds.has(block.id));
		const turns = blocks.map((block) => block.turn);
		const turnRange: [number, number] = [Math.min(...turns), Math.max(...turns)];
		const retrievalIndex = chunkedCompaction.buildMcpRetrievalIndex(blocks, callById);
		const digest = chunkedCompaction.composeDigest(
			chunkedCompaction.digestHeader(chunkedCompaction.corpusContentHash(blocks), ids.length, turnRange),
			chunkedCompaction.digestBody(blocks),
			chunkedCompaction.digestMembersFooter(ids.map(foldCode)),
		) + (retrievalIndex ? `\n\n${retrievalIndex}` : "");
		const saving = blocks.reduce((sum, block) => sum + block.tokens, 0) - estSummaryTokens(digest);
		if (saving < minimumSaving) return null;
		return { command: { kind: "group", ids, digest }, saving };
	}

	private planRollover(
		view: ConductorView,
		fromIndex: number,
		callById: ReadonlyMap<string, ViewBlock>,
		cap: number,
		target: number,
	): { commands: Command[]; saving: number; groupSaving: number } {
		// Views without a harness estimate are the original standalone conductor contract.
		// Preserve its 15k multi-group slicing semantics; engine views provide harnessOverhead
		// and use the atomic rollover planner below.
		if (view.harnessOverhead === undefined) {
			const range = chunkedCompaction.selectCompactionRange(view, fromIndex);
			if (!range) return { commands: [], saving: 0, groupSaving: 0 };
			const commands: Command[] = [];
			let saving = 0;
			let groupSaving = 0;
			const minimumGroupSaving = Math.max(2_000, 0.05 * cap);
			let segment: ViewBlock[] = [];
			const flush = (): void => {
				this.sliceSegmentIntoGroups(segment, view, callById, minimumGroupSaving, commands, (amount) => {
					saving += amount;
					groupSaving += amount;
				});
				segment = [];
			};
			for (const block of view.blocks.slice(range.fromIndex, range.toIndexExclusive)) {
				if (!isRolloverGroupBoundary(block)) {
					segment.push(block);
					continue;
				}
				flush();
				if (!isMcpResult(block)) continue;
				const content = mcpSummary(block, block.callId ? callById.get(block.callId) : undefined);
				const summaryTokens = estSummaryTokens(content);
				if (summaryTokens >= block.tokens) continue;
				commands.push({ kind: "replace", id: block.id, content, recoverable: true });
				saving += block.tokens - summaryTokens;
			}
			flush();
			return { commands, saving, groupSaving };
		}

		const range = chunkedCompaction.selectCompactionRange(view, fromIndex);
		if (!range) return { commands: [], saving: 0, groupSaving: 0 };

		// A rollover is one atomic cache break. Select the oldest complete-turn prefix
		// that fills the target; if a hard barrier is encountered first, compact the
		// complete run immediately before it. In particular, do not emit one group per
		// 15k slice: that would leave the host with several cache breaks for one rollover.
		let end = range.toIndexExclusive;
		const hardBarrier = (block: ViewBlock): boolean => block.held || block.grouped || block.proactivelyCompressed;
		const barrierIndex = view.blocks.slice(range.fromIndex, range.toIndexExclusive)
			.findIndex(hardBarrier);
		const hasBarrier = barrierIndex >= 0 || (end < view.protectedFromIndex && hardBarrier(view.blocks[end]));
		if (barrierIndex >= 0) end = range.fromIndex + barrierIndex;
		if (!hasBarrier) {
			let tokens = 0;
			end = range.fromIndex;
			for (let start = range.fromIndex; start < range.toIndexExclusive;) {
				let next = start + 1;
				while (next < range.toIndexExclusive && view.blocks[next].turn === view.blocks[start].turn) next++;
				tokens += view.blocks.slice(start, next).reduce((sum, block) => sum + block.tokens, 0);
				end = next;
				if (tokens >= target) break;
				start = next;
			}
		}
		if (end <= range.fromIndex) return { commands: [], saving: 0, groupSaving: 0 };

		const minimumGroupSaving = Math.max(2_000, 0.05 * cap);
		const candidates = view.blocks.slice(range.fromIndex, end)
			.filter((block) => !block.held && !block.protected && !block.grouped && !block.proactivelyCompressed);
		const planned = this.createGroup(candidates, view, callById, minimumGroupSaving);
		if (!planned) return { commands: [], saving: 0, groupSaving: 0 };
		return { commands: [planned.command], saving: planned.saving, groupSaving: planned.saving };
	}

	private createDefaultGroup(candidates: readonly ViewBlock[], view: ConductorView): GroupCommand | null {
		const ids = chunkedCompaction.trimOpenToolPairs(candidates.map((block) => block.id), view.blocks);
		return ids.length >= 2 ? { kind: "group", ids } : null;
	}

	/** Compact old pressure candidates without consuming the active Pre-Group. */
	private planNormalPressure(
		view: ConductorView,
		preGroupFromIndex: number,
	): Command[] {
		const end = Math.min(preGroupFromIndex, view.protectedFromIndex);
		if (end <= 0) return [];
		const commands: Command[] = [];
		const candidates = view.blocks.slice(0, end).filter((block) =>
			!block.held && !block.protected && !block.grouped && !block.proactivelyCompressed,
		);
		if (candidates.length === 0) return [];

		const normalGroup = this.createDefaultGroup(candidates, view);
		const grouped = new Set(normalGroup?.ids ?? []);
		if (normalGroup) commands.push(normalGroup);
		for (const block of candidates) {
			if (grouped.has(block.id) || !FOLDABLE_KINDS.has(block.kind) || block.foldedTokens >= block.tokens) continue;
			commands.push({ kind: "fold", ids: [block.id] });
		}
		return commands;
	}

	private planFoldsToCap(
		view: ConductorView,
		preGroupFromIndex: number,
		cap: number,
		initialSaving: number,
		excluded: ReadonlySet<string>,
	): Command[] {
		let projected = view.liveTokens - initialSaving;
		if (projected <= cap) return [];
		const commands: Command[] = [];
		for (const block of view.blocks.slice(0, Math.min(preGroupFromIndex, view.protectedFromIndex))) {
			if (projected <= cap) break;
			if (excluded.has(block.id) || block.held || block.protected || block.grouped || block.proactivelyCompressed) continue;
			if (!FOLDABLE_KINDS.has(block.kind) || block.foldedTokens >= block.tokens) continue;
			commands.push({ kind: "fold", ids: [block.id] });
			projected -= block.tokens - block.foldedTokens;
		}
		return commands;
	}

	/** Slice a contiguous segment into turn-aligned groups of ~15k tokens each. */
	private sliceSegmentIntoGroups(
		segment: readonly ViewBlock[],
		view: ConductorView,
		callById: ReadonlyMap<string, ViewBlock>,
		minimumSaving: number,
		out: Command[],
		onSaving: (saving: number) => void,
	): void {
		if (segment.length === 0) return;
		let slice: ViewBlock[] = [];
		let sliceTokens = 0;

		for (let start = 0; start < segment.length;) {
			// Gather one complete turn.
			let end = start + 1;
			while (end < segment.length && segment[end].turn === segment[start].turn) end++;
			for (let i = start; i < end; i++) {
				slice.push(segment[i]);
				sliceTokens += segment[i].tokens;
			}
			if (sliceTokens >= DEFAULT_PRE_GROUP_TOKENS) {
				const planned = this.createGroup(slice, view, callById, minimumSaving);
				if (planned) { out.push(planned.command); onSaving(planned.saving); }
				slice = [];
				sliceTokens = 0;
			}
			start = end;
		}
		if (slice.length > 0) {
			const planned = this.createGroup(slice, view, callById, minimumSaving);
			if (planned) { out.push(planned.command); onSaving(planned.saving); }
		}
	}

	private planHardCapEmergency(
		view: ConductorView,
		hardCap: number,
		callById: ReadonlyMap<string, ViewBlock>,
	): Command[] {
		const commands: Command[] = [];
		const disposed = new Set<string>();
		let live = view.liveTokens;
		const frozenCandidates = view.blocks
			.filter((block) => block.order < view.frozenFromIndex && !block.held && !block.protected &&
				!block.grouped && !block.proactivelyCompressed && block.foldedTokens < block.tokens &&
				FOLDABLE_KINDS.has(block.kind))
			.sort((left, right) => left.order - right.order);

		for (const block of frozenCandidates) {
			if (live <= hardCap) break;
			const summary = isMcpResult(block)
				? mcpSummary(block, block.callId ? callById.get(block.callId) : undefined)
				: undefined;
			const summaryTokens = summary ? estSummaryTokens(summary) : block.tokens;
			if (summary && summaryTokens < block.tokens) {
				commands.push({ kind: "replace", id: block.id, content: summary, recoverable: true, breakFrozen: true });
				live -= block.tokens - summaryTokens;
			} else {
				commands.push({ kind: "fold", ids: [block.id], breakFrozen: true });
				live -= block.tokens - block.foldedTokens;
			}
			disposed.add(block.id);
		}

		if (live <= hardCap) return commands;

		// Phase 2: group remaining blocks when individual folds were not enough. With no
		// frozen prefix this is the emergency's only legal pressure valve; with a frozen
		// prefix it is limited to that prefix. Proactively-compressed blocks may be grouped
		// (grouping preserves their recoverable content) but remain ineligible for folds.
		let run: ViewBlock[] = [];
		const flushRun = (): void => {
			if (live <= hardCap || run.length === 0) {
				run = [];
				return;
			}
			const command = this.createDefaultGroup(run, view);
			if (command) {
				commands.push(command);
				const idSet = new Set(command.ids);
				const members = view.blocks.filter((block) => idSet.has(block.id));
				live -= members.reduce((sum, block) => sum + block.tokens, 0) - chunkedCompaction.estimateDefaultGroupDigestCost(members);
			}
			run = [];
		};
		for (const block of view.blocks) {
			const inEmergencyPrefix = view.frozenFromIndex > 0
				? block.order < view.frozenFromIndex
				: view.contextWindow !== null && view.contextWindow <= 64_000;
			const eligible = inEmergencyPrefix && !block.held && !block.protected &&
				!block.grouped && !disposed.has(block.id);
			if (eligible) run.push(block);
			else flushRun();
		}
		flushRun();
		return commands;
	}

	conduct(view: ConductorView): ConductorPlan {
		const cap = availableCap(view);
		const hardCap = contextWindowCap(view);
		const blockCount = view.blocks.length;
		const viewKey = view.blocks.map((block) => block.id).join("\u0000");
		const previousViewKey = this.lastViewKey;
		this.lastViewKey = viewKey;
		// Unknown windows still expose diagnostics and membership, but cannot authorize a
		// chunked rollover. Known windows use the shared context-window gate.
		const baseTarget = view.contextWindow === null
			? this.opts.preGroupTokens
			: chunkedCompaction.effectivePreGroupTokens(view, this.opts);
		// Bounded dynamic target: use the overage to avoid tiny rollovers, but do not let
		// a growing over-budget transcript move the target indefinitely. Explicit base
		// targets remain authoritative when they exceed the dynamic ceiling.
		const preGroupTarget = baseTarget <= 0
			? 0
			: view.liveTokens > cap
				? Math.max(baseTarget, Math.min(MAX_DYNAMIC_PRE_GROUP_TOKENS, view.liveTokens - cap))
				: baseTarget;
		const preGroupFromIndex = preGroupTarget > 0
			? chunkedCompaction.computePreGroupFromIndex(view, preGroupTarget, isAccumulationBoundary)
			: view.protectedFromIndex;
		const preGroupBlocks = view.blocks.slice(preGroupFromIndex, view.protectedFromIndex);
		// Only count ungrouped blocks — preserved (host-owned) groups are already compacted.
		const preGroupTokens = preGroupBlocks
			.filter((block) => !block.grouped)
			.reduce((sum, block) => sum + block.tokens, 0);
		const preGroupMembers = (excluded: ReadonlySet<string> = new Set()): string[] =>
			preGroupBlocks.filter((block) => !excluded.has(block.id) && !block.grouped).map((block) => block.id);
		const prior = this.replayPriorCommands(view);
		const priorIds = commandIds(prior);

		// Observability: distinguish waiting for more content from waiting for a safe
		// tool-pair boundary. These values are display-only and do not steer commands.
		const newPreGroupTokens = priorIds.size > 0
			? preGroupBlocks.filter((block) => !priorIds.has(block.id)).reduce((sum, block) => sum + block.tokens, 0)
			: preGroupTokens;
		const pairSafe = chunkedCompaction.noOpenToolPairAcrossPreGroupTail(view, preGroupFromIndex);
		const blockedReason = rolloverBlockedReason(view.liveTokens, cap, preGroupTarget, newPreGroupTokens, pairSafe);

		// Fast path: nothing changed and no emergency. Skip expensive index builds.
		if (!this.dirty && previousViewKey === viewKey && this.lastPlan && blockCount === this.lastBlockCount && cap <= this.lastCap && view.liveTokens <= hardCap) {
			return this.finishConduct(prior, preGroupTokens, preGroupTarget, false, preGroupMembers(priorIds), {
				newPreGroupTokens,
				rolloverBlockedReason: "stable-plan",
			});
		}

		const callById = new Map<string, ViewBlock>();
		for (const block of view.blocks) {
			if (block.kind === "tool_call" && block.callId) callById.set(block.callId, block);
		}

		// A folded block that is now in the frozen prefix is host-owned, but a folded
		// pre-group member must be made live before the next rollover can consume it.
		// This is intentionally a restore only; it never weakens pair or protection checks.
		const restores = preGroupTarget > 0
			? view.blocks.filter((block) => block.order < view.frozenFromIndex && block.folded && !block.grouped && !block.held && !block.protected)
			: [];
		if (restores.length > 0) {
			const plan: Command[] = [{ kind: "restore", ids: restores.map((block) => block.id) }];
			this.dirty = false;
			this.lastCap = cap;
			this.lastBlockCount = blockCount;
			return this.finishConduct(plan, preGroupTokens, preGroupTarget, false, preGroupMembers(), {
				newPreGroupTokens,
				rolloverBlockedReason: blockedReason,
			});
		}

		// DEC-002: hard-cap emergency always re-plans (safety valve).
		if (view.liveTokens > hardCap) {
			const emergency = this.planHardCapEmergency(view, hardCap, callById);
			if (emergency.length > 0) {
				const disposed = commandIds(emergency);
				const plan = [...this.replayPriorCommands(view, disposed), ...emergency];
				this.lastPlan = plan;
				this.dirty = false;
				this.lastCap = cap;
				this.lastBlockCount = blockCount;
				return this.finishConduct(plan, preGroupTokens, preGroupTarget, false, preGroupMembers(commandIds(plan)), {
					newPreGroupTokens,
					rolloverBlockedReason: "hard-cap-emergency",
				});
			}
		}

		// DEC-002: nothing material changed — return stable plan with updated pre-group membership.
		// (Hard-cap cases are handled above; this catches cap-change or dirty-only scenarios.)
		if (!this.dirty && previousViewKey === viewKey && this.lastPlan && blockCount === this.lastBlockCount && cap <= this.lastCap) {
			return this.finishConduct(prior, preGroupTokens, preGroupTarget, false, preGroupMembers(priorIds), {
				newPreGroupTokens,
				rolloverBlockedReason: "stable-plan",
			});
		}

		const hardBarrier = (block: ViewBlock): boolean => block.held || block.grouped || block.proactivelyCompressed;
		const barrierBeforePreGroup = preGroupFromIndex > view.frozenFromIndex &&
			view.blocks.slice(view.frozenFromIndex, preGroupFromIndex).some(hardBarrier);
		let rolloverFromIndex = preGroupFromIndex < view.frozenFromIndex ? preGroupFromIndex : view.frozenFromIndex;
		if (rolloverFromIndex === view.frozenFromIndex && barrierBeforePreGroup) rolloverFromIndex = preGroupFromIndex;
		while (rolloverFromIndex < view.protectedFromIndex && hardBarrier(view.blocks[rolloverFromIndex])) rolloverFromIndex++;

		// Rollover trigger: enough NEW content accumulated AND no open tool pair straddles
		// the boundary. A budget smaller than the base interval cannot safely fund a cache
		// break, so it falls back to ordinary pressure handling instead.
		const rolloverEnabled = view.contextWindow !== null && baseTarget > 0;
		const rolloverBudgetSafe = view.harnessOverhead === undefined || cap >= baseTarget;
		const canRollover = rolloverEnabled && rolloverBudgetSafe && preGroupTarget > 0 && newPreGroupTokens >= preGroupTarget && pairSafe;
		if (canRollover) {
			const rollover = this.planRollover(view, rolloverFromIndex, callById, cap, preGroupTarget);
			if (rollover.commands.length > 0) {
				this.rolloverCount++;
				this.tokensSavedByRollover += rollover.saving;
				this.lastEstimatedGroupSaving = rollover.groupSaving;
				const consumed = commandIds(rollover.commands);
				const folds = view.liveTokens > cap ? this.planFoldsToCap(view, preGroupFromIndex, cap, rollover.saving, consumed) : [];
				const commands = [...rollover.commands, ...folds];
				const plan = [...this.replayPriorCommands(view, commandIds(commands)), ...commands];
				this.lastPlan = plan;
				this.dirty = false;
				this.lastCap = cap;
				this.lastBlockCount = blockCount;
				return this.finishConduct(plan, preGroupTokens, preGroupTarget, true, preGroupMembers(commandIds(plan)), {
					newPreGroupTokens,
					rolloverBlockedReason: "none",
				});
			}
		}

		// The early over-cap path may consume a complete, safe group even when the
		// configured accumulation target was not reached. This prevents a small but
		// material pre-group from being individually folded, while under-cap sessions
		// still wait for the ordinary target trigger above.
		if (rolloverEnabled && rolloverBudgetSafe && view.harnessOverhead !== undefined && view.liveTokens > cap && preGroupTarget > 0 && preGroupTokens > 0 &&
			this.opts.preGroupTokens >= DEFAULT_PRE_GROUP_TOKENS &&
			(preGroupTokens * 5 >= preGroupTarget * 4 ||
				preGroupTarget < MAX_DYNAMIC_PRE_GROUP_TOKENS && preGroupFromIndex === view.frozenFromIndex && !barrierBeforePreGroup ||
				barrierBeforePreGroup && preGroupTokens * 5 >= DEFAULT_PRE_GROUP_TOKENS * 4 ||
				barrierBeforePreGroup && preGroupTarget >= MAX_DYNAMIC_PRE_GROUP_TOKENS)) {
			// At the maximum bounded target this is an atomic rebase: compact the oldest
			// complete run before a barrier. Smaller early rollovers consume the active suffix
			// after a barrier, preserving older normal groups.
			const earlyFromIndex = barrierBeforePreGroup && preGroupTarget >= MAX_DYNAMIC_PRE_GROUP_TOKENS
				? view.frozenFromIndex
				: rolloverFromIndex;
			const early = this.planRollover(view, earlyFromIndex, callById, cap, preGroupTarget);
			if (early.commands.length > 0) {
				this.rolloverCount++;
				this.tokensSavedByRollover += early.saving;
				this.lastEstimatedGroupSaving = early.groupSaving;
				const consumed = commandIds(early.commands);
				const plan = [...this.replayPriorCommands(view, consumed), ...early.commands];
				this.lastPlan = plan;
				this.dirty = false;
				this.lastCap = cap;
				this.lastBlockCount = blockCount;
				return this.finishConduct(plan, preGroupTokens, preGroupTarget, true, preGroupMembers(commandIds(plan)), {
					newPreGroupTokens,
					rolloverBlockedReason: "none",
				});
			}
		}

		// An explicitly tiny pre-group option is the ordinary suffix-batching mode. It
		// still needs one default group when the whole aged suffix is already available.
		if (view.liveTokens > cap && this.opts.preGroupTokens < DEFAULT_PRE_GROUP_TOKENS && preGroupFromIndex === 0) {
			const suffix = this.createDefaultGroup(preGroupBlocks, view);
			if (suffix) {
				const plan = [...prior, suffix];
				this.lastPlan = plan;
				this.dirty = false;
				this.lastCap = cap;
				this.lastBlockCount = blockCount;
				return this.finishConduct(plan, preGroupTokens, preGroupTarget, false, preGroupMembers(commandIds(plan)), {
					newPreGroupTokens,
					rolloverBlockedReason: blockedReason,
				});
			}
		}

		if (view.liveTokens <= cap) {
			this.lastCap = cap;
			this.lastBlockCount = blockCount;
			return this.finishConduct(prior, preGroupTokens, preGroupTarget, false, preGroupMembers(priorIds), {
				newPreGroupTokens,
				rolloverBlockedReason: blockedReason,
			});
		}

		// Ordinary pressure compaction may act only before the active Pre-Group. It is
		// deliberately separate from chunked rollover and therefore emits default groups
		// (digest omitted) or individual fold commands.
		const pressureFromIndex = view.harnessOverhead !== undefined && view.contextWindow === null
			? view.protectedFromIndex
			: preGroupTarget > 0 ? preGroupFromIndex : view.protectedFromIndex;
		const priorCommandIds = commandIds(prior);
		const normal = this.planNormalPressure(view, pressureFromIndex)
			.filter((command) => [...commandIds([command])].every((id) => !priorCommandIds.has(id)));
		if (normal.length > 0) {
			const plan = [...prior, ...normal];
			this.lastPlan = plan;
			this.dirty = false;
			this.lastCap = cap;
			this.lastBlockCount = blockCount;
			return this.finishConduct(plan, preGroupTokens, preGroupTarget, false, preGroupMembers(commandIds(plan)), {
				newPreGroupTokens,
				rolloverBlockedReason: blockedReason,
			});
		}

		this.dirty = false;
		this.lastCap = cap;
		this.lastBlockCount = blockCount;

		// Recovery after a conductor reset may still deterministically replace an MCP result,
		// but never touch the active Pre-Group itself.
		if (prior.length === 0 && view.liveTokens > cap) {
			const mcpReplaces: Command[] = [];
			for (const block of view.blocks.slice(0, Math.min(preGroupFromIndex, view.protectedFromIndex))) {
				if (!isMcpResult(block) || block.held || block.protected || block.grouped) continue;
				const content = mcpSummary(block, block.callId ? callById.get(block.callId) : undefined);
				if (estSummaryTokens(content) >= block.tokens) continue;
				mcpReplaces.push({ kind: "replace", id: block.id, content, recoverable: true });
			}
			if (mcpReplaces.length > 0) {
				this.lastPlan = mcpReplaces;
				return this.finishConduct(mcpReplaces, preGroupTokens, preGroupTarget, false, preGroupMembers(commandIds(mcpReplaces)), {
					newPreGroupTokens,
					rolloverBlockedReason: "mcp-recovery",
				});
			}
		}

		return this.finishConduct(prior, preGroupTokens, preGroupTarget, false, preGroupMembers(priorIds), {
			newPreGroupTokens,
			rolloverBlockedReason: canRollover ? "no-group-produced"
				: view.liveTokens > cap && prior.length > 0 && normal.length === 0 ? "exhausted"
				: blockedReason,
		});
	}
}
