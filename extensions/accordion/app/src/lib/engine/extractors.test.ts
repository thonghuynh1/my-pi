import { describe, expect, it } from "vitest";
import {
	buildMcpIndex,
	buildSemanticDigest,
	extractAsks,
	extractErrors,
	extractFiles,
	blockTier,
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
			block({ kind: "tool_call", toolName: " READ ", text: '{"path": "src/a.ts"}' }),
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
	it("groups canonical MCP identities and collects result recall codes", () => {
		expect(buildMcpIndex([
			block({ kind: "tool_call", toolName: "mcp", retrievalIdentity: "engineering-skills/skill-trek · fp:a", recallCode: "result-1" }),
			block({ kind: "tool_call", toolName: "mcp", retrievalIdentity: "engineering-skills/skill-trek · fp:a", recallCode: "result-2" }),
			block({ kind: "tool_call", toolName: "mcp", retrievalIdentity: "mcp/recall · fp:b", recallCode: "result-3" }),
		])).toEqual([
			{ identity: "engineering-skills/skill-trek · fp:a", codes: ["result-1", "result-2"] },
			{ identity: "mcp/recall · fp:b", codes: ["result-3"] },
		]);
	});

	it("uses the first forty task characters for subagent identities", () => {
		const task = "check pi-vcc extractors and verify the focused retrieval flow";
		expect(buildMcpIndex([
			block({ kind: "tool_call", toolName: "subagent", text: `subagent ${JSON.stringify({ task })}`, recallCode: "subagent-result" }),
		])).toEqual([{ identity: `subagent/${task.slice(0, 40)}`, codes: ["subagent-result"] }]);
	});

	it("omits tool calls without a retrievable result code", () => {
		expect(buildMcpIndex([
			block({ kind: "tool_call", toolName: "subagent", text: 'subagent {"task":"unfinished"}' }),
			block({ kind: "tool_call", toolName: "mcp", retrievalIdentity: "server/tool · fp:a" }),
		])).toEqual([]);
	});

	it("excludes file tools and returns empty for file-only groups", () => {
		expect(buildMcpIndex([
			block({ id: "read-1", kind: "tool_call", toolName: "read", text: '{"path":"src/a.ts"}' }),
			block({ id: "write-1", kind: "tool_call", toolName: "write", text: '{"path":"src/b.ts"}' }),
		])).toEqual([]);
	});

	it("caps the index at six distinct identities", () => {
		const calls = Array.from({ length: 7 }, (_, index) => block({
			kind: "tool_call",
			toolName: `tool-${index}`,
			recallCode: `result-${index}`,
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

describe("blockTier", () => {
	it.each(["edit", "write", "multiedit"])("returns high for %s tools", (toolName) => {
		expect(blockTier(block({ kind: "tool_call", toolName }))).toBe("high");
	});

	it("returns high for run_tests", () => {
		expect(blockTier(block({ kind: "tool_result", toolName: "run_tests" }))).toBe("high");
	});

	it("returns high for errors before other classifications", () => {
		expect(blockTier(block({ kind: "tool_result", toolName: "read", isError: true }))).toBe("high");
	});

	it.each([
		"npm test",
		"npx vitest run",
		"npx jest --runInBand",
		"pytest tests/test_app.py",
		"dotnet test App.Tests",
		"go test ./...",
		"cargo test --all",
		"mix test",
	])("returns high for bash test runner command %s", (text) => {
		expect(blockTier(block({ kind: "tool_result", toolName: "bash", text }))).toBe("high");
	});

	it("returns medium for user blocks", () => {
		expect(blockTier(block({ kind: "user" }))).toBe("medium");
	});

	it("returns medium for non-test bash", () => {
		expect(blockTier(block({ kind: "tool_result", toolName: "bash", text: "git status" }))).toBe("medium");
	});

	it("returns medium for assistant text", () => {
		expect(blockTier(block({ kind: "text" }))).toBe("medium");
	});

	it("returns medium for MCP and server-prefixed tools", () => {
		expect(blockTier(block({ kind: "tool_result", toolName: "mcp" }))).toBe("medium");
		expect(blockTier(block({ kind: "tool_result", toolName: "engineering-skills/skill-pstack" }))).toBe("medium");
	});

	it("returns low for file tools", () => {
		expect(blockTier(block({ kind: "tool_result", toolName: "read" }))).toBe("low");
		expect(blockTier(block({ kind: "tool_result", toolName: "find" }))).toBe("low");
		expect(blockTier(block({ kind: "tool_result", toolName: "grep" }))).toBe("low");
		expect(blockTier(block({ kind: "tool_result", toolName: "ls" }))).toBe("low");
	});

	it("uses the medium fallback for bash without text", () => {
		expect(blockTier(block({ kind: "tool_result", toolName: "bash", text: undefined }))).toBe("medium");
	});

	it("returns low by default", () => {
		expect(blockTier(block({ kind: "thinking" }))).toBe("low");
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
			block({ kind: "tool_call", toolName: "mcp", retrievalIdentity: "engineering-skills/skill-trek · fp:a", recallCode: "r13" }),
		], meta)).toBe([
			"{#a3f2b1 FOLDED} group · 4 blocks · turns 3–8 · ~2400 tok",
			"[Asks] implement auth flow",
			"[Files] src/auth/token.ts",
			"[Errors] 403 Forbidden on /api/token",
			"[MCP Index]",
			"  engineering-skills/skill-trek · fp:a → r13",
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
			block({ kind: "tool_call", toolName: "mcp", retrievalIdentity: "engineering-skills/skill-trek · fp:a", recallCode: "r32" }),
		], meta)).toBe([
			"{#a3f2b1 FOLDED} group · 4 blocks · turns 3–8 · ~2400 tok",
			"[MCP Index]",
			"  engineering-skills/skill-trek · fp:a → r32",
		].join("\n"));
	});

	it("returns only the header when every section is empty", () => {
		expect(buildSemanticDigest([block({ kind: "text", text: "reply" })], meta)).toBe(
			"{#a3f2b1 FOLDED} group · 4 blocks · turns 3–8 · ~2400 tok",
		);
	});
});
