import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const STATUS_KEY = "usage-footer";

function compactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function formatUsage(ctx: ExtensionContext): string {
  const usage = ctx.getContextUsage();
  const model = ctx.model?.id ?? "no-model";

  if (!usage) {
    return `model ${model}`;
  }

  const window = compactNumber(usage.contextWindow);
  const tokens = usage.tokens === null ? "?" : compactNumber(usage.tokens);
  const percent = usage.percent === null ? "?" : `${usage.percent.toFixed(1)}%`;

  return `model ${model} · ctx ${tokens}/${window} ${percent}`;
}

function updateUsageFooter(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  ctx.ui.setStatus(STATUS_KEY, formatUsage(ctx));
}

export default function usageFooter(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    updateUsageFooter(ctx);
  });

  pi.on("model_select", async (_event, ctx) => {
    updateUsageFooter(ctx);
  });

  pi.on("thinking_level_select", async (_event, ctx) => {
    updateUsageFooter(ctx);
  });

  pi.on("agent_start", async (_event, ctx) => {
    updateUsageFooter(ctx);
  });

  pi.on("turn_end", async (_event, ctx) => {
    updateUsageFooter(ctx);
  });

  pi.on("agent_end", async (_event, ctx) => {
    updateUsageFooter(ctx);
  });

  pi.registerCommand("usage-footer", {
    description: "Refresh the usage footer/status line.",
    handler: async (_args, ctx) => {
      updateUsageFooter(ctx);
      ctx.ui.notify("Usage footer refreshed", "info");
    },
  });
}
