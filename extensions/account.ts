import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { matchesKey, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import {
  createManagedExtension,
  loadCapabilityVisibilitySettings,
} from "./lib/capability-visibility.ts";
import {
  addClaudeProfile,
  applyBridgeProfile,
  CLAUDE_BRIDGE,
  claudeIdentity,
  claudeLoginSteps,
  claudeProfiles,
  expandHome,
  isClaudeBridgeProvider,
  isProfileReady,
  loadClaudeConfig,
  removeClaudeProfile,
  saveClaudeConfig,
  suggestedProfileDir,
  type ClaudeIdentity,
  type ClaudeProfile,
  type ClaudeProfileId,
} from "./lib/claude-profiles.ts";
import { bindBridgeRegistry, registerClaudeClones } from "./lib/claude-providers.ts";
import {
  BUILTIN_CODEX,
  defaultCodexPaths,
  duplicateSlots,
  formatModelRef,
  loadCodexSlots,
  nextSlotId,
  readMainDefault,
  readSubagentDefault,
  removeSlotLogin,
  retargetRole,
  saveCodexSlots,
  slotIdentity,
  storedCodexModels,
  writeMainDefault,
  writeSubagentDefault,
  type CodexIdentity,
  type CodexSlot,
  type ModelRef,
} from "./lib/codex-accounts.ts";
import { createCodexCloneProvider } from "./lib/codex-providers.ts";
import { TextPrompt, centerText, wrapInBox } from "./lib/picker-ui.ts";
import { createCodexUsageReader } from "./lib/provider-usage/codex.ts";
import { parseCodex } from "./lib/provider-usage/model.ts";
import { resolveLaunch } from "./lib/provider-usage/readers.ts";

export const piExtension = { id: "account" };

// ---- view model -------------------------------------------------------------

export interface CodexRow {
  kind: "codex";
  slot: CodexSlot;
  identity?: CodexIdentity;
  roles: ("main" | "sub")[];
}
export type AccountRow =
  | CodexRow
  | { kind: "codex-add" }
  | { kind: "claude"; profile: ClaudeProfile; ready: boolean; main: boolean; identity?: ClaudeIdentity }
  | { kind: "claude-add" };

export type AccountAction =
  | { kind: "main" | "sub" | "rename" | "remove" | "login"; provider: string }
  | { kind: "add" }
  | { kind: "claude-main" | "claude-login" | "claude-remove"; id: ClaudeProfileId }
  | { kind: "claude-add" };

export interface AccountView {
  rows: AccountRow[];
  main?: ModelRef;
  mainDefault?: ModelRef;
  sub?: ModelRef;
  duplicates: string[][];
  claudeDuplicates: string[][];
}

export function slotName(slot: CodexSlot, identity: CodexIdentity | undefined): string {
  return slot.label ?? identity?.email ?? (slot.provider === BUILTIN_CODEX ? "Codex" : slot.provider);
}

export function buildAccountView(input: {
  slots: CodexSlot[];
  identities: Map<string, CodexIdentity | undefined>;
  main?: ModelRef;
  mainDefault?: ModelRef;
  sub?: ModelRef;
  claude: { profile: ClaudeProfile; ready: boolean; identity?: ClaudeIdentity }[];
}): AccountView {
  const rows: AccountRow[] = input.slots.map((slot) => ({
    kind: "codex",
    slot,
    identity: input.identities.get(slot.provider),
    roles: [
      ...(input.main?.provider === slot.provider ? (["main"] as const) : []),
      ...(input.sub?.provider === slot.provider ? (["sub"] as const) : []),
    ],
  }));
  rows.push({ kind: "codex-add" });
  for (const { profile, ready, identity } of input.claude) {
    rows.push({ kind: "claude", profile, ready, main: input.main?.provider === profile.provider, ...(identity ? { identity } : {}) });
  }
  rows.push({ kind: "claude-add" });
  return {
    rows, main: input.main, mainDefault: input.mainDefault, sub: input.sub,
    duplicates: duplicateSlots(input.identities),
    claudeDuplicates: duplicateSlots(new Map(input.claude.map(({ profile, identity }) => [profile.name, identity]))),
  };
}

// Maps a key on the selected row to an action; undefined = not applicable.
export function actionForKey(row: AccountRow, key: "enter" | "m" | "s" | "a" | "l" | "r" | "x"): AccountAction | undefined {
  const claudeSection = row.kind === "claude" || row.kind === "claude-add";
  if (key === "a") return claudeSection ? { kind: "claude-add" } : { kind: "add" };
  if (row.kind === "codex-add") return key === "enter" ? { kind: "add" } : undefined;
  if (row.kind === "claude-add") return key === "enter" ? { kind: "claude-add" } : undefined;
  if (row.kind === "claude") {
    const id = row.profile.id;
    if (key === "enter" || key === "m") return row.ready ? { kind: "claude-main", id } : { kind: "claude-login", id };
    if (key === "l") return { kind: "claude-login", id };
    if (key === "x") return row.profile.provider === CLAUDE_BRIDGE ? undefined : { kind: "claude-remove", id };
    return undefined;
  }
  const provider = row.slot.provider;
  if (key === "enter" || key === "m") return row.identity ? { kind: "main", provider } : { kind: "login", provider };
  if (key === "s") return row.identity ? { kind: "sub", provider } : { kind: "login", provider };
  if (key === "l") return { kind: "login", provider };
  if (key === "r") return { kind: "rename", provider };
  if (key === "x") return provider === BUILTIN_CODEX ? undefined : { kind: "remove", provider };
  return undefined;
}

// ---- usage cache --------------------------------------------------------------

type UsageEntry = { text: string; level: "ok" | "warn" | "high" | "error"; at: number };
const usage = new Map<string, UsageEntry | "loading">();
const usageListeners = new Set<() => void>();
const USAGE_TTL_MS = 60_000;

function formatUsage(raw: unknown): UsageEntry {
  const metric = parseCodex(raw);
  const windows = metric.kind === "quota" ? metric.groups.flatMap((g) => g.windows) : [];
  const max = Math.max(0, ...windows.map((w) => w.usedPercent));
  return {
    text: windows.map((w) => `${w.label} ${Math.round(w.usedPercent)}%`).join(" · "),
    level: max >= 90 ? "high" : max >= 70 ? "warn" : "ok",
    at: Date.now(),
  };
}

function refreshUsage(ctx: ExtensionContext, providers: string[], force: boolean): void {
  for (const provider of providers) {
    const current = usage.get(provider);
    if (current === "loading" || (!force && current && Date.now() - current.at < USAGE_TTL_MS)) continue;
    usage.set(provider, "loading");
    const read = createCodexUsageReader({
      apiKey: async () => (await ctx.modelRegistry.getProviderAuth(provider))?.auth.apiKey,
      fallback: async () => { throw new Error("not logged in"); },
    });
    void read(AbortSignal.timeout(25_000))
      .then((raw) => usage.set(provider, formatUsage(raw)))
      .catch(() => usage.set(provider, { text: "usage unavailable", level: "error", at: Date.now() }))
      .finally(() => { for (const listener of usageListeners) listener(); });
  }
}

// ---- modal ---------------------------------------------------------------------

const KEYS = ["m", "s", "a", "l", "r", "x"] as const;

export class AccountsModal implements Component {
  private selected: number;
  private readonly unsubscribe: () => void;
  private readonly theme: Theme;
  private readonly view: AccountView;
  private readonly done: (action: AccountAction | undefined) => void;
  private readonly onRefreshUsage: () => void;

  constructor(
    theme: Theme,
    view: AccountView,
    done: (action: AccountAction | undefined) => void,
    onRefreshUsage: () => void,
    requestRender: () => void,
    initialSelection: number,
  ) {
    this.theme = theme;
    this.view = view;
    this.done = done;
    this.onRefreshUsage = onRefreshUsage;
    this.selected = Math.min(Math.max(0, initialSelection), view.rows.length - 1);
    const listener = () => requestRender();
    usageListeners.add(listener);
    this.unsubscribe = () => usageListeners.delete(listener);
  }

  dispose(): void { this.unsubscribe(); }
  invalidate(): void {}

  selection(): number { return this.selected; }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "q")) return this.finish(undefined);
    if (matchesKey(data, "up")) { this.selected = (this.selected + this.view.rows.length - 1) % this.view.rows.length; return; }
    if (matchesKey(data, "down")) { this.selected = (this.selected + 1) % this.view.rows.length; return; }
    if (matchesKey(data, "u")) { this.onRefreshUsage(); return; }
    const row = this.view.rows[this.selected];
    const key = matchesKey(data, "enter") ? "enter" : KEYS.find((k) => matchesKey(data, k));
    if (!row || !key) return;
    const action = actionForKey(row, key);
    if (action) this.finish(action);
  }

  private finish(action: AccountAction | undefined): void {
    this.dispose();
    this.done(action);
  }

  render(width: number): string[] {
    const t = this.theme;
    const inner = Math.min(width, 120) - 2;
    const lines: string[] = [centerText(t.fg("accent", t.bold("Accounts")), inner), ""];
    const role = (label: string, ref: ModelRef | undefined, note?: string) =>
      `  ${t.fg("dim", label.padEnd(14))}${ref ? t.fg("accent", formatModelRef(ref)) : t.fg("dim", "inherit (same as main)")}${note ? t.fg("dim", `  ${note}`) : ""}`;
    lines.push(t.fg("dim", " ROLES"));
    const mainNote = this.view.mainDefault && this.view.main && formatModelRef(this.view.mainDefault) !== formatModelRef(this.view.main)
      ? `new sessions: ${formatModelRef(this.view.mainDefault)}` : undefined;
    lines.push(role("Main session", this.view.main, mainNote));
    lines.push(role("Subagents", this.view.sub));
    lines.push("");
    lines.push(t.fg("dim", " CODEX ACCOUNTS"));
    let claudeHeader = false;
    this.view.rows.forEach((row, index) => {
      if ((row.kind === "claude" || row.kind === "claude-add") && !claudeHeader) {
        claudeHeader = true;
        lines.push("", t.fg("dim", " CLAUDE ACCOUNTS"));
      }
      const pointer = index === this.selected ? t.fg("accent", "▸ ") : "  ";
      lines.push(truncateToWidth(` ${pointer}${this.renderRow(row)}`, inner));
    });
    for (const group of this.view.duplicates) {
      lines.push("", t.fg("error", ` ⚠ ${group.join(" and ")} hold the same ChatGPT login; their token refreshes will log each other out. Remove one (x).`));
    }
    for (const group of this.view.claudeDuplicates) {
      lines.push("", t.fg("error", ` ⚠ ${group.join(" and ")} share one Claude account and its usage. Press l on one to sign in again.`));
    }
    lines.push("", centerText(t.fg("dim", this.hint()), inner));
    return wrapInBox(lines, t, width);
  }

  private renderRow(row: AccountRow): string {
    const t = this.theme;
    if (row.kind === "codex-add") return t.fg("accent", "+ Add Codex account");
    if (row.kind === "claude-add") return t.fg("accent", "+ Add Claude account");
    if (row.kind === "claude") {
      const detail = !row.ready ? "not logged in · press l" : row.identity?.email ?? "";
      const pad = (s: string, n: number) => s + " ".repeat(Math.max(1, n - visibleWidth(s)));
      return `${pad(row.profile.name, 24)}${pad(t.fg("dim", row.profile.provider), 18)}${pad(t.fg("dim", detail), 30)}${pad(row.main ? t.fg("success", "[main]") : "", 8)}${t.fg("dim", row.profile.configDir)}`;
    }
    const name = slotName(row.slot, row.identity);
    const detail = row.identity
      ? [row.identity.email && row.identity.email !== name ? row.identity.email : undefined, row.identity.plan].filter(Boolean).join(" · ")
      : "not logged in · press l";
    const entry = usage.get(row.slot.provider);
    const usageText = !row.identity ? "" : entry === "loading" || !entry ? t.fg("dim", "…") : t.fg(entry.level === "high" || entry.level === "error" ? "error" : entry.level === "warn" ? "warning" : "accent", entry.text);
    const tags = row.roles.map((r) => t.fg("success", r === "main" ? "[main]" : "[subagents]")).join(" ");
    const pad = (s: string, n: number) => s + " ".repeat(Math.max(1, n - visibleWidth(s)));
    return `${pad(name, 24)}${pad(t.fg("dim", row.slot.provider), 15)}${pad(t.fg("dim", detail), 26)}${pad(usageText, 24)}${tags}`;
  }

  private hint(): string {
    const row = this.view.rows[this.selected];
    if (row?.kind === "claude") return `Enter/m main · a add · l ${row.ready ? "sign in again" : "login"} · x remove · ↑/↓ move · Esc close`;
    if (row?.kind === "codex-add" || row?.kind === "claude-add") return "Enter add account · ↑/↓ move · Esc close";
    return "Enter/m main · s subagents · a add · l login · r rename · x remove · u usage · Esc close";
  }
}

