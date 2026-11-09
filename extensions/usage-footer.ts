import { calculateCost } from "@earendil-works/pi-ai";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text, matchesKey, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { ProviderUsageMonitor } from "./lib/provider-usage/monitor.ts";
import { providerReaderBundle, UsageReadError } from "./lib/provider-usage/readers.ts";
import { createCodexResetFlow, type CodexResetFlow } from "./lib/provider-usage/codex-reset.ts";
import { defaultCodexPaths, loadCodexSlots } from "./lib/codex-accounts.ts";
import { isClaudeBridgeProvider } from "./lib/claude-profiles.ts";
import { detailText, compactFooterRows, usageTable, type UsagePaint } from "./lib/provider-usage/model.ts";
import {
  createManagedExtension,
  loadCapabilityVisibilitySettings,
} from "./lib/capability-visibility.ts";

type AssistantUsage = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cacheWrite1h?: number;
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
  const right = [model, providers[0] ?? "", providers.slice(1).filter(Boolean).join(" · ")];
  // Never grow vertically: preserve session totals first, truncate the right-hand
  // summaries on narrow terminals. Full provider data is in /provider-usage.
  return Array.from({ length: 3 }, (_, index) => {
    const local = truncateToWidth(left[index] ?? "", width);
    const available = width - visibleWidth(local) - (local ? 2 : 0);
    const summary = available > 0 ? truncateToWidth(right[index], available) : "";
    return summary ? padRight(local, summary, width) : local;
  });
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

// Subscription providers contribute reported dollars to the session total,
// or Claude list-price estimates when reported dollars are nonpositive.
const SUBSCRIPTION_PROVIDERS = new Set(["claude-bridge", "claude-code-cli"]);
const isSubscriptionProvider = (provider: string): boolean => SUBSCRIPTION_PROVIDERS.has(provider) || isClaudeBridgeProvider(provider);

// Bridge models deliberately have zero prices; estimate from Anthropic's exact catalog IDs.
const CLAUDE_LIST_MODELS = new Map(getBuiltinModels("anthropic").map((model) => [model.id, model]));

function estimateClaudePlanCost(usage: AssistantUsage, model: unknown): number | undefined {
  if (typeof model !== "string") return undefined;
  const catalogModel = CLAUDE_LIST_MODELS.get(model);
  if (!catalogModel) return undefined;
  const input = usage.input ?? 0;
  const output = usage.output ?? 0;
  const cacheRead = usage.cacheRead ?? 0;
  const cacheWrite = usage.cacheWrite ?? 0;
  // calculateCost mutates its usage argument, never the session's recorded usage.
  return calculateCost(catalogModel, {
    input,
    output,
    cacheRead,
    cacheWrite,
    cacheWrite1h: usage.cacheWrite1h,
    totalTokens: usage.totalTokens ?? input + output + cacheRead + cacheWrite,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }).total;
}

