import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type Component } from "@earendil-works/pi-tui";
import usageFooter, { estimateCursorPlanCost, layoutUsageLines } from "../usage-footer.ts";
import { ProviderUsageMonitor, type MonitorClock } from "../lib/provider-usage/monitor.ts";
import { UsageReadError, type ProviderReader } from "../lib/provider-usage/readers.ts";
import { parseClaude } from "../lib/provider-usage/model.ts";

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture(mode = "tui", options: { readers?: ProviderReader[]; now?: () => number } = {}) {
  const callbacks = new Map<string, ((event: unknown, ctx: ExtensionCommandContext) => void)[]>();
  const commands = new Map<string, { handler(args: string, ctx: ExtensionCommandContext): Promise<void> }>();
  const intervals = new Set<() => void>();
  const timeouts = new Set<() => void>();
  let reads = 0;
  const clock: MonitorClock = {
    now: options.now ?? (() => 1_000),
    every: (cb) => { intervals.add(cb); return cb; },
    after: (cb) => { timeouts.add(cb); return cb; },
    cancelEvery: (cb) => { intervals.delete(cb as () => void); },
    cancelAfter: (cb) => { timeouts.delete(cb as () => void); },
  };
  const readers: ProviderReader[] = [
    { id: "codex", name: "Codex", read: async () => { reads++; return { kind: "quota", groups: [{ id: "codex", name: "Codex", shortName: "Codex", windows: [
      { id: "5h", label: "5h", usedPercent: 69, resetsAt: 1792138480000 },
      { id: "week", label: "week", usedPercent: 16, resetsAt: 1792676195000 },
    ] }] }; } },
    { id: "copilot", name: "GitHub Copilot", experimental: true, read: async () => ({ kind: "credits", consumed: 54386 }) },
    { id: "cursor", name: "Cursor", experimental: true, read: async () => ({ kind: "quota", groups: [{ id: "cursor", name: "Cursor included plan", shortName: "Cursor", windows: [{ id: "month", label: "month", usedPercent: 42 }, { id: "auto", label: "Auto", usedPercent: 20 }, { id: "api", label: "API", usedPercent: 100 }] }] }) },
  ];
  const monitor = new ProviderUsageMonitor(options.readers ?? readers, clock);
  const tui = { terminal: { rows: 80 }, requestRender() { renders++; } };
  let renders = 0;
  let component: (Component & { dispose?(): void }) | undefined;
  let panel: (Component & { dispose?(): void }) | undefined;
  const installed: { renders: number; component: Component & { dispose?(): void } }[] = [];
  const theme = { fg: (_: string, value: string) => `\x1b[33m${value}\x1b[0m` };
  const ctx = {
    mode, hasUI: mode === "tui" || mode === "rpc",
    model: { provider: "test", id: "模型-wide" },
    getContextUsage: () => ({ tokens: 500, contextWindow: 100000, percent: 0.5 }),
    sessionManager: { getBranch: () => [{ type: "message", message: { role: "assistant", usage: {
      input: 100, output: 200, cacheRead: 300, cacheWrite: 400, totalTokens: 1000,
      cost: { input: 0.1, output: 0.2, cacheRead: 0.3, cacheWrite: 0.4 },
    } } }] },
    ui: {
      setFooter(factory: any) {
        component?.dispose?.(); component = undefined;
        if (!factory) return;
        const entry = { renders: 0, component: undefined as any };
        entry.component = component = factory({ ...tui, requestRender: () => { entry.renders++; renders++; } }, theme);
        installed.push(entry);
      },
      notify() {},
      custom(factory: any) {
        return new Promise<void>((resolve) => {
          panel = factory(tui, theme, {}, () => { panel?.dispose?.(); panel = undefined; resolve(); });
        });
      },
    },
  } as unknown as ExtensionCommandContext;
  const pi = {
    on(name: string, cb: (event: unknown, ctx: ExtensionCommandContext) => void) { callbacks.set(name, [...(callbacks.get(name) ?? []), cb]); },
    registerCommand(name: string, command: any) { commands.set(name, command); },
    registerTool() { assert.fail("must not register model-callable tools"); },
    getThinkingLevel: () => "medium", getActiveTools: () => [], setActiveTools() {},
  } as unknown as ExtensionAPI;
  usageFooter(pi, monitor);
  return {
    ctx, monitor, intervals, timeouts, installed,
    reads: () => reads, renders: () => renders, footer: () => component, panel: () => panel,
    emit: (name: string) => { for (const cb of callbacks.get(name) ?? []) cb({}, ctx); },
    command: (name: string, args = "") => { const command = commands.get(name); assert(command, `${name} is registered`); return command.handler(args, ctx); },
  };
}

