import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium } from "@playwright/test";
import type { Browser, Locator, Page } from "@playwright/test";
import type { PerfResult, PerfScenario } from "./scenarios";
import { SCENARIOS } from "./scenarios";
import { PerfExtensionServer, startPerfServer } from "./inject";
import { evaluateResult, formatResult, formatSummary, type BrowserMeasurement } from "./report";

const DEFAULT_APP_PORT = 1420;
const NAVIGATION_TIMEOUT_MS = 120_000;
const SETUP_SETTLE_MS = 250;

interface RawBrowserMeasurement {
	durations: number[];
	elapsedMs: number;
	frames: number;
	memoryStart?: number;
	memoryEnd?: number;
}

const START_MEASUREMENT_SCRIPT = `(() => {
	const target = window;
	if (target.__accordionPerfObserver) target.__accordionPerfObserver.disconnect();
	target.__accordionPerfEntries = [];
	target.__accordionPerfFrames = 0;
	target.__accordionPerfStartedAt = performance.now();
	target.__accordionPerfActive = true;
	const memory = performance.memory;
	target.__accordionPerfMemoryStart = memory ? memory.usedJSHeapSize : undefined;
	target.__accordionPerfObserver = new PerformanceObserver(function(list) {
		for (const entry of list.getEntries()) target.__accordionPerfEntries.push(entry.duration);
	});
	target.__accordionPerfObserver.observe({ type: "longtask", buffered: false });
	function countFrame() {
		if (!target.__accordionPerfActive) return;
		target.__accordionPerfFrames += 1;
		requestAnimationFrame(countFrame);
	}
	requestAnimationFrame(countFrame);
})()`;

const END_MEASUREMENT_SCRIPT = `(() => {
	const target = window;
	target.__accordionPerfActive = false;
	if (target.__accordionPerfObserver) target.__accordionPerfObserver.disconnect();
	const memory = performance.memory;
	return {
		durations: target.__accordionPerfEntries || [],
		elapsedMs: Math.max(1, performance.now() - target.__accordionPerfStartedAt),
		frames: target.__accordionPerfFrames || 0,
		memoryStart: target.__accordionPerfMemoryStart,
		memoryEnd: memory ? memory.usedJSHeapSize : undefined,
	};
})()`;

export interface RunOptions {
	headed?: boolean;
	/** Port where the live Accordion app is served. The fake extension uses a separate port. */
	port?: number;
	appUrl?: string;
}

