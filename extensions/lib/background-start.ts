import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Lets another extension start a supervised background job without owning the process. */
export const BACKGROUND_START_CHANNEL = "background-jobs:start";

export type BackgroundJobState =
	| { status: "running" }
	| { status: "completed" | "failed"; exitCode: number | null }
	| { status: "killed" | "timed_out" | "interrupted"; error?: string };

export interface BackgroundJobHandle {
	id: string;
	logFilePath: string;
	poll(): BackgroundJobState;
	/** The job starts silent; call this to hand completion delivery to the agent's next turn. */
	notifyWhenFinished(): void;
	kill(): void;
}

export interface BackgroundStartRequest {
	command: string;
	cwd: string;
	requestId: string;
	ctx: ExtensionContext;
	handle?: BackgroundJobHandle;
	error?: string;
}

export function isBackgroundStartRequest(data: unknown): data is BackgroundStartRequest {
	if (typeof data !== "object" || data === null) return false;
	const candidate = data as Record<string, unknown>;
	return typeof candidate.command === "string"
		&& typeof candidate.cwd === "string"
		&& typeof candidate.requestId === "string"
		&& typeof candidate.ctx === "object" && candidate.ctx !== null;
}
