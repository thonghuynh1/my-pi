import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getFrozenFromIndex, install, reset } from "./cache-tracker";

class FakePi {
	private readonly handlers = new Map<string, Array<(event: { payload?: unknown }) => unknown>>();

	on(event: string, handler: (event: { payload?: unknown }) => unknown): void {
		const existing = this.handlers.get(event) ?? [];
		existing.push(handler);
		this.handlers.set(event, existing);
	}

	emit(event: string, payload: { payload?: unknown }): void {
		for (const handler of this.handlers.get(event) ?? []) handler(payload);
	}
}

describe("cache tracker lifecycle", () => {
	const pi = new FakePi();
	let provider = "anthropic";

	beforeAll(() => {
		install(pi as never, () => provider);
	});

	beforeEach(() => {
		provider = "anthropic";
		reset();
	});

	it("cold start", () => {
		pi.emit("before_provider_request", {
			payload: makePayload({
				system: "system",
				messages: makeMessages(10),
			}),
		});

		expect(getFrozenFromIndex()).toBe(0);
	});

	it("identical messages", () => {
		const payload = makePayload({
			system: "system",
			messages: makeMessages(10),
		});

		pi.emit("before_provider_request", { payload });
		pi.emit("before_provider_request", { payload });

		expect(getFrozenFromIndex()).toBe(9);
	});

	it("mismatch at index 5", () => {
		pi.emit("before_provider_request", {
			payload: makePayload({
				system: "system",
				messages: makeMessages(10),
			}),
		});
		pi.emit("before_provider_request", {
			payload: makePayload({
				system: "system",
				messages: makeMessages(10, 5),
			}),
		});

		expect(getFrozenFromIndex()).toBe(4);
	});

	it("system prompt change", () => {
		pi.emit("before_provider_request", {
			payload: makePayload({
				system: "system-a",
				messages: makeMessages(10),
			}),
		});
		pi.emit("before_provider_request", {
			payload: makePayload({
				system: "system-b",
				messages: makeMessages(10),
			}),
		});

		expect(getFrozenFromIndex()).toBe(0);
	});

	it("tools change", () => {
		pi.emit("before_provider_request", {
			payload: makePayload({
				system: "system",
				messages: makeMessages(10),
				tools: [{ name: "tool-a" }],
			}),
		});
		pi.emit("before_provider_request", {
			payload: makePayload({
				system: "system",
				messages: makeMessages(10),
				tools: [{ name: "tool-b" }],
			}),
		});

		expect(getFrozenFromIndex()).toBe(0);
	});

	it("provider change", () => {
		pi.emit("before_provider_request", {
			payload: makePayload({
				system: "system",
				messages: makeMessages(10),
			}),
		});
		provider = "openai";
		pi.emit("before_provider_request", {
			payload: makePayload({
				system: "system",
				messages: makeMessages(10),
			}),
		});

		expect(getFrozenFromIndex()).toBe(0);
	});

	it("empty messages", () => {
		pi.emit("before_provider_request", {
			payload: makePayload({
				system: "system",
				messages: [],
			}),
		});
		pi.emit("before_provider_request", {
			payload: makePayload({
				system: "system",
				messages: [],
			}),
		});

		expect(getFrozenFromIndex()).toBe(0);
	});
});

function makePayload(args: {
	system?: unknown;
	messages?: unknown[];
	tools?: unknown;
}): { system?: unknown; messages?: unknown[]; tools?: unknown } {
	return {
		system: args.system,
		messages: args.messages,
		tools: args.tools,
	};
}

function makeMessages(count: number, mismatchIndex?: number): Array<{ role: string; content: string }> {
	return Array.from({ length: count }, (_, index) => ({
		role: index % 2 === 0 ? "user" : "assistant",
		content: mismatchIndex === index ? `changed-${index}` : `message-${index}`,
	}));
}
