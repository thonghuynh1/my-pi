import { describe, expect, it } from "vitest";

import { MyCustomizeConductor } from "../conductors/my-customize-conductor/my-customize-conductor";
import { AccordionStore } from "../app/src/lib/engine/store.svelte";
import type { ParsedSession } from "../app/src/lib/engine/types";
import { applyPlan, linearize, type PiMessage, wireToBlock } from "../app/src/lib/live/mapping";
import { computeFoldOps, computeGroupOps } from "../app/src/lib/live/plan";
import type { CacheTrackerDiagnostics } from "./cache-tracker";
import * as cacheTracker from "./cache-tracker";
import { buildUnreportedChunkedCompactionDiagnostic } from "./chunked-compaction-diagnostic";

const PROVIDER = "anthropic";
const CONTEXT_WINDOW = 200_000;
const BELOW_THRESHOLD_TOKENS = 7_000;
const CROSSING_TOKENS = 8_500;

interface InvariantResult {
	rollovers: number;
	coldStarts: number;
	prefixRewrites: number;
	cacheBreaks: number;
	ok: boolean;
}

interface SessionRun {
	records: readonly Record<string, unknown>[];
	groupCountByTurn: readonly number[];
}

class MemoryAppendSink {
	private text = "";

	append(line: string): void {
		this.text += line;
	}

