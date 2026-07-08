import { describe, it, expect } from "vitest";
import { normalizeBrokerSession } from "./brokerSessions";
import { PROTOCOL_VERSION } from "./protocol";
import { REGISTRY_PROTOCOL, type SessionEntry } from "./registry";

function fullSession(overrides: Partial<SessionEntry> = {}): SessionEntry {
	return {
		registryProtocol: REGISTRY_PROTOCOL,
		protocolVersion: PROTOCOL_VERSION,
		sessionId: "full-session",
		port: 43210,
		pid: 123,
		cwd: "C:/repo",
		title: "Full session",
		model: "test-model",
		tokens: 42,
		contextWindow: 1000,
		estimatedWithoutAccordion: {
			inputTokens: 1500,
			isPartial: false,
			components: { fullTokens: 1000, systemPromptTokens: 100, toolsTokens: 300, systemPayloadTokens: 100 },
		},
		startedAt: 100,
		heartbeatAt: 200,
		...overrides,
	};
}

describe("normalizeBrokerSession", () => {
	it("keeps the current full SessionEntry response", () => {
		const session = fullSession();

		expect(normalizeBrokerSession(session)).toEqual(session);
	});

	it("accepts the legacy WatchedSession response from an already-running broker", () => {
		const session = normalizeBrokerSession({
			sessionId: "legacy-session",
			addedAt: 300,
			lastSeenAt: 400,
		});

		expect(session).toMatchObject({
			registryProtocol: REGISTRY_PROTOCOL,
			protocolVersion: PROTOCOL_VERSION,
			sessionId: "legacy-session",
			port: 0,
			pid: 0,
			cwd: "",
			title: "legacy-session",
			startedAt: 300,
			heartbeatAt: 400,
		});
	});

	it("rejects malformed broker session rows", () => {
		expect(normalizeBrokerSession({ sessionId: "missing-times" })).toBeNull();
		expect(normalizeBrokerSession(fullSession({ protocolVersion: PROTOCOL_VERSION + 1 }))).toBeNull();
		expect(normalizeBrokerSession(fullSession({ estimatedWithoutAccordion: { inputTokens: 1, isPartial: false, components: {} as never } }))).toBeNull();
		expect(normalizeBrokerSession(fullSession({ estimatedWithoutAccordion: { inputTokens: Number.POSITIVE_INFINITY, isPartial: false, components: { fullTokens: 1 } } }))).toBeNull();
		expect(normalizeBrokerSession(null)).toBeNull();
	});
});
