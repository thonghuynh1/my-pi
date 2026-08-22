import { describe, expect, it } from "vitest";
import { extractAsks, extractErrors, extractFiles, type ExtractableBlock } from "./extractors";

const block = (shape: ExtractableBlock): ExtractableBlock => shape;

describe("extractAsks", () => {
	it("extracts the first line from user blocks", () => {
		expect(extractAsks([
			block({ kind: "text", text: "ignored" }),
			block({ kind: "user", text: "first ask\nmore detail" }),
			block({ kind: "user", text: "second ask" }),
			block({ kind: "user", text: "third ask" }),
		])).toEqual(["first ask", "second ask", "third ask"]);
	});

	it("deduplicates, caps at six, and truncates at sixty characters", () => {
		const asks = Array.from({ length: 8 }, (_, index) => ({ kind: "user", text: `ask ${index}` }));
		asks.splice(2, 1, { kind: "user", text: "ask 1" });
		asks[0] = { kind: "user", text: "x".repeat(61) };

		expect(extractAsks(asks)).toEqual(["x".repeat(60), "ask 1", "ask 3", "ask 4", "ask 5", "ask 6"]);
	});

	it("returns an empty array without user blocks", () => {
		expect(extractAsks([])).toEqual([]);
	});
});

describe("extractFiles", () => {
	it("extracts allowlisted tool paths in insertion order", () => {
		expect(extractFiles([
			block({ kind: "tool_call", toolName: "read", text: '{"path": "src/a.ts"}' }),
			block({ kind: "tool_call", toolName: "write", text: "path: 'src/b.ts'" }),
			block({ kind: "tool_call", toolName: "edit", text: '{"path":"src/c.ts"}' }),
			block({ kind: "tool_call", toolName: "find", text: "find { path: src/d.ts }" }),
			block({ kind: "tool_call", toolName: "grep", text: '{"path": "src/e.ts"}' }),
			block({ kind: "tool_call", toolName: "ls", text: '{"path":"src/f"}' }),
		])).toEqual(["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts", "src/f"]);
	});

	it("ignores non-allowlisted tools, deduplicates, and caps at eight", () => {
		const calls = [
			{ kind: "tool_call", toolName: "bash", text: '{"path":"ignored"}' },
			...Array.from({ length: 9 }, (_, index) => ({
				kind: "tool_call",
				toolName: "read",
				text: `{ "path": "file-${index}.ts" }`,
			})),
			{ kind: "tool_call", toolName: "mcp", text: '{"path":"also-ignored"}' },
		];

		expect(extractFiles(calls)).toEqual(Array.from({ length: 8 }, (_, index) => `file-${index}.ts`));
	});
});

describe("extractErrors", () => {
	it("extracts deduplicated error first lines, capped and truncated", () => {
		expect(extractErrors([
			block({ kind: "tool_result", isError: false, text: "not an error" }),
			block({ kind: "tool_result", isError: true, text: "first error\ndetails" }),
			block({ kind: "tool_result", isError: true, text: "second error" }),
			block({ kind: "tool_result", isError: true, text: "third error" }),
			block({ kind: "tool_result", isError: true, text: "fourth error" }),
			block({ kind: "tool_result", isError: true, text: `${"x".repeat(81)}\ndetails` }),
			block({ kind: "tool_result", isError: true, text: "third error" }),
		])).toEqual(["first error", "second error", "third error"]);
	});

	it("truncates an error line at eighty characters", () => {
		expect(extractErrors([block({ kind: "tool_result", isError: true, text: "x".repeat(81) })])).toEqual(["x".repeat(80)]);
	});

	it("accepts a ViewBlock-shaped object", () => {
		expect(extractAsks([{ kind: "user", text: "view ask", id: "v1" }])).toEqual(["view ask"]);
	});
});
