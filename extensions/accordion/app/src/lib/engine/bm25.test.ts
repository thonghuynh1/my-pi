import { describe, expect, it } from "vitest";
import { searchBlocks } from "./bm25";

describe("searchBlocks", () => {
	it("ranks matching documents by BM25 score", () => {
		const results = searchBlocks([
			{ id: "first", text: "The folding engine keeps context small." },
			{ id: "second", text: "Search finds relevant context in many blocks." },
			{ id: "third", text: "The map renders blocks without search terms." },
		], "context folding");

		expect(results.map(({ id }) => id)).toEqual(["first", "second"]);
		expect(results[0].score).toBeGreaterThan(results[1].score);
	});

	it("includes three lines of context around a match", () => {
		const text = Array.from({ length: 20 }, (_, index) =>
			index === 9 ? "line 10 contains the needle" : `line ${index + 1}`,
		).join("\n");

		expect(searchBlocks([{ id: "doc", text }], "needle")[0].snippet).toBe(
			["line 7", "line 8", "line 9", "line 10 contains the needle", "line 11", "line 12", "line 13"].join("\n"),
		);
	});

	it("merges overlapping context windows", () => {
		const text = Array.from({ length: 15 }, (_, index) => {
			const line = index + 1;
			return line === 5 || line === 7 ? `line ${line} needle` : `line ${line}`;
		}).join("\n");

		const snippet = searchBlocks([{ id: "doc", text }], "needle")[0].snippet;
		expect(snippet).toBe(Array.from({ length: 9 }, (_, index) => `line ${index + 2}${index === 3 || index === 5 ? " needle" : ""}`).join("\n"));
	});

	it("caps results at five by default", () => {
		const docs = Array.from({ length: 10 }, (_, index) => ({ id: `${index}`, text: `needle ${index}` }));
		expect(searchBlocks(docs, "needle")).toHaveLength(5);
	});

	it("returns no results for an empty query or absent terms", () => {
		const docs = [{ id: "doc", text: "some searchable text" }];
		expect(searchBlocks(docs, "")).toEqual([]);
		expect(searchBlocks(docs, "xyzzy")).toEqual([]);
	});
});