test("factory has no work; startup refresh is asynchronous and independent of Pi model", async () => {
  const f = fixture();
  assert.equal(f.reads(), 0); assert.equal(f.intervals.size, 0); assert.equal(f.footer(), undefined);
  f.emit("session_start");
  assert(f.footer()); assert.equal(f.reads(), 0);
  await flush();
  assert.equal(f.reads(), 1); assert.equal(f.intervals.size, 1);
  const lines = f.footer()!.render(180);
  assert.match(lines[0], /model test\/模型-wide \(medium\)/);
  assert.equal(lines.length, 3);
  assert.match(lines[1], /Codex 5h-69% wk-16%/);
  assert.match(lines[2], /Copilot \$544/);
  assert.match(lines[2], /Cursor M-42% A-20% API-100%/);
  assert(f.renders() > 0);
  f.emit("session_shutdown");
  assert.equal(f.intervals.size, 0); assert.equal(f.timeouts.size, 0);
});

test("off persists; repeated installs/on never duplicate timers or subscriptions", async () => {
  const f = fixture();
  f.emit("session_start"); await flush();
  await f.command("usage-footer", "off");
  assert.equal(f.footer(), undefined); assert.equal(f.intervals.size, 0);
  const reads = f.reads();
  for (const name of ["model_select", "thinking_level_select", "agent_start", "turn_end", "agent_end", "session_start"]) f.emit(name);
  await flush();
  assert.equal(f.footer(), undefined); assert.equal(f.intervals.size, 0); assert.equal(f.reads(), reads);
  await f.command("usage-footer", "on"); await flush();
  assert.equal(f.intervals.size, 1);
  const count = f.reads();
  await f.command("usage-footer", "on");
  for (let i = 0; i < 3; i++) f.emit("model_select");
  await flush();
  assert.equal(f.intervals.size, 1); assert.equal(f.reads(), count);
  const oldCounters = f.installed.slice(0, -1).map((entry) => entry.renders);
  await f.monitor.refresh();
  assert.deepEqual(f.installed.slice(0, -1).map((entry) => entry.renders), oldCounters);
  assert(f.installed.at(-1)!.renders > 0);
  f.emit("session_shutdown");
});

test("subagent status removed, but tokens/cache/session cost breakdown retained", async () => {
  const globals = globalThis as { __subagent?: unknown };
  const old = globals.__subagent;
  globals.__subagent = { enabled: true, active: 3, label: "on · 3 running", totalCostUsd: 2, totalTokens: 800,
    totalInputTokens: 200, totalOutputTokens: 300, totalCacheTokens: 300 };
  const f = fixture();
  try {
    f.emit("session_start"); await flush();
    const output = f.footer()!.render(200).join("\n");
    assert.match(output, /in 300 · out 500 · cache 1.0k/);
    assert.match(output, /total 1.8k · \$3.000 \(\$1.000 \+ \$2.000 sub\)/);
    assert(!/subagent|running|on ·/.test(output));
  } finally { f.emit("session_shutdown"); globals.__subagent = old; }
});

test("reported subscription dollars contribute to the main session total", async () => {
  const f = fixture();
  const branch = [
    { type: "message", message: { role: "assistant", provider: "test", usage: {
      input: 10, output: 20, cacheRead: 30, cacheWrite: 40, totalTokens: 100,
      cost: { total: 1 },
    } } },
    { type: "message", message: { role: "assistant", provider: "claude-bridge", usage: {
      input: 100, output: 200, cacheRead: 300, cacheWrite: 400, totalTokens: 1000,
      cost: { total: 4.5 },
    } } },
  ];
  (f.ctx.sessionManager as unknown as { getBranch: () => unknown[] }).getBranch = () => branch;
  f.emit("session_start"); await flush();
  const output = f.footer()!.render(200).join("\n");
  assert.match(output, /total 1\.1k · \$5\.500/);
  assert.doesNotMatch(output, /plan|~/);
  f.emit("session_shutdown");
});