// ---- actions ---------------------------------------------------------------------

function codexModels(ctx: ExtensionContext) {
  return ctx.modelRegistry.getAll().filter((model) => model.provider === BUILTIN_CODEX);
}

function registerSlot(pi: ExtensionAPI, slot: CodexSlot, models: readonly object[]): void {
  const paths = defaultCodexPaths();
  const name = `OpenAI Codex · ${slotName(slot, slotIdentity(paths.authFile, slot.provider))}`;
  pi.registerProvider(createCodexCloneProvider(slot.provider, name, models));
}

function registerAllSlots(pi: ExtensionAPI, models: readonly object[]): void {
  for (const slot of loadCodexSlots(defaultCodexPaths().configFile)) {
    if (slot.provider === BUILTIN_CODEX) continue;
    try {
      registerSlot(pi, slot, models);
    } catch (error) {
      console.warn(`[account] could not register ${slot.provider}: ${(error as Error).message}`);
    }
  }
}

function buildView(ctx: ExtensionContext): AccountView {
  const paths = defaultCodexPaths();
  const slots = loadCodexSlots(paths.configFile);
  const profiles = claudeProfiles();
  return buildAccountView({
    slots,
    identities: new Map(slots.map((slot) => [slot.provider, slotIdentity(paths.authFile, slot.provider)])),
    main: ctx.model ? { provider: ctx.model.provider, model: ctx.model.id } : undefined,
    mainDefault: readMainDefault(paths.settingsFile),
    sub: readSubagentDefault(paths.subagentModelsFile),
    claude: profiles.map((profile) => ({ profile, ready: isProfileReady(profile.configDir), identity: claudeIdentity(profile.configDir) })),
  });
}

