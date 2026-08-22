---
repo: F:/MyWork/my-pi/extensions/accordion
status: closed
---

## Parent

[Wayfinder map](../map.md) — Slice 2 (group semantic sections)
Covers decisions: D6 (shared library), D7 (section set), D11 (Asks shape), D12 (Files shape), D13 (Errors shape)

## What to build

A shared extractor module at `app/src/lib/engine/extractors.ts` that exports pure functions to extract semantic sections from a set of blocks. These are deterministic, zero-LLM, regex/filter-based extractors.

### Resolved decisions

- **D6**: Extractors are pure functions in a shared module alongside `bm25.ts`
- **D7**: Three sections — Asks, Files, Errors. Commits and Preferences excluded.
- **D11**: `extractAsks()` — first line of each `user` block, deduped, capped at 6, truncated at 60 chars. No overflow indicator.
- **D12**: `extractFiles()` — `path` argument from strict allowlist (`read`, `write`, `edit`, `find`, `grep`, `ls`) tool_call blocks. Full literal paths, deduped, capped at 8.
- **D13**: `extractErrors()` — `isError === true` blocks only. First line of text, truncated at 80 chars, capped at 3, deduped.

### Implementation map

**New file**: `app/src/lib/engine/extractors.ts` (alongside `bm25.ts`, `digest.ts`, `tokens.ts`)

The input type should be a minimal block shape that both `Block` (engine-side) and `ViewBlock` (conductor-side) satisfy:

```typescript
interface ExtractableBlock {
  kind: string;          // "user" | "tool_call" | "tool_result" | ...
  toolName?: string;
  isError?: boolean;
  text?: string;
}
```

**Exports:**

1. `extractAsks(blocks: ExtractableBlock[]): string[]`
   - Filter `kind === "user"`, take first line of `text`, trim, truncate at 60 chars, dedup, cap at 6

2. `extractFiles(blocks: ExtractableBlock[]): string[]`
   - Filter `kind === "tool_call"` where `toolName` is in `FILE_TOOLS` set (`read`, `write`, `edit`, `find`, `grep`, `ls`)
   - Regex parse `path` argument from `text` (pattern: `"path": "..."` or `path: "..."` or similar JSON/YAML shapes)
   - Dedup, cap at 8, preserve insertion order

3. `extractErrors(blocks: ExtractableBlock[]): string[]`
   - Filter `isError === true`
   - Take first line of `text`, trim, truncate at 80 chars, dedup, cap at 3

All functions are pure, deterministic, zero-dependency. Empty input → empty array.

**Test file**: `app/src/lib/engine/extractors.test.ts`

## Acceptance criteria

- [ ] `extractAsks` returns first lines of user blocks, deduped, capped at 6, truncated at 60 chars
  - Run: `npx vitest run app/src/lib/engine/extractors.test.ts`
  - Expected: Test passes with cases: 0 user blocks → [], 1 user block → [firstLine], 3 user blocks → [3 lines], 8 user blocks → [first 6], duplicate asks deduped, line > 60 chars truncated
  - Fails when: function is missing or returns wrong shape

- [ ] `extractFiles` returns paths from allowlisted tool_call blocks, deduped, capped at 8
  - Run: `npx vitest run app/src/lib/engine/extractors.test.ts`
  - Expected: Test passes with cases: read/write/edit/find/grep/ls tool_calls → paths extracted; bash/mcp/subagent tool_calls → ignored; duplicate paths deduped; > 8 paths capped
  - Fails when: non-allowlisted tools leak through or path regex fails

- [ ] `extractErrors` returns first lines of isError blocks, deduped, capped at 3, truncated at 80 chars
  - Run: `npx vitest run app/src/lib/engine/extractors.test.ts`
  - Expected: Test passes with cases: 0 errors → [], isError blocks → first lines, non-error blocks ignored, > 3 capped, > 80 chars truncated
  - Fails when: non-error blocks included or truncation wrong

- [ ] All three extractors accept both Block-shaped and ViewBlock-shaped inputs (via ExtractableBlock interface)
  - Run: `npx vitest run app/src/lib/engine/extractors.test.ts`
  - Expected: TypeScript compiles, tests pass with both shapes
  - Fails when: interface requires fields only present on one type

## Blocked by

None - can start immediately.
