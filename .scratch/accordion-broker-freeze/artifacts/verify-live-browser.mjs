import { chromium } from "../../../extensions/accordion/app/perf/node_modules/playwright/index.mjs";
import { writeFile } from "node:fs/promises";

const url = "http://127.0.0.1:62534/";
const reportPath = new URL("./live-browser-verification.json", import.meta.url);
const screenshotPath = new URL("./live-browser-verification.png", import.meta.url);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const startedAt = Date.now();

try {
	await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
	await page.waitForTimeout(3_000);
	const before = await page.evaluate(() => ({
		title: document.title,
		readyState: document.readyState,
		bodyLength: document.body.innerText.length,
		scrollY: window.scrollY,
	}));
	await page.mouse.wheel(0, 600);
	await page.waitForTimeout(250);
	const after = await page.evaluate(() => ({
		title: document.title,
		readyState: document.readyState,
		bodyLength: document.body.innerText.length,
		scrollY: window.scrollY,
		hasSession: document.body.innerText.includes("pi session"),
	}));
	await page.screenshot({ path: screenshotPath.pathname.slice(1), fullPage: false });
	const report = { ok: true, url, elapsedMs: Date.now() - startedAt, before, after };
	await writeFile(reportPath, JSON.stringify(report, null, 2));
	console.log(JSON.stringify(report, null, 2));
} finally {
	await browser.close();
}
