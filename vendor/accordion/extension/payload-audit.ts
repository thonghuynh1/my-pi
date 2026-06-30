/*
 * payload-audit.ts — one-shot probe that dumps the actual provider payload's
 * per-field token cost so we can find where the "other" bucket of the harness
 * actually goes. (tools-audit.ts only sees pi.getAllTools(); MCP tools and any
 * payload-time injections are invisible there.)
 *
 * Wiring:
 *   - install() registers a permanent `before_provider_request` hook AND the
 *     `/payload-audit` slash command. The hook is cheap (one boolean check)
 *     when not armed; it logs once and disarms itself after firing.
 *   - The user runs `/payload-audit`, sends any message, sees the breakdown.
 *
 * No GUI plumbing yet: this is the "find the missing bytes" probe; once we know
 * what dominates "other" we can name buckets and pipe them through the harness
 * frame the way slice 0 does for sys + total.
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

const CHARS_PER_TOKEN = 4;
const TOOLS_TOP_N = 12;
const MESSAGE_TOP_N = 5;

let armed = false;
let installed = false;

/**
 * Latest payload sizes observed by the always-on before_provider_request hook.
 * All counts are chars/4 of JSON.stringify of the corresponding field. Null
 * until the first provider request fires. The harness frame in accordion.ts
 * reads these and ships them to the GUI so the dashboard can name buckets
 * inside the harness without an arm step.
 */
export interface PayloadSizes {
	actualWireTokens: number;
	messagesTokens: number;
	toolsTokens: number;
	systemPayloadTokens: number;
}
let latest: PayloadSizes | null = null;

/** Snapshot of the most recent payload sizes (or null before the first request). */
export function getLatestSizes(): PayloadSizes | null {
	return latest;
}

/** Register the hook + command. Idempotent — safe to call from session_start. */
export function install(pi: ExtensionAPI): void {
	if (installed) return;
	installed = true;

	const api = pi as unknown as {
		on?: (event: string, handler: (event: { payload?: unknown }) => unknown) => void;
		registerCommand?: (name: string, opts: { description: string; handler: (args: string, ctx: ExtensionCommandContext) => unknown }) => void;
	};

	api.on?.("before_provider_request", (event) => {
		// Always-on: record cheap per-field sizes so the harness frame can ship them
		// to the GUI without an arm step. The detailed console dump remains opt-in
		// via the `armed` flag below.
		try { latest = recordSizes(event?.payload); } catch { /* best-effort */ }
		if (!armed) return undefined;
		armed = false;
		try {
			const report = buildReport(event?.payload);
			console.log("\n──────── payload-audit ────────\n" + report + "\n───────────────────────────────\n");
		} catch (err) {
			console.error("payload-audit: failed to summarize payload:", err);
		}
		return undefined;
	});

	api.registerCommand?.("payload-audit", {
		description: "Capture the next provider request's payload and print per-field token sizes",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			armed = true;
			ctx.ui.notify("payload-audit: armed. Send any message to trigger the probe; output prints to the pi console.", "info");
		},
	});
}

// ──────────────────────────── report ────────────────────────────

// ──────────────────────── sizes (always-on) ────────────────────────

/**
 * Compute chars/4 of each top-level field that contributes to the wire payload.
 * `actualWireTokens` is the whole payload — includes small framing fields the
 * other buckets don't capture so `wire ≈ messages + tools + system + framing`.
 */
function recordSizes(payload: unknown): PayloadSizes {
	const zero: PayloadSizes = { actualWireTokens: 0, messagesTokens: 0, toolsTokens: 0, systemPayloadTokens: 0 };
	if (!payload || typeof payload !== "object") return zero;
	const p = payload as Record<string, unknown>;
	return {
		actualWireTokens: tokenSize(p),
		messagesTokens: tokenSize(p.messages),
		toolsTokens: tokenSize(p.tools),
		systemPayloadTokens: tokenSize(p.system),
	};
}

