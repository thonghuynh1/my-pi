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

/** An MCP tool result: a `tool_result` whose tool is the `mcp` gateway (case-insensitive). */
export function isMcpResult(b: ViewBlock): boolean {
	return b.kind === "tool_result" && (b.toolName ?? "").trim().toLowerCase() === "mcp";
}

/** Estimated token cost of a summary body once the host tags and frames it (chars/4 + overhead). */
export function estSummaryTokens(summary: string): number {
	return Math.ceil(summary.length / 4) + SUMMARY_OVERHEAD_TOKENS;
}

/**
 * A recoverable one-line summary for a folded MCP tool result. `call` is the paired
 * `tool_call` block (matched by `callId`), or undefined when it can't be recovered.
 */
export function mcpSummary(result: ViewBlock, call: ViewBlock | undefined): string {
	const parts = [`mcp · ${mcpLabel(call)}`, resultSize(result)];
	const peek = argsPeek(call);
	if (peek) parts.push(peek);
	parts.push("unfold to reuse instead of re-calling");
	return parts.join(" · ");
}

// ───────────────────────────── helpers ─────────────────────────────

/** Identity of the MCP call: `server/tool`, or the action verb (search/describe/connect/…). */
function mcpLabel(call: ViewBlock | undefined): string {
	const a = parseArgs(call?.text);
	const server = str(a.server);
	const tool = str(a.tool);
	if (tool) return server ? `${server}/${tool}` : tool;
	const search = str(a.search);
	if (search) return `${server ?? "mcp"} (search: ${clip(search, 30)})`;
	const describe = str(a.describe);
	if (describe) return `${server ?? "mcp"} (describe: ${describe})`;
	const connect = str(a.connect);
	if (connect) return `connect ${connect}`;
	const action = str(a.action);
	if (action) return `${server ?? "mcp"} (${action})`;
	if (server) return `${server} (list)`;
	return "mcp";
}

/** A short peek at the nested tool args the gateway forwards (`args` is a JSON string). */
function argsPeek(call: ViewBlock | undefined): string | undefined {
	const a = parseArgs(call?.text);
	const inner = str(a.args);
	if (!inner) return undefined;
	return `args ${clip(inner, 50)}`;
}

/** Size descriptor for the result body: error / empty / `N lines, ~T tok`. */
function resultSize(b: ViewBlock): string {
	if (b.isError) return "error";
	const text = b.text ?? "";
	if (!text.trim()) return "empty";
	const lines = text.split("\n").filter((l) => l.trim()).length;
	return `${lines} line${lines === 1 ? "" : "s"}, ~${b.tokens} tok`;
}

/**
 * Parse a tool_call's args: the JSON object from the first `{` to the end. Defensive — any
 * failure yields `{}` (same approach as `code-skeleton/classify.ts`).
 */
function parseArgs(callText: string | undefined): Record<string, unknown> {
	if (typeof callText !== "string") return {};
	const start = callText.indexOf("{");
	if (start < 0) return {};
	try {
		const parsed: unknown = JSON.parse(callText.slice(start));
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
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

function clip(s: string, max: number): string {
	const t = s.replace(/\s+/g, " ").trim();
	return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}
