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
import { join } from "node:path";
import {
	createSession,
	ARTIFACT_ROOT,
	type SessionState,
	type ScoutGate,
	determineBudgetAction,
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
	renderScoutRoomSummary,
	compactDecisionLedger,
	updateContextPressure,
	performGrillRespawn,
	renderRespawnStatusEvent,
	deriveInspectedPaths,
	type AreaVerification,
} from "./lib/grill-with-scouts-helpers.ts";

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

const WIDGET_KEY = "grill-scout-room";
const CHECKPOINT_THRESHOLD = 65;
const RESPAWN_THRESHOLD = 80;

function persistState(): void {
	if (!activeSession || !activeSessionCwd) return;
	const sessionDir = join(activeSessionCwd, ARTIFACT_ROOT, "sessions", activeSession.id);
	const jsonPath = join(sessionDir, "session.json");
	writeFileSync(jsonPath, JSON.stringify(activeSession, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// Scout Room Widget
// ---------------------------------------------------------------------------

function refreshWidget(ctx: ExtensionContext): void {
	if (!activeSession) {
		ctx.ui.setWidget(WIDGET_KEY, undefined);
		return;
	}
	const lines = renderScoutRoomSummary(activeSession, { expanded: false }).split("\n");
	ctx.ui.setWidget(WIDGET_KEY, lines, { placement: "aboveEditor" });
}

// ---------------------------------------------------------------------------
// Context Pressure Automation
// ---------------------------------------------------------------------------

function handleContextPressure(ctx: ExtensionContext): void {
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
		// The Lead Griller system prompt re-injects the latest checkpoint,
		// so planning state survives compaction.
		ctx.compact({
			customInstructions: "This is a Grill With Scouts planning session. Preserve: the current goal, tier, accepted decisions, and the latest planning question. The full checkpoint is re-injected via system prompt.",
		});
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

function buildLeadGrillerPrompt(state: SessionState): string {
	const checkpoint = latestCheckpointContent(state);
	const ledger = state.acceptedDecisions.length > 0 ? compactDecisionLedger(state) : "";

	return `
=== Grill With Scouts — Lead Griller mode active ===

You are the Lead Griller in a managed planning session. Drive a structured conversation that produces a Scout-Grounded Handoff.

Session: ${state.id}
Goal: ${state.goal}
Current tier: ${state.currentTier}
Decisions accepted: ${state.acceptedDecisions.length}
${state.durableScoutFindings.length > 0 ? `Scout findings: ${state.durableScoutFindings.join("; ")}` : ""}
${state.scoutGaps.length > 0 ? `Scout gaps: ${state.scoutGaps.join("; ")}` : ""}
${state.nextQuestion ? `Resume from: ${state.nextQuestion}` : ""}
${ledger ? `\nDecision ledger:\n${ledger}` : ""}
${checkpoint ? `\nLatest checkpoint:\n${checkpoint}` : ""}

## Your protocol

1. Ask ONE focused question at a time. Start at macro, progress to meso, then micro.
2. When the human confirms a decision, call the \`grill_decide\` tool with the decision and trigger fields.
3. If \`grill_decide\` returns budget action \`call-now\`, immediately dispatch scouts using the \`subagent\` tool (type=explore), then call \`grill_record_scout\` with each scout's output.
4. If budget action is \`ask-human\`, ask the human whether to run scouts or skip.
5. If budget action is \`skip-with-reason\`, move on.
6. After completing a tier or accumulating 5+ decisions, call \`grill_checkpoint\`.
7. When all tiers are covered, call \`grill_finalize\` to produce the handoff.

## How to dispatch scouts

When \`grill_decide\` says \`call-now\`, run scouts for the profiles it selects. For each profile, call the \`subagent\` tool with:
- type: "explore"
- task: the scout prompt (see format below)

Scout prompt format for the subagent task:
\`\`\`
You are the {profile} scout. Investigate this decision from the {profile} perspective.

Decision: {the decision text}
Goal: ${state.goal}
Known anchors: {any file paths or symbols mentioned so far}

End your response with exactly:
Verdict: viable | risky | blocked | needs-decision
Evidence: <specific files/docs/patterns, or "not found">
Concern: <one concrete issue, or "none">
Required decision: <one question for the Lead Griller to ask, or "none">
Claimed anchors: <symbols/contracts/events/state names, or "none">
Confidence: verified | partial | unverified
\`\`\`

After each scout returns, call \`grill_record_scout\` with the gate ID, profile name, and full output.

## Tools available to you

- \`grill_decide\` — record a confirmed decision and get the Scout Gate evaluation
- \`grill_record_scout\` — persist a scout's output and extract verdict/findings
- \`grill_checkpoint\` — save a formal checkpoint (do this after each tier)
- \`grill_finalize\` — write the final handoff (do this when planning is complete)
- \`subagent\` — dispatch scouts as explore subagents

## Formatting

- Start each turn with: [Tier] | [N decisions] | [active gate if any]
- Ask one clear question.
- When recording a decision, state it as a one-liner the human can confirm or reject.

## Session artifacts

Artifacts: ${ARTIFACT_ROOT}/sessions/${state.id}/
`;
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

export default function grillWithScouts(pi: ExtensionAPI) {
	// Inject Lead Griller system prompt on every agent turn while session is active
	pi.on("before_agent_start", (event) => {
		if (!activeSession) return;
		return {
			systemPrompt: event.systemPrompt + buildLeadGrillerPrompt(activeSession),
		};
	});

	// --- Context pressure + widget refresh on turn_end -------------------------

	pi.on("turn_end", (_event, ctx) => {
		if (!activeSession) return;
		handleContextPressure(ctx);
		refreshWidget(ctx);
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

		refreshWidget(ctx);
	});

	// --- Refresh widget on session start ----------------------------------------

	pi.on("session_start", (_event, ctx) => {
		refreshWidget(ctx);
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

			const budgetAction = determineBudgetAction(riskLevel);

			// Select scout profiles based on triggers
			const selectedProfiles: string[] = [];
			if (budgetAction === "call-now" || budgetAction === "ask-human") {
				if (params.crossesBoundary || params.hasRuntimeRisk) selectedProfiles.push("backend");
				if (params.changesContractOrState) selectedProfiles.push("frontend");
				if (params.hasMeaningfulFailureCost) selectedProfiles.push("qa");
				if (params.hasRuntimeRisk || params.introducesLifecycle) selectedProfiles.push("runtime");
				if (selectedProfiles.length === 0) selectedProfiles.push("backend");
			}

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
				skipReason: budgetAction === "skip-with-reason" ? "Low risk — no triggers fired" : undefined,
			};

			// Persist gate
			recordScoutGate(gate, activeSessionCwd, activeSession.id);
			activeSession.scoutGates.push(gate);
			persistState();

			const result = {
				gateId,
				decision: params.decision,
				riskLevel,
				budgetAction,
				selectedScoutProfiles: selectedProfiles,
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
			ctx.ui.setWidget(WIDGET_KEY, undefined);
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
			const summary = renderScoutRoomSummary(activeSession, { expanded: true });
			ctx.ui.notify(summary, "info");
		},
	});
}
