import { registerHooks } from "node:module";
import { dirname, join, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const entry = process.env.PI_SUBAGENT_TEST_SDK_ENTRY
  ? resolve(process.env.PI_SUBAGENT_TEST_SDK_ENTRY)
  : process.env.APPDATA
    ? join(process.env.APPDATA, "npm", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "index.js")
    : undefined;
if (!entry) throw new Error("Set PI_SUBAGENT_TEST_SDK_ENTRY to the installed SDK's dist/index.js (Node 22.15+ required).");
const hostUrl = pathToFileURL(entry).href;
const aliases = new Set([
  "@earendil-works/pi-coding-agent", "@earendil-works/pi-agent-core", "@earendil-works/pi-tui",
  "@earendil-works/pi-ai", "@earendil-works/pi-ai/compat", "@earendil-works/pi-ai/oauth",
  "@earendil-works/pi-ai/providers/all", "typebox", "typebox/compile", "typebox/value",
]);
const sourceRoot = new URL("../", import.meta.url).href;
const resolutions = new Map();
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!context.parentURL?.startsWith(sourceRoot) || !aliases.has(specifier)) return nextResolve(specifier, context);
    const target = specifier === "@earendil-works/pi-coding-agent" ? hostUrl
      : specifier === "@earendil-works/pi-ai" ? "@earendil-works/pi-ai/compat" : specifier;
    const result = nextResolve(target, { ...context, parentURL: hostUrl });
    if (!resolutions.has(specifier)) {
      console.error(`[subagent-host-alias] ${specifier} -> ${result.url}`);
      resolutions.set(specifier, result.url);
    }
    return result;
  },
});

function version(url) {
  let directory = dirname(fileURLToPath(url));
  for (;;) {
    const metadata = join(directory, "package.json");
    if (existsSync(metadata)) {
      const value = JSON.parse(readFileSync(metadata, "utf8"));
      if (typeof value.version === "string") return `${value.name}@${value.version}`;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Cannot find package metadata for ${url}`);
    directory = parent;
  }
}
const importedSdk = await import("@earendil-works/pi-coding-agent");
const explicitSdk = await import(hostUrl);
if (importedSdk !== explicitSdk) throw new Error("Host SDK resolution hook is not active.");
await Promise.all([import("@earendil-works/pi-ai"), import("@earendil-works/pi-tui"), import("typebox")]);
const packages = ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai", "@earendil-works/pi-tui", "typebox"];
console.error(`[subagent-host-sdk] verified module identity; Node ${process.version}; ${packages.map((name) => version(resolutions.get(name))).join("; ")}`);
