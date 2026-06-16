/**
 * Grill With Scouts extension — registers `/grill-with-scouts <goal>` command
 * and tools the Lead Griller calls to drive a planning session.
 *
 * Tools registered:
 * - grill_decide: record a decision, evaluate Scout Gate, return budget action
 * - grill_record_scout: record a scout's output after running it via `subagent`
 * - grill_checkpoint: create a formal checkpoint
 * - grill_finalize: write the final Scout-Grounded Handoff
 *
 * The agent uses the existing `subagent` tool (type=explore) for scout execution.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	createSession,
	ARTIFACT_ROOT,
	type SessionState,
	type ScoutGate,
	determineBudgetAction,
	planScoutDispatch,
	recordScoutGate,
	recordScoutResult,
	recordScoutGap,
	createCheckpoint,
	updateHandoff,
	markHandoffReady,
	writeFinalHandoff,
	computeAreaVerification,
	buildScoutPrompt,
	loadScoutProfile,
	loadGrillMeProtocol,
	loadGrillWithDocsSkill,
	compactDecisionLedger,
	updateContextPressure,
	performGrillRespawn,
	renderRespawnStatusEvent,
	deriveInspectedPaths,
	type AreaVerification,
} from "./lib/grill-with-scouts-helpers.ts";

// Resolve extension directory for loading prompt templates
const extDir = typeof __dirname !== "undefined" ? __dirname : dirname(new URL(import.meta.url).pathname);
const PROMPTS_DIR = join(extDir, "prompts");

let cachedLeadGrillerTemplate: string | null = null;
function loadLeadGrillerTemplate(): string {
	if (cachedLeadGrillerTemplate !== null) return cachedLeadGrillerTemplate;
	try {
		const main = readFileSync(join(PROMPTS_DIR, "lead-griller.md"), "utf8");
		const scoutDispatch = readFileSync(join(PROMPTS_DIR, "scout-dispatch.md"), "utf8");
		cachedLeadGrillerTemplate = main + "\n\n" + scoutDispatch;
	} catch {
		cachedLeadGrillerTemplate = "";
	}
	return cachedLeadGrillerTemplate;
}

// ---------------------------------------------------------------------------
// Session state (module-scoped, lives for the pi process lifetime)
// ---------------------------------------------------------------------------

let activeSession: SessionState | null = null;
let activeSessionCwd: string | null = null;

/** Stores toolCalls from the last scout subagent execution, keyed by toolCallId. */
const scoutTelemetryCache = new Map<string, Array<{ name: string; args: unknown }>>();

/** Track whether we already checkpointed/respawned at the current pressure level. */
let lastCheckpointPressure = 0;
let lastRespawnPressure = 0;

const CHECKPOINT_THRESHOLD = 65;
const RESPAWN_THRESHOLD = 80;

