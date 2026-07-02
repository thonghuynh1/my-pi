import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface ProviderCacheMetrics {
	cacheReadTokens: number;
	cacheWriteTokens: number;
	inputTokens: number;
}

interface CacheBlock {
	order: number;
	tokens: number;
}

const ZERO_METRICS: ProviderCacheMetrics = {
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
	inputTokens: 0,
};

let installed = false;
let latestMetrics: ProviderCacheMetrics | null = null;
let latestFrozenFromIndex = 0;

export function extractCacheMetrics(provider: string, usage: unknown): ProviderCacheMetrics {
	switch (provider) {
		case "anthropic":
			return extractAnthropicMetrics(usage);
		case "amazon-bedrock":
			return extractBedrockMetrics(usage);
		case "openai":
			return extractOpenAiMetrics(usage);
		case "google":
			return extractGoogleMetrics(usage);
		case "github-copilot":
		default:
			return zeroMetrics();
	}
}

export function computeFrozenFromIndex(
	blocks: CacheBlock[],
	cachedTokens: number,
	harnessEstimate: number,
	calibration: number,
): number {
	const harnessReal = harnessEstimate * calibration;
	const messageCached = cachedTokens - harnessReal;
	if (messageCached <= 0) return 0;
	let accumulated = 0;
	let frozenCount = 0;
	for (const b of blocks) {
		accumulated += b.tokens * calibration;
		if (accumulated <= messageCached) {
			frozenCount = b.order + 1;
		} else {
			break;
		}
	}
	return Math.max(0, frozenCount - 1);
}

export function install(
	pi: ExtensionAPI,
	getProvider: () => string | undefined,
	getBlocks: () => CacheBlock[],
	getHarness: () => number,
	getCalibration: () => number,
): void {
	if (installed) return;
	installed = true;

	const api = pi as unknown as {
		on?: (event: string, handler: (event: { response?: unknown }) => unknown) => void;
	};

	api.on?.("after_provider_response", (event) => {
		try {
			const provider = getProvider() ?? "";
			const metrics = extractCacheMetrics(provider, pickUsage(provider, event?.response));
			latestMetrics = metrics;
			latestFrozenFromIndex = computeFrozenFromIndex(
				getBlocks(),
				metrics.cacheReadTokens,
				getHarness(),
				getCalibration(),
			);
		} catch {
			latestMetrics = zeroMetrics();
			latestFrozenFromIndex = 0;
		}
		return undefined;
	});
}

export function getFrozenFromIndex(): number {
	return latestFrozenFromIndex;
}

export function getLatestMetrics(): ProviderCacheMetrics | null {
	return latestMetrics;
}

export function reset(): void {
	latestMetrics = null;
	latestFrozenFromIndex = 0;
}

function extractAnthropicMetrics(usage: unknown): ProviderCacheMetrics {
	const record = asRecord(usage);
	if (!record) return zeroMetrics();
	const cacheReadTokens = getNumber(record, "cache_read_input_tokens");
	const cacheWriteTokens = getNumber(record, "cache_creation_input_tokens");
	const inputTokens = getNumber(record, "input_tokens");
	if (cacheReadTokens === null || cacheWriteTokens === null || inputTokens === null) return zeroMetrics();
	return { cacheReadTokens, cacheWriteTokens, inputTokens };
}

function extractBedrockMetrics(usage: unknown): ProviderCacheMetrics {
	const record = asRecord(usage);
	if (!record) return zeroMetrics();
	const cacheReadTokens = getNumber(record, "cacheReadInputTokenCount");
	const cacheWriteTokens = getNumber(record, "cacheWriteInputTokenCount");
	const inputTokens = getNumber(record, "inputTokenCount");
	if (cacheReadTokens === null || cacheWriteTokens === null || inputTokens === null) return zeroMetrics();
	return { cacheReadTokens, cacheWriteTokens, inputTokens };
}

function extractOpenAiMetrics(usage: unknown): ProviderCacheMetrics {
	const record = asRecord(usage);
	if (!record) return zeroMetrics();
	const details = asRecord(record.prompt_tokens_details);
	const cacheReadTokens = details ? getNumber(details, "cached_tokens") : null;
	const inputTokens = getNumber(record, "prompt_tokens");
	if (cacheReadTokens === null || inputTokens === null) return zeroMetrics();
	return { cacheReadTokens, cacheWriteTokens: 0, inputTokens };
}

function extractGoogleMetrics(usage: unknown): ProviderCacheMetrics {
	const record = asRecord(usage);
	if (!record) return zeroMetrics();
	const usageMetadata = asRecord(record.usageMetadata) ?? record;
	const cacheReadTokens = getNumber(usageMetadata, "cachedContentTokenCount");
	const inputTokens = getNumber(usageMetadata, "promptTokenCount");
	if (cacheReadTokens === null || inputTokens === null) return zeroMetrics();
	return { cacheReadTokens, cacheWriteTokens: 0, inputTokens };
}

function pickUsage(provider: string, response: unknown): unknown {
	const record = asRecord(response);
	if (!record) return response;
	if (provider === "google") return record.usageMetadata ?? response;
	return record.usage ?? response;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" ? value as Record<string, unknown> : null;
}

function getNumber(record: Record<string, unknown>, key: string): number | null {
	const value = record[key];
	return typeof value === "number" ? value : null;
}

function zeroMetrics(): ProviderCacheMetrics {
	return { ...ZERO_METRICS };
}
