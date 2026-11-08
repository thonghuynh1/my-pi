import { mkdirSync, readFileSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

// Pi has one built-in Codex provider (`openai-codex`) with one auth.json slot.
// Extra ChatGPT accounts become clone providers (`codex-2`, `codex-3`, ...),
// each with its own auth.json slot, so the main session and subagents can run
// on different accounts at the same time. Pi owns login and token refresh for
// every slot; this module only tracks slot ids, labels, and role settings.

export const BUILTIN_CODEX = "openai-codex";

export interface CodexSlot {
  provider: string;
  label?: string;
}

export interface CodexSlotConfig {
  slots: CodexSlot[];
}

export interface CodexIdentity {
  key: string;
  email?: string;
  plan?: string;
}

export interface CodexPaths {
  agentDir: string;
  authFile: string;
  configFile: string;
  settingsFile: string;
  subagentModelsFile: string;
}

export function defaultCodexPaths(agentDir: string = getAgentDir()): CodexPaths {
  return {
    agentDir,
    authFile: path.join(agentDir, "auth.json"),
    configFile: path.join(agentDir, "codex-slots.json"),
    settingsFile: path.join(agentDir, "settings.json"),
    subagentModelsFile: path.join(agentDir, "agents", "models.json"),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(file: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeJson(file: string, value: unknown, mode?: number): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, mode === undefined ? "utf8" : { encoding: "utf8", mode });
}

const SLOT_ID = /^codex-\d+$/;

// The built-in slot always comes first; config only adds clones and labels.
export function loadCodexSlots(configFile: string): CodexSlot[] {
  const raw = readJson(configFile).slots;
  const seen = new Set<string>([BUILTIN_CODEX]);
  const builtin: CodexSlot = { provider: BUILTIN_CODEX };
  const clones: CodexSlot[] = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (!isRecord(entry) || typeof entry.provider !== "string") continue;
    const label = typeof entry.label === "string" && entry.label.trim() ? entry.label.trim() : undefined;
    if (entry.provider === BUILTIN_CODEX) {
      if (label) builtin.label = label;
      continue;
    }
    if (!SLOT_ID.test(entry.provider) || seen.has(entry.provider)) continue;
    seen.add(entry.provider);
    clones.push({ provider: entry.provider, ...(label ? { label } : {}) });
  }
  return [builtin, ...clones];
}

export function saveCodexSlots(configFile: string, slots: CodexSlot[]): void {
  writeJson(configFile, { slots: slots.map((s) => ({ provider: s.provider, ...(s.label ? { label: s.label } : {}) })) });
}

export function nextSlotId(slots: CodexSlot[]): string {
  const used = new Set(slots.map((s) => s.provider));
  for (let n = 2; ; n++) if (!used.has(`codex-${n}`)) return `codex-${n}`;
}

export function isCodexProvider(provider: string | undefined, slots: CodexSlot[]): boolean {
  return provider !== undefined && slots.some((slot) => slot.provider === provider);
}

// ---- identity -------------------------------------------------------------

function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Unverified JWT claims; used only to label slots and spot duplicates.
export function identityFromAccessToken(access: string, accountId?: string): CodexIdentity {
  const payload = decodeJwtPayload(access);
  const profile = isRecord(payload["https://api.openai.com/profile"]) ? payload["https://api.openai.com/profile"] : {};
  const auth = isRecord(payload["https://api.openai.com/auth"]) ? payload["https://api.openai.com/auth"] : {};
  const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
  const email = str(profile.email);
  const plan = str(auth.chatgpt_plan_type);
  const account = str(accountId) ?? str(auth.chatgpt_account_id);
  const user = str(auth.chatgpt_user_id) ?? str(payload.sub);
  return { key: `${account ?? "?"}|${email ?? user ?? "?"}`, ...(email ? { email } : {}), ...(plan ? { plan } : {}) };
}

export function slotIdentity(authFile: string, provider: string): CodexIdentity | undefined {
  const credential = readJson(authFile)[provider];
  if (!isRecord(credential) || credential.type !== "oauth" || typeof credential.access !== "string") return undefined;
  return identityFromAccessToken(credential.access, typeof credential.accountId === "string" ? credential.accountId : undefined);
}

// Two slots holding the same ChatGPT login would each refresh it, and OpenAI
// rejects reused refresh tokens, logging both out.
export function duplicateSlots(identities: Map<string, CodexIdentity | undefined>): string[][] {
  const byKey = new Map<string, string[]>();
  for (const [provider, identity] of identities) {
    if (!identity) continue;
    byKey.set(identity.key, [...(byKey.get(identity.key) ?? []), provider]);
  }
  return [...byKey.values()].filter((group) => group.length > 1);
}

// ---- auth.json writes -------------------------------------------------------

// Same lock Pi's auth storage uses (proper-lockfile: an `auth.json.lock` dir).
const LOCK_STALE_MS = 10_000;
const LOCK_TIMEOUT_MS = 5_000;

export async function withAuthLock<T>(authFile: string, fn: () => T): Promise<T> {
  const lockDir = `${authFile}.lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      mkdirSync(lockDir);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(lockDir).mtimeMs > LOCK_STALE_MS) rmdirSync(lockDir);
      } catch {
        // Lock vanished between checks; retry.
      }
      if (Date.now() > deadline) throw new Error(`auth.json is locked by another Pi process (${lockDir})`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try {
    return fn();
  } finally {
    try {
      rmdirSync(lockDir);
    } catch {
      // Already released.
    }
  }
}

export async function removeSlotLogin(authFile: string, provider: string): Promise<void> {
  if (provider === BUILTIN_CODEX) throw new Error("Use /logout for the built-in openai-codex login");
  await withAuthLock(authFile, () => {
    const auth = readJson(authFile);
    if (!(provider in auth)) return;
    delete auth[provider];
    writeJson(authFile, auth, 0o600);
  });
}

// ---- roles ----------------------------------------------------------------

export interface ModelRef {
  provider: string;
  model: string;
  thinking?: string;
}

export function parseModelRef(value: string | undefined): ModelRef | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "inherit") return undefined;
  const slash = trimmed.indexOf("/");
  if (slash <= 0) return undefined;
  const provider = trimmed.slice(0, slash);
  const rest = trimmed.slice(slash + 1);
  const colon = rest.lastIndexOf(":");
  return colon > 0 ? { provider, model: rest.slice(0, colon), thinking: rest.slice(colon + 1) } : { provider, model: rest };
}

export function formatModelRef(ref: ModelRef): string {
  return `${ref.provider}/${ref.model}${ref.thinking ? `:${ref.thinking}` : ""}`;
}

// Moving a role to another account keeps its model and thinking level when
// they are already Codex; otherwise it borrows the other role's Codex model.
export function retargetRole(current: ModelRef | undefined, fallback: ModelRef | undefined, provider: string, slots: CodexSlot[], firstModel: string | undefined): ModelRef | undefined {
  const source = current && isCodexProvider(current.provider, slots) ? current : fallback && isCodexProvider(fallback.provider, slots) ? { ...fallback, thinking: current?.thinking ?? fallback.thinking } : undefined;
  const model = source?.model ?? firstModel;
  if (!model) return undefined;
  const thinking = source?.thinking ?? current?.thinking;
  return { provider, model, ...(thinking ? { thinking } : {}) };
}

export function readMainDefault(settingsFile: string): ModelRef | undefined {
  const settings = readJson(settingsFile);
  return typeof settings.defaultProvider === "string" && typeof settings.defaultModel === "string"
    ? { provider: settings.defaultProvider, model: settings.defaultModel }
    : undefined;
}

// Pi's settings manager persists only the fields it changed, so editing these
// two keys does not race other settings.
export function writeMainDefault(settingsFile: string, ref: ModelRef): void {
  const settings = readJson(settingsFile);
  writeJson(settingsFile, { ...settings, defaultProvider: ref.provider, defaultModel: ref.model });
}

export function readSubagentDefault(subagentModelsFile: string): ModelRef | undefined {
  const subagents = readJson(subagentModelsFile).subagents;
  return isRecord(subagents) && typeof subagents.default === "string" ? parseModelRef(subagents.default) : undefined;
}

export function writeSubagentDefault(subagentModelsFile: string, ref: ModelRef): void {
  const config = readJson(subagentModelsFile);
  const subagents = isRecord(config.subagents) ? config.subagents : {};
  writeJson(subagentModelsFile, { ...config, subagents: { ...subagents, default: formatModelRef(ref) } });
}

// Models-store snapshot of the built-in Codex catalog (Pi refreshes it from the
// network). Clones copy it so they offer exactly the same models.
export function storedCodexModels(agentDir: string): Record<string, unknown>[] {
  const entry = readJson(path.join(agentDir, "models-store.json"))[BUILTIN_CODEX];
  const models = isRecord(entry) && Array.isArray(entry.models) ? entry.models : [];
  return models.filter((m): m is Record<string, unknown> => isRecord(m) && typeof m.id === "string");
}
