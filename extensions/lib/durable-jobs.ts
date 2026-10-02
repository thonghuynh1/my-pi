import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { writeAtomicJson } from "./durable-file.mjs";
export { writeAtomicJson } from "./durable-file.mjs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export function readJson<T>(file: string): T | undefined {
	if (!existsSync(file)) return undefined;
	// Corruption must surface, not silently erase the job history.
	return JSON.parse(readFileSync(file, "utf8")) as T;
}

export function durableSessionDirectory(ctx: ExtensionContext, kind: string, fallbackSessionId: string): string {
	const sessionId = ctx.sessionManager?.getSessionId?.() ?? fallbackSessionId;
	const key = createHash("sha256").update(sessionId).digest("hex");
	const base = process.env.PI_DURABLE_JOBS_DIR ?? join(homedir(), ".pi", "agent", "jobs");
	return join(base, kind, key);
}

/** Admission/agent_start alone is not durable delivery: the user entry must exist. */
export function hasRecordedUserMessage(ctx: ExtensionContext | undefined, text: string): boolean {
	return (ctx?.sessionManager?.getEntries?.() ?? []).some((entry) => {
		if (entry.type !== "message" || entry.message.role !== "user") return false;
		const content = entry.message.content;
		return (typeof content === "string" ? content : content.filter((part) => part.type === "text").map((part) => part.text).join("\n")) === text;
	});
}

export interface DurableSnapshot<T> { version: 1; counter: number; jobs: T[] }

export class DurableJobStore<T> {
	readonly file: string;
	constructor(readonly directory: string) { this.file = join(directory, "registry.json"); }
	load(): DurableSnapshot<T> | undefined {
		const state = readJson<DurableSnapshot<T>>(this.file);
		if (state && (state.version !== 1 || !Number.isSafeInteger(state.counter) || state.counter < 0 || !Array.isArray(state.jobs))) {
			throw new Error(`Invalid durable job registry: ${this.file}`);
		}
		return state;
	}
	save(counter: number, jobs: T[]): void { writeAtomicJson(this.file, { version: 1, counter, jobs }); }
}