function failureResult(scenario: PerfScenario, details: string): PerfResult {
	return { scenario: scenario.name, passed: false, longestTask: 0, totalBlocking: 0, details };
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isNavigationFailure(message: string): boolean {
	return /page\.goto|ERR_CONNECTION|ERR_CONNECTION_REFUSED|Timeout .*navigating/i.test(message);
}

async function connectPageToServer(page: Page, serverPort: number): Promise<void> {
	const portInput = page.locator('input[aria-label="pi port"]');
	await portInput.waitFor({ state: "visible", timeout: NAVIGATION_TIMEOUT_MS });
	await portInput.fill(String(serverPort));
	await page.getByRole("button", { name: "Connect to port", exact: true }).click();
}

async function waitForRenderedMap(page: Page): Promise<void> {
	await page.locator('section[data-region="older"], section[data-region="pre-group"], section[data-region="protected-tail"]').first().waitFor({
		state: "visible",
		timeout: 30_000,
	});
}

async function setBudget(page: Page, value: number): Promise<void> {
	const slider = page.locator('input[aria-label="Context budget"]');
	await slider.evaluate((element, next) => {
		if (!(element instanceof HTMLInputElement)) throw new Error("Context budget control is not an input");
		element.value = String(next);
		element.dispatchEvent(new Event("input", { bubbles: true }));
	}, value);
}

async function runBudgetDrag(page: Page, action: Extract<PerfScenario["action"], { type: "budget-drag" }>): Promise<void> {
	const { from, to, steps } = action;
	await setBudget(page, from);
	for (let step = 1; step <= steps; step++) {
		const value = from + ((to - from) * step) / steps;
		await setBudget(page, value);
	}
	const actual = Number(await page.locator('input[aria-label="Context budget"]').inputValue());
	if (actual !== Math.round(to)) throw new Error(`Budget drag ended at ${actual}, expected ${Math.round(to)}`);
}

async function clickOlderCanvasIndex(page: Page, canvas: Locator, index: number, shift: boolean): Promise<void> {
	const box = await canvas.boundingBox();
	if (box === null) throw new Error("Older-context canvas has no visible bounds");
	const columns = 40;
	const cell = 20;
	const gap = 4;
	const trackWidth = columns * cell + (columns - 1) * gap;
	const marginLeft = Math.max(0, Math.floor((box.width - trackWidth) / 2));
	const column = index % columns;
	const row = Math.floor(index / columns);
	const x = box.x + marginLeft + column * (cell + gap) + cell / 2;
	const y = box.y + row * (cell + gap) + cell / 2;
	if (!shift) {
		await page.mouse.click(x, y);
		return;
	}
	await page.keyboard.down("Shift");
	try {
		await page.mouse.click(x, y);
	} finally {
		await page.keyboard.up("Shift");
	}
}

async function runGroupRange(page: Page, action: Extract<PerfScenario["action"], { type: "group-range" }>): Promise<void> {
	const canvas = page.locator('section[data-region="older"] canvas').first();
	await canvas.waitFor({ state: "visible", timeout: 15_000 });
	await clickOlderCanvasIndex(page, canvas, 0, false);
	await page.waitForTimeout(300);
	await clickOlderCanvasIndex(page, canvas, action.blockCount - 1, true);
	const groupButton = page.getByRole("button", { name: "Group", exact: true });
	await groupButton.click();
	await page.waitForTimeout(100);
	if (await groupButton.count() !== 0) throw new Error("Group range was not committed by the live UI");
}

async function runUiAction(page: Page, scenario: PerfScenario): Promise<void> {
	switch (scenario.action.type) {
		case "budget-drag":
			await runBudgetDrag(page, scenario.action);
			return;
		case "group-range":
			await runGroupRange(page, scenario.action);
			return;
		case "append":
		case "full-reset":
		case "rapid-fire":
		case "idle-with-ghosts":
			return;
		default: {
			const _exhaustive: never = scenario.action;
			void _exhaustive;
		}
	}
}

async function readMeasurement(page: Page): Promise<BrowserMeasurement> {
	await page.waitForTimeout(0);
	const raw = await page.evaluate<RawBrowserMeasurement>(END_MEASUREMENT_SCRIPT);
	const durations = raw.durations.filter((duration): duration is number => typeof duration === "number" && Number.isFinite(duration));
	const measurement: BrowserMeasurement = {
		longestTask: Math.max(0, ...durations),
		totalBlocking: durations.reduce((sum, duration) => sum + duration, 0),
		...(raw.frames > 0 ? { fps: (raw.frames * 1000) / raw.elapsedMs } : {}),
	};
	if (raw.memoryStart !== undefined && raw.memoryEnd !== undefined) measurement.memoryDelta = (raw.memoryEnd - raw.memoryStart) / 1_000_000;
	return measurement;
}

export async function runScenario(scenario: PerfScenario, opts: RunOptions = {}): Promise<PerfResult> {
	const appPort = opts.port ?? DEFAULT_APP_PORT;
	const appUrl = opts.appUrl ?? `http://127.0.0.1:${appPort}`;
	let browser: Browser | null = null;
	let server: PerfExtensionServer | null = null;
	try {
		browser = await chromium.launch({ headless: !opts.headed });
		const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
		server = await startPerfServer();
		await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
		await connectPageToServer(page, server.port);
		await server.prepare(scenario);
		await waitForRenderedMap(page);
		await page.waitForTimeout(SETUP_SETTLE_MS);
		await page.evaluate(START_MEASUREMENT_SCRIPT);
		await server.runNetworkAction(scenario);
		await runUiAction(page, scenario);
		if (scenario.action.type === "idle-with-ghosts") await page.waitForTimeout(scenario.action.durationMs);
		const measurement = await readMeasurement(page);
		if (scenario.action.type === "idle-with-ghosts") server.stopGhosts();
		return evaluateResult(scenario, measurement);
	} catch (error) {
		const message = errorMessage(error);
		const details = isNavigationFailure(message) ? `App not running at ${appUrl}: ${message}` : message;
		return failureResult(scenario, details);
	} finally {
		if (server !== null) await server.close();
		if (browser !== null) await browser.close();
	}
}

function optionValue(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

function parsePort(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	const port = Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`Invalid port: ${value}`);
	return port;
}

async function writeReport(path: string, results: PerfResult[]): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify({ results }, null, 2)}\n`, "utf8");
}

async function main(): Promise<void> {
	const name = optionValue("--scenario");
	const scenario = name === undefined ? undefined : SCENARIOS.find((candidate) => candidate.name === name);
	if (name !== undefined && scenario === undefined) throw new Error(`Unknown scenario: ${name}`);
	const port = parsePort(optionValue("--port")) ?? parsePort(process.env.PERF_APP_PORT) ?? DEFAULT_APP_PORT;
	const scenarios = scenario === undefined ? SCENARIOS : [scenario];
	const results: PerfResult[] = [];
	for (const candidate of scenarios) {
		const result = await runScenario(candidate, { headed: process.argv.includes("--headed"), port });
		results.push(result);
		if (scenario !== undefined) console.log(formatResult(result));
		if (!result.passed && result.details.startsWith("App not running")) break;
	}
	if (scenario === undefined) console.log(formatSummary(results));
	const reportPath = optionValue("--report");
	if (reportPath !== undefined) await writeReport(reportPath, results);
	if (results.some((result) => !result.passed)) process.exitCode = 1;
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("browser/run.ts")) {
	void main().catch((error: unknown) => {
		console.error(`Could not connect to app or launch browser: ${errorMessage(error)}`);
		process.exitCode = 1;
	});
}
