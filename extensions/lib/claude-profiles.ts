import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

// Claude Code accounts are numbered profiles, each its own CLAUDE_CONFIG_DIR
// and its own provider: profile 1 is the bridge's `claude-bridge`, the rest
// are clones `claude-bridge-N` that pin their dir for each call (see
// claude-providers.ts). Like Codex, picking an account = picking a provider.

export const CLAUDE_BRIDGE = "claude-bridge";

export type ClaudeProfileId = `claude-${number}`;

export interface ClaudeProfile {
  id: ClaudeProfileId;
  index: number;
  name: string;
  configDir: string;
  // Stable across renumbering, so settings that name it keep working.
  provider: string;
  // Keeps ANTHROPIC_API_KEY when active; other profiles hide it so the key
  // never shadows their OAuth login.
  useApiKey: boolean;
}

export interface StoredClaudeProfile {
  dir: string;
  provider?: string;
  apiKey?: boolean;
}

export interface StoredClaudeConfig {
  profiles: StoredClaudeProfile[];
  // Last Claude model, reused when a Claude account becomes main again.
  lastModel?: string;
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isClaudeBridgeProvider(provider: string | undefined): boolean {
  return provider === CLAUDE_BRIDGE || /^claude-bridge-\d+$/.test(provider ?? "");
}

export function defaultProfilesConfigFile(agentDir: string = getAgentDir()): string {
  return path.join(agentDir, "claude-profiles.json");
}

// Without a saved list, profile 1 is ~/.claude (with the API key) and
// profile 2 is ~/.claude-personal, matching the old work/personal pair.
// The legacy {workDir, personalDir} file migrates to the same shape.
export function legacyClaudeConfig(home: string, workDir?: string, personalDir?: string): StoredClaudeConfig {
  return {
    profiles: [
      { dir: workDir ?? path.join(home, ".claude"), provider: CLAUDE_BRIDGE, apiKey: true },
      { dir: personalDir ?? path.join(home, ".claude-personal"), provider: `${CLAUDE_BRIDGE}-2` },
    ],
  };
}

// Next free claude-bridge-N, starting past the profile count so a new
// account's provider id tends to match its number.
export function nextBridgeProvider(profiles: readonly StoredClaudeProfile[], from = profiles.length + 1): string {
  const used = new Set(profiles.map((p) => p.provider));
  for (let n = Math.max(2, from); ; n++) if (!used.has(`${CLAUDE_BRIDGE}-${n}`)) return `${CLAUDE_BRIDGE}-${n}`;
}

export function loadClaudeConfig(configFile: string = defaultProfilesConfigFile(), home: string = homedir()): StoredClaudeConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configFile, "utf8"));
  } catch {
    return legacyClaudeConfig(home);
  }
  if (!isRecord(parsed)) return legacyClaudeConfig(home);
  const str = (value: unknown) => (typeof value === "string" ? clean(value) : undefined);
  if (!Array.isArray(parsed.profiles)) return legacyClaudeConfig(home, str(parsed.workDir), str(parsed.personalDir));
  const profiles: StoredClaudeProfile[] = [];
  for (const entry of parsed.profiles) {
    if (!isRecord(entry)) continue;
    const dir = str(entry.dir);
    if (!dir || profiles.some((p) => sameDir(p.dir, dir))) continue;
    const provider = str(entry.provider);
    profiles.push({
      dir,
      ...(isClaudeBridgeProvider(provider) && !profiles.some((p) => p.provider === provider) ? { provider } : {}),
      ...(entry.apiKey === true ? { apiKey: true } : {}),
    });
  }
  // Older files had no provider ids: the first profile gets the bridge itself.
  profiles.forEach((profile, i) => {
    if (profile.provider) return;
    profile.provider = i === 0 && !profiles.some((p) => p.provider === CLAUDE_BRIDGE) ? CLAUDE_BRIDGE : nextBridgeProvider(profiles, i + 1);
  });
  const lastModel = str(parsed.lastModel);
  return { profiles, ...(lastModel ? { lastModel } : {}) };
}

