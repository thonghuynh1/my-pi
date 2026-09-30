import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Deliberately opt-in: normal test runs and CI never read the private transcript.
const vitest = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
const result = spawnSync(process.execPath, [vitest, "run", "src/lib/engine/conductor.private-replay.test.ts"], {
	cwd: fileURLToPath(new URL("..", import.meta.url)),
	env: { ...process.env, ACCORDION_PRIVATE_REPLAY: "1" },
	stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
