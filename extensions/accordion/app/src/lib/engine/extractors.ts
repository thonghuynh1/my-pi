export interface ExtractableBlock {
	id?: string;
	kind: string;
	toolName?: string;
	isError?: boolean;
	text?: string;
}

const FILE_TOOLS = new Set(["read", "write", "edit", "find", "grep", "ls"]);
const PATH_ARGUMENT = /["']?path["']?\s*:\s*(?:"([^"]*)"|'([^']*)'|([^\s,}\]]+))/i;

function firstLine(text: string | undefined): string {
	return text?.split(/\r?\n/, 1)[0].trim() ?? "";
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

export function extractAsks(blocks: ExtractableBlock[]): string[] {
	return collect(
		blocks
			.filter((block) => block.kind === "user")
			.map((block) => firstLine(block.text).slice(0, 60))
			.filter((line) => line.length > 0),
		6,
	);
}

export function extractFiles(blocks: ExtractableBlock[]): string[] {
	const paths: string[] = [];
	for (const block of blocks) {
		if (block.kind !== "tool_call" || !block.toolName || !FILE_TOOLS.has(block.toolName)) continue;
		const match = block.text?.match(PATH_ARGUMENT);
		const path = match?.[1] ?? match?.[2] ?? match?.[3];
		if (path) paths.push(path);
	}
	return collect(paths, 8);
}

export function extractErrors(blocks: ExtractableBlock[]): string[] {
	return collect(
		blocks
			.filter((block) => block.isError === true)
			.map((block) => firstLine(block.text).slice(0, 80))
			.filter((line) => line.length > 0),
		3,
	);
}
