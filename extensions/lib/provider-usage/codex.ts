import { accountId, codexRequest, responseJson } from "./codex-http.ts";

const ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export interface CodexUsageDependencies {
  apiKey?: () => Promise<string | undefined>;
  fallback: (signal: AbortSignal) => Promise<unknown>;
  fetch?: typeof globalThis.fetch;
}
function window(raw: unknown): unknown {
  const source = record(raw);
  return {
    usedPercent: source.used_percent,
    windowDurationMins: typeof source.limit_window_seconds === "number" ? source.limit_window_seconds / 60 : undefined,
    resetsAt: source.reset_at,
  };
}
export function createCodexUsageReader(deps: CodexUsageDependencies): (signal: AbortSignal) => Promise<unknown> {
  return async (signal) => {
    signal.throwIfAborted();
    if (!deps.apiKey) return deps.fallback(signal);
    const token = await deps.apiKey();
    signal.throwIfAborted();
    if (token === undefined) return deps.fallback(signal);
    const selectedAccount = accountId(token);
    const request = codexRequest(token, selectedAccount, signal);
    const response = await (deps.fetch ?? globalThis.fetch)(ENDPOINT, request);
    const limits = record(record(await responseJson(response, request.signal!)).rate_limit);
    return { rateLimits: { primary: window(limits.primary_window), secondary: window(limits.secondary_window) } };
  };
}
