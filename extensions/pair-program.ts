/**
 * Pair Program Tool — deterministic coordinator for autonomous
 * pair-programming runs (Driver + Navigator). Dry-run slice: prerequisite
 * verification, persistent role sessions, one Navigator/Driver protocol loop,
 * compact memory handoff, and structured result with transcript path.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";
import {
  buildPairUsageSummary,
  createRoleSession,
  disposeRoleSession,
  promptRoleSession,
  type PairUsageSummary,
  type RoleSession,
} from "./agent-session-utils.ts";
import {
  runPairProtocolDryRun,
  type FinalVerification,
  type PairProtocolEvent,
  type WorkspaceSnapshot,
} from "./pair-protocol.ts";

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
  stopReason?: string;
  cyclesCompleted?: number;
  driverTools?: string[];
  navigatorTools?: string[];
  usage?: PairUsageSummary;
  initialWorkspace?: WorkspaceSnapshot;
  finalVerification?: FinalVerification;
}

type PairProgramUpdate = (partial: { content: Array<{ type: "text"; text: string }>; details?: Partial<PairProgramDetails> }) => void;

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

function appendTranscript(filePath: string, event: PairProtocolEvent): void {
  fs.appendFileSync(
    filePath,
    `## ${event.role}: ${event.phase}\n\n${event.text.trim()}\n\n---\n\n`,
    "utf8",
  );
}

function buildRoleSystemPrompt(role: "driver" | "navigator", dryRun: boolean = true): string {
  if (role === "driver") {
    if (dryRun) {
      return [
        "You are the Driver Agent in a deterministic Pair Program Tool run.",
        "You own implementation planning and evidence reporting for the current cycle.",
        "This slice is dry-run only. Do not edit or write files.",
        "Do not run workspace-mutating shell commands such as npm install, npm ci, formatters, generators, or cleanup commands.",
        "Use skill-tdd before implementation planning and report TDD evidence.",
      ].join("\n");
    }
    return [
      "You are the Driver Agent in a deterministic Pair Program Tool run.",
      "You own implementation planning, editing, and evidence reporting for the current cycle.",
      "You may edit and write files. Run tests to verify your changes.",
      "Use skill-tdd before implementation planning and report TDD evidence.",
    ].join("\n");
  }
  return [
    "You are the Navigator Agent in a deterministic Pair Program Tool run.",
    "You review Driver reports, TDD evidence, risks, and acceptance checklist coverage.",
    "Do not edit or write files.",
    "When reviewing a cycle, include exactly one DECISION line from the coordinator contract.",
  ].join("\n");
}

async function runRolePrompt(roleSession: RoleSession, prompt: string): Promise<string> {
  return promptRoleSession(roleSession, prompt);
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
// Git evidence collection (MESO-011, MESO-005)
// ---------------------------------------------------------------------------

function collectWorkspaceEvidence(cwd: string): WorkspaceSnapshot {
  let gitStatusShort = "";
  let gitDiffStat = "";
  let gitDiff = "";
  try {
    gitStatusShort = execSync("git status --short", { cwd, encoding: "utf8", timeout: 5000 }).trim();
  } catch {
    gitStatusShort = "(git status failed)";
  }
  try {
    gitDiffStat = execSync("git diff --stat", { cwd, encoding: "utf8", timeout: 5000 }).trim();
  } catch {
    gitDiffStat = "(git diff --stat failed)";
  }
  try {
    const raw = execSync("git diff", { cwd, encoding: "utf8", timeout: 5000 }).trim();
    gitDiff = raw.length > 4000 ? raw.slice(0, 4000) + "\n...(truncated)" : raw;
  } catch {
    gitDiff = "";
  }
  return { gitStatusShort, gitDiffStat, gitDiff };
}

function runVerification(command: string, cwd: string): FinalVerification {
  let exitCode = 0;
  let summary = "";
  try {
    summary = execSync(command, { cwd, encoding: "utf8", timeout: 60000 }).trim();
  } catch (err: unknown) {
    exitCode = 1;
    if (err && typeof err === "object" && "stdout" in err) {
      summary = String((err as { stdout: string }).stdout ?? "").trim();
    }
    if (!summary && err instanceof Error) {
      summary = err.message;
    }
  }
  return { command, exitCode, summary: summary.slice(0, 2000) };
}

// ---------------------------------------------------------------------------
// Tool definition builder
// ---------------------------------------------------------------------------

function buildPairProgramToolDef(pi: ExtensionAPI) {
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
      onUpdate: unknown,
      ctx: ExtensionContext,
    ) => {
      const normalized = normalizeParams(params);
      const publish = onUpdate as PairProgramUpdate | undefined;

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
        const driverMode = normalized.dryRun ? "dryRun" : "work";
        let driverSession: RoleSession | undefined;
        let navigatorSession: RoleSession | undefined;

        try {
          driverSession = await createRoleSession(
            pi,
            ctx,
            "driver",
            normalized.driverModel,
            driverMode,
            [buildRoleSystemPrompt("driver", normalized.dryRun)],
          );
          navigatorSession = await createRoleSession(
            pi,
            ctx,
            "navigator",
            normalized.navigatorModel,
            undefined,
            [buildRoleSystemPrompt("navigator")],
          );
          const driver = driverSession;
          const navigator = navigatorSession;

          const protocolResult = await runPairProtocolDryRun(
            {
              navigatorPreflight: (prompt) => runRolePrompt(navigator, prompt),
              driverCycle: (prompt) => runRolePrompt(driver, prompt),
              navigatorReview: (prompt) => runRolePrompt(navigator, prompt),
              navigatorDecisionRepair: (prompt) => runRolePrompt(navigator, prompt),
              driverCorrection: (prompt) => runRolePrompt(driver, prompt),
              navigatorClarification: (prompt) => runRolePrompt(navigator, prompt),
            },
            {
              task: normalized.task,
              maxCycles: normalized.maxCycles,
              testCommand: normalized.testCommand,
              collectEvidence: () => Promise.resolve(collectWorkspaceEvidence(cwd)),
              runFinalVerification: (command) => Promise.resolve(runVerification(command, cwd)),
              onEvent: (event) => {
                appendTranscript(transcriptPath, event);
                publish?.({
                  content: [{ type: "text", text: `${event.role} ${event.phase}\n\n${event.text}` }],
                  details: {
                    status: "incomplete",
                    summary: `${event.role} ${event.phase}`,
                    transcriptPath,
                    driverTools: driver.tools,
                    navigatorTools: navigator.tools,
                  },
                });
              },
            },
          );

          const driverTools = [...driver.tools];
          const navigatorTools = [...navigator.tools];
          const driverUsage = disposeRoleSession(driver);
          driverSession = undefined;
          const navigatorUsage = disposeRoleSession(navigator);
          navigatorSession = undefined;
          const usage = buildPairUsageSummary(driverUsage, navigatorUsage);

          const result: PairProgramDetails = {
            status: protocolResult.status,
            summary:
              `Pair program TDD ${normalized.dryRun ? "dry-run" : "work-mode"} finished.\n` +
              `- Task: ${normalized.task}\n` +
              `- Mode: ${normalized.mode}\n` +
              `- Max cycles: ${normalized.maxCycles}\n` +
              `- Dry run: ${normalized.dryRun}\n` +
              `- Status: ${protocolResult.status}\n` +
              `- Stop reason: ${protocolResult.stopReason}\n` +
              `- Cycles completed: ${protocolResult.cyclesCompleted}\n` +
              `- Malformed decision repairs: ${protocolResult.malformedDecisionRepairs}\n` +
              `- Driver tools: ${driverTools.join(", ")}\n` +
              `- Navigator tools: ${navigatorTools.join(", ")}\n` +
              `- Transcript: ${transcriptPath}` +
              (protocolResult.initialWorkspace ? `\n- Initial workspace captured: yes` : "") +
              (protocolResult.finalVerification ? `\n- Final verification: ${protocolResult.finalVerification.exitCode === 0 ? "passed" : "failed"}` : ""),
            transcriptPath,
            stopReason: protocolResult.stopReason,
            cyclesCompleted: protocolResult.cyclesCompleted,
            driverTools,
            navigatorTools,
            usage,
            initialWorkspace: protocolResult.initialWorkspace,
            finalVerification: protocolResult.finalVerification,
          };

          return {
            content: [{ type: "text" as const, text: result.summary }],
            details: result,
          };
        } finally {
          if (driverSession) disposeRoleSession(driverSession);
          if (navigatorSession) disposeRoleSession(navigatorSession);
        }
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

  pi.registerTool(buildPairProgramToolDef(pi));
}
