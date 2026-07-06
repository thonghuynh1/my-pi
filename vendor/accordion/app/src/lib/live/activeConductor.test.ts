import { describe, it, expect, afterEach } from "vitest";
import { AccordionStore } from "../engine/store.svelte";
import type { Block, ParsedSession } from "../engine/types";
import { setActiveConductor } from "./conductor.svelte";
import { attachActiveConductor } from "./activeConductor";

function block(id: string, order: number, tokens: number): Block {
	return {
		id,
		kind: "text",
		turn: order + 1,
		order,
		text: `block ${order} ` + "x".repeat(tokens * 4),
		tokens,
		override: null,
		autoFolded: false,
		by: null,
	};
}

function makeStore(blocks: Block[] = []): AccordionStore {
	const parsed: ParsedSession = {
		meta: { format: "pi", title: "live", cwd: "/tmp", model: "m" },
		blocks,
		lineCount: 0,
		skipped: 0,
	};
	return new AccordionStore(parsed);
}

afterEach(() => {
	setActiveConductor("my-customize-conductor");
});

describe("attachActiveConductor", () => {
	it("attaches the persisted in-process conductor before the first live append", () => {
		setActiveConductor("my-customize-conductor");
		const store = makeStore();
		store.setBudget(1_000);
		store.setProtect(0);

		const attached = attachActiveConductor(store);
		store.appendBlocks([
			block("a:old:p0", 0, 2_000),
			block("a:old:p1", 1, 2_000),
			block("a:new:p0", 2, 2_000),
		]);

		expect(attached).toBe(true);
		expect(store.conductor?.id).toBe("my-customize-conductor");
		expect(store.foldedCount).toBeGreaterThan(0);
	});
});
