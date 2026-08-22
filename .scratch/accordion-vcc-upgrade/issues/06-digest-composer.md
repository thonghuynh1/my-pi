---
repo: F:/MyWork/my-pi/extensions/accordion
status: closed
---

## Parent

[Wayfinder map](../map.md) — Slice 2 (group semantic sections)
Covers decisions: D6 (conductor calls extractors), D8 (self-contained, omit empty), D9 (multi-line format)

## What to build

A `buildSemanticDigest()` composer function that assembles extractor outputs into the final multi-line digest string, and a `formatMcpIndex()` helper for the MCP Retrieval Index section.

### Resolved decisions

- **D6**: Conductor calls shared library, passes result as `GroupCommand.digest`
- **D8**: Each section present only when non-empty. Self-contained per group.
- **D9**: Multi-line structured format, optimized for agent selection

### Implementation map

**File**: `app/src/lib/engine/extractors.ts` (extend from issues 04, 05)

**New export:**

```typescript
interface DigestMeta {
  foldCode: string;    // for {#code FOLDED} tag
  blockCount: number;
  turnRange: string;   // e.g. "turns 3–8" or "turn 3"
  tokens: number;
}

function buildSemanticDigest(blocks: ExtractableBlock[], meta: DigestMeta): string
```

**Logic:**
1. Call `extractAsks(blocks)`, `extractFiles(blocks)`, `extractErrors(blocks)`, `buildMcpIndex(blocks)`
2. Build header line: `{#<foldCode> FOLDED} group · <blockCount> blocks · <turnRange> · ~<tokens> tok`
3. Append non-empty sections:
   - `[Asks] ask1 · ask2 · ask3`
   - `[Files] path1, path2, path3`
   - `[Errors] err1 · err2`
   - `[MCP Index]` header, then indented `  identity → code1, code2` per entry
4. Join with newlines. Return the composed string.

**Output format example:**
```
{#a3f2b1 FOLDED} group · 12 blocks · turns 3–8 · ~2400 tok
[Asks] implement auth flow · update the footer
[Files] src/auth/token.ts, src/middleware/verify.ts, tests/auth.spec.ts
[Errors] 403 Forbidden on /api/token
[MCP Index]
  engineering-skills/skill-trek → r13
  subagent/check pi-vcc extractors → r32
```

**Existing helpers to reuse:**
- `digest.ts` has `foldTag(id)` for producing `{#code FOLDED}` — consider importing or inlining the same pattern
- `digest.ts` has `turnSpan(members)` — the conductor must compute `DigestMeta.turnRange` itself since it works with `ViewBlock[]` not `Block[]`

**Test file**: `app/src/lib/engine/extractors.test.ts` (extend)

## Acceptance criteria

- [ ] `buildSemanticDigest` produces correct header line with fold code, block count, turn range, and tokens
  - Run: `npx vitest run app/src/lib/engine/extractors.test.ts`
  - Expected: Header matches `{#<code> FOLDED} group · N blocks · turns X–Y · ~T tok`
  - Fails when: header format wrong or missing fold code

- [ ] `buildSemanticDigest` includes non-empty sections and omits empty ones
  - Run: `npx vitest run app/src/lib/engine/extractors.test.ts`
  - Expected: Group with user+files+errors → all 3 sections present. Group with only tool_calls (no user, no errors) → only [Files] present. All-MCP group → only [MCP Index] present.
  - Fails when: empty sections appear or non-empty sections missing

- [ ] `buildSemanticDigest` produces correct section delimiters and separators
  - Run: `npx vitest run app/src/lib/engine/extractors.test.ts`
  - Expected: Asks separated by ` · `, Files separated by `, `, MCP Index entries indented with `  `
  - Fails when: wrong separators or formatting

- [ ] All-empty group produces header-only digest (no section lines)
  - Run: `npx vitest run app/src/lib/engine/extractors.test.ts`
  - Expected: Only the `{#code FOLDED} group · ...` line, no trailing newline
  - Fails when: empty section headers appear

## Blocked by

- `04-extractor-module.md`
- `05-mcp-retrieval-index.md`
