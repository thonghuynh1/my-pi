/**
 * Pure logic for background subagents: job registry, smart-join batching,
 * deterministic delivery formatting, the long-cache-TTL window policy, and the
 * Anthropic `cache_control` TTL payload rewrite.
 *
 * Pi wiring (tools, events, sendUserMessage) lives in extensions/subagents.ts.
 * Everything here is side-effect free apart from the registry's own state so it
 * can be unit tested without @earendil-works/pi-coding-agent.
 */

export const MAX_BACKGROUND_SUBAGENTS = 6;
export const DEFAULT_BACKGROUND_TIMEOUT_SECONDS = 1800;
export const SMART_JOIN_GRACE_MS = 30_000;
export const SUBAGENT_WAIT_DEFAULT_SECONDS = 120;
export const SUBAGENT_WAIT_MAX_SECONDS = 240;
export const DELIVERY_TASK_PREVIEW_CHARS = 200;

export type BackgroundJobStatus = "running" | "completed" | "failed" | "cancelled" | "interrupted";

export interface BackgroundJob {
	id: string;
	requestId?: string;
	type: string;
	name: string;
	task: string;
	/** Jobs launched in the same parent turn share a batch id (smart join). */
	batchId: string;
	status: BackgroundJobStatus;
	startedAt: number;
	endedAt?: number;
	output?: string;
	error?: string;
	turns: number;
	toolCount: number;
	preview: string;
	delivered: boolean;
	cancelRequested: boolean;
	abort: AbortController;
	/** Saved launch configuration and audit transcript for explicit recovery. */
	resumeParams?: unknown;
	sessionFilePath?: string;
	resumedFrom?: string;
	usage?: { costUsd: number; totalTokens: number; inputTokens: number; outputTokens: number; cacheTokens: number };
}

export interface LaunchJobInput {
	requestId?: string;
	type: string;
	name: string;
	task: string;
	batchId: string;
	startedAt: number;
	resumeParams?: unknown;
	resumedFrom?: string;
}

export interface CompleteJobInput {
	status: "completed" | "error";
	output: string;
	error?: string;
	turns: number;
	toolCount: number;
	endedAt: number;
}

export type StoredBackgroundJob = Omit<BackgroundJob, "abort">;
export interface RegistrySnapshot { counter: number; jobs: StoredBackgroundJob[] }

export type RegistryListener = (job: BackgroundJob) => void;

export class BackgroundJobRegistry {
	private counter = 0;
	private readonly jobs = new Map<string, BackgroundJob>();
	private readonly listeners = new Set<RegistryListener>();

	constructor(private readonly persist?: (snapshot: RegistrySnapshot) => void) {}

	snapshot(): RegistrySnapshot {
		return { counter: this.counter, jobs: this.list().map(({ abort, ...job }) => job) };
	}

	/** Rehydrate terminal work; in-process runs cannot survive a dead host. */
	restore(snapshot: RegistrySnapshot, now = Date.now()): void {
		this.jobs.clear();
		this.counter = snapshot.counter;
		for (const saved of snapshot.jobs) {
			const job: BackgroundJob = { ...saved, abort: new AbortController() };
			if (job.status === "running") {
				job.status = job.cancelRequested ? "cancelled" : "interrupted";
				job.endedAt = now;
				job.error = "Pi stopped before the run settled. Checkpoint and transcript retained; unfinished tools were NOT replayed. Use subagent_resume only after checking possible side effects.";
				job.delivered = false;
			}
			this.jobs.set(job.id, job);
		}
		this.save();
	}

	checkpoint(id: string, patch: Partial<StoredBackgroundJob>): void {
		const job = this.jobs.get(id);
		if (!job || job.status !== "running") return;
		this.mutate(job, () => Object.assign(job, patch));
	}

	/** Preserve history and pending delivery on reload/shutdown, never clear it. */
	interruptRunning(now = Date.now()): void {
		const interrupted = this.running();
		const previous = interrupted.map((job) => ({ ...job }));
		for (const job of interrupted) {
			job.status = job.cancelRequested ? "cancelled" : "interrupted";
			job.endedAt = now;
			job.error = "Pi stopped before the run settled. Checkpoint retained; unfinished tools were NOT replayed.";
		}
		try { this.save(); } catch (error) {
			interrupted.forEach((job, index) => {
				for (const key of Object.keys(job)) if (!(key in previous[index])) delete (job as any)[key];
				Object.assign(job, previous[index]);
			});
			throw error;
		} finally {
			// A disk failure must not leave in-process children executing after shutdown.
			for (const job of interrupted) job.abort.abort();
		}
		for (const job of interrupted) this.emit(job);
	}

