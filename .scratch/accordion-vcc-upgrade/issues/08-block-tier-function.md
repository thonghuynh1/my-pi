---
repo: F:/MyWork/my-pi/extensions/accordion
status: closed
---

## Parent

[Wayfinder map](../map.md) — Slice 3

## What to build

Add a `blockTier()` function to `extractors.ts` that classifies any block into one of three structural tiers: `"high"`, `"medium"`, or `"low"`. This tier gates digest quality in ticket 07 — high-tier blocks get rich structured digests, low-tier blocks get default engine truncation.

Covers resolved decisions: [06 — per-block ranking scores](../wayfinder/06-per-block-ranking-scores.md) (D14–D18 in ledger).

## Implementation map

### Target file

`app/src/lib/engine/extractors.ts` (~134 lines, zero imports, self-contained)

### Existing interface to operate on

```ts
export interface ExtractableBlock {
  id?: string;
  kind: string;
  toolName?: string;
  isError?: boolean;
  text?: string;
  recallCode?: string;
  retrievalIdentity?: string;
}
```

### New export: `BlockTier` type

```ts
export type BlockTier = "high" | "medium" | "low";
```

### New export: `blockTier(block: ExtractableBlock): BlockTier`

Classification rules (evaluated in order, first match wins):

1. `isError === true` → `"high"`
2. `toolName` in `{"edit", "write", "multiedit"}` → `"high"`
3. `toolName === "run_tests"` → `"high"`
4. `toolName === "bash"` AND `text` matches test-runner regex → `"high"`
5. `kind === "user"` → `"medium"`
6. `toolName === "bash"` → `"medium"`
7. `kind === "text"` (assistant) → `"medium"`
8. `toolName` in `{"subagent", "mcp"}` or toolName contains server prefix pattern → `"medium"`
9. `toolName` in `{"read", "write", "find", "grep", "ls"}` AND NOT already matched as high → `"low"`
10. Default (generic `tool_result`, `thinking`) → `"low"`

### Graceful degradation

When `text` is `undefined`, skip the bash test-runner regex check — ambiguous bash blocks default to `"medium"` (rule 6).

### Test-runner regex (private constant)

Match common test runners in bash content: `npm test`, `npx vitest`, `npx jest`, `pytest`, `dotnet test`, `go test`, `cargo test`, `mix test`. Case-insensitive. Only needs to match the command, not the full output.

### Test seam

`app/src/lib/engine/extractors.test.ts` — existing test file for all extractor functions. Add a new `describe("blockTier")` section.

## Acceptance criteria

- [ ] `blockTier` is exported from `extractors.ts` with signature `(block: ExtractableBlock) => BlockTier`
  - Run: `npx vitest run app/src/lib/engine/extractors.test.ts`
  - Expected: new `blockTier` tests pass (at minimum: one test per tier, one test for bash+test regex → high, one test for bash without text → medium fallback)
  - Fails when: function not exported or signature mismatched

- [ ] High tier correctly identifies all high-value block types
  - Run: `npx vitest run app/src/lib/engine/extractors.test.ts -t "blockTier.*high"`
  - Expected: edit/write/multiedit, run_tests, isError=true, bash+test-regex all return `"high"`
  - Fails when: any high-value toolName returns wrong tier

- [ ] Graceful degradation when text is absent
  - Run: `npx vitest run app/src/lib/engine/extractors.test.ts -t "blockTier.*fallback"`
  - Expected: `{ kind: "tool_result", toolName: "bash", text: undefined }` returns `"medium"`, not `"high"` or `"low"`
  - Fails when: function throws or returns `"low"` for ambiguous bash

- [ ] Existing extractor tests still pass (no regressions)
  - Run: `npx vitest run app/src/lib/engine/extractors.test.ts`
  - Expected: all existing tests pass unchanged
  - Fails when: new code breaks existing exports or interface

## Blocked by

None - can start immediately.
