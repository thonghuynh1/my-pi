export type ProviderId = "codex" | `codex-${number}` | "antigravity" | "copilot" | "cursor" | `claude-${number}` | "muse";
export type QuotaWindow = { id: string; label: string; usedPercent: number; resetsAt?: number };
export type QuotaGroup = { id: string; name: string; shortName: string; windows: QuotaWindow[]; asOf?: number };
export type ResetCount = { kind: "known"; value: number } | { kind: "unknown" };
export type ResetCredits = { available: ResetCount; applicable: ResetCount };
export type UsageMetric =
  | { kind: "quota"; groups: QuotaGroup[]; resetCredits?: ResetCredits }
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

export function parseResetCount(value: unknown): ResetCount {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? { kind: "known", value } : { kind: "unknown" };
}

export function parseCodex(raw: unknown, displayName = "Codex"): UsageMetric {
  const data = record(raw);
  const bucket = record(record(data.rateLimitsByLimitId).codex ?? data.rateLimits);
  const windows: QuotaWindow[] = [];
  for (const key of ["primary", "secondary"]) {
    const w = record(bucket[key]);
    const minutes = w.windowDurationMins;
    if (!finite(minutes) || minutes <= 0 || !finite(w.usedPercent) || w.usedPercent < 0 || w.usedPercent > 100) continue;
    const id = minutes === 300 ? "5h" : minutes === 10080 ? "week" : minutes === 43200 ? "month" : `${minutes}m`;
    if (!windows.some((item) => item.id === id)) windows.push({ id, label: id, usedPercent: w.usedPercent, resetsAt: reset(w.resetsAt, true) });
  }
  if (!windows.length) return unavailable();
  windows.sort((a, b) => (a.id === "5h" ? -1 : b.id === "5h" ? 1 : 0));
  const counts = record(data.rateLimitResetCredits);
  return { kind: "quota", groups: [{ id: "codex", name: displayName, shortName: displayName, windows }],
    resetCredits: { available: parseResetCount(counts.availableCount), applicable: parseResetCount(counts.applicableAvailableCount) } };
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

// Source: Muse Code's `muse usage --json` versioned allowance response.
export function parseMuse(raw: unknown): UsageMetric {
  const envelope = record(raw);
  const data = record(envelope.allowance);
  if (envelope.schemaVersion !== 1 || envelope.reason != null
    || !finite(data.asOfMs) || data.asOfMs <= 0 || data.asOfMs > 8.64e15) return unavailable();
  const windows: QuotaWindow[] = [];
  for (const [key, id] of [["window", "5h"], ["weekly", "week"]]) {
    const w = record(data[key]);
    if (!finite(w.usedPercent) || w.usedPercent < 0) continue;
    const resetsAt = finite(w.resetsAtMs) && w.resetsAtMs > 0 && w.resetsAtMs <= 8.64e15 ? w.resetsAtMs : undefined;
    windows.push({ id, label: id, usedPercent: w.usedPercent, resetsAt });
  }
  if (!windows.length) return unavailable();
  const tier = typeof data.tier === "string" && data.tier ? ` ${data.tier}` : "";
  return { kind: "quota", groups: [{ id: "muse", name: `Muse Code${tier} subscription · as of ${new Date(data.asOfMs).toLocaleString()}`, shortName: "Muse", windows, asOf: data.asOfMs }] };
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
const claudeShort = (state: ProviderState): string => state.name || "Claude";
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
      const displayName = state.id === "codex" ? "Codex 1" : state.id.startsWith("codex-") ? state.name : g.shortName;
      return `${displayName} ${g.windows.map((w) => `${w.label} ${percent(w.usedPercent)}`).join(" · ")} used${resetTime}${stale}`;
    });
  });
}
export type UsageLevel = "ok" | "warn" | "high";
export type UsagePaint = (level: UsageLevel, text: string) => string;
const BAR_CELLS = 7;
const levelOf = (n: number): UsageLevel => n >= 90 ? "high" : n >= 70 ? "warn" : "ok";
// Overages can exceed 100%; the bar saturates while the label keeps the provider's value.
export function usageBar(usedPercent: number, cells = BAR_CELLS): string {
  const filled = Math.max(0, Math.min(cells, Math.round(Math.min(usedPercent, 100) / 100 * cells)));
  return "▰".repeat(filled) + "▱".repeat(cells - filled);
}
// Two summary rows beneath the model: one five-hour bar per provider, labelled 5h/week.
// Per-window values, reset times and refresh status stay in /provider-usage details.
export function compactFooterRows(states: readonly ProviderState[], paint: UsagePaint = (_level, text) => text): string[] {
  const quota: string[] = [];
  const accounts: string[] = [];
  const families = new Map<string[], string | undefined>();
  const append = (row: string[], name: string, render: (label: string) => string | undefined) => {
    const numbered = /^(Codex|Claude) (\d+)$/.exec(name);
    const family = numbered?.[1];
    const label = numbered && families.get(row) === family ? numbered[2] : name;
    const text = render(label);
    if (text === undefined) return;
    row.push(text);
    families.set(row, family);
  };
  const pct = (n: number) => n > 0 && n < 1 ? "<1%" : `${Math.round(n)}%`;
  const chip = (name: string, windows: readonly QuotaWindow[], suffix = ""): string | undefined => {
    if (!windows.length) return undefined;
    const most = (id: string) => {
      const values = windows.filter((w) => w.id === id).map((w) => w.usedPercent);
      return values.length ? Math.max(...values) : undefined;
    };
    const five = most("5h");
    const week = most("week");
    // The bar tracks the five-hour window; providers without one fall back to their own window.
    const barValue = five ?? week ?? Math.max(...windows.map((w) => w.usedPercent));
    const label = five !== undefined && week !== undefined ? `${pct(five)}/${pct(week)}`
      : five !== undefined ? pct(five) : week !== undefined ? `wk ${pct(week)}` : pct(barValue);
    // Colour warns on whichever window is closer to its limit.
    return paint(levelOf(Math.max(barValue, week ?? 0)), `${name} ${usageBar(barValue)} ${label}${suffix}`);
  };
  for (const state of states) {
    const stale = state.error ? "*" : "";
    if (state.id.startsWith("claude-") && state.error === "Claude usage refresh rate limited") {
      // The five-hour read is rate limited; only a cached weekly value is meaningful.
      const weekly = state.value?.kind === "spend" ? state.value.windows.find((window) => window.id === "week") : undefined;
      append(quota, claudeShort(state), (label) => paint(weekly && levelOf(weekly.usedPercent) === "high" ? "high" : "warn",
        `${label} RL${weekly ? `/${pct(weekly.usedPercent)}*` : ""}`));
      continue;
    }
    if (!state.value) continue;
    if (state.value.kind === "credits") {
      // User-requested credit-equivalent display, not a verified billing amount.
      const amount = Math.round(state.value.consumed / 100).toLocaleString("en-US");
      append(accounts, "Copilot", (label) => paint("ok", `${label} $${amount}${stale}`));
      continue;
    }
    if (state.value.kind === "spend") {
      const { spend, windows } = state.value;
      append(quota, claudeShort(state), (label) => chip(label, windows, stale));
      if (spend) {
        const amount = `${dollars(spend.used, spend.currency, 0)}${spend.limit !== undefined ? `/${dollars(spend.limit, spend.currency, 0)}` : ""}`;
        append(accounts, claudeShort(state), (label) => paint(levelOf(spend.usedPercent ?? 0), `${label} ${amount}${spend.usedPercent !== undefined ? ` ${pct(spend.usedPercent)}` : ""}${stale}`));
      }
      continue;
    }
    if (state.id === "cursor") {
      // Total included plan plus the API pool (manual model picks bill there); Auto stays in the details.
      const windows = state.value.groups.flatMap((g) => g.windows).filter((w) => w.id === "month" || w.id === "api");
      const bars = windows.map((w) => paint(levelOf(w.usedPercent), `${w.id === "month" ? "Total" : w.label} ${usageBar(w.usedPercent)} ${pct(w.usedPercent)}`));
      if (bars.length) append(accounts, "Cursor", (label) => `${label} ${bars.join(" ")}${stale}`);
      continue;
    }
    const windows = state.value.groups.flatMap((g) => g.windows);
    const name = state.id === "antigravity" ? "AG" : state.id === "codex" ? "Codex 1" : state.id.startsWith("codex-") ? state.name : state.value.groups[0]?.shortName ?? state.name;
    append(quota, name, (label) => chip(label, windows, stale));
  }
  return [quota.join("  "), accounts.join("  ")];
}
const shortNames: Partial<Record<ProviderId, string>> = { codex: "Codex 1", antigravity: "Antigravity", copilot: "Copilot", cursor: "Cursor", muse: "Muse" };
const clockTime = (t: number): string => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
// Resets within a day show a time; later ones add the weekday and date.
function resetTime(t: number, now: number): string {
  if (t >= now && t - now < 86_400_000) return clockTime(t);
  return `${new Date(t).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} ${clockTime(t)}`;
}
const NAME_WIDTH = 14;
const CELL_WIDTH = 12;
// One row per provider group for the /provider-usage modal; full text stays in detailText.
export function usageTable(states: readonly ProviderState[], now = Date.now(), paint: UsagePaint = (_level, text) => text): string[] {
  const pct = (n: number) => n > 0 && n < 1 ? "<1%" : `${Math.round(n)}%`;
  const cell = (w: QuotaWindow | undefined): string => {
    if (!w) return "\u2013".padEnd(CELL_WIDTH);
    return paint(levelOf(w.usedPercent), `${usageBar(w.usedPercent, 5)} ${pct(w.usedPercent)}`.padEnd(CELL_WIDTH));
  };
  const row = (name: string, windows: readonly QuotaWindow[], notes: string[]): string =>
    `${name.slice(0, NAME_WIDTH - 1).padEnd(NAME_WIDTH)}${cell(windows.find((w) => w.id === "5h"))}${cell(windows.find((w) => w.id === "week"))}${notes.filter(Boolean).join(" \u00b7 ")}`;
  const resets = (windows: readonly QuotaWindow[]): string => {
    const parts = windows.filter((w) => w.resetsAt !== undefined && ["5h", "week", "month"].includes(w.id))
      .map((w) => `${w.id === "week" ? "wk" : w.id} ${resetTime(w.resetsAt!, now)}`);
    return parts.length ? `\u21bb ${parts.join(", ")}` : "";
  };
  const lines = [`${"Provider".padEnd(NAME_WIDTH)}${"5h".padEnd(CELL_WIDTH)}${"Week".padEnd(CELL_WIDTH)}Resets / notes`];
  for (const state of states) {
    const name = shortNames[state.id] ?? (state.id === "codex" || state.id.startsWith("codex-") ? state.name : claudeShort(state));
    const status = state.error === "Claude usage refresh rate limited" ? paint("warn", "rate limited")
      : state.value && state.error ? paint("warn", "stale") : "";
    if (!state.value) {
      lines.push(row(name, [], [state.status === "loading" ? "loading\u2026" : state.error ?? "unavailable"]));
      continue;
    }
    if (state.value.kind === "credits") {
      const credits = state.value.consumed;
      lines.push(row(name, [], [`$${Math.round(credits / 100).toLocaleString("en-US")} (${credits.toLocaleString("en-US")} credits)`,
        state.value.resetsAt === undefined ? "" : `\u21bb ${resetTime(state.value.resetsAt, now)}`, status]));
      continue;
    }
    if (state.value.kind === "spend") {
      const { spend, windows } = state.value;
      const amount = spend ? `${dollars(spend.used, spend.currency, 0)}${spend.limit !== undefined ? `/${dollars(spend.limit, spend.currency, 0)}` : ""}${spend.usedPercent !== undefined ? ` ${pct(spend.usedPercent)}` : ""}` : "";
      lines.push(row(name, windows, [resets(windows), amount, status]));
      continue;
    }
    const multiple = state.value.groups.length > 1;
    for (const g of state.value.groups) {
      const others = g.windows.filter((w) => w.id !== "5h" && w.id !== "week").map((w) => w.id === "auto" || w.id === "api"
        ? paint(levelOf(w.usedPercent), `${w.label} ${usageBar(w.usedPercent, 5)} ${pct(w.usedPercent)}`) : `${w.label} ${pct(w.usedPercent)}`).join("  ");
      const count = state.id === "codex" || state.id.startsWith("codex-") ? state.value.resetCredits?.available : undefined;
      lines.push(row(multiple ? g.shortName : name, g.windows, [others, resets(g.windows), count?.kind === "known" ? `resets ${count.value}` : "", g.asOf === undefined ? "" : `as of ${clockTime(g.asOf)}`, status]));
    }
  }
  return lines;
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
      if (fetchedAt !== undefined) lines.push(`  Claude Code cache fetched: ${localized(fetchedAt)}`);
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
      for (const w of g.windows) lines.push(`    ${w.id === "5h" ? "Five-hour window (5h)" : w.id === "week" ? "Weekly window (week)" : w.id === "month" ? "30-day window (month)" : w.label}: ${percent(w.usedPercent)} used · resets: ${localized(w.resetsAt)}`);
    }
    if (state.id === "codex" || state.id.startsWith("codex-")) {
      const counts = state.value?.kind === "quota" ? state.value.resetCredits : undefined;
      const display = (count: ResetCount | undefined) => count?.kind === "known" ? String(count.value) : "unknown";
      lines.push(`  Reset credits: ${display(counts?.available)} available \u00b7 ${display(counts?.applicable)} applicable`);
    }
    return [...lines, ""];
  })].join("\n");
}
