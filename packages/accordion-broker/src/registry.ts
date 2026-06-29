/**
 * registry.ts — disk-backed BrokerStore implementation.
 *
 * Reads session data from:
 *   ~/.accordion/sessions/<sessionId>.json    (SessionEntry)
 *   ~/.accordion/watched-sessions.json        (WatchedSession[])
 *
 * Also owns write helpers for:
 *   ~/.accordion/browser-broker.json          (BrokerRegistryEntry)
 *   ~/.accordion/watch-requests/<id>.json     (watch request signals)
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { BrokerStore, SessionEntry, WatchedSession, BrokerRegistryEntry } from "./types.ts";
import {
	REGISTRY_PROTOCOL,
	STALE_AFTER_MS,
	REGISTRY_DIR,
	SESSIONS_SUBDIR,
	WATCHED_SESSIONS_FILE,
	WATCH_REQUESTS_SUBDIR,
	BROWSER_BROKER_FILE,
} from "./types.ts";

const HOME = process.env.ACCORDION_HOME || os.homedir();
const registryRoot = path.join(HOME, REGISTRY_DIR);
const sessionsDir = path.join(registryRoot, SESSIONS_SUBDIR);
const watchedSessionsPath = path.join(registryRoot, WATCHED_SESSIONS_FILE);
const watchRequestsDir = path.join(registryRoot, WATCH_REQUESTS_SUBDIR);
const brokerFilePath = path.join(registryRoot, BROWSER_BROKER_FILE);

// ── Readers ───────────────────────────────────────────────────────────────────

function readJsonFile<T>(filePath: string): T | null {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
	} catch {
		return null;
	}
}

/**
 * Returns a live SessionEntry for `sessionId`, or null when the file is absent,
 * malformed, wrong protocol version, or the heartbeat is stale.
 */
export function readSessionEntry(sessionId: string, now: number): SessionEntry | null {
	const raw = readJsonFile<Record<string, unknown>>(path.join(sessionsDir, `${sessionId}.json`));
	if (!raw || typeof raw !== "object") return null;
	if (raw["registryProtocol"] !== REGISTRY_PROTOCOL) return null;
	if (typeof raw["port"] !== "number" || (raw["port"] as number) <= 0) return null;
	if (typeof raw["heartbeatAt"] !== "number") return null;
	if (now - (raw["heartbeatAt"] as number) > STALE_AFTER_MS) return null;
	if (typeof raw["sessionId"] !== "string") return null;
	return raw as unknown as SessionEntry;
}

/** Returns the raw watched-session list (does not filter by liveness). */
function readWatchedSessions(): WatchedSession[] {
	const raw = readJsonFile<unknown>(watchedSessionsPath);
	if (!Array.isArray(raw)) return [];
	return raw.filter(
		(s) =>
			s !== null &&
			typeof s === "object" &&
			typeof (s as Record<string, unknown>)["sessionId"] === "string" &&
			typeof (s as Record<string, unknown>)["addedAt"] === "number" &&
			typeof (s as Record<string, unknown>)["lastSeenAt"] === "number",
	) as WatchedSession[];
}

// ── Writers ───────────────────────────────────────────────────────────────────

/** Ensures the registry directory and its subdirectories exist. */
function ensureRegistryDirs(): void {
	fs.mkdirSync(sessionsDir, { recursive: true });
	fs.mkdirSync(watchRequestsDir, { recursive: true });
}

