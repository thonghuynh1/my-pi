import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { WebSocket } from "ws";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "accordion-adoption-"));
process.env.ACCORDION_HOME = home;
process.env.ACCORDION_APP_PATH = path.join(home, "missing-accordion-app.exe");

const registryRoot = path.join(home, ".accordion");
const sessionsDir = path.join(registryRoot, "sessions");
const sessionPath = () => {
	const files = fs.existsSync(sessionsDir)
		? fs.readdirSync(sessionsDir).filter((name) => name.endsWith(".json"))
		: [];
	return files.length === 1 ? path.join(sessionsDir, files[0]) : null;
};
const brokerPath = path.join(registryRoot, "browser-broker.json");
const focusPath = path.join(registryRoot, "focus.json");
const appIndexPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "app", "build", "index.html");

const handlers = new Map();
const flags = new Map();
const notifications = [];
let accordionCommand;
let proxySocket;
let brokerPid;
let brokerPort;
let sessionId;
let sessionFile;
let shutdownCalled = false;

function readJson(filePath) {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch {
		return null;
	}
}

async function waitFor(predicate, timeoutMs, label) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const value = await predicate();
		if (value) return value;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error(`timed out waiting for ${label}`);
}

function request(port, requestPath) {
	return new Promise((resolve, reject) => {
		const req = http.get({ host: "127.0.0.1", port, path: requestPath }, (res) => {
			let body = "";
			res.setEncoding("utf8");
			res.on("data", (chunk) => { body += chunk; });
			res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
		});
		req.on("error", reject);
	});
}

function connectAndReceive(url, predicate) {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(url);
		const timer = setTimeout(() => {
			socket.terminate();
			reject(new Error(`timed out waiting for WebSocket frame from ${url}`));
		}, 5000);
		const finish = (error, value) => {
			clearTimeout(timer);
			if (error) reject(error);
			else resolve(value);
		};
		socket.on("message", (data) => {
			let message;
			try {
				message = JSON.parse(data.toString());
			} catch {
				return;
			}
			if (predicate(message)) finish(null, { socket, message });
		});
		socket.once("error", (error) => finish(error));
	});
}

async function closeSocket(socket) {
	if (!socket || socket.readyState === WebSocket.CLOSED) return;
	await new Promise((resolve) => {
		let settled = false;
		const settle = () => {
			if (settled) return;
			settled = true;
			resolve();
		};
		const timer = setTimeout(() => {
			try { socket.terminate(); } catch {}
			settle();
		}, 1000);
		socket.once("close", () => {
			clearTimeout(timer);
			settle();
		});
		try { socket.close(); } catch { settle(); }
	});
}

function processAlive(pid) {
	if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error?.code === "EPERM";
	}
}

