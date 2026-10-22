export type ProviderId = "codex" | "antigravity" | "copilot" | "cursor" | "claude-work" | "claude-personal";
export type QuotaWindow = { id: string; label: string; usedPercent: number; resetsAt?: number };
export type QuotaGroup = { id: string; name: string; shortName: string; windows: QuotaWindow[] };
export type UsageMetric =
  | { kind: "quota"; groups: QuotaGroup[] }
  | { kind: "credits"; consumed: number; resetsAt?: number }
  // Claude usage-credit spend (money) plus any subscription quota windows; fetchedAt is Claude Code's own cache time.
  | { kind: "spend"; spend?: { used: number; limit?: number; currency: string; usedPercent?: number; severity?: string }; windows: QuotaWindow[]; fetchedAt?: number };
export type ProviderState = {
  id: ProviderId;
  name: string;
  experimental?: boolean;
  status: "loading" | "available" | "error";
  error?: string;
  lastAttempt?: number;
  lastSuccess?: number;
  value?: UsageMetric;
};

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
function reset(value: unknown, epoch = false): number | undefined {
  const n = epoch && finite(value) ? value * 1000 : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 8.64e15 ? n : undefined;
}
function unavailable(): never { throw new Error("Usage fields unavailable"); }

export function parseCodex(raw: unknown): UsageMetric {
  const data = record(raw);
  const bucket = record(record(data.rateLimitsByLimitId).codex ?? data.rateLimits);
  const windows: QuotaWindow[] = [];
  for (const key of ["primary", "secondary"]) {
    const w = record(bucket[key]);
    const minutes = w.windowDurationMins;
    if (!finite(minutes) || minutes <= 0 || !finite(w.usedPercent) || w.usedPercent < 0 || w.usedPercent > 100) continue;
    const id = minutes === 300 ? "5h" : minutes === 10080 ? "week" : `${minutes}m`;
    if (!windows.some((item) => item.id === id)) windows.push({ id, label: id, usedPercent: w.usedPercent, resetsAt: reset(w.resetsAt, true) });
  }
  if (!windows.length) return unavailable();
  windows.sort((a, b) => (a.id === "5h" ? -1 : b.id === "5h" ? 1 : 0));
  return { kind: "quota", groups: [{ id: "codex", name: "Codex", shortName: "Codex", windows }] };
}

export function parseAntigravity(raw: unknown): UsageMetric {
  const data = record(raw);
  if (data.status !== "SUCCESS" || record(data.command).name !== "usage") return unavailable();
  const source = record(record(data.command).data).groups;
  const groups: QuotaGroup[] = [];
  for (const [name, id, shortName] of [["Gemini Models", "gemini", "AG Gemini"], ["Claude and GPT models", "third-party", "AG Claude/GPT"]]) {
    const found = Array.isArray(source) ? source.find((item) => record(item).name === name) : undefined;
    const buckets = record(found).buckets;
    const windows: QuotaWindow[] = [];
    for (const rawBucket of Array.isArray(buckets) ? buckets : []) {
      const b = record(rawBucket);
      const windowId = b.window === "weekly" ? "week" : b.window === "5h" ? "5h" : undefined;
      if (!windowId || !finite(b.remaining_fraction) || b.remaining_fraction < 0 || b.remaining_fraction > 1 || windows.some((w) => w.id === windowId)) continue;
      windows.push({ id: windowId, label: windowId, usedPercent: (1 - b.remaining_fraction) * 100, resetsAt: reset(b.reset_time) });
    }
    windows.sort((a, b) => (a.id === "5h" ? -1 : b.id === "5h" ? 1 : 0));
    if (windows.length) groups.push({ id, name, shortName, windows });
  }
  if (!groups.length) return unavailable();
  return { kind: "quota", groups };
}

export function parseCopilot(raw: unknown): UsageMetric {
  const data = record(raw);
  const used = record(record(data.quota_snapshots).premium_interactions).credits_used;
  if (!finite(used) || used < 0) return unavailable();
  return { kind: "credits", consumed: used, resetsAt: reset(data.quota_reset_date_utc) };
}

// Cursor reports an included-plan billing-cycle percentage, not on-demand spend.
export function parseCursor(raw: unknown): UsageMetric {
  const data = record(raw);
  const plan = record(data.planUsage);
  let used = plan.totalPercentUsed;
  if (used === undefined && finite(plan.includedSpend) && plan.includedSpend >= 0 && finite(plan.limit) && plan.limit > 0) {
    used = plan.includedSpend / plan.limit * 100;
  }
  // Overages can exceed 100%; never clamp the provider's measurement.
  if (!finite(used) || used < 0) return unavailable();
  const end = typeof data.billingCycleEnd === "string" && /^\d+$/.test(data.billingCycleEnd)
    ? Number(data.billingCycleEnd) : data.billingCycleEnd;
  const resetsAt = finite(end) && Number.isSafeInteger(end) && end > 0 && end <= 8.64e15 ? end : undefined;
  const windows: QuotaWindow[] = [{ id: "month", label: "month", usedPercent: used, resetsAt }];
  // These are provider-reported categories, not additive percentages or inferred balances.
  for (const [id, label, field] of [["auto", "Auto", "autoPercentUsed"], ["api", "API", "apiPercentUsed"]]) {
    const value = plan[field];
    if (finite(value) && value >= 0) windows.push({ id, label, usedPercent: value });
  }
  return { kind: "quota", groups: [{ id: "cursor", name: "Cursor included plan", shortName: "Cursor", windows }] };
}