async function assignRole(pi: ExtensionAPI, ctx: ExtensionCommandContext, role: "main" | "sub", provider: string): Promise<void> {
  const paths = defaultCodexPaths();
  const slots = loadCodexSlots(paths.configFile);
  const main = ctx.model ? { provider: ctx.model.provider, model: ctx.model.id } : readMainDefault(paths.settingsFile);
  const sub = readSubagentDefault(paths.subagentModelsFile);
  const first = codexModels(ctx)[0]?.id;
  const ref = role === "main" ? retargetRole(main, sub, provider, slots, first) : retargetRole(sub, main, provider, slots, first);
  const model = ref && ctx.modelRegistry.find(ref.provider, ref.model);
  if (!ref || !model) {
    ctx.ui.notify(`No Codex model found for ${provider}. Try /model once so Pi refreshes the catalog.`, "error");
    return;
  }
  const name = slotName(slots.find((s) => s.provider === provider) ?? { provider }, slotIdentity(paths.authFile, provider));
  if (role === "main") {
    if (!(await pi.setModel(model))) {
      ctx.ui.notify(`${name} has no usable login. Select it and press l to log in.`, "warning");
      return;
    }
    writeMainDefault(paths.settingsFile, ref);
    ctx.ui.notify(`Main session now uses ${name} (${formatModelRef(ref)}); new sessions too.`, "info");
    return;
  }
  writeSubagentDefault(paths.subagentModelsFile, ref);
  ctx.ui.notify(`Subagents now use ${name} (${formatModelRef(ref)}). Per-agent overrides in /subagents-model still win.`, "info");
}

