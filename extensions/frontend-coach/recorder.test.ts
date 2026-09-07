/**
 * Prove browser_record_test snapshot+ref targeting and trace.zip on the real
 * recorder, attached over CDP. Chrome stands in for Edge on Linux.
 *
 * Run: npx tsx --test extensions/frontend-coach/recorder.test.ts
 */

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
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

/** Radix-like portal: overlay sits above the dialog and intercepts pointer events. */
const DIALOG_FIXTURE = `<!doctype html>
<meta charset="utf-8">
<title>create-with-document fixture</title>
<style>
  [data-radix-dialog-overlay] {
    position: fixed; inset: 0; background: rgba(0,0,0,.4);
    z-index: 100; pointer-events: auto;
  }
  [role="dialog"] {
    position: fixed; left: 50%; top: 40%; transform: translate(-50%,-50%);
    z-index: 50; background: #fff; padding: 24px; min-width: 280px;
  }
  input[type="file"] { position: absolute; width: 1px; height: 1px; opacity: 0; overflow: hidden; }
</style>
<main>
  <h1>Activities</h1>
  <ul id="activities"><li data-activity>Existing activity</li></ul>
  <p>Count: <span id="count">1</span></p>
  <button id="new" type="button">New activity</button>
</main>
<div id="portal" hidden>
  <div data-radix-dialog-overlay></div>
  <div role="dialog" aria-modal="true">
    <h2>Create activity</h2>
    <form id="form">
      <label>Title <input id="title" name="title" required></label>
      <label>Attach <input id="file" name="file" type="file"></label>
      <button id="submit" type="submit" disabled>Create</button>
    </form>
  </div>
</div>
<script>
(function () {
  const state = { title: "", file: null };
  const title = document.getElementById("title");
  const file = document.getElementById("file");
  const submit = document.getElementById("submit");
  const portal = document.getElementById("portal");
  function sync() {
    submit.disabled = !(state.title.trim() && state.file);
  }
  // Playwright fill uses CDP insertText (trusted InputEvent). Native
  // HTMLInputElement.prototype.value.set + new Event("input") is untrusted
  // and not an InputEvent — RHF does not commit that, so submit stays disabled.
  title.addEventListener("input", (e) => {
    if (!e.isTrusted && !(e instanceof InputEvent)) return;
    state.title = title.value;
    sync();
  });
  file.addEventListener("change", () => {
    state.file = file.files && file.files[0] ? file.files[0] : null;
    sync();
  });
  document.getElementById("new").onclick = () => { portal.hidden = false; };
  document.getElementById("form").onsubmit = (e) => {
    e.preventDefault();
    if (submit.disabled) return;
    const li = document.createElement("li");
    li.setAttribute("data-activity", "");
    li.textContent = state.title + " (" + state.file.name + ")";
    document.getElementById("activities").appendChild(li);
    document.getElementById("count").textContent = String(document.querySelectorAll("[data-activity]").length);
    portal.hidden = true;
  };
})();
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
let coachSnapshot: typeof import("./peek.ts").coachSnapshot;
let coachAct: typeof import("./peek.ts").coachAct;

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

	httpServer = createServer((req, res) => {
		const path = (req.url ?? "/").split("?")[0];
		const html = path === "/create-dialog" ? DIALOG_FIXTURE : FIXTURE;
		res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
		res.end(html);
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
	const peek = await import("./peek.ts");
	coachSnapshot = peek.coachSnapshot;
	coachAct = peek.coachAct;
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

test("peek then browser_record_test: refs stay valid, peek writes no webm", async () => {
	const url = `http://127.0.0.1:${httpPort}/`;
	const recordsDir = join(workDir, ".frontend-coach", "records");
	const webms = () => existsSync(recordsDir)
		? readdirSync(recordsDir).filter((f) => f.endsWith(".webm"))
		: [];
	const beforePeek = webms();

	const nav = await coachAct({ steps: [{ action: "navigate", url }] });
	assert.equal(nav.passed, true, nav.failure);
	const snap = await coachSnapshot();
	assert.equal(snap.ok, true, snap.error);
	const refMatch = snap.snapshot.match(/button "Save" \[ref=([^\]]+)\]/);
	assert.ok(refMatch, `Save button ref missing from peek snapshot:\n${snap.snapshot}`);
	const ref = refMatch![1]!;

	const clicked = await coachAct({ steps: [{ action: "click", ref }] });
	assert.equal(clicked.passed, true, clicked.failure ?? JSON.stringify(clicked.steps, null, 2));
	assert.deepEqual(webms(), beforePeek, "peek must not write a webm");

	const recorded = await recordTest({
		name: "record after peek via ref",
		steps: [{ action: "click", ref, selector: "#does-not-exist" }],
		assertions: [
			{ description: "still saved after peek+record", expression: "document.getElementById('out')?.textContent === 'saved'" },
		],
	});
	assert.equal(recorded.report.passed, true, recorded.report.failure ?? JSON.stringify(recorded.report.steps, null, 2));
	assert.ok(recorded.report.videoPath.endsWith(".webm"));
	assert.ok(existsSync(recorded.report.videoPath), "browser_record_test must still write webm");
	assert.ok(recorded.report.tracePath && existsSync(recorded.report.tracePath));
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

test("create-with-document: fill+setInputFiles through Radix overlay completes create", async () => {
	const url = `http://127.0.0.1:${httpPort}/create-dialog`;
	const nativeSetter =
		"(() => { const el = document.querySelector('#title'); " +
		"Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, 'from-eval'); " +
		"el.dispatchEvent(new Event('input', { bubbles: true })); " +
		"return { value: el.value, disabled: document.querySelector('#submit').disabled }; })()";

	const run = await recordTest({
		name: "create with document through radix dialog",
		url,
		steps: [
			{ action: "click", selector: "#new" },
			{ action: "waitFor", selector: "[role=dialog]", ms: 4000 },
			{ action: "eval", expression: nativeSetter },
		],
		assertions: [
			{ description: "native prototype setter does not enable submit", expression: "document.querySelector('#submit')?.disabled === true" },
			{ description: "one activity still listed", expression: "document.querySelectorAll('[data-activity]').length === 1" },
		],
	});
	assert.equal(run.report.passed, true, run.report.failure ?? JSON.stringify(run.report, null, 2));

	const created = await recordTest({
		name: "create with document playwright fill",
		steps: [
			{ action: "fill", selector: "#title", value: "Coach create" },
			{ action: "setInputFiles", selector: "#file", fileName: "note.txt", fileContent: "hello coach", mimeType: "text/plain" },
			{ action: "click", selector: "#submit" },
			{ action: "wait", ms: 200 },
		],
		assertions: [
			{ description: "new activity appears", expression: "document.querySelectorAll('[data-activity]').length === 2" },
			{ description: "created row has title and filename", expression: "/Coach create \\(note\\.txt\\)/.test(document.getElementById('activities')?.textContent ?? '')" },
			{ description: "count badge is 2", expression: "document.getElementById('count')?.textContent === '2'" },
		],
	});
	assert.equal(
		created.report.passed,
		true,
		created.report.failure ?? JSON.stringify({ steps: created.report.steps, assertions: created.report.assertions }, null, 2),
	);
	assert.equal(created.report.steps.some((s) => s.action === "setInputFiles" && s.ok), true);
	assert.equal(created.report.steps.some((s) => s.action === "eval"), false);
});
