import { describe, it, expect, vi, beforeEach } from "vitest";
import { detectBrokerMode, BROKER_META_URL } from "./brokerMode";
import { PROTOCOL_VERSION } from "./protocol";

/*
 * brokerMode.test.ts — runtime broker-mode detection.
 *
 * Tests the three outcomes:
 *   1. Broker meta present and valid → kind:"broker"
 *   2. Endpoint absent (404) or unreachable → kind:"direct" (existing single-session fallback)
 *   3. Malformed body or protocol mismatch → kind:"error" (reported; still falls back to direct)
 *
 * fetch is stubbed globally so no real HTTP is issued.
 */

// Stub global fetch before importing code that calls it.
const mockFetch = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", mockFetch);

/** Build a minimal Response-like object the tested code can consume. */
function fakeResponse(
	status: number,
	body?: unknown,
	contentType = "application/json",
): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: {
			get: (name: string) =>
				name.toLowerCase() === "content-type" ? contentType : null,
		},
		json: async () => body,
	} as unknown as Response;
}

function validMeta(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
	return {
		mode: "broker",
		protocolVersion: PROTOCOL_VERSION,
		apiBase: "",
		wsBase: "",
		...overrides,
	};
}

beforeEach(() => {
	mockFetch.mockReset();
});

// ── Success path ──────────────────────────────────────────────────────────────

describe("detectBrokerMode — success path", () => {
	it("returns kind:broker when the endpoint responds with valid broker metadata", async () => {
		const meta = validMeta();
		mockFetch.mockResolvedValueOnce(fakeResponse(200, meta));

		const result = await detectBrokerMode(PROTOCOL_VERSION);

		expect(result.kind).toBe("broker");
		if (result.kind === "broker") {
			expect(result.meta.mode).toBe("broker");
			expect(result.meta.protocolVersion).toBe(PROTOCOL_VERSION);
			expect(result.meta.apiBase).toBe("");
			expect(result.meta.wsBase).toBe("");
		}
	});

	it("calls the broker-meta endpoint with same-origin credentials", async () => {
		mockFetch.mockResolvedValueOnce(fakeResponse(200, validMeta()));

		await detectBrokerMode(PROTOCOL_VERSION);

		expect(mockFetch).toHaveBeenCalledWith(BROKER_META_URL, { credentials: "same-origin" });
	});
});

// ── Fallback path (direct / unavailable) ─────────────────────────────────────

describe("detectBrokerMode — 404 / unavailable → direct mode", () => {
	it("returns kind:direct when endpoint returns 404", async () => {
		mockFetch.mockResolvedValueOnce(fakeResponse(404));

		const result = await detectBrokerMode(PROTOCOL_VERSION);

		expect(result.kind).toBe("direct");
	});

	it("returns kind:direct when endpoint returns any non-2xx status", async () => {
		mockFetch.mockResolvedValueOnce(fakeResponse(503));

		const result = await detectBrokerMode(PROTOCOL_VERSION);

		expect(result.kind).toBe("direct");
	});

	it("returns kind:direct when fetch throws (network error, CORS, etc.)", async () => {
		mockFetch.mockRejectedValueOnce(new Error("Failed to fetch"));

		const result = await detectBrokerMode(PROTOCOL_VERSION);

		expect(result.kind).toBe("direct");
	});
});

// ── Error path (malformed / mismatch) — still falls back to direct UI ─────────

describe("detectBrokerMode — malformed or mismatched → error (no app crash)", () => {
	it("returns kind:error when response is not JSON (text/html)", async () => {
		mockFetch.mockResolvedValueOnce(fakeResponse(200, undefined, "text/html; charset=utf-8"));

		const result = await detectBrokerMode(PROTOCOL_VERSION);

		expect(result.kind).toBe("error");
		if (result.kind === "error") expect(result.detail).toBeTruthy();
	});

	it("returns kind:error when JSON body has wrong shape (missing required fields)", async () => {
		mockFetch.mockResolvedValueOnce(fakeResponse(200, { notABrokerPayload: true }));

		const result = await detectBrokerMode(PROTOCOL_VERSION);

		expect(result.kind).toBe("error");
		if (result.kind === "error") expect(result.detail).toMatch(/unexpected shape/i);
	});

	it("returns kind:error when mode field is not 'broker'", async () => {
		mockFetch.mockResolvedValueOnce(
			fakeResponse(200, validMeta({ mode: "direct-session" })),
		);

		const result = await detectBrokerMode(PROTOCOL_VERSION);

		expect(result.kind).toBe("error");
	});

	it("returns kind:error when protocolVersion mismatches", async () => {
		const wrongVersion = PROTOCOL_VERSION + 1;
		mockFetch.mockResolvedValueOnce(
			fakeResponse(200, validMeta({ protocolVersion: wrongVersion })),
		);

		const result = await detectBrokerMode(PROTOCOL_VERSION);

		expect(result.kind).toBe("error");
		if (result.kind === "error") expect(result.detail).toMatch(/mismatch/i);
	});

	it("does not throw on any input — always returns a BrokerModeResult", async () => {
		// Simulate an extremely malformed fetch chain: json() itself throws.
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			headers: { get: () => "application/json" },
			json: async () => { throw new SyntaxError("Unexpected token"); },
		} as unknown as Response);

		// Must not throw; must still return a typed result.
		await expect(detectBrokerMode(PROTOCOL_VERSION)).resolves.toBeDefined();
	});
});
