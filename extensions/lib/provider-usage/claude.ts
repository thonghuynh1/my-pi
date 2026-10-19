import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { ProcessRequest, ProcessRunner } from "./readers.ts";

// `/usage` is a local command in print mode: no model turn, no cost. It refreshes Claude Code's
// own cachedUsageUtilization in ~/.claude.json. We never read OAuth tokens or cookies.
export const CLAUDE_USAGE_REQUEST: ProcessRequest = {
  command: "claude",
  args: ["-p", "/usage", "--output-format", "json", "--no-session-persistence"],
};
const FILE_LIMIT = 16 * 1024 * 1024;
const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};

export class ClaudeUsageError extends Error {}
export interface ClaudeUsageDependencies {
  readFile?: (file: string) => Promise<string>;
  env?: NodeJS.ProcessEnv;
  home?: string;
}
export function claudeConfigFile(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return env.CLAUDE_CONFIG_DIR ? path.join(env.CLAUDE_CONFIG_DIR, ".claude.json") : path.join(home, ".claude.json");
}
async function boundedRead(file: string): Promise<string> {
  const info = await stat(file);
  if (!info.isFile() || info.size > FILE_LIMIT) throw new ClaudeUsageError("Claude usage cache unavailable");
  return readFile(file, "utf8");
}
// Returns only the usage cache fields; the config file also holds account identity we must not retain.
export async function readClaudeUsage(run: ProcessRunner, signal: AbortSignal, deps: ClaudeUsageDependencies = {}): Promise<unknown> {
  const result = record(await run(CLAUDE_USAGE_REQUEST, signal));
  if (result.is_error === true || result.local_command !== "usage") throw new ClaudeUsageError("Claude /usage did not run as a local command; check CLI login");
  signal.throwIfAborted();
  let text: string;
  try { text = await (deps.readFile ?? boundedRead)(claudeConfigFile(deps.env, deps.home)); }
  catch { throw new ClaudeUsageError("Claude usage cache unavailable"); }
  let config: unknown;
  try { config = JSON.parse(text); } catch { throw new ClaudeUsageError("Claude usage cache unreadable"); }
  const cache = record(record(config).cachedUsageUtilization);
  const usage = record(cache.utilization);
  return {
    fetchedAtMs: cache.fetchedAtMs,
    utilization: { five_hour: usage.five_hour, seven_day: usage.seven_day, spend: usage.spend, extra_usage: usage.extra_usage },
  };
}