export function saveClaudeConfig(config: StoredClaudeConfig, configFile: string = defaultProfilesConfigFile()): void {
  mkdirSync(path.dirname(configFile), { recursive: true });
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

// CLAUDE_PROFILE_<N>_DIR overrides profile N; the old WORK/PERSONAL names
// still override profiles 1 and 2.
export function claudeProfiles(env: NodeJS.ProcessEnv = process.env, config: StoredClaudeConfig = loadClaudeConfig()): ClaudeProfile[] {
  return config.profiles.map((stored, i) => {
    const index = i + 1;
    const legacy = index === 1 ? env.CLAUDE_PROFILE_WORK_DIR : index === 2 ? env.CLAUDE_PROFILE_PERSONAL_DIR : undefined;
    return {
      id: `claude-${index}`,
      index,
      name: `Claude ${index}`,
      configDir: clean(env[`CLAUDE_PROFILE_${index}_DIR`]) ?? clean(legacy) ?? stored.dir,
      provider: stored.provider ?? (i === 0 ? CLAUDE_BRIDGE : `${CLAUDE_BRIDGE}-${index}`),
      useApiKey: stored.apiKey === true,
    };
  });
}

export function sameDir(a: string, b: string): boolean {
  const normalize = (p: string) => path.normalize(p).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalize(a).toLowerCase() === normalize(b).toLowerCase() : normalize(a) === normalize(b);
}

const SAVED_API_KEY = "CLAUDE_PROFILE_SAVED_API_KEY";

export function switchClaudeProfile(profile: ClaudeProfile, env: NodeJS.ProcessEnv = process.env): ClaudeProfile {
  if (clean(env.ANTHROPIC_API_KEY) && clean(env[SAVED_API_KEY]) === undefined) {
    env[SAVED_API_KEY] = env.ANTHROPIC_API_KEY ?? "";
  }
  if (!profile.useApiKey) {
    delete env.ANTHROPIC_API_KEY;
  } else if (clean(env.ANTHROPIC_API_KEY) === undefined && clean(env[SAVED_API_KEY])) {
    env.ANTHROPIC_API_KEY = env[SAVED_API_KEY] ?? "";
  }
  env.CLAUDE_CONFIG_DIR = profile.configDir;
  return profile;
}

// Runs fn with the profile's dir and key in env, then restores both. The
// bridge reads env synchronously when a call starts (session lookup and the
// Claude Code child env), so concurrent sessions on different profiles don't mix.
export function withClaudeProfileEnv<T>(profile: ClaudeProfile, fn: () => T, env: NodeJS.ProcessEnv = process.env): T {
  const dir = env.CLAUDE_CONFIG_DIR;
  const key = env.ANTHROPIC_API_KEY;
  switchClaudeProfile(profile, env);
  try {
    return fn();
  } finally {
    if (dir === undefined) delete env.CLAUDE_CONFIG_DIR;
    else env.CLAUDE_CONFIG_DIR = dir;
    if (key === undefined) delete env.ANTHROPIC_API_KEY;
    else env.ANTHROPIC_API_KEY = key;
  }
}

// Pins the process env to the profile that owns `claude-bridge`, so the
// bridge's own provider always means Claude 1's account.
export function applyBridgeProfile(
  env: NodeJS.ProcessEnv = process.env,
  config: StoredClaudeConfig = loadClaudeConfig(),
): ClaudeProfile | undefined {
  const base = claudeProfiles(env, config).find((profile) => profile.provider === CLAUDE_BRIDGE);
  return base ? switchClaudeProfile(base, env) : undefined;
}

export function suggestedProfileDir(config: StoredClaudeConfig, home: string = homedir()): string {
  for (let n = config.profiles.length + 1; ; n++) {
    const dir = path.join(home, `.claude-${n}`);
    if (!config.profiles.some((p) => sameDir(p.dir, dir))) return dir;
  }
}

export function addClaudeProfile(config: StoredClaudeConfig, dir: string): StoredClaudeConfig {
  if (config.profiles.some((p) => sameDir(p.dir, dir))) throw new Error(`${dir} is already a Claude profile`);
  return { ...config, profiles: [...config.profiles, { dir, provider: nextBridgeProvider(config.profiles) }] };
}

export function removeClaudeProfile(config: StoredClaudeConfig, dir: string): StoredClaudeConfig {
  return { ...config, profiles: config.profiles.filter((p) => !sameDir(p.dir, dir)) };
}

export function expandHome(value: string, home: string = homedir()): string {
  const trimmed = value.trim();
  if (trimmed === "~" || trimmed.startsWith("~/") || trimmed.startsWith("~\\")) return path.join(home, trimmed.slice(2));
  return trimmed;
}

// Ready = a login lives in that dir: OAuth creds file, or identity markers in
// its .claude.json. Only presence is inspected; secret values never leave here.
export function isProfileReady(configDir: string): boolean {
  try {
    if (existsSync(path.join(configDir, ".credentials.json"))) return true;
    const parsed: unknown = JSON.parse(readFileSync(path.join(configDir, ".claude.json"), "utf8"));
    if (!isRecord(parsed)) return false;
    if (typeof parsed.emailAddress === "string" && parsed.emailAddress.trim()) return true;
    return isRecord(parsed.oauthAccount) && Object.keys(parsed.oauthAccount).length > 0;
  } catch {
    return false;
  }
}

export function claudeLoginSteps(configDir: string): string {
  return [
    `Log in once outside Pi:`,
    `  Git Bash: CLAUDE_CONFIG_DIR="${configDir}" claude login`,
    `  PowerShell: $env:CLAUDE_CONFIG_DIR="${configDir}"; claude login`,
    `Sign in with the account for this profile, then reopen /account.`,
  ].join("\n");
}
