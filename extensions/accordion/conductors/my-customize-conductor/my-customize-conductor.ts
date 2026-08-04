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
import { DEFAULT_PRE_GROUP_TOKENS, humanTokens } from "./constants";

export type { MyCustomizeConductorOpts } from "./chunked-compaction";

type GroupCommand = Extract<Command, { kind: "group" }>;
type PlannedGroup = { command: GroupCommand; saving: number };

type ChunkedStatusMetrics = {
	preGroupTokens: number;
	preGroupTargetTokens: number;
	preGroupFillPct: number;
	preGroupPhase: "inactive" | "accumulating" | "waiting-safe-rollover" | "rolled-over";
	rolloverCount: number;
	tokensSavedByRollover: number;
	lastEstimatedGroupSaving: number;
	breakFrozenCount: number;
};

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
		if (command.kind === "group" || command.kind === "fold") return command.ids;
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
		const blocks = view.blocks.filter((block) => selectedIds.has(block.id));
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
	): { commands: Command[]; saving: number; groupSaving: number } {
		const range = chunkedCompaction.selectCompactionRange(view, fromIndex);
		if (!range) return { commands: [], saving: 0, groupSaving: 0 };

		const commands: Command[] = [];
		let saving = 0;
		let groupSaving = 0;
		const minimumGroupSaving = Math.max(2_000, 0.05 * cap);

		// Split the compaction range into segments separated by group boundaries.
		// Each segment is then sliced into turn-aligned 15k groups.
		let segment: ViewBlock[] = [];
		for (const block of view.blocks.slice(range.fromIndex, range.toIndexExclusive)) {
			if (!isRolloverGroupBoundary(block)) {
				segment.push(block);
				continue;
			}

			this.sliceSegmentIntoGroups(segment, view, callById, minimumGroupSaving, commands, (s) => { saving += s; groupSaving += s; });
			segment = [];

			// MCP results at boundaries get identity-preserving replaces.
			if (!isMcpResult(block)) continue;
			const content = mcpSummary(block, block.callId ? callById.get(block.callId) : undefined);
			const summaryTokens = estSummaryTokens(content);
			if (summaryTokens >= block.tokens) continue;
			commands.push({ kind: "replace", id: block.id, content, recoverable: true });
			saving += block.tokens - summaryTokens;
		}
		this.sliceSegmentIntoGroups(segment, view, callById, minimumGroupSaving, commands, (s) => { saving += s; groupSaving += s; });
		return { commands, saving, groupSaving };
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

		// Phase 2: group remaining eligible frozen blocks when individual folds weren't enough.
		let run: ViewBlock[] = [];
		const flushRun = (): void => {
			if (live <= hardCap || run.length === 0) {
				run = [];
				return;
			}
			const planned = this.createGroup(run, view, callById, 1);
			if (planned) {
				commands.push(planned.command);
				live -= planned.saving;
			}
			run = [];
		};
		for (const block of view.blocks) {
			const eligible = block.order < view.frozenFromIndex && !block.held && !block.protected &&
				!block.grouped && !block.proactivelyCompressed && !disposed.has(block.id);
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
		const baseTarget = chunkedCompaction.effectivePreGroupTokens(view, this.opts);
		// Dynamic target: when over budget, accumulate at least the overage before rolling over.
		// Math.max ensures the pre-group window is never smaller than baseTarget (15k),
		// preventing tiny rollovers that waste cache breaks.
		const preGroupTarget = view.liveTokens > cap
			? Math.max(baseTarget, view.liveTokens - cap)
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

		// DEC-002: hard-cap emergency always re-plans (safety valve).
		if (view.liveTokens > hardCap) {
			const callById = new Map<string, ViewBlock>();
			for (const block of view.blocks) {
				if (block.kind === "tool_call" && block.callId) callById.set(block.callId, block);
			}
			const emergency = this.planHardCapEmergency(view, hardCap, callById);
			if (emergency.length > 0) {
				const disposed = commandIds(emergency);
				const plan = [...this.replayPriorCommands(view, disposed), ...emergency];
				this.lastPlan = plan;
				this.dirty = false;
				this.lastCap = cap;
				this.lastBlockCount = blockCount;
				return this.finishConduct(plan, preGroupTokens, preGroupTarget, false, preGroupMembers(commandIds(plan)));
			}
		}

		if (view.liveTokens <= cap) {
			this.lastCap = cap;
			this.lastBlockCount = blockCount;
			return this.finishConduct(prior, preGroupTokens, preGroupTarget, false, preGroupMembers(priorIds));
		}

		// DEC-002: nothing material changed — return stable plan with updated pre-group membership.
		if (!this.dirty && this.lastPlan && blockCount === this.lastBlockCount && cap <= this.lastCap) {
			return this.finishConduct(prior, preGroupTokens, preGroupTarget, false, preGroupMembers(priorIds));
		}

		const callById = new Map<string, ViewBlock>();
		for (const block of view.blocks) {
			if (block.kind === "tool_call" && block.callId) callById.set(block.callId, block);
		}

		// Pre-group tokens for rollover trigger: only count content NOT already in prior groups.
		// The host resets to raw each pass, so prior-grouped blocks appear ungrouped in the view.
		// Without this exclusion, the conductor re-fires rollover on already-handled content.
		const newPreGroupTokens = priorIds.size > 0
			? preGroupBlocks.filter((block) => !priorIds.has(block.id)).reduce((sum, block) => sum + block.tokens, 0)
			: preGroupTokens;

		// Rollover trigger: enough NEW content accumulated AND no open tool pair straddles the boundary.
		// Turn integrity is ensured by selectCompactionRange (trims partial turns), so no explicit
		// turn-boundary check is needed here — that was blocking late-attach (DEC-004).
		const canRollover = preGroupTarget > 0 && newPreGroupTokens >= preGroupTarget &&
			chunkedCompaction.noOpenToolPairAcrossPreGroupTail(view, preGroupFromIndex);
		if (canRollover) {
			// DEC-001: advance past leading held blocks so the hard-barrier scan in
			// selectCompactionRange doesn't collapse the entire range to zero.
			let rolloverFromIndex = view.frozenFromIndex;
			while (rolloverFromIndex < view.protectedFromIndex && view.blocks[rolloverFromIndex]?.held) {
				rolloverFromIndex++;
			}
			const rollover = this.planRollover(view, rolloverFromIndex, callById, cap);
			if (rollover.commands.length > 0) {
				this.rolloverCount++;
				this.tokensSavedByRollover += rollover.saving;
				this.lastEstimatedGroupSaving = rollover.groupSaving;
				const consumed = commandIds(rollover.commands);
				const plan = [...this.replayPriorCommands(view, consumed), ...rollover.commands];
				this.lastPlan = plan;
				this.dirty = false;
				this.lastCap = cap;
				this.lastBlockCount = blockCount;
				return this.finishConduct(plan, preGroupTokens, preGroupTarget, true, preGroupMembers(commandIds(plan)));
			}
		}

		this.dirty = false;
		this.lastCap = cap;
		this.lastBlockCount = blockCount;

		// Recovery: when over budget but can't rollover (e.g. after conductor reset with
		// no lastPlan), re-scan for MCP results that can be re-replaced with deterministic
		// summaries. These summaries are lost on conductor reset because clearConductorState
		// wipes subst, and without lastPlan they can't be replayed.
		if (prior.length === 0 && view.liveTokens > cap) {
			const mcpReplaces: Command[] = [];
			for (const block of view.blocks) {
				if (!isMcpResult(block) || block.held || block.protected || block.grouped) continue;
				const content = mcpSummary(block, block.callId ? callById.get(block.callId) : undefined);
				const summaryTokens = estSummaryTokens(content);
				if (summaryTokens >= block.tokens) continue;
				mcpReplaces.push({ kind: "replace", id: block.id, content, recoverable: true });
			}
			if (mcpReplaces.length > 0) {
				this.lastPlan = mcpReplaces;
				return this.finishConduct(mcpReplaces, preGroupTokens, preGroupTarget, false, preGroupMembers(commandIds(mcpReplaces)));
			}
		}

		return this.finishConduct(prior, preGroupTokens, preGroupTarget, false, preGroupMembers(priorIds));
	}
}
