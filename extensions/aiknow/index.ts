import { existsSync } from "fs";

const DEFAULT_AIKNOW_PATH =
  "F:/MyWork/aiKnow/integrations/pi/aiknow/index.ts";

const AIKNOW_PATH = process.env.AIKNOW_PATH ?? DEFAULT_AIKNOW_PATH;

export const piExtension = { id: "aiknow" };

export default async function (pi: unknown) {
  if (!existsSync(AIKNOW_PATH)) {
    return;
  }
  const mod = await import(AIKNOW_PATH);
  if (typeof mod.default === "function") {
    await mod.default(pi);
  }
}