test("unknown subscription models retain tokens but add no estimated dollars", async () => {
  const f = fixture();
  const branch = [
    { type: "message", message: { role: "assistant", provider: "claude-bridge", usage: {
      input: 100, output: 200, cacheRead: 300, cacheWrite: 400, totalTokens: 1000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    } } },
  ];
  (f.ctx.sessionManager as unknown as { getBranch: () => unknown[] }).getBranch = () => branch;
  f.emit("session_start"); await flush();
  const output = f.footer()!.render(200).join("\n");
  assert.match(output, /total 1\.0k · \$0\.0000/);
  assert.doesNotMatch(output, /plan|~/);
  f.emit("session_shutdown");
});

test("known subscription models add estimated dollars to the main session total", async () => {
  const f = fixture();
  const zeroCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  const branch = [
    { type: "message", message: { role: "assistant", provider: "claude-bridge", model: "claude-opus-5-5", usage: {
      input: 100000, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 100000, cost: zeroCost,
    } } },
    { type: "message", message: { role: "assistant", provider: "claude-bridge", model: "claude-unknown-future", usage: {
      input: 1000, output: 500, cacheRead: 300, cacheWrite: 200, totalTokens: 2000, cost: zeroCost,
    } } },
  ];
  (f.ctx.sessionManager as unknown as { getBranch: () => unknown[] }).getBranch = () => branch;
  f.emit("session_start"); await flush();
  const output = f.footer()!.render(200).join("\n");
  assert.match(output, /total 102\.0k · \$0\.4000/);
  assert.doesNotMatch(output, /plan|~/);
  f.emit("session_shutdown");
});

test("claude-code-cli uses reported dollars when positive and estimates otherwise", async () => {
  for (const reported of [0, -1, 2]) {
    const f = fixture();
    (f.ctx.sessionManager as unknown as { getBranch: () => unknown[] }).getBranch = () => [
      { type: "message", message: { role: "assistant", provider: "claude-code-cli", model: "claude-opus-5-5", usage: {
        input: 100000, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 100000,
        cost: { total: reported },
      } } },
    ];
    try {
      f.emit("session_start"); await flush();
      const output = f.footer()!.render(200).join("\n");
      assert(output.includes(`total 100.0k · $${reported > 0 ? "2.000" : "0.4000"}`));
      assert.doesNotMatch(output, /plan|~/);
    } finally { f.emit("session_shutdown"); }
  }
});

test("Sonnet subscription estimate includes input, output, cache read and cache write", async () => {
  const f = fixture();
  (f.ctx.sessionManager as unknown as { getBranch: () => unknown[] }).getBranch = () => [
    { type: "message", message: { role: "assistant", provider: "claude-bridge", model: "claude-sonnet-4-6", usage: {
      input: 1000000, output: 1000000, cacheRead: 1000000, cacheWrite: 1000000,
      totalTokens: 4000000, cost: { total: 0 },
    } } },
  ];
  try {
    f.emit("session_start"); await flush();
    const output = f.footer()!.render(200).join("\n");
    assert.match(output, /in 1\.0m · out 1\.0m · cache 2\.0m/);
    assert.match(output, /total 4\.0m · \$22\.050/);
    assert.doesNotMatch(output, /plan|~/);
  } finally { f.emit("session_shutdown"); }
});

