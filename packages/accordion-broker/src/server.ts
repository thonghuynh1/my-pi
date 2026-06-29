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
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import type { BrokerMeta, BrokerStore } from "./types.ts";
import { PROTOCOL_VERSION } from "./types.ts";

export interface BrokerServerOptions {
	clientRoot?: string | null;
}

const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript",
	".mjs": "text/javascript",
	".css": "text/css",
	".json": "application/json",
	".png": "image/png",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".woff2": "font/woff2",
	".woff": "font/woff",
	".txt": "text/plain",
	".map": "application/json",
};

function resolveClientRoot(explicitRoot?: string | null): string | null {
	const candidates = explicitRoot !== undefined
		? [explicitRoot]
		: [
			path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../vendor/accordion/app/build"),
			path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../vendor/accordion/extension/dist/client"),
		];
	for (const dir of candidates) {
		if (!dir) continue;
		try {
			if (fs.statSync(dir).isDirectory()) return dir;
		} catch {
			// try next
		}
	}
	return null;
}

function serveClient(req: http.IncomingMessage, res: http.ServerResponse, root: string): void {
	const u = new URL(req.url ?? "/", "http://127.0.0.1");
	let rel = decodeURIComponent(u.pathname);
	if (rel === "/") rel = "/index.html";
	let filePath = path.join(root, rel);
	const rootResolved = path.resolve(root);
	if (path.resolve(filePath) !== rootResolved && !path.resolve(filePath).startsWith(rootResolved + path.sep)) {
		res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
		res.end("Forbidden");
		return;
	}
	let exists = false;
	try {
		exists = fs.statSync(filePath).isFile();
	} catch {
		exists = false;
	}
	if (!exists) {
		if (path.extname(rel) === "") {
			filePath = path.join(root, "index.html");
		} else {
			res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
			res.end("Not found");
			return;
		}
	}
	let body: Buffer;
	try {
		body = fs.readFileSync(filePath);
	} catch {
		res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
		res.end("Not found");
		return;
	}
	res.writeHead(200, { "Content-Type": MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream" });
	res.end(body);
}

/** Creates and returns the broker HTTP server. Caller is responsible for `.listen()`. */
export function createBrokerServer(store: BrokerStore, options: BrokerServerOptions = {}): http.Server {
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

		if (req.method === "GET" || req.method === "HEAD") {
			const root = resolveClientRoot(options.clientRoot);
			if (!root) {
				res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
				res.end("No browser build found. Run `npm run accordion:build` or `npm run setup:accordion`.");
				return;
			}
			serveClient(req, res, root);
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

	// Buffer browser messages arriving before upstream is open.
	const earlyMessages: { data: WebSocket.RawData; isBinary: boolean }[] = [];
	let upstreamReady = false;

	function closeBoth(): void {
		if (upstream.readyState < WebSocket.CLOSING) upstream.close();
		if (browserWs.readyState < WebSocket.CLOSING) browserWs.close();
	}

	// Register browser→upstream relay immediately so no messages are lost.
	browserWs.on("message", (data, isBinary) => {
		if (upstreamReady && upstream.readyState === WebSocket.OPEN) {
			upstream.send(data, { binary: isBinary });
		} else {
			earlyMessages.push({ data, isBinary });
		}
	});

	upstream.on("open", () => {
		upstreamReady = true;
		for (const { data, isBinary } of earlyMessages.splice(0)) {
			upstream.send(data, { binary: isBinary });
		}
	});

	upstream.on("message", (data, isBinary) => {
		if (browserWs.readyState === WebSocket.OPEN) {
			browserWs.send(data, { binary: isBinary });
		}
	});

	upstream.on("close", closeBoth);
	upstream.on("error", closeBoth);
	browserWs.on("close", closeBoth);
	browserWs.on("error", closeBoth);
}
