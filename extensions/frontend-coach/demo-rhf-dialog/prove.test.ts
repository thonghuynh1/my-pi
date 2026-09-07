/**
 * Prove the Vite RHF+Radix demo: native prototype setters leave Create
 * disabled; peek-style Playwright fill + setInputFiles creates the row.
 *
 * Chromium only (same as peek.test.ts). No live Pi Edge.
 *
 * Run from this folder: npm test
 * Or from frontend-coach: npm test
 */

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { chromium, type Browser, type Page } from "playwright-core";
import { peekAct, peekSnapshot } from "../peek.ts";

const CHROME = process.env.FRONTEND_COACH_EDGE_PATH ?? "/usr/bin/google-chrome";
const DEMO_ROOT = dirname(fileURLToPath(import.meta.url));
const VITE_BIN = join(DEMO_ROOT, "node_modules", ".bin", "vite");

const NATIVE_SETTER =
	"(() => { const el = document.querySelector('#title'); " +
	"const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); " +
	"proto.set.call(el, 'from-eval'); " +
	"el.dispatchEvent(new Event('input', { bubbles: true })); " +
	"el.dispatchEvent(new Event('change', { bubbles: true })); " +
	"return { value: proto.get.call(el), disabled: document.querySelector('#submit').disabled }; })()";

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

function waitForHttp(url: string, timeoutMs = 20_000): Promise<void> {
	const t0 = Date.now();
	return new Promise((resolve, reject) => {
		const tick = () => {
			fetch(url)
				.then((r) => {
					if (r.ok) resolve();
					else retry();
				})
				.catch(retry);
		};
		const retry = () => {
			if (Date.now() - t0 > timeoutMs) reject(new Error(`demo did not come up at ${url}`));
			else setTimeout(tick, 150);
		};
		tick();
	});
}

const hasChrome = existsSync(CHROME);
const hasVite = existsSync(VITE_BIN);
const skip = !hasChrome || !hasVite;

let browser: Browser | undefined;
let page: Page | undefined;
let viteProc: ChildProcess | undefined;
let demoUrl = "";

before(async () => {
	if (!hasVite) {
		throw new Error(`Demo deps missing. Run: npm install (in ${DEMO_ROOT})`);
	}
	if (!hasChrome) return;

	const port = await freePort();
	viteProc = spawn(VITE_BIN, ["--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
		cwd: DEMO_ROOT,
		stdio: "pipe",
		env: { ...process.env, BROWSER: "none" },
	});
	demoUrl = `http://127.0.0.1:${port}/`;
	await waitForHttp(demoUrl);

	browser = await chromium.launch({
		executablePath: CHROME,
		args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--headless=new"],
	});
	page = await browser.newPage();
});

after(async () => {
	try { await browser?.close(); } catch { /* ignore */ }
	if (viteProc?.pid) {
		viteProc.kill("SIGTERM");
		await new Promise((r) => setTimeout(r, 300));
		try { viteProc.kill("SIGKILL"); } catch { /* ignore */ }
	}
});

test("native prototype value setter fills the DOM but does not enable submit", { skip }, async () => {
	await page!.goto(demoUrl, { waitUntil: "networkidle" });
	assert.equal(await page!.locator("[data-activity]").count(), 1);

	const opened = await peekAct(page!, {
		steps: [
			{ action: "click", selector: "#new" },
			{ action: "waitFor", selector: "[role=dialog]", ms: 4000 },
		],
	});
	assert.equal(opened.passed, true, opened.failure);

	const evalResult = await page!.evaluate(NATIVE_SETTER) as { value: string; disabled: boolean };
	assert.equal(evalResult.value, "from-eval", "DOM title should show the eval value");
	assert.equal(evalResult.disabled, true, "RHF must ignore the native setter");

	await peekAct(page!, {
		steps: [
			{
				action: "setInputFiles",
				selector: "#file",
				fileName: "note.txt",
				fileContent: "hello coach",
				mimeType: "text/plain",
			},
		],
	});
	assert.equal(
		await page!.locator("#submit").isDisabled(),
		true,
		"file attach must not enable submit while title was only set via eval",
	);
	assert.equal(await page!.locator("[data-activity]").count(), 1);
});

test("Broken: native setter button paints title but leaves Create disabled", { skip }, async () => {
	await page!.goto(demoUrl, { waitUntil: "networkidle" });
	await page!.locator("#broken-native-setter").click();
	await page!.locator("[role=dialog] #title").waitFor();
	await page!.waitForFunction(() => {
		const el = document.querySelector("#title");
		const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
		return proto?.get?.call(el) === "from-eval";
	});
	const painted = await page!.evaluate(() => {
		const el = document.querySelector("#title");
		const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
		return {
			value: proto?.get?.call(el) ?? "",
			disabled: (document.querySelector("#submit") as HTMLButtonElement | null)?.disabled !== false,
		};
	});
	assert.equal(painted.value, "from-eval");
	assert.equal(painted.disabled, true);
});

test("radix overlay intercepts a naive click on the dialog title field", { skip }, async () => {
	await page!.goto(demoUrl, { waitUntil: "networkidle" });
	await page!.locator("#new").click();
	await page!.locator("[role=dialog]").waitFor();
	await assert.rejects(
		() => page!.locator("#title").click({ timeout: 2500 }),
		/intercepts pointer events|not receiving pointer events/i,
	);
});

test("peek snapshot → fill → setInputFiles creates Coach create (note.txt)", { skip }, async () => {
	await page!.goto(demoUrl, { waitUntil: "networkidle" });
	assert.equal(await page!.locator("#count").textContent(), "1");

	const before = await peekSnapshot(page!);
	assert.equal(before.ok, true, before.error);
	assert.match(before.snapshot, /\[ref=/i);
	const newRef = before.snapshot.match(/button "New activity" \[ref=([^\]]+)\]/);
	assert.ok(newRef, `New activity ref missing:\n${before.snapshot}`);

	const created = await peekAct(page!, {
		steps: [
			{ action: "click", ref: newRef![1] },
			{ action: "waitFor", selector: "[role=dialog]", ms: 4000 },
			{ action: "fill", selector: "#title", value: "Coach create" },
			{ action: "setInputFiles", selector: "#file", fileName: "note.txt", fileContent: "hello coach", mimeType: "text/plain" },
			{ action: "click", selector: "#submit" },
			{ action: "wait", ms: 150 },
		],
	});
	assert.equal(created.passed, true, created.failure ?? JSON.stringify(created.steps, null, 2));
	assert.equal(created.steps.some((s) => s.action === "eval"), false, "happy path must not use eval setters");
	assert.equal(created.steps.some((s) => s.action === "fill" && s.ok), true);
	assert.equal(created.steps.some((s) => s.action === "setInputFiles" && s.ok), true);
	assert.equal(await page!.locator("[data-activity]").count(), 2);
	assert.equal(await page!.locator("#count").textContent(), "2");
	assert.match(await page!.locator("#activities").textContent() ?? "", /Coach create \(note\.txt\)/);
});
