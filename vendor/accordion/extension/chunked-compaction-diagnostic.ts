import { estTokens } from "../app/src/lib/engine/tokens";
import type { GroupOp, WireBlock } from "../app/src/lib/live/protocol";
import type { CacheTrackerReason } from "./cache-tracker";

const PREFIX = "⟨chunked-compaction ·";

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

export function buildChunkedCompactionDiagnostic(
	group: GroupOp,
	blocks: readonly WireBlock[],
	before: { frozenFromIndex: number; reason: CacheTrackerReason },
	after: { frozenFromIndex: number; reason: CacheTrackerReason },
): ChunkedCompactionDiagnostic | undefined {
	const digest = group.summaryText ?? "";
	if (!digest.startsWith(PREFIX)) return undefined;
	const members = blocks.filter((block) => group.memberIds.includes(block.id));
	const turns = members.map((block) => block.turn);
	const digestContentHash = /^⟨chunked-compaction ·[^⟩]*content-hash\s+([^\s⟩]+)⟩/.exec(digest)?.[1] ?? "sha256:";
	const digestTokens = estTokens(digest);
	const preGroupTokensBefore = members.reduce((sum, block) => sum + block.tokens, 0);
	return {
		event: "rollover",
		preGroupTokensBefore,
		preGroupBlockCount: group.memberIds.length,
		preGroupTurnRange: turns.length ? [Math.min(...turns), Math.max(...turns)] : [0, 0],
		digestTokens,
		estimatedGroupSaving: preGroupTokensBefore - digestTokens,
		frozenFromIndexBefore: before.frozenFromIndex,
		frozenFromIndexAfter: after.frozenFromIndex,
		cacheTrackerReasonBefore: before.reason,
		cacheTrackerReasonAfter: after.reason,
		digestContentHash,
	};
}

export function formatContextDiagnostic(entry: Record<string, unknown>): string {
	return `${JSON.stringify(entry)}\n`;
}

export { PREFIX as CHUNKED_COMPACTION_PREFIX };
