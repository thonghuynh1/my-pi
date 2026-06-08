/**
 * frontend-coach
 *
 * Provides a tiny HTTP + WebSocket server on 127.0.0.1:7777.
 * The server is off by default; run /coach-on to bind the port.
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
import { spawn } from "node:child_process";
import { WebSocketServer, type WebSocket } from "ws";
import {
	DEFAULT_CDP_PORT,
	ensureBrowser,
	findEdgeBinary,
	isEdgeRunning,
	launchEdge,
	profileDir,
	stopEdge,
} from "./edge.ts";
import { recordTest, type RecordTestInput } from "./recorder.ts";
import { listRecords, loadRecord, pathsForId, recordsDir } from "./records.ts";

const HOST = "127.0.0.1";
const PORT = Number(process.env.FRONTEND_COACH_PORT ?? 7777);
const AUTO_START = /^(1|true|yes)$/i.test(process.env.FRONTEND_COACH_AUTO_START ?? "");

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

	// ------- Initial state -------
	// Keep the bridge off by default so ordinary pi sessions do not reserve a port.
	// Set FRONTEND_COACH_AUTO_START=1 if you want the old startup behavior.
	setStatus("off");
	if (AUTO_START) {
		const initial = await startServer();
		if (!initial.ok) {
			console.warn(
				`[frontend-coach] could not bind ${HOST}:${PORT} (${initial.reason}).\n` +
				`  This pi will run with frontend-coach disabled. Use /coach-on to retry,\n` +
				`  or set FRONTEND_COACH_PORT=7778 to bind a different port (also update\n` +
				`  Web/src/index.tsx bootstrap if you do).`,
			);
		}
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

	// ------- browser_record_test: autonomous, recorded UI test -------
	// The agent calls this AFTER finishing a frontend change. It drives the
	// already-open Edge tab via CDP (no permission prompts), captures a webm
	// of the interaction, and writes a structured report. Assertion failures
	// surface as isError=true so the agent can iterate on the fix.
	const StepSchema = Type.Object({
		action: Type.Union([
			Type.Literal("click"), Type.Literal("dblclick"),
			Type.Literal("type"), Type.Literal("fill"),
			Type.Literal("press"), Type.Literal("hover"),
			Type.Literal("wait"), Type.Literal("waitFor"),
			Type.Literal("navigate"), Type.Literal("scroll"),
			Type.Literal("eval"),
		], { description: "What to do at this step." }),
		selector: Type.Optional(Type.String({ description: "CSS selector (click/dblclick/type/fill/hover/waitFor/scroll/optional for press)." })),
		value: Type.Optional(Type.String({ description: "Text for type/fill." })),
		key: Type.Optional(Type.String({ description: "Key name for press (e.g. 'Enter', 'Tab', 'Control+S')." })),
		url: Type.Optional(Type.String({ description: "URL for navigate." })),
		ms: Type.Optional(Type.Number({ description: "Milliseconds for wait, or timeout override for waitFor." })),
		expression: Type.Optional(Type.String({ description: "JS expression for eval (no statements)." })),
	});
	const AssertionSchema = Type.Object({
		description: Type.String({ description: "Human-readable description, shown in the report." }),
		expression: Type.String({ description: "JS expression evaluated in the page; truthy = pass. Example: document.querySelector('#send[disabled]') !== null" }),
	});
	pi.registerTool({
		name: "browser_record_test",
		label: "Record browser test",
		description:
			"Run an autonomous UI test in the controlled Edge tab (no user prompts) and save a .webm screen recording " +
			"plus a structured report under ./.frontend-coach/records/. Use this after implementing a frontend change " +
			"to prove it works. If any step or assertion fails, the tool returns isError=true with a transcript — fix the " +
			"code and call it again. Requires /coach-launch-edge to have been run first.",
		parameters: Type.Object({
			name: Type.String({ description: "Short title for the recording (used in filename and report)." }),
			url: Type.Optional(Type.String({ description: "Navigate to this URL before recording. Omit to use the current tab." })),
			steps: Type.Array(StepSchema, { description: "Sequence of UI actions to perform while recording." }),
			assertions: Type.Optional(Type.Array(AssertionSchema, { description: "Post-step checks. Test passes only if all are truthy." })),
			fps: Type.Optional(Type.Number({ description: "Recording frame rate (1–30, default 10)." })),
			relatedChange: Type.Optional(Type.String({ description: "Short note describing the change this test verifies (file paths, intent). Saved in the report." })),
			stopOnStepFailure: Type.Optional(Type.Boolean({ description: "Stop running steps on the first failure (default true)." })),
			viewport: Type.Optional(Type.Object({
				width: Type.Number(),
				height: Type.Number(),
			}, { description: "Override viewport size for this test." })),
		}),
		async execute(_id, params: RecordTestInput) {
			try {
				const { report } = await recordTest(params);
				const lines: string[] = [];
				lines.push(`${report.passed ? "✅ PASSED" : "❌ FAILED"} — ${report.name}`);
				lines.push(`id    : ${report.id}`);
				lines.push(`video : ${report.videoPath} (${(report.video.sizeBytes / 1024).toFixed(1)} KiB)`);
				lines.push(`report: ${pathsForId(report.id).md}`);
				if (report.failure) lines.push(`fail  : ${report.failure}`);
				const failedSteps = report.steps.filter((s) => !s.ok);
				const failedAsserts = report.assertions.filter((a) => !a.ok);
				if (failedSteps.length) {
					lines.push("failed steps:");
					for (const s of failedSteps) lines.push(`  - ${s.action} ${s.selector ?? s.url ?? s.expression ?? ""} → ${s.error}`);
				}
				if (failedAsserts.length) {
					lines.push("failed assertions:");
					for (const a of failedAsserts) lines.push(`  - ${a.description}${a.error ? ` (${a.error})` : ""}`);
				}
				const recentErrors = report.console.filter((c) => c.type === "error" || c.type === "pageerror").slice(-5);
				if (recentErrors.length) {
					lines.push("console errors:");
					for (const c of recentErrors) lines.push(`  [${c.type}] ${c.text}`);
				}
				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: report,
					isError: !report.passed,
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `browser_record_test failed: ${(err as Error).message}` }],
					details: { error: String((err as Error).message ?? err) } as any,
					isError: true,
				};
			}
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
	// ------- Edge launch + recording commands -------
	pi.registerCommand("coach-launch-edge", {
		description: "Launch a controlled Microsoft Edge window with CDP enabled so the agent can drive + record tabs without permission prompts. Usage: /coach-launch-edge [url]",
		handler: async (args, ctx) => {
			const url = (args ?? "").trim() || process.env.FRONTEND_COACH_URL || undefined;
			ctx.ui.notify(`Launching Edge on CDP port ${DEFAULT_CDP_PORT}…`, "info");
			const r = await launchEdge({ url });
			if (!r.ok) {
				ctx.ui.notify(`Edge launch failed: ${r.reason}`, "error");
				return;
			}
			if (r.alreadyRunning) {
				ctx.ui.notify(`Edge already listening on :${r.port} — reusing it`, "info");
			} else {
				ctx.ui.notify(`Edge launched on :${r.port} (profile: ${profileDir()})`, "info");
				console.log(`[frontend-coach] Edge profile dir: ${profileDir()}`);
			}
		},
	});

	pi.registerCommand("coach-edge-status", {
		description: "Show whether the controlled Edge instance is reachable.",
		handler: async (_args, ctx) => {
			const bin = findEdgeBinary();
			let alive = false;
			try {
				const r = await fetch(`http://127.0.0.1:${DEFAULT_CDP_PORT}/json/version`);
				alive = r.ok;
			} catch {}
			const lines = [
				`binary       : ${bin ?? "(not found)"}`,
				`cdp port     : ${DEFAULT_CDP_PORT}`,
				`cdp reachable: ${alive ? "yes" : "no"}`,
				`spawned here : ${isEdgeRunning() ? "yes" : "no"}`,
				`profile      : ${profileDir()}`,
			];
			ctx.ui.notify(lines.join("  ·  "), "info");
			console.log("\n--- coach-edge-status ---\n" + lines.join("\n") + "\n");
		},
	});

	pi.registerCommand("coach-stop-edge", {
		description: "Kill the controlled Edge window spawned by /coach-launch-edge (does not touch your normal Edge).",
		handler: async (_args, ctx) => {
			if (!isEdgeRunning()) {
				ctx.ui.notify("No Edge instance was spawned by this pi (nothing to kill).", "info");
				return;
			}
			stopEdge();
			ctx.ui.notify("Controlled Edge instance terminated.", "info");
		},
	});

	pi.registerCommand("coach-records", {
		description: "List the latest browser_record_test recordings (pass/fail, video paths).",
		handler: async (_args, ctx) => {
			const rs = listRecords(30);
			if (rs.length === 0) {
				ctx.ui.notify(`No records yet. Folder: ${recordsDir()}`, "info");
				return;
			}
			const lines = rs.map((r) =>
				`${r.passed ? "✅" : "❌"} ${r.recordedAt}  ${r.id}  (${(r.durationMs / 1000).toFixed(1)}s)\n     ${r.videoPath}`,
			);
			ctx.ui.notify(`${rs.length} record(s) in ${recordsDir()}`, "info");
			console.log("\n--- frontend-coach records ---\n" + lines.join("\n") + "\n");
		},
	});

	pi.registerCommand("coach-record", {
		description: "Print the markdown report for a recording. Usage: /coach-record <id>",
		handler: async (args, ctx) => {
			const id = (args ?? "").trim();
			if (!id) {
				ctx.ui.notify("Usage: /coach-record <id>  (see /coach-records for ids)", "error");
				return;
			}
			const r = loadRecord(id);
			if (!r) {
				ctx.ui.notify(`No record found for id ${id}`, "error");
				return;
			}
			const md = readFileSync(pathsForId(id).md, "utf8");
			ctx.ui.notify(`Printed report for ${id}`, "info");
			console.log("\n" + md + "\n");
			console.log(`Open the video:  ${pathsForId(id).video}\n`);
		},
	});

	pi.registerCommand("coach-records-open", {
		description: "Open the ./.frontend-coach/records/ folder in your OS file explorer.",
		handler: async (_args, ctx) => {
			const dir = recordsDir();
			try {
				if (process.platform === "win32") spawn("explorer", [dir], { detached: true, stdio: "ignore" }).unref();
				else if (process.platform === "darwin") spawn("open", [dir], { detached: true, stdio: "ignore" }).unref();
				else spawn("xdg-open", [dir], { detached: true, stdio: "ignore" }).unref();
				ctx.ui.notify(`Opened ${dir}`, "info");
			} catch (err) {
				ctx.ui.notify(`Failed to open folder: ${(err as Error).message}`, "error");
			}
		},
	});

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
		// Leave the Edge window alone on session_shutdown — it survives /new
		// and /resume so the agent keeps the same logged-in tab across sessions.
		// Use /coach-stop-edge to kill it explicitly.
	});
}
