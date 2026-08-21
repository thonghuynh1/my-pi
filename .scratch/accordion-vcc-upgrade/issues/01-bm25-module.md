---
repo: C:\my-pi\extensions\accordion
---

## Parent

Wayfinder map: `.scratch/accordion-vcc-upgrade/map.md`, slice 1.
Resolved decision: [02 — search-within-fold architecture](../wayfinder/02-search-within-fold-architecture.md) (D3).

## What to build

A clean-room BM25 search module that takes an array of documents (block texts) and a query string, and returns ranked snippets with ±3-line context windows, merged if overlapping. Capped at top 5 results by score.

This is a pure function module with zero dependencies on accordion's store, protocol, or DOM. It can be tested in isolation.

## Implementation map

### New file: `app/src/lib/engine/bm25.ts`

**Input:**
```ts
interface SearchDocument { id: string; text: string }
function searchBlocks(docs: SearchDocument[], query: string, maxHits?: number): SearchHit[]
```

**Output:**
```ts
interface SearchHit {
  id: string       // document id (block id or group member id)
  snippet: string  // matching lines with ±3-line context, merged if overlapping
  score: number    // BM25 score
}
```

**BM25 algorithm (clean-room, inspired by pi-vcc's approach — no copy):**
- Tokenize: lowercase, split on whitespace/punctuation
- Stop-word filtering (common English stop words)
- Per-document term frequency with saturation (k1 = 1.2, b = 0.75)
- IDF weighting across the document set
- Length normalization against average document length
- 3-second wall-clock safety budget (`Date.now()` check)

**Snippet extraction:**
- For each matching document, find lines containing query terms
- Expand each match ±3 lines
- Merge overlapping windows
- Join with `\n…\n` separator between non-adjacent windows

**Cap:** Return top `maxHits` (default 5) results sorted by score descending.

### Test file: `app/src/lib/engine/bm25.test.ts`

Place tests alongside the module following the existing `*.test.ts` convention in `app/src/lib/engine/`.

## Acceptance criteria

- [ ] `searchBlocks` returns ranked results for a multi-document query
  - Run: `npx vitest run app/src/lib/engine/bm25.test.ts`
  - Expected: test passes — 3 docs, query matching 2, results sorted by score descending
  - Fails when: function doesn't exist or ranking is wrong

- [ ] Snippets include ±3-line context around matches
  - Run: `npx vitest run app/src/lib/engine/bm25.test.ts`
  - Expected: test passes — snippet for a match at line 10 of a 20-line doc includes lines 7–13
  - Fails when: snippet is full document text or just the matching line

- [ ] Overlapping context windows are merged
  - Run: `npx vitest run app/src/lib/engine/bm25.test.ts`
  - Expected: test passes — two matches 2 lines apart produce one merged window, not two
  - Fails when: duplicate lines appear in snippet

- [ ] Results capped at 5 by default
  - Run: `npx vitest run app/src/lib/engine/bm25.test.ts`
  - Expected: test passes — 10 matching docs, only top 5 returned
  - Fails when: more than 5 results returned

- [ ] Empty query or no matches returns empty array
  - Run: `npx vitest run app/src/lib/engine/bm25.test.ts`
  - Expected: test passes — `searchBlocks(docs, "xyzzy")` returns `[]`
  - Fails when: throws or returns non-empty

## Blocked by

None - can start immediately.
