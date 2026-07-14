import { createHash } from "node:crypto";

import * as cacheTracker from "./cache-tracker";

export const MIN_TOKEN_THRESHOLD = 300;
const MAX_OUTPUT_TOKENS = 200;
const CHARS_PER_TOKEN = 4;
const FIRST_LINES = 8;
const LAST_LINES = 4;

const originals = new Map<string, string>();
let installed = false;

type ToolResultMessage = {
	role: "tool";
	content: string;
	toolName?: string;
	[key: string]: unknown;
};

type ProviderPayload = {
	messages?: unknown;
	input?: unknown;
	[key: string]: unknown;
};

export function getOriginal(code: string): string | undefined {
	return originals.get(code);
}

export function reset(): void {
	originals.clear();
}

export function install(pi: unknown): void {
	if (installed) return;
	installed = true;
	const api = pi as { on?: (event: string, handler: (event: { payload?: unknown }) => unknown) => void };
	api.on?.("before_provider_request", handleBeforeProviderRequest);
}

export function handleBeforeProviderRequest(event: { payload?: unknown }): unknown {
	const payload = asRecord(event.payload);
	if (!payload) return event.payload;

	const field = Array.isArray(payload.messages) ? "messages" : Array.isArray(payload.input) ? "input" : null;
	if (!field) return payload;

	const items = payload[field];
	if (!Array.isArray(items)) return payload;
	const frozenFromIndex = cacheTracker.getFrozenFromIndex();
	const messages = items.map((item, index) => {
		const pairedToolName = index > 0 ? findPairedToolName(asRecord(items[index - 1])) : undefined;
		const message = asToolResult(item, pairedToolName);
		if (!message || !shouldCompress(message, index, frozenFromIndex)) return item;

		const code = recallCode(message.content);
		originals.set(code, message.content);
		return { ...message, content: compress(message.content, code) };
	});

	return { ...payload, [field]: messages };
}

export function shouldCompress(msg: { role: string; toolName?: string; content: string }, index: number, frozenFromIndex: number): boolean {
	if (msg.role !== "tool") return false;
	const name = (msg.toolName ?? "").trim().toLowerCase();
	if (name === "mcp" || name === "recall") return false;
	if (estimateTokens(msg.content) < MIN_TOKEN_THRESHOLD) return false;
	if (index < frozenFromIndex) return false;
	return true;
}

export function compress(content: string, code = recallCode(content)): string {
	const lines = content.split("\n");
	const stats = `[${lines.length} lines, ~${estimateTokens(content)} tokens. Full output: recall("${code}")]`;
	const selected = lines.length <= FIRST_LINES + LAST_LINES
		? lines
		: [...lines.slice(0, FIRST_LINES), "...", ...lines.slice(-LAST_LINES)];
	const availableChars = MAX_OUTPUT_TOKENS * CHARS_PER_TOKEN - stats.length - 1;
	const body = selected.join("\n");
	const boundedBody = body.length > availableChars ? body.slice(0, Math.max(0, availableChars)) : body;
	return `${boundedBody}\n${stats}`;
}

export function estimateTokens(content: string): number {
	return Math.ceil(content.length / CHARS_PER_TOKEN);
}

function recallCode(content: string): string {
	return createHash("sha256").update(content).digest("hex").slice(0, 6);
}

function asToolResult(value: unknown, pairedToolName?: string): ToolResultMessage | null {
	const record = asRecord(value);
	if (!record || record.role !== "tool" || typeof record.content !== "string") return null;
	const toolName = typeof record.toolName === "string" ? record.toolName : pairedToolName;
	return toolName === undefined ? { ...record, role: "tool", content: record.content } : { ...record, role: "tool", content: record.content, toolName };
}

function findPairedToolName(message: ProviderPayload | null): string | undefined {
	if (!message) return undefined;
	if (typeof message.name === "string") return message.name;
	const toolCalls = message.tool_calls;
	if (Array.isArray(toolCalls) && toolCalls.length > 0) {
		const first = asRecord(toolCalls[0]);
		const fn = first && asRecord(first.function);
		if (fn && typeof fn.name === "string") return fn.name;
	}
	const content = message.content;
	if (Array.isArray(content)) {
		for (const part of content) {
			const partRecord = asRecord(part);
			if (partRecord && partRecord.type === "tool_use" && typeof partRecord.name === "string") return partRecord.name;
		}
	}
	return undefined;
}

function asRecord(value: unknown): ProviderPayload | null {
	return value !== null && typeof value === "object" ? value as ProviderPayload : null;
}
