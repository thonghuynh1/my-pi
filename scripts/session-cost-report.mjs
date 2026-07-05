#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const [, , sessionPathArg, ...rest] = process.argv;

if (!sessionPathArg || sessionPathArg === "-h" || sessionPathArg === "--help") {
  console.error(`Usage: node scripts/session-cost-report.mjs <session.jsonl> [--from "user text"] [--out <report.json>]

Creates a readable JSON cost/cache diagnostic report for a Pi session JSONL.
Flags:
  --from <text>           Only compute scoped totals from the first user message containing text.
  --out <path>            Output path. Default: .diagnostics/session-cost/<session-name>.cost-report.json
  --accordion-log <path>  Optional Accordion context diagnostic JSONL. Defaults to ~/.accordion/diagnostics/*.context.jsonl`);
  process.exit(sessionPathArg ? 0 : 1);
}

function optionValue(name) {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
}

const sessionPath = resolve(sessionPathArg);
const fromText = optionValue("--from");
const outArg = optionValue("--out");
const accordionLogArg = optionValue("--accordion-log");

const CACHE_MISS_MIN_COST = 0.05;
const CACHE_MISS_MAX_CACHE_READ = 10_000;
const EXPENSIVE_MIN_COST = 0.12;
const CACHE_TAX_MIN_COST = 0.05;
const OUTPUT_SPIKE_MIN_COST = 0.05;
const HIGH_FRESH_INPUT_MIN_TOKENS = 10_000;
const FOLDED_MARKER_RE = /\{#[0-9a-fA-F]+ FOLDED\}/g;

function textOfContent(content) {
  if (!Array.isArray(content)) return "";
  return content.map((part) => typeof part?.text === "string" ? part.text : "").join("");
}

function totalCost(usage) {
  const cost = usage?.cost ?? {};
  return Number(cost.total ?? ((cost.input ?? 0) + (cost.output ?? 0) + (cost.cacheRead ?? 0) + (cost.cacheWrite ?? 0)) ?? 0);
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 1_000_000) / 1_000_000;
}

function foldedMarkersInText(text) {
  if (typeof text !== "string") return [];
  return [...text.matchAll(FOLDED_MARKER_RE)].map((match) => match[0]);
}

function foldedMarkersInValue(value, markers = []) {
  if (typeof value === "string") {
    markers.push(...foldedMarkersInText(value));
    return markers;
  }
  if (Array.isArray(value)) {
    for (const item of value) foldedMarkersInValue(item, markers);
    return markers;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) foldedMarkersInValue(item, markers);
  }
  return markers;
}

function summarizeToolCalls(content) {
  if (!Array.isArray(content)) return [];
  return content
    .filter((part) => part?.type === "toolCall")
    .map((part) => {
      const args = part.arguments ?? part.input ?? part.args ?? {};
      return {
        name: part.name ?? part.toolName ?? null,
        path: typeof args.path === "string" ? args.path : undefined,
        command: typeof args.command === "string" ? args.command.slice(0, 160) : undefined,
        argKeys: args && typeof args === "object" ? Object.keys(args).slice(0, 20) : [],
      };
    });
}

function classify(row, previousAssistantRow) {
  const reasons = [];
  if (row.cost.total > CACHE_MISS_MIN_COST && row.tokens.cacheRead < CACHE_MISS_MAX_CACHE_READ) {
    reasons.push("cache_miss");
  }
  if (row.cost.total >= EXPENSIVE_MIN_COST) reasons.push("expensive_turn");
  if (row.cost.cacheRead >= CACHE_TAX_MIN_COST) reasons.push("cache_tax");
  if (row.cost.output >= OUTPUT_SPIKE_MIN_COST) reasons.push("output_spike");
  if (row.tokens.input >= HIGH_FRESH_INPUT_MIN_TOKENS) reasons.push("high_fresh_input");
  if (previousAssistantRow?.stopReason === "aborted" && reasons.includes("cache_miss")) {
    reasons.push("abort_before_cache_miss");
  }
  if (row.accordion?.foldMarkersBeforeTurn > 0 && reasons.includes("cache_miss")) {
    reasons.push("accordion_folded_cache_miss");
  }
  if (row.accordion?.contextDiagnostic?.event === "accordion_context_apply_plan" && row.accordion.contextDiagnostic.changed && reasons.includes("cache_miss")) {
    reasons.push("accordion_context_cache_miss");
  }
  return reasons;
}

