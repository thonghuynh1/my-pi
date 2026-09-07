/**
 * Peek tools: a11y snapshot + short act list without ffmpeg/webm.
 * Browser tests use playwright-core + local Chrome (not /coach-launch-edge).
 *
 * Run: npx tsx --test extensions/frontend-coach/peek.test.ts
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium, type Browser, type Page } from "playwright-core";
import {
	MAX_PEEK_STEPS,
	assertPeekStepBudget,
	peekAct,
	peekSnapshot,
	renderPeekActText,
	renderPeekSnapshotText,
} from "./peek.ts";
import type { Step } from "./recorder.ts";

const CHROME = process.env.FRONTEND_COACH_EDGE_PATH ?? "/usr/bin/google-chrome";

const FIXTURE = `<!doctype html>
<meta charset="utf-8">
<title>frontend-coach peek fixture</title>
<button id="save">Save</button>
<pre id="out"></pre>
<script>
document.getElementById("save").onclick = () => {
  document.getElementById("out").textContent = "saved";
};
</script>
`;

/** Same Radix-like overlay fixture as recorder.test.ts create-dialog. */
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

function waitSteps(n: number): Step[] {
	return Array.from({ length: n }, () => ({ action: "wait" as const, ms: 0 }));
}

test("assertPeekStepBudget allows up to MAX_PEEK_STEPS", () => {
	assert.doesNotThrow(() => assertPeekStepBudget([]));
	assert.doesNotThrow(() => assertPeekStepBudget(waitSteps(MAX_PEEK_STEPS)));
	assert.throws(
		() => assertPeekStepBudget(waitSteps(MAX_PEEK_STEPS + 1)),
		/at most 12 steps/,
	);
});

test("peekAct enforces budget before touching the page", async () => {
	await assert.rejects(
		() => peekAct({} as Page, { steps: waitSteps(MAX_PEEK_STEPS + 1) }),
		/at most 12 steps/,
	);
});

test("renderPeek text tells agents to omit url and skip video", () => {
	const snap = renderPeekSnapshotText({
		url: "http://localhost/app",
		snapshot: "- button \"Save\" [ref=e12]",
		ok: true,
	});
	assert.match(snap, /omit url/);
	assert.match(snap, /No video/);
	assert.match(snap, /browser_record_test/);
	assert.match(snap, /\[ref=e12\]/);

	const act = renderPeekActText({
		url: "http://localhost/app",
		snapshot: "- button \"Save\" [ref=e12]",
		steps: [{ action: "click", ref: "e12", ok: true, atMs: 0, durationMs: 1 }],
		passed: true,
	});
	assert.match(act, /peek act ok/);
	assert.match(act, /omit url/);
	assert.match(act, /No video/);
});

const hasChrome = existsSync(CHROME);
let browser: Browser | undefined;
let page: Page | undefined;
let workDir = "";
let prevCwd = "";

before(async () => {
	if (!hasChrome) return;
	workDir = mkdtempSync(join(tmpdir(), "frontend-coach-peek-"));
	prevCwd = process.cwd();
	process.chdir(workDir);
	browser = await chromium.launch({
		executablePath: CHROME,
		args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--headless=new"],
	});
	page = await browser.newPage();
});

after(async () => {
	try { await browser?.close(); } catch { /* ignore */ }
	if (prevCwd) process.chdir(prevCwd);
	if (workDir) {
		try { rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
	}
});

function recordsWebms(): string[] {
	const dir = join(workDir, ".frontend-coach", "records");
	if (!existsSync(dir)) return [];
	return readdirSync(dir).filter((f) => f.endsWith(".webm"));
}

test("peek snapshot selector scopes to a subtree", { skip: !hasChrome }, async () => {
	await page!.setContent(FIXTURE);
	const outcome = await peekSnapshot(page!, { selector: "#save" });
	assert.equal(outcome.ok, true, outcome.error);
	assert.match(outcome.snapshot, /button "Save"/);
	assert.match(outcome.snapshot, /\[ref=/i);
});

test("peek snapshot returns a11y refs without writing webm", { skip: !hasChrome }, async () => {
	await page!.setContent(FIXTURE);
	const outcome = await peekSnapshot(page!);
	assert.equal(outcome.ok, true, outcome.error);
	assert.match(outcome.snapshot, /\[ref=[a-z]*\d+[a-z0-9]*\]/i);
	assert.match(outcome.snapshot, /button "Save"/);
	assert.deepEqual(recordsWebms(), []);
});

test("peek act clicks via ref, returns a new snapshot, writes no video", { skip: !hasChrome }, async () => {
	await page!.setContent(FIXTURE);
	const before = await peekSnapshot(page!);
	const refMatch = before.snapshot.match(/button "Save" \[ref=([^\]]+)\]/);
	assert.ok(refMatch, `Save button ref missing:\n${before.snapshot}`);
	const ref = refMatch![1]!;

	const clicked = await peekAct(page!, {
		steps: [{ action: "click", ref, selector: "#does-not-exist" }],
	});
	assert.equal(clicked.passed, true, clicked.failure ?? JSON.stringify(clicked.steps, null, 2));
	assert.equal(clicked.steps[0]?.ref, ref);
	assert.ok(clicked.snapshot);
	assert.equal(await page!.locator("#out").textContent(), "saved");
	assert.deepEqual(recordsWebms(), []);
	assert.match(renderPeekActText(clicked), /No video/);
});

test("peek act snapshotAfterEach returns one snapshot per step", { skip: !hasChrome }, async () => {
	await page!.setContent(FIXTURE);
	const run = await peekAct(page!, {
		steps: [
			{ action: "click", selector: "#save" },
			{ action: "wait", ms: 20 },
		],
		snapshotAfterEach: true,
	});
	assert.equal(run.passed, true, run.failure);
	assert.equal(run.snapshots?.length, 2);
	assert.match(run.snapshots![0]!, /\[ref=/i);
	assert.deepEqual(recordsWebms(), []);
});

test("peek act fill+setInputFiles through create-dialog overlay without video", { skip: !hasChrome }, async () => {
	await page!.setContent(DIALOG_FIXTURE);
	const run = await peekAct(page!, {
		steps: [
			{ action: "click", selector: "#new" },
			{ action: "waitFor", selector: "[role=dialog]", ms: 4000 },
			{ action: "fill", selector: "#title", value: "Coach create" },
			{ action: "setInputFiles", selector: "#file", fileName: "note.txt", fileContent: "hello coach", mimeType: "text/plain" },
			{ action: "click", selector: "#submit" },
			{ action: "wait", ms: 100 },
		],
	});
	assert.equal(run.passed, true, run.failure ?? JSON.stringify(run.steps, null, 2));
	assert.equal(await page!.locator("[data-activity]").count(), 2);
	assert.match(await page!.locator("#activities").textContent() ?? "", /Coach create \(note\.txt\)/);
	assert.match(run.snapshot, /\[ref=/i);
	assert.deepEqual(recordsWebms(), []);
});
