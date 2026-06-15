/**
 * Pure unit tests for grill-with-scouts session scaffold and artifact store.
 *
 * Tests exercise extensions/lib/grill-with-scouts-helpers.ts directly.
 * Uses a temp directory to verify file creation without polluting the repo.
 *
 * Run: npx tsx extensions/__tests__/grill-with-scouts.test.ts
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
	buildScoutPrompt,
	computeAreaVerification,
	createSession,
	createCheckpoint,
	compactDecisionLedger,
	deltaVerificationInstruction,
	deriveInspectedPaths,
	determineBudgetAction,
	executeScoutGate,
	generateSessionId,
	loadScoutProfile,
	markHandoffReady,
	parseClaimedAnchors,
	parseScoutVerdict,
	planScoutDispatch,
	performGrillRespawn,
	persistScoutOutput,
	recordScoutGate,
	recordScoutResult,
	recordScoutGap,
	renderFinalHandoff,
	updateHandoff,
	renderRespawnStatusEvent,
	renderScoutRoomSummary,
	slugify,
	updateContextPressure,
	writeFinalHandoff,
	type AreaVerification,
	type InspectedPath,
	type ScoutGate,
	type ScoutProfile,
	type ScoutVerdict,
	type ScoutResultRecord,
	type ExecuteScoutGateInput,
	type ExecuteScoutGateResult,
	type SessionState,
	ARTIFACT_ROOT,
} from "../lib/grill-with-scouts-helpers.ts";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string) {
	if (condition) {
		passed++;
	} else {
		failed++;
		failures.push(message);
		console.error(`  FAIL: ${message}`);
	}
}

function assertEqual<T>(actual: T, expected: T, message: string) {
	if (actual === expected) {
		passed++;
	} else {
		failed++;
		const msg = `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
		failures.push(msg);
		console.error(`  FAIL: ${msg}`);
	}
}

function assertIncludes(actual: string, substring: string, message: string) {
	if (actual.includes(substring)) {
		passed++;
	} else {
		failed++;
		const msg = `${message}: expected "${actual}" to include "${substring}"`;
		failures.push(msg);
		console.error(`  FAIL: ${msg}`);
	}
}

// ---------------------------------------------------------------------------
// Setup: temp directory for artifact writes
// ---------------------------------------------------------------------------

const TEST_DIR = join(tmpdir(), `grill-scouts-test-${Date.now()}`);

function setup() {
	mkdirSync(TEST_DIR, { recursive: true });
}

function teardown() {
	rmSync(TEST_DIR, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Tests: slugify
// ---------------------------------------------------------------------------

console.log("\n--- slugify ---");

assertEqual(slugify("Build a CLI tool"), "build-a-cli-tool", "slugify basic sentence");
assertEqual(slugify("  Hello World!  "), "hello-world", "slugify with special chars and spaces");
assertEqual(slugify("UPPERCASE"), "uppercase", "slugify uppercase");
assertEqual(slugify("a".repeat(100)), "a".repeat(60), "slugify truncates to 60 chars");
assertEqual(slugify(""), "session", "slugify empty string fallback");
assertEqual(slugify("---!!!---"), "session", "slugify all-special fallback");

// ---------------------------------------------------------------------------
// Tests: generateSessionId
// ---------------------------------------------------------------------------

console.log("\n--- generateSessionId ---");

{
	const id = generateSessionId("Build a REST API");
	assert(id.length > 0, "session id is non-empty");
	// Format: YYYY-MM-DDTHHMMSS-<slug>
	assert(/^\d{4}-\d{2}-\d{2}T\d{6}-/.test(id), "session id starts with timestamp pattern");
	assertIncludes(id, "build-a-rest-api", "session id includes slugified goal");
}

{
	const id1 = generateSessionId("Goal A", new Date("2026-06-14T10:30:45Z"));
	const id2 = generateSessionId("Goal A", new Date("2026-06-14T10:30:45Z"));
	assertEqual(id1, id2, "same timestamp + goal => same id (deterministic)");
}

{
	const id1 = generateSessionId("Goal A", new Date("2026-06-14T10:30:45Z"));
	const id2 = generateSessionId("Goal B", new Date("2026-06-14T10:30:45Z"));
	assert(id1 !== id2, "different goals => different ids");
}

// ---------------------------------------------------------------------------
// Tests: createSession — creates full directory structure and files
// ---------------------------------------------------------------------------

console.log("\n--- createSession: creates artifacts ---");

setup();

{
	const result = createSession("Build a CLI tool", TEST_DIR);
	assert(result.created === true, "createSession returns created=true on first run");

	const sessionDir = join(TEST_DIR, ARTIFACT_ROOT, "sessions", result.state.id);

	// Directory structure
	assert(existsSync(sessionDir), "session directory exists");
	assert(existsSync(join(sessionDir, "checkpoints")), "checkpoints/ directory exists");
	assert(existsSync(join(sessionDir, "scouts")), "scouts/ directory exists");

	// session.json
	const sessionJsonPath = join(sessionDir, "session.json");
	assert(existsSync(sessionJsonPath), "session.json exists");
	const sessionJson: SessionState = JSON.parse(readFileSync(sessionJsonPath, "utf8"));
	assertEqual(sessionJson.goal, "Build a CLI tool", "session.json goal matches");
	assertEqual(sessionJson.currentTier, "discovery", "session.json initial tier is discovery");
	assertEqual(sessionJson.currentDecision, null, "session.json currentDecision is null");
	assert(Array.isArray(sessionJson.acceptedDecisions), "acceptedDecisions is array");
	assertEqual(sessionJson.acceptedDecisions.length, 0, "acceptedDecisions initially empty");
	assert(Array.isArray(sessionJson.scoutGates), "scoutGates is array");
	assert(Array.isArray(sessionJson.durableScoutFindings), "durableScoutFindings is array");
	assert(Array.isArray(sessionJson.scoutGaps), "scoutGaps is array");
	assertEqual(sessionJson.contextPressure, 0, "contextPressure starts at 0");
	assert(Array.isArray(sessionJson.checkpoints), "checkpoints is array");
	assertEqual(sessionJson.handoffReady, false, "handoffReady is false initially");

	// transcript.md
	const transcriptPath = join(sessionDir, "transcript.md");
	assert(existsSync(transcriptPath), "transcript.md exists");
	const transcript = readFileSync(transcriptPath, "utf8");
	assertIncludes(transcript, "# Grill With Scouts Transcript", "transcript.md has heading");
	assertIncludes(transcript, "Build a CLI tool", "transcript.md includes goal");

	// handoff.md
	const handoffPath = join(sessionDir, "handoff.md");
	assert(existsSync(handoffPath), "handoff.md exists");
	const handoff = readFileSync(handoffPath, "utf8");
	assertIncludes(handoff, "# Handoff", "handoff.md has heading");
	assertIncludes(handoff, "Build a CLI tool", "handoff.md includes goal");

	// latest-handoff.md
	const latestHandoffPath = join(TEST_DIR, ARTIFACT_ROOT, "latest-handoff.md");
	assert(existsSync(latestHandoffPath), "latest-handoff.md exists");
	const latestHandoff = readFileSync(latestHandoffPath, "utf8");
	assertIncludes(latestHandoff, "Build a CLI tool", "latest-handoff.md includes goal");
}

// ---------------------------------------------------------------------------
// Tests: createSession — idempotency (same session not overwritten)
// ---------------------------------------------------------------------------

console.log("\n--- createSession: idempotency ---");

{
	// Create initial session
	const fixedDate = new Date("2026-06-14T12:00:00Z");
	const result1 = createSession("Idempotency test", TEST_DIR, fixedDate);
	assert(result1.created === true, "first call creates session");

	// Modify the session.json to verify it won't be overwritten
	const sessionDir = join(TEST_DIR, ARTIFACT_ROOT, "sessions", result1.state.id);
	const sessionJsonPath = join(sessionDir, "session.json");
	const modified: SessionState = { ...result1.state, currentTier: "convergence" };
	writeFileSync(sessionJsonPath, JSON.stringify(modified, null, 2), "utf8");

	// Re-run with same goal and timestamp
	const result2 = createSession("Idempotency test", TEST_DIR, fixedDate);
	assert(result2.created === false, "second call returns created=false (idempotent)");

	// Verify data was NOT overwritten
	const reRead: SessionState = JSON.parse(readFileSync(sessionJsonPath, "utf8"));
	assertEqual(reRead.currentTier, "convergence", "existing session.json not overwritten");
}

// ---------------------------------------------------------------------------
// Tests: createSession — new session with different goal does create
// ---------------------------------------------------------------------------

console.log("\n--- createSession: different goals create separate sessions ---");

{
	const fixedDate = new Date("2026-06-14T13:00:00Z");
	const r1 = createSession("Goal Alpha", TEST_DIR, fixedDate);
	const r2 = createSession("Goal Beta", TEST_DIR, fixedDate);
	assert(r1.created === true, "Goal Alpha creates");
	assert(r2.created === true, "Goal Beta creates");
	assert(r1.state.id !== r2.state.id, "different goals have different session ids");
}

teardown();

// ---------------------------------------------------------------------------
// Tests: determineBudgetAction — maps risk level to budget action
// ---------------------------------------------------------------------------

console.log("\n--- determineBudgetAction ---");

assertEqual(determineBudgetAction("high"), "call-now", "high risk → call-now");
assertEqual(determineBudgetAction("medium"), "ask-human", "medium risk → ask-human");
assertEqual(determineBudgetAction("low"), "skip-with-reason", "low risk → skip-with-reason");

// ---------------------------------------------------------------------------
// Tests: planScoutDispatch scout need and selection
// ---------------------------------------------------------------------------

console.log("\n--- planScoutDispatch ---");

{
	const plan = planScoutDispatch({
		decision: "Explore how Pi JSON mode and extension loading should work before touching code",
		goal: "Explore Pi support for ralph-loop",
		currentTier: "discovery",
		crossesBoundary: true,
		changesContractOrState: true,
		introducesLifecycle: true,
		hasRuntimeRisk: true,
		hasUnverifiedLayerAssumption: true,
		hasMeaningfulFailureCost: true,
		budgetAction: "call-now",
		durableScoutFindings: [],
	});

	assertEqual(plan.selectedScoutProfiles.length, 1, "discovery exploration dispatches one scout");
	assertEqual(plan.selectedScoutProfiles[0], "runtime", "Pi CLI discovery uses runtime scout");
	assertEqual(plan.skipReason, undefined, "fresh discovery keeps call-now active");
}

{
	const plan = planScoutDispatch({
		decision: "Choose whether Pi extension loading should rely on normal discovery paths",
		goal: "Explore Pi support for ralph-loop",
		currentTier: "macro",
		crossesBoundary: true,
		changesContractOrState: true,
		introducesLifecycle: false,
		hasRuntimeRisk: true,
		hasUnverifiedLayerAssumption: false,
		hasMeaningfulFailureCost: true,
		budgetAction: "call-now",
		durableScoutFindings: [
			"runtime: viable — verified | evidence: Pi supports JSON mode, extension loading, normal discovery paths, and project trust behavior",
		],
	});

	assertEqual(plan.budgetAction, "skip-with-reason", "covered Pi facts change budget action to skip");
	assertEqual(plan.selectedScoutProfiles.length, 0, "covered Pi facts skip repeat scouts");
	assertIncludes(plan.skipReason ?? "", "prior scout findings", "skip reason cites prior findings");
}

{
	const plan = planScoutDispatch({
		decision: "Add a CLI-backed Pi AgentClient contract for ralph-loop",
		goal: "Explore Pi support for ralph-loop",
		currentTier: "macro",
		crossesBoundary: true,
		changesContractOrState: true,
		introducesLifecycle: false,
		hasRuntimeRisk: true,
		hasUnverifiedLayerAssumption: false,
		hasMeaningfulFailureCost: true,
		budgetAction: "call-now",
		durableScoutFindings: [],
	});

	assertEqual(plan.selectedScoutProfiles.length, 1, "CLI AgentClient contract dispatches one scout");
	assertEqual(plan.selectedScoutProfiles[0], "backend", "CLI AgentClient contract uses backend scout");
}

{
	const plan = planScoutDispatch({
		decision: "Decide ShellPiClient env var RALPH_PI_APPROVE and state shape for project trust",
		goal: "Explore Pi support for ralph-loop",
		currentTier: "macro",
		crossesBoundary: true,
		changesContractOrState: true,
		introducesLifecycle: false,
		hasRuntimeRisk: true,
		hasUnverifiedLayerAssumption: false,
		hasMeaningfulFailureCost: true,
		budgetAction: "call-now",
		durableScoutFindings: [],
	});

	assert(plan.selectedScoutProfiles.includes("backend"), "Pi config/env/state decision uses backend scout");
	assert(plan.selectedScoutProfiles.includes("runtime"), "Pi approval trust behavior also uses runtime scout");
	assertEqual(plan.selectedScoutProfiles.length, 2, "Pi approval trust decision keeps scout set capped");
}

{
	const plan = planScoutDispatch({
		decision: "Resolve MICRO-004 conflict and test plan for Pi subagent fan-out",
		goal: "Explore Pi support for ralph-loop",
		currentTier: "macro",
		crossesBoundary: true,
		changesContractOrState: true,
		introducesLifecycle: false,
		hasRuntimeRisk: true,
		hasUnverifiedLayerAssumption: false,
		hasMeaningfulFailureCost: true,
		budgetAction: "call-now",
		durableScoutFindings: [],
	});

	assertEqual(plan.selectedScoutProfiles.length, 1, "test plan or MICRO conflict dispatches one scout");
	assertEqual(plan.selectedScoutProfiles[0], "qa", "test plan or MICRO conflict uses QA scout");
}

{
	const plan = planScoutDispatch({
		decision: "Change the React page state contract for the settings screen",
		goal: "Plan a frontend settings update",
		currentTier: "macro",
		crossesBoundary: true,
		changesContractOrState: true,
		introducesLifecycle: false,
		hasRuntimeRisk: true,
		hasUnverifiedLayerAssumption: false,
		hasMeaningfulFailureCost: true,
		budgetAction: "call-now",
		durableScoutFindings: [],
	});

	assert(plan.selectedScoutProfiles.includes("frontend"), "frontend decisions keep frontend scout under cap");
	assert(plan.selectedScoutProfiles.length <= 2, "frontend high-risk decision still caps scout fan-out");
}

{
	const plan = planScoutDispatch({
		decision: "Change the React page state contract for the settings screen",
		goal: "Explore Pi support for ralph-loop CLI",
		currentTier: "macro",
		crossesBoundary: true,
		changesContractOrState: true,
		introducesLifecycle: false,
		hasRuntimeRisk: true,
		hasUnverifiedLayerAssumption: false,
		hasMeaningfulFailureCost: true,
		budgetAction: "call-now",
		durableScoutFindings: [],
	});

	assert(plan.selectedScoutProfiles.includes("frontend"), "UI evidence still routes frontend even when the repo goal mentions CLI");
}

{
	const plan = planScoutDispatch({
		decision: "This is unclear and might affect structure before we continue",
		goal: "Plan a structural feature change",
		currentTier: "macro",
		crossesBoundary: false,
		changesContractOrState: false,
		introducesLifecycle: false,
		hasRuntimeRisk: false,
		hasUnverifiedLayerAssumption: false,
		hasMeaningfulFailureCost: false,
		budgetAction: "skip-with-reason",
		durableScoutFindings: [],
	});

	assertEqual(plan.budgetAction, "call-now", "ambiguous verification need promotes skipped budget to scout dispatch");
	assertEqual(plan.selectedScoutProfiles.length, 1, "ambiguous verification need dispatches one scout");
	assertEqual(plan.selectedScoutProfiles[0], "backend", "ambiguous verification falls back to backend scout");
}

{
	const plan = planScoutDispatch({
		decision: "Accept the release plan for this migration",
		goal: "Plan a risky feature rollout",
		currentTier: "macro",
		crossesBoundary: false,
		changesContractOrState: false,
		introducesLifecycle: false,
		hasRuntimeRisk: false,
		hasUnverifiedLayerAssumption: false,
		hasMeaningfulFailureCost: true,
		budgetAction: "call-now",
		durableScoutFindings: [],
	});

	assertEqual(plan.selectedScoutProfiles.length, 1, "meaningful failure cost dispatches QA scout");
	assertEqual(plan.selectedScoutProfiles[0], "qa", "meaningful failure cost uses QA scout");
}

{
	const plan = planScoutDispatch({
		decision: "Use shorter labels in the planning handoff",
		goal: "Polish a low-risk planning reply",
		currentTier: "macro",
		crossesBoundary: false,
		changesContractOrState: false,
		introducesLifecycle: false,
		hasRuntimeRisk: false,
		hasUnverifiedLayerAssumption: false,
		hasMeaningfulFailureCost: false,
		budgetAction: "ask-human",
		durableScoutFindings: [],
	});

	assertEqual(plan.budgetAction, "skip-with-reason", "low-evidence decision skips scout even if caller did not pre-skip");
	assertEqual(plan.selectedScoutProfiles.length, 0, "low-evidence decision dispatches no scouts");
	assertIncludes(plan.skipReason ?? "", "No specialist verification", "skip reason explains no scout need");
}

// ---------------------------------------------------------------------------
// Tests: recordScoutGate — persists gate to session.json and transcript.md
// ---------------------------------------------------------------------------

console.log("\n--- recordScoutGate ---");

{
	const gateTestDir = join(tmpdir(), `grill-scouts-gate-test-${Date.now()}`);
	mkdirSync(gateTestDir, { recursive: true });

	// Create a fresh session to record a gate into
	const fixedDate = new Date("2026-06-14T15:00:00Z");
	const { state } = createSession("Gate persistence test", gateTestDir, fixedDate);

	const gate: ScoutGate = {
		id: "gate-001",
		tier: "macro",
		decisionUnderReview: "Should we use microservices?",
		crossesBoundary: true,
		changesContractOrState: true,
		introducesLifecycle: false,
		hasRuntimeRisk: true,
		hasUnverifiedLayerAssumption: false,
		hasMeaningfulFailureCost: true,
		riskLevel: "high",
		selectedScoutProfiles: ["architecture-scout", "cost-scout"],
		budgetAction: "call-now",
	};

	recordScoutGate(gate, gateTestDir, state.id);

	// Verify session.json has the gate
	const sessionDir = join(gateTestDir, ARTIFACT_ROOT, "sessions", state.id);
	const sessionJsonPath = join(sessionDir, "session.json");
	const updatedState: SessionState = JSON.parse(readFileSync(sessionJsonPath, "utf8"));

	assertEqual(updatedState.scoutGates.length, 1, "session.json scoutGates has one gate");
	assertEqual(updatedState.scoutGates[0].id, "gate-001", "gate id matches");
	assertEqual(updatedState.scoutGates[0].tier, "macro", "gate tier matches");
	assertEqual(updatedState.scoutGates[0].decisionUnderReview, "Should we use microservices?", "gate decision matches");
	assertEqual(updatedState.scoutGates[0].crossesBoundary, true, "gate crossesBoundary matches");
	assertEqual(updatedState.scoutGates[0].changesContractOrState, true, "gate changesContractOrState matches");
	assertEqual(updatedState.scoutGates[0].introducesLifecycle, false, "gate introducesLifecycle matches");
	assertEqual(updatedState.scoutGates[0].hasRuntimeRisk, true, "gate hasRuntimeRisk matches");
	assertEqual(updatedState.scoutGates[0].hasUnverifiedLayerAssumption, false, "gate hasUnverifiedLayerAssumption matches");
	assertEqual(updatedState.scoutGates[0].hasMeaningfulFailureCost, true, "gate hasMeaningfulFailureCost matches");
	assertEqual(updatedState.scoutGates[0].riskLevel, "high", "gate riskLevel matches");
	assertEqual(updatedState.scoutGates[0].budgetAction, "call-now", "gate budgetAction matches");
	assertEqual(updatedState.scoutGates[0].selectedScoutProfiles.length, 2, "gate has 2 scout profiles");
	assertEqual(updatedState.scoutGates[0].selectedScoutProfiles[0], "architecture-scout", "first scout profile");

	// Verify transcript.md has the gate appended
	const transcriptPath = join(sessionDir, "transcript.md");
	const transcript = readFileSync(transcriptPath, "utf8");
	assertIncludes(transcript, "## Scout Gate: gate-001", "transcript has gate heading");
	assertIncludes(transcript, "Should we use microservices?", "transcript has decision text");
	assertIncludes(transcript, "**Tier**: macro", "transcript has tier");
	assertIncludes(transcript, "**Risk Level**: high", "transcript has risk level");
	assertIncludes(transcript, "**Budget Action**: call-now", "transcript has budget action");
	assertIncludes(transcript, "crossesBoundary: true", "transcript has trigger field");

	// Record a second gate to verify append (not overwrite)
	const gate2: ScoutGate = {
		id: "gate-002",
		tier: "meso",
		decisionUnderReview: "Use Redis for caching?",
		crossesBoundary: false,
		changesContractOrState: false,
		introducesLifecycle: true,
		hasRuntimeRisk: false,
		hasUnverifiedLayerAssumption: true,
		hasMeaningfulFailureCost: false,
		riskLevel: "medium",
		selectedScoutProfiles: ["infra-scout"],
		budgetAction: "ask-human",
	};

	recordScoutGate(gate2, gateTestDir, state.id);

	const updatedState2: SessionState = JSON.parse(readFileSync(sessionJsonPath, "utf8"));
	assertEqual(updatedState2.scoutGates.length, 2, "session.json has two gates after second record");
	assertEqual(updatedState2.scoutGates[1].id, "gate-002", "second gate id matches");

	const transcript2 = readFileSync(transcriptPath, "utf8");
	assertIncludes(transcript2, "## Scout Gate: gate-002", "transcript has second gate heading");
	assertIncludes(transcript2, "Use Redis for caching?", "transcript has second decision");

	// Test low risk gate with skipReason
	const gate3: ScoutGate = {
		id: "gate-003",
		tier: "micro",
		decisionUnderReview: "Rename a local variable",
		crossesBoundary: false,
		changesContractOrState: false,
		introducesLifecycle: false,
		hasRuntimeRisk: false,
		hasUnverifiedLayerAssumption: false,
		hasMeaningfulFailureCost: false,
		riskLevel: "low",
		selectedScoutProfiles: [],
		budgetAction: "skip-with-reason",
		skipReason: "No triggers fired; purely cosmetic change",
	};

	recordScoutGate(gate3, gateTestDir, state.id);

	const updatedState3: SessionState = JSON.parse(readFileSync(sessionJsonPath, "utf8"));
	assertEqual(updatedState3.scoutGates.length, 3, "session.json has three gates");
	assertEqual(updatedState3.scoutGates[2].skipReason, "No triggers fired; purely cosmetic change", "skipReason persisted");

	const transcript3 = readFileSync(transcriptPath, "utf8");
	assertIncludes(transcript3, "**Skip Reason**: No triggers fired; purely cosmetic change", "transcript has skip reason");

	rmSync(gateTestDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Tests: renderScoutRoomSummary — compact mode, no gates
// ---------------------------------------------------------------------------

console.log("\n--- renderScoutRoomSummary: compact, no gates ---");

{
	const state: SessionState = {
		id: "2026-06-14T150000-test-session",
		goal: "Test session",
		currentTier: "discovery",
		currentDecision: null,
		acceptedDecisions: [],
		scoutGates: [],
		durableScoutFindings: [],
		scoutGaps: [],
		contextPressure: 0,
		checkpoints: [],
		handoffReady: false,
		createdAt: "2026-06-14T15:00:00.000Z",
		nextQuestion: null,
		userAcceptedAssumptions: [],
		glossaryDeltas: [],
		adrCandidates: [],
		contractArtifacts: [],
	};

	const summary = renderScoutRoomSummary(state, { expanded: false });

	assertIncludes(summary, "scout:backend", "compact no-gates: shows backend scout box");
	assertIncludes(summary, "scout:frontend", "compact no-gates: shows frontend scout box");
	assertIncludes(summary, "scout:qa", "compact no-gates: shows qa scout box");
	assertIncludes(summary, "scout:runtime", "compact no-gates: shows runtime scout box");
	assert(summary.split("\n")[0].includes("scout:backend") && summary.split("\n")[0].includes("scout:frontend"), "compact no-gates: renders scout boxes inline");
	assert(!summary.includes("Tier:"), "compact no-gates: hides tier metadata");
	assert(!summary.includes("Decision:"), "compact no-gates: hides decision metadata");
	assert(!summary.includes("Context Pressure"), "compact no-gates: hides context pressure metadata");
	assert(!summary.includes("Handoff Ready"), "compact no-gates: hides handoff metadata");
}

// ---------------------------------------------------------------------------
// Tests: renderScoutRoomSummary — compact mode, with active gate
// ---------------------------------------------------------------------------

console.log("\n--- renderScoutRoomSummary: compact, with gate ---");

{
	const gate: ScoutGate = {
		id: "gate-active",
		tier: "macro",
		decisionUnderReview: "Adopt event sourcing",
		crossesBoundary: true,
		changesContractOrState: true,
		introducesLifecycle: true,
		hasRuntimeRisk: true,
		hasUnverifiedLayerAssumption: false,
		hasMeaningfulFailureCost: true,
		riskLevel: "high",
		selectedScoutProfiles: ["architecture-scout", "data-scout"],
		budgetAction: "call-now",
	};

	const state: SessionState = {
		id: "2026-06-14T150000-event-sourcing",
		goal: "Event sourcing review",
		currentTier: "macro",
		currentDecision: "Adopt event sourcing",
		acceptedDecisions: [],
		scoutGates: [gate],
		durableScoutFindings: [],
		scoutGaps: [],
		contextPressure: 42,
		checkpoints: [],
		handoffReady: false,
		createdAt: "2026-06-14T15:00:00.000Z",
		nextQuestion: null,
		userAcceptedAssumptions: [],
		glossaryDeltas: [],
		adrCandidates: [],
		contractArtifacts: [],
	};

	const summary = renderScoutRoomSummary(state, { expanded: false });

	assertIncludes(summary, "scout:architecture-scout", "compact with-gate: shows selected scout box");
	assertIncludes(summary, "scout:data-scout", "compact with-gate: shows second selected scout box");
	assertIncludes(summary, "pending spawn", "compact with-gate: shows selected scouts are pending spawn");
	assert(!summary.includes("Tier:"), "compact with-gate: hides tier metadata");
	assert(!summary.includes("Adopt event sourcing"), "compact with-gate: hides current decision");
	assert(!summary.includes("gate-active"), "compact with-gate: hides active gate id");
	assert(!summary.includes("Context Pressure"), "compact with-gate: hides context pressure metadata");
	assert(!summary.includes("Handoff Ready"), "compact with-gate: hides handoff metadata");
	assert(!summary.includes("crossesBoundary"), "compact with-gate: hides trigger fields");
}

// ---------------------------------------------------------------------------
// Tests: renderScoutRoomSummary — expanded mode
// ---------------------------------------------------------------------------

console.log("\n--- renderScoutRoomSummary: expanded ---");

{
	const gate: ScoutGate = {
		id: "gate-exp",
		tier: "meso",
		decisionUnderReview: "Switch to PostgreSQL",
		crossesBoundary: true,
		changesContractOrState: false,
		introducesLifecycle: true,
		hasRuntimeRisk: false,
		hasUnverifiedLayerAssumption: true,
		hasMeaningfulFailureCost: false,
		riskLevel: "medium",
		selectedScoutProfiles: ["infra-scout"],
		budgetAction: "ask-human",
	};

	const state: SessionState = {
		id: "2026-06-14T160000-pg-switch",
		goal: "PostgreSQL migration",
		currentTier: "meso",
		currentDecision: "Switch to PostgreSQL",
		acceptedDecisions: ["Use managed DB"],
		scoutGates: [gate],
		durableScoutFindings: [],
		scoutGaps: [],
		contextPressure: 65,
		checkpoints: [],
		handoffReady: true,
		createdAt: "2026-06-14T16:00:00.000Z",
		nextQuestion: "What indexing strategy?",
		userAcceptedAssumptions: ["Single region deployment is acceptable"],
		glossaryDeltas: ["CQRS: Command Query Responsibility Segregation"],
		adrCandidates: ["ADR-001: Use PostgreSQL over MySQL"],
		contractArtifacts: ["api/v1/schema.json"],
	};

	const expanded = renderScoutRoomSummary(state, { expanded: true });

	assertIncludes(expanded, "scout:infra-scout", "expanded: shows selected scout box");
	assertIncludes(expanded, "pending spawn", "expanded: shows selected scout is pending spawn");
	assert(!expanded.includes("Tier:"), "expanded: hides tier metadata");
	assert(!expanded.includes("Switch to PostgreSQL"), "expanded: hides decision metadata");
	assert(!expanded.includes("gate-exp"), "expanded: hides gate id");
	assert(!expanded.includes("Context Pressure"), "expanded: hides context pressure metadata");
	assert(!expanded.includes("Handoff Ready"), "expanded: hides handoff metadata");
	assert(!expanded.includes("crossesBoundary"), "expanded: hides trigger fields");
	assert(!expanded.includes("Budget Action"), "expanded: hides budget action");
}

// ---------------------------------------------------------------------------
// Tests: updateContextPressure
// ---------------------------------------------------------------------------

console.log("\n--- updateContextPressure ---");

{
	const state: SessionState = {
		id: "2026-06-14T170000-pressure-test",
		goal: "Context pressure test",
		currentTier: "discovery",
		currentDecision: null,
		acceptedDecisions: [],
		scoutGates: [],
		durableScoutFindings: [],
		scoutGaps: [],
		contextPressure: 0,
		checkpoints: [],
		handoffReady: false,
		createdAt: "2026-06-14T17:00:00.000Z",
		nextQuestion: null,
		userAcceptedAssumptions: [],
		glossaryDeltas: [],
		adrCandidates: [],
		contractArtifacts: [],
	};

	const updated = updateContextPressure(state, 42);
	assertEqual(updated.contextPressure, 42, "updateContextPressure sets percent");
	// Returns the same object reference (mutates in place)
	assert(updated === state, "updateContextPressure returns same state reference");

	// Clamp to 0-100
	const updated2 = updateContextPressure(state, 110);
	assertEqual(updated2.contextPressure, 100, "updateContextPressure clamps to max 100");

	const updated3 = updateContextPressure(state, -5);
	assertEqual(updated3.contextPressure, 0, "updateContextPressure clamps to min 0");
}

// ---------------------------------------------------------------------------
// Tests: createCheckpoint — writes checkpoint files with required content
// ---------------------------------------------------------------------------

console.log("\n--- createCheckpoint ---");

{
	const cpTestDir = join(tmpdir(), `grill-scouts-cp-test-${Date.now()}`);
	mkdirSync(cpTestDir, { recursive: true });

	// Create session first (sets up directory tree)
	const fixedDate = new Date("2026-06-14T18:00:00Z");
	const { state } = createSession("Checkpoint persistence test", cpTestDir, fixedDate);

	// Populate state with data that should appear in checkpoint
	state.currentTier = "macro";
	state.acceptedDecisions = ["Use event sourcing", "Deploy to AWS"];
	state.userAcceptedAssumptions = ["Team has AWS experience"];
	state.durableScoutFindings = ["Event sourcing adds complexity"];
	state.scoutGaps = ["Need cost estimate for DynamoDB streams"];
	state.glossaryDeltas = ["ES: Event Sourcing"];
	state.adrCandidates = ["ADR-001: Choose event sourcing"];
	state.contractArtifacts = ["scouts/architecture-scout-001.md"];
	state.nextQuestion = "How will we handle event replay?";
	state.contextPressure = 65;

	// Create first checkpoint
	const result = createCheckpoint(state, cpTestDir, state.id);

	// Verify state.checkpoints is updated
	assertEqual(result.checkpoints.length, 1, "checkpoints array has one entry after first checkpoint");
	assertIncludes(result.checkpoints[0], "checkpoints/1.md", "first checkpoint path contains checkpoints/1.md");

	// Verify checkpoints/1.md exists and has content
	const sessionDir = join(cpTestDir, ARTIFACT_ROOT, "sessions", state.id);
	const cp1Path = join(sessionDir, "checkpoints", "1.md");
	assert(existsSync(cp1Path), "checkpoints/1.md exists");

	const cp1Content = readFileSync(cp1Path, "utf8");
	assertIncludes(cp1Content, "Checkpoint persistence test", "checkpoint 1 includes goal");
	assertIncludes(cp1Content, "macro", "checkpoint 1 includes current tier");
	assertIncludes(cp1Content, "Use event sourcing", "checkpoint 1 includes accepted decision");
	assertIncludes(cp1Content, "Deploy to AWS", "checkpoint 1 includes second accepted decision");
	assertIncludes(cp1Content, "Team has AWS experience", "checkpoint 1 includes user-accepted assumption");
	assertIncludes(cp1Content, "Event sourcing adds complexity", "checkpoint 1 includes durable scout finding");
	assertIncludes(cp1Content, "Need cost estimate for DynamoDB streams", "checkpoint 1 includes scout gap");
	assertIncludes(cp1Content, "ES: Event Sourcing", "checkpoint 1 includes glossary delta");
	assertIncludes(cp1Content, "ADR-001: Choose event sourcing", "checkpoint 1 includes ADR candidate");
	assertIncludes(cp1Content, "scouts/architecture-scout-001.md", "checkpoint 1 includes contract artifact reference");
	assertIncludes(cp1Content, "How will we handle event replay?", "checkpoint 1 includes next question");

	// Verify checkpoints/latest.md exists and matches checkpoint 1
	const latestPath = join(sessionDir, "checkpoints", "latest.md");
	assert(existsSync(latestPath), "checkpoints/latest.md exists");
	const latestContent = readFileSync(latestPath, "utf8");
	assertEqual(latestContent, cp1Content, "latest.md matches checkpoint 1 content");

	// Create a second checkpoint with updated state
	state.acceptedDecisions.push("Use CQRS pattern");
	state.nextQuestion = "What read model technology?";

	const result2 = createCheckpoint(state, cpTestDir, state.id);
	assertEqual(result2.checkpoints.length, 2, "checkpoints array has two entries after second checkpoint");
	assertIncludes(result2.checkpoints[1], "checkpoints/2.md", "second checkpoint path contains checkpoints/2.md");

	const cp2Path = join(sessionDir, "checkpoints", "2.md");
	assert(existsSync(cp2Path), "checkpoints/2.md exists");

	const cp2Content = readFileSync(cp2Path, "utf8");
	assertIncludes(cp2Content, "Use CQRS pattern", "checkpoint 2 includes new decision");
	assertIncludes(cp2Content, "What read model technology?", "checkpoint 2 includes updated next question");

	// latest.md should now point to checkpoint 2 content
	const latestContent2 = readFileSync(latestPath, "utf8");
	assertEqual(latestContent2, cp2Content, "latest.md updated to checkpoint 2 content");

	// session.json on disk should also be updated with checkpoints
	const sessionJsonPath = join(sessionDir, "session.json");
	const diskState: SessionState = JSON.parse(readFileSync(sessionJsonPath, "utf8"));
	assertEqual(diskState.checkpoints.length, 2, "session.json checkpoints array updated on disk");

	rmSync(cpTestDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Tests: compactDecisionLedger — produces minimal summary from state
// ---------------------------------------------------------------------------

console.log("\n--- compactDecisionLedger ---");

{
	const state: SessionState = {
		id: "2026-06-14T190000-ledger-test",
		goal: "Ledger compaction test",
		currentTier: "meso",
		currentDecision: "Add caching layer",
		acceptedDecisions: ["Use microservices", "Deploy to K8s"],
		scoutGates: [],
		durableScoutFindings: ["K8s adds operational overhead"],
		scoutGaps: ["Missing cost analysis"],
		contextPressure: 55,
		checkpoints: [],
		handoffReady: false,
		createdAt: "2026-06-14T19:00:00.000Z",
		nextQuestion: "What caching strategy?",
		userAcceptedAssumptions: ["Team knows K8s"],
		glossaryDeltas: ["K8s: Kubernetes"],
		adrCandidates: ["ADR-002: Use Redis"],
		contractArtifacts: ["scouts/infra-001.md"],
	};

	const ledger = compactDecisionLedger(state);

	// Should be a string
	assert(typeof ledger === "string", "compactDecisionLedger returns a string");
	assert(ledger.length > 0, "compactDecisionLedger is non-empty");

	// Must include goal, tier, decisions, next question
	assertIncludes(ledger, "Ledger compaction test", "ledger includes goal");
	assertIncludes(ledger, "meso", "ledger includes current tier");
	assertIncludes(ledger, "Use microservices", "ledger includes accepted decision 1");
	assertIncludes(ledger, "Deploy to K8s", "ledger includes accepted decision 2");
	assertIncludes(ledger, "What caching strategy?", "ledger includes next question");
	assertIncludes(ledger, "K8s adds operational overhead", "ledger includes durable finding");
	assertIncludes(ledger, "Missing cost analysis", "ledger includes scout gap");

	// Should be compact — no full markdown headings (uses short format)
	assert(!ledger.includes("# "), "ledger has no H1 headings (compact format)");
}

// ---------------------------------------------------------------------------
// Tests: performGrillRespawn — resets state from latest checkpoint
// ---------------------------------------------------------------------------

console.log("\n--- performGrillRespawn ---");

{
	const respawnTestDir = join(tmpdir(), `grill-scouts-respawn-test-${Date.now()}`);
	mkdirSync(respawnTestDir, { recursive: true });

	// Create session and populate state
	const fixedDate = new Date("2026-06-14T20:00:00Z");
	const { state } = createSession("Respawn test", respawnTestDir, fixedDate);

	state.currentTier = "meso";
	state.acceptedDecisions = ["Decision A", "Decision B"];
	state.userAcceptedAssumptions = ["Assumption X"];
	state.durableScoutFindings = ["Finding 1"];
	state.scoutGaps = ["Gap 1"];
	state.glossaryDeltas = ["Term: Definition"];
	state.adrCandidates = ["ADR-001"];
	state.contractArtifacts = ["scouts/scout-001.md"];
	state.nextQuestion = "What about scaling?";
	state.contextPressure = 80;

	// Create a checkpoint first (required for respawn)
	createCheckpoint(state, respawnTestDir, state.id);

	// Perform respawn
	const respawned = performGrillRespawn(state, respawnTestDir, state.id);

	// AC-8: Preserves currentTier and nextQuestion
	assertEqual(respawned.currentTier, "meso", "respawn preserves currentTier");
	assertEqual(respawned.nextQuestion, "What about scaling?", "respawn preserves nextQuestion");

	// Preserves identity and goal
	assertEqual(respawned.id, state.id, "respawn preserves session id");
	assertEqual(respawned.goal, "Respawn test", "respawn preserves goal");

	// Preserves accumulated knowledge
	assertEqual(respawned.acceptedDecisions.length, 2, "respawn preserves accepted decisions");
	assertEqual(respawned.durableScoutFindings.length, 1, "respawn preserves durable scout findings");
	assertEqual(respawned.scoutGaps.length, 1, "respawn preserves scout gaps");
	assertEqual(respawned.userAcceptedAssumptions.length, 1, "respawn preserves user-accepted assumptions");

	// Resets context pressure (fresh session)
	assertEqual(respawned.contextPressure, 0, "respawn resets context pressure to 0");

	// Checkpoints carry over (knows about prior checkpoints)
	assert(respawned.checkpoints.length >= 1, "respawn state still references prior checkpoints");

	// Has a respawnCount or respawnEvents field to track respawns
	assert(respawned.respawnCount === 1, "respawn increments respawnCount");

	rmSync(respawnTestDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Tests: renderRespawnStatusEvent — compact event string
// ---------------------------------------------------------------------------

console.log("\n--- renderRespawnStatusEvent ---");

{
	const state: SessionState = {
		id: "2026-06-14T200000-respawn-event-test",
		goal: "Respawn event display",
		currentTier: "meso",
		currentDecision: null,
		acceptedDecisions: ["D1", "D2"],
		scoutGates: [],
		durableScoutFindings: [],
		scoutGaps: [],
		contextPressure: 5,
		checkpoints: ["checkpoints/1.md"],
		handoffReady: false,
		createdAt: "2026-06-14T20:00:00.000Z",
		nextQuestion: "What about deployment?",
		userAcceptedAssumptions: [],
		glossaryDeltas: [],
		adrCandidates: [],
		contractArtifacts: [],
		respawnCount: 1,
	};

	const event = renderRespawnStatusEvent(state);

	assert(typeof event === "string", "renderRespawnStatusEvent returns a string");
	assert(event.length > 0, "renderRespawnStatusEvent is non-empty");

	// Must mention key facts compactly
	assertIncludes(event, "checkpoint", "respawn event mentions checkpoint");
	assertIncludes(event, "meso", "respawn event mentions preserved tier");
	assertIncludes(event, "What about deployment?", "respawn event mentions next question");
	// Should mention it's a respawn/continuation
	assert(event.includes("respawn") || event.includes("Respawn") || event.includes("continued"), "respawn event mentions respawn or continuation");
}

// ---------------------------------------------------------------------------
// Tests: renderScoutRoomSummary — shows respawn event compactly, checkpoint expandable
// ---------------------------------------------------------------------------

console.log("\n--- renderScoutRoomSummary: respawn events ---");

{
	const state: SessionState = {
		id: "2026-06-14T210000-respawn-display",
		goal: "Respawn display test",
		currentTier: "meso",
		currentDecision: null,
		acceptedDecisions: ["Dec1"],
		scoutGates: [],
		durableScoutFindings: [],
		scoutGaps: [],
		contextPressure: 10,
		checkpoints: ["checkpoints/1.md"],
		handoffReady: false,
		createdAt: "2026-06-14T21:00:00.000Z",
		nextQuestion: "Next Q",
		userAcceptedAssumptions: [],
		glossaryDeltas: [],
		adrCandidates: [],
		contractArtifacts: [],
		respawnCount: 1,
	};

	const compact = renderScoutRoomSummary(state, { expanded: false });
	assertIncludes(compact, "scout:backend", "compact respawn state still shows scout boxes");
	assert(!compact.includes("Respawn"), "compact mode hides respawn metadata");
	assert(!compact.includes("checkpoints/1.md"), "compact mode hides checkpoint metadata");

	const expanded = renderScoutRoomSummary(state, { expanded: true });
	assertIncludes(expanded, "scout:backend", "expanded respawn state still shows scout boxes");
	assert(!expanded.includes("Respawn"), "expanded mode hides respawn metadata");
	assert(!expanded.includes("checkpoints/1.md"), "expanded mode hides checkpoint metadata");
}

// ---------------------------------------------------------------------------
// Tests: parseScoutVerdict — extracts structured verdict from raw output
// ---------------------------------------------------------------------------

console.log("\n--- parseScoutVerdict ---");

{
	// Valid complete verdict
	const rawValid = [
		"Some preamble text the scout wrote.",
		"",
		"Verdict: viable",
		"Evidence: src/api/routes.ts:15-30, src/db/schema.sql:1-20",
		"Concern: none",
		"Required decision: none",
		"Claimed anchors: UserService, AuthMiddleware, db.users",
		"Confidence: verified",
	].join("\n");

	const v1 = parseScoutVerdict(rawValid);
	assert(v1 !== null, "parseScoutVerdict returns non-null for valid input");
	if (v1) {
		assertEqual(v1.verdict, "viable", "parses verdict field");
		assertEqual(v1.evidence, "src/api/routes.ts:15-30, src/db/schema.sql:1-20", "parses evidence field");
		assertEqual(v1.concern, "none", "parses concern field");
		assertEqual(v1.requiredDecision, "none", "parses requiredDecision field");
		assertEqual(v1.claimedAnchors, "UserService, AuthMiddleware, db.users", "parses claimedAnchors field");
		assertEqual(v1.confidence, "verified", "parses confidence field");
	}
}

{
	// Valid verdict with risky status
	const rawRisky = [
		"Verdict: risky",
		"Evidence: not found",
		"Concern: No error handling in payment flow",
		"Required decision: Should we add retry logic to payment gateway calls?",
		"Claimed anchors: PaymentGateway.charge()",
		"Confidence: partial",
	].join("\n");

	const v2 = parseScoutVerdict(rawRisky);
	assert(v2 !== null, "parseScoutVerdict handles risky verdict");
	if (v2) {
		assertEqual(v2.verdict, "risky", "parses risky verdict");
		assertEqual(v2.evidence, "not found", "parses 'not found' evidence");
		assertIncludes(v2.concern, "No error handling", "parses concern text");
		assertIncludes(v2.requiredDecision, "retry logic", "parses required decision text");
		assertEqual(v2.confidence, "partial", "parses partial confidence");
	}
}

{
	// Valid verdict: blocked
	const rawBlocked = [
		"Verdict: blocked",
		"Evidence: package.json shows no test framework configured",
		"Concern: Cannot verify test coverage claims",
		"Required decision: Which test framework should we adopt?",
		"Claimed anchors: none",
		"Confidence: unverified",
	].join("\n");

	const v3 = parseScoutVerdict(rawBlocked);
	assert(v3 !== null, "parseScoutVerdict handles blocked verdict");
	if (v3) {
		assertEqual(v3.verdict, "blocked", "parses blocked verdict");
		assertEqual(v3.confidence, "unverified", "parses unverified confidence");
	}
}

{
	// Valid verdict: needs-decision
	const rawNeedsDecision = [
		"Verdict: needs-decision",
		"Evidence: src/config.ts:5 has hardcoded values",
		"Concern: Configuration approach not decided",
		"Required decision: Should config come from env vars or a config file?",
		"Claimed anchors: AppConfig",
		"Confidence: verified",
	].join("\n");

	const v4 = parseScoutVerdict(rawNeedsDecision);
	assert(v4 !== null, "parseScoutVerdict handles needs-decision verdict");
	if (v4) {
		assertEqual(v4.verdict, "needs-decision", "parses needs-decision verdict");
	}
}

{
	// Invalid: missing verdict line entirely
	const rawInvalid = "This is just random text with no structured verdict.";
	const v5 = parseScoutVerdict(rawInvalid);
	assertEqual(v5, null, "parseScoutVerdict returns null for missing verdict");
}

{
	// Invalid: has Verdict but missing required fields
	const rawPartial = [
		"Verdict: viable",
		"Evidence: some file",
		// missing Concern, Required decision, Claimed anchors, Confidence
	].join("\n");
	const v6 = parseScoutVerdict(rawPartial);
	assertEqual(v6, null, "parseScoutVerdict returns null when required fields missing");
}

{
	// Invalid: unknown verdict value
	const rawBadVerdict = [
		"Verdict: excellent",
		"Evidence: something",
		"Concern: none",
		"Required decision: none",
		"Claimed anchors: none",
		"Confidence: verified",
	].join("\n");
	const v7 = parseScoutVerdict(rawBadVerdict);
	assertEqual(v7, null, "parseScoutVerdict returns null for invalid verdict value");
}

{
	// Invalid: unknown confidence value
	const rawBadConf = [
		"Verdict: viable",
		"Evidence: something",
		"Concern: none",
		"Required decision: none",
		"Claimed anchors: none",
		"Confidence: maybe",
	].join("\n");
	const v8 = parseScoutVerdict(rawBadConf);
	assertEqual(v8, null, "parseScoutVerdict returns null for invalid confidence value");
}

// ---------------------------------------------------------------------------
// Tests: ScoutProfile type and loadScoutProfile
// ---------------------------------------------------------------------------

console.log("\n--- loadScoutProfile ---");

{
	// loadScoutProfile should return a ScoutProfile or undefined
	// Test with a known profile name that exists in the Engineering Skills MCP repo
	const backendProfile = loadScoutProfile("backend");

	if (backendProfile) {
		assertEqual(backendProfile.name, "backend", "backend profile has correct name");
		assert(backendProfile.description.length > 0, "backend profile has description");
		assert(backendProfile.scope.length > 0, "backend profile has scope");
		assert(backendProfile.triggerFit.length > 0, "backend profile has triggerFit");
		assert(backendProfile.evidenceRequirements.length > 0, "backend profile has evidenceRequirements");
		assert(backendProfile.verdictFormat.length > 0, "backend profile has verdictFormat");
		assert(backendProfile.forbiddenBehaviors.length > 0, "backend profile has forbiddenBehaviors");
		assert(backendProfile.body.length > 0, "backend profile has body");
	} else {
		// If the engineering-skills MCP is not configured, it returns undefined
		// This is acceptable — the function should not crash
		console.log("  (backend profile not found — engineering-skills MCP may not be configured)");
		passed++; // acceptable outcome
	}
}

{
	// Test loading all four expected profiles
	const profileNames = ["backend", "frontend", "qa", "runtime"];
	for (const name of profileNames) {
		const profile = loadScoutProfile(name);
		if (profile) {
			assertEqual(profile.name, name, `${name} profile has correct name`);
		} else {
			console.log(`  (${name} profile not found — engineering-skills MCP may not be configured)`);
			passed++; // acceptable
		}
	}
}

{
	// Test with non-existent profile — should return undefined, not crash
	const nonExistent = loadScoutProfile("nonexistent-scout-xyz");
	assertEqual(nonExistent, undefined, "loadScoutProfile returns undefined for non-existent profile");
}

{
	// Test caching: calling twice with same name should return same data
	const p1 = loadScoutProfile("backend");
	const p2 = loadScoutProfile("backend");
	if (p1 && p2) {
		assertEqual(p1.name, p2.name, "cached profile returns same name");
		assertEqual(p1.body, p2.body, "cached profile returns same body");
	} else {
		passed += 2; // acceptable if MCP not configured
	}
}

// ---------------------------------------------------------------------------
// Tests: ScoutVerdict type structure
// ---------------------------------------------------------------------------

console.log("\n--- ScoutVerdict type ---");

{
	// Verify the type has the right shape (compile-time check + runtime confirmation)
	const verdict: ScoutVerdict = {
		verdict: "viable",
		evidence: "file.ts:10",
		concern: "none",
		requiredDecision: "none",
		claimedAnchors: "none",
		confidence: "verified",
	};
	assert(verdict.verdict === "viable", "ScoutVerdict type accepts viable");
	assert(verdict.confidence === "verified", "ScoutVerdict type accepts verified confidence");
}

{
	// Verify ScoutProfile type
	const profile: ScoutProfile = {
		name: "test",
		description: "A test profile",
		scope: "test scope",
		triggerFit: "when testing",
		evidenceRequirements: "file paths",
		verdictFormat: "area: <name> | status: <s>",
		forbiddenBehaviors: "none",
		body: "# Test",
	};
	assertEqual(profile.name, "test", "ScoutProfile type has name field");
	assert(typeof profile.body === "string", "ScoutProfile type has string body");
}

// ---------------------------------------------------------------------------
// Tests: buildScoutPrompt — assembles compact prompt from profile + gate context
// ---------------------------------------------------------------------------

console.log("\n--- buildScoutPrompt ---");

{
	const profile: ScoutProfile = {
		name: "backend",
		description: "Backend systems scout",
		scope: "API contracts, route handlers, middleware",
		triggerFit: "When the project involves server-side logic",
		evidenceRequirements: "File paths with line ranges, function signatures",
		verdictFormat: "area: <name> | status: path-verified | anchor-claimed",
		forbiddenBehaviors: "Do not modify source code.",
		body: "# Backend Scout\n\nInvestigate server-side architecture.",
	};

	const checkpointContent = "# Grill Checkpoint 1\n\n**Goal**: Build REST API\n**Current Tier**: macro";
	const decision = "Should we use Express or Fastify?";
	const anchors = ["UserService", "AuthMiddleware", "db.users"];

	const prompt = buildScoutPrompt({
		profile,
		checkpointContent,
		decision,
		anchors,
	});

	// Must include the profile scope
	assertIncludes(prompt, "API contracts, route handlers, middleware", "prompt includes profile scope");

	// Must include decision under review
	assertIncludes(prompt, "Should we use Express or Fastify?", "prompt includes decision");

	// Must include checkpoint content
	assertIncludes(prompt, "Build REST API", "prompt includes checkpoint goal");

	// Must include anchors
	assertIncludes(prompt, "UserService", "prompt includes anchor 1");
	assertIncludes(prompt, "AuthMiddleware", "prompt includes anchor 2");
	assertIncludes(prompt, "db.users", "prompt includes anchor 3");

	// Must include the required verdict format
	assertIncludes(prompt, "Verdict:", "prompt includes verdict format header");
	assertIncludes(prompt, "viable", "prompt includes viable option");
	assertIncludes(prompt, "risky", "prompt includes risky option");
	assertIncludes(prompt, "blocked", "prompt includes blocked option");
	assertIncludes(prompt, "needs-decision", "prompt includes needs-decision option");
	assertIncludes(prompt, "Evidence:", "prompt includes Evidence field");
	assertIncludes(prompt, "Concern:", "prompt includes Concern field");
	assertIncludes(prompt, "Required decision:", "prompt includes Required decision field");
	assertIncludes(prompt, "Claimed anchors:", "prompt includes Claimed anchors field");
	assertIncludes(prompt, "Confidence:", "prompt includes Confidence field");

	// Must include profile body (investigation protocol)
	assertIncludes(prompt, "Backend Scout", "prompt includes profile body heading");
	assertIncludes(prompt, "Investigate server-side architecture", "prompt includes profile instructions");

	// Must include forbidden behaviors
	assertIncludes(prompt, "Do not modify source code", "prompt includes forbidden behaviors");

	// Must NOT be excessively large (compact prompt)
	assert(prompt.length < 3000, "prompt is compact (under 3000 chars for this input)");
}

{
	// With empty anchors
	const profile: ScoutProfile = {
		name: "qa",
		description: "QA scout",
		scope: "Test coverage, test patterns",
		triggerFit: "When testing is involved",
		evidenceRequirements: "Test file paths",
		verdictFormat: "coverage: <percent>",
		forbiddenBehaviors: "none",
		body: "# QA Scout",
	};

	const prompt = buildScoutPrompt({
		profile,
		checkpointContent: "# Checkpoint",
		decision: "Add unit tests?",
		anchors: [],
	});

	assertIncludes(prompt, "Add unit tests?", "empty-anchors prompt includes decision");
	assertIncludes(prompt, "Test coverage, test patterns", "empty-anchors prompt includes scope");
	// Should handle empty anchors gracefully (no crash, mentions none or omits)
	assert(typeof prompt === "string" && prompt.length > 0, "empty-anchors prompt is valid non-empty string");
}

// ---------------------------------------------------------------------------
// Tests: persistScoutOutput — writes scout output to file
// ---------------------------------------------------------------------------

console.log("\n--- persistScoutOutput ---");

{
	const psTestDir = join(tmpdir(), `grill-scouts-persist-test-${Date.now()}`);
	mkdirSync(psTestDir, { recursive: true });

	// Create a session first (sets up directory tree including scouts/)
	const fixedDate = new Date("2026-06-14T22:00:00Z");
	const { state } = createSession("Scout output persist test", psTestDir, fixedDate);

	const scoutOutput = [
		"## Backend Scout Investigation",
		"",
		"Traced entry points in src/api/routes.ts",
		"",
		"Verdict: viable",
		"Evidence: src/api/routes.ts:15-30, src/db/schema.sql:1-20",
		"Concern: none",
		"Required decision: none",
		"Claimed anchors: UserService, AuthMiddleware",
		"Confidence: verified",
	].join("\n");

	const outputPath = persistScoutOutput({
		cwd: psTestDir,
		sessionId: state.id,
		gateId: "gate-001",
		profileName: "backend",
		rawOutput: scoutOutput,
	});

	// Verify file was written
	assert(existsSync(outputPath), "scout output file exists");

	// Verify content
	const content = readFileSync(outputPath, "utf8");
	assertIncludes(content, "Backend Scout Investigation", "persisted output includes investigation content");
	assertIncludes(content, "Verdict: viable", "persisted output includes verdict");

	// Verify file path matches expected pattern: sessions/<id>/scouts/<gate-id>-<profile>.md
	assertIncludes(outputPath, "scouts", "output path contains scouts dir");
	assertIncludes(outputPath, "gate-001-backend.md", "output path has correct filename");

	// Write a second scout output for same gate
	const output2Path = persistScoutOutput({
		cwd: psTestDir,
		sessionId: state.id,
		gateId: "gate-001",
		profileName: "frontend",
		rawOutput: "Verdict: risky\nEvidence: not found\nConcern: Missing UI tests\nRequired decision: Add Cypress?\nClaimed anchors: none\nConfidence: partial",
	});

	assert(existsSync(output2Path), "second scout output file exists");
	assertIncludes(output2Path, "gate-001-frontend.md", "second output has correct filename");

	// Verify both files coexist
	assert(existsSync(outputPath), "first scout output still exists after writing second");

	rmSync(psTestDir, { recursive: true, force: true });
}

{
	// persistScoutOutput creates scouts/ directory if it doesn't exist
	const psTestDir2 = join(tmpdir(), `grill-scouts-persist-mkdir-${Date.now()}`);
	mkdirSync(psTestDir2, { recursive: true });

	const fixedDate = new Date("2026-06-14T23:00:00Z");
	const { state } = createSession("Scout mkdir test", psTestDir2, fixedDate);

	// Even though createSession already creates scouts/, verify persist handles it
	const outputPath = persistScoutOutput({
		cwd: psTestDir2,
		sessionId: state.id,
		gateId: "gate-002",
		profileName: "runtime",
		rawOutput: "Verdict: blocked\nEvidence: none\nConcern: Missing runtime config\nRequired decision: Which runtime?\nClaimed anchors: none\nConfidence: unverified",
	});

	assert(existsSync(outputPath), "persist creates file even in fresh session");
	assertIncludes(outputPath, "gate-002-runtime.md", "correct gate-profile filename");

	rmSync(psTestDir2, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Tests: recordScoutResult — records result, persists output, extracts finding or gap
// ---------------------------------------------------------------------------

console.log("\n--- recordScoutResult ---");

{
	const rsTestDir = join(tmpdir(), `grill-scouts-result-test-${Date.now()}`);
	mkdirSync(rsTestDir, { recursive: true });

	const fixedDate = new Date("2026-06-15T01:00:00Z");
	const { state } = createSession("Scout result test", rsTestDir, fixedDate);

	// Valid scout output with verdict
	const rawOutput = [
		"## Backend Investigation",
		"",
		"Traced entry points in src/api/routes.ts:15-30",
		"",
		"Verdict: viable",
		"Evidence: src/api/routes.ts:15-30, src/db/schema.sql",
		"Concern: none",
		"Required decision: none",
		"Claimed anchors: UserService, AuthMiddleware",
		"Confidence: verified",
	].join("\n");

	const result = recordScoutResult({
		cwd: rsTestDir,
		sessionId: state.id,
		gateId: "gate-001",
		profileName: "backend",
		rawOutput,
	});

	// Returns a ScoutResultRecord
	assertEqual(result.profileName, "backend", "result has profileName");
	assertEqual(result.gateId, "gate-001", "result has gateId");
	assert(result.verdict !== null, "result has parsed verdict");
	assertEqual(result.verdict!.verdict, "viable", "result verdict is viable");
	assert(result.outputPath.length > 0, "result has outputPath");
	assert(result.finding !== null, "result has a durable finding");
	assertEqual(result.gap, null, "no gap for valid verdict");

	// Verify the finding is a compact one-liner
	assert(typeof result.finding === "string", "finding is a string");
	assertIncludes(result.finding!, "backend", "finding mentions profile name");
	assertIncludes(result.finding!, "viable", "finding mentions verdict");

	// Verify output file was persisted
	assert(existsSync(result.outputPath), "output file persisted");

	rmSync(rsTestDir, { recursive: true, force: true });
}

{
	// Scout output with unusable/invalid verdict → creates gap
	const rsTestDir2 = join(tmpdir(), `grill-scouts-result-gap-${Date.now()}`);
	mkdirSync(rsTestDir2, { recursive: true });

	const fixedDate = new Date("2026-06-15T02:00:00Z");
	const { state } = createSession("Scout gap from bad output", rsTestDir2, fixedDate);

	const rawOutput = "I investigated things but forgot the verdict format.";

	const result = recordScoutResult({
		cwd: rsTestDir2,
		sessionId: state.id,
		gateId: "gate-002",
		profileName: "frontend",
		rawOutput,
	});

	assertEqual(result.verdict, null, "no verdict parsed from bad output");
	assertEqual(result.finding, null, "no finding from bad output");
	assert(result.gap !== null, "gap recorded for unusable output");
	assertIncludes(result.gap!, "frontend", "gap mentions profile");
	assertIncludes(result.gap!, "unusable", "gap mentions reason");

	// Output file is still persisted (for debugging)
	assert(existsSync(result.outputPath), "output file still persisted even for bad output");

	rmSync(rsTestDir2, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Tests: recordScoutGap — explicit gap recording for failures/timeouts/skips
// ---------------------------------------------------------------------------

console.log("\n--- recordScoutGap ---");

{
	const gapStr1 = recordScoutGap({
		gateId: "gate-003",
		profileName: "qa",
		reason: "timeout",
	});
	assertIncludes(gapStr1, "qa", "timeout gap mentions profile");
	assertIncludes(gapStr1, "gate-003", "timeout gap mentions gate");
	assertIncludes(gapStr1, "timeout", "timeout gap mentions reason");

	const gapStr2 = recordScoutGap({
		gateId: "gate-004",
		profileName: "runtime",
		reason: "skipped",
		detail: "budget limit reached",
	});
	assertIncludes(gapStr2, "runtime", "skipped gap mentions profile");
	assertIncludes(gapStr2, "skipped", "skipped gap mentions reason");
	assertIncludes(gapStr2, "budget limit reached", "skipped gap includes detail");

	const gapStr3 = recordScoutGap({
		gateId: "gate-005",
		profileName: "backend",
		reason: "failed",
		detail: "subagent crashed",
	});
	assertIncludes(gapStr3, "failed", "failed gap mentions reason");
}

// ---------------------------------------------------------------------------
// Tests: updateHandoff — re-renders handoff.md with current findings and gaps
// ---------------------------------------------------------------------------

console.log("\n--- updateHandoff ---");

{
	const uhTestDir = join(tmpdir(), `grill-scouts-handoff-${Date.now()}`);
	mkdirSync(uhTestDir, { recursive: true });

	const fixedDate = new Date("2026-06-15T03:00:00Z");
	const { state } = createSession("Handoff update test", uhTestDir, fixedDate);

	// Add findings and gaps to state
	state.durableScoutFindings.push("backend: viable — verified via src/api/routes.ts");
	state.durableScoutFindings.push("frontend: risky — missing test coverage");
	state.scoutGaps.push("[gate-001] qa: timeout");
	state.acceptedDecisions.push("Use Express for API layer");

	updateHandoff(state, uhTestDir, state.id);

	// Read the updated handoff.md
	const sessionDir = join(uhTestDir, ARTIFACT_ROOT, "sessions", state.id);
	const handoffContent = readFileSync(join(sessionDir, "handoff.md"), "utf8");

	assertIncludes(handoffContent, "backend: viable", "handoff includes backend finding");
	assertIncludes(handoffContent, "frontend: risky", "handoff includes frontend finding");
	assertIncludes(handoffContent, "qa: timeout", "handoff includes scout gap");
	assertIncludes(handoffContent, "Use Express", "handoff includes accepted decision");
	assertIncludes(handoffContent, "Handoff update test", "handoff includes goal");

	rmSync(uhTestDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Tests: renderScoutRoomSummary — shows verdicts and gaps (not just "pending")
// ---------------------------------------------------------------------------

console.log("\n--- renderScoutRoomSummary: verdicts and gaps ---");

{
	const gate: ScoutGate = {
		id: "gate-verdict",
		tier: "macro",
		decisionUnderReview: "Use microservices",
		crossesBoundary: true,
		changesContractOrState: true,
		introducesLifecycle: false,
		hasRuntimeRisk: true,
		hasUnverifiedLayerAssumption: false,
		hasMeaningfulFailureCost: true,
		riskLevel: "high",
		selectedScoutProfiles: ["backend", "frontend", "qa"],
		budgetAction: "call-now",
	};

	const state: SessionState = {
		id: "2026-06-15T010000-verdict-display",
		goal: "Verdict display test",
		currentTier: "macro",
		currentDecision: "Use microservices",
		acceptedDecisions: [],
		scoutGates: [gate],
		durableScoutFindings: ["backend: viable — verified", "frontend: risky — partial"],
		scoutGaps: ["[gate-verdict] qa: timeout"],
		contextPressure: 30,
		checkpoints: [],
		handoffReady: false,
		createdAt: "2026-06-15T01:00:00.000Z",
		nextQuestion: null,
		userAcceptedAssumptions: [],
		glossaryDeltas: [],
		adrCandidates: [],
		contractArtifacts: [],
	};

	const compact = renderScoutRoomSummary(state, { expanded: false });
	assertIncludes(compact, "scout:backend", "compact summary shows backend scout box");
	assertIncludes(compact, "○ viable", "compact summary shows backend verdict in scout box");
	assertIncludes(compact, "○ risky", "compact summary shows frontend verdict in scout box");
	assertIncludes(compact, "scout:qa", "compact summary shows qa scout box");
	assertIncludes(compact, "○ GAP", "compact summary shows qa gap in scout box");
	assert(!compact.includes("Findings:"), "compact summary hides findings section");
	assert(!compact.includes("Scout Gaps:"), "compact summary hides gaps section");

	const expanded = renderScoutRoomSummary(state, { expanded: true });
	assertIncludes(expanded, "○ viable", "expanded shows backend verdict in scout box");
	assertIncludes(expanded, "○ risky", "expanded shows frontend verdict in scout box");
	assertIncludes(expanded, "○ GAP", "expanded shows qa gap in scout box");
	assert(!expanded.includes("Findings:"), "expanded hides findings section");
	assert(!expanded.includes("Scout Gaps:"), "expanded hides gaps section");
}

// ---------------------------------------------------------------------------
// Tests: renderScoutRoomSummary shows running scouts
// ---------------------------------------------------------------------------

console.log("\n--- renderScoutRoomSummary: running scouts ---");

{
	const gate: ScoutGate = {
		id: "gate-running",
		tier: "macro",
		decisionUnderReview: "Use a workflow engine",
		crossesBoundary: true,
		changesContractOrState: false,
		introducesLifecycle: true,
		hasRuntimeRisk: true,
		hasUnverifiedLayerAssumption: false,
		hasMeaningfulFailureCost: true,
		riskLevel: "high",
		selectedScoutProfiles: ["backend", "qa", "runtime"],
		budgetAction: "call-now",
	};

	const state: SessionState = {
		id: "2026-06-15T020000-running-display",
		goal: "Running display test",
		currentTier: "macro",
		currentDecision: "Use a workflow engine",
		acceptedDecisions: [],
		scoutGates: [gate],
		durableScoutFindings: ["backend: viable - verified"],
		scoutGaps: [],
		activeScoutRuns: [
			{ toolCallId: "call-qa", gateId: "gate-running", profileName: "qa" },
			{ toolCallId: "call-runtime", gateId: "gate-running", profileName: "runtime" },
		],
		contextPressure: 45,
		checkpoints: [],
		handoffReady: false,
		createdAt: "2026-06-15T02:00:00.000Z",
		nextQuestion: null,
		userAcceptedAssumptions: [],
		glossaryDeltas: [],
		adrCandidates: [],
		contractArtifacts: [],
	};

	const compact = renderScoutRoomSummary(state, {
		expanded: false,
		now: new Date("2026-06-15T02:00:05.000Z").getTime(),
		runStatuses: [
			{
				toolCallId: "call-qa",
				gateId: "gate-running",
				profileName: "qa",
				type: "explore",
				name: "qa",
				startedAt: new Date("2026-06-15T02:00:00.000Z").getTime(),
				turns: 1,
				toolCalls: 2,
				currentTool: "grep",
				model: "provider/test-model",
				cost: 0.0123,
				contextTokens: 12_000,
				contextWindow: 200_000,
				contextPercent: 6,
			},
			{ toolCallId: "call-runtime", gateId: "gate-running", profileName: "runtime" },
		],
	});
	assert(!compact.includes("Running Scouts"), "compact summary hides running summary line");
	assert(!compact.includes("Verdicts:"), "compact summary hides verdict summary line");
	assert(!compact.includes("Scout Roster"), "compact summary hides roster heading");
	assertIncludes(compact, "scout:qa", "compact summary shows qa scout box");
	assertIncludes(compact, "scout:runtime", "compact summary shows runtime scout box");
	assert(compact.split("\n")[0].includes("scout:backend") && compact.split("\n")[0].includes("scout:runtime"), "compact summary renders running scout boxes inline");
	assertIncludes(compact, "● running 1t·2T·5s", "compact summary shows running subagent timing and counts");
	assertIncludes(compact, "ctx 12.0k/200.0k 6%", "compact summary shows subagent context usage");
	assertIncludes(compact, "→ grep", "compact summary shows current child tool");
}

// ---------------------------------------------------------------------------
// Tests: executeScoutGate — orchestrates full scout execution for a gate
// ---------------------------------------------------------------------------

console.log("\n--- executeScoutGate ---");

{
	// Successful execution: all scouts return valid verdicts
	const esgTestDir = join(tmpdir(), `grill-scouts-exec-gate-${Date.now()}`);
	mkdirSync(esgTestDir, { recursive: true });

	const fixedDate = new Date("2026-06-15T04:00:00Z");
	const { state } = createSession("Execute scout gate test", esgTestDir, fixedDate);

	const gate: ScoutGate = {
		id: "gate-exec-001",
		tier: "macro",
		decisionUnderReview: "Should we use a message queue?",
		crossesBoundary: true,
		changesContractOrState: true,
		introducesLifecycle: false,
		hasRuntimeRisk: true,
		hasUnverifiedLayerAssumption: false,
		hasMeaningfulFailureCost: true,
		riskLevel: "high",
		selectedScoutProfiles: ["backend", "runtime"],
		budgetAction: "call-now",
	};

	// Mock runScout: returns valid scout output
	const mockRunScout = async (prompt: string, profileName: string): Promise<string> => {
		return [
			`## ${profileName} Scout Investigation`,
			"",
			"Investigated the decision under review.",
			"",
			"Verdict: viable",
			`Evidence: src/${profileName}/config.ts:10-20`,
			"Concern: none",
			"Required decision: none",
			`Claimed anchors: ${profileName}Service`,
			"Confidence: verified",
		].join("\n");
	};

	const resultPromise = executeScoutGate({
		state,
		gate,
		cwd: esgTestDir,
		checkpointContent: "# Checkpoint 1\n**Goal**: Execute scout gate test\n**Tier**: macro",
		anchors: ["MessageQueue", "EventBus"],
		runScout: mockRunScout,
	});

	// Should return a promise
	assert(resultPromise instanceof Promise, "executeScoutGate returns a Promise");

	const result: ExecuteScoutGateResult = await resultPromise;

	// Should have results for each profile
	assertEqual(result.results.length, 2, "2 results for 2 selected profiles");
	assertEqual(result.results[0].profileName, "backend", "first result is backend");
	assertEqual(result.results[1].profileName, "runtime", "second result is runtime");

	// All should have viable verdicts
	assert(result.results[0].verdict !== null, "backend has verdict");
	assertEqual(result.results[0].verdict!.verdict, "viable", "backend verdict is viable");
	assert(result.results[1].verdict !== null, "runtime has verdict");
	assertEqual(result.results[1].verdict!.verdict, "viable", "runtime verdict is viable");

	// Findings should be populated
	assertEqual(result.findings.length, 2, "2 findings extracted");
	assertIncludes(result.findings[0], "backend", "first finding mentions backend");
	assertIncludes(result.findings[1], "runtime", "second finding mentions runtime");

	// No gaps
	assertEqual(result.gaps.length, 0, "no gaps for successful execution");

	// State should be updated
	assertEqual(result.updatedState.durableScoutFindings.length, 2, "state has 2 findings");
	assertEqual(result.updatedState.scoutGaps.length, 0, "state has 0 gaps");

	// Output files should exist
	const scoutsDir = join(esgTestDir, ARTIFACT_ROOT, "sessions", state.id, "scouts");
	assert(existsSync(join(scoutsDir, "gate-exec-001-backend.md")), "backend output file exists");
	assert(existsSync(join(scoutsDir, "gate-exec-001-runtime.md")), "runtime output file exists");

	// Handoff should be updated
	const handoffPath = join(esgTestDir, ARTIFACT_ROOT, "sessions", state.id, "handoff.md");
	const handoff = readFileSync(handoffPath, "utf8");
	assertIncludes(handoff, "backend", "handoff includes backend finding");
	assertIncludes(handoff, "runtime", "handoff includes runtime finding");

	rmSync(esgTestDir, { recursive: true, force: true });
}

{
	// Mixed execution: one scout succeeds, one fails (returns unusable output)
	const esgTestDir2 = join(tmpdir(), `grill-scouts-exec-mixed-${Date.now()}`);
	mkdirSync(esgTestDir2, { recursive: true });

	const fixedDate = new Date("2026-06-15T05:00:00Z");
	const { state } = createSession("Mixed scout gate test", esgTestDir2, fixedDate);

	const gate: ScoutGate = {
		id: "gate-mix-001",
		tier: "meso",
		decisionUnderReview: "Add caching layer?",
		crossesBoundary: true,
		changesContractOrState: false,
		introducesLifecycle: false,
		hasRuntimeRisk: false,
		hasUnverifiedLayerAssumption: true,
		hasMeaningfulFailureCost: false,
		riskLevel: "medium",
		selectedScoutProfiles: ["backend", "qa"],
		budgetAction: "call-now",
	};

	const mockRunScout = async (_prompt: string, profileName: string): Promise<string> => {
		if (profileName === "backend") {
			return "Verdict: risky\nEvidence: src/cache.ts:5\nConcern: No invalidation strategy\nRequired decision: How should cache be invalidated?\nClaimed anchors: CacheService\nConfidence: partial";
		}
		// qa returns garbage
		return "I looked around but couldn't figure out the format you wanted.";
	};

	const result = await executeScoutGate({
		state,
		gate,
		cwd: esgTestDir2,
		checkpointContent: "# Checkpoint\n**Goal**: Mixed test",
		anchors: [],
		runScout: mockRunScout,
	});

	// One finding, one gap
	assertEqual(result.findings.length, 1, "1 finding from successful scout");
	assertIncludes(result.findings[0], "backend", "finding is from backend");
	assertIncludes(result.findings[0], "risky", "finding shows risky verdict");

	assertEqual(result.gaps.length, 1, "1 gap from failed scout");
	assertIncludes(result.gaps[0], "qa", "gap is for qa scout");
	assertIncludes(result.gaps[0], "unusable", "gap reason is unusable");

	// State updated correctly
	assertEqual(result.updatedState.durableScoutFindings.length, 1, "state has 1 finding");
	assertEqual(result.updatedState.scoutGaps.length, 1, "state has 1 gap");

	rmSync(esgTestDir2, { recursive: true, force: true });
}

{
	// Scout timeout: runScout throws an error
	const esgTestDir3 = join(tmpdir(), `grill-scouts-exec-timeout-${Date.now()}`);
	mkdirSync(esgTestDir3, { recursive: true });

	const fixedDate = new Date("2026-06-15T06:00:00Z");
	const { state } = createSession("Timeout scout gate test", esgTestDir3, fixedDate);

	const gate: ScoutGate = {
		id: "gate-timeout-001",
		tier: "macro",
		decisionUnderReview: "Adopt new framework?",
		crossesBoundary: true,
		changesContractOrState: true,
		introducesLifecycle: true,
		hasRuntimeRisk: true,
		hasUnverifiedLayerAssumption: true,
		hasMeaningfulFailureCost: true,
		riskLevel: "high",
		selectedScoutProfiles: ["frontend"],
		budgetAction: "call-now",
	};

	const mockRunScout = async (_prompt: string, _profileName: string): Promise<string> => {
		throw new Error("Subagent timed out after 60 seconds.");
	};

	const result = await executeScoutGate({
		state,
		gate,
		cwd: esgTestDir3,
		checkpointContent: "# Checkpoint",
		anchors: [],
		runScout: mockRunScout,
	});

	// Should have a gap, no findings
	assertEqual(result.findings.length, 0, "no findings from timeout");
	assertEqual(result.gaps.length, 1, "1 gap from timeout");
	assertIncludes(result.gaps[0], "frontend", "gap is for frontend");
	assert(
		result.gaps[0].includes("timeout") || result.gaps[0].includes("failed"),
		"gap mentions timeout or failed",
	);

	// State reflects gap
	assertEqual(result.updatedState.scoutGaps.length, 1, "state has timeout gap");

	rmSync(esgTestDir3, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Tests: deriveInspectedPaths — extracts paths from tool calls
// ---------------------------------------------------------------------------

console.log("\n--- deriveInspectedPaths ---");

{
	// read tool → kind "read"
	const paths = deriveInspectedPaths([
		{ name: "read", args: { path: "src/api/routes.ts" } },
	]);
	assert(paths.length === 1, "deriveInspectedPaths: one read call → one path");
	assertEqual(paths[0].path, "src/api/routes.ts", "deriveInspectedPaths: read path extracted");
	assertEqual(paths[0].tool, "read", "deriveInspectedPaths: tool is read");
	assertEqual(paths[0].kind, "read", "deriveInspectedPaths: kind is read");
}

{
	// grep tool → kind "searched"
	const paths = deriveInspectedPaths([
		{ name: "grep", args: { pattern: "import", path: "src/lib" } },
	]);
	assert(paths.length === 1, "deriveInspectedPaths: grep call → one path");
	assertEqual(paths[0].path, "src/lib", "deriveInspectedPaths: grep path extracted");
	assertEqual(paths[0].tool, "grep", "deriveInspectedPaths: tool is grep");
	assertEqual(paths[0].kind, "searched", "deriveInspectedPaths: grep kind is searched");
}

{
	// find tool → kind "searched"
	const paths = deriveInspectedPaths([
		{ name: "find", args: { pattern: "*.ts", path: "extensions" } },
	]);
	assert(paths.length === 1, "deriveInspectedPaths: find call → one path");
	assertEqual(paths[0].path, "extensions", "deriveInspectedPaths: find path extracted");
	assertEqual(paths[0].tool, "find", "deriveInspectedPaths: tool is find");
	assertEqual(paths[0].kind, "searched", "deriveInspectedPaths: find kind is searched");
}

{
	// ls tool → kind "searched"
	const paths = deriveInspectedPaths([
		{ name: "ls", args: { path: "src" } },
	]);
	assert(paths.length === 1, "deriveInspectedPaths: ls call → one path");
	assertEqual(paths[0].path, "src", "deriveInspectedPaths: tool is ls, path is src");
	assertEqual(paths[0].tool, "ls", "deriveInspectedPaths: tool is ls");
	assertEqual(paths[0].kind, "searched", "deriveInspectedPaths: ls kind is searched");
}

{
	// Multiple tool calls, various types
	const paths = deriveInspectedPaths([
		{ name: "read", args: { path: "a.ts" } },
		{ name: "grep", args: { pattern: "foo", path: "b/" } },
		{ name: "read", args: { path: "c.ts" } },
		{ name: "find", args: { pattern: "*.md", path: "docs" } },
		{ name: "ls", args: { path: "root" } },
	]);
	assertEqual(paths.length, 5, "deriveInspectedPaths: 5 calls → 5 paths");
	assertEqual(paths[0].kind, "read", "deriveInspectedPaths: first is read");
	assertEqual(paths[1].kind, "searched", "deriveInspectedPaths: second is searched");
	assertEqual(paths[2].kind, "read", "deriveInspectedPaths: third is read");
	assertEqual(paths[3].kind, "searched", "deriveInspectedPaths: fourth is searched");
	assertEqual(paths[4].kind, "searched", "deriveInspectedPaths: fifth is searched");
}

{
	// Non-relevant tool calls (edit, write, bash) are skipped
	const paths = deriveInspectedPaths([
		{ name: "edit", args: { path: "x.ts", edits: [] } },
		{ name: "write", args: { path: "y.ts", content: "hello" } },
		{ name: "bash", args: { command: "ls" } },
		{ name: "read", args: { path: "z.ts" } },
	]);
	assertEqual(paths.length, 1, "deriveInspectedPaths: only read/grep/find/ls extracted");
	assertEqual(paths[0].path, "z.ts", "deriveInspectedPaths: only z.ts extracted");
}

{
	// Defensive: missing path in args
	const paths = deriveInspectedPaths([
		{ name: "read", args: {} },
		{ name: "read", args: null },
		{ name: "read", args: "not-an-object" },
		{ name: "grep", args: { pattern: "x" } }, // no path key at all
	]);
	assertEqual(paths.length, 0, "deriveInspectedPaths: skips entries with missing/invalid path");
}

{
	// Empty input
	const paths = deriveInspectedPaths([]);
	assertEqual(paths.length, 0, "deriveInspectedPaths: empty input → empty output");
}

{
	// ls with no path defaults to "." 
	const paths = deriveInspectedPaths([
		{ name: "ls", args: {} },
	]);
	// ls without path is still a valid tool call, but has no specific path → skip
	assertEqual(paths.length, 0, "deriveInspectedPaths: ls with no path is skipped");
}

// ---------------------------------------------------------------------------
// Tests: computeAreaVerification — determines verification status
// ---------------------------------------------------------------------------

console.log("\n--- computeAreaVerification ---");

{
	// path-verified, anchor-claimed: has inspected paths AND claimed anchors, no gaps
	const result = computeAreaVerification(
		"backend",
		[{ path: "src/api.ts", tool: "read", kind: "read" }],
		["UserService"],
		[],
	);
	assertEqual(result.area, "backend", "computeAreaVerification: area is backend");
	assertEqual(result.status, "path-verified, anchor-claimed", "computeAreaVerification: full verification status");
	assertEqual(result.toolVerifiedPaths.length, 1, "computeAreaVerification: 1 tool-verified path");
	assertEqual(result.scoutClaimedAnchors.length, 1, "computeAreaVerification: 1 claimed anchor");
}

{
	// partial: has inspected paths but NO claimed anchors
	const result = computeAreaVerification(
		"frontend",
		[{ path: "src/ui.ts", tool: "read", kind: "read" }],
		[], // no claimed anchors
		[],
	);
	assertEqual(result.status, "partial", "computeAreaVerification: paths but no anchors → partial");
}

{
	// partial: has claimed anchors but NO inspected paths
	const result = computeAreaVerification(
		"runtime",
		[], // no tool paths
		["RuntimeConfig"],
		[],
	);
	assertEqual(result.status, "partial", "computeAreaVerification: anchors but no paths → partial");
}

{
	// unverified: no paths, no anchors
	const result = computeAreaVerification(
		"qa",
		[],
		[],
		[],
	);
	assertEqual(result.status, "unverified", "computeAreaVerification: nothing → unverified");
}

{
	// Scout Gap blocks verified status even when paths and anchors present
	const result = computeAreaVerification(
		"backend",
		[{ path: "src/api.ts", tool: "read", kind: "read" }],
		["UserService"],
		["[gate-001] backend: timeout"], // gap mentions the area
	);
	assertEqual(result.status, "partial", "computeAreaVerification: gap blocks verified → partial");
}

{
	// Scout Gap for a DIFFERENT area does NOT block
	const result = computeAreaVerification(
		"backend",
		[{ path: "src/api.ts", tool: "read", kind: "read" }],
		["UserService"],
		["[gate-001] frontend: timeout"], // gap for frontend, not backend
	);
	assertEqual(result.status, "path-verified, anchor-claimed", "computeAreaVerification: unrelated gap doesn't block");
}

{
	// Multiple paths and anchors
	const result = computeAreaVerification(
		"infra",
		[
			{ path: "terraform/main.tf", tool: "read", kind: "read" },
			{ path: "terraform/", tool: "find", kind: "searched" },
		],
		["VpcModule", "EcsCluster"],
		[],
	);
	assertEqual(result.status, "path-verified, anchor-claimed", "computeAreaVerification: multiple paths/anchors → verified");
	assertEqual(result.toolVerifiedPaths.length, 2, "computeAreaVerification: 2 tool-verified paths");
	assertEqual(result.scoutClaimedAnchors.length, 2, "computeAreaVerification: 2 claimed anchors");
}

{
	// Gap mentioning area anywhere in text blocks it
	const result = computeAreaVerification(
		"runtime",
		[{ path: "src/rt.ts", tool: "grep", kind: "searched" }],
		["RuntimeInit"],
		["[gate-002] runtime: unusable — could not parse"],
	);
	assertEqual(result.status, "partial", "computeAreaVerification: gap with area name in text blocks it");
}

{
	// deltaInstruction is populated
	const result = computeAreaVerification(
		"backend",
		[{ path: "src/api.ts", tool: "read", kind: "read" }],
		["UserService"],
		[],
	);
	assert(result.deltaInstruction.length > 0, "computeAreaVerification: deltaInstruction is populated");
}

// ---------------------------------------------------------------------------
// Tests: deltaVerificationInstruction — instruction text per status
// ---------------------------------------------------------------------------

console.log("\n--- deltaVerificationInstruction ---");

{
	const instr = deltaVerificationInstruction("path-verified, anchor-claimed");
	assert(typeof instr === "string", "deltaVerificationInstruction: returns string for verified");
	assert(instr.length > 0, "deltaVerificationInstruction: non-empty for verified");
	assert(
		instr.toLowerCase().includes("spot-check") || instr.toLowerCase().includes("spot check"),
		"deltaVerificationInstruction: verified mentions spot-check",
	);
}

{
	const instr = deltaVerificationInstruction("partial");
	assert(instr.length > 0, "deltaVerificationInstruction: non-empty for partial");
	assert(
		instr.toLowerCase().includes("targeted") || instr.toLowerCase().includes("follow-up") || instr.toLowerCase().includes("follow up"),
		"deltaVerificationInstruction: partial mentions targeted follow-up",
	);
}

{
	const instr = deltaVerificationInstruction("unverified");
	assert(instr.length > 0, "deltaVerificationInstruction: non-empty for unverified");
	assert(
		instr.toLowerCase().includes("normal discovery") || instr.toLowerCase().includes("discovery"),
		"deltaVerificationInstruction: unverified mentions normal discovery",
	);
}

// ---------------------------------------------------------------------------
// Tests: parseClaimedAnchors — splits comma-separated anchors from verdict
// ---------------------------------------------------------------------------

console.log("\n--- parseClaimedAnchors ---");

{
	const result = parseClaimedAnchors("UserService, AuthMiddleware, db.users");
	assertEqual(result.length, 3, "parseClaimedAnchors: splits 3 items");
	assertEqual(result[0], "UserService", "parseClaimedAnchors: first item trimmed");
	assertEqual(result[1], "AuthMiddleware", "parseClaimedAnchors: second item");
	assertEqual(result[2], "db.users", "parseClaimedAnchors: third item");
}

{
	const result = parseClaimedAnchors("none");
	assertEqual(result.length, 0, "parseClaimedAnchors: 'none' returns empty");
}

{
	const result = parseClaimedAnchors("");
	assertEqual(result.length, 0, "parseClaimedAnchors: empty string returns empty");
}

{
	const result = parseClaimedAnchors("SingleAnchor");
	assertEqual(result.length, 1, "parseClaimedAnchors: single item");
	assertEqual(result[0], "SingleAnchor", "parseClaimedAnchors: single value correct");
}

// ---------------------------------------------------------------------------
// Tests: recordScoutResult with toolCalls — populates inspectedPaths & claimedAnchors
// ---------------------------------------------------------------------------

console.log("\n--- recordScoutResult: telemetry fields ---");

{
	const telTestDir = join(tmpdir(), `grill-scouts-telemetry-${Date.now()}`);
	mkdirSync(telTestDir, { recursive: true });

	const fixedDate = new Date("2026-06-15T10:00:00Z");
	const { state } = createSession("Telemetry test", telTestDir, fixedDate);

	const rawOutput = [
		"## Backend Investigation",
		"",
		"Verdict: viable",
		"Evidence: src/api/routes.ts:15-30",
		"Concern: none",
		"Required decision: none",
		"Claimed anchors: UserService, AuthMiddleware",
		"Confidence: verified",
	].join("\n");

	const toolCalls = [
		{ name: "read", args: { path: "src/api/routes.ts" } },
		{ name: "grep", args: { pattern: "import", path: "src/lib" } },
		{ name: "bash", args: { command: "echo hi" } },
	];

	const result = recordScoutResult({
		cwd: telTestDir,
		sessionId: state.id,
		gateId: "gate-tel-001",
		profileName: "backend",
		rawOutput,
		toolCalls,
	});

	// inspectedPaths populated from toolCalls
	assert(Array.isArray(result.inspectedPaths), "recordScoutResult: inspectedPaths is array");
	assertEqual(result.inspectedPaths.length, 2, "recordScoutResult: 2 inspected paths (read + grep)");
	assertEqual(result.inspectedPaths[0].path, "src/api/routes.ts", "recordScoutResult: first path");
	assertEqual(result.inspectedPaths[0].kind, "read", "recordScoutResult: first is read");
	assertEqual(result.inspectedPaths[1].path, "src/lib", "recordScoutResult: second path");
	assertEqual(result.inspectedPaths[1].kind, "searched", "recordScoutResult: second is searched");

	// claimedAnchors parsed from verdict
	assert(Array.isArray(result.claimedAnchors), "recordScoutResult: claimedAnchors is array");
	assertEqual(result.claimedAnchors.length, 2, "recordScoutResult: 2 claimed anchors");
	assertEqual(result.claimedAnchors[0], "UserService", "recordScoutResult: first anchor");
	assertEqual(result.claimedAnchors[1], "AuthMiddleware", "recordScoutResult: second anchor");

	rmSync(telTestDir, { recursive: true, force: true });
}

{
	// No toolCalls provided (backward compat) — inspectedPaths is empty
	const telTestDir2 = join(tmpdir(), `grill-scouts-telemetry2-${Date.now()}`);
	mkdirSync(telTestDir2, { recursive: true });

	const fixedDate = new Date("2026-06-15T11:00:00Z");
	const { state } = createSession("Telemetry compat test", telTestDir2, fixedDate);

	const rawOutput = [
		"Verdict: viable",
		"Evidence: file.ts",
		"Concern: none",
		"Required decision: none",
		"Claimed anchors: Foo",
		"Confidence: partial",
	].join("\n");

	const result = recordScoutResult({
		cwd: telTestDir2,
		sessionId: state.id,
		gateId: "gate-compat",
		profileName: "backend",
		rawOutput,
	});

	assertEqual(result.inspectedPaths.length, 0, "recordScoutResult: no toolCalls => empty inspectedPaths");
	assertEqual(result.claimedAnchors.length, 1, "recordScoutResult: claimedAnchors from verdict");
	assertEqual(result.claimedAnchors[0], "Foo", "recordScoutResult: correct anchor");

	rmSync(telTestDir2, { recursive: true, force: true });
}

{
	// Unusable verdict — claimedAnchors empty, inspectedPaths still populated
	const telTestDir3 = join(tmpdir(), `grill-scouts-telemetry3-${Date.now()}`);
	mkdirSync(telTestDir3, { recursive: true });

	const fixedDate = new Date("2026-06-15T12:00:00Z");
	const { state } = createSession("Telemetry gap test", telTestDir3, fixedDate);

	const result = recordScoutResult({
		cwd: telTestDir3,
		sessionId: state.id,
		gateId: "gate-gap",
		profileName: "qa",
		rawOutput: "Some random text, no verdict.",
		toolCalls: [{ name: "read", args: { path: "test/spec.ts" } }],
	});

	assertEqual(result.inspectedPaths.length, 1, "recordScoutResult: inspectedPaths populated even without verdict");
	assertEqual(result.claimedAnchors.length, 0, "recordScoutResult: no claimedAnchors on bad verdict");
	assert(result.gap !== null, "recordScoutResult: gap for unusable verdict");

	rmSync(telTestDir3, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Tests: markHandoffReady — sets handoffReady on state
// ---------------------------------------------------------------------------

console.log("\n--- markHandoffReady ---");

{
	const state: SessionState = {
		id: "2026-06-15T100000-handoff-ready-test",
		goal: "Handoff ready test",
		currentTier: "convergence",
		currentDecision: null,
		acceptedDecisions: ["D1"],
		scoutGates: [],
		durableScoutFindings: ["backend: viable"],
		scoutGaps: [],
		contextPressure: 20,
		checkpoints: ["checkpoints/1.md"],
		handoffReady: false,
		createdAt: "2026-06-15T10:00:00.000Z",
		nextQuestion: null,
		userAcceptedAssumptions: [],
		glossaryDeltas: [],
		adrCandidates: [],
		contractArtifacts: [],
	};

	const result = markHandoffReady(state);
	assertEqual(result.handoffReady, true, "markHandoffReady: sets handoffReady to true");
	assert(result === state, "markHandoffReady: mutates same reference");

	const summary = renderScoutRoomSummary(result, { expanded: false });
	assertIncludes(summary, "scout:backend", "markHandoffReady: Scout Room still shows scout boxes");
	assert(!summary.includes("Handoff Ready"), "markHandoffReady: Scout Room hides handoff metadata");
}

// ---------------------------------------------------------------------------
// Tests: renderFinalHandoff — renders full Scout-Grounded Handoff Markdown
// ---------------------------------------------------------------------------

console.log("\n--- renderFinalHandoff ---");

{
	const state: SessionState = {
		id: "2026-06-15T130000-final-handoff",
		goal: "Build REST API",
		currentTier: "convergence",
		currentDecision: null,
		acceptedDecisions: ["Use Express", "Use PostgreSQL"],
		scoutGates: [
			{
				id: "gate-001",
				tier: "macro",
				decisionUnderReview: "Use Express",
				crossesBoundary: true,
				changesContractOrState: true,
				introducesLifecycle: false,
				hasRuntimeRisk: true,
				hasUnverifiedLayerAssumption: false,
				hasMeaningfulFailureCost: true,
				riskLevel: "high",
				selectedScoutProfiles: ["backend"],
				budgetAction: "call-now",
			},
		],
		durableScoutFindings: ["backend: viable — verified | evidence: src/api.ts:10-20"],
		scoutGaps: ["[gate-002] qa: timeout"],
		contextPressure: 30,
		checkpoints: ["checkpoints/1.md"],
		handoffReady: true,
		createdAt: "2026-06-15T13:00:00.000Z",
		nextQuestion: null,
		userAcceptedAssumptions: ["Team knows Express"],
		glossaryDeltas: ["REST: Representational State Transfer"],
		adrCandidates: ["ADR-001: Use Express over Fastify"],
		contractArtifacts: [],
	};

	const areaVerifications: AreaVerification[] = [
		{
			area: "backend",
			status: "path-verified, anchor-claimed",
			toolVerifiedPaths: [{ path: "src/api.ts", tool: "read", kind: "read" }],
			scoutClaimedAnchors: ["UserService"],
			deltaInstruction: "Spot-check claimed anchors; paths already tool-verified.",
		},
		{
			area: "qa",
			status: "unverified",
			toolVerifiedPaths: [],
			scoutClaimedAnchors: [],
			deltaInstruction: "Normal discovery required; no tool evidence available for this area.",
		},
	];

	const handoff = renderFinalHandoff(state, areaVerifications);

	// Required sections
	assertIncludes(handoff, "# Scout-Grounded Handoff", "renderFinalHandoff: has main heading");
	assertIncludes(handoff, "## Accepted Decisions", "renderFinalHandoff: has accepted decisions section");
	assertIncludes(handoff, "## User-Accepted Assumptions", "renderFinalHandoff: has assumptions section");
	assertIncludes(handoff, "## Scout Gates", "renderFinalHandoff: has scout gates section");
	assertIncludes(handoff, "## Durable Scout Findings", "renderFinalHandoff: has findings section");
	assertIncludes(handoff, "## Scout Gaps", "renderFinalHandoff: has gaps section");
	assertIncludes(handoff, "## Verification Status by Area", "renderFinalHandoff: has verification section");
	assertIncludes(handoff, "## Delta Verification Instructions", "renderFinalHandoff: has delta section");
	assertIncludes(handoff, "## Do-Not-Reopen Decisions", "renderFinalHandoff: has do-not-reopen section");

	// Content checks
	assertIncludes(handoff, "Use Express", "renderFinalHandoff: includes accepted decision");
	assertIncludes(handoff, "Use PostgreSQL", "renderFinalHandoff: includes second decision");
	assertIncludes(handoff, "Team knows Express", "renderFinalHandoff: includes assumption");
	assertIncludes(handoff, "gate-001", "renderFinalHandoff: includes gate id");
	assertIncludes(handoff, "backend: viable", "renderFinalHandoff: includes finding");
	assertIncludes(handoff, "qa: timeout", "renderFinalHandoff: includes gap");

	// Verification area content
	assertIncludes(handoff, "path-verified, anchor-claimed", "renderFinalHandoff: includes verified status");
	assertIncludes(handoff, "unverified", "renderFinalHandoff: includes unverified status");
	assertIncludes(handoff, "src/api.ts", "renderFinalHandoff: includes tool-verified path");
	assertIncludes(handoff, "UserService", "renderFinalHandoff: includes scout-claimed anchor");

	// Delta instructions
	assertIncludes(handoff, "Spot-check", "renderFinalHandoff: includes spot-check instruction");
	assertIncludes(handoff, "Normal discovery", "renderFinalHandoff: includes normal discovery instruction");

	// Do-not-reopen references accepted decisions
	assertIncludes(handoff, "Use Express", "renderFinalHandoff: do-not-reopen references decisions");
}

// ---------------------------------------------------------------------------
// Tests: writeFinalHandoff — writes to disk and updates latest-handoff.md
// ---------------------------------------------------------------------------

console.log("\n--- writeFinalHandoff ---");

{
	const wfhTestDir = join(tmpdir(), `grill-scouts-write-final-${Date.now()}`);
	mkdirSync(wfhTestDir, { recursive: true });

	const fixedDate = new Date("2026-06-15T14:00:00Z");
	const { state } = createSession("Final handoff write test", wfhTestDir, fixedDate);

	state.acceptedDecisions = ["Decision Alpha"];
	state.durableScoutFindings = ["backend: viable"];
	state.handoffReady = true;

	const areaVerifications: AreaVerification[] = [
		{
			area: "backend",
			status: "path-verified, anchor-claimed",
			toolVerifiedPaths: [{ path: "src/main.ts", tool: "read", kind: "read" }],
			scoutClaimedAnchors: ["MainService"],
			deltaInstruction: "Spot-check claimed anchors; paths already tool-verified.",
		},
	];

	writeFinalHandoff(state, wfhTestDir, state.id, areaVerifications);

	// handoff.md in session dir should be the final handoff
	const sessionDir = join(wfhTestDir, ARTIFACT_ROOT, "sessions", state.id);
	const handoffPath = join(sessionDir, "handoff.md");
	assert(existsSync(handoffPath), "writeFinalHandoff: handoff.md exists");

	const handoffContent = readFileSync(handoffPath, "utf8");
	assertIncludes(handoffContent, "# Scout-Grounded Handoff", "writeFinalHandoff: handoff.md has heading");
	assertIncludes(handoffContent, "Decision Alpha", "writeFinalHandoff: handoff.md has decision");
	assertIncludes(handoffContent, "src/main.ts", "writeFinalHandoff: handoff.md has verified path");

	// latest-handoff.md should also be updated
	const latestPath = join(wfhTestDir, ARTIFACT_ROOT, "latest-handoff.md");
	assert(existsSync(latestPath), "writeFinalHandoff: latest-handoff.md exists");

	const latestContent = readFileSync(latestPath, "utf8");
	assertIncludes(latestContent, "# Scout-Grounded Handoff", "writeFinalHandoff: latest-handoff.md has heading");
	assertIncludes(latestContent, "Decision Alpha", "writeFinalHandoff: latest-handoff.md has decision");

	rmSync(wfhTestDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length > 0) {
	console.error("\nFailures:");
	for (const f of failures) console.error(`  - ${f}`);
	process.exit(1);
}
