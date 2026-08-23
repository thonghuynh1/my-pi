import { describe, expect, it } from "vitest";
import { AccordionStore } from "./store.svelte";
import type { Block, ParsedSession } from "./types";

function block(i: number): Block {
	return {
		id: `m${i}:p0`,
		kind: "text",
		turn: i + 1,
		order: i,
		text: `block ${i} ` + "x".repeat(4000),
		tokens: 1000,
		override: null,
		autoFolded: false,
		by: null,
	};
}

function frozenStore(): AccordionStore {
	const parsed: ParsedSession = {
		meta: { format: "pi", title: "t", cwd: "", model: "" },
		blocks: Array.from({ length: 6 }, (_, i) => block(i)),
		lineCount: 0,
		skipped: 0,
	};
	const store = new AccordionStore(parsed);
	store.setProtect(0);
	store.setContextWindow(200_000);
	store.setBudget(1_000);
	store.setHarnessBreakdown({ totalTokens: 6000, systemPromptTokens: 100, frozenFromIndex: 5 });
	return store;
}

describe("group substitution frozen-region clamp", () => {
	it("groupCmd bypasses frozen clamp when digest is non-empty", () => {
		const store = frozenStore();
		const reports = store.applyCommands(
			[{ kind: "group", ids: ["m2:p0", "m3:p0"], digest: "⟨chunked-compaction · test⟩" }],
			"auto",
		);

		expect(reports.filter((report) => report.command === "group" && report.reason === "frozen")).toHaveLength(0);
		expect(store.groups).toHaveLength(1);
		expect(store.groups[0].memberIds).toEqual(["m2:p0", "m3:p0"]);
	});

	it("groupCmd still clamps frozen when digest is null (DROP)", () => {
		const store = frozenStore();
		const reports = store.applyCommands([{ kind: "group", ids: ["m2:p0", "m3:p0"], digest: null }], "auto");

		expect(reports).toHaveLength(1);
		expect(reports[0].command).toBe("group");
		expect(reports[0].reason).toBe("frozen");
		expect(store.groups).toHaveLength(0);
	});

	it("groupCmd still clamps frozen when digest is empty string (DROP)", () => {
		const store = frozenStore();
		const reports = store.applyCommands([{ kind: "group", ids: ["m2:p0", "m3:p0"], digest: "" }], "auto");

		expect(reports).toHaveLength(1);
		expect(reports[0].command).toBe("group");
		expect(reports[0].reason).toBe("frozen");
		expect(store.groups).toHaveLength(0);
	});

	it("substOne still clamps fold on frozen block", () => {
		const store = frozenStore();
		const reports = store.applyCommands([{ kind: "fold", ids: ["m3:p0"] }], "auto");

		expect(reports).toHaveLength(1);
		expect(reports[0].command).toBe("fold");
		expect(reports[0].reason).toBe("frozen");
	});

	it("substOne still clamps replace on frozen block", () => {
		const store = frozenStore();
		const reports = store.applyCommands([{ kind: "replace", id: "m3:p0", content: "replacement" }], "auto");

		expect(reports).toHaveLength(1);
		expect(reports[0].command).toBe("replace");
		expect(reports[0].reason).toBe("frozen");
	});
});