test("subscription estimates use exact model prices rather than Claude family prices", async () => {
  for (const [model, dollars] of [
    ["claude-opus-4-6", "0.5000"],
    ["claude-opus-5-5", "0.4000"],
    ["claude-fable-5", "1.000"],
  ]) {
    const f = fixture();
    (f.ctx.sessionManager as unknown as { getBranch: () => unknown[] }).getBranch = () => [
      { type: "message", message: { role: "assistant", provider: "claude-bridge", model, usage: {
        input: 100000, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 100000,
        cost: { total: 0 },
      } } },
    ];
    try {
      f.emit("session_start"); await flush();
      const output = f.footer()!.render(200).join("\n");
      assert(output.includes(`total 100.0k · $${dollars}`), `${model}: ${output}`);
    } finally { f.emit("session_shutdown"); }
  }
});

test("Sonnet 5.5 subscription estimate uses its exact cache prices", async () => {
  const f = fixture();
  (f.ctx.sessionManager as unknown as { getBranch: () => unknown[] }).getBranch = () => [
    { type: "message", message: { role: "assistant", provider: "claude-bridge", model: "claude-sonnet-5-5", usage: {
      input: 1000000, output: 1000000, cacheRead: 1000000, cacheWrite: 1000000,
      totalTokens: 4000000, cost: { total: 0 },
    } } },
  ];
  try {
    f.emit("session_start"); await flush();
    const output = f.footer()!.render(200).join("\n");
    // Independently priced: $2 input + $10 output + $0.10 read + $2.50 write.
    assert.match(output, /total 4\.0m · \$14\.600/);
  } finally { f.emit("session_shutdown"); }
});

test("Haiku 5.5 tier changes only above 100000 prompt tokens including caches", async () => {
  for (const [input, dollars] of [[20000, "0.0079"], [20001, "0.0395"]] as const) {
    const f = fixture();
    (f.ctx.sessionManager as unknown as { getBranch: () => unknown[] }).getBranch = () => [
      { type: "message", message: { role: "assistant", provider: "claude-bridge", model: "claude-haiku-5-5", usage: {
        input, output: 1000, cacheRead: 40000, cacheWrite: 40000,
        totalTokens: input + 81000, cost: { total: 0 },
      } } },
    ];
    try {
      f.emit("session_start"); await flush();
      const output = f.footer()!.render(200).join("\n");
      // 100000 prompt: .002 + .0005 + .0004 + .005 = .0079.
      // 100001 prompt: .0100005 + .0025 + .002 + .025 = .0395005.
      // Output tokens must not trigger the higher prompt tier at the boundary.
      assert(output.includes(`total 101.0k · $${dollars}`), `input=${input}: ${output}`);
    } finally { f.emit("session_shutdown"); }
  }
});

test("subscription estimate falls back to exact model pricing when usage.cost is absent", async () => {
  const f = fixture();
  (f.ctx.sessionManager as unknown as { getBranch: () => unknown[] }).getBranch = () => [
    { type: "message", message: { role: "assistant", provider: "claude-code-cli", model: "claude-opus-5-5", usage: {
      input: 100000, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 100000,
    } } },
  ];
  try {
    f.emit("session_start"); await flush();
    const output = f.footer()!.render(200).join("\n");
    assert.match(output, /total 100\.0k · \$0\.4000/);
  } finally { f.emit("session_shutdown"); }
});

test("non-subscription providers with Claude models and explicit zero cost are never estimated", async () => {
  const f = fixture();
  (f.ctx.sessionManager as unknown as { getBranch: () => unknown[] }).getBranch = () => [
    { type: "message", message: { role: "assistant", provider: "anthropic", model: "claude-opus-5-5", usage: {
      input: 100000, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 100000,
      cost: { total: 0 },
    } } },
  ];
  try {
    f.emit("session_start"); await flush();
    const output = f.footer()!.render(200).join("\n");
    assert.match(output, /total 100\.0k · \$0\.0000/);
    assert.doesNotMatch(output, /plan|~/);
  } finally { f.emit("session_shutdown"); }
});

