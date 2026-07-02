import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface PrefixSnapshot {
	messageStrings: string[];
	systemHash: string;
	toolsHash: string;
	provider: string;
}

let installed = false;
let previousSnapshot: PrefixSnapshot | null = null;
let latestFrozenFromIndex = 0;

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
			latestFrozenFromIndex = computeHeuristicFrozenFromIndex(previousSnapshot, currentSnapshot);
			previousSnapshot = currentSnapshot;
		} catch {
			previousSnapshot = null;
			latestFrozenFromIndex = 0;
		}
		return undefined;
	});
}

export function getFrozenFromIndex(): number {
	return latestFrozenFromIndex;
}

export function reset(): void {
	previousSnapshot = null;
	latestFrozenFromIndex = 0;
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

function computeHeuristicFrozenFromIndex(previous: PrefixSnapshot | null, current: PrefixSnapshot): number {
	if (!previous) return 0;
	if (previous.provider !== current.provider) return 0;
	if (previous.systemHash !== current.systemHash) return 0;
	if (previous.toolsHash !== current.toolsHash) return 0;

	let matchedPrefix = 0;
	const limit = Math.min(previous.messageStrings.length, current.messageStrings.length);
	while (matchedPrefix < limit && previous.messageStrings[matchedPrefix] === current.messageStrings[matchedPrefix]) {
		matchedPrefix += 1;
	}
	return Math.max(0, matchedPrefix - 1);
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
