import { readFileSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as http from "node:http";
import WebSocket from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

vi.mock("ws", async () => await import("./node_modules/ws/wrapper.mjs"));

import { linearize, type PiMessage } from "../app/src/lib/live/mapping";
import { estTokens } from "../app/src/lib/engine/tokens";

const testEnvironment = vi.hoisted(() => {
	const original = process.env.ACCORDION_HOME;
	const base = process.env.TEMP ?? process.env.TMP ?? ".";
	const home = `${base}/accordion-chunked-compaction-${process.pid}-${Date.now()}`;
	process.env.ACCORDION_HOME = home;
	return { home, original };
});
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(read: () => T | undefined, timeoutMs = 2_000): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const value = read();
		if (value !== undefined) return value;
		await wait(10);
	}
	throw new Error("timed out waiting for test state");
}

type Hook = (...args: unknown[]) => unknown;

function makePi(): { pi: ExtensionAPI; invoke: (name: string, ...args: unknown[]) => Promise<unknown>; registered: () => string[]; invoked: () => string[] } {
	const hooks = new Map<string, Hook[]>();
	const calls: string[] = [];
	const pi = {
		registerFlag: (): void => {},
		getFlag: (): undefined => undefined,
		on: (name: string, handler: Hook): void => {
			const handlers = hooks.get(name) ?? [];
			handlers.push(handler);
			hooks.set(name, handlers);
		},
		registerCommand: (): void => {},
		registerTool: (): void => {},
	};
	return {
		pi: pi as unknown as ExtensionAPI,
		invoke: async (name: string, ...args: unknown[]): Promise<unknown> => {
			calls.push(name);
			let result: unknown;
			for (const handler of hooks.get(name) ?? []) result = await handler(...args);
			return result;
		},
		registered: () => [...hooks.keys()],
		invoked: () => [...calls],
	};
}

describe("accordion.chunkedCompactionJsonl", () => {
	let tempDir: string | undefined;
	afterEach(() => {
		if (testEnvironment.original === undefined) delete process.env.ACCORDION_HOME;
		else process.env.ACCORDION_HOME = testEnvironment.original;
		if (tempDir) rmSync(tempDir, { recursive: true, force: true });
		vi.restoreAllMocks();
		tempDir = undefined;
	});

	it("writes one rollover block and omits it on a non-rollover turn through accordionLive", async () => {
		tempDir = testEnvironment.home;
		process.env.ACCORDION_HOME = testEnvironment.home;
		vi.resetModules();
		const listenSpy = vi.spyOn(http.Server.prototype, "listen");

		const { default: accordionLive } = await import("./accordion");
		const { pi, invoke, registered, invoked } = makePi();
		accordionLive(pi);
		expect(registered()).toContain("session_start");

		const messages: PiMessage[] = [1, 2, 3, 4].map((timestamp) => ({
			role: "assistant",
			timestamp,
			responseId: `resp-${timestamp}`,
			content: [{ type: "text", text: `message ${timestamp}` }],
		}));
		const blocks = linearize(messages);
		const digest = "⟨chunked-compaction · 4 blocks · turns 1–4 · content-hash sha256:test⟩\n\nbody\n\nMembers: {#a} {#b} {#c} {#d}";
		const group = {
			id: "g:rollover",
			memberIds: blocks.map((block) => block.id),
			summaryText: digest,
		};
		const context = {
			model: { id: "test-model", provider: "anthropic", contextWindow: 200_000 },
			getContextUsage: () => ({ tokens: 20_000, contextWindow: 200_000 }),
			getSystemPrompt: () => "",
			modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: false, error: "unused" }) },
			sessionManager: { buildSessionContext: () => ({ messages: [] }) },
			ui: { setStatus: (): void => {}, notify: (): void => {}, theme: { fg: (_name: string, value: string) => value } },
		};

		await invoke("session_start", undefined, context);
		expect(invoked()).toContain("session_start");
		const server = await waitFor(() => {
			const instance = listenSpy.mock.instances[0];
			const address = instance?.address();
			return address && typeof address === "object" ? { instance, port: address.port } : undefined;
		});
		const port = server.port;

		const ws = new WebSocket(`ws://127.0.0.1:${String(port)}`);
		let rolloverSent = false;
		let sessionId = "";
		ws.on("message", (raw: Buffer) => {
			const message = JSON.parse(raw.toString()) as { type?: string; reqId?: number; sessionId?: string };
			if (message.type === "hello") {
				sessionId = message.sessionId ?? "";
				return;
			}
			if (message.type === "sync" && typeof message.reqId === "number") {
				const plan = rolloverSent ? { ops: [], groups: [] } : { ops: [], groups: [group] };
				rolloverSent = true;
				ws.send(JSON.stringify({ type: "plan", reqId: message.reqId, ...plan }));
			}
		});
		await new Promise<void>((resolve, reject) => {
			ws.once("open", () => resolve());
			ws.once("error", reject);
		});

		const beforeProviderRequest = { payload: { messages } };
		await invoke("before_provider_request", beforeProviderRequest);
		await invoke("before_provider_request", beforeProviderRequest);
		const firstResult = await invoke("context", { messages }, context) as { messages: PiMessage[] };
		const secondResult = await invoke("context", { messages }, context);

		expect(firstResult.messages).toHaveLength(1);
		expect(secondResult).toBeUndefined();
		const diagnosticDirectory = path.join(tempDir, ".accordion", "diagnostics");
		const diagnosticPath = path.join(diagnosticDirectory, `${sessionId}.context.jsonl`);
		const records = await waitFor(() => {
			try {
				const lines = readFileSync(diagnosticPath, "utf8").trim().split("\n");
				return lines.length === 2 ? lines.map((line) => JSON.parse(line) as Record<string, unknown>) : undefined;
			} catch {
				return undefined;
			}
		});

		const rollover = records[0].chunkedCompaction as Record<string, unknown>;
		expect(rollover.event).toBe("rollover");
		expect(rollover.preGroupBlockCount).toBe(group.memberIds.length);
		expect(rollover.digestTokens).toBe(estTokens(digest));
		expect(rollover.frozenFromIndexBefore).not.toBe(rollover.frozenFromIndexAfter);
		expect(rollover.digestContentHash).toBe("sha256:test");
		expect(records[1].chunkedCompaction).toBeUndefined();

		await invoke("session_shutdown");
		ws.close();
	});
});