test("mixed subscription, metered and subagent dollars are each counted once", async () => {
  const globals = globalThis as { __subagent?: unknown };
  const old = globals.__subagent;
  globals.__subagent = { totalCostUsd: 2, totalTokens: 800,
    totalInputTokens: 200, totalOutputTokens: 300, totalCacheTokens: 300 };
  const f = fixture();
  (f.ctx.sessionManager as unknown as { getBranch: () => unknown[] }).getBranch = () => [
    { type: "message", message: { role: "assistant", provider: "test", usage: {
      input: 10, output: 20, cacheRead: 30, cacheWrite: 40, totalTokens: 100,
      cost: { input: 0.1, output: 0.2, cacheRead: 0.3, cacheWrite: 0.4 },
    } } },
    { type: "message", message: { role: "assistant", provider: "claude-bridge", model: "claude-opus-5-5", usage: {
      input: 100, output: 200, cacheRead: 300, cacheWrite: 400, totalTokens: 1000,
      cost: { total: 4.5 },
    } } },
    { type: "message", message: { role: "assistant", provider: "claude-code-cli", model: "claude-opus-5-5", usage: {
      input: 100000, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 100000,
      cost: { total: 0 },
    } } },
  ];
  try {
    f.emit("session_start"); await flush();
    const output = f.footer()!.render(240).join("\n");
    assert.match(output, /total 101\.9k · \$7\.900 \(\$5\.900 \+ \$2\.000 sub\)/);
    assert.doesNotMatch(output, /plan|~/);
  } finally { f.emit("session_shutdown"); globals.__subagent = old; }
});

test("Cursor standard list-price estimates count cache separately and preserve recorded usage", async () => {
  for (const model of ["grok-4.5", "grok-4.6", "grok-4.7"]) {
    const f = fixture();
    const usage = { input: 100000, output: 10000, cacheRead: 100000, cacheWrite: 10000,
      totalTokens: 220000, cost: { total: 0 } };
    const original = structuredClone(usage);
    (f.ctx.sessionManager as unknown as { getBranch: () => unknown[] }).getBranch = () => [
      { type: "message", message: { role: "assistant", provider: "cursor", model, usage } },
    ];
    try {
      f.emit("session_start"); await flush();
      const output = f.footer()!.render(240).join("\n");
      // .2 input + .06 output + .05 cache read + .02 cache write.
      assert.match(output, /total 220\.0k · \$0\.3300 est/);
      assert.match(output, /in 100\.0k · out 10\.0k · cache 110\.0k/);
      assert.deepEqual(usage, original);
    } finally { f.emit("session_shutdown"); }
  }
});

test("Cursor estimates use the full prompt for Grok 4.7 long-context pricing, not output", () => {
  assert.equal(estimateCursorPlanCost({ input: 156000, cacheRead: 100000, output: 10000 }, "grok-4.7"), 0.422);
  assert.equal(estimateCursorPlanCost({ input: 156001, cacheRead: 100000, output: 10000 }, "grok-4.7"), 0.844004);
  assert.equal(estimateCursorPlanCost({ input: 156001, cacheRead: 100000, output: 10000 }, "grok-4.5"), 0.422002);
  assert.equal(estimateCursorPlanCost({ input: 100000, output: 10000, cacheRead: 100000 }, "composer-2.5"), 0.095);
  assert.equal(estimateCursorPlanCost({ input: -1 }, "grok-4.7"), undefined);
  assert.equal(estimateCursorPlanCost({ output: NaN }, "grok-4.7"), undefined);
});

test("Cursor positive reported dollars win; Auto remains unpriced instead of borrowing another model's rate", async () => {
  for (const [model, reported, expected] of [
    ["grok-4.7", 2, "total 100.0k · $2.000"],
    ["default", 0, "total 100.0k · $0.0000 + unpriced Cursor"],
    ["gpt-unknown", 0, "total 100.0k · $0.0000 + unpriced Cursor"],
    ["claude-opus-5-5", 0, "total 100.0k · $0.4000 est"],
  ] as const) {
    const f = fixture();
    (f.ctx.sessionManager as unknown as { getBranch: () => unknown[] }).getBranch = () => [
      { type: "message", message: { role: "assistant", provider: "cursor", model, usage: {
        input: 100000, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 100000, cost: { total: reported },
      } } },
    ];
    try {
      f.emit("session_start"); await flush();
      const output = f.footer()!.render(240).join("\n");
      assert(output.includes(expected), output);
      if (reported > 0) assert(!output.includes(" est"));
    } finally { f.emit("session_shutdown"); }
  }
});

