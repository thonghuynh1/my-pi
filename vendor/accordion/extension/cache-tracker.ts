import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface PrefixSnapshot {
	messageStrings: string[];
	systemHash: string;
	toolsHash: string;
	provider: string;
}

export type CacheTrackerReason =
	| "cold-start"
	| "provider-changed"
	| "system-changed"
	| "tools-changed"
	| "prefix-mismatch"
	| "prefix-match"
	| "error";

export interface CacheTrackerDiagnostics {
	frozenFromIndex: number;
	reason: CacheTrackerReason;
	messageCount: number;
	previousMessageCount: number;
	matchedPrefix: number;
}

let installed = false;
let previousSnapshot: PrefixSnapshot | null = null;
let latestDiagnostics: CacheTrackerDiagnostics = {
	frozenFromIndex: 0,
	reason: "cold-start",
	messageCount: 0,
	previousMessageCount: 0,
	matchedPrefix: 0,
};

export function install(
	pi: ExtensionAPI,
	getProvider: () => string | undefined,
): void {
	if (installed) return;
	installed = true;

	const api = pi as unknown as {
		on?: (event: string, handler: (event: { payload?: unknown }) => unknown) => void;
	};

	api.on?.("before_provider_request", (event) => {
		try {
			const currentSnapshot = buildSnapshot(event?.payload, getProvider());
			latestDiagnostics = computeDiagnostics(previousSnapshot, currentSnapshot);
			previousSnapshot = currentSnapshot;
		} catch {
			previousSnapshot = null;
			latestDiagnostics = {
				frozenFromIndex: 0,
				reason: "error",
				messageCount: 0,
				previousMessageCount: 0,
				matchedPrefix: 0,
			};
		}
		return undefined;
	});
}

export function getFrozenFromIndex(): number {
	return latestDiagnostics.frozenFromIndex;
}

export function getDiagnostics(): CacheTrackerDiagnostics {
	return { ...latestDiagnostics };
}

export function reset(): void {
	previousSnapshot = null;
	latestDiagnostics = {
		frozenFromIndex: 0,
		reason: "cold-start",
		messageCount: 0,
		previousMessageCount: 0,
		matchedPrefix: 0,
	};
}

function buildSnapshot(payload: unknown, provider: string | undefined): PrefixSnapshot {
	const record = asRecord(payload);
	const messageItems = getMessageItems(record);
	const usesEmbeddedSystem = provider === "openai" && !hasOwnValue(record, "system") && messageItems.length > 0;
	const systemValue = hasOwnValue(record, "system") ? record?.system : usesEmbeddedSystem ? messageItems[0] : undefined;
	const conversationItems = usesEmbeddedSystem ? messageItems.slice(1) : messageItems;
	const toolsValue = hasOwnValue(record, "tools") ? record?.tools : record?.toolConfig;

	return {
		messageStrings: conversationItems.map((message) => JSON.stringify(message)),
		systemHash: JSON.stringify(systemValue),
		toolsHash: JSON.stringify(toolsValue),
		provider: provider ?? "",
	};
}

function computeDiagnostics(previous: PrefixSnapshot | null, current: PrefixSnapshot): CacheTrackerDiagnostics {
	const messageCount = current.messageStrings.length;
	const previousMessageCount = previous?.messageStrings.length ?? 0;
	if (!previous) return diagnostic("cold-start", 0, messageCount, previousMessageCount);
	if (previous.provider !== current.provider) return diagnostic("provider-changed", 0, messageCount, previousMessageCount);
	if (previous.systemHash !== current.systemHash) return diagnostic("system-changed", 0, messageCount, previousMessageCount);
	if (previous.toolsHash !== current.toolsHash) return diagnostic("tools-changed", 0, messageCount, previousMessageCount);

	let matchedPrefix = 0;
	const limit = Math.min(previousMessageCount, messageCount);
	while (matchedPrefix < limit && previous.messageStrings[matchedPrefix] === current.messageStrings[matchedPrefix]) {
		matchedPrefix += 1;
	}
	return diagnostic(
		matchedPrefix === 0 && limit > 0 ? "prefix-mismatch" : "prefix-match",
		matchedPrefix,
		messageCount,
		previousMessageCount,
	);
}

function diagnostic(
	reason: CacheTrackerReason,
	matchedPrefix: number,
	messageCount: number,
	previousMessageCount: number,
): CacheTrackerDiagnostics {
	return {
		frozenFromIndex: Math.max(0, matchedPrefix - 1),
		reason,
		messageCount,
		previousMessageCount,
		matchedPrefix,
	};
}

function getMessageItems(payload: Record<string, unknown> | null): unknown[] {
	if (!payload) return [];
	if (Array.isArray(payload.messages)) return payload.messages;
	if (Array.isArray(payload.input)) return payload.input;
	return [];
}

function hasOwnValue(payload: Record<string, unknown> | null, key: string): boolean {
	return payload !== null && Object.prototype.hasOwnProperty.call(payload, key);
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" ? value as Record<string, unknown> : null;
}