// Standard-speed Cursor list-price equivalents, not plan consumption or billed charges.
// cursor-to-pi disables Fast when the live catalog advertises that parameter.
// Source: https://cursor.com/docs/models-and-pricing#cursor-models (2026-10-29).
export function estimateCursorPlanCost(usage: AssistantUsage, model: unknown): number | undefined {
  const counts = [usage.input ?? 0, usage.output ?? 0, usage.cacheRead ?? 0, usage.cacheWrite ?? 0];
  if (counts.some((n) => !Number.isFinite(n) || n < 0)) return undefined;
  const [input, output, cacheRead, cacheWrite] = counts;
  const prompt = input + cacheRead + cacheWrite;
  if (model === "grok-4.5" || model === "grok-4.6" || model === "grok-4.7") {
    const tier = model === "grok-4.7" && prompt > 256_000 ? 2 : 1;
    // No separate Grok cache-write rate is published; estimate writes at input rate.
    return ((input + cacheWrite) * 2 + cacheRead * 0.5 + output * 6) * tier / 1_000_000;
  }
  if (model === "composer-2.5") return ((input + cacheWrite) * 0.5 + cacheRead * 0.2 + output * 2.5) / 1_000_000;
  // Exact Claude catalog IDs only. Never guess prices for Auto or unknown model aliases.
  return estimateClaudePlanCost(usage, model);
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
  cursorEstimated: boolean;
  cursorUnpriced: boolean;
} {
  let cursorEstimated = false;
  let cursorUnpriced = false;
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
    const provider = (entry.message as { provider?: unknown }).provider;
    const reported = totalCostOf(usage);
    if (provider === "cursor" && reported <= 0) {
      const estimate = estimateCursorPlanCost(usage, (entry.message as { model?: unknown }).model);
      parentCost += estimate ?? 0;
      if (estimate !== undefined && messageInput + messageOutput + messageCache > 0) cursorEstimated = true;
      else if (estimate === undefined && (usage.totalTokens ?? messageInput + messageOutput + messageCache) > 0) cursorUnpriced = true;
    } else if (typeof provider === "string" && isSubscriptionProvider(provider) && reported <= 0) {
      const model = (entry.message as { model?: unknown }).model;
      parentCost += estimateClaudePlanCost(usage, model) ?? 0;
    } else parentCost += reported;
  }

  // Subagents run in their own in-memory sessions and never appear in the
  // parent branch above, so their reported cost/tokens are missing from
  // the loop. Add them once to the parent's reported or estimated dollars
  // so the footer includes both sessions (as does the tool-panel total).
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
    cursorEstimated,
    cursorUnpriced,
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
        const qualifier = `${totals.cursorEstimated ? " est" : ""}${totals.cursorUnpriced ? " + unpriced Cursor" : ""}`;
        const cost = totals.subCost > 0
          ? `total ${compactNumber(totals.total)} · ${formatMoney(totals.cost)}${qualifier} (${formatMoney(totals.parentCost)} + ${formatMoney(totals.subCost)} sub)`
          : `total ${compactNumber(totals.total)} · ${formatMoney(totals.cost)}${qualifier}`;
        const left = [getContextLine(ctx),
          `in ${compactNumber(totals.input)} · out ${compactNumber(totals.output)} · cache ${compactNumber(totals.cache)}`, cost];
        return layoutUsageLines(left.map((line) => theme.fg("warning", line)),
          theme.fg("accent", getModelLine(pi, ctx)),
          compactFooterRows(monitor.snapshot(), (level, text) =>
            theme.fg(level === "high" ? "error" : level === "warn" ? "warning" : "accent", text)), width);
      },
    };
  });
}

function isTui(ctx: ExtensionContext): boolean { return ctx.mode === "tui" && ctx.hasUI; }