function money(value: unknown, exponent: unknown): number | undefined {
  const amount = record(value).amount_minor ?? value;
  if (!finite(amount) || amount < 0 || !finite(exponent) || !Number.isInteger(exponent) || exponent < 0 || exponent > 6) return undefined;
  return amount / 10 ** exponent;
}
// Source: Claude Code's own cachedUsageUtilization (undocumented), refreshed by `claude -p /usage`.
export function parseClaude(raw: unknown): UsageMetric {
  const data = record(raw);
  const usage = record(data.utilization);
  const windows: QuotaWindow[] = [];
  for (const [key, id] of [["five_hour", "5h"], ["seven_day", "week"]]) {
    const w = record(usage[key]);
    const used = w.utilization ?? w.used_percentage;
    if (!finite(used) || used < 0) continue;
    windows.push({ id, label: id, usedPercent: used, resetsAt: finite(w.resets_at) ? reset(w.resets_at, true) : reset(w.resets_at) });
  }
  let spend: { used: number; limit?: number; currency: string; usedPercent?: number; severity?: string } | undefined;
  const s = record(usage.spend);
  const extra = record(usage.extra_usage);
  if (s.enabled === true) {
    const usedRecord = record(s.used);
    const used = money(usedRecord, usedRecord.exponent);
    const limitRecord = record(s.limit);
    const limit = money(limitRecord, limitRecord.exponent);
    if (used !== undefined) spend = { used, limit, currency: typeof usedRecord.currency === "string" ? usedRecord.currency : "USD",
      usedPercent: finite(s.percent) && s.percent >= 0 ? s.percent : undefined, severity: typeof s.severity === "string" ? s.severity : undefined };
  } else if (s.enabled === undefined && extra.is_enabled === true) {
    const used = money(extra.used_credits, extra.decimal_places);
    const limit = money(extra.monthly_limit, extra.decimal_places);
    if (used !== undefined) spend = { used, limit, currency: typeof extra.currency === "string" ? extra.currency : "USD",
      usedPercent: finite(extra.utilization) && extra.utilization >= 0 ? extra.utilization : undefined };
  }
  if (spend && spend.limit !== undefined && spend.limit > 0) spend.usedPercent = spend.used / spend.limit * 100;
  if (!spend && !windows.length) return unavailable();
  const fetchedAt = finite(data.fetchedAtMs) && data.fetchedAtMs > 0 && data.fetchedAtMs <= 8.64e15 ? data.fetchedAtMs : undefined;
  return { kind: "spend", spend, windows, fetchedAt };
}

const claudeFull = (state: ProviderState): string => state.name || "Claude";
const claudeShort = (state: ProviderState): string =>
  state.id === "claude-work" ? "Claude-W" : state.id === "claude-personal" ? "Claude-P" : state.name || "Claude";