function persistState(): void {
	if (!activeSession || !activeSessionCwd) return;
	const sessionDir = join(activeSessionCwd, ARTIFACT_ROOT, "sessions", activeSession.id);
	const jsonPath = join(sessionDir, "session.json");
	writeFileSync(jsonPath, JSON.stringify(activeSession, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// Context Pressure Automation
// ---------------------------------------------------------------------------

function handleContextPressure(ctx: ExtensionContext, pi: ExtensionAPI): void {
	if (!activeSession || !activeSessionCwd) return;

	const usage = ctx.getContextUsage();
	if (!usage || usage.percent === null) return;

	updateContextPressure(activeSession, usage.percent);

	// Auto-checkpoint at threshold
	if (usage.percent >= CHECKPOINT_THRESHOLD && lastCheckpointPressure < CHECKPOINT_THRESHOLD) {
		createCheckpoint(activeSession, activeSessionCwd, activeSession.id);
		lastCheckpointPressure = usage.percent;
		persistState();
	}

	// Auto-respawn at threshold
	if (usage.percent >= RESPAWN_THRESHOLD && lastRespawnPressure < RESPAWN_THRESHOLD) {
		// Checkpoint first if we haven't already
		if (lastCheckpointPressure < RESPAWN_THRESHOLD) {
			createCheckpoint(activeSession, activeSessionCwd, activeSession.id);
		}
		performGrillRespawn(activeSession, activeSessionCwd, activeSession.id);
		lastRespawnPressure = usage.percent;
		persistState();

		const respawnMsg = renderRespawnStatusEvent(activeSession);
		ctx.ui.notify(`Grill Respawn: ${respawnMsg}`, "info");

		// Actually compact the conversation so the real context shrinks.
		// The system prompt is intentionally STATIC (so it stays cached), so it can
		// no longer carry the checkpoint. Instead we re-seed the volatile planning
		// state as a tail message after compaction — this survives the truncation
		// without invalidating the cached system-prompt prefix.
		ctx.compact({
			customInstructions: "This is a Grill With Scouts planning session. Preserve: the current goal, tier, accepted decisions, and the latest planning question.",
		});

		const snapshot = activeSession ? buildDynamicStateMessage(activeSession) : null;
		if (snapshot) {
			pi.sendUserMessage(snapshot, { deliverAs: "followUp" });
		}
	}
}

// ---------------------------------------------------------------------------
// Tool parameter schemas
// ---------------------------------------------------------------------------

const GrillDecideParams = Type.Object({
	decision: Type.String({ description: "One-line summary of the accepted decision." }),
	tier: Type.Optional(Type.String({ description: "Current tier: macro, meso, or micro. Updates session tier." })),
	crossesBoundary: Type.Boolean({ description: "Does the decision cross a system boundary?" }),
	changesContractOrState: Type.Boolean({ description: "Does it change a contract, payload, schema, or state shape?" }),
	introducesLifecycle: Type.Boolean({ description: "Does it introduce a lifecycle or async coordination?" }),
	hasRuntimeRisk: Type.Boolean({ description: "Does it have runtime risk (perf, concurrency, resource)?" }),
	hasUnverifiedLayerAssumption: Type.Boolean({ description: "Does it have an unverified layer assumption?" }),
	hasMeaningfulFailureCost: Type.Boolean({ description: "Does it have meaningful failure cost?" }),
	nextQuestion: Type.Optional(Type.String({ description: "The next question to ask after this decision." })),
});

const GrillRecordScoutParams = Type.Object({
	gateId: Type.String({ description: "The Scout Gate ID this scout was dispatched for." }),
	profileName: Type.String({ description: "Scout profile: backend, frontend, qa, or runtime." }),
	scoutOutput: Type.String({ description: "The full output returned by the scout subagent." }),
});

const GrillCheckpointParams = Type.Object({
	reason: Type.Optional(Type.String({ description: "Why this checkpoint is being created." })),
});

const GrillFinalizeParams = Type.Object({
	summary: Type.Optional(Type.String({ description: "Optional summary note for the handoff." })),
});

// ---------------------------------------------------------------------------
// Lead Griller system prompt
// ---------------------------------------------------------------------------

/**
 * Build the STATIC Lead Griller system-prompt block.
 *
 * IMPORTANT (prompt-cache correctness): this is appended to the system prompt on
 * every turn via `before_agent_start`. The system prompt is the cached prefix
 * (byte 0). If any byte of it changes between turns, the entire prompt-cache
 * prefix mismatches and the whole request (system + full history) is re-written
 * as fresh cache — which is exactly the cacheWrite blow-up we want to avoid.
 *
 * Therefore this block MUST be byte-identical for the whole lifetime of a
 * session. Only include values that are fixed at session creation (id, goal)
 * plus the static protocol/docs/template. Volatile planning state (decisions,
 * findings, gaps, next question, ledger, checkpoint) lives in the conversation
 * itself (tool results) and is re-seeded after compaction via
 * `buildDynamicStateMessage` — never in the cached prefix.
 */
export function buildStaticLeadGrillerPrompt(state: SessionState): string {
	const sessionHeader = `
=== Grill With Scouts — Lead Griller mode active ===

Session: ${state.id}
Goal: ${state.goal}

Session artifacts: ${ARTIFACT_ROOT}/sessions/${state.id}/

Current planning state (tier, accepted decisions, scout findings/gaps, and the
next question) is tracked in the conversation via grill_* tool results. Do not
expect it to be repeated here.
`;

	const grillMeProtocol = loadGrillMeProtocol();
	const grillMeSection = grillMeProtocol
		? `\n## Base protocol (grill-me)\n\n${grillMeProtocol}\n`
		: "";

	const grillWithDocs = loadGrillWithDocsSkill();
	const docsSection = grillWithDocs
		? `\n## Domain awareness (grill-with-docs additions)\n\n${grillWithDocs}\n`
		: "";

	const template = loadLeadGrillerTemplate();

	return sessionHeader + grillMeSection + docsSection + "\n" + template;
}

/**
 * Build the VOLATILE planning-state snapshot, delivered as a normal conversation
 * message (NOT in the system prompt). Used to re-seed state after a compaction /
 * respawn truncates the history. Because it lands at the tail of the
 * conversation, it only invalidates the small last-message cache breakpoint
 * rather than the whole prefix.
 */
export function buildDynamicStateMessage(state: SessionState): string {
	const checkpoint = latestCheckpointContent(state);
	const ledger = state.acceptedDecisions.length > 0 ? compactDecisionLedger(state) : "";

	return `[Grill With Scouts] Resuming after context compaction. Current planning state:

Current tier: ${state.currentTier}
Decisions accepted: ${state.acceptedDecisions.length}
${state.durableScoutFindings.length > 0 ? `Scout findings: ${state.durableScoutFindings.join("; ")}` : ""}
${state.scoutGaps.length > 0 ? `Scout gaps: ${state.scoutGaps.join("; ")}` : ""}
${state.nextQuestion ? `Resume from: ${state.nextQuestion}` : ""}
${ledger ? `\nDecision ledger:\n${ledger}` : ""}
${checkpoint ? `\nLatest checkpoint:\n${checkpoint}` : ""}`;
}

function latestCheckpointContent(state: SessionState): string | null {
	if (!activeSessionCwd || state.checkpoints.length === 0) return null;
	const latestPath = join(activeSessionCwd, ARTIFACT_ROOT, "sessions", state.id, "checkpoints", "latest.md");
	if (!existsSync(latestPath)) return null;
	try {
		return readFileSync(latestPath, "utf8");
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Extension entry
// ---------------------------------------------------------------------------

const REGISTER_GRILL_WITH_SCOUTS = false;

export default function grillWithScouts(pi: ExtensionAPI) {
	if (!REGISTER_GRILL_WITH_SCOUTS) {
		// Backlog for later: keep the implementation in-repo, but do not register
		// the tools/commands into Pi for now.
		return;
	}

	// Inject the STATIC Lead Griller system prompt on every agent turn while a
	// session is active. This block is byte-identical for the whole session so it
	// stays in the prompt cache (cacheRead) instead of forcing a full prefix
	// re-write (cacheWrite) on every turn.
	pi.on("before_agent_start", (event) => {
		if (!activeSession) return;
		return {
			systemPrompt: event.systemPrompt + buildStaticLeadGrillerPrompt(activeSession),
		};
	});

	// --- Context pressure + widget refresh on turn_end -------------------------

	pi.on("turn_end", (_event, ctx) => {
		if (!activeSession) return;
		handleContextPressure(ctx, pi);
	});

	// --- Refresh widget after tool execution -----------------------------------

	pi.on("tool_execution_end", (event, ctx) => {
		if (!activeSession) return;

		// Capture subagent telemetry for scout tool-call passthrough
		if (event.toolName === "subagent" && event.result) {
			const details = (event.result as { details?: { toolCalls?: Array<{ name: string; args: unknown }> } }).details;
			if (details?.toolCalls) {
				scoutTelemetryCache.set(event.toolCallId, details.toolCalls);
				// Keep cache bounded
				if (scoutTelemetryCache.size > 50) {
					const oldest = scoutTelemetryCache.keys().next().value;
					if (oldest) scoutTelemetryCache.delete(oldest);
				}
			}
		}

	});

	// --- Tool: grill_decide ---------------------------------------------------

	pi.registerTool({
		name: "grill_decide",
		label: "Grill Decide",
		description: "Record an accepted decision and evaluate its Scout Gate. Returns the risk level and budget action.",
		parameters: GrillDecideParams,
		async execute(_toolCallId: string, params: Static<typeof GrillDecideParams>) {
			if (!activeSession || !activeSessionCwd) {
				return { content: [{ type: "text" as const, text: "Error: No active Grill With Scouts session. Run /grill-with-scouts first." }], details: undefined };
			}

			// Update tier if provided
			if (params.tier) {
				activeSession.currentTier = params.tier;
			}

			// Record the decision
			activeSession.acceptedDecisions.push(params.decision);
			activeSession.currentDecision = params.decision;

			// Update next question
			if (params.nextQuestion) {
				activeSession.nextQuestion = params.nextQuestion;
			}

			// Evaluate Scout Gate triggers
			const triggers = [
				params.crossesBoundary,
				params.changesContractOrState,
				params.introducesLifecycle,
				params.hasRuntimeRisk,
				params.hasUnverifiedLayerAssumption,
				params.hasMeaningfulFailureCost,
			];
			const triggerCount = triggers.filter(Boolean).length;

			let riskLevel: ScoutGate["riskLevel"];
			if (triggerCount >= 2 || params.hasRuntimeRisk || params.hasMeaningfulFailureCost) {
				riskLevel = "high";
			} else if (triggerCount === 1) {
				riskLevel = "medium";
			} else {
				riskLevel = "low";
			}

			const initialBudgetAction = determineBudgetAction(riskLevel);
			const dispatchPlan = planScoutDispatch({
				decision: params.decision,
				goal: activeSession.goal,
				currentTier: activeSession.currentTier,
				crossesBoundary: params.crossesBoundary,
				changesContractOrState: params.changesContractOrState,
				introducesLifecycle: params.introducesLifecycle,
				hasRuntimeRisk: params.hasRuntimeRisk,
				hasUnverifiedLayerAssumption: params.hasUnverifiedLayerAssumption,
				hasMeaningfulFailureCost: params.hasMeaningfulFailureCost,
				budgetAction: initialBudgetAction,
				durableScoutFindings: activeSession.durableScoutFindings,
			});
			const budgetAction = dispatchPlan.budgetAction;
			const selectedProfiles = dispatchPlan.selectedScoutProfiles;

			// Create the Scout Gate record
			const gateId = `gate-${activeSession.scoutGates.length + 1}`;
			const gate: ScoutGate = {
				id: gateId,
				tier: (activeSession.currentTier as ScoutGate["tier"]) || "macro",
				decisionUnderReview: params.decision,
				crossesBoundary: params.crossesBoundary,
				changesContractOrState: params.changesContractOrState,
				introducesLifecycle: params.introducesLifecycle,
				hasRuntimeRisk: params.hasRuntimeRisk,
				hasUnverifiedLayerAssumption: params.hasUnverifiedLayerAssumption,
				hasMeaningfulFailureCost: params.hasMeaningfulFailureCost,
				riskLevel,
				selectedScoutProfiles: selectedProfiles,
				budgetAction,
				skipReason: dispatchPlan.skipReason,
			};

			// Persist gate
			recordScoutGate(gate, activeSessionCwd, activeSession.id);
			activeSession.scoutGates.push(gate);
			persistState();

			// Build profile-specific scout prompts so the model uses them directly
			const checkpointContent = latestCheckpointContent(activeSession!) || "No checkpoint yet.";
			const scoutPrompts: Record<string, string> = {};
			for (const profileName of selectedProfiles) {
				const profile = loadScoutProfile(profileName) ?? {
					name: profileName,
					description: profileName + " scout",
					scope: profileName + " layer concerns",
					triggerFit: "general",
					evidenceRequirements: "file paths with line ranges",
					verdictFormat: "standard",
					forbiddenBehaviors: "Do not modify source code.",
					body: "Investigate " + profileName + " aspects of the decision.",
				};
				scoutPrompts[profileName] = buildScoutPrompt({
					profile,
					checkpointContent,
					decision: params.decision,
					anchors: [],
				});
			}

			const result = {
				gateId,
				decision: params.decision,
				riskLevel,
				budgetAction,
				selectedScoutProfiles: selectedProfiles,
				scoutSelectionReasons: dispatchPlan.selectionReasons,
				scoutPrompts,
				totalDecisions: activeSession.acceptedDecisions.length,
			};

			return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: undefined };
		},
	});

	// --- Tool: grill_record_scout -----------------------------------------------

	pi.registerTool({
		name: "grill_record_scout",
		label: "Grill Record Scout",
		description: "Record a scout's output after running it via the subagent tool. Parses the verdict, extracts findings or records gaps.",
		parameters: GrillRecordScoutParams,
		async execute(_toolCallId: string, params: Static<typeof GrillRecordScoutParams>) {
			if (!activeSession || !activeSessionCwd) {
				return { content: [{ type: "text" as const, text: "No active Grill With Scouts session." }], details: undefined };
			}

			// Find telemetry from the most recent subagent execution (scout)
			// The cache stores toolCalls keyed by subagent toolCallId
			let scoutToolCalls: Array<{ name: string; args: unknown }> | undefined;
			for (const [, calls] of scoutTelemetryCache) {
				scoutToolCalls = calls;
			}

			const result = recordScoutResult({
				cwd: activeSessionCwd,
				sessionId: activeSession.id,
				gateId: params.gateId,
				profileName: params.profileName,
				rawOutput: params.scoutOutput,
				toolCalls: scoutToolCalls,
			});

			// Update session state
			if (result.finding) {
				activeSession.durableScoutFindings.push(result.finding);
			}
			if (result.gap) {
				activeSession.scoutGaps.push(result.gap);
			}

			persistState();
			updateHandoff(activeSession, activeSessionCwd, activeSession.id);

			const summary = {
				gateId: params.gateId,
				profile: params.profileName,
				verdict: result.verdict?.verdict ?? "unusable (gap recorded)",
				confidence: result.verdict?.confidence ?? "n/a",
				concern: result.verdict?.concern ?? "n/a",
				finding: result.finding,
				gap: result.gap,
				outputPath: result.outputPath,
			};

			return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }], details: undefined };
		},
	});

	// --- Tool: grill_checkpoint -------------------------------------------------

	pi.registerTool({
		name: "grill_checkpoint",
		label: "Grill Checkpoint",
		description: "Create a formal Grill Checkpoint from the current session state. Call after completing a tier or after 5+ decisions.",
		parameters: GrillCheckpointParams,
		async execute(_toolCallId: string, params: Static<typeof GrillCheckpointParams>) {
			if (!activeSession || !activeSessionCwd) {
				return { content: [{ type: "text" as const, text: "No active Grill With Scouts session." }], details: undefined };
			}

			createCheckpoint(activeSession, activeSessionCwd, activeSession.id);
			persistState();

			const cpNumber = activeSession.checkpoints.length;
			const result = {
				checkpointNumber: cpNumber,
				path: `checkpoints/${cpNumber}.md`,
				reason: params.reason ?? "manual",
				totalDecisions: activeSession.acceptedDecisions.length,
				tier: activeSession.currentTier,
			};

			return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: undefined };
		},
	});

	// --- Tool: grill_finalize ---------------------------------------------------

	pi.registerTool({
		name: "grill_finalize",
		label: "Grill Finalize",
		description: "Write the final Scout-Grounded Handoff and mark the session as complete. Call when all planning tiers are covered.",
		parameters: GrillFinalizeParams,
		async execute(_toolCallId: string, params: Static<typeof GrillFinalizeParams>) {
			if (!activeSession || !activeSessionCwd) {
				return { content: [{ type: "text" as const, text: "No active Grill With Scouts session." }], details: undefined };
			}

			// Mark handoff ready
			markHandoffReady(activeSession);

			// Compute area verifications from scout results
			const areaVerifications: AreaVerification[] = [];
			const scoutProfiles = new Set<string>();
			for (const gate of activeSession.scoutGates) {
				for (const profile of gate.selectedScoutProfiles) {
					scoutProfiles.add(profile);
				}
			}

			for (const profile of scoutProfiles) {
				// Find findings and gaps for this profile
				const findings = activeSession.durableScoutFindings.filter(f => f.startsWith(`${profile}:`));
				const gaps = activeSession.scoutGaps.filter(g => g.includes(` ${profile}:`));
				const claimedAnchors = findings.map(f => {
					const match = f.match(/evidence: (.+?)(?:\||$)/);
					return match ? match[1].trim() : "";
				}).filter(Boolean);

				const verification = computeAreaVerification(
					profile,
					[], // No tool-verified paths in this flow (scouts ran via subagent, no telemetry)
					claimedAnchors,
					activeSession.scoutGaps,
				);
				areaVerifications.push(verification);
			}

			// Write final handoff
			writeFinalHandoff(activeSession, activeSessionCwd, activeSession.id, areaVerifications);

			// Final checkpoint
			createCheckpoint(activeSession, activeSessionCwd, activeSession.id);
			persistState();

			const result = {
				status: "handoff ready",
				handoffPath: `${ARTIFACT_ROOT}/sessions/${activeSession.id}/handoff.md`,
				latestHandoffPath: `${ARTIFACT_ROOT}/latest-handoff.md`,
				totalDecisions: activeSession.acceptedDecisions.length,
				totalFindings: activeSession.durableScoutFindings.length,
				totalGaps: activeSession.scoutGaps.length,
				areas: areaVerifications.map(a => ({ area: a.area, status: a.status })),
				summary: params.summary,
			};

			return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: undefined };
		},
	});

	// --- Command: /grill-with-scouts --------------------------------------------

	pi.registerCommand("grill-with-scouts", {
		description:
			"Start or show a Grill With Scouts planning session. Usage: /grill-with-scouts <goal>",
		async handler(args, ctx) {
			const goal = args?.trim();

			if (!goal) {
				ctx.ui.notify(
					"Usage: /grill-with-scouts <goal>\nExample: /grill-with-scouts Design a plugin system",
					"warning",
				);
				return;
			}

			const result = createSession(goal, ctx.cwd);
			activeSession = result.state;
			activeSessionCwd = ctx.cwd;

			if (result.created) {
				ctx.ui.notify(
					`Grill With Scouts session started: ${result.state.id}\nArtifacts: ${ARTIFACT_ROOT}/sessions/${result.state.id}/`,
					"info",
				);
			} else {
				ctx.ui.notify(
					`Resuming Grill With Scouts session: ${result.state.id}`,
					"info",
				);
			}


			// Trigger a turn so the Lead Griller responds immediately
			pi.sendUserMessage(
				`[Grill With Scouts] Begin planning session. Goal: ${goal}`,
				{ deliverAs: "followUp" },
			);
		},
	});

	// --- Command: /grill-stop ---------------------------------------------------

	pi.registerCommand("grill-stop", {
		description: "End the active Grill With Scouts session (keeps artifacts).",
		async handler(_args, ctx) {
			if (!activeSession) {
				ctx.ui.notify("No active Grill With Scouts session.", "warning");
				return;
			}
			const id = activeSession.id;
			activeSession = null;
			activeSessionCwd = null;
			lastCheckpointPressure = 0;
			lastRespawnPressure = 0;
			scoutTelemetryCache.clear();
			ctx.ui.notify(`Grill With Scouts session ended: ${id}\nArtifacts preserved.`, "info");
		},
	});

	// --- Command: /grill-status -------------------------------------------------

	pi.registerCommand("grill-status", {
		description: "Show the current Grill With Scouts session state.",
		async handler(_args, ctx) {
			if (!activeSession) {
				ctx.ui.notify("No active Grill With Scouts session.", "warning");
				return;
			}
			ctx.ui.notify(JSON.stringify({ tier: activeSession.currentTier, decisions: activeSession.acceptedDecisions.length, gates: activeSession.scoutGates.length }, null, 2), "info");
		},
	});
}
