/**
 * After recordTest on headed /coach-launch-edge, Alt+P must arm PICKING.
 * Proves picker.js survives addInitScript at document_start (goto after install).
 *
 * Run: npx tsx --test extensions/frontend-coach/picker-after-record.test.ts
 */

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Page } from "playwright-core";

const EDGE = process.env.FRONTEND_COACH_EDGE_PATH ?? "/usr/bin/microsoft-edge";
const FFMPEG = process.env.FRONTEND_COACH_FFMPEG ?? "/usr/bin/ffmpeg";

const FIXTURE = `<!doctype html>
<meta charset="utf-8">
<title>picker after record</title>
<button id="save">Save</button>
`;

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address();
			const port = typeof addr === "object" && addr ? addr.port : 0;
			server.close((err) => (err ? reject(err) : resolve(port)));
		});
		server.on("error", reject);
	});
}

async function windowKeydownCount(page: Page): Promise<number> {
	const session = await page.context().newCDPSession(page);
	try {
		const { result } = await session.send("Runtime.evaluate", { expression: "window" });
		if (!result.objectId) return 0;
		const { listeners } = await session.send("DOMDebugger.getEventListeners", { objectId: result.objectId });
		return listeners.filter((l: { type: string }) => l.type === "keydown").length;
	} finally {
		try { await session.detach(); } catch { /* ignore */ }
	}
}

let httpPort = 0;
let cdpPort = 0;
let httpServer: Server | undefined;
let workDir = "";
let prevCwd = "";
let recordTest: typeof import("./recorder.ts").recordTest;
let launchEdge: typeof import("./edge.ts").launchEdge;
let stopEdge: typeof import("./edge.ts").stopEdge;
let ensureBrowser: typeof import("./edge.ts").ensureBrowser;
let findAppPage: typeof import("./edge.ts").findAppPage;

before(async () => {
	if (!existsSync(EDGE)) throw new Error(`Edge not found at ${EDGE}`);
	if (!existsSync(FFMPEG)) throw new Error(`ffmpeg not found at ${FFMPEG}`);

	httpPort = await freePort();
	cdpPort = await freePort();
	process.env.FRONTEND_COACH_EDGE_PATH = EDGE;
	process.env.FRONTEND_COACH_CDP_PORT = String(cdpPort);
	process.env.FRONTEND_COACH_FFMPEG = FFMPEG;

	workDir = mkdtempSync(join(tmpdir(), "frontend-coach-picker-"));
	prevCwd = process.cwd();
	process.chdir(workDir);

	httpServer = createServer((_req, res) => {
		res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
		res.end(FIXTURE);
	});
	await new Promise<void>((resolve) => httpServer!.listen(httpPort, "127.0.0.1", resolve));

	const edge = await import("./edge.ts");
	const rec = await import("./recorder.ts");
	launchEdge = edge.launchEdge;
	stopEdge = edge.stopEdge;
	ensureBrowser = edge.ensureBrowser;
	findAppPage = edge.findAppPage;
	recordTest = rec.recordTest;

	const launched = await launchEdge({ url: `http://127.0.0.1:${httpPort}/`, port: cdpPort });
	if (!launched.ok) throw new Error(`launchEdge failed: ${launched.reason}`);
});

after(async () => {
	try { stopEdge?.(); } catch { /* ignore */ }
	try { httpServer?.close(); } catch { /* ignore */ }
	if (prevCwd) process.chdir(prevCwd);
	if (workDir) {
		try { rmSync(workDir, { recursive: true, force: true }); } catch { /* edge may still hold the profile */ }
	}
});

test("Alt+P arms PICKING after headed recordTest", async () => {
	const url = `http://127.0.0.1:${httpPort}/`;
	const { report } = await recordTest({
		name: "picker after headed record",
		url,
		steps: [{ action: "wait", ms: 80 }],
	});
	assert.equal(report.passed, true, report.failure ?? "recordTest failed");

	const browser = await ensureBrowser(cdpPort);
	const page = findAppPage(browser);
	assert.ok(page, "no app page after recordTest");

	const flags = await page!.evaluate(() => ({
		piCoach: window.__piCoach === true,
		hasBanner: !!window.__piCoachBanner,
		hasCleanup: typeof window.__piCoachCleanup === "function",
		bannerText: window.__piCoachBanner ? String(window.__piCoachBanner.textContent || "") : "",
	}));
	assert.equal(flags.piCoach, true, "window.__piCoach should stay true");
	assert.equal(flags.hasCleanup, true, "cleanup must be installed (init script finished)");
	assert.equal(flags.hasBanner, true, "banner node missing after recordTest");

	const keydowns = await windowKeydownCount(page!);
	assert.ok(keydowns >= 1, `expected a window keydown listener, got ${keydowns}`);

	const armed = await page!.evaluate(() => {
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", altKey: true, bubbles: true }));
		const text = window.__piCoachBanner ? String(window.__piCoachBanner.textContent || "") : "";
		return { text, picking: /PICKING/.test(text) };
	});
	assert.equal(armed.picking, true, `Alt+P did not arm PICKING: ${JSON.stringify(armed)}`);
});
