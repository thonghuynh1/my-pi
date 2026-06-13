/**
 * Pair Program Tool — deterministic coordinator shell for autonomous
 * pair-programming runs (Driver + Navigator). MVP slice: parameter
 * normalization, one-active-run enforcement, skill-tdd prerequisite
 * verification, and structured result with transcript path.
 *
 * The full Driver/Navigator cycle loop is not implemented yet; this
 * slice returns `incomplete` after prerequisite checks pass.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";

// ---------------------------------------------------------------------------
// Parameter schema (MICRO-001, MICRO-003)
// ---------------------------------------------------------------------------

const PairProgramParams = Type.Object({
  task: Type.String({ description: "Task for the Driver/Navigator pair." }),
  mode: Type.Optional(
    StringEnum(["tdd"] as const, {
      description: "Pair workflow mode. MVP supports only tdd.",
    }),
  ),
  maxCycles: Type.Optional(
    Type.Number({
      description: "Maximum Driver/Navigator cycles. Default: 4.",
      minimum: 1,
    }),
  ),
  testCommand: Type.Optional(
    Type.String({ description: "Test command to run during TDD red phase." }),
  ),
  dryRun: Type.Optional(
    Type.Boolean({ description: "When true, skip execution and return plan only. Default: true." }),
  ),
  driverModel: Type.Optional(
    Type.String({ description: "Model override for the Driver agent." }),
  ),
  navigatorModel: Type.Optional(
    Type.String({ description: "Model override for the Navigator agent." }),
  ),
});

type PairProgramParamsType = Static<typeof PairProgramParams>;

// ---------------------------------------------------------------------------
// Defaults (MESO-014)
// ---------------------------------------------------------------------------

const DEFAULT_MODE = "tdd";
const DEFAULT_MAX_CYCLES = 4;
const DEFAULT_DRY_RUN = true;

// ---------------------------------------------------------------------------
// Pair-program tool details type (for renderResult)
// ---------------------------------------------------------------------------

interface PairProgramDetails {
  status: "success" | "blocked" | "incomplete" | "error";
  summary: string;
  transcriptPath?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Transcript helpers
// ---------------------------------------------------------------------------

function transcriptDir(cwd: string): string {
  return path.join(cwd, ".scratch", "pair-program");
}

function ensureTranscriptDir(cwd: string): string {
  const dir = transcriptDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createTranscriptPath(cwd: string, task: string): string {
  const dir = ensureTranscriptDir(cwd);
  const slug = task
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filePath = path.join(dir, `${timestamp}-${slug}.md`);
  fs.writeFileSync(
    filePath,
    `# Pair Program Transcript\n\n` +
      `- Task: ${task}\n` +
      `- Started: ${new Date().toISOString()}\n` +
      `- Mode: ${DEFAULT_MODE}\n\n` +
      `---\n\n`,
    "utf8",
  );
  return filePath;
}

// ---------------------------------------------------------------------------
// skill-tdd prerequisite verification (MESO-016, MICRO-002)
// ---------------------------------------------------------------------------

// Fallback: check that the engineering-skills MCP server is configured.
// The preferred approach would be pi.getAllTools() to detect skill-tdd
// directly, but that API surface is not yet verified for extension use.
// This config-check is a safe MVP proxy: if engineering-skills MCP is
// configured, skill-tdd is expected to be available at runtime.
// FUTURE: replace with pi.getAllTools() detection once the API is stable.

const SERVER_NAME = "engineering-skills";
const GLOBAL_MCP_CONFIG = path.join(homedir(), ".config", "mcp", "mcp.json");

interface McpConfigFile {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

function readJsonFile(filePath: string): McpConfigFile {
  if (!fs.existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isEngineeringSkillsConfigured(): boolean {
  const candidates = [
    GLOBAL_MCP_CONFIG,
    path.join(homedir(), ".pi", "agent", "mcp.json"),
    path.resolve(process.cwd(), ".mcp.json"),
    path.resolve(process.cwd(), ".pi", "mcp.json"),
  ];

  for (const candidate of candidates) {
    const config = readJsonFile(candidate);
    if (
      config.mcpServers &&
      Object.prototype.hasOwnProperty.call(config.mcpServers, SERVER_NAME)
    ) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Parameter normalization (MESO-017)
// ---------------------------------------------------------------------------

function normalizeParams(raw: PairProgramParamsType) {
  return {
    task: raw.task,
    mode: raw.mode ?? DEFAULT_MODE,
    maxCycles: raw.maxCycles ?? DEFAULT_MAX_CYCLES,
    testCommand: raw.testCommand,
    dryRun: raw.dryRun ?? DEFAULT_DRY_RUN,
    driverModel: raw.driverModel,
    navigatorModel: raw.navigatorModel,
  };
}

// ---------------------------------------------------------------------------
// Active-run guard (MESO-001)
// ---------------------------------------------------------------------------

let activeRunId: string | undefined;

function tryAcquireRun(): boolean {
  if (activeRunId) return false;
  activeRunId = "active";
  return true;
}

function releaseRun(): void {
  activeRunId = undefined;
}

// ---------------------------------------------------------------------------
// Tool definition builder
// ---------------------------------------------------------------------------

function buildPairProgramToolDef() {
  return {
    name: "pair_program",
    label: "Pair Program",
    description:
      "Start a deterministic pair-programming run with a Driver and Navigator agent. " +
      "MVP supports TDD mode only. Returns structured status with transcript path.",
    promptSnippet:
      "Use `pair_program` to kick off a TDD pair-programming session for a well-scoped task. " +
      "The tool verifies prerequisites, creates a transcript, and coordinates the run.",
    promptGuidelines: [
      "Provide a clear, focused task description for the Driver/Navigator pair.",
      "TDD mode is the only supported mode in MVP; omitting mode defaults to tdd.",
      "Use dryRun=true (default) to preview the plan before execution.",
    ],
    parameters: PairProgramParams,
    execute: async (
      _toolCallId: string,
      params: PairProgramParamsType,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ) => {
      const normalized = normalizeParams(params);

      // --- Reject unsupported modes (AC #3) ---
      if (normalized.mode !== "tdd") {
        const errorResult: PairProgramDetails = {
          status: "error",
          summary: `Unsupported mode "${normalized.mode}". MVP only supports "tdd" mode.`,
          error: `Unsupported mode: ${normalized.mode}`,
        };
        return {
          content: [{ type: "text" as const, text: errorResult.summary }],
          details: errorResult,
          isError: true,
        };
      }

      // --- One active run per session (AC #4) ---
      if (!tryAcquireRun()) {
        const errorResult: PairProgramDetails = {
          status: "error",
          summary: "A pair-program run is already active in this Pi session. Wait for it to finish or error out.",
          error: "Already active",
        };
        return {
          content: [{ type: "text" as const, text: errorResult.summary }],
          details: errorResult,
          isError: true,
        };
      }

      try {
        // --- Verify skill-tdd prerequisite (AC #5, AC #6) ---
        if (!isEngineeringSkillsConfigured()) {
          const blockedResult: PairProgramDetails = {
            status: "blocked",
            summary:
              "TDD mode requires the engineering-skills MCP server with skill-tdd. " +
              "Run /engineering-skill <repo-path> to configure it first.",
            error: "engineering-skills MCP not configured",
          };
          return {
            content: [{ type: "text" as const, text: blockedResult.summary }],
            details: blockedResult,
            isError: true,
          };
        }

        // --- Create transcript (AC #7) ---
        const cwd = ctx.cwd;
        const transcriptPath = createTranscriptPath(cwd, normalized.task);

        // --- MVP: return incomplete — full loop not implemented yet (AC #7) ---
        const incompleteResult: PairProgramDetails = {
          status: "incomplete",
          summary:
            `Pair program TDD run initialized.\n` +
            `- Task: ${normalized.task}\n` +
            `- Mode: ${normalized.mode}\n` +
            `- Max cycles: ${normalized.maxCycles}\n` +
            `- Dry run: ${normalized.dryRun}\n` +
            `- Transcript: ${transcriptPath}\n\n` +
            `The full Driver/Navigator cycle loop is not implemented in this slice. ` +
            `Transcript has been created and prerequisites verified.`,
          transcriptPath,
        };

        return {
          content: [{ type: "text" as const, text: incompleteResult.summary }],
          details: incompleteResult,
        };
      } finally {
        releaseRun();
      }
    },
    renderCall(args, theme) {
      const task = args.task
        ? (args.task as string).length > 80
          ? `${(args.task as string).slice(0, 80)}...`
          : (args.task as string)
        : "...";
      const mode = (args.mode as string) ?? DEFAULT_MODE;
      return new Text(
        `${theme.fg("toolTitle", theme.bold("pair_program "))}${theme.fg("accent", mode)}\n  ${theme.fg("dim", task)}`,
        0,
        0,
      );
    },
    renderResult(result, { expanded }, theme) {
      const details = result.details as PairProgramDetails | undefined;
      if (!details) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }
      const icon =
        details.status === "success"
          ? theme.fg("success", "✓")
          : details.status === "blocked"
            ? theme.fg("warning", "⚠")
            : details.status === "incomplete"
              ? theme.fg("dim", "○")
              : theme.fg("error", "✗");
      let text = `${icon} ${theme.fg("toolTitle", theme.bold("pair_program"))}`;
      text += theme.fg("dim", ` • ${details.status}`);
      if (details.error) text += `\n${theme.fg("error", details.error)}`;
      if (expanded) {
        text += `\n\n${details.summary}`;
      } else {
        const preview = details.summary.split("\n").slice(0, 6).join("\n");
        text += `\n${preview}`;
        if (details.summary.split("\n").length > 6) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
      }
      return new Text(text, 0, 0);
    },
  } satisfies ToolDefinition<typeof PairProgramParams, PairProgramDetails>;
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function pairProgramExtension(pi: ExtensionAPI) {
  pi.on("session_start", async () => {
    activeRunId = undefined;
  });

  pi.registerTool(buildPairProgramToolDef());
}
