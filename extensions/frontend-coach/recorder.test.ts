/**
 * Prove browser_record_test snapshot+ref targeting and trace.zip on the real
 * recorder, attached over CDP. Chrome stands in for Edge on Linux.
 *
 * Run: npx tsx --test extensions/frontend-coach/recorder.test.ts
 */

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const CHROME = process.env.FRONTEND_COACH_EDGE_PATH ?? "/usr/bin/google-chrome";
const FFMPEG = process.env.FRONTEND_COACH_FFMPEG ?? "/usr/bin/ffmpeg";

const FIXTURE = `<!doctype html>
<meta charset="utf-8">
<title>frontend-coach fixture</title>
<button id="save">Save</button>
<pre id="out"></pre>
<script>
document.getElementById("save").onclick = () => {
  document.getElementById("out").textContent = "saved";
};
</script>
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

function waitForCdp(port: number, timeoutMs = 15_000): Promise<void> {
	const t0 = Date.now();
	return new Promise((resolve, reject) => {
		const tick = () => {
			fetch(`http://127.0.0.1:${port}/json/version`)
				.then((r) => {
					if (r.ok) resolve();
					else retry();
				})
				.catch(retry);
		};
		const retry = () => {
			if (Date.now() - t0 > timeoutMs) reject(new Error(`CDP port ${port} did not come up`));
			else setTimeout(tick, 150);
		};
		tick();
	});
}

let httpPort = 0;
let cdpPort = 0;
let httpServer: Server | undefined;
let chromeProc: ChildProcess | undefined;
let workDir = "";
let prevCwd = "";
let recordTest: typeof import("./recorder.ts").recordTest;
let ariaRefSelector: typeof import("./recorder.ts").ariaRefSelector;
let stepTarget: typeof import("./recorder.ts").stepTarget;

before(async () => {
	if (!existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}`);
	if (!existsSync(FFMPEG)) throw new Error(`ffmpeg not found at ${FFMPEG}`);

	httpPort = await freePort();
	cdpPort = await freePort();
	process.env.FRONTEND_COACH_CDP_PORT = String(cdpPort);
	process.env.FRONTEND_COACH_FFMPEG = FFMPEG;

	workDir = mkdtempSync(join(tmpdir(), "frontend-coach-"));
	prevCwd = process.cwd();
	process.chdir(workDir);

	httpServer = createServer((_req, res) => {
		res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
		res.end(FIXTURE);
	});
	await new Promise<void>((resolve) => httpServer!.listen(httpPort, "127.0.0.1", resolve));

	const profile = join(workDir, "chrome-profile");
	chromeProc = spawn(
		CHROME,
		[
			`--remote-debugging-port=${cdpPort}`,
			`--user-data-dir=${profile}`,
			"--headless=new",
			"--no-sandbox",
			"--disable-gpu",
			"--disable-dev-shm-usage",
			"--no-first-run",
			"--no-default-browser-check",
			"--disable-extensions",
			`http://127.0.0.1:${httpPort}/`,
		],
		{ stdio: "ignore" },
	);
	await waitForCdp(cdpPort);

	const rec = await import("./recorder.ts");
	recordTest = rec.recordTest;
	ariaRefSelector = rec.ariaRefSelector;
	stepTarget = rec.stepTarget;
});

after(async () => {
	if (chromeProc && chromeProc.pid) {
		try { chromeProc.kill("SIGKILL"); } catch { /* ignore */ }
		await new Promise((r) => setTimeout(r, 400));
	}
	try { httpServer?.close(); } catch { /* ignore */ }
	if (prevCwd) process.chdir(prevCwd);
	if (workDir) {
		try { rmSync(workDir, { recursive: true, force: true }); } catch { /* chrome may still hold the profile */ }
	}
});

test("stepTarget prefers Playwright aria-ref over CSS selector", () => {
	assert.equal(ariaRefSelector("e12"), "aria-ref=e12");
	assert.equal(ariaRefSelector("ref=e12"), "aria-ref=e12");
	assert.equal(ariaRefSelector("aria-ref=e12"), "aria-ref=e12");
	assert.equal(ariaRefSelector("f1e2"), "aria-ref=f1e2");
	assert.equal(stepTarget({ ref: "e12", selector: "#nope" }), "aria-ref=e12");
	assert.equal(stepTarget({ selector: "#save" }), "#save");
	assert.equal(stepTarget({}), undefined);
});

test("browser_record_test clicks via a11y snapshot ref and writes trace.zip beside webm", async () => {
	const url = `http://127.0.0.1:${httpPort}/`;
	const probe = await recordTest({
		name: "probe snapshot",
		url,
		steps: [{ action: "wait", ms: 50 }],
	});
	assert.ok(probe.report.snapshot, "recorder must return an a11y snapshot");
	assert.match(probe.report.snapshot ?? "", /\[ref=[a-z]*\d+[a-z0-9]*\]/i);
	const refMatch = probe.report.snapshot?.match(/button "Save" \[ref=([^\]]+)\]/);
	assert.ok(refMatch, `Save button ref missing from snapshot:\n${probe.report.snapshot}`);
	const ref = refMatch![1]!;

	const clicked = await recordTest({
		name: "click save via ref",
		steps: [{ action: "click", ref, selector: "#does-not-exist" }],
		assertions: [
			{ description: "clicked Save", expression: "document.getElementById('out')?.textContent === 'saved'" },
		],
	});
	assert.equal(clicked.report.passed, true, clicked.report.failure ?? JSON.stringify(clicked.report.steps, null, 2));
	assert.equal(clicked.report.steps[0]?.ref, ref);
	assert.ok(clicked.report.tracePath, "trace.zip path missing from report");
	assert.ok(existsSync(clicked.report.tracePath!), `missing ${clicked.report.tracePath}`);
	assert.ok(statSync(clicked.report.tracePath!).size > 0, "trace.zip is empty");
	assert.ok(clicked.report.tracePath!.endsWith(".trace.zip"));
	assert.ok(clicked.report.videoPath.endsWith(".webm"));
	assert.ok(existsSync(clicked.report.videoPath), "webm missing");
	assert.equal(join(clicked.report.videoPath.replace(/\.webm$/, ".trace.zip")), clicked.report.tracePath);
});

test("browser_record_test still accepts CSS selector fallback", async () => {
	const url = `http://127.0.0.1:${httpPort}/`;
	const clicked = await recordTest({
		name: "click save via css",
		url,
		steps: [{ action: "click", selector: "#save" }],
		assertions: [
			{ description: "clicked Save", expression: "document.getElementById('out')?.textContent === 'saved'" },
		],
	});
	assert.equal(clicked.report.passed, true, clicked.report.failure ?? JSON.stringify(clicked.report.steps, null, 2));
	const md = readFileSync(clicked.report.videoPath.replace(/\.webm$/, ".md"), "utf8");
	assert.match(md, /A11y snapshot/);
});
