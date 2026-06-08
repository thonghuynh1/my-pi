import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type AssistantUsage = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  cost?: { total?: number };
};

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

function getTokenTotals(ctx: ExtensionContext): {
  input: number;
  output: number;
  cache: number;
  total: number;
  cost: number;
} {
  let input = 0;
  let output = 0;
  let cache = 0;
  let total = 0;
  let cost = 0;

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
    cost += usage.cost?.total ?? 0;
  }

  return { input, output, cache, total, cost };
}

function getContextLine(ctx: ExtensionContext): string {
  const usage = ctx.getContextUsage();
  if (!usage) return "ctx ?/? ?";

  const tokens = usage.tokens === null ? "?" : compactNumber(usage.tokens);
  const window = compactNumber(usage.contextWindow);
  const percent = usage.percent === null ? "?" : `${usage.percent.toFixed(1)}%`;

  return `ctx ${tokens}/${window} ${percent}`;
}

function installUsageFooter(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;

  ctx.ui.setFooter((_tui, theme) => ({
    dispose() {},
    invalidate() {},
    render(width: number): string[] {
      const model = `model ${ctx.model?.id ?? "no-model"}`;
      const totals = getTokenTotals(ctx);

      const line1 = padRight(getContextLine(ctx), model, width);
      const line2 = truncateToWidth(
        `in ${compactNumber(totals.input)} · out ${compactNumber(totals.output)} · cache ${compactNumber(totals.cache)}`,
        width,
      );
      const line3 = truncateToWidth(
        `total ${compactNumber(totals.total)} · ${formatMoney(totals.cost)}`,
        width,
      );

      const modelStart = Math.max(0, line1.length - model.length);
      const leftPart = line1.slice(0, modelStart);
      const rightPart = line1.slice(modelStart);

      return [
        theme.fg("warning", leftPart) + theme.fg("accent", rightPart),
        theme.fg("warning", line2),
        theme.fg("warning", line3),
      ];
    },
  }));
}

export default function usageFooter(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => installUsageFooter(ctx));
  pi.on("model_select", async (_event, ctx) => installUsageFooter(ctx));
  pi.on("thinking_level_select", async (_event, ctx) => installUsageFooter(ctx));
  pi.on("agent_start", async (_event, ctx) => installUsageFooter(ctx));
  pi.on("turn_end", async (_event, ctx) => installUsageFooter(ctx));
  pi.on("agent_end", async (_event, ctx) => installUsageFooter(ctx));

  pi.registerCommand("usage-footer", {
    description: "Install/refresh the custom usage footer.",
    handler: async (_args, ctx) => {
      installUsageFooter(ctx);
      ctx.ui.notify("Usage footer installed", "info");
    },
  });

  pi.registerCommand("usage-footer-off", {
    description: "Restore the default footer.",
    handler: async (_args, ctx) => {
      ctx.ui.setFooter(undefined);
      ctx.ui.notify("Default footer restored", "info");
    },
  });
}
