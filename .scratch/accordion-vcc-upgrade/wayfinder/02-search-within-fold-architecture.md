# 02 — How should search-within-fold work architecturally?

Type: grilling
Status: resolved
Blocked by: 01

## Question

Today `recall(codes)` returns the **full original content** of folded blocks. pi-vcc's `vcc_recall` supports BM25 keyword search + regex within the raw session data, returning ranked fragments with pagination.

For accordion, search-within-fold could be implemented as:

**Option A — Extend the `recall` tool**: Add a `query` parameter to the existing recall tool. When `query` is provided, search within the specified block(s) and return matching fragments instead of full content.

**Option B — New `search_fold` tool**: Separate tool that takes fold codes + a search query, returns ranked snippets. Keeps recall's semantics clean.

**Option C — Conductor-side index**: The conductor pre-builds a search index when folding. Search queries hit the index without needing to expand the block.

Key sub-questions:
- Where does the original block content live after folding? (extension memory? raw session JSONL like pi-vcc?)
- What wire protocol changes are needed? (new message type vs extending `recallRequest`)
- Should search support pagination like pi-vcc (5 results/page)?

## Answer

**Option A — extend `recall` with optional `query` parameter.**

Search is code-scoped: the agent picks the block/group by fold code, then adds a query to narrow what comes back. The input shape is the same as today's recall (`codes: string[]`) plus an optional `query: string`. A separate tool with identical addressing adds surface area for no gain.

### Resolved sub-questions

1. **Where does content live?** `Block.text` in the GUI store (`types.ts:38` — "Never mutated by folding"). For groups, `resolveRecall` (`plan.ts:204`) joins all member texts. PCC is dead code — out of scope.

2. **Wire protocol changes?** Add `query?: string` to `RecallRequestMessage` (`protocol.ts:214`). Backward-compatible — absent means today's behavior. No new message types, no version bump.

3. **Pagination?** No. Top-5 fragments by BM25 score, capped. Agent already narrowed to one group — corpus is small. Can add pagination later if needed.

### Additional decisions

- **Search algorithm:** Clean-room BM25 (~200 lines). Groups contain multiple blocks — BM25 ranks fragments across members. Substring match can't rank.
- **Result shape:** Reuse `RecallContent.text` for fragments. `text` already means "the content you asked for." No new wire types.
- **Fragment boundary:** ±3 lines context around matching lines, merged if overlapping.
- **No match:** `text` is empty string (block stays in `restored`, not `missing` — the code was found, content just didn't match the query).

### Ledger

Full decision ledger: `.scratch/accordion-vcc-upgrade/ledger.md`