	records(): Record<string, unknown>[] {
		return this.text
			.trim()
			.split("\n")
			.filter((line) => line.length > 0)
			.map((line) => {
				const parsed: unknown = JSON.parse(line);
				if (!isRecord(parsed)) throw new Error("diagnostic JSONL entry is not an object");
				return parsed;
			});
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
	const value = record[key];
	return typeof value === "number" ? value : undefined;
}

function cacheDiagnostics(record: Record<string, unknown>): CacheTrackerDiagnostics | undefined {
	const value = record.cacheTracker;
	if (!isRecord(value)) return undefined;
	const frozenFromIndex = numberField(value, "frozenFromIndex");
	const messageCount = numberField(value, "messageCount");
	const previousMessageCount = numberField(value, "previousMessageCount");
	const matchedPrefix = numberField(value, "matchedPrefix");
	const reason = value.reason;
	if (
		frozenFromIndex === undefined ||
		messageCount === undefined ||
		previousMessageCount === undefined ||
		matchedPrefix === undefined ||
		!isCacheTrackerReason(reason)
	) return undefined;
	return { frozenFromIndex, reason, messageCount, previousMessageCount, matchedPrefix };
}

function isCacheTrackerReason(value: unknown): value is CacheTrackerDiagnostics["reason"] {
	return value === "cold-start" ||
		value === "provider-changed" ||
		value === "system-changed" ||
		value === "tools-changed" ||
		value === "prefix-mismatch" ||
		value === "prefix-match" ||
		value === "error";
}

function hasRollover(record: Record<string, unknown>): boolean {
	const value = record.chunkedCompaction;
	return isRecord(value) && value.event === "rollover";
}

function rolloverHash(record: Record<string, unknown>): string | undefined {
	const value = record.chunkedCompaction;
	if (!isRecord(value)) return undefined;
	return typeof value.digestContentHash === "string" ? value.digestContentHash : undefined;
}

function verifyInvariant(records: readonly Record<string, unknown>[]): InvariantResult {
	let rollovers = 0;
	let coldStarts = 0;
	let prefixRewrites = 0;
	for (const record of records) {
		if (hasRollover(record)) rollovers += 1;
		const diagnostics = cacheDiagnostics(record);
		if (!diagnostics) continue;
		if (diagnostics.reason === "cold-start") coldStarts += 1;
		if (diagnostics.previousMessageCount > 0 && diagnostics.matchedPrefix < diagnostics.previousMessageCount) {
			prefixRewrites += 1;
		}
	}
	const cacheBreaks = coldStarts + prefixRewrites;
	return {
		rollovers,
		coldStarts,
		prefixRewrites,
		cacheBreaks,
		ok: rollovers === cacheBreaks - coldStarts,
	};
}

function emptyStore(): AccordionStore {
	const parsed: ParsedSession = {
		meta: { format: "pi", title: "chunked invariant", cwd: "", model: "test-model" },
		blocks: [],
		lineCount: 0,
		skipped: 0,
	};
	const store = new AccordionStore(parsed);
	store.contextWindow = CONTEXT_WINDOW;
	store.budget = 100_000;
	store.protectTokens = 0;
	store.attach(new MyCustomizeConductor());
	return store;
}

function payloadText(label: string, tokens: number): string {
	return `${label} ${"x".repeat(tokens * 4)}`;
}

function userMessage(turn: number): PiMessage {
	return { role: "user", timestamp: turn * 100, content: `turn ${turn}` };
}

function assistantMessage(responseNumber: number, tokens: number): PiMessage {
	return {
		role: "assistant",
		timestamp: responseNumber + 1,
		responseId: `response-${responseNumber}`,
		content: [{ type: "text", text: payloadText(`response ${responseNumber}`, tokens) }],
	};
}

function runSession(rolloverCount: 0 | 1 | 2): SessionRun {
	cacheTracker.reset();
	const sink = new MemoryAppendSink();
	const store = emptyStore();
	const rawHistory: PiMessage[] = [];
	const groupCountByTurn: number[] = [];
	const reportedGroupIds = new Set<string>();
	const additions: PiMessage[][] = [
		[userMessage(1)],
		[assistantMessage(1, BELOW_THRESHOLD_TOKENS)],
	];
	if (rolloverCount >= 1) {
		additions.push([userMessage(2)]);
		additions.push([assistantMessage(2, CROSSING_TOKENS)]);
	}
	if (rolloverCount >= 2) {
		additions.push([userMessage(3)]);
		additions.push([assistantMessage(3, BELOW_THRESHOLD_TOKENS)]);
		additions.push([userMessage(4)]);
		additions.push([assistantMessage(4, CROSSING_TOKENS)]);
	}

	for (const [turnIndex, messages] of additions.entries()) {
		rawHistory.push(...messages);
		store.setHarnessBreakdown({
			totalTokens: null,
			systemPromptTokens: null,
			frozenFromIndex: cacheTracker.getFrozenFromIndex(),
		});
		const all = linearize(rawHistory);
		store.appendBlocks(all.map(wireToBlock));
		groupCountByTurn.push(store.groups.length);

		const plan = { ops: computeFoldOps(store), groups: computeGroupOps(store) };
		const frozenFromIndexBefore = cacheTracker.getFrozenFromIndex();
		const cacheTrackerReasonBefore = cacheTracker.getDiagnostics().reason;
		const messagesForModel = applyPlan(rawHistory, plan.ops, plan.groups);
		cacheTracker.observeMessages(messagesForModel, PROVIDER);
		const frozenFromIndexAfter = cacheTracker.getFrozenFromIndex();
		const cacheTrackerReasonAfter = cacheTracker.getDiagnostics().reason;

		const chunkedCompaction = buildUnreportedChunkedCompactionDiagnostic(
			plan.groups,
			reportedGroupIds,
			all,
			{ frozenFromIndex: frozenFromIndexBefore, reason: cacheTrackerReasonBefore },
			{ frozenFromIndex: frozenFromIndexAfter, reason: cacheTrackerReasonAfter },
		);
		const entry: Record<string, unknown> = {
			turn: turnIndex + 1,
			cacheTracker: cacheTracker.getDiagnostics(),
			...(chunkedCompaction ? { chunkedCompaction } : {}),
		};
		sink.append(`${JSON.stringify(entry)}\n`);
		cacheTracker.observe({ system: "", tools: [], messages: messagesForModel }, PROVIDER);
	}

	return { records: sink.records(), groupCountByTurn };
}

function withoutFirstRollover(records: readonly Record<string, unknown>[]): Record<string, unknown>[] {
	let removed = false;
	return records.map((record) => {
		if (removed || !hasRollover(record)) return { ...record };
		removed = true;
		const copy = { ...record };
		delete copy.chunkedCompaction;
		return copy;
	});
}

describe("chunked-compaction diagnostic/cache invariant", () => {
	it("zero rollovers satisfy the invariant", () => {
		const run = runSession(0);
		expect(run.groupCountByTurn).toEqual([0, 0]);
		expect(verifyInvariant(run.records)).toEqual({
			rollovers: 0,
			coldStarts: 1,
			prefixRewrites: 0,
			cacheBreaks: 1,
			ok: true,
		});
	});

	it("single rollover satisfies count(rollover) == cacheBreaks - coldStarts", () => {
		const run = runSession(1);
		expect(run.groupCountByTurn).toEqual([0, 0, 0, 1]);
		expect(verifyInvariant(run.records)).toEqual({
			rollovers: 1,
			coldStarts: 1,
			prefixRewrites: 1,
			cacheBreaks: 2,
			ok: true,
		});
	});

	it("two rollovers satisfy the invariant without repeating old-group diagnostics", () => {
		const run = runSession(2);
		expect(run.groupCountByTurn).toEqual([0, 0, 0, 1, 1, 1, 1, 2]);
		expect.soft(run.records.map(hasRollover)).toEqual([false, false, false, true, false, false, false, true]);
		const hashes = run.records.flatMap((record) => {
			const hash = rolloverHash(record);
			return hash === undefined ? [] : [hash];
		});
		expect.soft(new Set(hashes).size).toBe(2);
		expect(verifyInvariant(run.records)).toEqual({
			rollovers: 2,
			coldStarts: 1,
			prefixRewrites: 2,
			cacheBreaks: 3,
			ok: true,
		});
	});

	it("invariant fails when a rollover JSONL block is missing (discriminating check)", () => {
		const corrupted = withoutFirstRollover(runSession(1).records);
		expect(verifyInvariant(corrupted)).toEqual({
			rollovers: 0,
			coldStarts: 1,
			prefixRewrites: 1,
			cacheBreaks: 2,
			ok: false,
		});
	});
});
