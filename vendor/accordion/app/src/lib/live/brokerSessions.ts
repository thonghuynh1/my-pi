import { PROTOCOL_VERSION } from "./protocol";
import { REGISTRY_PROTOCOL, type SessionEntry } from "./registry";

type LegacyWatchedSession = {
	sessionId: string;
	addedAt: number;
	lastSeenAt: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}

function isSessionEntry(value: unknown): value is SessionEntry {
	if (!isRecord(value)) return false;
	return (
		value["registryProtocol"] === REGISTRY_PROTOCOL &&
		value["protocolVersion"] === PROTOCOL_VERSION &&
		typeof value["sessionId"] === "string" &&
		typeof value["port"] === "number" &&
		typeof value["pid"] === "number" &&
		typeof value["cwd"] === "string" &&
		typeof value["title"] === "string" &&
		typeof value["model"] === "string" &&
		(value["tokens"] === null || typeof value["tokens"] === "number") &&
		(value["contextWindow"] === null || typeof value["contextWindow"] === "number") &&
		typeof value["startedAt"] === "number" &&
		typeof value["heartbeatAt"] === "number"
	);
}

function isLegacyWatchedSession(value: unknown): value is LegacyWatchedSession {
	if (!isRecord(value)) return false;
	return (
		typeof value["sessionId"] === "string" &&
		typeof value["addedAt"] === "number" &&
		typeof value["lastSeenAt"] === "number"
	);
}

export function normalizeBrokerSession(value: unknown): SessionEntry | null {
	if (isSessionEntry(value)) return value;
	if (!isLegacyWatchedSession(value)) return null;
	return {
		registryProtocol: REGISTRY_PROTOCOL,
		protocolVersion: PROTOCOL_VERSION,
		sessionId: value.sessionId,
		port: 0,
		pid: 0,
		cwd: "",
		title: value.sessionId,
		model: "",
		tokens: null,
		contextWindow: null,
		startedAt: value.addedAt,
		heartbeatAt: value.lastSeenAt,
	};
}
