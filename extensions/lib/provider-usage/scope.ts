import { createHash } from "node:crypto";
import { closeSync, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { ProviderId } from "./model.ts";

export type UsageScope = { key: string; generation: string; identity: "known" | "opaque" };
export interface ScopeDependencies {
  env?: NodeJS.ProcessEnv;
  home?: string;
  platform?: NodeJS.Platform;
  readFile?: (file: string) => Buffer | undefined;
}
const digest = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const hash = (value: unknown): string => digest(JSON.stringify(value));
const LIMIT = 1_048_576;
function localFile(file: string): Buffer | undefined {
  let fd: number | undefined;
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.size > LIMIT) throw new Error("Unavailable scope source");
    fd = openSync(file, "r");
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.size > LIMIT || opened.ino !== stat.ino || opened.dev !== stat.dev) throw new Error("Unavailable scope source");
    const bytes = Buffer.alloc(LIMIT + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(fd, bytes, size, bytes.length - size, null);
      if (!count) break;
      size += count;
    }
    if (size > LIMIT) throw new Error("Unavailable scope source");
    return bytes.subarray(0, size);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error("Unavailable scope source");
  } finally { if (fd !== undefined) closeSync(fd); }
}
function localPresence(file: string): boolean {
  try {
    if (!lstatSync(file).isFile()) throw new Error("Unavailable scope source");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new Error("Unavailable scope source");
  }
}
function identity(bytes: Buffer | undefined): unknown {
  if (!bytes) return null;
  const data: unknown = JSON.parse(bytes.toString("utf8"));
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Unavailable scope source");
  const account = (data as Record<string, unknown>).oauthAccount;
  if (!account || typeof account !== "object" || Array.isArray(account)) return null;
  const source = account as Record<string, unknown>;
  const fields = ["accountUuid", "organizationUuid", "emailAddress"].map((key) => typeof source[key] === "string" && source[key] ? source[key] : null);
  return fields.some((value) => value !== null) ? fields : null;
}

