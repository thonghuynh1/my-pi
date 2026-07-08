import type { EstimatedWithoutAccordion } from "./registry";

export type EstimateInput = {
	fullTokens: number;
	systemPromptTokens?: number | null;
	toolsTokens?: number | null;
	systemPayloadTokens?: number | null;
};

function nonNegativeNumber(value: number | null | undefined): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function estimateWithoutAccordionInput(input: EstimateInput): EstimatedWithoutAccordion {
	const fullTokens = Math.max(0, Math.round(input.fullTokens));
	const systemPromptTokens = nonNegativeNumber(input.systemPromptTokens);
	const toolsTokens = nonNegativeNumber(input.toolsTokens);
	const systemPayloadTokens = nonNegativeNumber(input.systemPayloadTokens);
	const knownOverhead = (systemPromptTokens ?? 0) + (toolsTokens ?? 0) + (systemPayloadTokens ?? 0);

	return {
		inputTokens: fullTokens + knownOverhead,
		isPartial: systemPromptTokens === undefined || toolsTokens === undefined || systemPayloadTokens === undefined,
		components: {
			fullTokens,
			...(systemPromptTokens !== undefined && { systemPromptTokens }),
			...(toolsTokens !== undefined && { toolsTokens }),
			...(systemPayloadTokens !== undefined && { systemPayloadTokens }),
		},
	};
}

export function formatTokenCount(n: number): string {
	const rounded = Math.round(n);
	if (rounded >= 1000) return `${(rounded / 1000).toFixed(rounded >= 10000 ? 0 : 1)}k`;
	return String(rounded);
}

export function formatEstimatedWithoutAccordion(value: EstimatedWithoutAccordion, contextWindow: number | null): string {
	const prefix = value.isPartial ? "≥" : "";
	const tokens = `${prefix}${formatTokenCount(value.inputTokens)}`;
	if (contextWindow == null || contextWindow <= 0) return `Without Accordion: ${tokens}`;
	const percent = Math.round((value.inputTokens / contextWindow) * 100);
	return `Without Accordion: ${tokens} / ${formatTokenCount(contextWindow)} · ${percent}%`;
}