// Bordered modal: compact table by default, `d` toggles the full detail text.
export function usageDetailPanel(monitor: ProviderUsageMonitor, requestRender: () => void, close: () => void, height: () => number,
  paint: UsagePaint = (_level, text) => text, frame: (text: string) => string = (text) => text,
  flow?: CodexResetFlow): Component & { dispose(): void } {
  const text = new Text("", 0, 0);
  let offset = 0;
  let detailed = false;
  let disposed = false;
  const unsubscribe = monitor.subscribe(() => { if (!disposed) requestRender(); });
  const unsubscribeFlow = flow?.subscribe(() => { if (!disposed) requestRender(); });
  return {
    dispose() { disposed = true; unsubscribe(); unsubscribeFlow?.(); },
    invalidate() { text.invalidate(); },
    handleInput(data: string) {
      if (flow?.handleInput(data) === "handled") { requestRender(); return; }
      if (matchesKey(data, "x") && flow) { offset = 0; flow.open(); requestRender(); return; }
      if (matchesKey(data, "escape") || matchesKey(data, "q")) { close(); return; }
      if (matchesKey(data, "r")) { void monitor.refresh(); return; }
      if (matchesKey(data, "d")) { detailed = !detailed; offset = 0; }
      else if (matchesKey(data, "up")) offset = Math.max(0, offset - 1);
      else if (matchesKey(data, "down")) offset++;
      else if (matchesKey(data, "pageUp")) offset = Math.max(0, offset - 10);
      else if (matchesKey(data, "pageDown")) offset += 10;
      requestRender();
    },
    render(width: number) {
      const boxed = width >= 12;
      const inner = Math.max(1, boxed ? width - 4 : width);
      const states = monitor.snapshot();
      let body: string[];
      if (flow?.visible()) body = flow.renderLines(inner);
      else if (detailed) {
        // detailText starts with its own title and key hints; the frame supplies both.
        text.setText(detailText(states).split("\n").slice(3).join("\n"));
        body = text.render(inner);
      } else body = usageTable(states, Date.now(), paint);
      const updated = Math.max(0, ...states.map((state) => state.lastAttempt ?? 0));
      const hint = flow?.visible() ? flow.hint() : `r refresh · d ${detailed ? "summary" : "details"} · x reset · ↑/↓ scroll · Esc close${updated ? ` · updated ${new Date(updated).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}`;
      const size = Math.max(1, height() - 4);
      offset = Math.max(0, Math.min(offset, body.length - size));
      const resetState = flow?.state();
      if (resetState?.kind === "accounts" || resetState?.kind === "credits") {
        const selected = resetState.index + 1;
        if (selected < offset) offset = selected;
        if (selected >= offset + size) offset = selected - size + 1;
      } else if (resetState && resetState.kind !== "hidden") offset = 0;
      const visible = body.slice(offset, offset + size);
      const title = " Provider account usage ";
      if (!boxed) return [title.trim(), ...visible, hint].map((line) => truncateToWidth(line, width));
      const pad = (line: string) => {
        const fitted = truncateToWidth(line, inner);
        return `${frame("│")} ${fitted}${" ".repeat(Math.max(0, inner - visibleWidth(fitted)))} ${frame("│")}`;
      };
      const heading = truncateToWidth(title, width - 4);
      return [
        frame(`╭─${heading}${"─".repeat(Math.max(0, width - 3 - visibleWidth(heading)))}╮`),
        ...visible.map(pad),
        pad(""),
        pad(hint),
        frame(`╰${"─".repeat(width - 2)}╯`),
      ];
    },
  };
}

export const piExtension = { id: "usage-footer" };

export default function usageFooter(pi: ExtensionAPI, suppliedMonitor?: ProviderUsageMonitor, suppliedFlow?: CodexResetFlow) {
  let latestCtx: ExtensionContext | undefined;
  const bundle = suppliedMonitor ? undefined : providerReaderBundle(undefined, undefined, undefined, undefined, {
    codexSlots: loadCodexSlots(defaultCodexPaths().configFile),
    cursorApiKey: async () => latestCtx?.modelRegistry.getApiKeyForProvider("cursor"),
    codexApiKey: async (provider = "openai-codex") => {
      const auth = await latestCtx?.modelRegistry.getProviderAuth(provider === "codex" ? "openai-codex" : provider);
      if (!auth) return undefined;
      if (auth.source !== "OAuth" || !auth.auth.apiKey) throw new UsageReadError("Codex account usage requires Pi OAuth login");
      return auth.auth.apiKey;
    },
  });
  const monitor = suppliedMonitor ?? new ProviderUsageMonitor(bundle!.readers);
  const flow = suppliedFlow ?? createCodexResetFlow(bundle?.codexResetTargets ?? [], {
    inventory: (target, signal) => bundle!.inventory(target, signal),
    consume: (attempt, signal) => bundle!.consume(attempt, signal),
    afterReset: (target) => monitor.invalidateAndRefresh(target.id),
  });
  let enabled = true;
  let closeDetails: (() => void) | undefined;
  const install = (ctx: ExtensionContext) => {
    latestCtx = ctx;
    if (enabled && isTui(ctx)) installUsageFooter(pi, ctx, monitor);
  };
  pi.on("session_start", (_event, ctx) => {
    closeDetails?.();
    monitor.stop();
    install(ctx);
    if (enabled && isTui(ctx)) monitor.start();
  });
  pi.on("session_shutdown", () => { closeDetails?.(); monitor.stop(); latestCtx = undefined; });
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
    description: "Provider account usage details (r refresh, x reset, Esc/q close)",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      if (!isTui(ctx)) return;
      await ctx.ui.custom<void>((tui, theme, _keys, done) => {
        const close = () => { panel.dispose(); if (closeDetails === close) closeDetails = undefined; done(); };
        const panel = usageDetailPanel(monitor, () => tui.requestRender(), close, () => Math.floor(tui.terminal.rows * 0.8),
          (level, text) => theme.fg(level === "high" ? "error" : level === "warn" ? "warning" : "accent", text),
          (text) => theme.fg("dim", text), flow);
        closeDetails = close;
        void monitor.refresh();
        return panel;
      }, { overlay: true, overlayOptions: { anchor: "center", width: "80%", minWidth: 60, maxHeight: "80%" } });
    },
  });
}
