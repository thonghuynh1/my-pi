import type { ConductorView, ViewBlock } from "../contract";
import { foldCode, isMcpResult, canonicalMcpIdentity } from "./mcp-summary";
import {
	CHUNKED_COMPACTION_PREFIX,
	DEFAULT_PRE_GROUP_TOKENS,
	MIN_CONTEXT_WINDOW_FOR_CHUNKED_COMPACTION,
} from "./constants";

export interface MyCustomizeConductorOpts {
	preGroupTokens?: number;
}

type DigestCostBlock = Pick<ViewBlock, "kind" | "tokens" | "turn">;

/** Conservative estimate of the host's default recoverable group digest. */
export function estimateDefaultGroupDigestCost(run: readonly DigestCostBlock[]): number {
	let totalTokens = 0;
	let lowestTurn = Infinity;
	let highestTurn = -Infinity;
	const kinds = new Set<string>();
	for (const block of run) {
		totalTokens += block.tokens;
		lowestTurn = Math.min(lowestTurn, block.turn);
		highestTurn = Math.max(highestTurn, block.turn);
		kinds.add(block.kind);
	}
	let chars = 64 + String(run.length).length + String(Math.max(0, totalTokens)).length;
	chars += String(Math.max(0, lowestTurn === Infinity ? 0 : lowestTurn)).length;
	chars += String(Math.max(0, highestTurn === -Infinity ? 0 : highestTurn)).length;
	chars += kinds.size * 24;
	return Math.ceil(chars / 4) + 8;
}

export function effectivePreGroupTokens(view: ConductorView, opts: MyCustomizeConductorOpts): number {
	if (view.contextWindow === null || view.contextWindow < MIN_CONTEXT_WINDOW_FOR_CHUNKED_COMPACTION) return 0;
	return opts.preGroupTokens ?? DEFAULT_PRE_GROUP_TOKENS;
}

/**
 * Walk backward from the newest pre-group block. The newest block is included when it is
 * groupable, just as the engine's protected-tail walk always includes its newest block.
 */
export function computePreGroupFromIndex(
	view: ConductorView,
	target: number,
	isGroupBoundaryFn: (block: ViewBlock) => boolean,
): number {
	const end = Math.min(view.protectedFromIndex, view.blocks.length);
	if (target <= 0 || end === 0) return end;
	const newest = view.blocks[end - 1];
	if (isGroupBoundaryFn(newest)) return end;

	let from = end - 1;
	let sum = newest.tokens;
	if (sum >= target) return from;
	for (let i = end - 2; i >= 0; i--) {
		const next = view.blocks[i];
		if (isGroupBoundaryFn(next)) break;
		from = i;
		sum += next.tokens;
		if (sum >= target) break;
	}
	return from;
}

export function noOpenToolPairAcrossPreGroupTail(view: ConductorView, preGroupFromIndex: number): boolean {
	const end = Math.min(view.protectedFromIndex, view.blocks.length);
	const preGroupCallIds = new Set<string>();
	for (let i = Math.max(0, preGroupFromIndex); i < end; i++) {
		const callId = view.blocks[i].callId;
		if (callId) preGroupCallIds.add(callId);
	}
	for (let i = end; i < view.blocks.length; i++) {
		const callId = view.blocks[i].callId;
		if (callId && preGroupCallIds.has(callId)) return false;
	}
	return true;
}

