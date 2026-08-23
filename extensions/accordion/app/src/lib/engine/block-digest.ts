import type { ExtractableBlock } from "./extractors";

const SERVER_PREFIX_PATTERN = /^(?:mcp__)?[\w.-]+(?:\/|__)[\w.-]+/i;
const FILLER_PREFIX = /^(?:let me|i'll|i will)\b\s*/i;

function fmtTok(tokens: number | undefined): string {
	if (tokens === undefined || !Number.isFinite(tokens)) return "";
	const thousands = Math.round((tokens / 1000) * 10) / 10;
	const value = Number.isInteger(thousands) ? String(thousands) : thousands.toFixed(1);
	return `~${value}k tok`;
}

function withTokens(body: string, tokens: number | undefined): string {
	const suffix = fmtTok(tokens);
	return suffix ? `${body} (${suffix})` : body;
}

function pairedString(args: Record<string, unknown> | undefined, key: string): string | undefined {
	const value = args?.[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function firstErrorLine(text: string | undefined): string | undefined {
	return text?.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim();
}

function firstSentence(text: string | undefined): string | undefined {
	const sentences = (text ?? "")
		.trim()
		.split(/\.\s|\.\n/)
		.map((sentence) => sentence.trim())
		.filter(Boolean);
	if (sentences.length === 0) return undefined;

	const meaningful = sentences.find((sentence) => !FILLER_PREFIX.test(sentence));
	return (meaningful ?? sentences[0].replace(FILLER_PREFIX, "")).slice(0, 80);
}

function mcpIdentity(toolName: string): string {
	const name = toolName.replace(/^mcp__/i, "");
	return name.replace(/__/g, "/");
}

export function richDigest(block: ExtractableBlock, pairedArgs?: Record<string, unknown>): string | undefined {
	if (block.isError === true) {
		const line = firstErrorLine(block.text);
		return line ? `❌ ${line}` : undefined;
	}

	const toolName = block.toolName?.trim() ?? "";
	const normalizedTool = toolName.toLowerCase();

	if (normalizedTool === "read") {
		const path = pairedString(pairedArgs, "path");
		return path ? withTokens(`📄 ${path}`, block.tokens) : undefined;
	}

	if (normalizedTool === "subagent") {
		const type = pairedString(pairedArgs, "type");
		const task = pairedString(pairedArgs, "task");
		return type && task ? withTokens(`🔀 ${type}: "${task.slice(0, 80)}"`, block.tokens) : undefined;
	}

	if (block.kind === "text") {
		const sentence = firstSentence(block.text);
		return sentence ? withTokens(`🤖 "${sentence}"`, block.tokens) : undefined;
	}

	if (block.kind === "thinking") return withTokens("💭", block.tokens);

	if (SERVER_PREFIX_PATTERN.test(toolName)) {
		return withTokens(`🔌 ${mcpIdentity(toolName)}`, block.tokens);
	}

	return undefined;
}
