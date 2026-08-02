import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const conductorsDir = path.resolve(__dirname, "../../conductors");
const libDir = path.resolve(__dirname, "../src/lib");

export default defineConfig({
  plugins: [svelte({ configFile: false, compilerOptions: { runes: true } })],
  resolve: {
    alias: [
      { find: /^\$lib\//, replacement: `${libDir}/` },
      { find: /^\$conductors$/, replacement: conductorsDir },
      { find: /^\$conductors\//, replacement: `${conductorsDir}/` },
    ],
  },
  test: {
    environment: "node",
    include: ["store/**/*.test.ts", "store/**/*.bench.ts"],
  },
});
