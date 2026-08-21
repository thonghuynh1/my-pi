---
repo: C:\my-pi\extensions\accordion
---

## Parent

Wayfinder map: `.scratch/accordion-vcc-upgrade/map.md`, slice 1.
Resolved decision: [02 — search-within-fold architecture](../wayfinder/02-search-within-fold-architecture.md) (D1, D2, D3, D4, D5).

## What to build

Wire the BM25 module into `resolveRecall` so that when a `query` is present, the GUI returns BM25-ranked fragments in `RecallContent.text` instead of full block content. This is the integration issue that connects issues 01 and 02.

## Implementation map

### `resolveRecall` change: `app/src/lib/live/plan.ts` (line 192)

**Current signature:**
```ts
export function resolveRecall(store: AccordionStore, codes: string[]): { restored: RecallContent[]; missing: string[] }
```

**New signature:**
```ts
export function resolveRecall(store: AccordionStore, codes: string[], query?: string): { restored: RecallContent[]; missing: string[] }
```

**Behavior when `query` is present:**

For each code (group or single block), instead of returning full `text`:

1. Collect the text(s) — for a group: `g.memberIds.map(id => store.get(id)?.text)`, for a single block: `[block.text]`
2. Call `searchBlocks(docs, query, 5)` from `bm25.ts` (issue 01)
3. If hits found: set `RecallContent.text` to the joined snippets (top 5 by score, separated by `\n---\n`)
4. If no hits: set `RecallContent.text` to empty string `""` — block stays in `restored` (code was found), not `missing`

When `query` is absent: existing behavior unchanged — full text returned.

### GUI WebSocket handler

In the GUI's WebSocket message handler (where `recallRequest` is received and `resolveRecall` is called), thread the `query` field from the incoming `RecallRequestMessage` to `resolveRecall`'s third parameter.

**Current** (in `app/src/lib/live/` — likely `session.ts` or `connection.ts`):
```ts
const result = resolveRecall(store, msg.codes);
```

**Change:**
```ts
const result = resolveRecall(store, msg.codes, msg.query);
```

### Test file: `app/src/lib/live/plan.test.ts`

Add new test cases under the existing `describe("resolveRecall")` block (currently at line 503+):

1. **Query with matches** — single folded block, query matching 2 lines → `text` contains snippets with ±3-line context
2. **Query with no matches** — single folded block, query matching nothing → `text` is `""`
3. **Query across group** — group with 3 member blocks, query matching in 2 of them → `text` contains ranked snippets from both, best-scoring first
4. **Query capped at 5** — group with many matching blocks → only top 5 in `text`
5. **No query (regression)** — existing behavior unchanged, full text returned

## Acceptance criteria

- [ ] `recall` with `query` returns fragments from a single block
  - Run: `npx vitest run app/src/lib/live/plan.test.ts`
  - Expected: test passes — `resolveRecall(store, [code], "validate")` returns `RecallContent.text` containing only matching fragments with context, not the full block text
  - Fails when: full text returned or empty when matches exist

- [ ] `recall` with `query` returns ranked fragments across a group
  - Run: `npx vitest run app/src/lib/live/plan.test.ts`
  - Expected: test passes — group with 3 blocks, query matches in 2, `text` contains snippets from both blocks ranked by relevance
  - Fails when: only one block's matches returned, or results unranked

- [ ] No matches returns empty text, code in `restored` not `missing`
  - Run: `npx vitest run app/src/lib/live/plan.test.ts`
  - Expected: test passes — `text === ""` and code is in `restored[]`, not `missing[]`
  - Fails when: code appears in `missing` or text is non-empty

- [ ] Results capped at 5 fragments
  - Run: `npx vitest run app/src/lib/live/plan.test.ts`
  - Expected: test passes — large group with many matches, snippet count ≤ 5
  - Fails when: more than 5 snippets in text

- [ ] Existing recall tests pass unchanged (no query = full text)
  - Run: `npx vitest run app/src/lib/live/plan.test.ts`
  - Expected: all pre-existing `resolveRecall` tests pass
  - Fails when: any existing test regresses

## Blocked by

- `01-bm25-module.md`
- `02-wire-query-param.md`