async function terminateProcess(pid) {
	if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return;
	try { process.kill(pid, "SIGTERM"); } catch {}
	try {
		await waitFor(() => !processAlive(pid), 2000, `broker process ${pid} to stop`);
		return;
	} catch {
		if (process.platform === "win32") {
			try { execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
		} else {
			try { process.kill(pid, "SIGKILL"); } catch {}
		}
		await waitFor(() => !processAlive(pid), 2000, `broker process ${pid} to terminate`);
	}
}

const ctx = {
	ui: {
		setStatus() {},
		notify(message, type) { notifications.push({ message, type }); },
		theme: { fg: (_color, text) => text },
	},
	model: { id: "adoption-smoke/model", contextWindow: 4096 },
	getContextUsage: () => ({ tokens: 0, contextWindow: 4096 }),
	getSystemPrompt: () => "adoption smoke system prompt",
};

let failure;
try {
	const jiti = createJiti(import.meta.url);
	const mod = await jiti.import("../index.ts");
	if (typeof mod.default !== "function") throw new Error("stable Accordion index did not export a factory");
	mod.default({
		on(name, handler) { handlers.set(name, handler); },
		registerFlag(name, definition) { flags.set(name, definition?.default); },
		getFlag(name) { return flags.get(name); },
		registerCommand(name, definition) {
			if (name === "accordion") accordionCommand = definition.handler;
		},
		registerTool() {},
		appendEntry() {},
	});
	if (!accordionCommand) throw new Error("/accordion command was not registered through index.ts");

	await Promise.resolve(handlers.get("session_start")?.({}, ctx));
	sessionFile = await waitFor(() => sessionPath(), 5000, "per-session registry entry");
	const entry = readJson(sessionFile);
	if (!entry?.sessionId || !(entry.port > 0)) throw new Error("session registry entry is incomplete");
	sessionId = entry.sessionId;
	if (fs.existsSync(brokerPath)) throw new Error("adoption smoke started with a broker registry already present");

	await accordionCommand("", ctx);
	const note = notifications.at(-1)?.message ?? "";
	if (!note.includes("Started broker dashboard")) throw new Error("/accordion did not report a newly started broker");
	const directUrl = note.match(/Direct session browser: http:\/\/127\.0\.0\.1:\d+\/\?token=([0-9a-f]+)/)?.[0];
	if (!directUrl) throw new Error("/accordion notification did not include a token-bearing direct URL");

	const brokerEntry = await waitFor(() => readJson(brokerPath), 3000, "broker registry file");
	brokerPid = brokerEntry.pid;
	brokerPort = brokerEntry.port;
	if (!(brokerPort > 0) || !processAlive(brokerPid) || brokerPid === process.pid) {
		throw new Error("broker registry did not identify a live detached broker process");
	}

	const watched = await waitFor(async () => {
		const response = await request(brokerPort, "/__accordion/sessions");
		if (response.status !== 200) return null;
		const sessions = JSON.parse(response.body);
		return Array.isArray(sessions) ? sessions.find((item) => item.sessionId === sessionId) : null;
	}, 5000, "watched session from broker");
	if (watched.port !== entry.port) throw new Error("broker session listing pointed at the wrong runtime port");

	const metaResponse = await request(brokerPort, "/__accordion/broker-meta");
	const meta = JSON.parse(metaResponse.body);
	if (metaResponse.status !== 200 || meta.mode !== "broker" || meta.protocolVersion !== 5) {
		throw new Error(`broker metadata was not the current broker contract: ${metaResponse.body}`);
	}

	if (!fs.existsSync(appIndexPath)) throw new Error(`built dashboard missing at ${appIndexPath}`);
	const staticResponse = await request(brokerPort, "/");
	if (staticResponse.status !== 200 || !String(staticResponse.headers["content-type"] ?? "").includes("text/html") || !staticResponse.body.includes("<html")) {
		throw new Error(`broker did not serve the built dashboard: ${staticResponse.status}`);
	}

	const proxy = await connectAndReceive(`ws://127.0.0.1:${brokerPort}/ws/session/${encodeURIComponent(sessionId)}`, (message) => message.type === "hello");
	proxySocket = proxy.socket;
	if (proxy.message.sessionId !== sessionId || proxy.message.protocolVersion !== 5) {
		throw new Error("broker proxy did not relay the current session hello frame");
	}
} catch (error) {
	failure = error;
} finally {
	try { await closeSocket(proxySocket); } catch (error) { failure ??= error; }
	try {
		if (handlers.has("session_shutdown")) {
			await Promise.resolve(handlers.get("session_shutdown")());
			shutdownCalled = true;
		}
	} catch (error) {
		failure ??= error;
	}
	try {
		if (sessionFile) await waitFor(() => !fs.existsSync(sessionFile), 3000, "session registry cleanup");
	} catch (error) {
		failure ??= error;
	}
	if (!brokerPid) {
		try {
			const lateBrokerEntry = await waitFor(() => readJson(brokerPath), 1000, "broker registry cleanup");
			brokerPid = lateBrokerEntry?.pid;
		} catch {}
	}
	try { await terminateProcess(brokerPid); } catch (error) { failure ??= error; }
	if (!shutdownCalled) failure ??= new Error("session_shutdown handler was not registered or called");
	try { fs.rmSync(home, { recursive: true, force: true }); } catch (error) { failure ??= error; }
	if (fs.existsSync(home)) failure ??= new Error("temporary Accordion home survived cleanup");
}

if (failure) {
	console.error(`ADOPTION SMOKE FAIL — ${failure instanceof Error ? failure.message : String(failure)}`);
	process.exitCode = 1;
} else {
	console.log("ADOPTION SMOKE PASS — index-entry ✓ broker-start ✓ watched-session ✓ broker-meta ✓ broker-static ✓ broker-proxy ✓ direct-url ✓ cleanup ✓");
}
