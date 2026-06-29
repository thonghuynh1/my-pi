/**
 * broker.test.ts — unit tests for the Accordion Browser Broker.
 *
 * Uses a fake upstream WebSocket server for proxy tests so no real Pi session
 * or ~/.accordion filesystem state is required.
 */
import { describe, it, expect, afterEach } from "vitest";
import * as http from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { createBrokerServer } from "../src/server.ts";
import { PROTOCOL_VERSION, REGISTRY_PROTOCOL } from "../src/types.ts";
import type { BrokerStore, SessionEntry, WatchedSession } from "../src/types.ts";

// ── Test helpers ──────────────────────────────────────────────────────────────

/** Builds an in-memory BrokerStore for tests. */
function memoryStore(opts: {
	watched?: string[];
	ports?: Record<string, number>;
	/** Sessions in this list are "watched" but their entry returns null (stale/missing). */
	stale?: string[];
}): BrokerStore {
	const watched = new Set(opts.watched ?? []);
	const stale = new Set(opts.stale ?? []);
	const ports = opts.ports ?? {};

	return {
		isWatched(sessionId) {
			return watched.has(sessionId);
		},
		getWatchedSessions(): WatchedSession[] {
			return Array.from(watched)
				.filter((id) => !stale.has(id) && ports[id] !== undefined)
				.map((id) => ({
					sessionId: id,
					addedAt: Date.now() - 1000,
					lastSeenAt: Date.now(),
				}));
		},
		getSessionEntry(sessionId): SessionEntry | null {
			if (!watched.has(sessionId) || stale.has(sessionId)) return null;
			const port = ports[sessionId];
			if (port === undefined) return null;
			return {
				registryProtocol: REGISTRY_PROTOCOL,
				protocolVersion: PROTOCOL_VERSION,
				sessionId,
				port,
				pid: process.pid,
				cwd: "/tmp",
				title: "test session",
				model: "test-model",
				tokens: null,
				contextWindow: null,
				startedAt: Date.now() - 5000,
				heartbeatAt: Date.now() - 100,
			};
		},
	};
}

/** Starts a fake upstream Accordion session WebSocket server. */
function startFakeUpstream(): Promise<{ wss: WebSocketServer; port: number; close(): Promise<void> }> {
	return new Promise((resolve) => {
		const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
		wss.on("listening", () => {
			const addr = wss.address() as { port: number };
			resolve({
				wss,
				port: addr.port,
				close: () => new Promise<void>((res) => {
					// Terminate active client connections so wss.close() can return.
					for (const ws of wss.clients) ws.terminate();
					wss.close(() => res());
				}),
			});
		});
	});
}

/** Starts a broker server with the given store. */
function startBroker(store: BrokerStore): Promise<{ server: http.Server; port: number; close(): Promise<void> }> {
	return new Promise((resolve, reject) => {
		const server = createBrokerServer(store);
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address() as { port: number };
			resolve({
				server,
				port: addr.port,
				close: () => new Promise<void>((res) => {
					// Force-close lingering WebSocket upgrades so server.close() returns promptly.
					(server as http.Server & { closeAllConnections?(): void }).closeAllConnections?.();
					server.close(() => res());
				}),
			});
		});
		server.on("error", reject);
	});
}

/** GET helper — returns parsed JSON or throws on non-2xx. */
async function getJson(url: string): Promise<unknown> {
	return new Promise((resolve, reject) => {
		http.get(url, (res) => {
			let body = "";
			res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
			res.on("end", () => {
				if (res.statusCode !== 200) {
					reject(new Error(`HTTP ${res.statusCode} for ${url}: ${body}`));
				} else {
					resolve(JSON.parse(body));
				}
			});
		}).on("error", reject);
	});
}

/** Returns a promise that resolves once the WebSocket client fires the given event once. */
function waitForEvent<T>(ws: WebSocket, event: string): Promise<T> {
	return new Promise((resolve, reject) => {
		ws.once(event, resolve as (...args: unknown[]) => void);
		ws.once("error", reject);
	});
}

/** Closes a WebSocket client, resolving immediately if it is already closed. */
function closeWs(ws: WebSocket): Promise<void> {
	return new Promise((resolve) => {
		if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
			resolve();
			return;
		}
		ws.once("close", resolve);
		ws.close();
	});
}

/** Collects cleanup handles so afterEach can tear them all down. */
const cleanupTasks: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const task of cleanupTasks.splice(0)) {
		await task().catch(() => {});
	}
});

// ── GET /__accordion/broker-meta ──────────────────────────────────────────────

