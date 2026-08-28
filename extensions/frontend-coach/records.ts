/**
 * records.ts — persisted on-disk format for browser-test recordings.
 *
 * Layout (relative to the cwd pi is launched from):
 *
 *   ./.frontend-coach/records/
 *     2026-06-09_143022_send-button.webm        ← ffmpeg screencast
 *     2026-06-09_143022_send-button.trace.zip   ← Playwright trace
 *     2026-06-09_143022_send-button.json        ← structured transcript
 *     2026-06-09_143022_send-button.md          ← human-readable report
 *
 * The `id` is the basename without extension, e.g.
 *   "2026-06-09_143022_send-button"
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve, join, basename, extname } from "node:path";

export interface StepRecord {
	action: string;
	selector?: string;
	ref?: string;
	value?: string;
	key?: string;
	url?: string;
	ms?: number;
	expression?: string;
	ok: boolean;
	error?: string;
	atMs: number;
	durationMs: number;
}

export interface AssertionRecord {
	description: string;
	expression: string;
	ok: boolean;
	value?: unknown;
	error?: string;
}

export interface ConsoleEntry {
	type: string;
	text: string;
	atMs: number;
}

export interface NetworkEntry {
	method: string;
	url: string;
	status?: number;
	atMs: number;
	durationMs?: number;
	failure?: string;
}

export interface TestReport {
	id: string;
	name: string;
	url?: string;
	passed: boolean;
	recordedAt: string;
	durationMs: number;
	videoPath: string;
	tracePath?: string;
	snapshot?: string;
	video: { format: string; sizeBytes: number; fps: number };
	steps: StepRecord[];
	assertions: AssertionRecord[];
	console: ConsoleEntry[];
	network: NetworkEntry[];
	relatedChange?: string;
	failure?: string;
}

export interface RecordSummary {
	id: string;
	name: string;
	passed: boolean;
	recordedAt: string;
	durationMs: number;
	videoPath: string;
	reportPath: string;
	markdownPath: string;
}

export function recordsDir(): string {
	const dir = resolve("./.frontend-coach/records");
	mkdirSync(dir, { recursive: true });
	return dir;
}

export function slugify(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60) || "test";
}

export function timestampForFile(d: Date = new Date()): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return (
		`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
		`_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
	);
}

export function makeRecordId(name: string, now: Date = new Date()): string {
	return `${timestampForFile(now)}_${slugify(name)}`;
}

export function pathsForId(id: string) {
	const dir = recordsDir();
	return {
		dir,
		video: join(dir, `${id}.webm`),
		trace: join(dir, `${id}.trace.zip`),
		json: join(dir, `${id}.json`),
		md: join(dir, `${id}.md`),
	};
}

export function writeReport(report: TestReport): { reportPath: string; markdownPath: string } {
	const paths = pathsForId(report.id);
	writeFileSync(paths.json, JSON.stringify(report, null, 2), "utf8");
	writeFileSync(paths.md, renderMarkdown(report), "utf8");
	return { reportPath: paths.json, markdownPath: paths.md };
}

export function listRecords(limit = 50): RecordSummary[] {
	const dir = recordsDir();
	if (!existsSync(dir)) return [];
	const ids = new Set<string>();
	for (const f of readdirSync(dir)) {
		const ext = extname(f);
		if (ext === ".json") ids.add(basename(f, ext));
	}
	const out: RecordSummary[] = [];
	for (const id of ids) {
		const paths = pathsForId(id);
		try {
			const json = JSON.parse(readFileSync(paths.json, "utf8")) as TestReport;
			out.push({
				id,
				name: json.name,
				passed: json.passed,
				recordedAt: json.recordedAt,
				durationMs: json.durationMs,
				videoPath: paths.video,
				reportPath: paths.json,
				markdownPath: paths.md,
			});
		} catch {
			// skip corrupt records
		}
	}
	out.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
	return out.slice(0, limit);
}

export function loadRecord(id: string): TestReport | null {
	const paths = pathsForId(id);
	if (!existsSync(paths.json)) return null;
	try {
		return JSON.parse(readFileSync(paths.json, "utf8")) as TestReport;
	} catch {
		return null;
	}
}

function videoSize(path: string): number {
	try { return statSync(path).size; } catch { return 0; }
}

export function renderMarkdown(r: TestReport): string {
	const status = r.passed ? "✅ PASSED" : "❌ FAILED";
	const lines: string[] = [];
	lines.push(`# ${status} — ${r.name}`);
	lines.push("");
	lines.push(`- **Recorded**: ${r.recordedAt}`);
	lines.push(`- **Duration**: ${(r.durationMs / 1000).toFixed(2)}s`);
	if (r.url) lines.push(`- **URL**: ${r.url}`);
	if (r.relatedChange) lines.push(`- **Change under test**: ${r.relatedChange}`);
	lines.push(`- **Video**: \`${r.videoPath}\` (${(videoSize(r.videoPath) / 1024).toFixed(1)} KiB, ${r.video.fps} fps)`);
	if (r.tracePath) lines.push(`- **Trace**: \`${r.tracePath}\` (${(videoSize(r.tracePath) / 1024).toFixed(1)} KiB)`);
	if (r.failure) {
		lines.push("");
		lines.push(`> **Run failure:** ${r.failure}`);
	}
	lines.push("");

	lines.push("## Steps");
	if (r.steps.length === 0) lines.push("_(none)_");
	for (const [i, s] of r.steps.entries()) {
		const mark = s.ok ? "✅" : "❌";
		const detail = formatStep(s);
		lines.push(`${i + 1}. ${mark} **${s.action}** ${detail}  _(@${(s.atMs / 1000).toFixed(2)}s, ${s.durationMs}ms)_`);
		if (s.error) lines.push(`   - error: \`${s.error}\``);
	}
	lines.push("");

	lines.push("## Assertions");
	if (r.assertions.length === 0) lines.push("_(none)_");
	for (const a of r.assertions) {
		const mark = a.ok ? "✅" : "❌";
		lines.push(`- ${mark} ${a.description}`);
		lines.push(`  - expression: \`${a.expression}\``);
		if (!a.ok && a.error) lines.push(`  - error: \`${a.error}\``);
		if (!a.ok && a.value !== undefined) lines.push(`  - returned: \`${truncate(JSON.stringify(a.value), 200)}\``);
	}
	lines.push("");

	if (r.snapshot) {
		lines.push("## A11y snapshot");
		lines.push("Target steps with `ref` (Playwright `e12` style). CSS `selector` is the fallback.");
		lines.push("");
		lines.push("```");
		lines.push(truncate(r.snapshot, 12000));
		lines.push("```");
		lines.push("");
	}

	lines.push("## Console");
	if (r.console.length === 0) {
		lines.push("_(no console output during run)_");
	} else {
		lines.push("```");
		for (const c of r.console) {
			lines.push(`[+${(c.atMs / 1000).toFixed(2)}s ${c.type}] ${truncate(c.text, 400)}`);
		}
		lines.push("```");
	}
	lines.push("");

	lines.push("## Network");
	if (r.network.length === 0) {
		lines.push("_(no network activity)_");
	} else {
		lines.push("| time | method | status | url |");
		lines.push("|---:|---|---:|---|");
		for (const n of r.network) {
			const status = n.failure ? `_${n.failure}_` : (n.status ?? "—");
			lines.push(`| +${(n.atMs / 1000).toFixed(2)}s | ${n.method} | ${status} | ${truncate(n.url, 120)} |`);
		}
	}
	lines.push("");
	return lines.join("\n");
}

function formatStep(s: StepRecord): string {
	switch (s.action) {
		case "click":
		case "dblclick":
		case "hover":
		case "waitFor":
			return formatTarget(s);
		case "type":
		case "fill":
			return `${formatTarget(s)} ← ${JSON.stringify(s.value ?? "")}`;
		case "press":
			return `\`${s.key ?? ""}\`${s.ref || s.selector ? ` on ${formatTarget(s)}` : ""}`;
		case "navigate":
			return s.url ? `→ ${s.url}` : "";
		case "wait":
			return `${s.ms ?? 0}ms`;
		case "scroll":
			return s.ref || s.selector ? `into view: ${formatTarget(s)}` : "";
		case "eval":
			return `\`${truncate(s.expression ?? "", 100)}\``;
		default:
			return "";
	}
}

function formatTarget(s: { ref?: string; selector?: string }): string {
	if (s.ref) return `ref=${s.ref}`;
	return s.selector ? `\`${s.selector}\`` : "";
}

function truncate(s: string, n: number): string {
	return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
