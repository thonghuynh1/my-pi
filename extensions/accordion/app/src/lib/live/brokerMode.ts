/**
 * brokerMode.ts — detect whether this Accordion app instance is being served by the
 * broker (multi-session dashboard mode) or a single Pi session (direct mode).
 *
 * Detection is runtime only: GET /__accordion/broker-meta. No URL flags, no separate build.
 * The caller passes the expected protocol version so the check stays pure and testable.
 */

export const BROKER_META_URL = "/__accordion/broker-meta";

/** The JSON body returned by GET /__accordion/broker-meta when the broker is serving. */
export interface BrokerMeta {
	mode: "broker";
	protocolVersion: number;
	apiBase: string;
	wsBase: string;
}

/**
 * Result of detectBrokerMode():
 * - "broker": endpoint returned valid metadata → enter broker dashboard mode.
 * - "direct": endpoint returned 404/failed → fall back to normal single-session mode.
 * - "error": endpoint returned 200 but malformed or wrong protocolVersion → report detail,
 *   still fall back to direct mode so the app does not break.
 */
export type BrokerModeResult =
	| { kind: "broker"; meta: BrokerMeta }
	| { kind: "direct" }
	| { kind: "error"; detail: string };

/**
 * Fetch /__accordion/broker-meta and return the detection result.
 *
 * @param expectedProtocolVersion Pass PROTOCOL_VERSION from protocol.ts; a mismatch is
 * reported as an error so the user knows to upgrade the broker or the app.
 */
export async function detectBrokerMode(expectedProtocolVersion: number): Promise<BrokerModeResult> {
	try {
		const res = await fetch(BROKER_META_URL, { credentials: "same-origin" });
		if (!res.ok) return { kind: "direct" };

		const ct = res.headers.get("content-type") ?? "";
		if (!ct.includes("application/json")) {
			return { kind: "error", detail: "broker-meta returned non-JSON response" };
		}

		const body = (await res.json()) as unknown;
		if (!isBrokerMeta(body)) {
			return { kind: "error", detail: "broker-meta response has unexpected shape" };
		}
		if (body.protocolVersion !== expectedProtocolVersion) {
			return {
				kind: "error",
				detail: `broker protocol version mismatch: got ${body.protocolVersion}, expected ${expectedProtocolVersion}`,
			};
		}

		return { kind: "broker", meta: body };
	} catch {
		// Network error, CORS block, or any other exception → treat as unavailable.
		return { kind: "direct" };
	}
}

function isBrokerMeta(v: unknown): v is BrokerMeta {
	if (!v || typeof v !== "object") return false;
	const o = v as Record<string, unknown>;
	return (
		o["mode"] === "broker" &&
		typeof o["protocolVersion"] === "number" &&
		typeof o["apiBase"] === "string" &&
		typeof o["wsBase"] === "string"
	);
}
