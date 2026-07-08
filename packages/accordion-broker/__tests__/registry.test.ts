import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let home = "";
let registry: typeof import("../src/registry.ts");

beforeAll(async () => {
	home = fs.mkdtempSync(path.join(os.tmpdir(), "accordion-registry-"));
	process.env.ACCORDION_HOME = home;
	registry = await import("../src/registry.ts");
});

beforeEach(() => {
	const accordionDir = path.join(home, ".accordion");
	const watchedPath = path.join(accordionDir, "watched-sessions.json");
	const watchRequestsDir = path.join(accordionDir, "watch-requests");
	const sessionsDir = path.join(accordionDir, "sessions");
	try { fs.writeFileSync(watchedPath, "[]"); } catch { /* ok */ }
	try { fs.rmSync(watchRequestsDir, { recursive: true, force: true }); } catch { /* ok */ }
	try { fs.rmSync(sessionsDir, { recursive: true, force: true }); } catch { /* ok */ }
});

afterAll(() => {
	delete process.env.ACCORDION_HOME;
	if (home) fs.rmSync(home, { recursive: true, force: true });
});

describe("watch requests", () => {
	it("moves a watch request into the watched-session list", () => {
		registry.writeWatchRequest("session-a");

		expect(registry.consumeWatchRequests()).toBe(1);

		const watchedPath = path.join(home, ".accordion", "watched-sessions.json");
		const watched = JSON.parse(fs.readFileSync(watchedPath, "utf8")) as Array<Record<string, unknown>>;
		expect(watched).toHaveLength(1);
		expect(watched[0]?.sessionId).toBe("session-a");
		expect(fs.existsSync(path.join(home, ".accordion", "watch-requests", "session-a.json"))).toBe(false);
	});

	it("idempotent: adding the same session twice does not duplicate", () => {
		registry.writeWatchRequest("session-idem");
		registry.consumeWatchRequests();
		registry.writeWatchRequest("session-idem");
		registry.consumeWatchRequests();

		const watchedPath = path.join(home, ".accordion", "watched-sessions.json");
		const watched = JSON.parse(fs.readFileSync(watchedPath, "utf8")) as Array<Record<string, unknown>>;
		const matches = watched.filter((w) => w.sessionId === "session-idem");
		expect(matches).toHaveLength(1);
	});
});

describe("session registry", () => {
	it("drops malformed estimates", () => {
		const sessionsDir = path.join(home, ".accordion", "sessions");
		fs.mkdirSync(sessionsDir, { recursive: true });
		fs.writeFileSync(path.join(sessionsDir, "bad-estimate.json"), JSON.stringify({
			registryProtocol: 1,
			protocolVersion: 5,
			sessionId: "bad-estimate",
			port: 9999,
			pid: process.pid,
			cwd: "/tmp",
			title: "bad",
			model: "m",
			tokens: null,
			contextWindow: null,
			estimatedWithoutAccordion: { inputTokens: -1, isPartial: false, components: { fullTokens: 1 } },
			startedAt: Date.now(),
			heartbeatAt: Date.now(),
		}));

		expect(registry.readSessionEntry("bad-estimate", Date.now())?.estimatedWithoutAccordion).toBeUndefined();
	});

	it("removes dead session IDs from watched-sessions.json", () => {
		registry.writeWatchRequest("alive-session");
		registry.writeWatchRequest("dead-session");
		registry.consumeWatchRequests();

		// Create a live session file for alive-session only
		const sessionsDir = path.join(home, ".accordion", "sessions");
		fs.mkdirSync(sessionsDir, { recursive: true });
		fs.writeFileSync(path.join(sessionsDir, "alive-session.json"), JSON.stringify({
			registryProtocol: 1,
			protocolVersion: 5,
			sessionId: "alive-session",
			port: 9999,
			pid: process.pid,
			cwd: "/tmp",
			title: "alive",
			model: "m",
			tokens: null,
			contextWindow: null,
			estimatedWithoutAccordion: {
				inputTokens: 1500,
				isPartial: false,
				components: { fullTokens: 1000, systemPromptTokens: 100, toolsTokens: 300, systemPayloadTokens: 100 },
			},
			startedAt: Date.now(),
			heartbeatAt: Date.now(),
		}));
		// dead-session has no session file

		const pruned = registry.pruneWatchedSessions();

		expect(pruned).toBe(1);
		const watchedPath = path.join(home, ".accordion", "watched-sessions.json");
		const watched = JSON.parse(fs.readFileSync(watchedPath, "utf8")) as Array<Record<string, unknown>>;
		expect(watched).toHaveLength(1);
		expect(watched[0]?.sessionId).toBe("alive-session");
		expect(registry.readSessionEntry("alive-session", Date.now())?.estimatedWithoutAccordion).toEqual({
			inputTokens: 1500,
			isPartial: false,
			components: { fullTokens: 1000, systemPromptTokens: 100, toolsTokens: 300, systemPayloadTokens: 100 },
		});
	});

	it("returns 0 when all sessions are alive", () => {
		registry.writeWatchRequest("healthy-session");
		registry.consumeWatchRequests();

		const sessionsDir = path.join(home, ".accordion", "sessions");
		fs.mkdirSync(sessionsDir, { recursive: true });
		fs.writeFileSync(path.join(sessionsDir, "healthy-session.json"), JSON.stringify({
			registryProtocol: 1,
			protocolVersion: 5,
			sessionId: "healthy-session",
			port: 9999,
			pid: process.pid,
			cwd: "/tmp",
			title: "healthy",
			model: "m",
			tokens: null,
			contextWindow: null,
			startedAt: Date.now(),
			heartbeatAt: Date.now(),
		}));

		expect(registry.pruneWatchedSessions()).toBe(0);
	});
});
