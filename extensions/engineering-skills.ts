import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const SERVER_NAME = "engineering-skills";
const GLOBAL_MCP_CONFIG = join(homedir(), ".config", "mcp", "mcp.json");
const DEFAULT_REPO_PATH = "F:/MyWork/PrecioHackathon/hackathon-grill-me";

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

function resolveServerRepoPath(args: string | undefined): string {
  const explicit = args?.trim();
  if (explicit) return resolve(explicit.replace(/^['"]|['"]$/g, ""));

  if (process.env.ENGINEERING_SKILLS_MCP) {
    return resolve(process.env.ENGINEERING_SKILLS_MCP);
  }

  return DEFAULT_REPO_PATH;
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

export default function engineeringSkills(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    const status = findEngineeringSkillsConfig();
    ctx.ui.setStatus(
      "engineering-skills",
      status.configured ? "engineering-skills MCP" : "engineering-skills MCP: setup needed",
    );
  });

  pi.registerCommand("engineering-skills-mcp-setup", {
    description: "Configure global engineering-skills MCP server. Optional arg: path to engineering-skills-mcp repo.",
    handler: async (args, ctx) => {
      const repoPath = resolveServerRepoPath(args);
      try {
        const configPath = writeGlobalEngineeringSkillsConfig(repoPath);
        ctx.ui.notify(`Configured ${SERVER_NAME} MCP in ${configPath}`, "info");
        ctx.ui.notify("Reloading Pi so pi-mcp-adapter sees the config...", "info");
        await ctx.reload();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(message, "error");
      }
    },
  });
}