test("layout stays three rows with ANSI, CJK and narrow truncation", () => {
  const left = ["\x1b[33mctx 1/100 1%\x1b[0m", "in 1 · out 2", "total 3 · $1"];
  const model = "\x1b[32mmodel 模型/🦀 (high)\x1b[0m";
  const providers = ["Codex 5h 69% · week 16% used", "AG Gemini 5h 0% · week 0% used", "AG Claude/GPT 5h 0% · week 48.3% used", "Copilot 54,386 credits used", "Cursor month 42% · Auto 20% · API 100% used"];
  for (const width of [1, 2, 8, 20, 40, 80, 160]) {
    const lines = layoutUsageLines(left, model, providers, width);
    for (const line of lines) assert(visibleWidth(line) <= width, `width=${width}, ${visibleWidth(line)}: ${line}`);
    assert.equal(lines.length, 3);
    if (width >= 80) assert(lines[0].endsWith(model));
  }
  const narrow = layoutUsageLines(left, model, providers, 40);
  assert.equal(narrow.length, 3);
  assert.match(narrow[0], /ctx 1\/100/); assert.match(narrow[1], /in 1/);
  assert.match(narrow[2], /total 3/);
  assert.deepEqual(layoutUsageLines(left, model, providers, 0), []);
});

test("details share cache, refresh on r while off without polling, close by q or Escape", async () => {
  const f = fixture();
  f.emit("session_start"); await flush();
  await f.command("usage-footer", "off");
  const interaction = f.command("provider-usage"); await flush();
  assert(f.panel());
  const text = f.panel()!.render(100).join("\n");
  assert.match(text, /Provider account usage/);
  assert.match(text, /GitHub Copilot \(experimental internal API\)/);
  assert.match(text, /Cursor \(experimental internal API\)/);
  assert.match(text, /Monthly included plan [(]month[)]: 42% used/);
  assert.match(text, /Auto: 20% used/); assert.match(text, /API: 100% used/);
  assert.match(text, /Five-hour window [(]5h[)]: 69% used/); assert.match(text, /Weekly window [(]week[)]: 16% used/); assert.match(text, /Last success/);
  assert.equal(f.intervals.size, 0);
  const before = f.reads();
  f.panel()!.handleInput!("r"); await flush();
  assert.equal(f.reads(), before + 1); assert.equal(f.intervals.size, 0); assert.equal(f.footer(), undefined);
  for (const width of [1, 8, 20, 80]) for (const line of f.panel()!.render(width)) assert(visibleWidth(line) <= width);
  f.panel()!.handleInput!("q"); await interaction;
  assert.equal(f.panel(), undefined);
  const next = f.command("provider-usage"); await flush();
  f.panel()!.handleInput!("\x1b"); await next;
  assert.equal(f.panel(), undefined);
  f.emit("session_shutdown");
});

