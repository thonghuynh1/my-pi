import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { bindBridgeRegistry, claudeCloneConfig, fallbackBridgeModels, relabelForBridge } from "../lib/claude-providers.ts";
import type { ClaudeProfile } from "../lib/claude-profiles.ts";

const ACTIVE = Symbol.for("claude-bridge:activeStreamSimple");
const loggedInDir = mkdtempSync(path.join(tmpdir(), "claude-2-"));
writeFileSync(path.join(loggedInDir, ".credentials.json"), "{}");
const profile: ClaudeProfile = { id: "claude-2", index: 2, name: "Claude 2", configDir: loggedInDir, provider: "claude-bridge-2", useApiKey: false };

test("clone calls the bridge with its profile's dir and no API key, then restores env", () => {
  const g = globalThis as Record<symbol, unknown>;
  const previous = g[ACTIVE];
  const savedDir = process.env.CLAUDE_CONFIG_DIR;
  const savedKey = process.env.ANTHROPIC_API_KEY;
  const seen: unknown[] = [];
  g[ACTIVE] = (model: unknown, context: { messages: { provider?: string }[] }) => {
    seen.push(process.env.CLAUDE_CONFIG_DIR, process.env.ANTHROPIC_API_KEY, model, context.messages.map((m) => m.provider));
    return "stream";
  };
  try {
    process.env.CLAUDE_CONFIG_DIR = "/c1";
    process.env.ANTHROPIC_API_KEY = "work-key";
    const config = claudeCloneConfig(profile, [{ id: "claude-sonnet-5" }]);
    assert.equal(config.api, "claude-bridge-2");
    assert.equal(config.baseUrl, "claude-bridge");
    const context = { messages: [{ role: "assistant", provider: "claude-bridge-2" }, { role: "assistant", provider: "openai-codex" }, { role: "user" }] };
    assert.equal(config.streamSimple({ id: "m" }, context), "stream");
    assert.deepEqual(seen, [loggedInDir, undefined, { id: "m" }, ["claude-bridge", "openai-codex", undefined]]);
    assert.equal(process.env.CLAUDE_CONFIG_DIR, "/c1");
    assert.equal(process.env.ANTHROPIC_API_KEY, "work-key");
  } finally {
    g[ACTIVE] = previous;
    if (savedDir === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = savedDir;
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = savedKey;
  }
});

test("clone fails clearly without the bridge, and strips registry fields from models", () => {
  const g = globalThis as Record<symbol, unknown>;
  const previous = g[ACTIVE];
  delete g[ACTIVE];
  try {
    const config = claudeCloneConfig(profile, [{ id: "x", provider: "claude-bridge", api: "claude-bridge", baseUrl: "claude-bridge", name: "X" } as never]);
    assert.deepEqual(config.models, [{ id: "x", name: "X" }]);
    assert.throws(() => config.streamSimple({}, { messages: [] }), /pi-claude-bridge is not loaded/);
  } finally {
    g[ACTIVE] = previous;
  }
});

test("clone falls back to the bridge provider registered in the session after the global is cleared", () => {
  const g = globalThis as Record<symbol, unknown>;
  const previous = g[ACTIVE];
  delete g[ACTIVE];
  bindBridgeRegistry({ getRegisteredProviderConfig: (name) => (name === "claude-bridge" ? { streamSimple: () => "registered" } : undefined) });
  try {
    assert.equal(claudeCloneConfig(profile, []).streamSimple({}, { messages: [] }), "registered");
  } finally {
    bindBridgeRegistry(undefined);
    g[ACTIVE] = previous;
  }
});

test("clone asks to log in when the profile dir has no login", () => {
  const empty = mkdtempSync(path.join(tmpdir(), "claude-3-"));
  const config = claudeCloneConfig({ ...profile, name: "Claude 3", configDir: empty }, []);
  assert.throws(() => config.streamSimple({}, { messages: [] }), /Claude 3 is not logged in[\s\S]*claude login/);
});

test("relabel leaves non-message contexts alone; fallback models skip dated snapshots and are free", () => {
  assert.deepEqual(relabelForBridge({ prompt: "x" }, "claude-bridge-2"), { prompt: "x" });
  const models = fallbackBridgeModels();
  assert.ok(models.length > 0);
  assert.ok(models.every((m) => !/-20\d{6}$/.test(m.id) && m.cost.input === 0));
});
