import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type SearchTool = {
  name: string;
  execute: (...args: unknown[]) => Promise<{ content: Array<{ text: string }>; details: unknown }>;
};

type RegisteredPi = {
  registerTool(tool: SearchTool): void;
};

let extension: (pi: unknown) => Promise<void>;
let adapterDirectory: string;
let previousAiknowPath: string | undefined;

async function runSearch(query: string): Promise<string> {
  const tools: SearchTool[] = [];
  const pi: RegisteredPi = {
    registerTool(tool) {
      tools.push(tool);
    },
  };

  await extension(pi);
  const search = tools.find(tool => tool.name === "aiknow_search");
  if (!search) throw new Error("aiknow_search was not registered");

  const result = await search.execute("call-id", { query }, undefined, undefined, {});
  return result.content.map(block => block.text).join("\n");
}

describe("aiKnow escalation nudges", () => {
  beforeAll(async () => {
    adapterDirectory = mkdtempSync(join(tmpdir(), "aiknow-nudge-adapter-"));
    writeFileSync(join(adapterDirectory, "adapter.mjs"), `
      export default function (pi) {
        pi.registerTool({
          name: "aiknow_search",
          execute: async (_id, params) => {
            const counts = { FooBar: 0, Widget: 1, WidgetPair: 2, WidgetMany: 5, MapFree: 0 };
            const count = counts[params.query] ?? 0;
            return {
              content: [{ type: "text", text: "indexed response" }],
              details: { entryPoints: Array.from({ length: count }, (_, index) => ({ index })) },
            };
          },
        });
      }
    `);

    previousAiknowPath = process.env.AIKNOW_PATH;
    process.env.AIKNOW_PATH = join(adapterDirectory, "adapter.mjs");
    ({ default: extension } = await import("../../extensions/aiknow/index.ts"));
  });

  afterAll(() => {
    if (previousAiknowPath === undefined) delete process.env.AIKNOW_PATH;
    else process.env.AIKNOW_PATH = previousAiknowPath;
    rmSync(adapterDirectory, { recursive: true, force: true });
  });

  it("appends zero-result nudge with interpolated term", async () => {
    const content = await runSearch("FooBar");

    expect(content).toContain('[aiknow] No indexed results for "FooBar". Try grep, or the symbol may be in an unindexed file.');
  });

  it("appends broadening nudge for 1-2 results", async () => {
    const oneResult = await runSearch("Widget");
    const twoResults = await runSearch("WidgetPair");

    expect(oneResult).toContain('[aiknow] Only 1 result(s) for "Widget"');
    expect(oneResult).toMatch(/grep/);
    expect(twoResults).toContain('[aiknow] Only 2 result(s) for "WidgetPair"');
    expect(twoResults).toMatch(/grep/);
  });

  it("no nudge for 3+ results", async () => {
    const content = await runSearch("WidgetMany");

    expect(content).not.toContain("[aiknow]");
  });

  it("nudge does not reference codebase map", async () => {
    const content = await runSearch("MapFree");

    expect(content).not.toMatch(/codebase map|proactive|## Codebase Map/i);
  });
});
