/**
 * recorder.ts — drive a real Edge tab with Playwright over CDP,
 * stream the tab's frames into ffmpeg, and produce a .webm video
 * + structured transcript of the agent's autonomous test.
 *
 * Frame pipeline:
 *   CDP `Page.startScreencast` (jpeg)  ──►  ffmpeg image2pipe  ──►  out.webm (vp9)
 *
 * No "share this tab" prompt is ever shown — CDP gives us silent
 * access to the tab the user (or /coach-launch-edge) opened.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { statSync } from "node:fs";
import { ensureBrowser, ensurePickerInstalled, findAppPage } from "./edge.ts";
import {
	makeRecordId,
	pathsForId,
	writeReport,
	type AssertionRecord,
	type ConsoleEntry,
	type NetworkEntry,
	type StepRecord,
	type TestReport,
} from "./records.ts";
import type { Page } from "playwright-core";

// Lazy ESM require for ffmpeg-static so a missing install gives a
// helpful runtime error instead of breaking extension load.
async function resolveFfmpegBinary(): Promise<string> {
	if (process.env.FRONTEND_COACH_FFMPEG && process.env.FRONTEND_COACH_FFMPEG.length > 0) {
		return process.env.FRONTEND_COACH_FFMPEG;
	}
	try {
		const mod = await import("ffmpeg-static");
		const bin = (mod as any).default ?? (mod as any);
		if (typeof bin === "string" && bin.length > 0) return bin;
	} catch {
		// fall through
	}
	throw new Error(
		"ffmpeg binary not available. Run `npm install` inside extensions/frontend-coach, " +
		"or set FRONTEND_COACH_FFMPEG to your ffmpeg path.",
	);
}

// ---------- Schema mirrored from the tool registration ----------

export type StepAction =
	| "click" | "dblclick" | "type" | "fill" | "press" | "hover"
	| "wait" | "waitFor" | "navigate" | "scroll" | "eval";

export interface Step {
	action: StepAction;
	selector?: string;
	value?: string;
	key?: string;
	url?: string;
	ms?: number;
	expression?: string;
}

export interface Assertion {
	description: string;
	expression: string;
}

export interface RecordTestInput {
	name: string;
	url?: string;
	steps: Step[];
	assertions?: Assertion[];
	fps?: number;
	relatedChange?: string;
	stopOnStepFailure?: boolean;
	viewport?: { width: number; height: number };
}

export interface RecordTestOutcome {
	report: TestReport;
	videoBytes: number;
}

// ---------- Step driver ----------

async function runStep(page: Page, step: Step): Promise<void> {
	const timeout = 10_000;
	switch (step.action) {
		case "click":
			if (!step.selector) throw new Error("click step needs selector");
			await page.click(step.selector, { timeout });
			break;
		case "dblclick":
			if (!step.selector) throw new Error("dblclick step needs selector");
			await page.dblclick(step.selector, { timeout });
			break;
		case "type":
		case "fill":
			if (!step.selector) throw new Error(`${step.action} step needs selector`);
			await page.fill(step.selector, step.value ?? "", { timeout });
			break;
		case "press":
			if (!step.key) throw new Error("press step needs key");
			if (step.selector) await page.press(step.selector, step.key, { timeout });
			else await page.keyboard.press(step.key);
			break;
		case "hover":
			if (!step.selector) throw new Error("hover step needs selector");
			await page.hover(step.selector, { timeout });
			break;
		case "wait":
			await page.waitForTimeout(Math.max(0, step.ms ?? 0));
			break;
		case "waitFor":
			if (!step.selector) throw new Error("waitFor step needs selector");
			await page.waitForSelector(step.selector, { timeout: step.ms ?? timeout });
			break;
		case "navigate":
			if (!step.url) throw new Error("navigate step needs url");
			await page.goto(step.url, { timeout: 30_000, waitUntil: "load" });
			break;
		case "scroll":
			if (!step.selector) throw new Error("scroll step needs selector");
			await page.locator(step.selector).first().scrollIntoViewIfNeeded({ timeout });
			break;
		case "eval":
			if (!step.expression) throw new Error("eval step needs expression");
			// Wrap to allow either expressions or statement bodies via `return ...`.
			await page.evaluate(`(async () => { return (${step.expression}); })()`);
			break;
		default:
			throw new Error(`unknown step action: ${(step as any).action}`);
	}
}

// ---------- Assertions ----------

async function evalAssertion(page: Page, a: Assertion): Promise<AssertionRecord> {
	try {
		const value = await page.evaluate(
			`(async () => { try { return { ok: !!(${a.expression}), v: (${a.expression}) }; } ` +
			`catch (e) { return { ok: false, err: String(e && e.message || e) }; } })()`,
		);
		const r = value as { ok: boolean; v?: unknown; err?: string };
		if (r.err) return { ...a, ok: false, error: r.err };
		return { ...a, ok: !!r.ok, value: safeClone(r.v) };
	} catch (err) {
		return { ...a, ok: false, error: (err as Error).message };
	}
}

function safeClone(v: unknown): unknown {
	try { return JSON.parse(JSON.stringify(v ?? null)); } catch { return null; }
}

// ---------- Main entry ----------

export async function recordTest(input: RecordTestInput): Promise<RecordTestOutcome> {
	const fps = clamp(input.fps ?? 10, 1, 30);
	const id = makeRecordId(input.name);
	const paths = pathsForId(id);

	const browser = await ensureBrowser();
	let page = findAppPage(browser);
	let context: import("playwright-core").BrowserContext;
	if (page) {
		context = page.context();
	} else {
		context = browser.contexts()[0] ?? (await browser.newContext());
		page = await context.newPage();
	}

	// Make sure the Alt+P picker survives whatever navigations the steps do.
	// Without this, page.goto() wipes window.__piCoach and Alt+P stops working
	// after the first browser_record_test run.
	await ensurePickerInstalled(context, page);

	if (input.viewport) {
		try { await page.setViewportSize(input.viewport); } catch { /* viewport not always settable over CDP */ }
	}
	if (input.url) {
		await page.goto(input.url, { timeout: 30_000, waitUntil: "load" });
	}

	const start = Date.now();
	const consoleLogs: ConsoleEntry[] = [];
	const network: NetworkEntry[] = [];
	const requestStart = new Map<string, number>();

	const onConsole = (msg: import("playwright-core").ConsoleMessage) => {
		consoleLogs.push({ type: msg.type(), text: truncate(msg.text(), 1000), atMs: Date.now() - start });
	};
	const onPageError = (err: Error) => {
		consoleLogs.push({ type: "pageerror", text: truncate(err.stack ?? err.message, 1000), atMs: Date.now() - start });
	};
	const onRequest = (req: import("playwright-core").Request) => {
		requestStart.set(reqKey(req), Date.now());
	};
	const onFinished = async (req: import("playwright-core").Request) => {
		const t0 = requestStart.get(reqKey(req)) ?? Date.now();
		let status: number | undefined;
		try { const r = await req.response(); status = r?.status(); } catch {}
		network.push({
			method: req.method(),
			url: truncate(req.url(), 500),
			status,
			atMs: t0 - start,
			durationMs: Date.now() - t0,
		});
	};
	const onFailed = (req: import("playwright-core").Request) => {
		const t0 = requestStart.get(reqKey(req)) ?? Date.now();
		network.push({
			method: req.method(),
			url: truncate(req.url(), 500),
			atMs: t0 - start,
			durationMs: Date.now() - t0,
			failure: req.failure()?.errorText ?? "failed",
		});
	};
	page.on("console", onConsole);
	page.on("pageerror", onPageError);
	page.on("request", onRequest);
	page.on("requestfinished", onFinished);
	page.on("requestfailed", onFailed);

	// ----- ffmpeg pipeline -----
	const ffmpegBin = await resolveFfmpegBinary();
	const ffmpegArgs = [
		"-y",
		"-f", "image2pipe",
		"-vcodec", "mjpeg",
		"-use_wallclock_as_timestamps", "1",
		"-i", "-",
		"-c:v", "libvpx",
		"-b:v", "1200k",
		"-pix_fmt", "yuv420p",
		"-vf", `fps=${fps}`,
		"-an",
		paths.video,
	];
	const ffmpeg = spawn(ffmpegBin, ffmpegArgs, { stdio: ["pipe", "pipe", "pipe"] }) as ChildProcessWithoutNullStreams;
	let ffmpegStderr = "";
	ffmpeg.stderr.on("data", (d) => { ffmpegStderr += d.toString(); });
	let ffmpegExitCode: number | null = null;
	const ffmpegDone = new Promise<void>((res) => {
		ffmpeg.on("close", (code) => { ffmpegExitCode = code; res(); });
	});
	const ffmpegStdinClosed = new Promise<void>((res) => {
		ffmpeg.stdin.on("close", () => res());
		ffmpeg.stdin.on("error", () => res());
	});

	// ----- CDP screencast -----
	const cdp = await context.newCDPSession(page);
	let frames = 0;
	let stopped = false;
	cdp.on("Page.screencastFrame", async (ev: any) => {
		if (stopped) return;
		try {
			const buf = Buffer.from(ev.data, "base64");
			if (!ffmpeg.stdin.destroyed && ffmpeg.stdin.writable) {
				ffmpeg.stdin.write(buf);
				frames++;
			}
		} catch { /* swallow */ }
		try { await cdp.send("Page.screencastFrameAck", { sessionId: ev.sessionId }); } catch { /* page navigated */ }
	});

	try {
		await cdp.send("Page.startScreencast", {
			format: "jpeg",
			quality: 70,
			everyNthFrame: 1,
		});
	} catch (err) {
		stopped = true;
		try { ffmpeg.stdin.end(); } catch {}
		try { ffmpeg.kill(); } catch {}
		throw new Error(`Failed to start screencast: ${(err as Error).message}`);
	}

	// ----- Run the steps -----
	const stepResults: StepRecord[] = [];
	let runFailure: string | undefined;
	const stopOnFail = input.stopOnStepFailure !== false;
	for (const step of input.steps) {
		const atMs = Date.now() - start;
		const t0 = Date.now();
		try {
			await runStep(page, step);
			stepResults.push({ ...step, ok: true, atMs, durationMs: Date.now() - t0 });
		} catch (err) {
			stepResults.push({ ...step, ok: false, error: (err as Error).message, atMs, durationMs: Date.now() - t0 });
			runFailure = `step ${stepResults.length} (${step.action}) failed: ${(err as Error).message}`;
			if (stopOnFail) break;
		}
	}

	// Let any post-step UI animation settle and surface in the video.
	await page.waitForTimeout(300);

	// ----- Assertions (after all steps) -----
	const assertResults: AssertionRecord[] = [];
	for (const a of input.assertions ?? []) {
		assertResults.push(await evalAssertion(page, a));
	}

	// ----- Stop recording -----
	stopped = true;
	try { await cdp.send("Page.stopScreencast"); } catch {}
	try { await cdp.detach(); } catch {}

	// Detach listeners.
	page.off("console", onConsole);
	page.off("pageerror", onPageError);
	page.off("request", onRequest);
	page.off("requestfinished", onFinished);
	page.off("requestfailed", onFailed);

	try { ffmpeg.stdin.end(); } catch {}
	await Promise.race([
		ffmpegDone,
		new Promise<void>((res) => setTimeout(res, 8000)),
	]);
	await ffmpegStdinClosed.catch(() => {});

	const videoBytes = (() => { try { return statSync(paths.video).size; } catch { return 0; } })();
	if (videoBytes === 0 && !runFailure) {
		runFailure = `ffmpeg produced no video (exit=${ffmpegExitCode}, frames=${frames}). stderr tail: ${ffmpegStderr.slice(-500)}`;
	}

	const allStepsOk = stepResults.every((s) => s.ok);
	const allAssertsOk = assertResults.every((a) => a.ok);
	const passed = !runFailure && allStepsOk && allAssertsOk;

	const report: TestReport = {
		id,
		name: input.name,
		url: input.url,
		passed,
		recordedAt: new Date().toISOString(),
		durationMs: Date.now() - start,
		videoPath: paths.video,
		video: { format: "webm", sizeBytes: videoBytes, fps },
		steps: stepResults,
		assertions: assertResults,
		console: consoleLogs,
		network,
		relatedChange: input.relatedChange,
		failure: runFailure,
	};
	writeReport(report);
	return { report, videoBytes };
}

function reqKey(req: import("playwright-core").Request): string {
	return `${req.method()} ${req.url()}`;
}

function clamp(n: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, n));
}

function truncate(s: string, n: number): string {
	return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