function loadAccordionContextDiagnostics(explicitPath) {
  const paths = [];
  if (explicitPath) {
    const resolved = resolve(explicitPath);
    if (existsSync(resolved) && statSync(resolved).isFile()) paths.push(resolved);
  } else {
    const dir = join(homedir(), ".accordion", "diagnostics");
    if (existsSync(dir)) {
      for (const name of readdirSync(dir)) {
        if (name.endsWith(".context.jsonl")) paths.push(join(dir, name));
      }
    }
  }

  const out = [];
  for (const path of paths) {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        const ms = Date.parse(event.timestamp);
        if (!Number.isFinite(ms)) continue;
        out.push({ ...event, _source: path, _timeMs: ms });
      } catch {
        // ignore malformed diagnostic lines
      }
    }
  }
  return out.sort((a, b) => a._timeMs - b._timeMs);
}

function compactContextDiagnostic(event) {
  if (!event) return null;
  return {
    event: event.event,
    timestamp: event.timestamp,
    source: event._source,
    sessionId: event.sessionId,
    reqId: event.reqId,
    changed: Boolean(event.changed),
    foldOpsRequested: event.foldOpsRequested ?? 0,
    groupOpsRequested: event.groupOpsRequested ?? 0,
    foldMarkersInAppliedPayload: event.foldMarkersInAppliedPayload ?? 0,
    foldMarkersInOriginalPayload: event.foldMarkersInOriginalPayload ?? 0,
    originalTokensApprox: event.originalTokensApprox ?? null,
    appliedTokensApprox: event.appliedTokensApprox ?? null,
    frozenFromIndex: event.frozenFromIndex ?? null,
  };
}

function attachAccordionContextDiagnostics(rows, diagnostics) {
  if (diagnostics.length === 0 || rows.length === 0) return [];
  const sessionStartMs = Date.parse(rows[0].timestamp) - 60_000;
  const sessionEndMs = Date.parse(rows[rows.length - 1].timestamp) + 60_000;
  const relevant = diagnostics.filter((event) => event._timeMs >= sessionStartMs && event._timeMs <= sessionEndMs);
  let i = 0;
  let latest = null;
  for (const row of rows) {
    const rowMs = Date.parse(row.timestamp);
    while (i < relevant.length && relevant[i]._timeMs <= rowMs) {
      latest = relevant[i];
      i += 1;
    }
    row.accordion.contextDiagnostic = compactContextDiagnostic(latest);
  }
  return relevant.map(compactContextDiagnostic);
}

const lines = readFileSync(sessionPath, "utf8").split(/\r?\n/).filter(Boolean);
const events = [];
const accordionEvents = [];
let fromLine = null;
let previousAssistantRow = null;
let cumulativeFoldMarkers = 0;
let firstFoldLine = null;

