/* Rollover-only conductor. It accumulates a dynamic pre-group window, then emits one
 * cache-invalidating batch of turn-aligned groups and MCP replacements. */
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
	return block.held || block.folded || block.grouped || block.proactivelyCompressed;
}

function isRolloverGroupBoundary(block: ViewBlock): boolean {
	if (block.kind === "user" || block.held || block.protected || block.grouped) return true;
	const tool = (block.toolName ?? "").trim().toLowerCase();
	return tool === "mcp" || tool === "recall" || pstackIdentityFromDigest(block.text) !== undefined;
}

function commandIds(commands: readonly Command[]): Set<string> {
	return new Set(commands.flatMap((command) => {
		if (command.kind === "group" || command.kind === "fold" || command.kind === "restore" || command.kind === "pin") {
			return command.ids;
		}
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

	constructor(opts: chunkedCompaction.MyCustomizeConductorOpts = {}) {
		this.opts = { preGroupTokens: opts.preGroupTokens ?? DEFAULT_PRE_GROUP_TOKENS };
	}

	attach(host: ConductorHost): void {
		this.host = host;
	}

	private replayablePreviousGroups(view: ConductorView, excluded: ReadonlySet<string> = new Set()): Command[] {
		const blockById = new Map(view.blocks.map((block) => [block.id, block]));
		return (this.lastPlan ?? [])
			.filter((command): command is GroupCommand => command.kind === "group")
			.filter((group) => group.ids.length > 0 && group.ids.every((id) => {
				if (excluded.has(id)) return false;
				const block = blockById.get(id);
				return block !== undefined && !block.held && !block.protected && !block.grouped &&
					(block.order >= view.frozenFromIndex || typeof group.digest === "string" && group.digest.length > 0);
			}));
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
		let segment: ViewBlock[] = [];
		const minimumGroupSaving = Math.max(2_000, 0.05 * cap);

		const flushSegment = (): void => {
			let slice: ViewBlock[] = [];
			let sliceTokens = 0;
			const flushSlice = (): void => {
				const planned = this.createGroup(slice, view, callById, minimumGroupSaving);
				if (planned) {
					commands.push(planned.command);
					saving += planned.saving;
					groupSaving += planned.saving;
				}
				slice = [];
				sliceTokens = 0;
			};

			for (let start = 0; start < segment.length;) {
				let end = start + 1;
				while (end < segment.length && segment[end].turn === segment[start].turn) end++;
				const turnBlocks = segment.slice(start, end);
				const turnTokens = turnBlocks.reduce((total, block) => total + block.tokens, 0);
				slice.push(...turnBlocks);
				sliceTokens += turnTokens;
				if (sliceTokens >= DEFAULT_PRE_GROUP_TOKENS) flushSlice();
				start = end;
			}
			if (slice.length > 0) flushSlice();
			segment = [];
		};

		for (const block of view.blocks.slice(range.fromIndex, range.toIndexExclusive)) {
			if (!isRolloverGroupBoundary(block)) {
				segment.push(block);
				continue;
			}

			flushSegment();
			if (!isMcpResult(block)) continue;
			const content = mcpSummary(block, block.callId ? callById.get(block.callId) : undefined);
			const summaryTokens = estSummaryTokens(content);
			if (summaryTokens >= block.tokens) continue;
			commands.push({ kind: "replace", id: block.id, content, recoverable: true });
			saving += block.tokens - summaryTokens;
		}
		flushSegment();
		return { commands, saving, groupSaving };
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
		const baseTarget = chunkedCompaction.effectivePreGroupTokens(view, this.opts);
		const dynamicTarget = view.liveTokens > cap ? view.liveTokens - cap : baseTarget;
		const preGroupTarget = view.liveTokens > cap ? dynamicTarget : baseTarget;
		const preGroupFromIndex = preGroupTarget > 0
			? chunkedCompaction.computePreGroupFromIndex(view, preGroupTarget, isAccumulationBoundary)
			: view.protectedFromIndex;
		const preGroupBlocks = view.blocks.slice(preGroupFromIndex, view.protectedFromIndex);
		const preGroupTokens = preGroupBlocks.reduce((sum, block) => sum + block.tokens, 0);
		const preGroupMembers = (excluded: ReadonlySet<string> = new Set()): string[] =>
			preGroupBlocks.filter((block) => !excluded.has(block.id)).map((block) => block.id);
		const prior = this.replayablePreviousGroups(view);
		const priorIds = commandIds(prior);

		if (view.liveTokens <= cap) {
			return this.finishConduct(prior, preGroupTokens, preGroupTarget, false, preGroupMembers(priorIds));
		}

		const callById = new Map<string, ViewBlock>();
		for (const block of view.blocks) {
			if (block.kind === "tool_call" && block.callId) callById.set(block.callId, block);
		}

		const protectedStart = view.protectedFromIndex;
		const onTurnBoundary = protectedStart === view.blocks.length ||
			protectedStart > 0 && view.blocks[protectedStart - 1]?.turn !== view.blocks[protectedStart]?.turn;
		const canRollover = preGroupTarget > 0 && preGroupTokens >= dynamicTarget && onTurnBoundary &&
			chunkedCompaction.noOpenToolPairAcrossPreGroupTail(view, preGroupFromIndex);
		if (canRollover) {
			const rollover = this.planRollover(view, view.frozenFromIndex, callById, cap);
			if (rollover.commands.length > 0 && rollover.saving >= dynamicTarget) {
				this.rolloverCount++;
				this.tokensSavedByRollover += rollover.saving;
				this.lastEstimatedGroupSaving = rollover.groupSaving;
				const consumed = commandIds(rollover.commands);
				const plan = [...this.replayablePreviousGroups(view, consumed), ...rollover.commands];
				this.lastPlan = plan;
				return this.finishConduct(plan, preGroupTokens, preGroupTarget, true, preGroupMembers(commandIds(plan)));
			}
		}

		if (view.liveTokens > hardCap) {
			const emergency = this.planHardCapEmergency(view, hardCap, callById);
			if (emergency.length > 0) {
				const disposed = commandIds(emergency);
				const plan = [...this.replayablePreviousGroups(view, disposed), ...emergency];
				return this.finishConduct(plan, preGroupTokens, preGroupTarget, false, preGroupMembers(commandIds(plan)));
			}
		}

		return this.finishConduct(prior, preGroupTokens, preGroupTarget, false, preGroupMembers(priorIds));
	}
}