const percent = (n: number): string => `${Number(n.toFixed(1))}%`;
const dollars = (n: number, currency: string, digits = 2): string =>
  `${currency === "USD" ? "$" : currency + " "}${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
export function footerRows(states: readonly ProviderState[]): string[] {
  return states.flatMap((state) => {
    if (!state.value) return [];
    const stale = state.error && state.value ? " · stale" : "";
    if (state.value.kind === "credits") return [`Copilot ${state.value.consumed.toLocaleString("en-US")} credits used${stale}`];
    if (state.value.kind === "spend") {
      const { spend, windows } = state.value;
      const parts = windows.map((w) => `${w.label} ${percent(w.usedPercent)}`);
      if (spend) parts.push(`${dollars(spend.used, spend.currency)}${spend.limit !== undefined ? ` / ${dollars(spend.limit, spend.currency)}` : ""}${spend.usedPercent !== undefined ? ` (${percent(spend.usedPercent)})` : ""}`);
      return [`${claudeFull(state)} ${parts.join(" · ")} used${stale}`];
    }
    return state.value.groups.map((g) => {
      const resetsAt = g.windows.find((w) => w.id === "5h")?.resetsAt;
      const resetTime = resetsAt === undefined ? "" : ` · 5h reset ${new Date(resetsAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
      return `${g.shortName} ${g.windows.map((w) => `${w.label} ${percent(w.usedPercent)}`).join(" · ")} used${resetTime}${stale}`;
    });
  });
}
// Two summary rows beneath the model. Full precision and reset times stay in details.
export function compactFooterRows(states: readonly ProviderState[]): string[] {
  const quota: string[] = [];
  const accounts: string[] = [];
  const pct = (n: number) => n > 0 && n < 1 ? "<1%" : `${Math.round(n)}%`;
  for (const state of states) {
    if (!state.value) continue;
    const stale = state.error ? "*" : "";
    if (state.value.kind === "credits") {
      // User-requested credit-equivalent display, not a verified billing amount.
      accounts.push(`Copilot $${Math.round(state.value.consumed / 100).toLocaleString("en-US")}${stale}`);
      continue;
    }
    if (state.value.kind === "spend") {
      const { spend, windows } = state.value;
      if (windows.length) quota.push(`${claudeShort(state)} ${windows.map((w) => `${w.id === "week" ? "wk" : w.label}-${pct(w.usedPercent)}`).join(" ")}${stale}`);
      if (spend) {
        const amount = `${dollars(spend.used, spend.currency, 0)}${spend.limit !== undefined ? `/${dollars(spend.limit, spend.currency, 0)}` : ""}`;
        accounts.push(`${claudeShort(state)} ${amount}${spend.usedPercent !== undefined ? ` ${pct(spend.usedPercent)}` : ""}${stale}`);
      }
      continue;
    }
    for (const g of state.value.groups) {
      const name = g.id === "gemini" ? "AG-G" : g.id === "third-party" ? "AG-C/G" : g.shortName;
      const windows = g.windows.map((w) => {
        const label = w.id === "week" ? "wk" : w.id === "month" ? "M" : w.id === "auto" ? "A" : w.label;
        return `${label}-${pct(w.usedPercent)}`;
      }).join(" ");
      (state.id === "cursor" ? accounts : quota).push(`${name} ${windows}${stale}`);
    }
  }
  return [quota.join(" · "), accounts.join(" · ")];
}
const localized = (timestamp: number | undefined): string => timestamp === undefined ? "unavailable" : new Date(timestamp).toLocaleString();
export function detailText(states: readonly ProviderState[]): string {
  return ["Provider account usage", "r refresh · ↑/↓ scroll · Esc/q close", "", ...states.flatMap((state) => {
    const lines = [`${state.name}${state.experimental ? " (experimental internal API)" : ""}`,
      `  ${state.status}${state.value && state.error ? " · stale" : ""} · last refresh: ${localized(state.lastAttempt)}`,
      `  Last success: ${localized(state.lastSuccess)}`];
    if (state.error) lines.push(`  Reason: ${state.error}`);
    if (!state.value) lines.push("  Usage unavailable (no successful read)");
    else if (state.value.kind === "spend") {
      const { spend, windows, fetchedAt } = state.value;
      for (const w of windows) lines.push(`  ${w.id === "5h" ? "Five-hour window (5h)" : "Weekly window (week)"}: ${percent(w.usedPercent)} used · resets: ${localized(w.resetsAt)}`);
      if (spend) {
        lines.push(`  Usage credits: ${dollars(spend.used, spend.currency)} used${spend.limit !== undefined ? ` of ${dollars(spend.limit, spend.currency)} limit` : " (no personal limit)"}${spend.usedPercent !== undefined ? ` · ${percent(spend.usedPercent)}` : ""}${spend.severity ? ` · ${spend.severity}` : ""}`);
        lines.push("  Spend period/reset not reported by Claude Code.");
      }
      lines.push(`  Claude Code cache fetched: ${localized(fetchedAt)}`);
    }
    else if (state.value.kind === "credits") lines.push(`  ${state.value.consumed.toLocaleString("en-US")} credits consumed`, "  Footer converts 100 credits = $1, rounded to whole dollars; not a verified bill.", `  Resets: ${localized(state.value.resetsAt)}`);
    else for (const g of state.value.groups) {
      lines.push(`  ${g.name}`);
      if (state.id === "cursor") {
        lines.push("    Auto/API are provider-reported categories; percentages are not additive.");
        for (const w of g.windows) lines.push(`    ${w.id === "month" ? "Monthly included plan (month)" : w.label}: ${percent(w.usedPercent)} used${w.id === "month" ? ` · billing-cycle end: ${localized(w.resetsAt)}` : ""}`);
        continue;
      }
      for (const id of ["5h", "week"]) if (!g.windows.some((w) => w.id === id)) lines.push(`    ${id === "5h" ? "Five-hour window (5h)" : "Weekly window (week)"}: unavailable / not applicable`);
      for (const w of g.windows) lines.push(`    ${w.id === "5h" ? "Five-hour window (5h)" : w.id === "week" ? "Weekly window (week)" : w.id === "month" ? "Monthly included plan (month)" : w.label}: ${percent(w.usedPercent)} used · resets: ${localized(w.resetsAt)}`);
    }
    return [...lines, ""];
  })].join("\n");
}