describe("GET /__accordion/broker-meta", () => {
	it("returns mode 'broker' and protocolVersion 5", async () => {
		const broker = await startBroker(memoryStore({}));
		cleanupTasks.push(broker.close);

		const meta = await getJson(`http://127.0.0.1:${broker.port}/__accordion/broker-meta`) as Record<string, unknown>;

		expect(meta.mode).toBe("broker");
		expect(meta.protocolVersion).toBe(5);
	});

	it("includes empty apiBase and wsBase", async () => {
		const broker = await startBroker(memoryStore({}));
		cleanupTasks.push(broker.close);

		const meta = await getJson(`http://127.0.0.1:${broker.port}/__accordion/broker-meta`) as Record<string, unknown>;

		expect(meta.apiBase).toBe("");
		expect(meta.wsBase).toBe("");
	});
});

// ── GET /__accordion/sessions ─────────────────────────────────────────────────

describe("GET /__accordion/sessions", () => {
	it("returns only live watched sessions", async () => {
		const upstream = await startFakeUpstream();
		cleanupTasks.push(upstream.close);

		const broker = await startBroker(
			memoryStore({ watched: ["sess-a"], ports: { "sess-a": upstream.port } }),
		);
		cleanupTasks.push(broker.close);

		const sessions = await getJson(`http://127.0.0.1:${broker.port}/__accordion/sessions`) as unknown[];

		expect(Array.isArray(sessions)).toBe(true);
		expect(sessions).toHaveLength(1);
		expect((sessions[0] as Record<string, unknown>).sessionId).toBe("sess-a");
	});

	it("excludes sessions not in the watched list", async () => {
		const broker = await startBroker(memoryStore({ watched: [] }));
		cleanupTasks.push(broker.close);

		const sessions = await getJson(`http://127.0.0.1:${broker.port}/__accordion/sessions`) as unknown[];

		expect(sessions).toHaveLength(0);
	});

	it("excludes stale watched sessions", async () => {
		const broker = await startBroker(
			memoryStore({
				watched: ["stale-sess"],
				ports: { "stale-sess": 9999 },
				stale: ["stale-sess"],
			}),
		);
		cleanupTasks.push(broker.close);

		const sessions = await getJson(`http://127.0.0.1:${broker.port}/__accordion/sessions`) as unknown[];

		expect(sessions).toHaveLength(0);
	});

	it("excludes sessions that were never watched (no port entry)", async () => {
		const broker = await startBroker(
			// watched but ports map is empty → getWatchedSessions filters them out
			memoryStore({ watched: ["unwatched-sess"], ports: {} }),
		);
		cleanupTasks.push(broker.close);

		const sessions = await getJson(`http://127.0.0.1:${broker.port}/__accordion/sessions`) as unknown[];

		expect(sessions).toHaveLength(0);
	});
});

// ── WS /ws/session/<sessionId> — proxy ───────────────────────────────────────