	private save(): void { this.persist?.(this.snapshot()); }

	private mutate(job: BackgroundJob, apply: () => void): void {
		const previous = { ...job };
		apply();
		try { this.save(); } catch (error) {
			for (const key of Object.keys(job)) if (!(key in previous)) delete (job as any)[key];
			Object.assign(job, previous);
			throw error;
		}
	}

	/** Monotonic id; never derived from map size so ids are not reused after clear/delete. */
	nextId(): string {
		this.counter += 1;
		return `sa-${this.counter}`;
	}

	launch(input: LaunchJobInput): BackgroundJob {
		const job: BackgroundJob = {
			id: this.nextId(),
			requestId: input.requestId,
			type: input.type,
			name: input.name,
			task: input.task,
			batchId: input.batchId,
			status: "running",
			startedAt: input.startedAt,
			turns: 0,
			toolCount: 0,
			preview: "starting...",
			delivered: false,
			cancelRequested: false,
			abort: new AbortController(),
			resumeParams: input.resumeParams,
			resumedFrom: input.resumedFrom,
		};
		this.jobs.set(job.id, job);
		try { this.save(); } catch (error) { this.jobs.delete(job.id); throw error; }
		return job;
	}

	get(id: string): BackgroundJob | undefined {
		return this.jobs.get(id);
	}

	list(): BackgroundJob[] {
		return [...this.jobs.values()];
	}

	running(): BackgroundJob[] {
		return this.list().filter((job) => job.status === "running");
	}

	undelivered(): BackgroundJob[] {
		return this.list().filter((job) => job.status !== "running" && !job.delivered);
	}

	complete(id: string, input: CompleteJobInput): BackgroundJob | undefined {
		const job = this.jobs.get(id);
		if (!job || job.status !== "running") return job;
		// A cancel that lands after the child already succeeded keeps the real result.
		this.mutate(job, () => {
			job.status = input.status === "completed" ? "completed" : job.cancelRequested ? "cancelled" : "failed";
			job.output = input.output;
			job.error = input.error;
			job.turns = input.turns;
			job.toolCount = input.toolCount;
			job.endedAt = input.endedAt;
		});
		this.emit(job);
		return job;
	}

	/** Request cancellation. Returns false when the job is unknown or no longer running. */
	cancel(id: string): boolean {
		const job = this.jobs.get(id);
		if (!job || job.status !== "running") return false;
		this.mutate(job, () => { job.cancelRequested = true; });
		job.abort.abort();
		return true;
	}

	markDelivered(ids: Iterable<string>): void {
		const previous = new Map<BackgroundJob, boolean>();
		for (const id of ids) {
			const job = this.jobs.get(id);
			if (job) { previous.set(job, job.delivered); job.delivered = true; }
		}
		try { this.save(); } catch (error) {
			for (const [job, delivered] of previous) job.delivered = delivered;
			throw error;
		}
	}

	/**
	 * Abort every running job and forget all jobs. Running jobs are finalized as
	 * cancelled (and marked delivered, since nothing will deliver them after a
	 * reset) and listeners are notified so pending waiters resolve immediately.
	 * The id counter keeps counting.
	 */
	abortAllAndClear(now = Date.now()): void {
		const cleared: BackgroundJob[] = [];
		for (const job of this.jobs.values()) {
			if (job.status === "running") {
				job.cancelRequested = true;
				job.status = "cancelled";
				job.endedAt = now;
				job.error = job.error ?? "session reset";
				job.delivered = true;
				job.abort.abort();
				cleared.push(job);
			}
		}
		this.jobs.clear();
		this.save();
		for (const job of cleared) this.emit(job);
	}

