/**
 * types.ts — shared data shapes for the Accordion Browser Broker.
 *
 * Mirrors the constants from vendor/accordion/app/src/lib/live/registry.ts and
 * protocol.ts but kept local so the broker package stays independent of the
 * Svelte app bundle.
 */

/** Wire protocol version this broker speaks. Mirrors PROTOCOL_VERSION in protocol.ts. */
export const PROTOCOL_VERSION = 5;

/** Must match REGISTRY_PROTOCOL in vendor registry.ts so session files parse correctly. */
export const REGISTRY_PROTOCOL = 1;

/** A session whose heartbeat is older than this is considered dead. Mirrors STALE_AFTER_MS. */
export const STALE_AFTER_MS = 15_000;

// ── File-system layout constants ──────────────────────────────────────────────

export const REGISTRY_DIR = ".accordion";
export const SESSIONS_SUBDIR = "sessions";
export const WATCHED_SESSIONS_FILE = "watched-sessions.json";
export const WATCH_REQUESTS_SUBDIR = "watch-requests";
export const BROWSER_BROKER_FILE = "browser-broker.json";
export const BROKER_HEARTBEAT_INTERVAL_MS = 5_000;
export const WATCH_REQUEST_POLL_INTERVAL_MS = 500;

// ── Wire shapes ───────────────────────────────────────────────────────────────

/** Normative response for `GET /__accordion/broker-meta`. */
export interface BrokerMeta {
	mode: "broker";
	protocolVersion: number;
	apiBase: string;
	wsBase: string;
}

/** A session that was explicitly added via `/accordion`. */
export interface WatchedSession {
	sessionId: string;
	addedAt: number;
	lastSeenAt: number;
}

export interface EstimatedWithoutAccordion {
	inputTokens: number;
	isPartial: boolean;
	components: {
		fullTokens: number;
		systemPromptTokens?: number;
		toolsTokens?: number;
		systemPayloadTokens?: number;
	};
}

/** One live pi session entry from `~/.accordion/sessions/<sessionId>.json`. */
export interface SessionEntry {
	registryProtocol: number;
	protocolVersion: number;
	sessionId: string;
	/** Ephemeral loopback port the session's Accordion extension listens on. */
	port: number;
	pid: number;
	cwd: string;
	title: string;
	model: string;
	tokens: number | null;
	contextWindow: number | null;
	estimatedWithoutAccordion?: EstimatedWithoutAccordion;
	startedAt: number;
	heartbeatAt: number;
}

/** Broker registry file written to `~/.accordion/browser-broker.json`. */
export interface BrokerRegistryEntry {
	port: number;
	pid: number;
	startedAt: number;
	heartbeatAt: number;
}

// ── Dependency-injection interface ────────────────────────────────────────────

/**
 * Provides session data to the broker server. In production, backed by disk
 * reads from `~/.accordion/`. In tests, backed by an in-memory map so no disk
 * state is required.
 */
export interface BrokerStore {
	/** True when the session was explicitly added via `/accordion`. */
	isWatched(sessionId: string): boolean;
	/**
	 * Returns watched sessions that are currently live (non-stale heartbeat and
	 * existing session file). Never includes sessions whose Pi process has exited.
	 */
	getWatchedSessions(): SessionEntry[];
	/**
	 * Returns the current session entry if the session is alive (non-stale), or
	 * null if the session file is missing, stale, or for a mismatched protocol.
	 */
	getSessionEntry(sessionId: string): SessionEntry | null;
}
