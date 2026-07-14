import { beforeEach, describe, expect, it } from "vitest";

import * as cacheTracker from "./cache-tracker";
import {
	handleBeforeProviderRequest,
	getOriginal,
	install,
	reset,
	shouldCompress,
} from "./proactive-compress";

class FakePi {
	readonly handlers: Array<(event: { payload?: unknown }) => unknown> = [];

	on(event: string, handler: (event: { payload?: unknown }) => unknown): void {
		if (event === "before_provider_request") this.handlers.push(handler);
	}
}

const longContent = Array.from({ length: 2000 }, (_, index) => `line-${index} ${"x".repeat(12)}`).join("\n");

describe("proactive compression", () => {
	beforeEach(() => {
		cacheTracker.reset();
		reset();
	});

	it("registers before the cache tracker", () => {
		const pi = new FakePi();
		install(pi);
		cacheTracker.install(pi as never, () => "anthropic");

		expect(pi.handlers).toHaveLength(2);
		expect(pi.handlers[0]).not.toBe(pi.handlers[1]);
	});

	it("compresses large tool results and stores the original", () => {
		const payload = { messages: [{ role: "tool", toolName: "bash", content: longContent }] };
		const result = handleBeforeProviderRequest({ payload }) as typeof payload;
		const compressed = result.messages[0].content;

		expect(compressed).not.toBe(longContent);
		expect(compressed).toContain("line-0");
		expect(compressed).toContain("line-1999");
		expect(compressed).toMatch(/Full output: recall\("[0-9a-f]{6}"\)/);
		expect(Math.ceil(compressed.length / 4)).toBeLessThanOrEqual(200);
		const code = compressed.match(/recall\("([0-9a-f]{6})"\)/)?.[1];
		expect(code).toBeDefined();
		expect(getOriginal(code ?? "")).toBe(longContent);
	});

	it.each(["mcp", "recall"])("does not compress %s tool results", (toolName) => {
		const payload = { messages: [{ role: "tool", toolName, content: longContent }] };
		expect((handleBeforeProviderRequest({ payload }) as typeof payload).messages[0].content).toBe(longContent);
	});

	it("does not compress below the threshold", () => {
		const content = "small content";
		const payload = { messages: [{ role: "tool", toolName: "bash", content }] };
		expect((handleBeforeProviderRequest({ payload }) as typeof payload).messages[0].content).toBe(content);
	});

	it("does not compress a frozen message", () => {
		expect(shouldCompress({ role: "tool", toolName: "bash", content: longContent }, 3, 5)).toBe(false);
	});

	it("finds a tool name on the paired assistant message", () => {
		const payload = {
			messages: [
				{ role: "assistant", tool_calls: [{ function: { name: "mcp" } }] },
				{ role: "tool", content: longContent },
			],
		};
		expect((handleBeforeProviderRequest({ payload }) as typeof payload).messages[1].content).toBe(longContent);
	});
});