function addSlot(pi: ExtensionAPI, ctx: ExtensionCommandContext): void {
  const paths = defaultCodexPaths();
  const slots = loadCodexSlots(paths.configFile);
  const id = nextSlotId(slots);
  const slot = { provider: id };
  saveCodexSlots(paths.configFile, [...slots, slot]);
  registerSlot(pi, slot, codexModels(ctx));
  startLogin(ctx, id, true);
}

function startLogin(ctx: ExtensionCommandContext, provider: string, isNew = false): void {
  const command = `/login ${provider}`;
  ctx.ui.setEditorText(command);
  ctx.ui.notify(
    [
      `${isNew ? `Created ${provider}. ` : ""}Press Enter to run ${command}.`,
      "Sign in with the ChatGPT account for this slot (use a private browser window if it auto-picks another account).",
      "Then reopen /account to assign it to main or subagents.",
    ].join("\n"),
    "info",
  );
}

async function renameSlot(pi: ExtensionAPI, ctx: ExtensionCommandContext, provider: string): Promise<void> {
  const paths = defaultCodexPaths();
  const slots = loadCodexSlots(paths.configFile);
  const slot = slots.find((s) => s.provider === provider);
  if (!slot) return;
  const label = await ctx.ui.custom<string | undefined>(
    (_tui, theme, _keys, done) => new TextPrompt(theme, `Label for ${provider}`, slot.label ?? slotIdentity(paths.authFile, provider)?.email ?? "", done, () => done(undefined)),
    { overlay: true, overlayOptions: { anchor: "center", width: "50%" } },
  );
  if (label === undefined) return;
  const clean = label.trim();
  saveCodexSlots(paths.configFile, slots.map((s) => (s.provider === provider ? { provider, ...(clean ? { label: clean } : {}) } : s)));
  if (provider !== BUILTIN_CODEX) registerSlot(pi, { provider, ...(clean ? { label: clean } : {}) }, codexModels(ctx));
}

