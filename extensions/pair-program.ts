/**
 * Pair Program Tool — deterministic coordinator for autonomous
 * pair-programming runs (Driver + Navigator). Dry-run slice: prerequisite
 * verification, persistent role sessions, one Navigator/Driver protocol loop,
 * compact memory handoff, and structured result with transcript path.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
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
  normalizeParams,
  resolvePstackRegistry,
  shouldRegisterPairProgram,
  tryAcquireRun,
  releaseRun,
  type PstackRegistry,
} from "./lib/pair-program-helpers.ts";

// ---------------------------------------------------------------------------
// Parameter schema (MICRO-001, MICRO-003)
// ---------------------------------------------------------------------------

const PairProgramParams = Type.Object({
  task: Type.String({ description: "Task for the Driver/Navigator pair." }),
  maxCycles: Type.Optional(
    Type.Number({
      description: "Maximum Driver/Navigator cycles. Default: 4.",
      minimum: 1,
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
// Pstack registry metadata fallback
// ---------------------------------------------------------------------------

const ENGINEERING_SKILLS_SERVER_NAME = "engineering-skills";
const MCP_CONFIG_CANDIDATES = [
  path.join(homedir(), ".config", "mcp", "mcp.json"),
  path.join(homedir(), ".pi", "agent", "mcp.json"),
  path.resolve(process.cwd(), ".mcp.json"),
  path.resolve(process.cwd(), ".pi", "mcp.json"),
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonRecord(filePath: string): Record<string, unknown> | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function findEngineeringSkillsRepoPath(): string | undefined {
  for (const configPath of MCP_CONFIG_CANDIDATES) {
    const config = readJsonRecord(configPath);
    const mcpServers = isRecord(config?.mcpServers) ? config.mcpServers : undefined;
    const server = isRecord(mcpServers?.[ENGINEERING_SKILLS_SERVER_NAME])
      ? mcpServers[ENGINEERING_SKILLS_SERVER_NAME]
      : undefined;
    const args = Array.isArray(server?.args) ? server.args : [];
    const entrypoint = args.find((arg): arg is string => typeof arg === "string" && arg.trim().length > 0);
    if (!entrypoint) continue;

    const resolvedEntrypoint = path.resolve(path.dirname(configPath), entrypoint);
    const repoPath = path.basename(resolvedEntrypoint) === "index.js"
      ? path.dirname(path.dirname(resolvedEntrypoint))
      : path.dirname(resolvedEntrypoint);
    if (fs.existsSync(path.join(repoPath, "pstack", "skills"))) return repoPath;
  }
  return undefined;
}

function listDirectories(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function listMarkdownBasenames(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.basename(entry.name, ".md"))
    .sort();
}

function discoverPstackDescriptionFromEngineeringSkillsConfig(): string | undefined {
  const repoPath = findEngineeringSkillsRepoPath();
  if (!repoPath) return undefined;

  const skillsDir = path.join(repoPath, "pstack", "skills");
  const skills = listDirectories(skillsDir).filter((name) => fs.existsSync(path.join(skillsDir, name, "SKILL.md")));
  const playbooks = skills.flatMap((skill) =>
    listMarkdownBasenames(path.join(skillsDir, skill, "playbooks")).map((playbook) => `${skill}/playbooks/${playbook}`),
  );

  if (skills.length === 0 && playbooks.length === 0) return undefined;
  const lines = ["pstack skill reference (from configured engineering-skills MCP repo). Available names:"];
  if (skills.length > 0) lines.push("", "Skills:", ...skills.map((name) => `  - ${name}`));
  if (playbooks.length > 0) lines.push("", "Playbooks:", ...playbooks.map((name) => `  - ${name}`));
  return lines.join("\n");
}

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
      `- Started: ${startedAt.toISOString()}\n\n` +
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
      "You may edit and write files. Run commands to verify your changes.",
      "Follow pstack engineering skills and playbooks as directed by the run's playbook recommendation.",
    ].join("\n");
  }
  return [
    "You are the Navigator Agent in a deterministic Pair Program Tool run.",
    "You review Driver plans, implementation evidence, risks, and acceptance checklist coverage.",
    "Do not edit or write files. Your role is review-only.",
    "When reviewing a cycle, include exactly one DECISION line from the coordinator contract.",
  ].join("\n");
}

async function runRolePrompt(roleSession: RoleSession, prompt: string): Promise<string> {
  return promptRoleSession(roleSession, prompt);
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
      "Start a deterministic pstack-driven pair-programming run with a Driver and Navigator agent. " +
      "The Driver executes the implementation while the Navigator reviews plans, evidence, and risks. " +
      "Returns structured status with transcript path.",
    promptSnippet:
      "Use `pair_program` to kick off a pstack-driven pair-programming session for a well-scoped task. " +
      "The tool snapshots the pstack skill registry, creates a transcript, and coordinates the run.",
    promptGuidelines: [
      "Provide a clear, focused task description for the Driver/Navigator pair.",
      "The Navigator is review-only and does not edit or write files.",
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

      // --- One active run per session ---
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

      // Capture pstack registry snapshot once per run; block if unavailable.
      let pstackRegistry: PstackRegistry | undefined;

      try {
        // --- Resolve pstack skill registry snapshot ---
        const registryResult = resolvePstackRegistry({
          getAllTools: () => pi.getAllTools?.() ?? [],
          getActiveTools: () => pi.getActiveTools?.() ?? [],
          getPstackDescription: () => discoverPstackDescriptionFromEngineeringSkillsConfig(),
        });
        if (!registryResult.available) {
          const blockedResult: PairProgramDetails = {
            status: "blocked",
            summary:
              "pstack-driven pair programming requires the engineering-skills MCP server with skill-pstack. " +
              `Registry unavailable: ${registryResult.reason}`,
            changedFiles: [],
            error: registryResult.reason,
          };
          return {
            content: [{ type: "text" as const, text: blockedResult.summary }],
            details: blockedResult,
            isError: true,
          };
        }
        pstackRegistry = registryResult.registry;

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
              `Pair program finished.\n` +
              `- Task: ${normalized.task}\n` +
              `- Status: ${protocolResult.status}\n` +
              `- Pstack skills available: ${pstackRegistry?.skills.length ?? 0}, playbooks: ${pstackRegistry?.playbooks.length ?? 0}\n` +
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
      return new Text(
        `${theme.fg("toolTitle", theme.bold("pair_program "))}${theme.fg("accent", "pstack")}\n  ${theme.fg("dim", task)}`,
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

let activeRunId: string | undefined;

export default function pairProgramExtension(pi: ExtensionAPI) {
  // Skip registration entirely when pi runs in JSON RPC mode (the launch
  // shape ralph-loop uses). There is no slash-command surface in that mode,
  // and we don't want the LLM auto-selecting pair_program inside ralph-loop
  // iterations. Interactive sessions still get the tool and `/pair-program`.
  if (!shouldRegisterPairProgram(process.argv)) {
    return;
  }

  pi.on("session_start", async () => {
    activeRunId = undefined;
  });

  pi.registerTool(buildPairProgramToolDef(pi));

  // Register slash command so /pair-program <task> works from the editor
  pi.registerCommand("pair-program", {
    description: "Start a pstack-driven pair-programming session. Usage: /pair-program <task description>",
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