export function trimOpenToolPairs(ids: string[], allBlocks: readonly ViewBlock[]): string[] {
	const blockById = new Map(allBlocks.map((block) => [block.id, block]));
	const tokensById = new Map(allBlocks.map((block) => [block.id, block.tokens]));

	// Pre-index callId → block IDs and messageKey → block IDs for O(1) lookups.
	const blocksByCallId = new Map<string, ViewBlock[]>();
	const idsByMessageKey = new Map<string, Set<string>>();
	for (const block of allBlocks) {
		if (block.callId) {
			let arr = blocksByCallId.get(block.callId);
			if (!arr) { arr = []; blocksByCallId.set(block.callId, arr); }
			arr.push(block);
		}
		const mKey = block.messageKey ?? block.id;
		let mSet = idsByMessageKey.get(mKey);
		if (!mSet) { mSet = new Set(); idsByMessageKey.set(mKey, mSet); }
		mSet.add(block.id);
	}

	const messageKey = (id: string): string => blockById.get(id)?.messageKey ?? id;
	const wholeMessageRun = (candidate: string[]): string[] => {
		let run = candidate;
		while (run.length > 0) {
			const selected = new Set(run);
			const firstKey = messageKey(run[0]);
			const firstKeyIds = idsByMessageKey.get(firstKey);
			if (firstKeyIds) {
				let hasOutside = false;
				for (const id of firstKeyIds) { if (!selected.has(id)) { hasOutside = true; break; } }
				if (hasOutside) {
					run = run.filter((id) => messageKey(id) !== firstKey);
					continue;
				}
			}
			const lastKey = messageKey(run[run.length - 1]);
			const lastKeyIds = idsByMessageKey.get(lastKey);
			if (lastKeyIds) {
				let hasOutside = false;
				for (const id of lastKeyIds) { if (!selected.has(id)) { hasOutside = true; break; } }
				if (hasOutside) {
					run = run.filter((id) => messageKey(id) !== lastKey);
					continue;
				}
			}
			break;
		}
		return run;
	};
	let trimmed = wholeMessageRun([...ids]);

	while (trimmed.length >= 2) {
		const selected = new Set(trimmed);
		const remove = new Set<string>();
		for (const id of trimmed) {
			const block = blockById.get(id);
			if (!block?.callId) continue;
			// A partner that is already grouped (committed in a preserved host group) is
			// permanently separated — don't penalize this block for a split that already happened.
			const partners = blocksByCallId.get(block.callId);
			if (!partners) continue;
			let hasOutsidePartner = false;
			for (const partner of partners) {
				if (partner.id !== block.id && !selected.has(partner.id) && !partner.grouped) {
					hasOutsidePartner = true;
					break;
				}
			}
			if (hasOutsidePartner) remove.add(id);
		}
		if (remove.size === 0) break;

		const runs: string[][] = [];
		let run: string[] = [];
		for (const id of trimmed) {
			if (remove.has(id)) {
				if (run.length > 0) runs.push(run);
				run = [];
			} else {
				run.push(id);
			}
		}
		if (run.length > 0) runs.push(run);
		trimmed = runs.map(wholeMessageRun).reduce<string[]>((best, candidate) => {
			const bestTokens = best.reduce((sum, id) => sum + (tokensById.get(id) ?? 0), 0);
			const candidateTokens = candidate.reduce((sum, id) => sum + (tokensById.get(id) ?? 0), 0);
			return candidateTokens > bestTokens ? candidate : best;
		}, []);
	}

	return trimmed.length < 2 ? [] : trimmed;
}

export function digestHeader(corpusHash: string, count: number, turnRange: [number, number]): string {
	return `${CHUNKED_COMPACTION_PREFIX} ${count} blocks · turns ${turnRange[0]}–${turnRange[1]} · content-hash ${corpusHash}⟩`;
}

