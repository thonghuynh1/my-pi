export interface ExtractableBlock {
	id?: string;
	kind: string;
	toolName?: string;
	isError?: boolean;
	text?: string;
	recallCode?: string;
	retrievalIdentity?: string;
	tokens?: number;
}

export type BlockTier = "high" | "medium" | "low";

export interface McpIndexEntry {
	identity: string;
	codes: string[];
}

const FILE_TOOLS = new Set(["read", "write", "edit", "find", "grep", "ls"]);
const HIGH_TIER_TOOLS = new Set(["edit", "write", "multiedit", "run_tests"]);
const MEDIUM_TIER_TOOLS = new Set(["subagent", "mcp"]);
const TEST_RUNNER_PATTERN = /\b(?:npm\s+test|npx\s+(?:vitest|jest)|pytest|dotnet\s+test|go\s+test|cargo\s+test|mix\s+test)\b/i;
const SERVER_PREFIX_PATTERN = /^(?:mcp__)?[\w.-]+(?:\/|__)[\w.-]+/i;
const PATH_ARGUMENT = /["']?path["']?\s*:\s*(?:"([^"]*)"|'([^']*)'|([^\s,}\]]+))/i;

export function blockTier(block: ExtractableBlock): BlockTier {
	const toolName = block.toolName?.trim().toLowerCase();

	if (block.isError === true) return "high";
	if (toolName && HIGH_TIER_TOOLS.has(toolName)) return "high";
	if (toolName === "bash" && block.text !== undefined && TEST_RUNNER_PATTERN.test(block.text)) return "high";
	if (block.kind === "user") return "medium";
	if (toolName === "bash") return "medium";
	if (block.kind === "text") return "medium";
	if (toolName && (MEDIUM_TIER_TOOLS.has(toolName) || SERVER_PREFIX_PATTERN.test(toolName))) return "medium";
	return "low";
}

function firstLine(text: string | undefined): string {
	return text?.split(/\r?\n/, 1)[0].trim() ?? "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseArguments(text: string | undefined): Record<string, unknown> | undefined {
	const value = text?.trim() ?? "";
	const json = value.startsWith("{") ? value : value.replace(/^\S+\s*/, "");
	if (!json) return undefined;

	try {
		const parsed: unknown = JSON.parse(json);
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function stringArgument(args: Record<string, unknown> | undefined, name: string): string | undefined {
	const value = args?.[name];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function collect(values: Iterable<string>, limit: number): string[] {
	const result: string[] = [];
	const seen = new Set<string>();
	for (const value of values) {
		if (seen.has(value)) continue;
		seen.add(value);
		result.push(value);
		if (result.length === limit) break;
	}
	return result;
}

export function extractAsks(blocks: readonly ExtractableBlock[]): string[] {
	return collect(
		blocks
			.filter((block) => block.kind === "user")
			.map((block) => firstLine(block.text).slice(0, 60))
			.filter((line) => line.length > 0),
		6,
	);
}

export function extractFiles(blocks: readonly ExtractableBlock[]): string[] {
	const paths: string[] = [];
	for (const block of blocks) {
		const toolName = block.toolName?.trim().toLowerCase();
		if (block.kind !== "tool_call" || !toolName || !FILE_TOOLS.has(toolName)) continue;
		const parsedPath = stringArgument(parseArguments(block.text), "path");
		const match = parsedPath ? undefined : block.text?.match(PATH_ARGUMENT);
		const path = parsedPath ?? match?.[1] ?? match?.[2] ?? match?.[3];
		if (path) paths.push(path);
	}
	return collect(paths, 8);
}

export function buildMcpIndex(blocks: readonly ExtractableBlock[]): McpIndexEntry[] {
	const index = new Map<string, string[]>();

	for (const block of blocks) {
		const toolName = block.toolName?.trim().toLowerCase();
		if (block.kind !== "tool_call" || !toolName || FILE_TOOLS.has(toolName) || !block.recallCode) continue;

		let identity: string | undefined;
		if (toolName === "mcp") {
			identity = firstLine(block.retrievalIdentity).slice(0, 120);
		} else if (toolName === "subagent") {
			const task = firstLine(stringArgument(parseArguments(block.text), "task")).slice(0, 40);
			if (task) identity = `subagent/${task}`;
		} else {
			identity = firstLine(toolName).slice(0, 80);
		}
		if (!identity) continue;

		let codes = index.get(identity);
		if (!codes) {
			if (index.size >= 6) continue;
			codes = [];
			index.set(identity, codes);
		}
		if (!codes.includes(block.recallCode)) codes.push(block.recallCode);
	}

	return Array.from(index, ([identity, codes]) => ({ identity, codes }));
}

export function extractErrors(blocks: readonly ExtractableBlock[]): string[] {
	return collect(
		blocks
			.filter((block) => block.isError === true)
			.map((block) => firstLine(block.text).slice(0, 80))
			.filter((line) => line.length > 0),
		3,
	);
}

export interface DigestMeta {
	foldCode?: string;
	blockCount: number;
	turnRange: string;
	tokens: number;
}

export function formatMcpIndex(entries: McpIndexEntry[]): string {
	if (entries.length === 0) return "";
	return [
		"[MCP Index]",
		...entries.map(({ identity, codes }) => `  ${identity} → ${codes.join(", ")}`),
	].join("\n");
}

export function buildSemanticDigest(blocks: readonly ExtractableBlock[], meta: DigestMeta): string {
	const header = meta.foldCode
		? `{#${meta.foldCode} FOLDED} group · ${meta.blockCount} blocks · ${meta.turnRange} · ~${meta.tokens} tok`
		: `group · ${meta.blockCount} blocks · ${meta.turnRange} · ~${meta.tokens} tok`;
	const lines = [header];
	const asks = extractAsks(blocks);
	const files = extractFiles(blocks);
	const errors = extractErrors(blocks);
	const mcpIndex = formatMcpIndex(buildMcpIndex(blocks));

	if (asks.length > 0) lines.push(`[Asks] ${asks.join(" · ")}`);
	if (files.length > 0) lines.push(`[Files] ${files.join(", ")}`);
	if (errors.length > 0) lines.push(`[Errors] ${errors.join(" · ")}`);
	if (mcpIndex) lines.push(mcpIndex);

	return lines.join("\n");
}