for (let index = 0; index < lines.length; index += 1) {
  const lineNumber = index + 1;
  let event;
  try {
    event = JSON.parse(lines[index]);
  } catch (error) {
    events.push({ line: lineNumber, parseError: String(error) });
    continue;
  }

  const message = event.message;
  const foldMarkersBeforeLine = cumulativeFoldMarkers;
  const markersOnLine = foldedMarkersInValue(message ?? event);
  if (markersOnLine.length > 0) {
    if (firstFoldLine == null) firstFoldLine = lineNumber;
    cumulativeFoldMarkers += markersOnLine.length;
    accordionEvents.push({
      line: lineNumber,
      timestamp: event.timestamp,
      role: message?.role ?? null,
      toolName: message?.toolName ?? null,
      markerCount: markersOnLine.length,
      markers: [...new Set(markersOnLine)].slice(0, 10),
    });
  }

  if (event.type === "message" && message?.role === "user" && fromText && fromLine == null) {
    const userText = textOfContent(message.content);
    if (userText.includes(fromText)) fromLine = lineNumber;
  }

  if (event.type !== "message" || message?.role !== "assistant" || !message.usage) continue;

  const usage = message.usage;
  const cost = usage.cost ?? {};
  const row = {
    line: lineNumber,
    timestamp: event.timestamp,
    provider: message.provider ?? null,
    model: message.model ?? null,
    stopReason: message.stopReason ?? null,
    errorMessage: message.errorMessage ?? null,
    responseId: message.responseId ?? null,
    tokens: {
      input: Number(usage.input ?? 0),
      output: Number(usage.output ?? 0),
      cacheRead: Number(usage.cacheRead ?? 0),
      cacheWrite: Number(usage.cacheWrite ?? 0),
      total: Number(usage.totalTokens ?? 0),
    },
    cost: {
      input: roundMoney(cost.input ?? 0),
      output: roundMoney(cost.output ?? 0),
      cacheRead: roundMoney(cost.cacheRead ?? 0),
      cacheWrite: roundMoney(cost.cacheWrite ?? 0),
      total: roundMoney(totalCost(usage)),
    },
    toolCalls: summarizeToolCalls(message.content),
    contentTypes: Array.isArray(message.content) ? message.content.map((part) => part?.type) : [],
    accordion: {
      foldMarkersBeforeTurn: foldMarkersBeforeLine,
      foldedMarkerCountInThisMessage: markersOnLine.length,
      foldedContextLikely: foldMarkersBeforeLine > 0,
    },
  };
  row.reasons = classify(row, previousAssistantRow);
  events.push(row);
  previousAssistantRow = row;
}

function sumRows(rows) {
  return rows.reduce((acc, row) => {
    if (!row.cost) return acc;
    acc.turns += 1;
    acc.tokens.input += row.tokens.input;
    acc.tokens.output += row.tokens.output;
    acc.tokens.cacheRead += row.tokens.cacheRead;
    acc.tokens.cacheWrite += row.tokens.cacheWrite;
    acc.cost.input = roundMoney(acc.cost.input + row.cost.input);
    acc.cost.output = roundMoney(acc.cost.output + row.cost.output);
    acc.cost.cacheRead = roundMoney(acc.cost.cacheRead + row.cost.cacheRead);
    acc.cost.cacheWrite = roundMoney(acc.cost.cacheWrite + row.cost.cacheWrite);
    acc.cost.total = roundMoney(acc.cost.total + row.cost.total);
    return acc;
  }, {
    turns: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  });
}

const assistantRows = events.filter((event) => event.cost);
const contextDiagnostics = loadAccordionContextDiagnostics(accordionLogArg);
const matchedContextDiagnostics = attachAccordionContextDiagnostics(assistantRows, contextDiagnostics);
for (let i = 0; i < assistantRows.length; i += 1) {
  assistantRows[i].reasons = classify(assistantRows[i], i > 0 ? assistantRows[i - 1] : null);
}
const scopedRows = fromText && fromLine != null ? assistantRows.filter((row) => row.line >= fromLine) : assistantRows;
const flaggedRows = scopedRows.filter((row) => row.reasons.length > 0);
const accordionScopedRows = scopedRows.filter((row) => row.accordion?.foldedContextLikely);
const accordionCacheMissRows = scopedRows.filter((row) => row.reasons.includes("accordion_folded_cache_miss"));
const accordionContextCacheMissRows = scopedRows.filter((row) => row.reasons.includes("accordion_context_cache_miss"));

