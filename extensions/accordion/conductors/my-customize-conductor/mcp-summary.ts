/*
 * mcp-summary.ts — recoverable summaries for folded MCP tool results.
 *
 * When the conductor folds an MCP `tool_result`, it does NOT fall back to the engine's
 * generic one-line digest ("mcp → 42 lines, ~1234 tok"). It substitutes a summary that
 * NAMES the call's identity — server / tool / action plus a short args peek, recovered
 * from the paired `tool_call` (by `callId`). The summary is emitted via a recoverable
 * `replace`, so the host prepends the `{#code FOLDED}` tag and the original full result is
 * one `unfold`/`recall` away. The point: in a long session the agent reads the identity,
 * recognises a repeat call, and reuses the prior result instead of re-hitting MCP.
 *
 * Pure & deterministic: no Date / Math.random / global state, no app imports — same shape
 * as `code-skeleton/classify.ts`.
 */
import type { ViewBlock } from "../contract";

/** Engine token overhead (the `{#code FOLDED}` tag + per-block framing) the host adds on
 *  top of the body we supply. Used only to keep the replace-vs-fold saving estimate honest. */
const SUMMARY_OVERHEAD_TOKENS = 8;
const REDACTED = "[redacted]";
const RECALL_HINT = 'recall({"codes":["<code>"]})';
const SENSITIVE_KEY_RE = /(token|key|password|secret|auth)/i;
const READ_SIGNAL_MAX = 4;
const READ_SIGNAL_LEN = 50;
const COMPACT_PATH_MAX = 60;
const TASK_CAP = 80;
const FINDING_CAP = 60;
const FINDINGS_MAX = 3;
const BULLET_RE = /^(?:[-*+]|\d+\.?)\s+(.*)/;
const SEPARATOR_RE = /^[-=*_]{3,}$/;
const PSTACK_NAME_RE = /skill-pstack\(name="([^"]+)"\)/i;
const FOLD_TAG_RE = /\{#([0-9a-z]{6}) FOLDED\}/i;
const POTETO_MODE_NAME = "poteto-mode";
const POTETO_MODE_BEACON_LINES = [
	"Poteto mode active.",
	"- Apply pstack skills/principles/playbooks only with their full leaf visible in this prompt.",
	'- For skill-pstack(name=...): full leaf visible → use; folded exact match → recall most recent; absent → call skill-pstack(name=...).',
];

/** An MCP tool result: a `tool_result` whose tool is the `mcp` gateway (case-insensitive). */
export function isMcpResult(b: ViewBlock): boolean {
	return b.kind === "tool_result" && (b.toolName ?? "").trim().toLowerCase() === "mcp";
}

/** Estimated token cost of a summary body once the host tags and frames it (chars/4 + overhead). */
export function estSummaryTokens(summary: string): number {
	return Math.ceil(summary.length / 4) + SUMMARY_OVERHEAD_TOKENS;
}

/**
 * A recoverable summary for a folded MCP tool result. `call` is the paired
 * `tool_call` block (matched by `callId`), or undefined when it can't be recovered.
 */
export function mcpSummary(result: ViewBlock, call: ViewBlock | undefined, opts: SummaryOptions = {}): string {
	const parsed = parseOuterCall(call?.text);
	const pstack = pstackIdentity(parsed);
	if (pstack) {
		return appendPotetoBeacon(
			[
				`tool_result:mcp skill-pstack(name="${pstack.name}")`,
				`Label: ${pstack.label}`,
				`Full result preserved. Use recall({"codes":["${foldCode(result.id)}"]}) , not unfold, before re-calling this exact MCP tool.`,
			],
			pstack,
			opts,
		).join("\n");
	}
	return [
		`tool_result:mcp ${genericIdentity(parsed)}`,
		`Full result preserved. Use recall({"codes":["${foldCode(result.id)}"]}) if you need this exact prior result.`,
	].join("\n");
}

export function normalizePstackName(name: string): string {
	return name.trim().toLowerCase();
}

export function pstackLabel(name: string): string {
	const normalized = normalizePstackName(name);
	if (normalized.startsWith("principle-")) {
		return `${titleWords(normalized.slice("principle-".length))} principle`;
	}
	const playbookMarker = "/playbooks/";
	const playbookIndex = normalized.indexOf(playbookMarker);
	if (playbookIndex >= 0) {
		return `${titleWords(normalized.slice(playbookIndex + playbookMarker.length))} playbook`;
	}
	return `${titleWords(normalized)} skill`;
}

// ───────────────────────────── helpers ─────────────────────────────

type McpCall = Record<string, unknown>;

type SummaryOptions = {
	potetoBeacon?: boolean;
	/** Exact result block id; fold code is embedded rather than the `<code>` placeholder. */
	resultId?: string;
};

export type PstackIdentity = {
	name: string;
	label: string;
};

export function foldCode(id: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < id.length; i++) {
		h ^= id.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(36).padStart(6, "0").slice(-6);
}

export function pstackIdentityFromMcpCall(callText: string | undefined): PstackIdentity | undefined {
	return pstackIdentity(parseOuterCall(callText));
}

export function pstackIdentityFromDigest(text: string | undefined): { code: string; identity: PstackIdentity } | undefined {
	if (typeof text !== "string") return undefined;
	const code = text.match(FOLD_TAG_RE)?.[1];
	const name = text.match(PSTACK_NAME_RE)?.[1];
	if (!code || !name) return undefined;
	const normalized = normalizePstackName(name);
	return { code, identity: { name: normalized, label: pstackLabel(normalized) } };
}

export function recallCodes(callText: string | undefined): string[] | undefined {
	const call = parseOuterCall(callText);
	const keys = Object.keys(call);
	if (keys.length !== 1 || keys[0] !== "codes") return undefined;
	const codes = call.codes;
	if (!Array.isArray(codes) || codes.length === 0) return undefined;
	if (!codes.every((code) => typeof code === "string" && code.length > 0)) return undefined;
	return [...codes] as string[];
}

export function pstackRecallSummary(identity: PstackIdentity, opts: SummaryOptions = {}): string {
	const code = opts.resultId ? foldCode(opts.resultId) : "<code>";
	return appendPotetoBeacon(
		[
			"tool_result:recall",
			`Contains: skill-pstack(name="${identity.name}")`,
			`Label: ${identity.label}`,
			`Full result preserved. Use recall({"codes":["${code}"]}) , not unfold, to re-read this exact pstack leaf.`,
		],
		identity,
		opts,
	).join("\n");
}

/**
 * Returns a recoverable summary for a non-MCP, non-recall tool result, or `undefined`
 * when the tool is not a recognised target (caller falls back to plain fold).
 * Currently handles: `read`, `grep`, `find`, `ls`.
 */
export function toolResultSummary(result: ViewBlock, call: ViewBlock | undefined): string | undefined {
	const tool = (result.toolName ?? "").trim().toLowerCase();
	if (tool === "read") return readSummary(result, call);
	if (tool === "subagent") return subagentSummary(result, call);
	if (tool === "grep") return grepSummary(result, call);
	if (tool === "find") return findSummary(result, call);
	if (tool === "ls") return lsSummary(result, call);
	return undefined;
}

function subagentSummary(result: ViewBlock, call: ViewBlock | undefined): string {
	const args = parseOuterCall(call?.text);
	const type = str(args.type) ?? "explore";
	const rawCwd = str(args.cwd);
	const cwd = rawCwd ? compactPath(rawCwd) : undefined;
	const rawTask = str(args.task);
	const customAgent = str(args.customAgent);
	const task = rawTask ? clip(rawTask, TASK_CAP) : "(unknown task)";
	const code = foldCode(result.id);

	const typePart = type === "custom" && customAgent
		? `type="custom" customAgent="${customAgent}"`
		: `type="${type}"`;
	const cwdPart = cwd ? ` cwd="${cwd}"` : "";

	const lines: string[] = [`tool_result:subagent ${typePart}${cwdPart}`];
	lines.push(`Task: ${task}`);
	const findings = extractSubagentFindings(result.text ?? "");
	if (findings.length > 0) lines.push(`Findings: ${findings.join(" \u00b7 ")}`);
	lines.push(`Full result preserved. Use recall({"codes":["${code}"]}) before rerunning this investigation.`);

	return lines.join("\n");
}

function extractSubagentFindings(text: string): string[] {
	const allLines = text.split("\n");

	// Pass 1: prefer markdown bullet / numbered lines.
	const bullets: string[] = [];
	for (const line of allLines) {
		const t = line.trim();
		if (!t || t.startsWith("#") || SEPARATOR_RE.test(t)) continue;
		const m = t.match(BULLET_RE);
		if (m) {
			bullets.push(clip(m[1].trim(), FINDING_CAP));
			if (bullets.length >= FINDINGS_MAX) break;
		}
	}
	if (bullets.length > 0) return bullets;

	// Pass 2: fallback to first useful prose lines.
	const prose: string[] = [];
	for (const line of allLines) {
		const t = line.trim();
		if (!t || t.startsWith("#") || SEPARATOR_RE.test(t)) continue;
		prose.push(clip(t, FINDING_CAP));
		if (prose.length >= FINDINGS_MAX) break;
	}
	return prose;
}

function readSummary(result: ViewBlock, call: ViewBlock | undefined): string {
	const args = parseOuterCall(call?.text);
	const rawPath = str(args.path);
	const path = rawPath ? compactPath(rawPath) : "(unknown path)";
	const text = result.text ?? "";
	const lineCount = text.split("\n").length;
	const tokenEst = Math.ceil(text.length / 4);
	const signals = readSignals(text);
	const code = foldCode(result.id);
	const lines: string[] = [`tool_result:read path="${path}"`];
	if (signals.length > 0) lines.push(`Contains: ${signals.join(" · ")}`);
	lines.push(`Shape: ${lineCount} lines · ~${tokenEst} tok`);
	lines.push(`Full result preserved. Use recall({"codes":["${code}"]}) for this prior read snapshot; re-read if the file may have changed.`);
	return lines.join("\n");
}

/** Compact a path: normalise slashes, abbreviate home prefix as `~`,
 *  middle-ellipsise if longer than COMPACT_PATH_MAX. */
export function compactPath(raw: string): string {
	let p = raw.replace(/\\/g, "/");
	p = p.replace(/^[A-Za-z]:\/[Uu]sers\/[^\/]+(?=\/)/, "~");
	p = p.replace(/^\/home\/[^\/]+(?=\/)/, "~");
	if (p.length <= COMPACT_PATH_MAX) return p;
	const parts = p.split("/");
	if (parts.length <= 3) return p;
	const last = parts[parts.length - 1];
	let prefix = parts[0];
	let best = `${prefix}/...${last ? "/" + last : ""}`;
	for (let i = 1; i < parts.length - 1; i++) {
		const candidate = `${prefix}/${parts[i]}/...${last ? "/" + last : ""}`;
		if (candidate.length <= COMPACT_PATH_MAX) { prefix = `${prefix}/${parts[i]}`; best = candidate; }
		else break;
	}
	return best;
}

function grepSummary(result: ViewBlock, call: ViewBlock | undefined): string {
	const args = parseOuterCall(call?.text);
	const pattern = str(args.pattern);
	const rawPath = str(args.path);
	const path = rawPath ? compactPath(rawPath) : undefined;

	const text = result.text ?? "";
	const lineCount = text.split("\n").length;
	const tokenEst = Math.ceil(text.length / 4);
	const code = foldCode(result.id);

	const identParts: string[] = [];
	if (pattern) identParts.push(`pattern="${clip(pattern, READ_SIGNAL_LEN)}"`);
	if (path) identParts.push(`path="${path}"`);
	const identity = identParts.length > 0 ? identParts.join(" ") : "(no pattern)";

	const output: string[] = [`tool_result:grep ${identity}`];
	const signals = grepSignals(text);
	if (signals.length > 0) output.push(`Contains: ${signals.join(" \u00b7 ")}`);
	output.push(`Shape: ${lineCount} lines \u00b7 ~${tokenEst} tok`);
	output.push(`Full result preserved. Use recall({"codes":["${code}"]}) before repeating this search.`);
	return output.join("\n");
}

function findSummary(result: ViewBlock, call: ViewBlock | undefined): string {
	const args = parseOuterCall(call?.text);
	const rawPath = str(args.path);
	const pattern = str(args.pattern);
	const path = rawPath ? compactPath(rawPath) : undefined;

	const text = result.text ?? "";
	const allLines = text.split("\n");
	const items = allLines.filter((l) => l.trim().length > 0).length;
	const tokenEst = Math.ceil(text.length / 4);
	const code = foldCode(result.id);

	const identParts: string[] = [];
	if (path) identParts.push(`path="${path}"`);
	if (pattern) identParts.push(`pattern="${clip(pattern, READ_SIGNAL_LEN)}"`);
	const identity = identParts.length > 0 ? identParts.join(" ") : "(no path)";

	const output: string[] = [`tool_result:find ${identity}`];
	const signals = listingSignals(allLines);
	if (signals.length > 0) output.push(`Contains: ${signals.join(" \u00b7 ")}`);
	output.push(`Shape: ${items} items \u00b7 ~${tokenEst} tok`);
	output.push(`Full result preserved. Use recall({"codes":["${code}"]}) before repeating this file discovery.`);
	return output.join("\n");
}

function lsSummary(result: ViewBlock, call: ViewBlock | undefined): string {
	const args = parseOuterCall(call?.text);
	const rawPath = str(args.path);
	const path = rawPath ? compactPath(rawPath) : undefined;

	const text = result.text ?? "";
	const allLines = text.split("\n");
	const items = allLines.filter((l) => l.trim().length > 0).length;
	const tokenEst = Math.ceil(text.length / 4);
	const code = foldCode(result.id);

	const identity = path ? `path="${path}"` : "(no path)";

	const output: string[] = [`tool_result:ls ${identity}`];
	const signals = listingSignals(allLines);
	if (signals.length > 0) output.push(`Contains: ${signals.join(" \u00b7 ")}`);
	output.push(`Shape: ${items} items \u00b7 ~${tokenEst} tok`);
	output.push(`Full result preserved. Use recall({"codes":["${code}"]}) before repeating this listing.`);
	return output.join("\n");
}

/** Extract capped signals from grep output: unique file paths from "file:line:content" lines,
 *  or plain content lines when no such pattern is present. */
function grepSignals(text: string): string[] {
	const signals: string[] = [];
	const filesSeen = new Set<string>();
	for (const line of text.split("\n")) {
		if (signals.length >= READ_SIGNAL_MAX) break;
		const t = line.trim();
		if (!t) continue;
		const fileMatch = t.match(/^([^:\s]+):\d+:/);
		if (fileMatch) {
			const file = fileMatch[1];
			if (!filesSeen.has(file)) {
				filesSeen.add(file);
				signals.push(clip(file, READ_SIGNAL_LEN));
			}
			continue;
		}
		signals.push(clip(t, READ_SIGNAL_LEN));
	}
	return signals;
}

/** Extract capped signals from listing output (find / ls): first non-empty lines. */
function listingSignals(lines: string[]): string[] {
	const signals: string[] = [];
	for (const line of lines) {
		if (signals.length >= READ_SIGNAL_MAX) break;
		const t = line.trim();
		if (!t) continue;
		signals.push(clip(t, READ_SIGNAL_LEN));
	}
	return signals;
}

function readSignals(text: string): string[] {
	const signals: string[] = [];
	for (const line of text.split("\n")) {
		if (signals.length >= READ_SIGNAL_MAX) break;
		const t = line.trim();
		if (!t) continue;
		const heading = t.match(/^#{1,3}\s+(.+)/);
		if (heading) { signals.push(clip(heading[1], READ_SIGNAL_LEN)); continue; }
		const exp = t.match(/^export\s+(?:(?:default|abstract)\s+)?(?:class|function|const|type|interface|enum)\s+\w/);
		if (exp) { signals.push(clip(t.replace(/[({].*$/, "").trim(), READ_SIGNAL_LEN)); continue; }
		const decl = t.match(/^(?:(?:abstract\s+)?class|(?:async\s+)?function)\s+\w/);
		if (decl) { signals.push(clip(t.replace(/[({].*$/, "").trim(), READ_SIGNAL_LEN)); continue; }
	}
	return signals;
}

/**
 * Canonical identity for a specific MCP tool call, derived purely from the parsed
 * call text. Key-order agnostic: equivalent JSON arguments produce the same fingerprint.
 * Sensitive argument values never appear in `displayLabel`.
 */
export type CanonicalMcpIdentity = {
	server: string;
	tool: string;
	fingerprint: string;
	displayLabel: string;
};

/**
 * Derive a canonical MCP identity from a `tool_call` block's text. Returns `undefined`
 * when the call text can't be parsed or doesn't have a recognisable tool name.
 */
export function canonicalMcpIdentity(callText: string | undefined): CanonicalMcpIdentity | undefined {
	const call = parseOuterCall(callText);
	const server = str(call.server) ?? str(call.connect) ?? "mcp";
	const tool = str(call.tool);
	if (!tool) return undefined;
	const args = parseNestedArgs(call.args);
	const fingerprint = argFingerprint(args);
	const safeDisplay = safeArgDisplay(args);
	const displayLabel = safeDisplay ? `${server}/${tool}(${safeDisplay})` : `${server}/${tool}`;
	return { server, tool, fingerprint, displayLabel };
}

/** Deterministic fingerprint of canonical args: key-sorted, sensitive values included for
 *  differentiation (they are never shown in digest text). Strength ≥ six-character handles. */
function argFingerprint(args: McpCall): string {
	const keys = Object.keys(args).sort();
	const canonical = keys.map((key) => `${key}=${JSON.stringify(args[key])}`).join(";");
	return foldCode(canonical);
}

/** Non-sensitive key=value pairs suitable for display in digest text. */
function safeArgDisplay(args: McpCall): string | undefined {
	const parts: string[] = [];
	for (const key of Object.keys(args).sort()) {
		if (SENSITIVE_KEY_RE.test(key)) continue;
		const v = args[key];
		if (typeof v === "string") parts.push(`${key}="${clip(v, 40)}"`);
		else if (typeof v === "number" || typeof v === "boolean") parts.push(`${key}=${v}`);
		if (parts.length >= 2) break;
	}
	return parts.length > 0 ? parts.join(", ") : undefined;
}

export function genericRecallSummary(codes: string[] | undefined): string {
	if (codes?.length === 1) {
		const [code] = codes;
		return [
			`tool_result:recall code="${code}"`,
			`Full result preserved. Use recall({"codes":["${code}"]}) if you need this exact prior result.`,
		].join("\n");
	}
	return ["tool_result:recall", `Full result preserved. Use ${RECALL_HINT} if you need this exact prior result.`].join("\n");
}

function appendPotetoBeacon(lines: string[], identity: PstackIdentity, opts: SummaryOptions): string[] {
	if (opts.potetoBeacon !== true || identity.name !== POTETO_MODE_NAME) return lines;
	return [...lines, ...POTETO_MODE_BEACON_LINES];
}

function pstackIdentity(call: McpCall): PstackIdentity | undefined {
	const tool = str(call.tool);
	if (!tool?.toLowerCase().endsWith("skill-pstack")) return undefined;
	const args = parseNestedArgs(call.args);
	const name = str(args.name);
	if (!name) return undefined;
	const normalized = normalizePstackName(name);
	return { name: normalized, label: pstackLabel(normalized) };
}

function genericIdentity(call: McpCall): string {
	const tool = str(call.tool);
	const head = tool ?? mcpLabel(call);
	const preview = primitiveArgsPreview(parseNestedArgs(call.args));
	return preview ? `${head}(${preview})` : head;
}

/** Identity of the MCP call when there is no recoverable tool identity. */
function mcpLabel(call: McpCall): string {
	const server = str(call.server);
	const search = str(call.search);
	if (search) return `${server ?? "mcp"} search`;
	const describe = str(call.describe);
	if (describe) return `${server ?? "mcp"} describe`;
	const connect = str(call.connect);
	if (connect) return `connect ${connect}`;
	const action = str(call.action);
	if (action) return `${server ?? "mcp"} ${action}`;
	if (server) return `${server} list`;
	return "mcp";
}

function primitiveArgsPreview(args: McpCall): string | undefined {
	const parts: string[] = [];
	for (const [key, value] of Object.entries(args)) {
		const formatted = primitivePreview(key, value);
		if (!formatted) continue;
		parts.push(formatted);
		if (parts.length === 3) break;
	}
	return parts.length > 0 ? parts.join(", ") : undefined;
}

function primitivePreview(key: string, value: unknown): string | undefined {
	if (SENSITIVE_KEY_RE.test(key)) return `${key}="${REDACTED}"`;
	if (typeof value === "string") return `${key}="${clip(value, 40)}"`;
	if (typeof value === "number" || typeof value === "boolean") return `${key}=${String(value)}`;
	if (value === null) return `${key}=null`;
	return undefined;
}

/**
 * Parse a tool_call's args: the JSON object from the first `{` to the end. Defensive — any
 * failure yields `{}` (same approach as `code-skeleton/classify.ts`).
 */
function parseOuterCall(callText: string | undefined): McpCall {
	if (typeof callText !== "string") return {};
	const start = callText.indexOf("{");
	if (start < 0) return {};
	try {
		const parsed: unknown = JSON.parse(callText.slice(start));
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as McpCall;
		}
	} catch {
		// fall through
	}
	return {};
}

function parseNestedArgs(args: unknown): McpCall {
	if (args && typeof args === "object" && !Array.isArray(args)) return args as McpCall;
	if (typeof args !== "string") return {};
	try {
		const parsed: unknown = JSON.parse(args);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as McpCall;
		}
	} catch {
		// fall through
	}
	return {};
}

function str(v: unknown): string | undefined {
	if (typeof v !== "string") return undefined;
	const t = v.trim();
	return t.length > 0 ? t : undefined;
}

function titleWords(slug: string): string {
	return slug
		.split(/[/-]+/)
		.filter((part) => part.length > 0)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function clip(s: string, max: number): string {
	const t = s.replace(/\s+/g, " ").trim();
	return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}
