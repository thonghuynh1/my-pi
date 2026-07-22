/**
 * index.ts — broker entry point and public API.
 *
 * In production, call `startBroker()` to bind a loopback HTTP server, write the
 * broker registry file, and start the heartbeat. The broker prints its URL and
 * stays alive until the process exits.
 *
 * Exports `createBrokerServer` for tests that need to spin up a server with an
 * injected in-memory store.
 */
import * as http from "node:http";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createBrokerServer } from "./server.ts";
import {
	createDiskStore,
	writeBrokerFile,
	refreshBrokerHeartbeat,
	removeBrokerFile,
	consumeWatchRequests,
	pruneWatchedSessions,
} from "./registry.ts";
import { BROKER_HEARTBEAT_INTERVAL_MS, WATCH_REQUEST_POLL_INTERVAL_MS } from "./types.ts";

export { createBrokerServer } from "./server.ts";
export { createDiskStore } from "./registry.ts";
export type { BrokerStore, BrokerMeta, WatchedSession, SessionEntry } from "./types.ts";

export interface BrokerHandle {
	port: number;
	server: http.Server;
	stop(): Promise<void>;
}

/**
 * Starts the singleton broker on a random loopback port. Writes the broker
 * registry file and starts the heartbeat. Returns a handle to stop the broker.
 */
export async function startBroker(): Promise<BrokerHandle> {
	const store = createDiskStore();
	const server = createBrokerServer(store);

	const port = await new Promise<number>((resolve, reject) => {
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address();
			if (addr && typeof addr === "object") {
				resolve(addr.port);
			} else {
				reject(new Error("Could not determine broker port"));
			}
		});
		server.on("error", reject);
	});

	writeBrokerFile(port);

	consumeWatchRequests();
	const heartbeat = setInterval(() => {
		try { refreshBrokerHeartbeat(port); } catch { /* disk error — retry next tick */ }
		try { pruneWatchedSessions(); } catch { /* best-effort */ }
	}, BROKER_HEARTBEAT_INTERVAL_MS);
	const watchRequests = setInterval(() => {
		try { consumeWatchRequests(); } catch { /* best-effort */ }
	}, WATCH_REQUEST_POLL_INTERVAL_MS);

	function stop(): Promise<void> {
		clearInterval(heartbeat);
		clearInterval(watchRequests);
		removeBrokerFile();
		return new Promise((resolve, reject) => {
			server.close((err) => (err ? reject(err) : resolve()));
		});
	}

	return { port, server, stop };
}

// ── CLI entry point ───────────────────────────────────────────────────────────

// Run when invoked directly: node --import tsx/esm src/index.ts
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]).replace(/\.[cm]?[jt]s$/, "") === path.resolve(__filename).replace(/\.[cm]?[jt]s$/, "")) {
	startBroker().then(({ port }) => {
		console.log(`Accordion Browser Broker running at http://127.0.0.1:${port}`);
		console.log(`Dashboard: http://127.0.0.1:${port}/`);
	}).catch((err: unknown) => {
		console.error("Broker startup failed:", err);
		process.exit(1);
	});
}