function normalizedText(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

export function digestBody(blocks: readonly ViewBlock[]): string {
	return blocks
		.map((block) => {
			// Truncate before normalizing to avoid regex-processing megabyte-sized text.
			const excerpt = normalizedText((block.text ?? "").slice(0, 200)).slice(0, 160);
			return `${block.turn} · ${block.kind} · ${block.id} · ${excerpt}`;
		})
		.join("\n");
}

export function digestMembersFooter(memberFoldCodes: readonly string[]): string {
	return `Members: ${memberFoldCodes.map((code) => `{#${code}}`).join(" ")}`;
}

export function composeDigest(header: string, body: string, footer: string): string {
	return [header, body, footer].join("\n\n");
}

function fnv1a(input: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

export function corpusContentHash(blocks: readonly Pick<ViewBlock, "id" | "tokens" | "order">[]): string {
	// Fast content fingerprint: block identity (id + tokens + order) is stable and
	// uniquely identifies the corpus without serializing full text through SHA-256.
	const key = blocks.map((block) => `${block.id}:${block.tokens}:${block.order}`).join("\n");
	return `fnv:${fnv1a(key)}`;
}

/**
 * A contiguous sub-range of the pre-group window bounded by complete messages
 * and hard barriers. Completed messages within a long active turn are eligible.
 */
export type SafeCompactionRange = {
	fromIndex: number;
	toIndexExclusive: number;
	/** True when the last complete turn had to be excluded because it was too
	 *  large and would have split a turn boundary. Always false at walking-skeleton depth. */
	oversizedTurnSplit: boolean;
};

/**
 * Select a contiguous sub-range of `[fromIndex, view.protectedFromIndex)` that:
 *   - Starts on a complete message, even when a token-sized interval begins mid-turn.
 *   - Never splits a message across its boundaries.
 *   - Stops before a held barrier; grouped blocks delimit later candidate runs.
 *   - Allows user / MCP / recall / pstack blocks — they may belong to an eligible turn.
 *
 * Returns `null` when the resulting range would be empty.
 */
export function selectCompactionRange(view: ConductorView, fromIndex: number): SafeCompactionRange | null {
	const end = view.protectedFromIndex;
	const blocks = view.blocks;
	if (fromIndex >= end) return null;

	// A token-sized Pre-Group often begins mid-turn, including in a completed
	// historical turn. Skip only the remainder of a split MESSAGE, not the whole
	// turn; otherwise a 30k interval inside a long turn can never roll over.
	let safeFromIndex = fromIndex;
	while (
		safeFromIndex < end &&
		safeFromIndex > 0 &&
		!blocks[safeFromIndex].held &&
		!blocks[safeFromIndex].grouped &&
		(blocks[safeFromIndex - 1].messageKey ?? blocks[safeFromIndex - 1].id) ===
			(blocks[safeFromIndex].messageKey ?? blocks[safeFromIndex].id)
	) {
		safeFromIndex++;
	}
	if (safeFromIndex >= end) return null;

	// Hard barrier scan: the first held block caps the range.
	// Grouped blocks are NOT hard barriers — they are handled as segment boundaries
	// by the caller's isRolloverGroupBoundary, allowing the range to span across
	// preserved groups and reach ungrouped content between them.
	let harderEnd = end;
	for (let i = safeFromIndex; i < end; i++) {
		const b = blocks[i];
		if (b.held) {
			harderEnd = i;
			break;
		}
	}

	// A long tool-using turn may exceed the entire Pre-Group target. Its completed
	// messages can still be grouped; only a message split by the protected boundary
	// must remain live. The group planner subsequently trims open tool pairs.
	let toIndexExclusive = harderEnd;
	if (toIndexExclusive < blocks.length) {
		const boundaryKey = blocks[toIndexExclusive].messageKey ?? blocks[toIndexExclusive].id;
		while (toIndexExclusive > safeFromIndex &&
			(blocks[toIndexExclusive - 1].messageKey ?? blocks[toIndexExclusive - 1].id) === boundaryKey) {
			toIndexExclusive--;
		}
	}

	if (toIndexExclusive <= safeFromIndex) return null;
	return { fromIndex: safeFromIndex, toIndexExclusive, oversizedTurnSplit: false };
}

/**
 * Build the final digest section that identifies every MCP tool result in the group.
 * Format per entry: `<server>/<tool> · <fingerprint> · turn N · {#code} · recall({...})`.
 * Returns an empty string when no MCP results are in `members`.
 */
export function buildMcpRetrievalIndex(
	members: readonly ViewBlock[],
	callById: ReadonlyMap<string, ViewBlock>,
): string {
	const entries: string[] = [];
	for (const block of members) {
		if (!isMcpResult(block)) continue;
		const call = block.callId ? callById.get(block.callId) : undefined;
		const identity = canonicalMcpIdentity(call?.text);
		if (!identity) continue;
		const memberCode = foldCode(block.id);
		entries.push(
			`${identity.server}/${identity.tool} · ${identity.fingerprint} · turn ${block.turn} · {#${memberCode}} · recall({"codes":["${memberCode}"]})`,
		);
	}
	if (entries.length === 0) return "";
	return `MCP retrieval index\n${entries.join("\n")}`;
}

export { DEFAULT_PRE_GROUP_TOKENS, MIN_CONTEXT_WINDOW_FOR_CHUNKED_COMPACTION, foldCode };
