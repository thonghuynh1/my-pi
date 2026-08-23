---
repo: F:/MyWork/my-pi/extensions/accordion
status: closed
---

## Parent

[Wayfinder map](../map.md) — Slice 4, ticket 07 (richer fold digests).

## What to build

A new `block-digest.ts` module that produces structured digest strings for folded blocks. Single entry point `richDigest()` returns a formatted digest body for recognized block types, or `undefined` for unrecognized tools (engine fallback).

Covers decisions: D19 (conductor-side module), D21 (new block-digest.ts), D22 (token count), D23 (ExtractableBlock tokens field), D26 (paired lookup for read/subagent), D28 (final template set), D29 (no tier gating).

## Implementation map

### New file: `app/src/lib/engine/block-digest.ts`

**Entry point:**
```ts
export function richDigest(block: ExtractableBlock, pairedArgs?: Record<string, unknown>): string | undefined
```

- `block`: ExtractableBlock (with new `tokens?: number` field)
- `pairedArgs`: parsed JSON args from the paired tool_call (conductor provides this for `read` and `subagent` only)
- Returns: digest body string (NO fold tag — engine owns tag via substOne recoverable path), or `undefined`

**Template logic (pattern-match on toolName/kind):**

| Condition | Template | Extraction |
|---|---|---|
| `isError === true` | `❌ <first non-empty line of text>` | `text.trimStart().split('\n')[0]` |
| `toolName === "read"` | `📄 <path> (~Nk tok)` | `pairedArgs.path` |
| `toolName === "subagent"` | `🔀 <type>: "<task>" (~Nk tok)` | `pairedArgs.type`, `pairedArgs.task` (truncate task at 80ch) |
| `kind === "text"` | `🤖 "<first sentence>" (~Nk tok)` | First sentence (split on `. ` or `.\n`), truncate 80ch, skip filler prefixes like "Let me", "I'll", "I will" |
| `kind === "thinking"` | `💭 (~Nk tok)` | Just tokens |
| `toolName?.startsWith("mcp__") or matches server prefix pattern` | `🔌 <server/tool> (~Nk tok)` | Parse toolName: strip `mcp__` prefix, replace `__` with `/` |
| Otherwise | `undefined` | Engine fallback |

**Token formatting helper:**
```ts
function fmtTok(tokens: number | undefined): string
// Returns "~0.3k tok", "~1.2k tok", "~12k tok" etc.
// undefined → "" (omit)
```

### Modify: `app/src/lib/engine/extractors.ts`

Add `tokens?: number` to `ExtractableBlock`:
```ts
export interface ExtractableBlock {
  id?: string;
  kind: string;
  toolName?: string;
  isError?: boolean;
  text?: string;
  recallCode?: string;
  retrievalIdentity?: string;
  tokens?: number;  // ← NEW
}
```

### Test file: `app/src/lib/engine/block-digest.test.ts`

Test each template branch with realistic block shapes. Test `undefined` return for unrecognized tools. Test token formatting. Test filler-prefix skipping for assistant text. Test task truncation for subagent.

## Acceptance criteria

- [ ] `richDigest()` returns `📄 src/lib/engine/store.svelte.ts (~8.4k tok)` for a read block with `pairedArgs: { path: "src/lib/engine/store.svelte.ts" }` and `tokens: 8400`
  - Run: `npx vitest run app/src/lib/engine/block-digest.test.ts`
  - Expected: test passes
  - Fails when: `richDigest` doesn't exist or returns wrong format

- [ ] `richDigest()` returns `🔀 explore: "find how ReplaceCommand is used for fold digests" (~2.1k tok)` for a subagent block with matching pairedArgs
  - Run: `npx vitest run app/src/lib/engine/block-digest.test.ts`
  - Expected: test passes
  - Fails when: subagent template missing or task not extracted from pairedArgs

- [ ] `richDigest()` returns `❌ TypeError: Cannot read property 'x' of undefined` for an isError block (no token suffix for errors)
  - Run: `npx vitest run app/src/lib/engine/block-digest.test.ts`
  - Expected: test passes
  - Fails when: isError branch missing or includes token count

- [ ] `richDigest()` returns `undefined` for a block with `toolName: "browser_inspect"` (unrecognized → engine fallback)
  - Run: `npx vitest run app/src/lib/engine/block-digest.test.ts`
  - Expected: test passes
  - Fails when: function returns a string instead of undefined for unknown tools

- [ ] `ExtractableBlock` interface includes `tokens?: number` and existing extractor tests still pass
  - Run: `npx vitest run app/src/lib/engine/extractors.test.ts`
  - Expected: all existing tests pass (optional field, non-breaking)
  - Fails when: adding the field breaks type compatibility

## Blocked by

None - can start immediately.
