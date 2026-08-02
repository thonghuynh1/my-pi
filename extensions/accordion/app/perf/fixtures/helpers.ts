import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Block, BlockKind, ParsedSession } from "../../src/lib/engine/types";
import { parse } from "../../src/lib/engine/parse";
import { AccordionStore, type HarnessBreakdown } from "../../src/lib/engine/store.svelte";

export function blk(i: number, kind: BlockKind = "text", tokens = 1_000): Block {
  return {
    id: `m${i}:p0`,
    kind,
    turn: i + 1,
    order: i,
    text: `${kind} block ${i}`,
    tokens,
    override: null,
    autoFolded: false,
    by: null,
    proactivelyCompressed: false,
  };
}

export function makeStore(blocks: Block[]): AccordionStore {
  const parsed: ParsedSession = {
    meta: { format: "pi", title: "perf", cwd: "", model: "" },
    blocks,
    lineCount: 0,
    skipped: 0,
  };
  return new AccordionStore(parsed);
}

export function loadSampleSession(): AccordionStore {
  const raw = readFileSync(fileURLToPath(new URL("../../static/sample-session.jsonl", import.meta.url)), "utf8");
  return new AccordionStore(parse(raw));
}

export const mockHarness: HarnessBreakdown = {
  totalTokens: null,
  systemPromptTokens: null,
};