	onChange(listener: RegistryListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit(job: BackgroundJob): void {
		for (const listener of [...this.listeners]) {
			try {
				listener(job);
			} catch {
				// Listener failures must not break job bookkeeping.
			}
		}
	}
}

export interface DeliverySelection {
	/** Finished, undelivered jobs that may be delivered now (registry order). */
	ready: BackgroundJob[];
	/** Earliest time at which a currently held job will become releasable. */
	nextCheckAt?: number;
}

/**
 * Smart join: a finished job whose batch still has running siblings is held
 * until the siblings finish or `graceMs` has elapsed since the batch's first
 * member finished. Held jobs are never dropped; they are only postponed.
 */
export function selectDeliverable(jobs: readonly BackgroundJob[], now: number, graceMs = SMART_JOIN_GRACE_MS): DeliverySelection {
	const ready: BackgroundJob[] = [];
	let nextCheckAt: number | undefined;
	for (const job of jobs) {
		if (job.status === "running" || job.delivered) continue;
		const batch = jobs.filter((other) => other.batchId === job.batchId);
		const hasRunningSibling = batch.some((other) => other.status === "running");
		if (!hasRunningSibling) {
			ready.push(job);
			continue;
		}
		const firstEnded = Math.min(...batch.filter((other) => other.endedAt !== undefined).map((other) => other.endedAt as number));
		const releaseAt = firstEnded + graceMs;
		if (now >= releaseAt) {
			ready.push(job);
		} else if (nextCheckAt === undefined || releaseAt < nextCheckAt) {
			nextCheckAt = releaseAt;
		}
	}
	return { ready, nextCheckAt };
}

export function durationSeconds(job: Pick<BackgroundJob, "startedAt" | "endedAt">, now?: number): number {
	const end = job.endedAt ?? now ?? job.startedAt;
	return Math.max(0, Math.round((end - job.startedAt) / 1000));
}

function taskPreview(task: string, max = DELIVERY_TASK_PREVIEW_CHARS): string {
	const flat = task.replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max)}...` : flat;
}

/** One job's result block. Deterministic: depends only on the job's fields. */
export function formatJobResult(job: BackgroundJob, truncate: (text: string) => string): string {
	const lines = [
		`--- ${job.id} (${job.type}:${job.name}) ---`,
		`Task: ${taskPreview(job.task)}`,
		`Status: ${job.status}`,
		`Duration: ${durationSeconds(job)}s`,
	];
	if (job.error) lines.push(`Error: ${job.error}`);
	if (job.sessionFilePath) lines.push(`Transcript: ${job.sessionFilePath}`);
	if (job.resumedFrom) lines.push(`Recovered from: ${job.resumedFrom}`);
	lines.push("", truncate(job.output || "(no output)"));
	return lines.join("\n");
}

/** Recovery is a fresh, explicit run, not replay of uncertain external effects. */
export function buildRecoveryTask(job: BackgroundJob): string {
	return [
		job.task,
		"", "Recovery handoff from an interrupted run:",
		`Previous job: ${job.id}`,
		job.sessionFilePath ? `Audit transcript: ${job.sessionFilePath}` : "",
		"Continue from the saved findings below. They may be partial or stale; verify against current state.",
		"Do NOT blindly repeat completed work or interrupted shell actions. An unfinished action may already have had side effects. Inspect current state first; if safe continuation cannot be established, stop and report that uncertainty.",
		"<saved-checkpoint>", (job.output ?? job.preview ?? "(no checkpoint)").slice(-64_000), "</saved-checkpoint>",
	].filter(Boolean).join("\n");
}

export const DELIVERY_HEADER = "[Background subagent results]";

export function formatDeliveryMessage(jobs: readonly BackgroundJob[], truncate: (text: string) => string): string {
	return [DELIVERY_HEADER, ...jobs.map((job) => formatJobResult(job, truncate))].join("\n\n");
}

export interface WaitSelection {
	/** Finished jobs to return now; caller marks them delivered. */
	finished: BackgroundJob[];
	/** Targeted jobs still running. */
	stillRunning: BackgroundJob[];
	/** Explicitly requested jobs already delivered earlier. */
	alreadyDelivered: BackgroundJob[];
	/** Requested ids that do not exist. */
	unknownIds: string[];
	/** Targeted jobs removed by a session reset while waiting. */
	cleared: BackgroundJob[];
}

/**
 * Resolve subagent_wait targets. With no ids, targets every running job plus
 * every finished-but-undelivered job (their results are what the caller is
 * blocked on anyway).
 */
export function resolveWaitTargets(registry: BackgroundJobRegistry, jobIds?: readonly string[]): BackgroundJob[] {
	if (jobIds && jobIds.length > 0) {
		return jobIds.map((id) => registry.get(id)).filter((job): job is BackgroundJob => Boolean(job));
	}
	return registry.list().filter((job) => job.status === "running" || !job.delivered);
}

export function selectWaitResults(registry: BackgroundJobRegistry, targets: readonly BackgroundJob[], jobIds?: readonly string[]): WaitSelection {
	const targetIds = new Set(targets.map((job) => job.id));
	const unknownIds = (jobIds ?? []).filter((id) => !registry.get(id) && !targetIds.has(id));
	const finished: BackgroundJob[] = [];
	const stillRunning: BackgroundJob[] = [];
	const alreadyDelivered: BackgroundJob[] = [];
	const cleared: BackgroundJob[] = [];
	for (const job of targets) {
		if (registry.get(job.id) !== job) cleared.push(job);
		else if (job.status === "running") stillRunning.push(job);
		else if (job.delivered) alreadyDelivered.push(job);
		else finished.push(job);
	}
	return { finished, stillRunning, alreadyDelivered, unknownIds, cleared };
}

export function clampWaitSeconds(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return SUBAGENT_WAIT_DEFAULT_SECONDS;
	return Math.min(SUBAGENT_WAIT_MAX_SECONDS, Math.max(1, value));
}

// ---------------------------------------------------------------------------
// Long cache TTL policy
// ---------------------------------------------------------------------------

export interface LongTtlState {
	/** Background jobs currently running. */
	running: number;
}

/**
 * Single policy point for the 1-hour cache TTL, evaluated per provider request.
 *
 * Only the last request before the parent goes idle needs the long TTL, and the
 * parent only idles waiting on a background result while a job is running.
 * Finished-but-undelivered jobs never sit through an idle gap (they are flushed
 * at the next settle; smart-join holds only happen while a sibling runs), so
 * the delivery turn and everything after it go back to the default 5m TTL.
 * Switching TTL keeps the cache hit (TTL is not part of the cache key), so the
 * only cost of 1h is the higher write rate on new tokens while jobs run.
 */
export function longTtlWanted(state: LongTtlState): boolean {
	return state.running > 0;
}

export function isLongCacheOptOut(envValue: string | undefined): boolean {
	return /^(0|false|no|off)$/i.test((envValue ?? "").trim());
}

export interface LongTtlRequestContext {
	api: string | undefined;
	supportsLongCacheRetention: boolean | undefined;
	windowActive: boolean;
	optOutEnv: string | undefined;
}

export function shouldApplyLongCacheTtl(context: LongTtlRequestContext): boolean {
	if (context.api !== "anthropic-messages") return false;
	if (!context.windowActive) return false;
	if (isLongCacheOptOut(context.optOutEnv)) return false;
	// No PI_CACHE_RETENTION short-circuit: the payload is the source of truth.
	// When retention is already long, every cache_control carries a ttl and
	// withLongCacheTtl returns undefined.
	if (context.supportsLongCacheRetention === false) return false;
	return true;
}

function upgradedCacheControl(block: unknown): Record<string, unknown> | undefined {
	if (!block || typeof block !== "object" || Array.isArray(block)) return undefined;
	const control = (block as { cache_control?: unknown }).cache_control;
	if (!control || typeof control !== "object") return undefined;
	const record = control as Record<string, unknown>;
	if (record.type !== "ephemeral" || record.ttl !== undefined) return undefined;
	// Fresh object per block: pi-ai shares one cache_control object across blocks.
	return { ...(block as Record<string, unknown>), cache_control: { ...record, ttl: "1h" } };
}

/** Map an array, copying only the entries that change. Returns undefined when nothing changed. */
function mapChanged(items: readonly unknown[], upgrade: (item: unknown) => unknown | undefined): unknown[] | undefined {
	let out: unknown[] | undefined;
	items.forEach((item, index) => {
		const next = upgrade(item);
		if (next === undefined) return;
		out ??= [...items];
		out[index] = next;
	});
	return out;
}

function upgradedMessage(message: unknown): unknown | undefined {
	if (!message || typeof message !== "object") return undefined;
	const content = (message as { content?: unknown }).content;
	if (!Array.isArray(content)) return undefined;
	const nextContent = mapChanged(content, upgradedCacheControl);
	return nextContent ? { ...(message as Record<string, unknown>), content: nextContent } : undefined;
}

/**
 * Return a copy of an Anthropic Messages payload where every ephemeral
 * cache_control without a ttl (system blocks, tools, message content blocks)
 * gets ttl "1h". Only the changed paths are copied; untouched messages and
 * blocks are shared by reference. Returns undefined when nothing would change.
 * The input is never mutated.
 */
export function withLongCacheTtl(payload: unknown): unknown | undefined {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
	const source = payload as Record<string, unknown>;
	const system = Array.isArray(source.system) ? mapChanged(source.system, upgradedCacheControl) : undefined;
	const tools = Array.isArray(source.tools) ? mapChanged(source.tools, upgradedCacheControl) : undefined;
	const messages = Array.isArray(source.messages) ? mapChanged(source.messages, upgradedMessage) : undefined;
	if (!system && !tools && !messages) return undefined;
	const copy: Record<string, unknown> = { ...source };
	if (system) copy.system = system;
	if (tools) copy.tools = tools;
	if (messages) copy.messages = messages;
	return copy;
}
