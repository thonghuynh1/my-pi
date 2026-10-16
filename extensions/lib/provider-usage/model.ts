export type ProviderId = "codex" | "antigravity" | "copilot";
export type QuotaWindow = { id: string; label: string; usedPercent: number; resetsAt?: number };
export type QuotaGroup = { id: string; name: string; shortName: string; windows: QuotaWindow[] };
export type UsageMetric =
  | { kind: "quota"; groups: QuotaGroup[] }
  | { kind: "credits"; consumed: number; resetsAt?: number };
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

const percent = (n: number): string => `${Number(n.toFixed(1))}%`;
export function footerRows(states: readonly ProviderState[]): string[] {
  return states.flatMap((state) => {
    if (!state.value) return [];
    const stale = state.error && state.value ? " · stale" : "";
    if (state.value.kind === "credits") return [`Copilot ${state.value.consumed.toLocaleString("en-US")} credits used${stale}`];
    return state.value.groups.map((g) => {
      const resetsAt = g.windows.find((w) => w.id === "5h")?.resetsAt;
      const resetTime = resetsAt === undefined ? "" : ` · 5h reset ${new Date(resetsAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
      return `${g.shortName} ${g.windows.map((w) => `${w.label} ${percent(w.usedPercent)}`).join(" · ")} used${resetTime}${stale}`;
    });
  });
}
const localized = (timestamp: number | undefined): string => timestamp === undefined ? "unavailable" : new Date(timestamp).toLocaleString();
export function detailText(states: readonly ProviderState[]): string {
  return ["Provider account usage", "r refresh · ↑/↓ scroll · Esc/q close", "", ...states.flatMap((state) => {
    const lines = [`${state.name}${state.experimental ? " (experimental internal API)" : ""}`,
      `  ${state.status}${state.value && state.error ? " · stale" : ""} · last refresh: ${localized(state.lastAttempt)}`,
      `  Last success: ${localized(state.lastSuccess)}`];
    if (state.error) lines.push(`  Reason: ${state.error}`);
    if (!state.value) lines.push("  Usage unavailable (no successful read)");
    else if (state.value.kind === "credits") lines.push(`  ${state.value.consumed.toLocaleString("en-US")} credits consumed`, `  Resets: ${localized(state.value.resetsAt)}`);
    else for (const g of state.value.groups) {
      lines.push(`  ${g.name}`);
      for (const id of ["5h", "week"]) if (!g.windows.some((w) => w.id === id)) lines.push(`    ${id === "5h" ? "Five-hour window (5h)" : "Weekly window (week)"}: unavailable / not applicable`);
      for (const w of g.windows) lines.push(`    ${w.id === "5h" ? "Five-hour window (5h)" : w.id === "week" ? "Weekly window (week)" : w.label}: ${percent(w.usedPercent)} used · resets: ${localized(w.resetsAt)}`);
    }
    return [...lines, ""];
  })].join("\n");
}
