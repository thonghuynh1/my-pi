import { afterEach, describe, expect, it } from "vitest";
import {
	benchmarkAutomationTokenFromLocation,
	installAccordionAutomation,
} from "./automation.svelte";
import { ensureSlot, removeSlot } from "./sessionSlots.svelte";

const SESSION_A = "benchmark-ready-a";
const SESSION_B = "benchmark-ready-b";
const TOKEN = "a".repeat(48);

function addLiveSession(sessionId: string) {
	const slot = ensureSlot({
		registryProtocol: 1,
		protocolVersion: 5,
		sessionId,
		port: 4317,
		pid: 1,
		cwd: "/repo",
		title: "benchmark",
		model: "gpt-5.6-luna",
		tokens: null,
		contextWindow: 500_000,
		startedAt: Date.now(),
		heartbeatAt: Date.now(),
	});
	slot.status = "live";
	return slot;
}

afterEach(() => {
	removeSlot(SESSION_A);
	removeSlot(SESSION_B);
	delete (globalThis as any).__accordionAutomation;
	delete (globalThis as any).window;
});

describe("Accordion benchmark automation authorization", () => {
	it("is disabled by default and rejects missing or short query tokens", () => {
		expect(benchmarkAutomationTokenFromLocation({ search: "" } as Location)).toBeNull();
		expect(benchmarkAutomationTokenFromLocation({ search: "?accordion-benchmark-token=short" } as Location)).toBeNull();
		expect((globalThis as any).__accordionAutomation).toBeUndefined();
	});

	it("authorizes the exact token, rejects others, and installs idempotently", () => {
		addLiveSession(SESSION_A);
		(globalThis as any).window = globalThis;
		installAccordionAutomation(TOKEN);
		const api = (globalThis as any).__accordionAutomation;
		expect(() => api.snapshot("wrong", SESSION_A)).toThrow(/authorization failed/);
		expect(api.snapshot(TOKEN, "unknown")).toBeNull();
		installAccordionAutomation(TOKEN);
		expect((globalThis as any).__accordionAutomation).toBe(api);
	});

	it("acknowledges only the configured session and requires folding on", () => {
		addLiveSession(SESSION_A);
		addLiveSession(SESSION_B);
		(globalThis as any).window = globalThis;
		installAccordionAutomation(TOKEN);
		const api = (globalThis as any).__accordionAutomation;

		const stateA = api.configure(TOKEN, SESSION_A, {
			budget: 70_000,
			conductor: "my-customize-conductor",
			folding: true,
		});
		expect(stateA).toMatchObject({ sessionId: SESSION_A, ready: true, folding: true });
		expect(api.snapshot(TOKEN, SESSION_B).ready).toBe(false);

		const stateB = api.configure(TOKEN, SESSION_B, {
			budget: 70_000,
			conductor: "my-customize-conductor",
			folding: false,
		});
		expect(stateB).toMatchObject({ sessionId: SESSION_B, ready: false, folding: false, steeringReady: false });
		expect(api.snapshot(TOKEN, SESSION_A).ready).toBe(false);
	});

	it("throws for an unknown session on configure", () => {
		(globalThis as any).window = globalThis;
		installAccordionAutomation(TOKEN);
		const api = (globalThis as any).__accordionAutomation;
		expect(() => api.configure(TOKEN, "unknown", { budget: 1, conductor: "x", folding: true }))
			.toThrow(/not attached/);
	});
});
