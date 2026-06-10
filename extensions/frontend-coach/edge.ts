/**
 * edge.ts — locate, launch and attach to a Microsoft Edge instance
 * over the Chrome DevTools Protocol so the agent can drive a real
 * browser tab without any "share this tab" permission prompts.
 *
 * We launch Edge with `--remote-debugging-port=<port>` against a
 * dedicated user-data-dir under `./.frontend-coach/edge-profile/`
 * so it stays isolated from your normal Edge profile (cookies,
 * extensions, autofill, etc).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

export const DEFAULT_CDP_PORT = Number(process.env.FRONTEND_COACH_CDP_PORT ?? 9222);

let edgeProc: ChildProcess | null = null;
let cachedBrowser: Browser | null = null;
let cachedPort: number | null = null;

/** Best-effort Edge binary discovery across platforms. */
export function findEdgeBinary(): string | null {
	if (process.env.FRONTEND_COACH_EDGE_PATH && existsSync(process.env.FRONTEND_COACH_EDGE_PATH)) {
		return process.env.FRONTEND_COACH_EDGE_PATH;
	}
	if (process.platform === "win32") {
		const candidates = [
			join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe"),
			join(process.env["ProgramFiles"] ?? "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe"),
			join(process.env["LOCALAPPDATA"] ?? "", "Microsoft", "Edge", "Application", "msedge.exe"),
		];
		for (const p of candidates) if (p && existsSync(p)) return p;
		return null;
	}
	if (process.platform === "darwin") {
		const p = "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";
		return existsSync(p) ? p : null;
	}
	// Linux — rely on PATH lookup at spawn time.
	return "microsoft-edge";
}

export function profileDir(): string {
	const dir = resolve("./.frontend-coach/edge-profile");
	mkdirSync(dir, { recursive: true });
	return dir;
}

async function debugEndpointAlive(port: number): Promise<boolean> {
	try {
		const r = await fetch(`http://127.0.0.1:${port}/json/version`);
		return r.ok;
	} catch {
		return false;
	}
}

export interface LaunchResult {
	ok: boolean;
	reason?: string;
	port: number;
	alreadyRunning?: boolean;
	binary?: string;
	profile?: string;
}

export async function launchEdge(opts: { url?: string; port?: number } = {}): Promise<LaunchResult> {
	const port = opts.port ?? DEFAULT_CDP_PORT;

	// Already up? Reuse.
	if (await debugEndpointAlive(port)) {
		return { ok: true, port, alreadyRunning: true };
	}

	const bin = findEdgeBinary();
	if (!bin) {
		return { ok: false, port, reason: "Microsoft Edge binary not found. Set FRONTEND_COACH_EDGE_PATH to override." };
	}

	const profile = profileDir();
	const args = [
		`--remote-debugging-port=${port}`,
		`--user-data-dir=${profile}`,
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-features=msImplicitSignin,msEdgeIdentityPlatformAddOn",
		"--restore-last-session=false",
	];
	if (opts.url) args.push(opts.url);

	try {
		edgeProc = spawn(bin, args, {
			detached: false,
			stdio: "ignore",
			windowsHide: false,
		});
	} catch (err) {
		return { ok: false, port, reason: `failed to spawn Edge: ${(err as Error).message}`, binary: bin };
	}

	edgeProc.on("exit", () => {
		edgeProc = null;
		cachedBrowser = null;
		cachedPort = null;
	});

	// Wait up to 10s for the debug endpoint to come up.
	for (let i = 0; i < 50; i++) {
		if (await debugEndpointAlive(port)) {
			return { ok: true, port, binary: bin, profile };
		}
		await new Promise((r) => setTimeout(r, 200));
	}
	return { ok: false, port, reason: "Edge launched but did not expose the debug port within 10s.", binary: bin, profile };
}

export function isEdgeRunning(): boolean {
	return edgeProc != null && !edgeProc.killed;
}

export function stopEdge(): void {
	cachedBrowser = null;
	cachedPort = null;
	if (edgeProc && !edgeProc.killed) {
		try { edgeProc.kill(); } catch {}
	}
	edgeProc = null;
}

/**
 * Inject the Alt+P picker into every page in this context, and into the
 * given page right now (which may have loaded before the init-script was
 * registered). Safe to call multiple times — the picker self-guards with
 * `window.__piCoach`. Without this, any page.goto() during a recording wipes
 * the picker and Alt+P stops working until the user re-runs the bookmarklet.
 */
const pickerSourceCache = { src: null as string | null };
function loadPickerSource(): string {
	if (pickerSourceCache.src != null) return pickerSourceCache.src;
	const here = dirname(fileURLToPath(import.meta.url));
	pickerSourceCache.src = readFileSync(join(here, "picker.js"), "utf8");
	return pickerSourceCache.src;
}
const contextsWithPicker = new WeakSet<BrowserContext>();
export async function ensurePickerInstalled(context: BrowserContext, page?: Page): Promise<void> {
	const src = loadPickerSource();
	if (!contextsWithPicker.has(context)) {
		try {
			await context.addInitScript({ content: src });
			contextsWithPicker.add(context);
		} catch (err) {
			console.warn(`[frontend-coach] addInitScript failed: ${(err as Error).message}`);
		}
	}
	if (page) {
		try { await page.evaluate(src); } catch { /* CSP or detached frame — ignore */ }
	}
}

/** Connect Playwright to the running Edge via CDP. Cached. */
export async function ensureBrowser(port = DEFAULT_CDP_PORT): Promise<Browser> {
	if (cachedBrowser && cachedBrowser.isConnected() && cachedPort === port) {
		return cachedBrowser;
	}
	if (!(await debugEndpointAlive(port))) {
		throw new Error(`No Edge instance is listening on port ${port}. Run /coach-launch-edge first.`);
	}
	const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
	cachedBrowser = browser;
	cachedPort = port;
	browser.on("disconnected", () => {
		if (cachedBrowser === browser) {
			cachedBrowser = null;
			cachedPort = null;
		}
	});
	return browser;
}
