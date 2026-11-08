import assert from "node:assert/strict";
import { test } from "node:test";
import { inheritExtensionProviders, recordBridgePromptCapture } from "../subagents.ts";

test("subagent runtimes inherit the parent's extension providers", () => {
  const native = { id: "codex-2" };
  const parent = {
    getRegisteredProviderIds: () => ["claude-bridge", "claude-bridge-2", "codex-2", "broken"],
    getRegisteredNativeProvider: (id: string) => (id === "codex-2" ? native : undefined),
    getRegisteredProviderConfig: (id: string) => (id.startsWith("claude") ? { api: id } : id === "broken" ? { api: "x" } : undefined),
  };
  const seen: unknown[] = [];
  const child = {
    registerProvider: (id: string, config: unknown) => {
      if (id === "broken") throw new Error("bad");
      seen.push([id, config]);
    },
    registerNativeProvider: (provider: unknown) => seen.push(provider),
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    inheritExtensionProviders(parent as never, child as never);
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(seen, [["claude-bridge", { api: "claude-bridge" }], ["claude-bridge-2", { api: "claude-bridge-2" }], native]);
  assert.doesNotThrow(() => inheritExtensionProviders(parent as never, undefined));
  assert.doesNotThrow(() => inheritExtensionProviders({} as never, child as never));
});

test("child prompts are recorded in claude-bridge's shared capture registry", () => {
  const key = Symbol.for("claude-bridge:promptCaptures");
  const g = globalThis as Record<symbol, unknown>;
  const previous = g[key];
  const recorded: unknown[] = [];
  try {
    delete g[key];
    assert.doesNotThrow(() => recordBridgePromptCapture({ systemPrompt: "p" }, "session"));
    g[key] = { record: (...args: unknown[]) => recorded.push(args) };
    const contextFiles = [{ path: "AGENTS.md", content: "x" }];
    recordBridgePromptCapture({
      systemPrompt: "child prompt",
      _baseSystemPromptOptions: { appendSystemPrompt: "agent role", contextFiles, skills: ["s"], selectedTools: ["bash"] },
    } as never, "turn_start");
    recordBridgePromptCapture({ systemPrompt: "" }, "session");
    assert.deepEqual(recorded, [[
      "child prompt",
      { custom: undefined, append: "agent role", contextFiles, skills: [], sections: undefined },
      "subagent:turn_start",
    ]]);
  } finally {
    g[key] = previous;
  }
});
