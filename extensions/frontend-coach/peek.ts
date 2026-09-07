/**
 * peek.ts — cheap snapshot / act on the /coach-launch-edge CDP tab.
 *
 * No ffmpeg, no webm, no Playwright trace. Agents explore with these
 * tools, copy refs, then call browser_record_test (omit `url`) to prove.
 * Steps reuse recorder.runStep → portal-actions (dialog-scoped locators,
 * fillThroughPortal, setInputFilesThroughPortal, clickThroughPortal).
 */

import type { Page } from "playwright-core";
import {
	attachCoachPage,
	captureAriaSnapshot,
	runStep,
	type Step,
} from "./recorder.ts";
import type { StepRecord } from "./records.ts";

/** Keep peek cheap: a short step list, not a full recorded flow. */
export const MAX_PEEK_STEPS = 12;

export interface PeekSnapshotInput {
	selector?: string;
	ref?: string;
}

export interface PeekSnapshotOutcome {
	url: string;
	snapshot: string;
	ok: boolean;
	error?: string;
}

export interface PeekActInput {
	steps: Step[];
	/** Fresh snapshot after every step (default: one snapshot after the list). */
	snapshotAfterEach?: boolean;
	stopOnStepFailure?: boolean;
}

export interface PeekActOutcome {
	url: string;
	snapshot: string;
	snapshots?: string[];
	steps: StepRecord[];
	passed: boolean;
	failure?: string;
}

export function assertPeekStepBudget(steps: Step[]): void {
	if (steps.length > MAX_PEEK_STEPS) {
		throw new Error(
			`browser_coach_act allows at most ${MAX_PEEK_STEPS} steps (got ${steps.length}). ` +
			`Peek is for cheap exploration; use browser_record_test for a full recorded flow.`,
		);
	}
}

function truncateSnap(s: string, n = 12_000): string {
	return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

async function snapSafe(
	page: Page,
	target?: PeekSnapshotInput,
): Promise<{ snapshot: string; error?: string }> {
	try {
		const snapshot = await captureAriaSnapshot(page, target);
		return { snapshot };
	} catch (err) {
		return { snapshot: `(snapshot failed: ${(err as Error).message})`, error: (err as Error).message };
	}
}

/** Snapshot the given page. No CDP attach, no video. Used by tests and coachSnapshot. */
export async function peekSnapshot(
	page: Page,
	input: PeekSnapshotInput = {},
): Promise<PeekSnapshotOutcome> {
	const { snapshot, error } = await snapSafe(page, input);
	return { url: page.url(), snapshot, ok: !error, error };
}

/** Run steps on the given page via runStep / portal-actions. No video. */
export async function peekAct(page: Page, input: PeekActInput): Promise<PeekActOutcome> {
	assertPeekStepBudget(input.steps);
	const start = Date.now();
	const stepResults: StepRecord[] = [];
	let runFailure: string | undefined;
	const stopOnFail = input.stopOnStepFailure !== false;
	const intermediates: string[] = [];

	for (const step of input.steps) {
		const atMs = Date.now() - start;
		const t0 = Date.now();
		try {
			await runStep(page, step);
			stepResults.push({ ...step, ok: true, atMs, durationMs: Date.now() - t0 });
		} catch (err) {
			stepResults.push({
				...step,
				ok: false,
				error: (err as Error).message,
				atMs,
				durationMs: Date.now() - t0,
			});
			runFailure = `step ${stepResults.length} (${step.action}) failed: ${(err as Error).message}`;
			if (input.snapshotAfterEach) {
				intermediates.push((await snapSafe(page)).snapshot);
			}
			if (stopOnFail) break;
			continue;
		}
		if (input.snapshotAfterEach) {
			intermediates.push((await snapSafe(page)).snapshot);
		}
	}

	const { snapshot } = await snapSafe(page);
	const passed = !runFailure && stepResults.every((s) => s.ok);
	return {
		url: page.url(),
		snapshot,
		snapshots: input.snapshotAfterEach ? intermediates : undefined,
		steps: stepResults,
		passed,
		failure: runFailure,
	};
}

/** Snapshot the current /coach-launch-edge tab. */
export async function coachSnapshot(input: PeekSnapshotInput = {}): Promise<PeekSnapshotOutcome> {
	const { page } = await attachCoachPage();
	return peekSnapshot(page, input);
}

/** Act on the current /coach-launch-edge tab, then snapshot. */
export async function coachAct(input: PeekActInput): Promise<PeekActOutcome> {
	assertPeekStepBudget(input.steps);
	const { page } = await attachCoachPage();
	return peekAct(page, input);
}

export function renderPeekSnapshotText(outcome: PeekSnapshotOutcome): string {
	const lines = [
		`peek snapshot — ${outcome.ok ? "ok" : "failed"}`,
		`url : ${outcome.url}`,
	];
	if (outcome.error) lines.push(`fail: ${outcome.error}`);
	lines.push("");
	lines.push("a11y snapshot (copy step.ref like e12 into browser_coach_act or browser_record_test; omit url so refs stay valid):");
	lines.push(truncateSnap(outcome.snapshot));
	lines.push("");
	lines.push("No video. Call browser_record_test to record webm+trace.");
	return lines.join("\n");
}

export function renderPeekActText(outcome: PeekActOutcome): string {
	const lines = [
		`${outcome.passed ? "peek act ok" : "peek act failed"} — ${outcome.steps.length} step(s)`,
		`url : ${outcome.url}`,
	];
	if (outcome.failure) lines.push(`fail: ${outcome.failure}`);
	const failedSteps = outcome.steps.filter((s) => !s.ok);
	if (failedSteps.length) {
		lines.push("failed steps:");
		for (const s of failedSteps) {
			lines.push(
				`  - ${s.action} ${s.ref ? `ref=${s.ref}` : (s.selector ?? s.fileName ?? s.url ?? s.expression ?? "")} → ${s.error}`,
			);
		}
	}
	if (outcome.snapshots?.length) {
		outcome.snapshots.forEach((snap, i) => {
			lines.push("");
			lines.push(`a11y snapshot after step ${i + 1}:`);
			lines.push(truncateSnap(snap, 8000));
		});
	}
	lines.push("");
	lines.push("a11y snapshot (copy step.ref like e12 into browser_record_test; omit url so refs stay valid):");
	lines.push(truncateSnap(outcome.snapshot));
	lines.push("");
	lines.push("No video. Call browser_record_test to record webm+trace.");
	return lines.join("\n");
}
