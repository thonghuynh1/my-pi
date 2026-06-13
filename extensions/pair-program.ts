/**
 * Pair Program Tool — deterministic coordinator for autonomous
 * pair-programming runs (Driver + Navigator). Issue 01 slice:
 * registration, MVP parameter contract, single-active-run guard,
 * skill-tdd prerequisite verification, transcript scaffolding, and a
 * structured incomplete/blocked/error result. The Driver/Navigator
 * orchestration loop runs after all prerequisites pass; per the issue,
 * a fully exercised happy-path loop is deferred to later issues.
 */

import * as fs from "node:fs";
import * as path from "node:path";
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
} from "./lib/agent-session-utils.ts";
import {
  buildTranscriptBasename,
  runPairProtocolDryRun,
  parseChangedFilesFromGitStatus,
  type FinalVerification,
  type NavigatorDecisionValue,
  type PairCycleRecord,
  type PairProtocolEvent,
  type WorkspaceSnapshot,
} from "./lib/pair-protocol.ts";
import {
  DEFAULT_MAX_CYCLES,
  DEFAULT_MODE,
  isEngineeringSkillsConfigured,
  normalizeParams,
  releaseRun,
  tryAcquireRun,
  verifySkillTddAvailable,
  __resetActiveRunForTests,
} from "./lib/pair-program-helpers.ts";

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
    Type.Boolean({
      description:
        "When true (default), Driver cannot edit or write files. Set to false to allow real edits.",
    }),
  ),
  driverModel: Type.Optional(
    Type.String({ description: "Model override for the Driver agent." }),
  ),
  navigatorModel: Type.Optional(
    Type.String({ description: "Model override for the Navigator agent." }),
  ),
});

type PairProgramParamsType = Static<typeof PairProgramParams>;

// Defaults are sourced from pair-program-helpers so they are unit-testable.
// ---------------------------------------------------------------------------
// Pair-program tool details type (for renderResult)
// ---------------------------------------------------------------------------

interface PairProgramDetails {
  status: "success" | "blocked" | "incomplete" | "error";
  summary: string;
  finalNavigatorDecision?: NavigatorDecisionValue;
  changedFiles: string[];
  finalVerification?: FinalVerification;
  transcriptMarkdownPath?: string;
  transcriptJsonPath?: string;
  usage?: PairUsageSummary;
  error?: string;
  stopReason?: string;
  cyclesCompleted?: number;
  driverTools?: string[];
  navigatorTools?: string[];
  initialWorkspace?: WorkspaceSnapshot;
  finalWorkspace?: WorkspaceSnapshot;
}

interface PairTranscript {
  task: string;
  mode: "tdd";
  status: "success" | "blocked" | "incomplete" | "error";
  startedAt: string;
  endedAt?: string;
  cycles: PairCycleRecord[];
  initialWorkspace?: WorkspaceSnapshot;
  finalWorkspace?: WorkspaceSnapshot;
  finalVerification?: FinalVerification;
  finalNavigatorDecision?: NavigatorDecisionValue;
  changedFiles: string[];
  stopReason?: string;
  cyclesCompleted?: number;
  malformedDecisionRepairs?: number;
  driverTools?: string[];
  navigatorTools?: string[];
  error?: string;
  usage?: PairUsageSummary;
}

type PairProgramUpdate = (partial: { content: Array<{ type: "text"; text: string }>; details?: Partial<PairProgramDetails> }) => void;

// ---------------------------------------------------------------------------
// Transcript helpers
// ---------------------------------------------------------------------------

const TRANSCRIPT_DIR_NAME = "pair-runs";

function transcriptDir(cwd: string): string {
  return path.join(cwd, ".scratch", TRANSCRIPT_DIR_NAME);
}

