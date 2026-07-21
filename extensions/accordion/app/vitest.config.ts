import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { svelteTesting } from "@testing-library/svelte/vite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// Standalone vitest config — deliberately does NOT load the SvelteKit plugin (no
// svelte-kit sync step). It DOES load the bare Svelte plugin so that `.svelte.ts`
// rune modules (e.g. engine/store.svelte.ts) compile; pure-TS tests (live mapping)
// are unaffected.
//
// Because the SvelteKit plugin is absent, kit's `$conductors` alias never gets injected
// here — so we mirror it explicitly (the top-level `conductors/` dir holds the contract +
// built-in). Both the bare barrel (`$conductors` → conductors/index.ts) and subpaths
// (`$conductors/contract`) must resolve.
const conductorsDir = path.resolve(__dirname, "../conductors");
const libDir = path.resolve(__dirname, "src/lib");
export default defineConfig({
	plugins: [svelte({ configFile: false, compilerOptions: { runes: true } }), svelteTesting()],
	resolve: {
		alias: [
			{ find: /^\$lib\//, replacement: `${libDir}/` },
			{ find: /^\$conductors$/, replacement: conductorsDir },
			{ find: /^\$conductors\//, replacement: `${conductorsDir}/` },
		],
	},
	test: {
		environment: "node",
		include: ["src/lib/**/*.test.ts", "../extension/**/*.test.ts"],
		// Component tests (Inspector.test.ts and friends under `ui/`) need a DOM.
		// Everything else stays on the fast `node` environment.
		environmentMatchGlobs: [
			["src/lib/ui/**/*.test.ts", "jsdom"],
			["src/lib/**/*.svelte.test.ts", "jsdom"],
		],
		setupFiles: ["./src/lib/test/setup-component.ts"],
	},
});
