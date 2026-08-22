import { describe, expect, it } from "vitest";
import {
	buildMcpIndex,
	buildSemanticDigest,
	extractAsks,
	extractErrors,
	extractFiles,
	formatMcpIndex,
	type ExtractableBlock,
} from "./extractors";

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

describe("buildMcpIndex", () => {
	it("groups MCP calls by server/tool identity and collects recall codes", () => {
		expect(buildMcpIndex([
			block({ id: "mcp-1", kind: "tool_call", toolName: "mcp", text: 'mcp {"server":"engineering-skills","tool":"skill-trek"}' }),
			block({ id: "mcp-2", kind: "tool_call", toolName: "mcp", text: 'mcp {"server":"engineering-skills","tool":"skill-trek"}' }),
			block({ id: "mcp-3", kind: "tool_call", toolName: "mcp", text: 'mcp {"tool":"recall"}' }),
		])).toEqual([
			{ identity: "engineering-skills/skill-trek", codes: ["mcp-1", "mcp-2"] },
			{ identity: "recall", codes: ["mcp-3"] },
		]);
	});

	it("uses the first forty task characters for subagent identities", () => {
		const task = "check pi-vcc extractors and verify the focused retrieval flow";
		expect(buildMcpIndex([
			block({ id: "subagent-1", kind: "tool_call", toolName: "subagent", text: `subagent ${JSON.stringify({ task })}` }),
		])).toEqual([{ identity: `subagent/${task.slice(0, 40)}`, codes: ["subagent-1"] }]);
	});

	it("excludes file tools and returns empty for file-only groups", () => {
		expect(buildMcpIndex([
			block({ id: "read-1", kind: "tool_call", toolName: "read", text: '{"path":"src/a.ts"}' }),
			block({ id: "write-1", kind: "tool_call", toolName: "write", text: '{"path":"src/b.ts"}' }),
		])).toEqual([]);
	});

	it("caps the index at six distinct identities", () => {
		const calls = Array.from({ length: 7 }, (_, index) => block({
			id: `bash-${index}`,
			kind: "tool_call",
			toolName: `tool-${index}`,
			text: "",
		}));

		expect(buildMcpIndex(calls)).toHaveLength(6);
		expect(buildMcpIndex(calls).map((entry) => entry.identity)).toEqual([
			"tool-0", "tool-1", "tool-2", "tool-3", "tool-4", "tool-5",
		]);
	});
});

describe("formatMcpIndex", () => {
	it("formats entries as an indented retrieval index", () => {
		expect(formatMcpIndex([
			{ identity: "engineering-skills/skill-trek", codes: ["r13", "r21"] },
			{ identity: "subagent/check pi-vcc extractors", codes: ["r32"] },
		])).toBe("[MCP Index]\n  engineering-skills/skill-trek → r13, r21\n  subagent/check pi-vcc extractors → r32");
	});

	it("returns an empty string for an empty index", () => {
		expect(formatMcpIndex([])).toBe("");
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

describe("buildSemanticDigest", () => {
	const meta = {
		foldCode: "a3f2b1",
		blockCount: 4,
		turnRange: "turns 3–8",
		tokens: 2400,
	};

	it("composes the header and every non-empty semantic section", () => {
		expect(buildSemanticDigest([
			block({ kind: "user", text: "implement auth flow" }),
			block({ kind: "tool_call", toolName: "read", text: '{"path":"src/auth/token.ts"}' }),
			block({ kind: "tool_result", isError: true, text: "403 Forbidden on /api/token" }),
			block({ id: "r13", kind: "tool_call", toolName: "mcp", text: 'mcp {"server":"engineering-skills","tool":"skill-trek"}' }),
		], meta)).toBe([
			"{#a3f2b1 FOLDED} group · 4 blocks · turns 3–8 · ~2400 tok",
			"[Asks] implement auth flow",
			"[Files] src/auth/token.ts",
			"[Errors] 403 Forbidden on /api/token",
			"[MCP Index]",
			"  engineering-skills/skill-trek → r13",
		].join("\n"));
	});

	it("omits empty sections", () => {
		expect(buildSemanticDigest([
			block({ kind: "tool_call", toolName: "read", text: '{"path":"src/auth/token.ts"}' }),
		], meta)).toBe([
			"{#a3f2b1 FOLDED} group · 4 blocks · turns 3–8 · ~2400 tok",
			"[Files] src/auth/token.ts",
		].join("\n"));

		expect(buildSemanticDigest([
			block({ id: "r32", kind: "tool_call", toolName: "mcp", text: 'mcp {"server":"engineering-skills","tool":"skill-trek"}' }),
		], meta)).toBe([
			"{#a3f2b1 FOLDED} group · 4 blocks · turns 3–8 · ~2400 tok",
			"[MCP Index]",
			"  engineering-skills/skill-trek → r32",
		].join("\n"));
	});

	it("returns only the header when every section is empty", () => {
		expect(buildSemanticDigest([block({ kind: "text", text: "reply" })], meta)).toBe(
			"{#a3f2b1 FOLDED} group · 4 blocks · turns 3–8 · ~2400 tok",
		);
	});
});