async function removeSlot(pi: ExtensionAPI, ctx: ExtensionCommandContext, provider: string): Promise<void> {
  const paths = defaultCodexPaths();
  const slots = loadCodexSlots(paths.configFile);
  const slot = slots.find((s) => s.provider === provider);
  if (!slot) return;
  const name = slotName(slot, slotIdentity(paths.authFile, provider));
  const roles = [readMainDefault(paths.settingsFile), ctx.model ? { provider: ctx.model.provider } : undefined, readSubagentDefault(paths.subagentModelsFile)];
  const warning = roles.some((r) => r?.provider === provider) ? " It is assigned to a role; reassign that role first or it will stop working." : "";
  if (!(await ctx.ui.confirm(`Remove ${name}?`, `Deletes the ${provider} provider and its login.${warning}`))) return;
  await removeSlotLogin(paths.authFile, provider);
  saveCodexSlots(paths.configFile, slots.filter((s) => s.provider !== provider));
  pi.unregisterProvider(provider);
  usage.delete(provider);
  ctx.ui.notify(`Removed ${name}.`, "info");
}

// Picks the model for a Claude main role: the current Claude model, the last
// one used, then a Sonnet, then whatever the account lists first.
export function pickClaudeModel(models: readonly { id: string }[], current: string | undefined, last: string | undefined): string | undefined {
  const ids = models.map((m) => m.id);
  return [current, last].find((id) => id && ids.includes(id)) ?? ids.find((id) => /sonnet/i.test(id)) ?? ids[0];
}

async function assignClaudeMain(pi: ExtensionAPI, ctx: ExtensionCommandContext, id: ClaudeProfileId): Promise<void> {
  const profile = claudeProfiles().find((p) => p.id === id);
  if (!profile) return;
  const models = ctx.modelRegistry.getAll().filter((m) => m.provider === profile.provider);
  const config = loadClaudeConfig();
  const modelId = pickClaudeModel(models, isClaudeBridgeProvider(ctx.model?.provider) ? ctx.model?.id : undefined, config.lastModel);
  const model = modelId ? ctx.modelRegistry.find(profile.provider, modelId) : undefined;
  if (!model) {
    ctx.ui.notify(`No ${profile.provider} models are registered. Check that pi-claude-bridge is installed.`, "error");
    return;
  }
  if (!(await pi.setModel(model))) {
    ctx.ui.notify(`${profile.provider} refused ${model.id}.`, "warning");
    return;
  }
  writeMainDefault(defaultCodexPaths().settingsFile, { provider: profile.provider, model: model.id });
  saveClaudeConfig({ ...config, lastModel: model.id });
  ctx.ui.notify(`Main session now uses ${profile.name} (${profile.provider}/${model.id}); new sessions too.`, "info");
}

function claudeStatusLine(): string {
  return [
    "Claude accounts:",
    ...claudeProfiles().map((p) => `  ${p.name}: ${p.provider} · ${p.configDir} (${isProfileReady(p.configDir) ? "ready" : "not logged in"})`),
    `ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY?.trim() ? "set" : "unset"}`,
  ].join("\n");
}