/** Atomically writes `data` to `filePath` using a temp-then-rename pattern. */
function atomicWrite(filePath: string, data: unknown): void {
	const tmp = `${filePath}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(data), "utf8");
	fs.renameSync(tmp, filePath);
}

/** Writes (or refreshes) the broker registry file with the given port. */
export function writeBrokerFile(port: number): void {
	ensureRegistryDirs();
	const entry: BrokerRegistryEntry = {
		port,
		pid: process.pid,
		startedAt: Date.now(),
		heartbeatAt: Date.now(),
	};
	atomicWrite(brokerFilePath, entry);
}

/** Refreshes `heartbeatAt` in the broker registry file. */
export function refreshBrokerHeartbeat(port: number): void {
	const prev = readJsonFile<BrokerRegistryEntry>(brokerFilePath);
	const entry: BrokerRegistryEntry = {
		port,
		pid: process.pid,
		startedAt: prev?.startedAt ?? Date.now(),
		heartbeatAt: Date.now(),
	};
	atomicWrite(brokerFilePath, entry);
}

/** Reads the current broker file. Returns null if absent or unreadable. */
export function readBrokerFile(): BrokerRegistryEntry | null {
	return readJsonFile<BrokerRegistryEntry>(brokerFilePath);
}

/** Removes the broker registry file on clean shutdown. */
export function removeBrokerFile(): void {
	try {
		fs.unlinkSync(brokerFilePath);
	} catch {
		// best-effort
	}
}

/**
 * Writes a watch request for `sessionId` so the broker can add it to the
 * watched list. Written by the `/accordion` extension command.
 */
export function writeWatchRequest(sessionId: string): void {
	ensureRegistryDirs();
	atomicWrite(path.join(watchRequestsDir, `${sessionId}.json`), {
		sessionId,
		ts: Date.now(),
	});
}

/**
 * Adds `sessionId` to the watched-sessions list if not already present
 * (idempotent). Used by the broker when consuming a watch request.
 */
export function addWatchedSession(sessionId: string): void {
	ensureRegistryDirs();
	const existing = readWatchedSessions();
	if (existing.some((s) => s.sessionId === sessionId)) {
		// Update lastSeenAt only
		const updated = existing.map((s) =>
			s.sessionId === sessionId ? { ...s, lastSeenAt: Date.now() } : s,
		);
		atomicWrite(watchedSessionsPath, updated);
	} else {
		const now = Date.now();
		atomicWrite(watchedSessionsPath, [
			...existing,
			{ sessionId, addedAt: now, lastSeenAt: now },
		]);
	}
}

/** Consumes pending watch request files and returns the number accepted. */
export function consumeWatchRequests(): number {
	ensureRegistryDirs();
	let consumed = 0;
	let names: string[] = [];
	try {
		names = fs.readdirSync(watchRequestsDir);
	} catch {
		return 0;
	}
	for (const name of names) {
		if (!name.endsWith(".json")) continue;
		const filePath = path.join(watchRequestsDir, name);
		const raw = readJsonFile<unknown>(filePath);
		if (
			raw !== null &&
			typeof raw === "object" &&
			typeof (raw as Record<string, unknown>)["sessionId"] === "string"
		) {
			addWatchedSession((raw as Record<string, string>)["sessionId"]);
			consumed++;
		}
		try {
			fs.unlinkSync(filePath);
		} catch {
			// best-effort
		}
	}
	return consumed;
}

/**
 * Removes dead session IDs from watched-sessions.json on disk.
 * A session is dead if its session file is missing or its heartbeat is stale.
 * Called periodically from the heartbeat loop.
 */
export function pruneWatchedSessions(): number {
	ensureRegistryDirs();
	const existing = readWatchedSessions();
	if (existing.length === 0) return 0;
	const now = Date.now();
	const alive = existing.filter((s) => readSessionEntry(s.sessionId, now) !== null);
	const pruned = existing.length - alive.length;
	if (pruned > 0) {
		atomicWrite(watchedSessionsPath, alive);
	}
	return pruned;
}

// ── Disk-backed BrokerStore ───────────────────────────────────────────────────

/**
 * Creates a BrokerStore backed by the ~/.accordion filesystem layout.
 * Used in production; tests pass their own in-memory store.
 */
export function createDiskStore(): BrokerStore {
	return {
		isWatched(sessionId) {
			return readWatchedSessions().some((s) => s.sessionId === sessionId);
		},
		getWatchedSessions() {
			const now = Date.now();
			return readWatchedSessions()
				.map((s) => readSessionEntry(s.sessionId, now))
				.filter((s): s is SessionEntry => s !== null);
		},
		getSessionEntry(sessionId) {
			return readSessionEntry(sessionId, Date.now());
		},
	};
}
