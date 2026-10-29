import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { SelectItem } from "@earendil-works/pi-tui";

export const CLAUDE_PROFILE_IDS = ["work", "personal"] as const;
export type ClaudeProfileId = (typeof CLAUDE_PROFILE_IDS)[number];

export interface ClaudeProfile {
  id: ClaudeProfileId;
  name: string;
  shortName: string;
  configDir: string;
}

export type ClaudeProfileMap = Record<ClaudeProfileId, ClaudeProfile>;

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function claudeProfiles(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  stored: StoredProfileDirs = loadStoredProfileDirs(),
): ClaudeProfileMap {
  return {
    work: {
      id: "work",
      name: "Claude Work",
      shortName: "Claude-W",
      configDir: clean(env.CLAUDE_PROFILE_WORK_DIR) ?? stored.workDir ?? path.join(home, ".claude"),
    },
    personal: {
      id: "personal",
      name: "Claude Personal",
      shortName: "Claude-P",
      configDir: clean(env.CLAUDE_PROFILE_PERSONAL_DIR) ?? stored.personalDir ?? path.join(home, ".claude-personal"),
    },
  };
}

function sameDir(a: string, b: string): boolean {
  return path.normalize(a) === path.normalize(b);
}

export function currentClaudeProfileId(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  stored: StoredProfileDirs = loadStoredProfileDirs(),
): ClaudeProfileId {
  const profiles = claudeProfiles(env, home, stored);
  const active = clean(env.CLAUDE_CONFIG_DIR);
  if (active && sameDir(active, profiles.personal.configDir)) return "personal";
  return "work";
}

const SAVED_API_KEY = "CLAUDE_PROFILE_SAVED_API_KEY";

export function switchClaudeProfile(
  id: ClaudeProfileId,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  stored: StoredProfileDirs = loadStoredProfileDirs(),
): ClaudeProfile {
  const profiles = claudeProfiles(env, home, stored);
  const target = profiles[id];
  if (clean(env.ANTHROPIC_API_KEY) && clean(env[SAVED_API_KEY]) === undefined) {
    env[SAVED_API_KEY] = env.ANTHROPIC_API_KEY ?? "";
  }
  if (id === "personal") {
    delete env.ANTHROPIC_API_KEY;
  } else if (clean(env.ANTHROPIC_API_KEY) === undefined && clean(env[SAVED_API_KEY])) {
    env.ANTHROPIC_API_KEY = env[SAVED_API_KEY] ?? "";
  }
  env.CLAUDE_CONFIG_DIR = target.configDir;
  return target;
}

// ---- persisted setup -----------------------------------------------------

export interface StoredProfileDirs {
  workDir?: string;
  personalDir?: string;
  activeProfile?: ClaudeProfileId;
}

export function defaultProfilesConfigFile(agentDir: string = getAgentDir()): string {
  return path.join(agentDir, "claude-profiles.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function loadStoredProfileDirs(configFile: string = defaultProfilesConfigFile()): StoredProfileDirs {
  try {
    const parsed: unknown = JSON.parse(readFileSync(configFile, "utf8"));
    if (!isRecord(parsed)) return {};
    const pick = (key: string): string | undefined =>
      typeof parsed[key] === "string" && (parsed[key] as string).trim() ? (parsed[key] as string).trim() : undefined;
    const workDir = pick("workDir");
    const personalDir = pick("personalDir");
    const active = pick("activeProfile");
    const activeProfile = active && isProfileId(active) ? active : undefined;
    return {
      ...(workDir ? { workDir } : {}),
      ...(personalDir ? { personalDir } : {}),
      ...(activeProfile ? { activeProfile } : {}),
    };
  } catch {
    return {};
  }
}

export function saveStoredProfileDirs(dirs: StoredProfileDirs, configFile: string = defaultProfilesConfigFile()): void {
  mkdirSync(path.dirname(configFile), { recursive: true });
  writeFileSync(configFile, `${JSON.stringify(dirs, null, 2)}\n`, { mode: 0o600 });
}

// File-backed dirs flow into the live session env (env vars still win).
// This is the "do the env setting for us" step: restart-safe without setx.
export function applyStoredProfileDirs(env: NodeJS.ProcessEnv = process.env, stored: StoredProfileDirs = loadStoredProfileDirs()): void {
  if (!clean(env.CLAUDE_PROFILE_WORK_DIR) && stored.workDir) env.CLAUDE_PROFILE_WORK_DIR = stored.workDir;
  if (!clean(env.CLAUDE_PROFILE_PERSONAL_DIR) && stored.personalDir) env.CLAUDE_PROFILE_PERSONAL_DIR = stored.personalDir;
}

export function saveActiveProfile(id: ClaudeProfileId, configFile: string = defaultProfilesConfigFile()): void {
  saveStoredProfileDirs({ ...loadStoredProfileDirs(configFile), activeProfile: id }, configFile);
}

// The last picked profile survives Pi restarts. Skipped when it is no longer
// logged in, so a broken login falls back to the default instead of failing.
export function restoreActiveProfile(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  stored: StoredProfileDirs = loadStoredProfileDirs(),
): ClaudeProfile | undefined {
  if (!stored.activeProfile) return undefined;
  const target = claudeProfiles(env, home, stored)[stored.activeProfile];
  if (!isProfileReady(target.configDir)) return undefined;
  return switchClaudeProfile(stored.activeProfile, env, home, stored);
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

export type PickerSelection = { kind: "pick"; id: ClaudeProfileId } | { kind: "setup"; id: ClaudeProfileId };

export function buildPickerItems(
  profiles: ClaudeProfileMap,
  ready: Record<ClaudeProfileId, boolean>,
  current: ClaudeProfileId,
): SelectItem[] {
  return CLAUDE_PROFILE_IDS.map((id) => {
    const profile = profiles[id];
    if (ready[id]) {
      return {
        value: profile.id,
        label: id === current ? `${profile.name} (current)` : profile.name,
        description: profile.configDir,
      } satisfies SelectItem;
    }
    return {
      value: `setup:${id}`,
      label: `+ Set up ${profile.name}...`,
      description: `Choose a folder, then run claude login once`,
    } satisfies SelectItem;
  });
}

export function parsePickerValue(value: string): PickerSelection | undefined {
  if (isProfileId(value)) return { kind: "pick", id: value };
  const match = /^setup:(work|personal)$/.exec(value);
  if (match && isProfileId(match[1])) return { kind: "setup", id: match[1] };
  return undefined;
}

function isProfileId(value: string): value is ClaudeProfileId {
  return (CLAUDE_PROFILE_IDS as readonly string[]).includes(value);
}