test("Claude manual rate-limit refresh preserves stale usage until timer updates the current footer and details", async () => {
  let now = Date.UTC(2026, 9, 27, 9, 0, 0);
  let outcome: "initial" | "limited" | "recovered" = "initial";
  let reads = 0;
  const reader: ProviderReader = {
    id: "claude-personal", name: "Claude Personal",
    read: async () => {
      reads++;
      if (outcome === "limited") throw new UsageReadError("Claude usage refresh rate limited");
      return parseClaude({ utilization: {
        five_hour: { utilization: outcome === "initial" ? 84 : 100 },
        seven_day: { utilization: outcome === "initial" ? 74 : 75 },
      } });
    },
  };
  const f = fixture("tui", { readers: [reader], now: () => now });
  f.emit("session_start"); await flush();
  const interaction = f.command("provider-usage"); await flush();
  const footer = f.footer()!;
  const panel = f.panel()!;
  const installs = f.installed.length;
  const footerRequests = f.installed.at(-1)!;
  const initial = f.monitor.snapshot()[0];
  assert.equal(initial.status, "available");
  assert.equal(initial.lastSuccess, now);
  assert.match(footer.render(200).join("\n"), /Claude-P 5h-84% wk-74%/);
  assert.match(panel.render(200).join("\n"), /Five-hour window [(]5h[)]: 84% used/);
  assert.match(panel.render(200).join("\n"), /Weekly window [(]week[)]: 74% used/);
  assert(!panel.render(200).join("\n").includes("stale"));

  now += 60_000;
  outcome = "limited";
  const beforeManual = reads;
  const beforeErrorRenders = f.renders();
  const beforeErrorFooterRenders = footerRequests.renders;
  panel.handleInput!("r"); await flush();
  assert.equal(reads, beforeManual + 1);
  const stale = f.monitor.snapshot()[0];
  assert.equal(stale.status, "error");
  assert.equal(stale.value, initial.value);
  assert.equal(stale.lastSuccess, initial.lastSuccess);
  assert.equal(stale.lastAttempt, now);
  assert.match(stale.error!, /refresh rate limited/);
  assert.match(footer.render(200).join("\n"), /Claude-P 5h-RL wk-74%\*/);
  const staleDetails = panel.render(200).join("\n");
  assert.match(staleDetails, /error \u00b7 stale/);
  assert.match(staleDetails, /Reason: Claude usage refresh rate limited/);
  assert.match(staleDetails, /Five-hour window [(]5h[)]: 84% used/);
  assert.match(staleDetails, /Weekly window [(]week[)]: 74% used/);
  assert(staleDetails.includes(`Last success: ${new Date(initial.lastSuccess!).toLocaleString()}`));
  assert(footerRequests.renders > beforeErrorFooterRenders);
  assert(f.renders() - beforeErrorRenders > footerRequests.renders - beforeErrorFooterRenders);

  now += 300_000;
  outcome = "recovered";
  const beforeTimer = reads;
  const beforeRecoveryRenders = f.renders();
  const beforeRecoveryFooterRenders = footerRequests.renders;
  assert.equal(f.intervals.size, 1);
  for (const tick of f.intervals) tick();
  await flush();
  assert.equal(reads, beforeTimer + 1);
  const recovered = f.monitor.snapshot()[0];
  assert.equal(recovered.status, "available");
  assert.equal(recovered.lastSuccess, now);
  assert.equal(recovered.error, undefined);
  assert.notEqual(recovered.value, initial.value);
  const recoveredFooter = footer.render(200).join("\n");
  assert.match(recoveredFooter, /Claude-P 5h-100% wk-75%/);
  assert(!recoveredFooter.includes("*"));
  const recoveredDetails = panel.render(200).join("\n");
  assert.match(recoveredDetails, /Five-hour window [(]5h[)]: 100% used/);
  assert.match(recoveredDetails, /Weekly window [(]week[)]: 75% used/);
  assert(recoveredDetails.includes(`Last success: ${new Date(now).toLocaleString()}`));
  assert(!/stale|Reason:|rate limited/.test(recoveredDetails));
  assert(footerRequests.renders > beforeRecoveryFooterRenders);
  assert(f.renders() - beforeRecoveryRenders > footerRequests.renders - beforeRecoveryFooterRenders);
  assert.equal(f.footer(), footer);
  assert.equal(f.panel(), panel);
  assert.equal(f.installed.length, installs);
  panel.handleInput!("q"); await interaction;
  f.emit("session_shutdown");
  assert.equal(f.intervals.size, 0);
  assert.equal(f.timeouts.size, 0);
});

test("shutdown closes details; RPC/print/json never install TUI or read providers", async () => {
  const f = fixture();
  f.emit("session_start"); await flush();
  const interaction = f.command("provider-usage"); await flush();
  f.emit("session_shutdown"); await interaction;
  assert.equal(f.panel(), undefined); assert.equal(f.intervals.size, 0);
  for (const mode of ["rpc", "print", "json"]) {
    const other = fixture(mode);
    other.emit("session_start");
    await other.command("usage-footer", "on"); await other.command("provider-usage"); await flush();
    assert.equal(other.footer(), undefined); assert.equal(other.panel(), undefined);
    assert.equal(other.reads(), 0); assert.equal(other.intervals.size, 0);
    other.emit("session_shutdown");
  }
});
