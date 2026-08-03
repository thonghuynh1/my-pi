/* Rollover-only conductor. It accumulates a dynamic pre-group window, then emits one
 * cache-invalidating batch of 15k-aligned groups and MCP replacements. */
import type { Command, Conductor, ConductorHost, ConductorPlan, ConductorView, ViewBlock } from "../contract";
import { availableCap, contextWindowCap } from "../contract";
import { FOLDABLE_KINDS } from "../cold-score/score";
import {
	estSummaryTokens,
	foldCode,
	isMcpResult,
	mcpSummary,
	type PstackIdentity,
} from "./mcp-summary";
import * as chunkedCompaction from "./chunked-compaction";
import { DEFAULT_PRE_GROUP_TOKENS, humanTokens } from "./constants";

export type { MyCustomizeConductorOpts } from "./chunked-compaction";

function isGroupBoundary(block: ViewBlock, pstackByBlockId: Map<string, PstackIdentity>): boolean {
	if (block.kind === "user" || block.held || block.protected || block.grouped) return true;
	const tool = (block.toolName ?? "").trim().toLowerCase();
	return tool === "mcp" || tool === "recall" || pstackByBlockId.has(block.id);
}

function isAccumulationBoundary(block: ViewBlock): boolean {
	// A frozen fold is already committed context compression. Do not pull it back into the
	// next Pre-Group window: doing so emits a restore on the following agent turn and makes
	// previously folded context snap open. Accumulate only the still-full suffix after it.
	return block.held || block.folded || block.grouped || block.proactivelyCompressed;
}

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
	attach(host: ConductorHost): void { this.host = host; }

	private replayablePreviousGroups(view: ConductorView, excluded = new Set<string>()): Command[] {
		return (this.lastPlan ?? []).filter((c): c is Extract<Command, { kind: "group" }> => c.kind === "group")
			.filter((group) => group.ids.length > 0 && group.ids.every((id) => {
				if (excluded.has(id)) return false;
				const block = view.blocks.find((candidate) => candidate.id === id);
				return block !== undefined && !block.held && !block.protected && !block.grouped &&
					(block.order >= view.frozenFromIndex || typeof group.digest === "string" && group.digest.length > 0);
			}));
	}

	private finishConduct(plan: Command[], preGroupTokens: number, preGroupTarget: number, rollover: boolean, memberIds: string[]): ConductorPlan {
		if (this.host) {
			const fill = preGroupTarget === 0 ? 0 : Math.round(preGroupTokens / preGroupTarget * 100);
			const phase: ChunkedStatusMetrics["preGroupPhase"] = preGroupTarget === 0 ? "inactive" : rollover ? "rolled-over" : preGroupTokens >= preGroupTarget ? "waiting-safe-rollover" : "accumulating";
			const metrics: ChunkedStatusMetrics = { preGroupTokens, preGroupTargetTokens: preGroupTarget, preGroupFillPct: fill, preGroupPhase: phase, rolloverCount: this.rolloverCount, tokensSavedByRollover: this.tokensSavedByRollover, lastEstimatedGroupSaving: this.lastEstimatedGroupSaving, breakFrozenCount: this.rolloverCount };
			const text = rollover ? `chunked · rollover · ${this.rolloverCount} rollover(s) · ${humanTokens(this.tokensSavedByRollover)} saved · pregroup ${preGroupTokens} → 0` : `chunked · ${fill}% pregroup · ${this.rolloverCount} rollovers · ${humanTokens(this.tokensSavedByRollover)} saved`;
			this.host.setStatus(text, metrics, null);
		}
		const key = memberIds.join("\u0000");
		if (this.lastResult && this.lastResultCommands === plan && this.lastResultMemberKey === key) return this.lastResult;
		this.lastResult = { commands: plan, preGroup: { memberIds } };
		this.lastResultCommands = plan;
		this.lastResultMemberKey = key;
		return this.lastResult;
	}

	conduct(view: ConductorView): ConductorPlan {
		const cap = availableCap(view);
		const hardCap = contextWindowCap(view);
		const baseTarget = chunkedCompaction.effectivePreGroupTokens(view, this.opts);
		const dynamicTarget = view.liveTokens > cap ? view.liveTokens - cap : baseTarget;
		const preGroupTarget = view.liveTokens > cap ? dynamicTarget : baseTarget;
		const from = preGroupTarget > 0 ? chunkedCompaction.computePreGroupFromIndex(view, preGroupTarget, isAccumulationBoundary) : view.protectedFromIndex;
		const preGroupBlocks = view.blocks.slice(from, view.protectedFromIndex);
		const preGroupTokens = preGroupBlocks.reduce((sum, block) => sum + block.tokens, 0);
		const members = (excluded = new Set<string>()): string[] => preGroupBlocks.filter((block) => !excluded.has(block.id)).map((block) => block.id);
		const prior = this.replayablePreviousGroups(view);
		if (view.liveTokens <= cap) return this.finishConduct(prior, preGroupTokens, preGroupTarget, false, members());

		const callById = new Map<string, ViewBlock>();
		for (const block of view.blocks) if (block.kind === "tool_call" && block.callId) callById.set(block.callId, block);
		const emitGroup = (candidate: readonly ViewBlock[]): Command | null => {
			const ids = chunkedCompaction.trimOpenToolPairs(candidate.filter((block) => !isMcpResult(block)).map((block) => block.id), view.blocks);
			if (ids.length < 2) return null;
			const groupBlocks = view.blocks.filter((block) => ids.includes(block.id));
			const saving = groupBlocks.reduce((sum, block) => sum + block.tokens, 0) - chunkedCompaction.estimateDefaultGroupDigestCost(groupBlocks);
			if (saving < Math.max(2_000, 0.05 * cap)) return null;
			const range: [number, number] = [Math.min(...groupBlocks.map((block) => block.turn)), Math.max(...groupBlocks.map((block) => block.turn))];
			const index = chunkedCompaction.buildMcpRetrievalIndex(groupBlocks, callById);
			const digest = chunkedCompaction.composeDigest(chunkedCompaction.digestHeader(chunkedCompaction.corpusContentHash(groupBlocks), ids.length, range), chunkedCompaction.digestBody(groupBlocks), chunkedCompaction.digestMembersFooter(ids.map(foldCode))) + (index ? `\n\n${index}` : "");
			this.tokensSavedByRollover += saving;
			this.lastEstimatedGroupSaving = saving;
			return { kind: "group", ids, digest };
		};

		const protectedStart = view.protectedFromIndex;
		const onBoundary = protectedStart === view.blocks.length ||
			protectedStart > 0 && view.blocks[protectedStart - 1]?.turn !== view.blocks[protectedStart]?.turn;
		if (preGroupTarget > 0 && preGroupTokens >= dynamicTarget && onBoundary && chunkedCompaction.noOpenToolPairAcrossPreGroupTail(view, from)) {
			const selected = chunkedCompaction.selectCompactionRange(view, view.frozenFromIndex);
			const eligible = selected ? view.blocks.slice(selected.fromIndex, selected.toIndexExclusive) : preGroupBlocks;
			const commands: Command[] = [];
			let segment: ViewBlock[] = [];
			const flush = (): void => {
				for (let start = 0; start < segment.length;) {
					let end = start;
					let tokens = 0;
					const turn = segment[start].turn;
					while (end < segment.length && (end === start || tokens + segment[end].tokens <= DEFAULT_PRE_GROUP_TOKENS || segment[end].turn === turn)) { tokens += segment[end].tokens; end++; }
					const group = emitGroup(segment.slice(start, end));
					if (group) commands.push(group);
					start = end === start ? end + 1 : end;
				}
				segment = [];
			};
			for (const block of eligible) {
				if (isMcpResult(block)) { flush(); const content = mcpSummary(block, block.callId ? callById.get(block.callId) : undefined); if (content) commands.push({ kind: "replace", id: block.id, content, recoverable: true }); }
				else segment.push(block);
			}
			flush();
			if (commands.length > 0) {
				this.rolloverCount++;
				const plan = [...prior, ...commands];
				this.lastPlan = plan;
				return this.finishConduct(plan, preGroupTokens, preGroupTarget, true, members(new Set(commands.flatMap((c) => c.kind === "group" ? c.ids : []))));
			}
		}

		if (view.liveTokens > hardCap) {
			const emergency: Command[] = [];
			let live = view.liveTokens;
			const frozenCandidates = view.blocks
				.filter((candidate) => candidate.order < view.frozenFromIndex && !candidate.held && !candidate.protected && !candidate.grouped && FOLDABLE_KINDS.has(candidate.kind))
				.sort((a, b) => a.order - b.order);
			for (const block of frozenCandidates) {
				if (live <= hardCap) break;
				const summary = isMcpResult(block) ? mcpSummary(block, block.callId ? callById.get(block.callId) : undefined) : undefined;
				if (summary && estSummaryTokens(summary) < block.tokens) { emergency.push({ kind: "replace", id: block.id, content: summary, recoverable: true }); live -= block.tokens - estSummaryTokens(summary); }
				else { emergency.push({ kind: "fold", ids: [block.id], breakFrozen: block.order < view.frozenFromIndex }); live += block.foldedTokens - block.tokens; }
			}
			if (emergency.length) return this.finishConduct(emergency, preGroupTokens, preGroupTarget, false, members());
		}
		return this.finishConduct(prior, preGroupTokens, preGroupTarget, false, members());
	}
}
function isRecallResult(b: ViewBlock): boolean {
	return b.kind === "tool_result" && (b.toolName ?? "").trim().toLowerCase() === "recall";
}