function ensureTranscriptDir(cwd: string): string {
  const dir = transcriptDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

interface TranscriptPaths {
  markdown: string;
  json: string;
}

function createTranscriptPaths(cwd: string, task: string, startedAt: Date): TranscriptPaths {
  const dir = ensureTranscriptDir(cwd);
  const base = buildTranscriptBasename(task, startedAt);
  const markdown = path.join(dir, `${base}.md`);
  const json = path.join(dir, `${base}.json`);
  fs.writeFileSync(
    markdown,
    `# Pair Program Transcript\n\n` +
      `- Task: ${task}\n` +
      `- Started: ${startedAt.toISOString()}\n` +
      `- Mode: ${DEFAULT_MODE}\n\n` +
      `---\n\n`,
    "utf8",
  );
  return { markdown, json };
}

function appendTranscript(filePath: string, event: PairProtocolEvent): void {
  fs.appendFileSync(
    filePath,
    `## ${event.role}: ${event.phase}\n\n${event.text.trim()}\n\n---\n\n`,
    "utf8",
  );
}

function writeJsonTranscript(filePath: string, transcript: PairTranscript): void {
  try {
    fs.writeFileSync(filePath, JSON.stringify(transcript, null, 2), "utf8");
  } catch {
    // Best-effort: failing to persist a partial transcript must not crash the run.
  }
}

/** Live UI gets a compact descriptor; full bodies go only to the persisted transcript. */
function compactEventSummary(event: PairProtocolEvent): string {
  const preview = event.text.split("\n").find((line) => line.trim().length > 0)?.trim() ?? "";
  const head = preview.length > 160 ? `${preview.slice(0, 160)}...` : preview;
  return `${event.role} ${event.phase}${head ? `: ${head}` : ""}`;
}

function buildRoleSystemPrompt(role: "driver" | "navigator"): string {
  if (role === "driver") {
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
//
// Verification mechanism choice is implemented in
// extensions/lib/pair-program-helpers.ts. Summary:
//   Preferred: pi.getAllTools() lookup for any tool whose name contains
//              "skill-tdd" / "skill_tdd" (server-prefixed by the MCP adapter).
//   Fallback:  engineering-skills MCP config presence in well-known
//              mcp.json files (covers lazy-connect race after a fresh start).
// No SKILL.md filesystem path appears in this code.
// ---------------------------------------------------------------------------

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
          changedFiles: [],
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
          changedFiles: [],
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
            changedFiles: [],
            error: "engineering-skills MCP not configured",
          };
          return {
            content: [{ type: "text" as const, text: blockedResult.summary }],
            details: blockedResult,
            isError: true,
          };
        }

        // --- Create transcript files (AC #7, AC: JSON transcript) ---
        const cwd = ctx.cwd;
        const startedAt = new Date();
        const { markdown: transcriptMarkdownPath, json: transcriptJsonPath } =
          createTranscriptPaths(cwd, normalized.task, startedAt);

        let driverSession: RoleSession | undefined;
        let navigatorSession: RoleSession | undefined;

        // Live transcript scaffold so partial state can be persisted on abort/error.
        const liveTranscript: PairTranscript = {
          task: normalized.task,
          mode: "tdd",
          status: "incomplete",
          startedAt: startedAt.toISOString(),
          cycles: [],
          changedFiles: [],
        };
        writeJsonTranscript(transcriptJsonPath, liveTranscript);

        try {
          driverSession = await createRoleSession(
            pi,
            ctx,
            "driver",
            normalized.driverModel,
            [buildRoleSystemPrompt("driver")],
          );
          navigatorSession = await createRoleSession(
            pi,
            ctx,
            "navigator",
            normalized.navigatorModel,
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
              collectFinalEvidence: () => Promise.resolve(collectWorkspaceEvidence(cwd)),
              runFinalVerification: (command) => Promise.resolve(runVerification(command, cwd)),
              onEvent: (event) => {
                appendTranscript(transcriptMarkdownPath, event);
                publish?.({
                  content: [{ type: "text", text: compactEventSummary(event) }],
                  details: {
                    status: "incomplete",
                    summary: compactEventSummary(event),
                    transcriptMarkdownPath,
                    transcriptJsonPath,
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

          const changedFiles = parseChangedFilesFromGitStatus(
            protocolResult.finalWorkspace?.gitStatusShort
              ?? protocolResult.initialWorkspace?.gitStatusShort
              ?? "",
          );

          const result: PairProgramDetails = {
            status: protocolResult.status,
            summary:
              `Pair program TDD finished.\n` +
              `- Task: ${normalized.task}\n` +
              `- Mode: ${normalized.mode}\n` +
              `- Status: ${protocolResult.status}\n` +
              `- Stop reason: ${protocolResult.stopReason}\n` +
              `- Cycles completed: ${protocolResult.cyclesCompleted}\n` +
              (protocolResult.finalNavigatorDecision
                ? `- Final Navigator decision: ${protocolResult.finalNavigatorDecision}\n`
                : "") +
              `- Changed files: ${changedFiles.length ? changedFiles.join(", ") : "none"}\n` +
              (protocolResult.finalVerification
                ? `- Final verification: ${protocolResult.finalVerification.exitCode === 0 ? "passed" : "failed"} (${protocolResult.finalVerification.command})\n`
                : "") +
              `- Driver tools: ${driverTools.join(", ")}\n` +
              `- Navigator tools: ${navigatorTools.join(", ")}\n` +
              `- Usage: driver ${driverUsage.totalTokens} tok / $${driverUsage.costUsd.toFixed(4)}, ` +
              `navigator ${navigatorUsage.totalTokens} tok / $${navigatorUsage.costUsd.toFixed(4)}, ` +
              `total ${usage.totalUsage.totalTokens} tok / $${usage.totalUsage.costUsd.toFixed(4)}\n` +
              `- Transcript (md): ${transcriptMarkdownPath}\n` +
              `- Transcript (json): ${transcriptJsonPath}`,
            finalNavigatorDecision: protocolResult.finalNavigatorDecision,
            changedFiles,
            finalVerification: protocolResult.finalVerification,
            transcriptMarkdownPath,
            transcriptJsonPath,
            stopReason: protocolResult.stopReason,
            cyclesCompleted: protocolResult.cyclesCompleted,
            driverTools,
            navigatorTools,
            usage,
            initialWorkspace: protocolResult.initialWorkspace,
            finalWorkspace: protocolResult.finalWorkspace,
          };

          // Persist final JSON transcript.
          writeJsonTranscript(transcriptJsonPath, {
            ...liveTranscript,
            status: protocolResult.status,
            endedAt: new Date().toISOString(),
            cycles: protocolResult.cycles,
            initialWorkspace: protocolResult.initialWorkspace,
            finalWorkspace: protocolResult.finalWorkspace,
            finalVerification: protocolResult.finalVerification,
            finalNavigatorDecision: protocolResult.finalNavigatorDecision,
            changedFiles,
            stopReason: protocolResult.stopReason,
            cyclesCompleted: protocolResult.cyclesCompleted,
            malformedDecisionRepairs: protocolResult.malformedDecisionRepairs,
            driverTools,
            navigatorTools,
            usage,
          });

          return {
            content: [{ type: "text" as const, text: result.summary }],
            details: result,
          };
        } catch (err: unknown) {
          // Persist partial transcript on abort/error so the run is not lost.
          const message = err instanceof Error ? err.message : String(err);
          const aborted = ctx.signal?.aborted === true;
          let driverUsageSnapshot: ReturnType<typeof disposeRoleSession> | undefined;
          let navigatorUsageSnapshot: ReturnType<typeof disposeRoleSession> | undefined;
          if (driverSession) {
            driverUsageSnapshot = disposeRoleSession(driverSession);
            driverSession = undefined;
          }
          if (navigatorSession) {
            navigatorUsageSnapshot = disposeRoleSession(navigatorSession);
            navigatorSession = undefined;
          }
          const partialUsage = driverUsageSnapshot && navigatorUsageSnapshot
            ? buildPairUsageSummary(driverUsageSnapshot, navigatorUsageSnapshot)
            : undefined;
          writeJsonTranscript(transcriptJsonPath, {
            ...liveTranscript,
            status: aborted ? "incomplete" : "error",
            endedAt: new Date().toISOString(),
            error: message,
            usage: partialUsage,
          });
          const errorResult: PairProgramDetails = {
            status: aborted ? "incomplete" : "error",
            summary: `Pair program ${aborted ? "aborted" : "errored"}: ${message}\n- Transcript (md): ${transcriptMarkdownPath}\n- Transcript (json): ${transcriptJsonPath}`,
            changedFiles: [],
            transcriptMarkdownPath,
            transcriptJsonPath,
            usage: partialUsage,
            error: message,
          };
          return {
            content: [{ type: "text" as const, text: errorResult.summary }],
            details: errorResult,
            isError: !aborted,
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

  // Register slash command so /pair-program <task> works from the editor
  pi.registerCommand("pair-program", {
    description: "Start a pair-programming session. Usage: /pair-program <task description>",
    handler: async (args, ctx) => {
      const task = args?.trim();
      if (!task) {
        ctx.ui.notify("Usage: /pair-program <task description>", "error");
        return;
      }
      // Send as a user message that triggers the LLM to call pair_program tool
      pi.sendUserMessage(
        `Use the pair_program tool with this task: ${task}`,
      );
    },
  });
}
