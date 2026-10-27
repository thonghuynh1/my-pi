import type { ProcessRequest, ProcessRunner } from "./readers.ts";

// Native diagnostics prove freshness: get_usage success alone can contain cached quotas.
export const CLAUDE_USAGE_REQUEST: ProcessRequest = {
  command: "claude",
  args: ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--no-session-persistence", "--debug-to-stderr"],
  protocol: "claude",
};
const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};

export class ClaudeUsageError extends Error {}
export async function readClaudeUsageAt(run: ProcessRunner, signal: AbortSignal, configDir: string): Promise<unknown> {
  const result = record(await run({ ...CLAUDE_USAGE_REQUEST, env: {
    CLAUDE_CONFIG_DIR: configDir,
    ANTHROPIC_API_KEY: undefined,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: undefined,
    DISABLE_TELEMETRY: "1",
    DISABLE_ERROR_REPORTING: "1",
    DISABLE_AUTOUPDATER: "1",
  } }, signal));
  signal.throwIfAborted();
  if (result.rate_limits_available !== true || result.rate_limits === null || typeof result.rate_limits !== "object" || Array.isArray(result.rate_limits)) {
    throw new ClaudeUsageError("Claude usage unavailable; check CLI login");
  }
  const usage = record(result.rate_limits);
  return { utilization: { five_hour: usage.five_hour, seven_day: usage.seven_day, spend: usage.spend, extra_usage: usage.extra_usage } };
}
