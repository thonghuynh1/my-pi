import { chromium } from "@playwright/test";
import type { PerfResult, PerfScenario } from "./scenarios";
import { SCENARIOS } from "./scenarios";
import { connectInjector } from "./inject";
import { evaluateResult, formatResult } from "./report";

interface BrowserEntry {
	duration: number;
}

export async function runScenario(scenario: PerfScenario, opts: { headed?: boolean; port?: number } = {}): Promise<PerfResult> {
	const port = opts.port ?? 5173;
	const browser = await chromium.launch({ headless: !opts.headed });
	const page = await browser.newPage();
	try {
		await page.goto(`http://localhost:${port}`, { waitUntil: "domcontentloaded", timeout: 10_000 });
		await page.evaluate(() => {
			const target = window as Window & { __perfEntries?: PerformanceEntry[]; __perfFrames?: number; __perfMemory?: number };
			target.__perfEntries = [];
			target.__perfFrames = 0;
			const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
			target.__perfMemory = memory?.usedJSHeapSize;
			new PerformanceObserver((list) => target.__perfEntries?.push(...list.getEntries())).observe({ type: "longtask", buffered: true });
			const tick = () => {
				target.__perfFrames = (target.__perfFrames ?? 0) + 1;
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		});
		const { socket, injector } = await connectInjector(`ws://localhost:${port}`);
		const action = scenario.action;
		const started = Date.now();
		await injector.run(scenario);
		if (action.type === "idle-with-ghosts") await new Promise((resolve) => setTimeout(resolve, action.durationMs));
		else if (action.type === "budget-drag" || action.type === "group-range") await new Promise((resolve) => setTimeout(resolve, 250));
		const elapsed = Math.max(1, Date.now() - started);
		const data = await page.evaluate(() => {
			const target = window as Window & { __perfEntries?: PerformanceEntry[]; __perfFrames?: number; __perfMemory?: number };
			const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
			return { entries: target.__perfEntries ?? [], frames: target.__perfFrames ?? 0, memory: memory?.usedJSHeapSize, initialMemory: target.__perfMemory };
		});
		socket.close();
		const durations = data.entries.map((entry) => entry.duration).filter((duration): duration is number => typeof duration === "number");
		return evaluateResult(scenario, {
			longestTask: Math.max(0, ...durations),
			totalBlocking: durations.reduce((sum, duration) => sum + duration, 0),
			...(scenario.thresholds.minFPS !== undefined ? { fps: (data.frames * 1000) / elapsed } : {}),
			...(data.memory !== undefined && data.initialMemory !== undefined ? { memoryDelta: (data.memory - data.initialMemory) / 1_000_000 } : {}),
		});
	} catch (error) {
		return { scenario: scenario.name, passed: false, longestTask: 0, totalBlocking: 0, details: error instanceof Error ? error.message : String(error) };
	} finally {
		await browser.close();
	}
}

async function main(): Promise<void> {
	const index = process.argv.indexOf("--scenario");
	const name = index >= 0 ? process.argv[index + 1] : undefined;
	const scenario = SCENARIOS.find((candidate) => candidate.name === name);
	if (!scenario) throw new Error(name ? `Unknown scenario: ${name}` : "Use --scenario <name>");
	const result = await runScenario(scenario, { headed: process.argv.includes("--headed") });
	console.log(formatResult(result));
	if (!result.passed) process.exitCode = 1;
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("browser/run.ts")) {
	void main().catch((error: unknown) => {
		console.error(`Could not connect to app or launch browser: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	});
}
