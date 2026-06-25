import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createManagedExtension,
  loadCapabilityVisibilitySettings,
  type CapabilityVisibilitySettings,
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

function truncateToWidth(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  if (width <= 1) return "…";
  return `${text.slice(0, width - 1)}…`;
}

function padRight(left: string, right: string, width: number): string {
  if (!right) return truncateToWidth(left, width);

  const minimumGap = 1;
  const availableLeft = width - right.length - minimumGap;
  if (availableLeft <= 0) return truncateToWidth(right, width);

  const renderedLeft = truncateToWidth(left, availableLeft);
  const padding = " ".repeat(Math.max(minimumGap, width - renderedLeft.length - right.length));
  return `${renderedLeft}${padding}${right}`;
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

function getCoachLine(): string {
  const s = (globalThis as { __frontendCoach?: { clients?: number; label?: string } })
    .__frontendCoach;
  if (!s) return "";
  const label = s.label ? String(s.label) : s.clients ? `${s.clients} browser${s.clients === 1 ? "" : "s"}` : "waiting";
  return `coach ${label}`;
}

function getSubagentLine(): string {
  const s = (globalThis as { __subagent?: { enabled?: boolean; active?: number; label?: string } })
    .__subagent;
  if (!s) return "";
  const label = s.label
    ? String(s.label)
    : s.enabled
      ? s.active && s.active > 0
        ? `on · ${s.active} running`
        : "on"
      : "off";
  return `subagent ${label}`;
}

function installUsageFooter(pi: ExtensionAPI, ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;

  ctx.ui.setFooter((_tui, theme) => ({
    dispose() {},
    invalidate() {},
    render(width: number): string[] {
      const model = getModelLine(pi, ctx);
      const totals = getTokenTotals(ctx);
      const coach = getCoachLine();
      const subagent = getSubagentLine();

      const line1 = padRight(getContextLine(ctx), model, width);
      const line2Left = `in ${compactNumber(totals.input)} · out ${compactNumber(totals.output)} · cache ${compactNumber(totals.cache)}`;
      const line2 = coach
        ? padRight(line2Left, coach, width)
        : truncateToWidth(line2Left, width);
      const line3Left = totals.subCost > 0
        ? `total ${compactNumber(totals.total)} · ${formatMoney(totals.cost)} (${formatMoney(totals.parentCost)} + ${formatMoney(totals.subCost)} sub)`
        : `total ${compactNumber(totals.total)} · ${formatMoney(totals.cost)}`;
      const line3 = subagent
        ? padRight(line3Left, subagent, width)
        : truncateToWidth(line3Left, width);

      const modelStart = Math.max(0, line1.length - model.length);
      const leftPart = line1.slice(0, modelStart);
      const rightPart = line1.slice(modelStart);

      const coachStart = coach ? Math.max(0, line2.length - coach.length) : line2.length;
      const line2Left2 = line2.slice(0, coachStart);
      const line2Right = line2.slice(coachStart);

      const subagentStart = subagent ? Math.max(0, line3.length - subagent.length) : line3.length;
      const line3Left2 = line3.slice(0, subagentStart);
      const line3Right = line3.slice(subagentStart);

      return [
        theme.fg("warning", leftPart) + theme.fg("accent", rightPart),
        theme.fg("warning", line2Left2) + theme.fg("accent", line2Right),
        theme.fg("warning", line3Left2) + theme.fg("accent", line3Right),
      ];
    },
  }));
}

export const piExtension = { id: "usage-footer" };

export default function usageFooter(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => installUsageFooter(pi, ctx));
  pi.on("model_select", async (_event, ctx) => installUsageFooter(pi, ctx));
  pi.on("thinking_level_select", async (_event, ctx) => installUsageFooter(pi, ctx));
  pi.on("agent_start", async (_event, ctx) => installUsageFooter(pi, ctx));
  pi.on("turn_end", async (_event, ctx) => installUsageFooter(pi, ctx));
  pi.on("agent_end", async (_event, ctx) => installUsageFooter(pi, ctx));

  let piSettings: CapabilityVisibilitySettings = {};
  const visibilityResult = loadCapabilityVisibilitySettings();
  for (const warning of visibilityResult.warnings) {
    console.warn(`[usage-footer] capability-visibility: ${warning.message}`);
  }
  piSettings = visibilityResult.settings;
  const managed = createManagedExtension(pi, { id: piExtension.id, visibility: piSettings });

  managed.registerCommand("usage-footer", {
    description: "Enable or disable the custom usage footer. Usage: /usage-footer [on|off]",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const action = args.trim().toLowerCase();
      if (!action || action === "on") {
        installUsageFooter(pi, ctx);
        ctx.ui.notify("Usage footer installed", "info");
      } else if (action === "off") {
        ctx.ui.setFooter(undefined);
        ctx.ui.notify("Default footer restored", "info");
      } else {
        ctx.ui.notify("Usage: /usage-footer [on|off]", "info");
      }
    },
  });
}
