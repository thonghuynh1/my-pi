import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
	computeFrozenFromIndex,
	extractCacheMetrics,
	getFrozenFromIndex,
	getLatestMetrics,
	install,
	reset,
} from "./cache-tracker";

class FakePi {
	private readonly handlers = new Map<string, Array<(event: { response?: unknown }) => unknown>>();

	on(event: string, handler: (event: { response?: unknown }) => unknown): void {
		const existing = this.handlers.get(event) ?? [];
		existing.push(handler);
		this.handlers.set(event, existing);
	}

	emit(event: string, payload: { response?: unknown }): void {
		for (const handler of this.handlers.get(event) ?? []) handler(payload);
	}
}

describe("extractCacheMetrics", () => {
	it("extractCacheMetrics — anthropic", () => {
		expect(extractCacheMetrics("anthropic", {
			cache_read_input_tokens: 45000,
			cache_creation_input_tokens: 3000,
			input_tokens: 52000,
		})).toEqual({
			cacheReadTokens: 45000,
			cacheWriteTokens: 3000,
			inputTokens: 52000,
		});
	});

	it("extractCacheMetrics — bedrock", () => {
		expect(extractCacheMetrics("amazon-bedrock", {
			cacheReadInputTokenCount: 45000,
			cacheWriteInputTokenCount: 3000,
			inputTokenCount: 52000,
		})).toEqual({
			cacheReadTokens: 45000,
			cacheWriteTokens: 3000,
			inputTokens: 52000,
		});
	});

	it("extractCacheMetrics — openai", () => {
		expect(extractCacheMetrics("openai", {
			prompt_tokens: 52000,
			prompt_tokens_details: { cached_tokens: 45000 },
		})).toEqual({
			cacheReadTokens: 45000,
			cacheWriteTokens: 0,
			inputTokens: 52000,
		});
	});

	it("extractCacheMetrics — google", () => {
		expect(extractCacheMetrics("google", {
			cachedContentTokenCount: 45000,
			promptTokenCount: 52000,
		})).toEqual({
			cacheReadTokens: 45000,
			cacheWriteTokens: 0,
			inputTokens: 52000,
		});
	});

	it("extractCacheMetrics — copilot", () => {
		expect(extractCacheMetrics("github-copilot", {
			cached_tokens: 45000,
		})).toEqual({
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			inputTokens: 0,
		});
	});

	it("extractCacheMetrics — unknown/malformed", () => {
		expect(extractCacheMetrics("unknown-provider", undefined)).toEqual({
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			inputTokens: 0,
		});
		expect(extractCacheMetrics("anthropic", { cache_read_input_tokens: "45000" })).toEqual({
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			inputTokens: 0,
		});
	});
});

describe("computeFrozenFromIndex", () => {
	const blocks = Array.from({ length: 10 }, (_, order) => ({ order, tokens: 100 }));

	it("computeFrozenFromIndex — basic walk", () => {
		expect(computeFrozenFromIndex(blocks, 500, 0, 1)).toBe(4);
	});

	it("computeFrozenFromIndex — harness subtraction", () => {
		expect(computeFrozenFromIndex(blocks, 1000, 400, 1)).toBe(5);
	});

	it("computeFrozenFromIndex — harness exceeds cached", () => {
		expect(computeFrozenFromIndex(blocks, 400, 400, 1)).toBe(0);
	});

	it("computeFrozenFromIndex — cold start", () => {
		expect(computeFrozenFromIndex(blocks, 0, 0, 1)).toBe(0);
	});

	it("computeFrozenFromIndex — calibration factor", () => {
		expect(computeFrozenFromIndex(blocks, 500, 0, 1.3)).toBe(2);
	});
});

describe("cache tracker lifecycle", () => {
	const pi = new FakePi();
	const blocks = Array.from({ length: 10 }, (_, order) => ({ order, tokens: 100 }));
	let provider = "anthropic";
	let harnessEstimate = 0;
	let calibration = 1;

	beforeAll(() => {
		install(
			pi as never,
			() => provider,
			() => blocks,
			() => harnessEstimate,
			() => calibration,
		);
	});

	beforeEach(() => {
		provider = "anthropic";
		harnessEstimate = 0;
		calibration = 1;
		reset();
	});

	it("getFrozenFromIndex — initial state", () => {
		expect(getFrozenFromIndex()).toBe(0);
		expect(getLatestMetrics()).toBeNull();
	});

	it("reset — clears state", () => {
		pi.emit("after_provider_response", {
			response: {
				usage: {
					cache_read_input_tokens: 500,
					cache_creation_input_tokens: 100,
					input_tokens: 800,
				},
			},
		});

		expect(getFrozenFromIndex()).toBe(4);
		expect(getLatestMetrics()).toEqual({
			cacheReadTokens: 500,
			cacheWriteTokens: 100,
			inputTokens: 800,
		});

		reset();

		expect(getFrozenFromIndex()).toBe(0);
		expect(getLatestMetrics()).toBeNull();
	});
});