function buildReport(payload: unknown): string {
	if (!payload || typeof payload !== "object") {
		return `payload not an object (typeof=${typeof payload})`;
	}
	const p = payload as Record<string, unknown>;
	const lines: string[] = [];

	// Top-level field sizes ─ this is the headline. Everything else is detail.
	const keys = Object.keys(p);
	const rows = keys.map((k) => ({ key: k, tokens: tokenSize(p[k]) }))
		.sort((a, b) => b.tokens - a.tokens);
	const total = rows.reduce((n, r) => n + r.tokens, 0);
	const keyW = Math.max(4, ...rows.map((r) => r.key.length));

	lines.push(`Provider payload: ${keys.length} top-level fields · total ~${total.toLocaleString()} tok (chars/4 of JSON.stringify per field)`);
	lines.push("");
	lines.push(`${"field".padEnd(keyW)}   tokens     %`);
	lines.push(`${"-".repeat(keyW)}   ------   ----`);
	for (const r of rows) {
		const pct = total > 0 ? ((r.tokens / total) * 100).toFixed(1).padStart(4) : "  - ";
		lines.push(`${r.key.padEnd(keyW)}   ${String(r.tokens).padStart(6)}   ${pct}%`);
	}

	// tools breakdown — usually the biggest mystery bucket
	const tools = p.tools;
	if (Array.isArray(tools) && tools.length > 0) {
		lines.push("");
		lines.push(`tools[]: ${tools.length} entries`);
		const toolRows = tools.map((t, i) => ({
			name: pickToolName(t) ?? `<#${i}>`,
			tokens: tokenSize(t),
		})).sort((a, b) => b.tokens - a.tokens);
		const toolTotal = toolRows.reduce((n, r) => n + r.tokens, 0);
		const nameW = Math.max(4, ...toolRows.slice(0, TOOLS_TOP_N).map((r) => r.name.length));
		lines.push(`${"  name".padEnd(nameW + 2)}   tokens     %`);
		lines.push(`  ${"-".repeat(nameW)}   ------   ----`);
		let running = 0;
		for (const r of toolRows.slice(0, TOOLS_TOP_N)) {
			running += r.tokens;
			const pct = toolTotal > 0 ? ((r.tokens / toolTotal) * 100).toFixed(1).padStart(4) : "  - ";
			lines.push(`  ${r.name.padEnd(nameW)}   ${String(r.tokens).padStart(6)}   ${pct}%`);
		}
		if (toolRows.length > TOOLS_TOP_N) {
			const rest = toolTotal - running;
			lines.push(`  ${`(+${toolRows.length - TOOLS_TOP_N} more)`.padEnd(nameW)}   ${String(rest).padStart(6)}   ${((rest / toolTotal) * 100).toFixed(1).padStart(4)}%`);
		}
		lines.push(`  tools[] subtotal: ${toolTotal.toLocaleString()} tok`);
	}

	// system breakdown — string OR array of blocks. Array form usually means cache_control wrappers.
	const system = p.system;
	if (Array.isArray(system)) {
		lines.push("");
		lines.push(`system[]: ${system.length} block(s) (array form — usually carries cache_control)`);
		system.forEach((block, i) => {
			const t = tokenSize(block);
			const type = (block && typeof block === "object" && "type" in (block as Record<string, unknown>))
				? String((block as Record<string, unknown>).type)
				: typeof block;
			lines.push(`  [${i}] type=${type} · ${t.toLocaleString()} tok`);
		});
	} else if (typeof system === "string") {
		lines.push("");
		lines.push(`system: string, ${tokenSize(system).toLocaleString()} tok`);
	}

	// messages summary — heaviest first, no full body dump
	const messages = p.messages;
	if (Array.isArray(messages) && messages.length > 0) {
		lines.push("");
		lines.push(`messages[]: ${messages.length} entries`);
		const msgRows = messages.map((m, i) => ({
			label: messageLabel(m, i),
			tokens: tokenSize(m),
		})).sort((a, b) => b.tokens - a.tokens).slice(0, MESSAGE_TOP_N);
		for (const r of msgRows) lines.push(`  ${r.label} · ${r.tokens.toLocaleString()} tok`);
	}

	return lines.join("\n");
}

// ──────────────────────────── helpers ────────────────────────────

function tokenSize(v: unknown): number {
	const s = safeStringify(v);
	return Math.ceil(s.length / CHARS_PER_TOKEN);
}

function safeStringify(v: unknown): string {
	if (v === undefined) return "";
	try { return JSON.stringify(v) ?? ""; } catch { return ""; }
}

function pickToolName(t: unknown): string | undefined {
	if (!t || typeof t !== "object") return undefined;
	const o = t as Record<string, unknown>;
	// Anthropic: { name, description, input_schema }
	if (typeof o.name === "string") return o.name;
	// OpenAI: { type:"function", function:{ name, ... } }
	if (o.function && typeof o.function === "object") {
		const fn = o.function as Record<string, unknown>;
		if (typeof fn.name === "string") return fn.name;
	}
	return undefined;
}

function messageLabel(m: unknown, i: number): string {
	if (!m || typeof m !== "object") return `[${i}] <non-object>`;
	const o = m as Record<string, unknown>;
	const role = typeof o.role === "string" ? o.role : "?";
	const content = o.content;
	let kind = "text";
	if (Array.isArray(content) && content.length > 0) {
		const first = content[0];
		if (first && typeof first === "object" && "type" in (first as Record<string, unknown>)) {
			kind = String((first as Record<string, unknown>).type);
		}
		if (content.length > 1) kind += `+${content.length - 1}`;
	}
	return `[${i}] ${role}/${kind}`;
}
