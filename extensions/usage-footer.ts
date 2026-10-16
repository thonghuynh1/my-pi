import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text, matchesKey, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { ProviderUsageMonitor } from "./lib/provider-usage/monitor.ts";
import { detailText, footerRows } from "./lib/provider-usage/model.ts";
import {
  createManagedExtension,
  loadCapabilityVisibilitySettings,
} from "./lib/capability-visibility.ts";

type AssistantUsage = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
};

// Returns the total USD cost of an assistant message robustly: prefers
// the SDK-precomputed `cost.total` (already includes cacheRead/cacheWrite
// at their proper rates), and falls back to summing the sub-fields if
// the provider forgot to fill `total`. Guarantees cache pricing always
// counts.
function totalCostOf(usage: AssistantUsage | undefined): number {
  if (!usage?.cost) return 0;
  if (typeof usage.cost.total === "number") return usage.cost.total;
  return (
    (usage.cost.input ?? 0) +
    (usage.cost.output ?? 0) +
    (usage.cost.cacheRead ?? 0) +
    (usage.cost.cacheWrite ?? 0)
  );
}

function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function formatMoney(value: number): string {
  if (!Number.isFinite(value)) return "$0.0000";
  if (value >= 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(4)}`;
}

function padRight(left: string, right: string, width: number): string {
  const available = width - visibleWidth(right) - (left ? 1 : 0);
  if (available < 0) return truncateToWidth(right, width);
  const rendered = truncateToWidth(left, available);
  return rendered + " ".repeat(Math.max(0, width - visibleWidth(rendered) - visibleWidth(right))) + right;
}

export function layoutUsageLines(left: string[], model: string, providers: string[], width: number): string[] {
  if (width <= 0) return [];
  const right = [model, ...providers];
  const widestLeft = Math.max(0, ...left.map(visibleWidth));
  const widestRight = Math.max(0, ...right.map(visibleWidth));
  if (widestLeft + widestRight + 2 > width) {
    return [padRight("", model, width), ...left.map((line) => truncateToWidth(line, width)), ...providers.map((line) => truncateToWidth(line, width))];
  }
  return Array.from({ length: Math.max(left.length, right.length) }, (_, index) => padRight(left[index] ?? "", right[index] ?? "", width));
}

function getSubagentTotals(): {
  cost: number;
  tokens: number;
  input: number;
  output: number;
  cache: number;
} {
  const s = (globalThis as {
    __subagent?: {
      totalCostUsd?: number;
      totalTokens?: number;
      totalInputTokens?: number;
      totalOutputTokens?: number;
      totalCacheTokens?: number;
    };
  }).__subagent;
  return {
    cost: s?.totalCostUsd ?? 0,
    tokens: s?.totalTokens ?? 0,
    input: s?.totalInputTokens ?? 0,
    output: s?.totalOutputTokens ?? 0,
    cache: s?.totalCacheTokens ?? 0,
  };
}

function getTokenTotals(ctx: ExtensionContext): {
  input: number;
  output: number;
  cache: number;
  total: number;
  cost: number;
  parentCost: number;
  subCost: number;
  subTokens: number;
} {
  let input = 0;
  let output = 0;
  let cache = 0;
  let total = 0;
  let parentCost = 0;

  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message" || entry.message.role !== "assistant") continue;

    const usage = (entry.message as { usage?: AssistantUsage }).usage;
    if (!usage) continue;

    const cacheRead = usage.cacheRead ?? 0;
    const cacheWrite = usage.cacheWrite ?? 0;
    const messageInput = usage.input ?? 0;
    const messageOutput = usage.output ?? 0;
    const messageCache = cacheRead + cacheWrite;

    input += messageInput;
    output += messageOutput;
    cache += messageCache;
    total += usage.totalTokens ?? messageInput + messageOutput + messageCache;
    parentCost += totalCostOf(usage);
  }

  // Subagents run in their own in-memory sessions and never appear in the
  // parent branch above, so their real billed cost/tokens are missing from
  // the loop. Add them on top so the footer matches what we're actually
  // being charged (and matches the tool-panel's session total).
  const sub = getSubagentTotals();
  input += sub.input;
  output += sub.output;
  cache += sub.cache;
  total += sub.tokens;

  return {
    input,
    output,
    cache,
    total,
    cost: parentCost + sub.cost,
    parentCost,
    subCost: sub.cost,
    subTokens: sub.tokens,
  };
}

function getContextLine(ctx: ExtensionContext): string {
  const usage = ctx.getContextUsage();
  if (!usage) return "ctx ?/? ?";

  const tokens = usage.tokens === null ? "?" : compactNumber(usage.tokens);
  const window = compactNumber(usage.contextWindow);
  const percent = usage.percent === null ? "?" : `${usage.percent.toFixed(1)}%`;

  return `ctx ${tokens}/${window} ${percent}`;
}

function getModelLine(pi: ExtensionAPI, ctx: ExtensionContext): string {
  const model = ctx.model;
  if (!model) return "model no-model";

  const thinkingLevel = pi.getThinkingLevel();
  return `model ${model.provider}/${model.id} (${thinkingLevel})`;
}

export function installUsageFooter(pi: ExtensionAPI, ctx: ExtensionContext, monitor: ProviderUsageMonitor): void {
  if (!isTui(ctx)) return;
  ctx.ui.setFooter((tui, theme) => {
    const unsubscribe = monitor.subscribe(() => tui.requestRender());
    return {
      dispose: unsubscribe,
      invalidate() {},
      render(width: number): string[] {
        const totals = getTokenTotals(ctx);
        const cost = totals.subCost > 0
          ? `total ${compactNumber(totals.total)} · ${formatMoney(totals.cost)} (${formatMoney(totals.parentCost)} + ${formatMoney(totals.subCost)} sub)`
          : `total ${compactNumber(totals.total)} · ${formatMoney(totals.cost)}`;
        const left = [getContextLine(ctx),
          `in ${compactNumber(totals.input)} · out ${compactNumber(totals.output)} · cache ${compactNumber(totals.cache)}`, cost];
        return layoutUsageLines(left.map((line) => theme.fg("warning", line)),
          theme.fg("accent", getModelLine(pi, ctx)),
          footerRows(monitor.snapshot()).map((line) => theme.fg("accent", line)), width);
      },
    };
  });
}

function isTui(ctx: ExtensionContext): boolean { return ctx.mode === "tui" && ctx.hasUI; }

export function usageDetailPanel(monitor: ProviderUsageMonitor, requestRender: () => void, close: () => void, height: () => number): Component & { dispose(): void } {
  const text = new Text("", 0, 0);
  let offset = 0;
  let disposed = false;
  const unsubscribe = monitor.subscribe(() => { if (!disposed) requestRender(); });
  return {
    dispose() { disposed = true; unsubscribe(); },
    invalidate() { text.invalidate(); },
    handleInput(data: string) {
      if (matchesKey(data, "escape") || matchesKey(data, "q")) { close(); return; }
      if (matchesKey(data, "r")) { void monitor.refresh(); return; }
      if (matchesKey(data, "up")) offset = Math.max(0, offset - 1);
      else if (matchesKey(data, "down")) offset++;
      else if (matchesKey(data, "pageUp")) offset = Math.max(0, offset - 10);
      else if (matchesKey(data, "pageDown")) offset += 10;
      requestRender();
    },
    render(width: number) {
      text.setText(detailText(monitor.snapshot()));
      const lines = text.render(Math.max(1, width));
      const size = Math.max(1, height() - 4);
      offset = Math.max(0, Math.min(offset, lines.length - size));
      return lines.slice(offset, offset + size).map((line) => truncateToWidth(line, width));
    },
  };
}

export const piExtension = { id: "usage-footer" };

export default function usageFooter(pi: ExtensionAPI, monitor = new ProviderUsageMonitor()) {
  let enabled = true;
  let closeDetails: (() => void) | undefined;
  const install = (ctx: ExtensionContext) => {
    if (enabled && isTui(ctx)) installUsageFooter(pi, ctx, monitor);
  };
  pi.on("session_start", (_event, ctx) => {
    closeDetails?.();
    monitor.stop();
    install(ctx);
    if (enabled && isTui(ctx)) monitor.start();
  });
  pi.on("session_shutdown", () => { closeDetails?.(); monitor.stop(); });
  pi.on("model_select", (_event, ctx) => install(ctx));
  pi.on("thinking_level_select", (_event, ctx) => install(ctx));
  pi.on("agent_start", (_event, ctx) => install(ctx));
  pi.on("turn_end", (_event, ctx) => install(ctx));
  pi.on("agent_end", (_event, ctx) => install(ctx));

  const visibilityResult = loadCapabilityVisibilitySettings();
  for (const warning of visibilityResult.warnings) {
    console.warn(`[usage-footer] capability-visibility: ${warning.message}`);
  }
  const managed = createManagedExtension(pi, { id: piExtension.id, visibility: visibilityResult.settings });

  managed.registerCommand("usage-footer", {
    description: "Enable or disable the custom usage footer. Usage: /usage-footer [on|off]",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      if (!isTui(ctx)) return;
      const action = args.trim().toLowerCase();
      if (!action || action === "on") {
        enabled = true;
        install(ctx);
        monitor.start();
        ctx.ui.notify("Usage footer installed", "info");
      } else if (action === "off") {
        enabled = false;
        ctx.ui.setFooter(undefined);
        monitor.stop();
        ctx.ui.notify("Default footer restored", "info");
      } else {
        ctx.ui.notify("Usage: /usage-footer [on|off]", "info");
      }
    },
  });
  managed.registerCommand("provider-usage", {
    description: "Provider account usage details (r refresh, Esc/q close)",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      if (!isTui(ctx)) return;
      await ctx.ui.custom<void>((tui, _theme, _keys, done) => {
        const close = () => { panel.dispose(); if (closeDetails === close) closeDetails = undefined; done(); };
        const panel = usageDetailPanel(monitor, () => tui.requestRender(), close, () => tui.terminal.rows);
        closeDetails = close;
        void monitor.refresh();
        return panel;
      });
    },
  });
}
