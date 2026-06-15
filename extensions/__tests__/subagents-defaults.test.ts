/**
 * Pure tests for the new subagents.default resolver.
 *
 * Verifies the layering rule: project overrides user overrides package,
 * and "inherit" at a more specific level clears the parent default.
 *
 * Mirrors the implementation in extensions/subagents.ts so the test
 * stays independent of @earendil-works/pi-coding-agent at runtime.
 *
 * Run: npx tsx extensions/__tests__/subagents-defaults.test.ts
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Reimplemented pure logic (must match extensions/subagents.ts exactly)
// ---------------------------------------------------------------------------

type ModelPreference = { kind: "inherit" } | { kind: "model"; value: string };

interface SubagentTypeDefaults {
	default?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseModelPreference(value: unknown): ModelPreference | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	if (trimmed === "inherit") return { kind: "inherit" };
	return { kind: "model", value: trimmed };
}

function readJsonObjectFile(filePath: string): Record<string, unknown> | undefined {
	if (!existsSync(filePath)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf8"));
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function readSubagentTypeDefaultsFromDirs(dirs: ReadonlyArray<string | undefined>): SubagentTypeDefaults {
	// Layering: dirs are passed in order from least to most specific.
	// More specific files override less specific. A "model" preference sets
	// the value; an explicit "inherit" preference clears it.
	const merged: SubagentTypeDefaults = {};
	for (const dir of dirs) {
		if (!dir) continue;
		const raw = readJsonObjectFile(join(dir, "models.json"));
		const block = raw && isRecord(raw.subagents) ? raw.subagents : undefined;
		if (!block) continue;
		const preference = parseModelPreference(block.default);
		if (!preference) continue;
		if (preference.kind === "model") merged.default = preference.value;
		else merged.default = undefined;
	}
	return merged;
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeTempRoot(): string {
	const root = join(tmpdir(), `pi-subagent-defaults-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
	mkdirSync(root, { recursive: true });
	return root;
}

function writeModelsJson(dir: string, body: Record<string, unknown>): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "models.json"), `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("returns empty defaults when no models.json files exist", () => {
	const root = makeTempRoot();
	try {
		const result = readSubagentTypeDefaultsFromDirs([join(root, "pkg"), join(root, "user"), join(root, "proj")]);
		assert.deepEqual(result, {});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("returns empty defaults when models.json has no subagents block", () => {
	const root = makeTempRoot();
	try {
		writeModelsJson(join(root, "pkg"), { defaultModel: "x/y", agents: { foo: "x/y" } });
		const result = readSubagentTypeDefaultsFromDirs([join(root, "pkg")]);
		assert.deepEqual(result, {});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("reads subagents.default from the package dir when only it is set", () => {
	const root = makeTempRoot();
	try {
		writeModelsJson(join(root, "pkg"), { subagents: { default: "github-copilot/claude-sonnet-4.6" } });
		const result = readSubagentTypeDefaultsFromDirs([join(root, "pkg"), join(root, "user"), join(root, "proj")]);
		assert.equal(result.default, "github-copilot/claude-sonnet-4.6");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("project overrides user overrides package", () => {
	const root = makeTempRoot();
	try {
		writeModelsJson(join(root, "pkg"), { subagents: { default: "anthropic/claude-opus-4-8" } });
		writeModelsJson(join(root, "user"), { subagents: { default: "github-copilot/claude-opus-4.7" } });
		writeModelsJson(join(root, "proj"), { subagents: { default: "github-copilot/claude-sonnet-4.6" } });
		const result = readSubagentTypeDefaultsFromDirs([join(root, "pkg"), join(root, "user"), join(root, "proj")]);
		assert.equal(result.default, "github-copilot/claude-sonnet-4.6");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("user overrides package when project file is missing", () => {
	const root = makeTempRoot();
	try {
		writeModelsJson(join(root, "pkg"), { subagents: { default: "anthropic/claude-opus-4-8" } });
		writeModelsJson(join(root, "user"), { subagents: { default: "github-copilot/claude-opus-4.7" } });
		const result = readSubagentTypeDefaultsFromDirs([join(root, "pkg"), join(root, "user"), undefined]);
		assert.equal(result.default, "github-copilot/claude-opus-4.7");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('"inherit" at a more specific level clears a parent default', () => {
	const root = makeTempRoot();
	try {
		writeModelsJson(join(root, "pkg"), { subagents: { default: "github-copilot/claude-sonnet-4.6" } });
		writeModelsJson(join(root, "proj"), { subagents: { default: "inherit" } });
		const result = readSubagentTypeDefaultsFromDirs([join(root, "pkg"), undefined, join(root, "proj")]);
		assert.equal(result.default, undefined);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("invalid JSON in models.json is ignored, not thrown", () => {
	const root = makeTempRoot();
	try {
		mkdirSync(join(root, "pkg"), { recursive: true });
		writeFileSync(join(root, "pkg", "models.json"), "not json at all", "utf8");
		writeModelsJson(join(root, "user"), { subagents: { default: "github-copilot/claude-sonnet-4.6" } });
		const result = readSubagentTypeDefaultsFromDirs([join(root, "pkg"), join(root, "user"), undefined]);
		assert.equal(result.default, "github-copilot/claude-sonnet-4.6");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("non-string subagents.default is ignored", () => {
	const root = makeTempRoot();
	try {
		writeModelsJson(join(root, "pkg"), { subagents: { default: 42 } });
		writeModelsJson(join(root, "user"), { subagents: { default: "github-copilot/claude-sonnet-4.6" } });
		const result = readSubagentTypeDefaultsFromDirs([join(root, "pkg"), join(root, "user"), undefined]);
		assert.equal(result.default, "github-copilot/claude-sonnet-4.6");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
