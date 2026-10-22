import type {
  ExtensionAPI,
  ExtensionCommandContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { getSelectListTheme } from "@earendil-works/pi-coding-agent";
import {
  Container,
  Input,
  SelectList,
  Spacer,
  Text,
  visibleWidth,
  type SelectItem,
} from "@earendil-works/pi-tui";
import { mkdirSync } from "node:fs";
import {
  createManagedExtension,
  loadCapabilityVisibilitySettings,
} from "./lib/capability-visibility.ts";
import {
  applyStoredProfileDirs,
  buildPickerItems,
  claudeProfiles,
  currentClaudeProfileId,
  expandHome,
  isProfileReady,
  loadStoredProfileDirs,
  parsePickerValue,
  saveStoredProfileDirs,
  switchClaudeProfile,
  type ClaudeProfileId,
  type ClaudeProfileMap,
} from "./lib/claude-profiles.ts";

export const piExtension = { id: "claude-profile" };

function centerText(text: string, width: number): string {
  const textWidth = visibleWidth(text);
  if (textWidth >= width) return text;
  return " ".repeat(Math.floor((width - textWidth) / 2)) + text;
}

function wrapInBox(lines: string[], theme: Theme, width: number): string[] {
  const w = Math.min(width, 120);
  const innerW = w - 2;
  const pad = (s: string) => s + " ".repeat(Math.max(0, innerW - visibleWidth(s)));
  const bordered = (content: string) => theme.fg("border", "│") + pad(content) + theme.fg("border", "│");
  return [
    theme.fg("border", `╭${"─".repeat(innerW)}╮`),
    ...lines.map(bordered),
    theme.fg("border", `╰${"─".repeat(innerW)}╯`),
  ];
}

class ClaudeProfilePicker extends Container {
  private readonly selectList: SelectList;

  constructor(
    private readonly theme: Theme,
    items: SelectItem[],
    selectedValue: string,
    onPick: (value: string) => void,
    onCancel: () => void,
  ) {
    super();
    this.addChild(new Text(centerText(theme.fg("accent", theme.bold("Claude Code profile")), 120), 0, 0));
    this.addChild(new Spacer(1));
    this.selectList = new SelectList(items, items.length, getSelectListTheme());
    const index = items.findIndex((item) => item.value === selectedValue);
    if (index >= 0) this.selectList.setSelectedIndex(index);
    this.selectList.onSelect = (item) => onPick(item.value);
    this.selectList.onCancel = onCancel;
    this.addChild(this.selectList);
    this.addChild(new Spacer(1));
    this.addChild(new Text(centerText(theme.fg("dim", "Enter selects. Esc closes."), 120), 0, 0));
  }

  render(width: number): string[] {
    return wrapInBox(super.render(width), this.theme, width);
  }

  handleInput(data: string): void {
    this.selectList.handleInput(data);
  }
}

class ProfileDirPrompt extends Container {
  private readonly input = new Input();
  private finished = false;

  constructor(
    private readonly theme: Theme,
    title: string,
    initial: string,
    onSubmit: (value: string) => void,
    onCancel: () => void,
  ) {
    super();
    const finish = (value: string | undefined) => {
      if (this.finished) return;
      this.finished = true;
      if (value === undefined) onCancel();
      else onSubmit(value);
    };
    this.addChild(new Text(centerText(theme.fg("accent", theme.bold(title)), 120), 0, 0));
    this.addChild(new Spacer(1));
    this.input.setValue(initial);
    this.input.onSubmit = (value) => finish(value);
    this.input.onEscape = () => finish(undefined);
    this.addChild(this.input);
    this.addChild(new Spacer(1));
    this.addChild(new Text(centerText(theme.fg("dim", "Enter saves. Esc goes back."), 120), 0, 0));
  }

  render(width: number): string[] {
    return wrapInBox(super.render(width), this.theme, width);
  }

  handleInput(data: string): void {
    this.input.handleInput(data);
  }
}

function statusLine(): string {
  applyStoredProfileDirs();
  const profiles = claudeProfiles();
  const current = currentClaudeProfileId();
  const active = profiles[current];
  return [
    `Active Claude profile: ${active.name} (${active.configDir})`,
    `Work: ${profiles.work.configDir} (${isProfileReady(profiles.work.configDir) ? "ready" : "not set up"})`,
    `Personal: ${profiles.personal.configDir} (${isProfileReady(profiles.personal.configDir) ? "ready" : "not set up"})`,
    `ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY?.trim() ? "set" : "unset"}`,
    `Use claude-bridge models with the active profile; refresh usage with /provider-usage.`,
  ].join("\n");
}

function isProfileId(value: string): value is ClaudeProfileId {
  return value === "work" || value === "personal";
}

function loginSteps(configDir: string): string {
  return [
    `Saved. Now log in once outside Pi:`,
    `  Git Bash: CLAUDE_CONFIG_DIR="${configDir}" claude login`,
    `  PowerShell: $env:CLAUDE_CONFIG_DIR="${configDir}"; claude login`,
    `Then re-run /claude-profile — the profile appears once login succeeds.`,
  ].join("\n");
}

function readiness(profiles: ClaudeProfileMap): Record<ClaudeProfileId, boolean> {
  return {
    work: isProfileReady(profiles.work.configDir),
    personal: isProfileReady(profiles.personal.configDir),
  };
}

async function runSetupFlow(ctx: ExtensionCommandContext, id: ClaudeProfileId): Promise<boolean> {
  const profiles = claudeProfiles();
  const dir = await ctx.ui.custom<string | undefined>(
    (_tui, theme, _keybindings, done) => new ProfileDirPrompt(
      theme,
      `Folder for the ${profiles[id].name} login`,
      profiles[id].configDir,
      (value) => done(value),
      () => done(undefined),
    ),
    { overlay: true, overlayOptions: { anchor: "center", width: "60%" } },
  );
  if (!dir || !dir.trim()) return false;
  const resolved = expandHome(dir);
  mkdirSync(resolved, { recursive: true });
  const stored = loadStoredProfileDirs();
  stored[id === "work" ? "workDir" : "personalDir"] = resolved;
  saveStoredProfileDirs(stored);
  applyStoredProfileDirs();
  ctx.ui.notify(loginSteps(resolved), "info");
  return true;
}

async function runPicker(ctx: ExtensionCommandContext): Promise<void> {
  for (;;) {
    applyStoredProfileDirs();
    const profiles = claudeProfiles();
    const current = currentClaudeProfileId();
    const ready = readiness(profiles);
    const picked = await ctx.ui.custom<string | undefined>(
      (_tui, theme, _keybindings, done) => new ClaudeProfilePicker(
        theme,
        buildPickerItems(profiles, ready, current),
        current,
        (value) => done(value),
        () => done(undefined),
      ),
      { overlay: true, overlayOptions: { anchor: "center", width: "60%" } },
    );
    if (!picked) return;
    const selection = parsePickerValue(picked);
    if (!selection) return;
    if (selection.kind === "setup") {
      if (await runSetupFlow(ctx, selection.id)) return;
      continue;
    }
    if (selection.id === current) {
      ctx.ui.notify(`Already on ${profiles[selection.id].name}.`, "info");
      return;
    }
    if (!ready[selection.id]) {
      ctx.ui.notify(
        `${profiles[selection.id].name} isn't set up yet (${profiles[selection.id].configDir}). Pick its setup entry to configure it.`,
        "warning",
      );
      continue;
    }
    const switched = switchClaudeProfile(selection.id);
    ctx.ui.notify(
      `Switched to ${switched.name} (${switched.configDir}). ` +
        `Next claude-bridge turn uses it. Run /provider-usage then r to refresh both subscriptions.`,
      "info",
    );
    return;
  }
}

export default function claudeProfile(pi: ExtensionAPI): void {
  const visibility = loadCapabilityVisibilitySettings();
  for (const warning of visibility.warnings) {
    console.warn(`[claude-profile] ${warning.message}`);
  }
  const managed = createManagedExtension(pi, { id: piExtension.id, visibility: visibility.settings });

  pi.on("session_start", () => {
    applyStoredProfileDirs();
  });

  managed.registerCommand("claude-profile", {
    description: "Pick the Claude Code profile for claude-bridge (TUI picker, or: /claude-profile use work|personal|setup personal|status)",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0) {
        if (!ctx.hasUI || ctx.mode !== "tui") {
          ctx.ui.notify(statusLine(), "info");
          return;
        }
        await runPicker(ctx);
        return;
      }
      const [verb, name] = parts;
      if (verb === "status") {
        ctx.ui.notify(statusLine(), "info");
        return;
      }
      if (verb === "setup") {
        if (!name || !isProfileId(name)) {
          ctx.ui.notify("Usage: /claude-profile setup work|personal", "info");
          return;
        }
        if (!ctx.hasUI || ctx.mode !== "tui") {
          ctx.ui.notify("Setup needs the TUI input. Set CLAUDE_PROFILE_WORK_DIR / CLAUDE_PROFILE_PERSONAL_DIR env vars instead, then log in with claude login.", "warning");
          return;
        }
        await runSetupFlow(ctx, name);
        return;
      }
      const target = verb === "use" ? name : verb;
      if (!target || !isProfileId(target)) {
        ctx.ui.notify("Usage: /claude-profile [use work|personal|setup personal|status]", "info");
        return;
      }
      applyStoredProfileDirs();
      const profiles = claudeProfiles();
      if (!isProfileReady(profiles[target].configDir)) {
        ctx.ui.notify(
          `${profiles[target].name} isn't set up yet (${profiles[target].configDir}). Run /claude-profile and pick its setup entry.`,
          "warning",
        );
        return;
      }
      const switched = switchClaudeProfile(target);
      ctx.ui.notify(
        `Switched to ${switched.name} (${switched.configDir}). ` +
          `Next claude-bridge turn uses it. Run /provider-usage then r to refresh both subscriptions.`,
        "info",
      );
    },
  });
}
