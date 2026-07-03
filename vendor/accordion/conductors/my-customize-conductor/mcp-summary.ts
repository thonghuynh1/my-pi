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
				`Full result preserved. Use ${RECALL_HINT}, not unfold, before re-calling this exact MCP tool.`,
			],
			pstack,
			opts,
		).join("\n");
	}
	return [
		`tool_result:mcp ${genericIdentity(parsed)}`,
		`Full result preserved. Use ${RECALL_HINT} if you need this exact prior result.`,
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
	return appendPotetoBeacon(
		[
			"tool_result:recall",
			`Contains: skill-pstack(name="${identity.name}")`,
			`Label: ${identity.label}`,
			`Full result preserved. Use ${RECALL_HINT}, not unfold, to re-read this exact pstack leaf.`,
		],
		identity,
		opts,
	).join("\n");
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
