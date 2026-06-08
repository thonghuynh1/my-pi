/**
 * frontend-coach
 *
 * Hosts a tiny HTTP + WebSocket server on 127.0.0.1:7777.
 *  - HTTP  GET /picker.js  → serves the in-page click picker (one-time fetch)
 *  - WS    /               → live channel between the page and pi
 *
 * In the browser:
 *  1. Open your app (e.g. https://localhost:5050/user/<uuid>/aggregatedmessages)
 *  2. Click the bookmarklet (see README) or use the dev-build inline bootstrap.
 *  3. Press Alt+P to arm picker, click an element, type an instruction.
 *  4. pi receives a user message and starts editing.
 *
 * The LLM can call browser_highlight / browser_inspect / browser_eval to talk
 * back to the page.
 *
 * Commands:
 *   /coach-status       show current state and port
 *   /coach-off          release the port so another pi instance can take it
 *   /coach-on           re-bind the port (default 7777 or $FRONTEND_COACH_PORT)
 *   /coach-bookmarklet  print bookmarklet for manual injection
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";

const HOST = "127.0.0.1";
const PORT = Number(process.env.FRONTEND_COACH_PORT ?? 7777);

export default async function (pi: ExtensionAPI) {
	const here = dirname(fileURLToPath(import.meta.url));
	const pickerPath = join(here, "picker.js");

	// `setStatus` lives on ctx.ui; captured at session_start.
	let ui: { setStatus: (key: string, text: string | undefined) => void } | null = null;

	// Shared global so other extensions (e.g. usage-footer) can render our status.
	const coachState = ((globalThis as any).__frontendCoach ??= {
		clients: 0,
		label: "off",
		port: PORT,
		running: false,
	}) as { clients: number; label: string; port: number; running: boolean };
	coachState.port = PORT;
	coachState.running = false;

	const setStatus = (text: string | undefined) => {
		coachState.label = text ?? "";
		ui?.setStatus("frontend-coach", text);
	};

	// Server handles + per-connection bookkeeping. All null/empty while stopped.
	let http: Server | null = null;
	let wss: WebSocketServer | null = null;
	const clients = new Set<WebSocket>();
	const pending = new Map<string, (value: unknown) => void>();

	const updateStatus = () => {
		coachState.clients = clients.size;
		if (!coachState.running) return; // label already set by stop/error path
		setStatus(
			clients.size === 0
				? "waiting"
				: `${clients.size} browser${clients.size === 1 ? "" : "s"}`,
		);
	};

	function broadcast(msg: unknown) {
		const data = JSON.stringify(msg);
		for (const ws of clients) {
			if (ws.readyState === ws.OPEN) ws.send(data);
		}
	}

	function request<T = unknown>(kind: string, payload: Record<string, unknown>, timeoutMs = 5000): Promise<T> {
		if (!coachState.running) {
			return Promise.reject(new Error("frontend-coach is off in this pi instance (run /coach-on to enable)."));
		}
		if (clients.size === 0) {
			return Promise.reject(new Error("No browser connected to frontend-coach (open the page and click the bookmarklet)."));
		}
		const reqId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				pending.delete(reqId);
				reject(new Error(`Browser did not respond to '${kind}' within ${timeoutMs}ms`));
			}, timeoutMs);
			pending.set(reqId, (value) => {
				clearTimeout(timer);
				resolve(value as T);
			});
			broadcast({ kind, reqId, ...payload });
		});
	}

	function attachWs(server: Server): WebSocketServer {
		const w = new WebSocketServer({ server });
		w.on("connection", (ws) => {
			clients.add(ws);
			updateStatus();
			// Send picker source so a CSP-restricted page can bootstrap us over WS
			// (no need for an http://localhost fetch).
			try {
				const code = readFileSync(pickerPath, "utf8");
				ws.send(JSON.stringify({ kind: "picker_source", code }));
			} catch (err) {
				console.warn("[frontend-coach] failed to read picker.js for bootstrap:", (err as Error).message);
			}
			ws.on("close", () => {
				clients.delete(ws);
				updateStatus();
			});
			ws.on("message", (raw) => {
				let msg: any;
				try { msg = JSON.parse(raw.toString()); } catch { return; }

				// Reply to a request we initiated
				if (msg.reqId && pending.has(msg.reqId)) {
					pending.get(msg.reqId)!(msg.result);
					pending.delete(msg.reqId);
					return;
				}

				// User clicked an element in the page
				if (msg.kind === "user_click") {
					const chain = Array.isArray(msg.componentChain) ? msg.componentChain : [];
					const chainStr = chain.length
						? chain
							.map((c: any) => {
								const props = c.propKeys?.length ? ` {${c.propKeys.join(", ")}}` : "";
								const src = c.source?.fileName ? ` @ ${c.source.fileName}:${c.source.line}` : "";
								return `  - ${c.name}${props}${src}`;
							})
							.join("\n")
						: "  (no React fiber found — likely not a React subtree)";
					const hosts = Array.isArray(msg.scriptHosts) && msg.scriptHosts.length
						? msg.scriptHosts.join(", ")
						: "(none)";
					const prompt =
						`The user clicked an element in the browser and asked you to change it.\n\n` +
						`Page URL : ${msg.url ?? "(unknown)"}\n` +
						`Selector : ${msg.selector ?? "(unknown)"}\n` +
						`Source   : ${msg.sourceFile ?? "(no source-map hint)"}\n` +
						`Bounding : ${JSON.stringify(msg.rect ?? {})}\n` +
						`Computed : ${JSON.stringify(msg.styles ?? {})}\n\n` +
						`React component chain (clicked → root):\n${chainStr}\n\n` +
						`Script origins loaded on this page: ${hosts}\n\n` +
						`outerHTML (truncated):\n${msg.outerHTML ?? ""}\n\n` +
						`User instruction:\n${msg.instruction ?? "(none)"}\n\n` +
						`Use the React component chain + script origins to pick the right repo BEFORE searching files. ` +
						`Check AGENTS.md for the dev-host → repo map. You can call browser_highlight(selector) to visually confirm ` +
						`before editing. Edit the source files to apply the change.`;
					try {
						pi.sendUserMessage(prompt);
					} catch {
						pi.sendUserMessage(prompt, { deliverAs: "followUp" });
					}
				}
			});
		});
		return w;
	}

	// Try to bind. Resolves with { ok, reason? }. Never throws.
	async function startServer(): Promise<{ ok: boolean; reason?: string }> {
		if (coachState.running) return { ok: true, reason: "already running" };

		const server = createServer((req: IncomingMessage, res: ServerResponse) => {
			const url = (req.url ?? "/").split("?")[0];
			if (req.method === "GET" && (url === "/picker.js" || url === "/")) {
				try {
					const body = readFileSync(pickerPath, "utf8");
					res.writeHead(200, {
						"Content-Type": "application/javascript; charset=utf-8",
						"Access-Control-Allow-Origin": "*",
						"Cache-Control": "no-store",
					});
					res.end(body);
					return;
				} catch (err) {
					res.writeHead(500, { "Content-Type": "text/plain" });
					res.end(`picker.js not found: ${(err as Error).message}`);
					return;
				}
			}
			res.writeHead(404, { "Content-Type": "text/plain" });
			res.end("not found");
		});

		const w = attachWs(server);

		return new Promise<{ ok: boolean; reason?: string }>((resolve) => {
			const onError = (err: NodeJS.ErrnoException) => {
				server.off("listening", onListen);
				try { w.close(); } catch {}
				try { server.close(); } catch {}
				const reason = err.code === "EADDRINUSE"
					? `port ${PORT} busy`
					: (err.code ?? err.message);
				setStatus(`off (${reason})`);
				resolve({ ok: false, reason });
			};
			const onListen = () => {
				server.off("error", onError);
				http = server;
				wss = w;
				coachState.running = true;
				updateStatus(); // sets label to "waiting" / "N browsers"
				resolve({ ok: true });
			};
			server.once("error", onError);
			server.once("listening", onListen);
			server.listen(PORT, HOST);
		});
	}

	function stopServer(reason = "manual"): void {
		if (!coachState.running) return;
		for (const ws of clients) try { ws.close(); } catch {}
		clients.clear();
		pending.clear();
		try { wss?.close(); } catch {}
		try { http?.close(); } catch {}
		wss = null;
		http = null;
		coachState.running = false;
		coachState.clients = 0;
		setStatus(`off (${reason})`);
	}

	pi.on("session_start", async (_event, ctx) => {
		ui = ctx.ui;
		if (coachState.running) updateStatus();
		else setStatus(coachState.label || "off");
	});

	// ------- Initial bind -------
	const initial = await startServer();
	if (!initial.ok) {
		console.warn(
			`[frontend-coach] could not bind ${HOST}:${PORT} (${initial.reason}).\n` +
			`  This pi will run with frontend-coach disabled. Use /coach-on to retry,\n` +
			`  or set FRONTEND_COACH_PORT=7778 to bind a different port (also update\n` +
			`  Web/src/index.tsx bootstrap if you do).`,
		);
	}

	// ------- Tools the LLM can call back into the page -------
	// Registered unconditionally so they remain available across /coach-on/off.
	// They report a clear error when the server isn't running.
	pi.registerTool({
		name: "browser_highlight",
		label: "Highlight element",
		description: "Briefly outline a CSS selector in the user's browser tab. Useful to visually confirm you're about to edit the right element.",
		parameters: Type.Object({
			selector: Type.String({ description: "CSS selector to highlight in the page" }),
			color: Type.Optional(Type.String({ description: "CSS color, default lime" })),
		}),
		async execute(_id, params: { selector: string; color?: string }) {
			if (!coachState.running) {
				return {
					content: [{ type: "text", text: "frontend-coach is off in this pi instance (run /coach-on to enable)." }],
					details: {},
					isError: true,
				};
			}
			broadcast({ kind: "highlight", selector: params.selector, color: params.color ?? "lime" });
			return {
				content: [{ type: "text", text: `Sent highlight for ${params.selector}` }],
				details: {},
			};
		},
	});

	pi.registerTool({
		name: "browser_inspect",
		label: "Inspect element",
		description: "Return outerHTML + computed styles + bounding rect for a CSS selector in the user's browser.",
		parameters: Type.Object({
			selector: Type.String({ description: "CSS selector to inspect" }),
		}),
		async execute(_id, params: { selector: string }) {
			const result = await request<any>("inspect", { selector: params.selector }, 5000);
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				details: result,
			};
		},
	});

	pi.registerTool({
		name: "browser_eval",
		label: "Evaluate JS in page",
		description: "Run a JavaScript expression in the user's browser tab and return the JSON-serializable result. Use sparingly.",
		parameters: Type.Object({
			expression: Type.String({ description: "A JavaScript expression to evaluate (e.g. 'document.title')" }),
		}),
		async execute(_id, params: { expression: string }) {
			const result = await request<any>("eval", { expression: params.expression }, 5000);
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				details: { result },
			};
		},
	});

	// ------- Commands -------
	pi.registerCommand("coach-bookmarklet", {
		description: "Print a bookmarklet you can drag to your bookmarks bar to inject the picker.",
		handler: async (_args, ctx) => {
			const bm = `javascript:(()=>{const s=document.createElement('script');s.src='http://localhost:${PORT}/picker.js?t='+Date.now();document.body.appendChild(s);})();`;
			ctx.ui.notify("Copy the bookmarklet from the terminal output", "info");
			console.log("\n--- frontend-coach bookmarklet ---");
			console.log(bm);
			console.log("--- end ---\n");
		},
	});

	pi.registerCommand("coach-status", {
		description: "Show frontend-coach state (running/off, port, connected browsers).",
		handler: async (_args, ctx) => {
			const lines = [
				`state    : ${coachState.running ? "running" : "off"}`,
				`port     : ${HOST}:${PORT}`,
				`browsers : ${clients.size}`,
				`label    : ${coachState.label}`,
			];
			ctx.ui.notify(lines.join("  ·  "), "info");
			console.log("\n--- frontend-coach status ---\n" + lines.join("\n") + "\n");
		},
	});

	pi.registerCommand("coach-off", {
		description: "Stop the frontend-coach server in this pi instance, releasing the port so another pi can take it.",
		handler: async (_args, ctx) => {
			if (!coachState.running) {
				ctx.ui.notify("frontend-coach is already off", "info");
				return;
			}
			stopServer("manual");
			ctx.ui.notify(`frontend-coach stopped (port ${PORT} released)`, "info");
		},
	});

	pi.registerCommand("coach-on", {
		description: "Start the frontend-coach server in this pi instance (binds port 7777 or $FRONTEND_COACH_PORT).",
		handler: async (_args, ctx) => {
			if (coachState.running) {
				ctx.ui.notify(`frontend-coach already running on ${HOST}:${PORT}`, "info");
				return;
			}
			const result = await startServer();
			if (result.ok) {
				ctx.ui.notify(`frontend-coach started on ${HOST}:${PORT}`, "info");
			} else {
				ctx.ui.notify(`frontend-coach failed to start: ${result.reason}`, "error");
			}
		},
	});

	// ------- Cleanup -------
	pi.on("session_shutdown", () => {
		stopServer("shutdown");
	});
}
