import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "subagents.ts"), "utf8");

test("ordinary subagents remain isolated from packet-only SDK tools", () => {
	assert.doesNotMatch(source, /aiknow/);
	assert.match(source, /resourceLoaderOptions:\s*\{[\s\S]*?noExtensions:\s*true/);
	assert.match(source, /customTools: reportTool \? \[reportTool\] : undefined/);
	assert.match(source, /tools: packet \? \[\.\.\.config\.tools, "report_verification"\] : config\.tools/);
});
