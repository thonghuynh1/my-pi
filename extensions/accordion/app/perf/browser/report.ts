import type { PerfResult, PerfScenario } from "./scenarios";

export interface LongTaskMeasurement {
	duration: number;
}

export function evaluateResult(
	scenario: PerfScenario,
	measurement: Omit<PerfResult, "scenario" | "passed" | "details">,
): PerfResult {
	const failures: string[] = [];
	const { thresholds } = scenario;
	if (thresholds.maxLongTask !== undefined && measurement.longestTask > thresholds.maxLongTask) failures.push(`longest task ${measurement.longestTask}ms > ${thresholds.maxLongTask}ms`);
	if (thresholds.maxTotalBlocking !== undefined && measurement.totalBlocking > thresholds.maxTotalBlocking) failures.push(`total blocking ${measurement.totalBlocking}ms > ${thresholds.maxTotalBlocking}ms`);
	if (thresholds.minFPS !== undefined && (measurement.fps === undefined || measurement.fps < thresholds.minFPS)) failures.push(`FPS ${measurement.fps ?? "unavailable"} < ${thresholds.minFPS}`);
	if (thresholds.maxMemoryDelta !== undefined && (measurement.memoryDelta === undefined || measurement.memoryDelta > thresholds.maxMemoryDelta)) failures.push(`memory delta ${measurement.memoryDelta ?? "unavailable"}MB > ${thresholds.maxMemoryDelta}MB`);
	return {
		scenario: scenario.name,
		...measurement,
		passed: failures.length === 0,
		details: failures.length ? failures.join("; ") : "all thresholds passed",
	};
}

export function formatResult(result: PerfResult): string {
	return `${result.passed ? "PASS" : "FAIL"} ${result.scenario}: ${result.details} (longest=${result.longestTask}ms, blocking=${result.totalBlocking}ms)`;
}

export function formatSummary(results: PerfResult[]): string {
	return [...results.map(formatResult), `Summary: ${results.filter((result) => result.passed).length}/${results.length} passed`].join("\n");
}