export function usageScope(id: ProviderId, configDir?: string, deps: ScopeDependencies = {}): () => Promise<UsageScope> {
  return async () => {
    const env = deps.env ?? process.env;
    const home = deps.home ?? homedir();
    const platform = deps.platform ?? process.platform;
    const paths = platform === "win32" ? path.win32 : path.posix;
    const join = (...parts: string[]) => paths.join(...parts);
    const loaded = new Map<string, Buffer | undefined>();
    const read = (file: string): Buffer | undefined => {
      if (!loaded.has(file)) loaded.set(file, (deps.readFile ?? localFile)(file));
      return loaded.get(file);
    };
    const files: string[] = [];
    const credentialFiles: string[] = [];
    let credentialEnv: string[] = [];
    let accountKnown = false;
    let mutableState: string | undefined;
    let selectors: string[] = [];
    let root: string;
    let marker: unknown = null;
    if (id.startsWith("claude-")) {
      if (!configDir) throw new Error("Unavailable scope source");
      root = configDir;
      selectors = ["CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN_FILE", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "ANTHROPIC_CUSTOM_HEADERS", "CLAUDE_CODE_OAUTH_CLIENT_ID", "ANTHROPIC_AUTH_TOKEN_FILE", "ANTHROPIC_DEFAULT_OPUS_MODEL", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"];
      files.push(join(root, ".credentials.json"));
      credentialFiles.push(join(root, ".credentials.json"));
      credentialEnv = ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_AUTH_TOKEN"];
      marker = identity(read(join(root, ".claude.json")));
      accountKnown = marker !== null;
      for (const key of ["CLAUDE_CODE_OAUTH_TOKEN_FILE", "ANTHROPIC_AUTH_TOKEN_FILE"]) if (env[key]) { files.push(env[key]!); credentialFiles.push(env[key]!); }
    } else if (id === "codex") {
      root = env.CODEX_HOME || join(home, ".codex");
      selectors = ["CODEX_HOME", "CODEX_API_KEY", "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_ORG_ID", "OPENAI_ORGANIZATION", "OPENAI_PROJECT_ID", "CODEX_AUTH_FILE", "OPENAI_API_KEY_FILE", "CODEX_IDENTITY_FILE", "CODEX_BASE_URL", "CODEX_ACCESS_TOKEN", "OPENAI_FEDERATION_RULE_ID", "OPENAI_IDENTITY_TOKEN_FILE", "OPENAI_WORKLOAD_IDENTITY_CONTEXT"];
      files.push(join(root, "auth.json"), join(root, "config.toml"));
      credentialFiles.push(join(root, "auth.json"));
      credentialEnv = ["CODEX_ACCESS_TOKEN", "CODEX_API_KEY", "OPENAI_API_KEY"];
      for (const key of ["CODEX_AUTH_FILE", "OPENAI_API_KEY_FILE", "CODEX_IDENTITY_FILE", "OPENAI_IDENTITY_TOKEN_FILE"]) if (env[key]) {
        files.push(env[key]!);
        if (key === "OPENAI_IDENTITY_TOKEN_FILE") credentialFiles.push(env[key]!);
      }
    } else if (id === "copilot") {
      root = env.GH_CONFIG_DIR || (env.XDG_CONFIG_HOME ? join(env.XDG_CONFIG_HOME, "gh") : platform === "win32" && env.APPDATA ? join(env.APPDATA, "GitHub CLI") : join(home, ".config", "gh"));
      selectors = ["GH_CONFIG_DIR", "XDG_CONFIG_HOME", "APPDATA", "GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN"];
      marker = env.GH_HOST || "github.com";
      files.push(join(root, "hosts.yml"), join(root, "config.yml"));
      credentialFiles.push(join(root, "hosts.yml"));
      credentialEnv = ["GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN"];
    } else if (id === "cursor") {
      root = env.CURSOR_CONFIG_DIR?.trim() ? env.CURSOR_CONFIG_DIR : (env.XDG_CONFIG_HOME?.trim() ? join(env.XDG_CONFIG_HOME, "cursor") : join(home, ".cursor"));
      const auth = platform === "win32" ? join(env.APPDATA || join(home, "AppData", "Roaming"), "Cursor", "auth.json")
        : platform === "darwin" ? join(home, ".cursor", "auth.json") : join(env.XDG_CONFIG_HOME || join(home, ".config"), "cursor", "auth.json");
      selectors = ["CURSOR_CONFIG_DIR", "XDG_CONFIG_HOME", "APPDATA", "AGENT_CLI_CREDENTIAL_STORE"];
      const configFile = join(root, "cli-config.json");
      files.push(auth, configFile);
      credentialFiles.push(auth);
      const configBytes = read(configFile);
      if (configBytes) {
        const config: unknown = JSON.parse(configBytes.toString("utf8"));
        if (config && typeof config === "object" && !Array.isArray(config)) {
          const info = (config as Record<string, unknown>).authInfo;
          if (info && typeof info === "object" && !Array.isArray(info)) {
            const team = (info as Record<string, unknown>).activeTeamId;
            if (typeof team === "number" && Number.isSafeInteger(team) && team > 0) marker = team;
          }
        }
      }
    } else {
      root = join(home, ".gemini");
      selectors = ["AGY_ADC_AUTH", "GEMINI_API_KEY", "AGY_LLM_GATEWAY_API_KEY", "AGY_LLM_GATEWAY_HEADERS", "AGY_LLM_GATEWAY_URL", "ANTIGRAVITY_GEMINI_DIR", "ANTIGRAVITY_CONFIG_REL_DIR", "ANTIGRAVITY_APP_DATA_DIR", "AGY_ACCOUNT"];
      // Keyring service antigravity has no portable content fingerprint; without
      // a visible credential source, fallback values must expire after five minutes.
      marker = "keyring:antigravity";
      mutableState = join(root, "antigravity-cli", "jetski_state.pbtxt");
      files.push(join(root, "jetski-standalone-oauth-token"), join(root, "antigravity-cli", "settings.json"), mutableState);
      credentialFiles.push(join(root, "jetski-standalone-oauth-token"));
      credentialEnv = ["GEMINI_API_KEY", "AGY_LLM_GATEWAY_API_KEY"];
    }
    const namespace = ["provider-usage-v1", id, platform, paths.normalize(root), marker, selectors.map((key) => [key, env[key] ?? null])];
    const fingerprints = files.map((file) => {
      // Mutable CLI state is presence metadata, not a credential fingerprint.
      if (file === mutableState) return [file, (deps.readFile ? read(file) !== undefined : localPresence(file)) ? "present" : "missing"];
      const bytes = read(file);
      return [file, bytes === undefined ? "missing" : digest(bytes)];
    });
    const key = hash(namespace);
    const confidence = accountKnown || credentialEnv.some((name) => Boolean(env[name]?.trim())) || credentialFiles.some((file) => Boolean(read(file)?.length)) ? "known" : "opaque";
    return { key, generation: hash([key, marker, fingerprints]), identity: confidence };
  };
}
