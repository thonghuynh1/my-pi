import { describe, it, expect } from "vitest";
import { estimateWithoutAccordionInput, formatEstimatedWithoutAccordion } from "./estimatedWithoutAccordion";

describe("estimated without Accordion input", () => {
	it("adds full history and available request overhead", () => {
		const estimate = estimateWithoutAccordionInput({
			fullTokens: 142_000,
			systemPromptTokens: 1_000,
			toolsTokens: 6_000,
			systemPayloadTokens: 1_000,
		});

		expect(estimate).toEqual({
			inputTokens: 150_000,
			isPartial: false,
			components: {
				fullTokens: 142_000,
				systemPromptTokens: 1_000,
				toolsTokens: 6_000,
				systemPayloadTokens: 1_000,
			},
		});
	});

	it("marks the estimate partial when overhead buckets are missing", () => {
		const estimate = estimateWithoutAccordionInput({ fullTokens: 142_000 });

		expect(estimate.inputTokens).toBe(142_000);
		expect(estimate.isPartial).toBe(true);
		expect(estimate.components).toEqual({ fullTokens: 142_000 });
		expect(formatEstimatedWithoutAccordion(estimate, 200_000)).toBe("Without Accordion: ≥142k / 200k · 71%");
	});

	it("shows the true percentage when the estimate exceeds the context window", () => {
		const estimate = estimateWithoutAccordionInput({
			fullTokens: 245_000,
			systemPromptTokens: 0,
			toolsTokens: 0,
			systemPayloadTokens: 0,
		});

		expect(formatEstimatedWithoutAccordion(estimate, 200_000)).toBe("Without Accordion: 245k / 200k · 123%");
	});
});
