import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const vendorRoot = join(root, "vendor", "accordion");

function requirePath(path) {
	if (!existsSync(path)) throw new Error(`Missing required path: ${path}`);
}

function replaceOnce({ file, needle, replacement, label, satisfied = [] }) {
	const path = join(vendorRoot, file);
	let text = readFileSync(path, "utf8");
	const satisfiedMarkers = [replacement, ...satisfied];
	if (satisfiedMarkers.some((marker) => text.includes(marker))) {
		console.log(`overlay kept ${label}`);
		return;
	}
	const needles = Array.isArray(needle) ? needle : [needle];
	const hit = needles.find((candidate) => text.includes(candidate));
	if (!hit) throw new Error(`Cannot apply overlay. Missing anchor for ${label}: ${needles[0]}`);
	text = text.replace(hit, replacement);
	writeFileSync(path, text);
	console.log(`overlay patched ${label}`);
}

requirePath(vendorRoot);

// ── Defaults: steering on, budget 100k, conductor my-customize-conductor ─────

replaceOnce({
	file: "app/src/lib/live/liveClient.svelte.ts",
	label: "default folding.enabled = true on hello",
	needle: 'folding.enabled = false;',
	replacement: 'folding.enabled = true; // overlay: default steering ON',
});

replaceOnce({
	file: "app/src/lib/live/liveClient.svelte.ts",
	label: "default budget 100k",
	needle: 'session.store.setBudget(msg.meta.contextWindow);',
	replacement: 'session.store.setBudget(Math.min(msg.meta.contextWindow, 100_000)); // overlay: cap budget at 100k',
	satisfied: [
		'const LIVE_BUDGET_CAP = 100_000;',
		'session.store.setBudget(liveBudgetForContextWindow(msg.meta.contextWindow));',
	],
});

replaceOnce({
	file: "app/src/lib/live/conductor.svelte.ts",
	label: "default conductor my-customize-conductor",
	needle: [
		'return localStorage.getItem(KEY) || BUILTIN_ID;',
		'return localStorage.getItem(KEY) || "mcp-preserving-gc"; // overlay: default to MCP-preserving GC',
	],
	replacement: 'return localStorage.getItem(KEY) || "my-customize-conductor"; // overlay: default to My Customize',
});