const report = {
  generatedAt: new Date().toISOString(),
  sessionPath,
  scope: fromText ? { fromText, fromLine, matched: fromLine != null } : { fromText: null, fromLine: null, matched: false },
  rules: {
    cache_miss: `cost.total > ${CACHE_MISS_MIN_COST} && tokens.cacheRead < ${CACHE_MISS_MAX_CACHE_READ}`,
    expensive_turn: `cost.total >= ${EXPENSIVE_MIN_COST}`,
    cache_tax: `cost.cacheRead >= ${CACHE_TAX_MIN_COST}`,
    output_spike: `cost.output >= ${OUTPUT_SPIKE_MIN_COST}`,
    high_fresh_input: `tokens.input >= ${HIGH_FRESH_INPUT_MIN_TOKENS}`,
    abort_before_cache_miss: "previous assistant stopReason is aborted and current row is cache_miss",
    accordion_folded_cache_miss: "a cache_miss happened after at least one {#... FOLDED} marker appeared in the session log",
    accordion_context_cache_miss: "a cache_miss happened after Accordion's context hook logged that it changed the provider-bound payload",
  },
  accordion: {
    note: "sessionMarkers are visible {#... FOLDED} strings in the saved Pi JSONL and can include examples/grep output. contextDiagnostics come from Accordion's context hook and are the source of truth for provider-bound folding.",
    contextDiagnostics: {
      loadedCount: contextDiagnostics.length,
      matchedCount: matchedContextDiagnostics.length,
      matched: matchedContextDiagnostics,
      contextCacheMissCount: accordionContextCacheMissRows.length,
      contextCacheMissLines: accordionContextCacheMissRows.map((row) => row.line),
      contextCacheMissCost: roundMoney(accordionContextCacheMissRows.reduce((sum, row) => sum + row.cost.total, 0)),
    },
    foldedMarkerCount: cumulativeFoldMarkers,
    firstFoldLine,
    foldedEvents: accordionEvents,
    scopedTurnsAfterFold: accordionScopedRows.length,
    cacheMissAfterFoldCount: accordionCacheMissRows.length,
    cacheMissAfterFoldLines: accordionCacheMissRows.map((row) => row.line),
    cacheMissAfterFoldCost: roundMoney(accordionCacheMissRows.reduce((sum, row) => sum + row.cost.total, 0)),
  },
  summary: {
    wholeSession: sumRows(assistantRows),
    scoped: sumRows(scopedRows),
    flaggedCount: flaggedRows.length,
    cacheMissCount: flaggedRows.filter((row) => row.reasons.includes("cache_miss")).length,
    expensiveTurnCount: flaggedRows.filter((row) => row.reasons.includes("expensive_turn")).length,
    accordionFoldedCacheMissCount: accordionCacheMissRows.length,
    accordionContextCacheMissCount: accordionContextCacheMissRows.length,
  },
  topCosts: [...scopedRows].sort((a, b) => b.cost.total - a.cost.total).slice(0, 20),
  flagged: flaggedRows,
  turns: scopedRows,
};

const outPath = outArg
  ? resolve(outArg)
  : resolve(".diagnostics", "session-cost", `${basename(sessionPath).replace(/\.jsonl$/i, "")}.cost-report.json`);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Wrote ${outPath}`);
console.log(`Scoped cost: $${report.summary.scoped.cost.total.toFixed(6)} across ${report.summary.scoped.turns} assistant turns`);
console.log(`Flagged: ${report.summary.flaggedCount} (${report.summary.cacheMissCount} cache misses, ${report.summary.expensiveTurnCount} expensive turns)`);
if (report.accordion.foldedMarkerCount > 0 || report.accordion.contextDiagnostics.matchedCount > 0) {
  console.log(`Accordion markers: ${report.accordion.foldedMarkerCount}; marker-based cache misses: ${report.accordion.cacheMissAfterFoldCount}; context-log cache misses: ${report.accordion.contextDiagnostics.contextCacheMissCount}`);
}