describe("WS /ws/session/<sessionId>", () => {
	it("forwards a text frame from browser to upstream unchanged", async () => {
		const upstream = await startFakeUpstream();
		cleanupTasks.push(upstream.close);

		const broker = await startBroker(
			memoryStore({ watched: ["s1"], ports: { s1: upstream.port } }),
		);
		cleanupTasks.push(broker.close);

		const upstreamReceived = new Promise<string>((resolve) => {
			upstream.wss.on("connection", (ws) => {
				ws.on("message", (data) => resolve(data.toString()));
			});
		});

		const browserWs = new WebSocket(`ws://127.0.0.1:${broker.port}/ws/session/s1`);
		cleanupTasks.push(() => closeWs(browserWs));
		await waitForEvent(browserWs, "open");

		// Small pause to let broker finish its upstream upgrade handshake.
		await new Promise((r) => setTimeout(r, 50));

		browserWs.send("hello from browser");
		const received = await upstreamReceived;

		expect(received).toBe("hello from browser");
	});

	it("forwards a text frame from upstream to browser unchanged", async () => {
		const upstream = await startFakeUpstream();
		cleanupTasks.push(upstream.close);

		const broker = await startBroker(
			memoryStore({ watched: ["s2"], ports: { s2: upstream.port } }),
		);
		cleanupTasks.push(broker.close);

		let upstreamServerWs: WebSocket | undefined;
		const upstreamConnected = new Promise<void>((resolve) => {
			upstream.wss.on("connection", (ws) => {
				upstreamServerWs = ws;
				resolve();
			});
		});

		const browserWs = new WebSocket(`ws://127.0.0.1:${broker.port}/ws/session/s2`);
		cleanupTasks.push(() => closeWs(browserWs));
		await waitForEvent(browserWs, "open");
		await upstreamConnected;

		const browserReceived = waitForEvent<WebSocket.RawData>(browserWs, "message");
		upstreamServerWs!.send("hello from upstream");

		const data = await browserReceived;
		expect(data.toString()).toBe("hello from upstream");
	});

	it("forwards binary frames unchanged", async () => {
		const upstream = await startFakeUpstream();
		cleanupTasks.push(upstream.close);

		const broker = await startBroker(
			memoryStore({ watched: ["s3"], ports: { s3: upstream.port } }),
		);
		cleanupTasks.push(broker.close);

		const upstreamReceived = new Promise<Buffer>((resolve) => {
			upstream.wss.on("connection", (ws) => {
				ws.on("message", (data) => resolve(data as Buffer));
			});
		});

		const browserWs = new WebSocket(`ws://127.0.0.1:${broker.port}/ws/session/s3`);
		cleanupTasks.push(() => closeWs(browserWs));
		await waitForEvent(browserWs, "open");
		await new Promise((r) => setTimeout(r, 50));

		const payload = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
		browserWs.send(payload);

		const received = await upstreamReceived;
		expect(Buffer.from(received)).toEqual(payload);
	});

	it("closing the browser side closes the upstream connection", async () => {
		const upstream = await startFakeUpstream();
		cleanupTasks.push(upstream.close);

		const broker = await startBroker(
			memoryStore({ watched: ["s4"], ports: { s4: upstream.port } }),
		);
		cleanupTasks.push(broker.close);

		let upstreamServerWs: WebSocket | undefined;
		const upstreamConnected = new Promise<void>((resolve) => {
			upstream.wss.on("connection", (ws) => {
				upstreamServerWs = ws;
				resolve();
			});
		});

		const browserWs = new WebSocket(`ws://127.0.0.1:${broker.port}/ws/session/s4`);
		await waitForEvent(browserWs, "open");
		await upstreamConnected;

		const upstreamClosed = waitForEvent<number>(upstreamServerWs!, "close");
		browserWs.close();

		await upstreamClosed;
		// If we get here without timeout, upstream was properly closed.
	});

	it("closing the upstream side closes the browser connection", async () => {
		const upstream = await startFakeUpstream();
		cleanupTasks.push(upstream.close);

		const broker = await startBroker(
			memoryStore({ watched: ["s5"], ports: { s5: upstream.port } }),
		);
		cleanupTasks.push(broker.close);

		let upstreamServerWs: WebSocket | undefined;
		const upstreamConnected = new Promise<void>((resolve) => {
			upstream.wss.on("connection", (ws) => {
				upstreamServerWs = ws;
				resolve();
			});
		});

		const browserWs = new WebSocket(`ws://127.0.0.1:${broker.port}/ws/session/s5`);
		cleanupTasks.push(() => closeWs(browserWs));
		await waitForEvent(browserWs, "open");
		await upstreamConnected;

		const browserClosed = waitForEvent<number>(browserWs, "close");
		upstreamServerWs!.close();

		await browserClosed;
	});
});

// ── Rejection of bad session IDs ──────────────────────────────────────────────

describe("rejection of bad sessions", () => {
	it("rejects an unknown session ID", async () => {
		const broker = await startBroker(memoryStore({ watched: [] }));
		cleanupTasks.push(broker.close);

		const ws = new WebSocket(`ws://127.0.0.1:${broker.port}/ws/session/no-such-session`);
		await expect(waitForEvent(ws, "open")).rejects.toBeDefined();
	});

	it("rejects an unwatched session even when a port could exist", async () => {
		const upstream = await startFakeUpstream();
		cleanupTasks.push(upstream.close);

		// Not added to watched set
		const broker = await startBroker(memoryStore({ watched: [], ports: { orphan: upstream.port } }));
		cleanupTasks.push(broker.close);

		const ws = new WebSocket(`ws://127.0.0.1:${broker.port}/ws/session/orphan`);
		await expect(waitForEvent(ws, "open")).rejects.toBeDefined();
	});

	it("rejects a stale session ID", async () => {
		const upstream = await startFakeUpstream();
		cleanupTasks.push(upstream.close);

		const broker = await startBroker(
			memoryStore({
				watched: ["stale"],
				ports: { stale: upstream.port },
				stale: ["stale"],
			}),
		);
		cleanupTasks.push(broker.close);

		const ws = new WebSocket(`ws://127.0.0.1:${broker.port}/ws/session/stale`);
		await expect(waitForEvent(ws, "open")).rejects.toBeDefined();
	});
});
