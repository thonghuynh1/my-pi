import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type Component } from "@earendil-works/pi-tui";
import usageFooter, { layoutUsageLines } from "../usage-footer.ts";
import { ProviderUsageMonitor, type MonitorClock } from "../lib/provider-usage/monitor.ts";
import type { ProviderReader } from "../lib/provider-usage/readers.ts";

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture(mode = "tui") {
  const callbacks = new Map<string, ((event: unknown, ctx: ExtensionCommandContext) => void)[]>();
  const commands = new Map<string, { handler(args: string, ctx: ExtensionCommandContext): Promise<void> }>();
  const intervals = new Set<() => void>();
  const timeouts = new Set<() => void>();
  let reads = 0;
  const clock: MonitorClock = {
    now: () => 1_000,
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
  const monitor = new ProviderUsageMonitor(readers, clock);
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

test("subagent status removed, but tokens/cache/billed cost breakdown retained", async () => {
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
