/*
 * tools-audit.ts — list every active tool by estimated JSON-schema token cost,
 * heaviest first. Pure helper: takes the pi extension API and returns a text
 * report. No I/O, no UI. Called from a `/tools-audit` slash command registered
 * in accordion.ts.
 *
 * pi.getActiveTools() returns `string[]` of active names.
 * pi.getAllTools() returns metadata: { name, description, parameters, sourceInfo, ... }.
 * The wire `tools:` array sent to the provider is roughly `{ name, description,
 * parameters }` per tool — that triple is what we serialize and size with chars/4.
 *
 * Why a separate file: zero upstream-merge surface here, and a one-block touch in
 * accordion.ts.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface ToolMeta {
	name: string;
	description?: string;
	parameters?: unknown;
	sourceInfo?: { source?: string; path?: string };
}

interface AuditRow {
	name: string;
	tokens: number;
	source: string;
}

const CHARS_PER_TOKEN = 4;

/** Build the audit report text. Returns a multi-line string suitable for notify(). */
export function runToolsAudit(pi: ExtensionAPI): string {
	const api = pi as unknown as {
		getActiveTools?: () => string[];
		getAllTools?: () => ToolMeta[];
	};

	const activeNames = api.getActiveTools?.() ?? [];
	const allTools = api.getAllTools?.() ?? [];
	if (activeNames.length === 0 || allTools.length === 0) {
		return `tools-audit: no tools available (active=${activeNames.length}, all=${allTools.length}).`;
	}

	const activeSet = new Set(activeNames);
	const byName = new Map(allTools.map((t) => [t.name, t]));

	const rows: AuditRow[] = activeNames.map((name) => {
		const meta = byName.get(name);
		if (!meta) return { name, tokens: 0, source: "missing-metadata" };
		// What the provider actually receives in `tools[]`. Slightly low (no envelope
		// framing) but ranking is reliable, which is the point of an audit.
		const wire = { name: meta.name, description: meta.description ?? "", parameters: meta.parameters ?? {} };
		const json = safeStringify(wire);
		return {
			name,
			tokens: Math.ceil(json.length / CHARS_PER_TOKEN),
			source: meta.sourceInfo?.source ?? "?",
		};
	}).sort((a, b) => b.tokens - a.tokens);

	const total = rows.reduce((n, r) => n + r.tokens, 0);
	const nameW = Math.max(4, ...rows.map((r) => r.name.length));
	const srcW = Math.max(6, ...rows.map((r) => r.source.length));

	const lines: string[] = [];
	lines.push(`Active tools: ${rows.length} · total ~${total.toLocaleString()} tok (chars/4 of {name, description, parameters})`);
	lines.push("");
	lines.push(`${"name".padEnd(nameW)}  ${"source".padEnd(srcW)}  tokens     %   cum%`);
	lines.push(`${"-".repeat(nameW)}  ${"-".repeat(srcW)}  ------  ----   ----`);
	let running = 0;
	for (const r of rows) {
		running += r.tokens;
		const pct = total > 0 ? ((r.tokens / total) * 100).toFixed(1).padStart(4) : "  - ";
		const cum = total > 0 ? ((running / total) * 100).toFixed(0).padStart(3) : " - ";
		lines.push(`${r.name.padEnd(nameW)}  ${r.source.padEnd(srcW)}  ${String(r.tokens).padStart(6)}  ${pct}%   ${cum}%`);
	}
	lines.push("");
	lines.push("Tip: prune the top of the list first. Extension/sdk tools are easier to drop than builtins.");
	return lines.join("\n");
}

/** JSON.stringify with cycle / BigInt safety; returns "" if the shape can't be serialized. */
function safeStringify(v: unknown): string {
	try {
		return JSON.stringify(v) ?? "";
	} catch {
		return "";
	}
}
