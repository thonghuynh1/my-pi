import type { ConductorView, ViewBlock } from "../contract";
import { foldCode } from "./mcp-summary";
import {
	DEFAULT_PRE_GROUP_TOKENS,
	MIN_CONTEXT_WINDOW_FOR_CHUNKED_COMPACTION,
	PRE_GROUP_OVERFLOW_CAP,
} from "./constants";

export interface MyCustomizeConductorOpts {
	preGroupTokens?: number;
}

/** Conservative estimate of the host's default recoverable group digest. */
export function estimateDefaultGroupDigestCost(run: ViewBlock[]): number {
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
	const cap = target * PRE_GROUP_OVERFLOW_CAP;
	for (let i = end - 2; i >= 0; i--) {
		const next = view.blocks[i];
		if (isGroupBoundaryFn(next)) break;
		const nextSum = sum + next.tokens;
		if (nextSum > cap) break;
		from = i;
		sum = nextSum;
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
	const selected = new Set(ids);
	const insideByCallId = new Map<string, string[]>();
	for (const block of allBlocks) {
		if (block.callId && selected.has(block.id)) {
			const members = insideByCallId.get(block.callId) ?? [];
			members.push(block.id);
			insideByCallId.set(block.callId, members);
		}
	}
	const remove = new Set<string>();
	for (const [callId, insideIds] of insideByCallId) {
		const hasOutsidePartner = allBlocks.some((block) => block.callId === callId && !selected.has(block.id));
		if (hasOutsidePartner) for (const id of insideIds) remove.add(id);
	}
	const trimmed = ids.filter((id) => !remove.has(id));
	return trimmed.length < 2 ? [] : trimmed;
}

export function digestHeader(corpusHash: string, count: number, turnRange: [number, number]): string {
	return `⟨chunked-compaction · ${count} blocks · turns ${turnRange[0]}–${turnRange[1]} · content-hash ${corpusHash}⟩`;
}

function normalizedText(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

export function digestBody(blocks: readonly ViewBlock[]): string {
	return blocks
		.map((block) => {
			const excerpt = normalizedText(block.text ?? "").slice(0, 160);
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

function canonicalBlock(block: ViewBlock): string {
	return JSON.stringify([
		block.id,
		block.kind,
		block.turn,
		block.order,
		block.tokens,
		block.foldedTokens,
		block.toolName ?? "",
		block.callId ?? "",
		block.isError === true,
		normalizedText(block.text ?? ""),
	]);
}

function utf8Bytes(value: string): Uint8Array {
	const bytes: number[] = [];
	for (let i = 0; i < value.length; i++) {
		let code = value.charCodeAt(i);
		if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
			const next = value.charCodeAt(i + 1);
			if (next >= 0xdc00 && next <= 0xdfff) {
				code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
				i++;
			}
		}
		if (code < 0x80) bytes.push(code);
		else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
		else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
		else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
	}
	return Uint8Array.from(bytes);
}

const SHA256_K = [
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
	0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
	0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
	0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
	0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
	0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotateRight(value: number, bits: number): number {
	return (value >>> bits) | (value << (32 - bits));
}

function sha256(value: string): string {
	const input = utf8Bytes(value);
	const bitLength = input.length * 8;
	const paddedLength = ((input.length + 9 + 63) >> 6) << 6;
	const bytes = new Uint8Array(paddedLength);
	bytes.set(input);
	bytes[input.length] = 0x80;
	const lengthOffset = paddedLength - 8;
	for (let i = 0; i < 8; i++) bytes[lengthOffset + i] = Math.floor(bitLength / 2 ** (56 - i * 8)) & 0xff;

	let h0 = 0x6a09e667;
	let h1 = 0xbb67ae85;
	let h2 = 0x3c6ef372;
	let h3 = 0xa54ff53a;
	let h4 = 0x510e527f;
	let h5 = 0x9b05688c;
	let h6 = 0x1f83d9ab;
	let h7 = 0x5be0cd19;
	for (let offset = 0; offset < bytes.length; offset += 64) {
		const words = new Uint32Array(64);
		for (let i = 0; i < 16; i++) {
			const j = offset + i * 4;
			words[i] = (bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3];
		}
		for (let i = 16; i < 64; i++) {
			const s0 = rotateRight(words[i - 15], 7) ^ rotateRight(words[i - 15], 18) ^ (words[i - 15] >>> 3);
			const s1 = rotateRight(words[i - 2], 17) ^ rotateRight(words[i - 2], 19) ^ (words[i - 2] >>> 10);
			words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0;
		}
		let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
		for (let i = 0; i < 64; i++) {
			const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
			const choice = (e & f) ^ (~e & g);
			const temp1 = (h + s1 + choice + SHA256_K[i] + words[i]) >>> 0;
			const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
			const majority = (a & b) ^ (a & c) ^ (b & c);
			const temp2 = (s0 + majority) >>> 0;
			h = g; g = f; f = e; e = (d + temp1) >>> 0;
			d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
		}
		h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
		h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
	}
	return [h0, h1, h2, h3, h4, h5, h6, h7].map((word) => word.toString(16).padStart(8, "0")).join("");
}

export function corpusContentHash(blocks: readonly ViewBlock[]): string {
	return `sha256:${sha256(blocks.map(canonicalBlock).join("\n"))}`;
}

export { DEFAULT_PRE_GROUP_TOKENS, PRE_GROUP_OVERFLOW_CAP, MIN_CONTEXT_WINDOW_FOR_CHUNKED_COMPACTION, foldCode };