// Live claude-bridge catalog (with the bridge's long-context labels), once bound.
function liveBridgeModels(ctx: ExtensionContext) {
  return ctx.modelRegistry.getAll().filter((model) => model.provider === CLAUDE_BRIDGE);
}

function refreshClaudeClones(pi: ExtensionAPI, ctx: ExtensionContext): void {
  const models = liveBridgeModels(ctx);
  registerClaudeClones(pi, models.length > 0 ? models : undefined);
}

// Asks for a folder, saves it as the next numbered profile with its own
// claude-bridge-N provider, and prints the one login command to run outside Pi.
async function addClaude(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const config = loadClaudeConfig();
  const dir = await ctx.ui.custom<string | undefined>(
    (_tui, theme, _keybindings, done) => new TextPrompt(
      theme,
      `Folder for Claude ${config.profiles.length + 1}`,
      suggestedProfileDir(config),
      (value) => done(value),
      () => done(undefined),
    ),
    { overlay: true, overlayOptions: { anchor: "center", width: "60%" } },
  );
  if (!dir?.trim()) return;
  const resolved = expandHome(dir);
  let next;
  try {
    next = addClaudeProfile(config, resolved);
  } catch (error) {
    ctx.ui.notify((error as Error).message, "warning");
    return;
  }
  saveClaudeConfig(next);
  mkdirSync(resolved, { recursive: true });
  refreshClaudeClones(pi, ctx);
  ctx.ui.notify(`Added Claude ${next.profiles.length} (${next.profiles.at(-1)?.provider}). ${claudeLoginSteps(resolved)}`, "info");
}

function signOutClaude(configDir: string): Promise<void> {
  const launch = resolveLaunch({ command: "claude", args: ["auth", "logout"] });
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CONFIG_DIR: configDir };
  delete env.ANTHROPIC_API_KEY;
  return new Promise((resolve, reject) => {
    execFile(launch.file, launch.args, { env, windowsHide: true, windowsVerbatimArguments: launch.windowsVerbatimArguments, timeout: 30_000 },
      (error, _stdout, stderr) => (error ? reject(new Error(String(stderr).trim() || error.message)) : resolve()));
  });
}

// A logged-in profile is signed out first, so the next `claude login` in
// that folder can pick a different account.
async function loginClaude(ctx: ExtensionCommandContext, id: ClaudeProfileId): Promise<void> {
  const profile = claudeProfiles().find((p) => p.id === id);
  if (!profile) return;
  if (isProfileReady(profile.configDir)) {
    const account = claudeIdentity(profile.configDir)?.email ?? "the current account";
    const keyNote = profile.useApiKey && process.env.ANTHROPIC_API_KEY?.trim() ? " ANTHROPIC_API_KEY stays active for this profile and takes precedence over the login." : "";
    if (!(await ctx.ui.confirm(`Sign ${profile.name} in again?`, `Signs ${account} out of ${profile.configDir}, then shows how to log in with another account.${keyNote}`))) return;
    try {
      await signOutClaude(profile.configDir);
    } catch (error) {
      ctx.ui.notify(`Could not sign ${profile.name} out: ${(error as Error).message}`, "error");
      return;
    }
    if (isProfileReady(profile.configDir)) {
      ctx.ui.notify(`${profile.name} still has a login in ${profile.configDir} after claude auth logout.`, "error");
      return;
    }
  }
  ctx.ui.notify(`${profile.name}: ${claudeLoginSteps(profile.configDir)}`, "info");
}

async function removeClaude(pi: ExtensionAPI, ctx: ExtensionCommandContext, id: ClaudeProfileId): Promise<void> {
  const profile = claudeProfiles().find((p) => p.id === id);
  if (!profile) return;
  const paths = defaultCodexPaths();
  const roles = [readMainDefault(paths.settingsFile), ctx.model ? { provider: ctx.model.provider } : undefined, readSubagentDefault(paths.subagentModelsFile)];
  const warning = roles.some((r) => r?.provider === profile.provider) ? ` ${profile.provider} is assigned to a role; reassign that role first or it will stop working.` : "";
  if (!(await ctx.ui.confirm(`Remove ${profile.name}?`, `Deletes the ${profile.provider} provider. The folder ${profile.configDir} and its login stay on disk.${warning}`))) return;
  saveClaudeConfig(removeClaudeProfile(loadClaudeConfig(), profile.configDir));
  refreshClaudeClones(pi, ctx);
  ctx.ui.notify(`Removed ${profile.name}. Restart Pi to update the footer.`, "info");
}

