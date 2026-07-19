import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { applyPlan, linearize, type PiMessage } from "../app/src/lib/live/mapping";
import { buildChunkedCompactionDiagnostic, formatContextDiagnostic } from "./chunked-compaction-diagnostic";
import * as cacheTracker from "./cache-tracker";
import type { GroupOp } from "../app/src/lib/live/protocol";

describe("accordion.chunkedCompactionJsonl", () => {
	let tempDir: string | undefined;

	afterEach(() => {
		cacheTracker.reset();
		if (tempDir) rmSync(tempDir, { recursive: true, force: true });
		tempDir = undefined;
	});

	it("writes one rollover block and omits it on a non-rollover turn", async () => {
		const originalMessages: PiMessage[] = [1, 2, 3, 4].map((timestamp) => ({
			role: "user",
			timestamp,
			content: `message ${timestamp}`,
		}));
		const blocks = linearize(originalMessages);
		const digest = "⟨chunked-compaction · 4 blocks · turns 1–4 · content-hash sha256:test⟩\n\nbody\n\nMembers: {#a} {#b} {#c} {#d}";
		const group: GroupOp = {
			id: "g:rollover",
			memberIds: blocks.map((block) => block.id),
			summaryText: digest,
		};

		cacheTracker.observe({ messages: originalMessages }, "anthropic");
		cacheTracker.observe({ messages: originalMessages }, "anthropic");
		const before = {
			frozenFromIndex: cacheTracker.getFrozenFromIndex(),
			reason: cacheTracker.getDiagnostics().reason,
		};
		const messagesForModel = applyPlan(originalMessages, [], [group]);
		cacheTracker.observeMessages(messagesForModel, "anthropic");
		const after = {
			frozenFromIndex: cacheTracker.getFrozenFromIndex(),
			reason: cacheTracker.getDiagnostics().reason,
		};
		const rollover = buildChunkedCompactionDiagnostic(group, blocks, before, after);

		expect(messagesForModel).not.toBe(originalMessages);
		expect(rollover).toBeDefined();
		expect(before.frozenFromIndex).not.toBe(after.frozenFromIndex);
		expect(rollover?.preGroupBlockCount).toBe(group.memberIds.length);
		expect(rollover?.digestContentHash).toMatch(/^sha256:/);

		tempDir = mkdtempSync(path.join(os.tmpdir(), "accordion-chunked-compaction-"));
		const jsonlPath = path.join(tempDir, "session.context.jsonl");
		await appendFile(jsonlPath, formatContextDiagnostic({ event: "accordion_context_apply_plan", chunkedCompaction: rollover }));
		await appendFile(jsonlPath, formatContextDiagnostic({ event: "accordion_context_apply_plan" }));

		const records = readFileSync(jsonlPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
		expect(records).toHaveLength(2);
		expect((records[0].chunkedCompaction as { event: string }).event).toBe("rollover");
		expect((records[0].chunkedCompaction as { preGroupBlockCount: number }).preGroupBlockCount).toBe(group.memberIds.length);
		expect((records[0].chunkedCompaction as { frozenFromIndexBefore: number; frozenFromIndexAfter: number }).frozenFromIndexBefore)
			.not.toBe((records[0].chunkedCompaction as { frozenFromIndexAfter: number }).frozenFromIndexAfter);
		expect(records[1].chunkedCompaction).toBeUndefined();
	});
});
