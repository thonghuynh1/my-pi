import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const STUB_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_AIKNOW_PATH = resolve(
  "C:/Hackathon/aiKnow/aiKnow/integrations/pi/aiknow/index.ts",
);

function valueFromEnvFile(filePath: string, key: string): string | undefined {
  if (!existsSync(filePath)) return undefined;
  const text = readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const name = line.slice(0, eq).trim();
    if (name !== key) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value || undefined;
  }
  return undefined;
}

export function resolveAiknowPath(): string {
  const fromProcess = process.env.AIKNOW_PATH?.trim();
  if (fromProcess) return fromProcess;
  const fromEnvFile =
    valueFromEnvFile(resolve(STUB_DIR, ".env"), "AIKNOW_PATH") ??
    valueFromEnvFile(resolve(STUB_DIR, "../../.env"), "AIKNOW_PATH");
  if (fromEnvFile) return fromEnvFile;
  return DEFAULT_AIKNOW_PATH;
}

export const piExtension = { id: "aiknow" };

export default async function (pi: unknown) {
  const aiknowPath = resolveAiknowPath();
  if (!existsSync(aiknowPath)) {
    return;
  }
  const mod = await import(aiknowPath);
  if (typeof mod.default === "function") {
    await mod.default(pi);
  }
}
