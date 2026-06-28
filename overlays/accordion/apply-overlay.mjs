import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const overlayRoot = join(root, "overlays", "accordion");
const vendorRoot = join(root, "vendor", "accordion");

function requirePath(path) {
	if (!existsSync(path)) throw new Error(`Missing required path: ${path}`);
}

function copyOverlay(relativePath) {
	const src = join(overlayRoot, relativePath);
	const dest = join(vendorRoot, relativePath);
	requirePath(src);
	mkdirSync(dirname(dest), { recursive: true });
	copyFileSync(src, dest);
	console.log(`overlay copied ${relativePath}`);
}

function insertOnce({ file, needle, insert, label }) {
	const path = join(vendorRoot, file);
	let text = readFileSync(path, "utf8");
	if (text.includes(insert.trim())) {
		console.log(`overlay kept ${label}`);
		return;
	}
	const needles = [needle, needle.replaceAll("\n", "\r\n")];
	const hit = needles
		.map((candidate) => ({ index: text.indexOf(candidate), needle: candidate }))
		.find((candidate) => candidate.index >= 0);
	if (!hit) throw new Error(`Cannot apply overlay. Missing anchor for ${label}: ${needle}`);
	text = text.slice(0, hit.index + hit.needle.length) + insert + text.slice(hit.index + hit.needle.length);
	writeFileSync(path, text);
	console.log(`overlay patched ${label}`);
}

function replaceOnce({ file, needle, replacement, label }) {
	const path = join(vendorRoot, file);
	let text = readFileSync(path, "utf8");
	if (text.includes(replacement)) {
		console.log(`overlay kept ${label}`);
		return;
	}
	if (!text.includes(needle)) throw new Error(`Cannot apply overlay. Missing anchor for ${label}: ${needle}`);
	text = text.replace(needle, replacement);
	writeFileSync(path, text);
	console.log(`overlay patched ${label}`);
}

requirePath(vendorRoot);

copyOverlay("conductors/mcp-preserving-gc/mcp-preserving-gc.ts");
copyOverlay("app/src/lib/engine/conductor.mcp-preserving-gc.test.ts");

insertOnce({
	file: "conductors/index.ts",
	label: "MCP-preserving GC import",
	needle: 'import { GarbageCollectorConductor } from "./garbage-collector/garbage-collector";\n',
	insert: 'import { McpPreservingGcConductor } from "./mcp-preserving-gc/mcp-preserving-gc";\n',
});

insertOnce({
	file: "conductors/index.ts",
	label: "MCP-preserving GC export",
	needle: 'export { GarbageCollectorConductor } from "./garbage-collector/garbage-collector";\n',
	insert: 'export { McpPreservingGcConductor } from "./mcp-preserving-gc/mcp-preserving-gc";\n',
});

insertOnce({
	file: "conductors/index.ts",
	label: "MCP-preserving GC registry entry",
	needle: '  { id: "garbage-collector", label: "Garbage collector", create: () => new GarbageCollectorConductor() },\n',
	insert: '  { id: "mcp-preserving-gc", label: "MCP-preserving GC", create: () => new McpPreservingGcConductor() },\n',
});

// ── Defaults: steering on, budget 100k, conductor mcp-preserving-gc ──────────

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
});

replaceOnce({
	file: "app/src/lib/live/conductor.svelte.ts",
	label: "default conductor mcp-preserving-gc",
	needle: 'return localStorage.getItem(KEY) || BUILTIN_ID;',
	replacement: 'return localStorage.getItem(KEY) || "mcp-preserving-gc"; // overlay: default to MCP-preserving GC',
});
