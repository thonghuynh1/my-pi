export interface PerfScenario {
	name: string;
	setup: {
		blockCount: number;
		tokensPerBlock?: number;
		groups?: number;
		foldedPct?: number;
	};
	action:
		| { type: "append"; blocks: number }
		| { type: "full-reset" }
		| { type: "rapid-fire"; messages: number; intervalMs: number }
		| { type: "budget-drag"; from: number; to: number; steps: number }
		| { type: "idle-with-ghosts"; durationMs: number }
		| { type: "group-range"; blockCount: number };
	thresholds: {
		maxLongTask?: number;
		maxTotalBlocking?: number;
		minFPS?: number;
		maxMemoryDelta?: number;
	};
}

export interface PerfResult {
	scenario: string;
	passed: boolean;
	longestTask: number;
	totalBlocking: number;
	fps?: number;
	memoryDelta?: number;
	details: string;
}

export const SCENARIOS: PerfScenario[] = [
	{ name: "one-message-at-scale", setup: { blockCount: 982 }, action: { type: "append", blocks: 1 }, thresholds: { maxLongTask: 200, maxTotalBlocking: 300 } },
	{ name: "full-reset-at-scale", setup: { blockCount: 982 }, action: { type: "full-reset" }, thresholds: { maxLongTask: 500, maxTotalBlocking: 800 } },
	{ name: "rapid-fire-10", setup: { blockCount: 500 }, action: { type: "rapid-fire", messages: 10, intervalMs: 100 }, thresholds: { maxLongTask: 300, maxTotalBlocking: 1000 } },
	{ name: "ghost-idle", setup: { blockCount: 800, foldedPct: 40 }, action: { type: "idle-with-ghosts", durationMs: 2000 }, thresholds: { maxLongTask: 50, minFPS: 30 } },
	{ name: "budget-drag", setup: { blockCount: 982 }, action: { type: "budget-drag", from: 120000, to: 60000, steps: 20 }, thresholds: { maxLongTask: 200, maxTotalBlocking: 1500 } },
	{ name: "group-large-range", setup: { blockCount: 600 }, action: { type: "group-range", blockCount: 50 }, thresholds: { maxLongTask: 200, maxTotalBlocking: 400 } },
];
