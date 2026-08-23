import { describe, expect, it } from "vitest";
import { richDigest } from "./block-digest";
import type { ExtractableBlock } from "./extractors";

const block = (shape: ExtractableBlock): ExtractableBlock => shape;

describe("richDigest", () => {
	it("formats read blocks with paired paths and tokens", () => {
		expect(richDigest(
			block({ kind: "tool_result", toolName: "read", tokens: 8400 }),
			{ path: "src/lib/engine/store.svelte.ts" },
		)).toBe("📄 src/lib/engine/store.svelte.ts (~8.4k tok)");
	});

	it("formats subagent blocks from paired arguments and truncates tasks", () => {
		const task = "find how ReplaceCommand is used for fold digests";
		expect(richDigest(
			block({ kind: "tool_result", toolName: "subagent", tokens: 2100 }),
			{ type: "explore", task },
		)).toBe(`🔀 explore: "${task}" (~2.1k tok)`);
		expect(richDigest(
			block({ kind: "tool_result", toolName: "subagent" }),
			{ type: "explore", task: "x".repeat(100) },
		)).toBe(`🔀 explore: "${"x".repeat(80)}"`);
	});

	it("formats errors without a token suffix", () => {
		expect(richDigest(block({
			kind: "tool_result",
			isError: true,
			text: "\nTypeError: Cannot read property 'x' of undefined\ndetails",
			tokens: 8400,
		}))).toBe("❌ TypeError: Cannot read property 'x' of undefined");
	});

	it("uses the first meaningful assistant sentence", () => {
		expect(richDigest(block({
			kind: "text",
			text: "Let me inspect the fold digest. The engine owns the recovery tag.",
			tokens: 300,
		}))).toBe("🤖 \"The engine owns the recovery tag.\" (~0.3k tok)");
	});

	it("formats thinking and MCP server-prefixed blocks", () => {
		expect(richDigest(block({ kind: "thinking", tokens: 12000 }))).toBe("💭 (~12k tok)");
		expect(richDigest(block({ kind: "tool_result", toolName: "mcp__engineering-skills__skill-reference", tokens: 1200 })))
			.toBe("🔌 engineering-skills/skill-reference (~1.2k tok)");
	});

	it("returns undefined for unrecognized tools", () => {
		expect(richDigest(block({ kind: "tool_result", toolName: "browser_inspect", tokens: 100 }))).toBeUndefined();
	});
});