async function openModal(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  let selection = 0;
  for (;;) {
    const view = buildView(ctx);
    const loggedIn = view.rows.flatMap((r) => (r.kind === "codex" && r.identity ? [r.slot.provider] : []));
    refreshUsage(ctx, loggedIn, false);
    let modal: AccountsModal | undefined;
    const action = await ctx.ui.custom<AccountAction | undefined>(
      (tui, theme, _keys, done) => {
        modal = new AccountsModal(theme, view, done, () => { refreshUsage(ctx, loggedIn, true); tui.requestRender(); }, () => tui.requestRender(), selection);
        return modal;
      },
      { overlay: true, overlayOptions: { anchor: "center", width: "85%", minWidth: 70, maxHeight: "85%" } },
    );
    selection = modal?.selection() ?? selection;
    if (!action) return;
    switch (action.kind) {
      case "main":
      case "sub":
        await assignRole(pi, ctx, action.kind, action.provider);
        continue;
      case "rename":
        await renameSlot(pi, ctx, action.provider);
        continue;
      case "remove":
        await removeSlot(pi, ctx, action.provider);
        selection = 0;
        continue;
      case "add":
        return addSlot(pi, ctx);
      case "login":
        return startLogin(ctx, action.provider);
      case "claude-main":
        await assignClaudeMain(pi, ctx, action.id);
        continue;
      case "claude-login":
        return loginClaude(ctx, action.id);
      case "claude-remove":
        await removeClaude(pi, ctx, action.id);
        selection = 0;
        continue;
      case "claude-add":
        await addClaude(pi, ctx);
        return;
    }
  }
}

function statusText(ctx: ExtensionContext): string {
  const view = buildView(ctx);
  const codex = view.rows.flatMap((row) =>
    row.kind === "codex"
      ? [`  ${row.slot.provider.padEnd(13)} ${slotName(row.slot, row.identity)}${row.identity ? "" : " (not logged in)"}${row.roles.length ? `  [${row.roles.join(", ")}]` : ""}`]
      : [],
  );
  return [
    `Main: ${view.main ? formatModelRef(view.main) : "none"} · Subagents: ${view.sub ? formatModelRef(view.sub) : "inherit"}`,
    "Codex accounts:",
    ...codex,
    "",
    claudeStatusLine(),
  ].join("\n");
}

export default function account(pi: ExtensionAPI): void {
  const visibility = loadCapabilityVisibilitySettings();
  for (const warning of visibility.warnings) {
    console.warn(`[account] ${warning.message}`);
  }
  const managed = createManagedExtension(pi, { id: piExtension.id, visibility: visibility.settings });

  // Register clones at load so sessions and subagents that name codex-N
  // resolve immediately; refresh them from the live catalog once bound.
  registerAllSlots(pi, storedCodexModels(defaultCodexPaths().agentDir));
  registerClaudeClones(pi);
  // claude-bridge itself always means Claude 1, unless Pi was launched with
  // an explicit CLAUDE_CONFIG_DIR.
  const launchedWithConfigDir = Boolean(process.env.CLAUDE_CONFIG_DIR?.trim());
  pi.on("session_start", (_event, ctx) => {
    const models = codexModels(ctx);
    if (models.length > 0) registerAllSlots(pi, models);
    if (!launchedWithConfigDir) applyBridgeProfile();
    bindBridgeRegistry(ctx.modelRegistry);
    if (liveBridgeModels(ctx).length > 0) refreshClaudeClones(pi, ctx);
  });
  // Remember the Claude model so picking a Claude account as main restores it.
  pi.on("model_select", (_event, ctx) => {
    if (!ctx.model || !isClaudeBridgeProvider(ctx.model.provider)) return;
    const config = loadClaudeConfig();
    if (config.lastModel !== ctx.model.id) saveClaudeConfig({ ...config, lastModel: ctx.model.id });
  });

  managed.registerCommand("account", {
    description: "Accounts modal: Codex accounts for main/subagents, Claude accounts for main, usage",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      if (args.trim() === "status" || !ctx.hasUI || ctx.mode !== "tui") {
        ctx.ui.notify(statusText(ctx), "info");
        return;
      }
      await openModal(pi, ctx);
    },
  });
}
