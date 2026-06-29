/**
 * server.ts — broker HTTP server and WebSocket proxy.
 *
 * Routes:
 *   GET /__accordion/broker-meta   — returns BrokerMeta JSON
 *   GET /__accordion/sessions      — returns live watched sessions
 *   WS  /ws/session/<sessionId>    — transparent proxy to the session's
 *                                    Accordion extension server
 *
 * The server is stateless with respect to Accordion fold plans. It forwards
 * WebSocket frames bidirectionally without inspecting or buffering them, keeping
 * latency well inside the extension's 250 ms plan-reply deadline.
 *
 * Rejection behavior (status/close) for bad sessions:
 *   - Unknown path:     HTTP 404 response, socket destroyed
 *   - Not in watched:   HTTP 404, socket destroyed
 *   - Missing/stale:    HTTP 404, socket destroyed (session file absent/expired)
 *   - Upstream error:   WS close code 1011, browser WS closed
 */
import * as http from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { BrokerMeta, BrokerStore } from "./types.ts";
import { PROTOCOL_VERSION } from "./types.ts";

export type { BrokerStore };

/** Creates and returns the broker HTTP server. Caller is responsible for `.listen()`. */
export function createBrokerServer(store: BrokerStore): http.Server {
	const wss = new WebSocketServer({ noServer: true });

	const server = http.createServer((req, res) => {
		const url = req.url ?? "/";

		if (req.method === "GET" && url === "/__accordion/broker-meta") {
			const body: BrokerMeta = {
				mode: "broker",
				protocolVersion: PROTOCOL_VERSION,
				apiBase: "",
				wsBase: "",
			};
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(body));
			return;
		}

		if (req.method === "GET" && url === "/__accordion/sessions") {
			const sessions = store.getWatchedSessions();
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(sessions));
			return;
		}

		res.writeHead(404);
		res.end("Not found");
	});

	server.on("upgrade", (req, socket, head) => {
		const url = req.url ?? "";
		const match = /^\/ws\/session\/([^/]+)$/.exec(url);

		if (!match) {
			socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
			socket.destroy();
			return;
		}

		const sessionId = decodeURIComponent(match[1]);

		if (!store.isWatched(sessionId)) {
			socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
			socket.destroy();
			return;
		}

		const entry = store.getSessionEntry(sessionId);
		if (!entry) {
			socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
			socket.destroy();
			return;
		}

		wss.handleUpgrade(req, socket, head, (browserWs) => {
			proxySession(browserWs, entry.port);
		});
	});

	return server;
}

/**
 * Opens an upstream WebSocket to `127.0.0.1:<port>` and pipes frames both ways.
 * Either side closing triggers a clean close on the other side.
 */
function proxySession(browserWs: WebSocket, upstreamPort: number): void {
	const upstream = new WebSocket(`ws://127.0.0.1:${upstreamPort}`);

	function closeBoth(): void {
		if (upstream.readyState < WebSocket.CLOSING) upstream.close();
		if (browserWs.readyState < WebSocket.CLOSING) browserWs.close();
	}

	upstream.on("open", () => {
		browserWs.on("message", (data, isBinary) => {
			if (upstream.readyState === WebSocket.OPEN) {
				upstream.send(data, { binary: isBinary });
			}
		});

		upstream.on("message", (data, isBinary) => {
			if (browserWs.readyState === WebSocket.OPEN) {
				browserWs.send(data, { binary: isBinary });
			}
		});
	});

	// Either side closing or erroring closes both.
	upstream.on("close", closeBoth);
	upstream.on("error", closeBoth);
	browserWs.on("close", closeBoth);
	browserWs.on("error", closeBoth);
}
