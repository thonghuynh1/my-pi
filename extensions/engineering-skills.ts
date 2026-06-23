import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  createManagedExtension,
  parseCapabilityVisibilitySettings,
  type CapabilityVisibilitySettings,
} from "./lib/capability-visibility.ts";

const SERVER_NAME = "engineering-skills";
const STATUS_KEY = "engineering-skills";
const GLOBAL_MCP_CONFIG = join(homedir(), ".config", "mcp", "mcp.json");

interface McpConfigFile {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

function readJsonFile(path: string): McpConfigFile {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function findEngineeringSkillsConfig(): { path: string; configured: boolean } {
  const candidates = [
    GLOBAL_MCP_CONFIG,
    join(homedir(), ".pi", "agent", "mcp.json"),
    resolve(process.cwd(), ".mcp.json"),
    resolve(process.cwd(), ".pi", "mcp.json"),
  ];

  for (const path of candidates) {
    const config = readJsonFile(path);
    if (config.mcpServers && Object.prototype.hasOwnProperty.call(config.mcpServers, SERVER_NAME)) {
      return { path, configured: true };
    }
  }

  return { path: GLOBAL_MCP_CONFIG, configured: false };
}

function normalizeRepoPath(args: string | undefined): string | undefined {
  const explicit = args?.trim().replace(/^['"]|['"]$/g, "");
  if (explicit) return resolve(explicit);

  const envPath = process.env.ENGINEERING_SKILLS_MCP?.trim();
  if (envPath) return resolve(envPath);

  return undefined;
}

function writeGlobalEngineeringSkillsConfig(repoPath: string): string {
  const distIndex = join(repoPath, "dist", "index.js");
  if (!existsSync(distIndex)) {
    throw new Error(
      `MCP server build not found at ${distIndex}. Run npm install && npm run build in ${repoPath}.`,
    );
  }

  const config = readJsonFile(GLOBAL_MCP_CONFIG);
  const mcpServers = config.mcpServers && typeof config.mcpServers === "object" && !Array.isArray(config.mcpServers)
    ? config.mcpServers as Record<string, unknown>
    : {};

  mcpServers[SERVER_NAME] = {
    command: "node",
    args: [distIndex.replace(/\\/g, "/")],
    lifecycle: "lazy",
  };

  config.mcpServers = mcpServers;
  mkdirSync(dirname(GLOBAL_MCP_CONFIG), { recursive: true });
  writeFileSync(GLOBAL_MCP_CONFIG, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return GLOBAL_MCP_CONFIG;
}

function updateStatus(ctx: { hasUI: boolean; ui: { setStatus: (key: string, value: string) => void } }): void {
  if (!ctx.hasUI) return;
  const status = findEngineeringSkillsConfig();
  ctx.ui.setStatus(
    STATUS_KEY,
    status.configured ? "engineering-skills MCP" : "engineering-skills MCP: run /engineering-skill <repo-path>",
  );
}

export const piExtension = { id: "engineering-skills" };

export default function engineeringSkills(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => updateStatus(ctx));

  async function setupEngineeringSkills(args: string | undefined, ctx: Parameters<Parameters<typeof pi.registerCommand>[1]["handler"]>[1]) {
    const repoPath = normalizeRepoPath(args);

    if (!repoPath) {
      const status = findEngineeringSkillsConfig();
      if (status.configured) {
        ctx.ui.notify(`${SERVER_NAME} MCP is already configured in ${status.path}`, "info");
        return;
      }

      ctx.ui.notify("Usage: /engineering-skill <path-to-engineering-skills-mcp-repo>", "warning");
      ctx.ui.notify("Example: /engineering-skill C:/skills-vscode", "info");
      return;
    }

    try {
      const configPath = writeGlobalEngineeringSkillsConfig(repoPath);
      updateStatus(ctx);
      ctx.ui.notify(`Configured ${SERVER_NAME} MCP in ${configPath}`, "info");
      ctx.ui.notify("Reloading Pi so pi-mcp-adapter sees the config...", "info");
      await ctx.reload();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(message, "error");
    }
  }

  let piSettings: CapabilityVisibilitySettings = {};
  try {
    const { settings } = parseCapabilityVisibilitySettings(
      JSON.parse(readFileSync(resolve(process.cwd(), "pi.settings.json"), "utf8"))
    );
    piSettings = settings;
  } catch { /* proceed with declared defaults */ }
  const managed = createManagedExtension(pi, { id: piExtension.id, visibility: piSettings });

  managed.registerCommand("engineering-skill", {
    description: "Configure engineering-skills MCP. Usage: /engineering-skill <path-to-engineering-skills-mcp-repo>",
    handler: setupEngineeringSkills,
  });

  managed.registerCommand("engineering-skills-mcp-setup", {
    description: "Alias for /engineering-skill <path-to-engineering-skills-mcp-repo>.",
    handler: setupEngineeringSkills,
  });
}
