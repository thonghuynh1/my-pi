import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MyCustomizeConductor } from "$conductors";
import { linearize, wireToBlock, type PiMessage } from "../live/mapping";
import { AccordionStore } from "./store.svelte";
import type { ParsedSession } from "./types";

// A local, private corpus. Never add real session text to static/ or a tracked test fixture.
// Opt in with ACCORDION_PRIVATE_REPLAY=1; ordinary tests and CI never read the corpus.
const corpus = fileURLToPath(new URL("../../../../.pi/private-transcripts/tstack-replay.jsonl", import.meta.url));

function messages(): PiMessage[] {
	return readFileSync(corpus, "utf8").split("\n").flatMap((line) => {
		if (!line.trim()) return [];
		const event = JSON.parse(line) as { type?: string; message?: PiMessage };
		return event.type === "message" && event.message ? [event.message] : [];
	});
}

function replay(): { steps: number; maxGroups: number; clamps: Array<{ step: number; reason: string; start: number; end: number; overlap: number }> } {
	const parsed: ParsedSession = {
		meta: { format: "pi", title: "private replay", cwd: "", model: "" },
		blocks: [], lineCount: 0, skipped: 0,
	};
	const store = new AccordionStore(parsed);
	store.contextWindow = 1_000_000;
	store.budget = 70_000;
	store.protectTokens = 35_000;
	store.attach(new MyCustomizeConductor());
	const history = messages().slice(0, process.env.ACCORDION_REPLAY_ALL === "1" ? undefined : 180);
	const clamps: Array<{ step: number; reason: string; start: number; end: number; overlap: number }> = [];
	let maxGroups = 0;
	let steps = 0;
	try {
		// Replay the original append order, including the late long tool-using turn.
		// A batch keeps this local check fast; every batch still exercises a real store pass.
		for (let count = 12; count <= history.length + 12; count += 12) {
			const prefix = history.slice(0, count);
			store.applySync({
				blocks: linearize(prefix).map(wireToBlock),
				harness: { totalTokens: null, systemPromptTokens: null, frozenFromIndex: 0,
					actualWireTokens: 10_504, messagesTokens: 0 },
			});
			steps++;
			maxGroups = Math.max(maxGroups, store.groups.length);
			for (const report of store.lastReports) {
				if (report.reason === "invalid-group" || report.reason === "pre-group") {
					const start = store.blocks.findIndex((block) => block.id === report.ids[0]);
					const end = store.blocks.findIndex((block) => block.id === report.ids.at(-1));
					const overlap = store.groups.flatMap((group) => group.memberIds)
						.map((id) => store.blocks.findIndex((block) => block.id === id))
						.find((index) => index >= start && index <= end) ?? -1;
					clamps.push({ step: steps, reason: report.reason, start, end, overlap });
				}
			}
		}
		return { steps, maxGroups, clamps };
	} finally {
		store.dispose();
	}
}

describe("private tstack transcript replay (ignored local corpus)", () => {
	it.skipIf(process.env.ACCORDION_PRIVATE_REPLAY !== "1" || !existsSync(corpus))("keeps group commands valid through incremental appends", () => {
		const result = replay();
		console.info("Accordion private replay metrics", {
			steps: result.steps, maxGroups: result.maxGroups, invalidGroupClamps: result.clamps.length,
		});
		expect(result.steps).toBeGreaterThan(10);
		expect(result.maxGroups).toBeGreaterThan(0);
		expect(result.clamps).toEqual([]);
	});
});
