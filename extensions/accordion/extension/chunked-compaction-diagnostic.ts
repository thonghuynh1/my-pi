import { CHUNKED_COMPACTION_PREFIX } from "../conductors/my-customize-conductor/constants";
import { corpusContentHash, estimateDefaultGroupDigestCost } from "../conductors/my-customize-conductor/chunked-compaction";
import { estTokens } from "../app/src/lib/engine/tokens";
import type { GroupOp, WireBlock } from "../app/src/lib/live/protocol";
import type { CacheTrackerReason } from "./cache-tracker";

function isChunkedCompactionGroup(group: GroupOp): boolean {
	return group.rollover === true || (group.summaryText ?? "").startsWith(CHUNKED_COMPACTION_PREFIX);
}

function findUnreportedChunkedCompactionGroup(
	groups: readonly GroupOp[],
	reportedGroupIds: ReadonlySet<string>,
): GroupOp | undefined {
	return groups.find(
		(group) => !reportedGroupIds.has(group.id) && isChunkedCompactionGroup(group),
	);
}

export interface ChunkedCompactionDiagnostic {
	event: "rollover";
	preGroupTokensBefore: number;
	preGroupBlockCount: number;
	preGroupTurnRange: [number, number];
	digestTokens: number;
	estimatedGroupSaving: number;
	frozenFromIndexBefore: number;
	frozenFromIndexAfter: number;
	cacheTrackerReasonBefore: CacheTrackerReason;
	cacheTrackerReasonAfter: CacheTrackerReason;
	digestContentHash: string;
}

interface CacheTrackerState {
	frozenFromIndex: number;
	reason: CacheTrackerReason;
}

export function buildChunkedCompactionDiagnostic(
	group: GroupOp,
	blocks: readonly WireBlock[],
	before: CacheTrackerState,
	after: CacheTrackerState,
): ChunkedCompactionDiagnostic | undefined {
	const digest = group.summaryText ?? "";
	if (!isChunkedCompactionGroup(group)) return undefined;
	const members = blocks.filter((block) => group.memberIds.includes(block.id));
	const turns = members.map((block) => block.turn);
	const digestContentHash = /^⟨chunked-compaction ·[^⟩]*content-hash\s+([^\s⟩]+)⟩/.exec(digest)?.[1]
		?? corpusContentHash(members);
	const digestTokens = estTokens(digest);
	const preGroupTokensBefore = members.reduce((sum, block) => sum + block.tokens, 0);
	const estimatedGroupSaving = preGroupTokensBefore - estimateDefaultGroupDigestCost(members);
	return {
		event: "rollover",
		preGroupTokensBefore,
		preGroupBlockCount: group.memberIds.length,
		preGroupTurnRange: turns.length ? [Math.min(...turns), Math.max(...turns)] : [0, 0],
		digestTokens,
		estimatedGroupSaving,
		frozenFromIndexBefore: before.frozenFromIndex,
		frozenFromIndexAfter: after.frozenFromIndex,
		cacheTrackerReasonBefore: before.reason,
		cacheTrackerReasonAfter: after.reason,
		digestContentHash,
	};
}

export function buildUnreportedChunkedCompactionDiagnostic(
	groups: readonly GroupOp[],
	reportedGroupIds: Set<string>,
	blocks: readonly WireBlock[],
	before: CacheTrackerState,
	after: CacheTrackerState,
): ChunkedCompactionDiagnostic | undefined {
	const group = findUnreportedChunkedCompactionGroup(groups, reportedGroupIds);
	if (!group) return undefined;
	const diagnostic = buildChunkedCompactionDiagnostic(group, blocks, before, after);
	if (diagnostic) reportedGroupIds.add(group.id);
	return diagnostic;
}
