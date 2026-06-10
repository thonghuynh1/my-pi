/**
 * tool-panel - Group all tool activity into a side panel/overlay so the
 * main chat view only shows AI thinking and final responses.
 *
 * Features:
 *  - Live "tool activity" widget rendered above the editor showing the
 *    most recent N tool invocations, their status, and a short summary.
 *  - `/tools` command opens a scrollable full-history overlay with details.
 *  - `/tool-panel` command toggles the widget on/off.
 *  - Built-in tool renderers (read/bash/edit/write/grep/find/ls) are
 *    overridden with minimal renderers so tool calls/results are quiet
 *    inside the chat scrollback — the chat keeps only assistant thinking
 *    and responses, while everything tool-related lives in the panel.
 *
 * Drop-in: this file is auto-discovered because the project's package.json
 * registers `./extensions` under `pi.extensions`. After install:
 *   /reload    (or restart pi)
 *   /tool-panel       to toggle the widget
 *   /tools            to open the full history overlay
 */

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	Theme,
} from "@earendil-works/pi-coding-agent";
import {
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
} from "@earendil-works/pi-coding-agent";
import { matchesKey, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Types & state
// ---------------------------------------------------------------------------

type ToolStatus = "running" | "done" | "error";

interface ToolRecord {
	id: string;
	name: string;
	args: any;
	status: ToolStatus;
	startedAt: number;
	endedAt?: number;
	summary: string; // one-line summary for the panel
	resultText?: string; // truncated raw text for the overlay
	fullResultLen?: number; // raw (untruncated) result length used for cost distribution
	// Cost accounting --------------------------------------------------
	// For regular tools these are filled in on the NEXT turn_end, when
	// the assistant message arrives carrying real billed usage. We then
	// distribute that turn's input cost across the pending tools by their
	// result size. For the `subagent` tool they come straight from the
	// child session's real usage (see subagents.ts).
	outputTokens?: number; // tokens model emitted to call this tool (args)
	inputTokens?: number; // tokens this tool's result added to the prompt
	costUsd?: number; // real $ contribution (not an estimate)
	modelId?: string; // model active when this tool was billed
	costAttributed?: boolean; // regular tool: set once turn_end priced it
}

type AssistantUsage = {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	totalTokens?: number;
	cost?: {
		input?: number;
		output?: number;
		cacheRead?: number;
		cacheWrite?: number;
		total?: number;
	};
};

const records: ToolRecord[] = [];
const recordById = new Map<string, ToolRecord>();
const MAX_RECORDS = 500; // cap memory across long sessions
const PANEL_VISIBLE_ROWS = 6; // most-recent N shown in widget

let panelEnabled = true;
let activeSubagentCount = 0;
const WIDGET_ID = "tool-panel";

// Real-billing tracking -----------------------------------------------
// Number of assistant messages already attributed in the current branch.
let processedAssistantCount = 0;
// Regular-tool records that have completed since the last assistant
// message; their cost is set when the next assistant turn arrives.
const pendingRegularTools: ToolRecord[] = [];
// Stashed for sessionTotals() so the widget renderer can read the real
// session branch (same source the footer uses) without being passed ctx.
let currentCtx: ExtensionContext | undefined;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortenPath(p: string | undefined): string {
	if (!p) return "";
	const home = homedir();
	if (p.startsWith(home)) return `~${p.slice(home.length)}`;
	return p;
}

function clip(s: string, max = 80): string {
	if (!s) return "";
	const oneLine = s.replace(/\s+/g, " ").trim();
	return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function summarize(toolName: string, args: any): string {
	if (!args || typeof args !== "object") return toolName;
	switch (toolName) {
		case "bash":
			return `$ ${clip(args.command ?? "", 90)}`;
		case "read": {
			const path = shortenPath(args.path);
			const range =
				args.offset !== undefined || args.limit !== undefined
					? `:${args.offset ?? 1}${args.limit !== undefined ? `+${args.limit}` : ""}`
					: "";
			return `read ${path}${range}`;
		}
		case "write":
			return `write ${shortenPath(args.path)}`;
		case "edit": {
			const n = Array.isArray(args.edits) ? args.edits.length : 1;
			return `edit ${shortenPath(args.path)} (${n} edit${n === 1 ? "" : "s"})`;
		}
		case "grep":
			return `grep /${clip(String(args.pattern ?? ""), 40)}/ in ${shortenPath(args.path) || "."}`;
		case "find":
			return `find ${clip(String(args.pattern ?? ""), 40)} in ${shortenPath(args.path) || "."}`;
		case "ls":
			return `ls ${shortenPath(args.path) || "."}`;
		default: {
			// generic: pick a short identifying string from common keys
			const id =
				args.path ??
				args.command ??
				args.pattern ??
				args.query ??
				args.url ??
				args.name ??
				"";
			return id ? `${toolName} ${clip(String(id), 80)}` : toolName;
		}
	}
}

function statusGlyph(status: ToolStatus, theme: Theme): string {
	switch (status) {
		case "running":
			return theme.fg("warning", "●");
		case "done":
			return theme.fg("success", "✓");
		case "error":
			return theme.fg("error", "✗");
	}
}

function fmtElapsed(rec: ToolRecord): string {
	const end = rec.endedAt ?? Date.now();
	const ms = Math.max(0, end - rec.startedAt);
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const s = Math.floor(ms / 1000);
	return `${Math.floor(s / 60)}m${s % 60}s`;
}

function pushRecord(rec: ToolRecord) {
	records.push(rec);
	recordById.set(rec.id, rec);
	while (records.length > MAX_RECORDS) {
		const dropped = records.shift();
		if (dropped) recordById.delete(dropped.id);
	}
}

function extractResultText(result: any): string {
	if (!result?.content) return "";
	const parts: string[] = [];
	for (const c of result.content) {
		if (c && c.type === "text" && typeof c.text === "string") parts.push(c.text);
	}
	return parts.join("\n");
}

// Conservative chars/4 token estimate (matches pi's internal heuristic).
function approxTokens(text: string): number {
	if (!text) return 0;
	return Math.ceil(text.length / 4);
}

function fmtTokens(n: number | undefined): string {
	if (!n || n <= 0) return "0";
	if (n < 1000) return `${n}`;
	if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
	return `${(n / 1_000_000).toFixed(2)}M`;
}

function fmtCost(usd: number | undefined): string {
	if (!usd || usd <= 0) return "$0";
	if (usd < 0.01) return `$${usd.toFixed(4)}`;
	if (usd < 1) return `$${usd.toFixed(3)}`;
	return `$${usd.toFixed(2)}`;
}

function fmtRecCost(rec: ToolRecord): string {
	// While a regular tool is still queued to be priced on the next
	// assistant turn, show "…" instead of a misleading $0.
	if (rec.costAttributed === false) return "…";
	return fmtCost(rec.costUsd);
}

// Returns the total USD cost of an assistant message, robustly: prefers
// the SDK-precomputed `cost.total` (which already includes input +
// output + cacheRead + cacheWrite at each rate), and falls back to
// summing the sub-fields if the provider forgot to fill `total`. This
// guarantees cache pricing is always counted even on quirky providers.
function totalCostOf(usage: AssistantUsage | undefined): number {
	if (!usage?.cost) return 0;
	if (typeof usage.cost.total === "number") return usage.cost.total;
	return (
		(usage.cost.input ?? 0) +
		(usage.cost.output ?? 0) +
		(usage.cost.cacheRead ?? 0) +
		(usage.cost.cacheWrite ?? 0)
	);
}

// Real session billing. Reads the parent's session branch (the same
// source `usage-footer.ts` uses) and ADDS subagent costs (which run in
// their own in-memory sessions and never appear in the parent branch).
function sessionTotals(): { tokens: number; costUsd: number } {
	let tokens = 0;
	let costUsd = 0;

	const sm = currentCtx?.sessionManager;
	if (sm) {
		for (const entry of sm.getBranch()) {
			if (entry.type !== "message" || entry.message.role !== "assistant") continue;
			const usage = (entry.message as { usage?: AssistantUsage }).usage;
			if (!usage) continue;
			const input = usage.input ?? 0;
			const output = usage.output ?? 0;
			const cacheRead = usage.cacheRead ?? 0;
			const cacheWrite = usage.cacheWrite ?? 0;
			tokens += usage.totalTokens ?? input + output + cacheRead + cacheWrite;
			costUsd += totalCostOf(usage);
		}
	}

	// Subagents live in their own sessions; add their real cost on top.
	for (const r of records) {
		if (r.name !== "subagent") continue;
		tokens += (r.inputTokens ?? 0) + (r.outputTokens ?? 0);
		costUsd += r.costUsd ?? 0;
	}

	return { tokens, costUsd };
}

// Walk the branch on turn_end, find any new assistant message(s) since
// last call, and distribute their *real* billed input cost across the
// regular tools that ran since the previous turn (weighted by result
// size). This gives each tool row a $ value that matches what the
// provider actually charged to feed that result back into the prompt.
function attributePendingTools(ctx: ExtensionContext): void {
	const sm = ctx.sessionManager;
	if (!sm) return;

	let seen = 0;
	let newInputCost = 0;
	let newInputTokens = 0;
	let lastModelId: string | undefined;

	for (const entry of sm.getBranch()) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		seen++;
		if (seen <= processedAssistantCount) continue;
		const usage = (entry.message as { usage?: AssistantUsage; model?: string }).usage;
		lastModelId = (entry.message as { model?: string }).model ?? lastModelId;
		if (!usage) continue;
		// "New" prompt cost this turn = freshly-billed input + any new
		// cache-write tokens (content promoted into the cache). cacheRead
		// is the cheap re-use of the already-cached prefix and is not
		// caused by the new tool results.
		newInputCost += (usage.cost?.input ?? 0) + (usage.cost?.cacheWrite ?? 0);
		newInputTokens += (usage.input ?? 0) + (usage.cacheWrite ?? 0);
	}

	processedAssistantCount = seen;

	if (pendingRegularTools.length === 0) return;
	if (newInputCost <= 0 && newInputTokens <= 0) return;

	let totalWeight = 0;
	for (const rec of pendingRegularTools) {
		totalWeight += rec.fullResultLen ?? rec.resultText?.length ?? 1;
	}
	if (totalWeight <= 0) totalWeight = pendingRegularTools.length;

	for (const rec of pendingRegularTools) {
		const w = (rec.fullResultLen ?? rec.resultText?.length ?? 1) / totalWeight;
		rec.costUsd = newInputCost * w;
		rec.inputTokens = Math.round(newInputTokens * w);
		rec.modelId = lastModelId ?? rec.modelId;
		rec.costAttributed = true;
	}
	pendingRegularTools.length = 0;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	let tuiRef: { requestRender: () => void } | undefined;

	// ----- widget renderer -----------------------------------------------
	const renderWidget = () => {
		return (tui: any, theme: Theme) => {
			tuiRef = tui;
			return {
				render(width: number): string[] {
					const lines: string[] = [];
					const totals = sessionTotals();
					const header =
						theme.fg("toolTitle", theme.bold("◆ Tool activity")) +
						theme.fg(
							"dim",
							`  ${records.length} calls · ~${fmtTokens(totals.tokens)} tok · ${fmtCost(totals.costUsd)}` +
								`  (/tools for history)`,
						);
					lines.push(truncateToWidth(header, width));

					if (records.length === 0) {
						lines.push(theme.fg("dim", "  (no tools used yet)"));
						return lines;
					}

					const recent = records.slice(-PANEL_VISIBLE_ROWS);
					for (const rec of recent) {
						const glyph = statusGlyph(rec.status, theme);
						const elapsed = fmtElapsed(rec);
						const tokens = (rec.inputTokens ?? 0) + (rec.outputTokens ?? 0);
						const meta = theme.fg(
							"dim",
							`${elapsed.padStart(5)}  ${fmtTokens(tokens).padStart(5)}t  ${fmtRecCost(rec).padStart(7)}`,
						);
						// reserve width for the right-aligned meta block so the summary truncates cleanly
						const metaWidth = visibleWidth(meta);
						const leftBudget = Math.max(10, width - metaWidth - 6);
						const body =
							theme.fg("accent", rec.name) +
							" " +
							theme.fg(
								"toolOutput",
								clip(rec.summary, Math.max(10, leftBudget - rec.name.length - 4)),
							);
						const left = `  ${glyph} ${body}`;
						const leftPadded =
							left +
							" ".repeat(Math.max(1, width - visibleWidth(left) - metaWidth));
						lines.push(truncateToWidth(leftPadded + meta, width));
					}

					if (records.length > PANEL_VISIBLE_ROWS) {
						const more = records.length - PANEL_VISIBLE_ROWS;
						lines.push(theme.fg("dim", `  … ${more} earlier hidden`));
					}
					return lines;
				},
				invalidate() {},
			};
		};
	};

	const refreshWidget = (ctx: { ui: any; hasUI: boolean }) => {
		if (!ctx.hasUI) return;
		// Hide the tool-panel widget while one or more subagents are running so
		// the screen real estate is freed up for the subagent status widget.
		// It reappears automatically when the last subagent finishes.
		if (!panelEnabled || activeSubagentCount > 0) {
			ctx.ui.setWidget(WIDGET_ID, undefined);
			return;
		}
		ctx.ui.setWidget(WIDGET_ID, renderWidget(), { placement: "aboveEditor" });
		tuiRef?.requestRender();
	};

	pi.on("session_start", (_event, ctx) => {
		activeSubagentCount = 0;
		currentCtx = ctx;
		processedAssistantCount = 0;
		pendingRegularTools.length = 0;
		if (!ctx.hasUI) return;
		refreshWidget(ctx);
	});

	// After every assistant turn, price the tools that ran since the
	// previous turn using the freshly-billed usage on the new message.
	pi.on("turn_end", (_event, ctx) => {
		currentCtx = ctx;
		attributePendingTools(ctx);
		refreshWidget(ctx);
	});
	pi.on("agent_end", (_event, ctx) => {
		currentCtx = ctx;
		attributePendingTools(ctx);
		refreshWidget(ctx);
	});

	// ----- track tool lifecycle ------------------------------------------
	pi.on("tool_execution_start", (event, ctx) => {
		currentCtx = ctx;
		if (event.toolName === "subagent") {
			activeSubagentCount += 1;
			refreshWidget(ctx);
			return; // skip recording until the subagent finishes
		}
		const rec: ToolRecord = {
			id: event.toolCallId,
			name: event.toolName,
			args: event.args,
			status: "running",
			startedAt: Date.now(),
			summary: summarize(event.toolName, event.args),
		};
		pushRecord(rec);
		refreshWidget(ctx);
	});

	pi.on("tool_execution_update", (event, ctx) => {
		const rec = recordById.get(event.toolCallId);
		if (!rec) return;
		// refresh args+summary in case they grew during streaming
		rec.args = event.args ?? rec.args;
		rec.summary = summarize(rec.name, rec.args);
		refreshWidget(ctx);
	});

	pi.on("tool_execution_end", (event, ctx) => {
		currentCtx = ctx;
		if (event.toolName === "subagent") {
			activeSubagentCount = Math.max(0, activeSubagentCount - 1);
			// Record the subagent call now (so its row appears once it's done
			// and the panel becomes visible again).
			const details = event.result?.details;
			const subagentUsage = details?.usage;
			const args = (details && { type: details.type, name: details.name, task: details.task }) ?? {};
			const fullResult = extractResultText(event.result);
			const rec: ToolRecord = {
				id: event.toolCallId,
				name: "subagent",
				args,
				status: event.isError ? "error" : "done",
				startedAt: Date.now(),
				endedAt: Date.now(),
				summary: summarize("subagent", args),
				resultText: clip(fullResult, 8_000),
				fullResultLen: fullResult.length,
				// Real usage from the child session.
				outputTokens: subagentUsage?.outputTokens ?? 0,
				inputTokens: subagentUsage?.inputTokens ?? 0,
				modelId: subagentUsage?.modelId,
				costUsd: subagentUsage?.costUsd ?? 0,
				costAttributed: true,
			};
			pushRecord(rec);
			// A subagent's own result text ALSO gets fed back into the
			// parent prompt on the next turn, so the parent will be billed
			// for it as input. Queue it for proportional attribution too
			// — but mark it already-priced so we don't overwrite the real
			// child-session cost. We track it via fullResultLen only.
			refreshWidget(ctx);
			return;
		}
		const rec = recordById.get(event.toolCallId);
		if (!rec) return;
		rec.status = event.isError ? "error" : "done";
		rec.endedAt = Date.now();
		const fullResult = extractResultText(event.result);
		rec.resultText = clip(fullResult, 8_000);
		rec.fullResultLen = fullResult.length;
		// `outputTokens` for a regular tool ≈ args size emitted by the
		// model. It's not used in cost math (the assistant turn that
		// emitted the call already has its real `cost.output` billed via
		// the session branch); we keep it for display only.
		rec.outputTokens = approxTokens(safeJson(rec.args));
		rec.inputTokens = 0; // filled in by attributePendingTools on next turn_end
		rec.costUsd = 0;
		rec.modelId = ctx.model?.id;
		rec.costAttributed = false;
		pendingRegularTools.push(rec);
		refreshWidget(ctx);
	});

	// ----- commands ------------------------------------------------------
	pi.registerCommand("tool-panel", {
		description: "Toggle the tool activity panel above the editor",
		handler: async (_args, ctx) => {
			panelEnabled = !panelEnabled;
			refreshWidget(ctx);
			ctx.ui.notify(`Tool panel ${panelEnabled ? "enabled" : "disabled"}`, "info");
		},
	});

	pi.registerCommand("tools", {
		description: "Open the full tool-usage history in an overlay",
		handler: async (_args, ctx: ExtensionCommandContext) => {
			if (!ctx.hasUI || ctx.mode !== "tui") {
				ctx.ui.notify(`${records.length} tool calls recorded`, "info");
				return;
			}
			await ctx.ui.custom<void>(
				(_tui, theme, _keybindings, done) => new ToolHistoryOverlay(theme, done),
				{ overlay: true, overlayOptions: { anchor: "center", width: "90%" } },
			);
		},
	});

	// ----- override built-in tool renderers with minimal display ---------
	// We delegate execution to the built-in tools and only override the
	// render slots so the chat scrollback stays clean.
	registerQuietBuiltins(pi);
}

// ---------------------------------------------------------------------------
// Built-in tool quiet overrides
// ---------------------------------------------------------------------------

function registerQuietBuiltins(pi: ExtensionAPI) {
	const cwd = process.cwd();
	const built = {
		read: createReadTool(cwd),
		bash: createBashTool(cwd),
		edit: createEditTool(cwd),
		write: createWriteTool(cwd),
		grep: createGrepTool(cwd),
		find: createFindTool(cwd),
		ls: createLsTool(cwd),
	};

	const empty = () => new Text("", 0, 0);

	const tinyCall = (label: string) => (args: any, theme: Theme) => {
		const summary = clip(summarize(label, args), 120);
		// single muted line: " → tool summary"
		const line =
			theme.fg("dim", " → ") +
			theme.fg("toolTitle", label) +
			" " +
			theme.fg("muted", summary.slice(label.length).trim());
		return new Text(line, 0, 0);
	};

	const wrap = (name: keyof typeof built, label: string, description: string) => {
		const builtin = built[name];
		pi.registerTool({
			name,
			label,
			description,
			parameters: builtin.parameters,
			async execute(toolCallId, params, signal, onUpdate, ctx) {
				// rebuild per-cwd so cwd changes work
				const tool: any =
					ctx.cwd === cwd
						? builtin
						: createToolByName(name, ctx.cwd);
				return tool.execute(toolCallId, params as any, signal, onUpdate);
			},
			renderCall: tinyCall(label),
			renderResult: empty,
		});
	};

	wrap("read", "read", "Read the contents of a file (output relayed via /tools panel).");
	wrap("bash", "bash", "Execute a bash command (output relayed via /tools panel).");
	wrap("edit", "edit", "Edit a file using exact text replacement (details in /tools panel).");
	wrap("write", "write", "Write contents to a file (status in /tools panel).");
	wrap("grep", "grep", "Search file contents with ripgrep (results in /tools panel).");
	wrap("find", "find", "Find files by glob pattern (results in /tools panel).");
	wrap("ls", "ls", "List directory contents (results in /tools panel).");
}

function createToolByName(name: string, cwd: string) {
	switch (name) {
		case "read":
			return createReadTool(cwd);
		case "bash":
			return createBashTool(cwd);
		case "edit":
			return createEditTool(cwd);
		case "write":
			return createWriteTool(cwd);
		case "grep":
			return createGrepTool(cwd);
		case "find":
			return createFindTool(cwd);
		case "ls":
			return createLsTool(cwd);
		default:
			throw new Error(`unknown built-in tool: ${name}`);
	}
}

// ---------------------------------------------------------------------------
// Full-history overlay component
// ---------------------------------------------------------------------------

class ToolHistoryOverlay {
	focused = false;
	private selected = Math.max(0, records.length - 1);
	private expanded = false;
	private scroll = 0;

	constructor(
		private theme: Theme,
		private done: (v: void) => void,
	) {}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || data === "q") {
			this.done(undefined as any);
			return;
		}
		if (records.length === 0) return;

		if (matchesKey(data, "up") || data === "k") {
			this.selected = Math.max(0, this.selected - 1);
			this.scroll = 0;
		} else if (matchesKey(data, "down") || data === "j") {
			this.selected = Math.min(records.length - 1, this.selected + 1);
			this.scroll = 0;
		} else if (matchesKey(data, "return") || data === " ") {
			this.expanded = !this.expanded;
			this.scroll = 0;
		} else if (data === "g") {
			this.selected = 0;
			this.scroll = 0;
		} else if (data === "G") {
			this.selected = records.length - 1;
			this.scroll = 0;
		} else if (this.expanded && data === "d") {
			this.scroll += 10;
		} else if (this.expanded && data === "u") {
			this.scroll = Math.max(0, this.scroll - 10);
		}
	}

	render(width: number): string[] {
		const th = this.theme;
		const w = Math.min(width, 120);
		const innerW = w - 2;

		const pad = (s: string, len: number) =>
			s + " ".repeat(Math.max(0, len - visibleWidth(s)));
		const row = (content: string) =>
			th.fg("border", "│") + pad(content, innerW) + th.fg("border", "│");

		const lines: string[] = [];
		lines.push(th.fg("border", `╭${"─".repeat(innerW)}╮`));
		const totals = sessionTotals();
		lines.push(
			row(
				` ${th.fg("accent", "◆ Tool history")} ${th.fg("dim", `(${records.length} calls · ~${fmtTokens(totals.tokens)} tok · ${fmtCost(totals.costUsd)} total)`)}`,
			),
		);
		lines.push(row(""));

		if (records.length === 0) {
			lines.push(row(` ${th.fg("dim", "No tools have been called yet in this session.")}`));
		} else {
			// list pane: show a window of ~12 records around selection
			const windowSize = 12;
			const start = Math.max(
				0,
				Math.min(records.length - windowSize, this.selected - Math.floor(windowSize / 2)),
			);
			const end = Math.min(records.length, start + windowSize);

			for (let i = start; i < end; i++) {
				const rec = records[i]!;
				const isSel = i === this.selected;
				const cursor = isSel ? th.fg("accent", "▶ ") : "  ";
				const glyph = statusGlyph(rec.status, th);
				const idx = th.fg("dim", `#${String(i + 1).padStart(3, " ")}`);
				const elapsed = th.fg("dim", fmtElapsed(rec).padStart(6, " "));
				const tok = (rec.inputTokens ?? 0) + (rec.outputTokens ?? 0);
				const meta = th.fg(
					"dim",
					`${fmtTokens(tok).padStart(5)}t ${fmtRecCost(rec).padStart(7)} ${elapsed}`,
				);
				const name = isSel
					? th.bold(th.fg("accent", rec.name.padEnd(6)))
					: th.fg("toolTitle", rec.name.padEnd(6));
				const summary = th.fg(
					"toolOutput",
					clip(rec.summary, Math.max(10, innerW - visibleWidth(meta) - 18)),
				);
				lines.push(row(` ${cursor}${glyph} ${idx} ${name} ${summary}  ${meta}`));
			}

			lines.push(row(""));

			// detail pane
			const sel = records[this.selected];
			if (sel) {
				lines.push(
					row(
						` ${th.fg("dim", "─── Details ")}${th.fg("dim", "─".repeat(Math.max(0, innerW - 14)))}`,
					),
				);
				lines.push(
					row(
						` ${th.fg("toolTitle", "tool:")} ${th.fg("accent", sel.name)}   ${th.fg("toolTitle", "status:")} ${statusGlyph(sel.status, th)} ${sel.status}   ${th.fg("toolTitle", "took:")} ${fmtElapsed(sel)}`,
					),
				);
				// cost line
				const outTok = sel.outputTokens ?? 0;
				const inTok = sel.inputTokens ?? 0;
				const totalTok = outTok + inTok;
				lines.push(
					row(
						` ${th.fg("toolTitle", "tokens:")} ${th.fg("accent", `${fmtTokens(totalTok)}`)} ` +
							th.fg(
								"dim",
								`(out ${fmtTokens(outTok)} args · in ${fmtTokens(inTok)} result)`,
							) +
							`   ${th.fg("toolTitle", "cost:")} ${th.fg("accent", fmtRecCost(sel))}` +
							(sel.modelId ? `  ${th.fg("dim", `@ ${sel.modelId}`)}` : ""),
					),
				);
				lines.push(row(` ${th.fg("toolTitle", "summary:")} ${th.fg("toolOutput", clip(sel.summary, innerW - 12))}`));

				// args
				const argsJson = safeJson(sel.args);
				const argsLines = wrapLines(argsJson, innerW - 4).slice(0, 4);
				lines.push(row(` ${th.fg("toolTitle", "args:")}`));
				for (const ln of argsLines) lines.push(row(`   ${th.fg("dim", ln)}`));

				// result (expanded only)
				if (this.expanded) {
					lines.push(row(""));
					lines.push(row(` ${th.fg("toolTitle", "output:")} ${th.fg("dim", "(↵/space collapse, d/u scroll)")}`));
					const all = wrapLines(sel.resultText ?? "(no text output)", innerW - 4);
					const maxShown = 14;
					const window = all.slice(this.scroll, this.scroll + maxShown);
					for (const ln of window)
						lines.push(row(`   ${th.fg("toolOutput", ln)}`));
					if (this.scroll + maxShown < all.length)
						lines.push(row(`   ${th.fg("dim", `… ${all.length - (this.scroll + maxShown)} more lines`)}`));
				} else {
					lines.push(
						row(` ${th.fg("dim", "(press ↵ or space to view output)")}`),
					);
				}
			}
		}

		lines.push(row(""));
		lines.push(
			row(
				` ${th.fg("dim", "↑↓ navigate • ↵/space expand • g/G top/bot • d/u page • esc close")}`,
			),
		);
		lines.push(th.fg("border", `╰${"─".repeat(innerW)}╯`));
		return lines;
	}

	invalidate(): void {}
	dispose(): void {}
}

function safeJson(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function wrapLines(text: string, width: number): string[] {
	const out: string[] = [];
	for (const raw of (text ?? "").split("\n")) {
		if (raw.length <= width) {
			out.push(raw);
			continue;
		}
		let i = 0;
		while (i < raw.length) {
			out.push(raw.slice(i, i + width));
			i += width;
		}
	}
	return out;
}
