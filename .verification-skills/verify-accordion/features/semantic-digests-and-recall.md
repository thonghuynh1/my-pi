# Semantic Digests & Recall Query

Engine-level features that improve how folded/grouped blocks are summarized
and searched. These are not visual UI features — they operate in the conductor
and engine layer, affecting what agents see in their context.

## Sub-features

- **BM25 search-within-fold** — the `recall` tool accepts an optional `query`
  parameter. When provided, runs BM25 keyword search within the targeted
  block/group and returns only matching fragments (top-5, ±3-line context)
  instead of expanding the full block. Zero-LLM, deterministic, 3-second
  budget. Module: `app/src/lib/engine/bm25.ts`.

- **Semantic group digests** — when the `my-customize-conductor` creates a
  group (rollover or pressure), it calls `buildSemanticDigest()` which
  assembles structured sections from the group's blocks:
  - `[Asks]` — first lines of user messages (6 × 60 chars)
  - `[Files]` — literal file paths from read/write/edit/find/grep/ls tool
    calls (8 paths max)
  - `[Errors]` — first lines of `isError` blocks (3 × 80 chars)
  - `[MCP Index]` — canonical MCP tool identities mapped to recall codes
    (6 identities max)
  
  Empty sections are omitted. Format is multi-line structured text optimized
  for agent greppability and selection.

- **Extractor library** — shared extractors in
  `app/src/lib/engine/extractors.ts`: `extractAsks()`, `extractFiles()`,
  `extractErrors()`, `buildMcpIndex()`, `buildSemanticDigest()`,
  `blockTier()`.

- **Block tier scoring** — `blockTier(block)` classifies any block into
  `"high"`, `"medium"`, or `"low"` structural tiers. Pure deterministic,
  no recency, O(1). Used to gate digest quality in future richer digests
  (ticket 07). Classification:
  - High: edit/write/multiedit, run_tests, isError, bash+test-regex
  - Medium: user messages, plain bash, assistant text, MCP/subagent
  - Low: read, ls, find, grep, generic tool_result, thinking
  
  Graceful degradation: bash blocks with no `text` field default to medium
  (skip test-regex check rather than throwing).

## How to verify (engine-level)

These features have no direct UI surface. Verification is via unit tests:

```bash
# Run the full test suite (includes extractor + BM25 tests)
cd extensions/accordion/app && npx vitest run

# Run only extractor tests
cd extensions/accordion/app && npx vitest run --reporter=verbose extractors

# Run only BM25 tests
cd extensions/accordion/app && npx vitest run --reporter=verbose bm25
```

## Indirect UI verification

When a demo or live session contains grouped blocks, the group digest shown
in the context map and inspector will display the semantic sections instead
of the old "N blocks · turns X–Y" format. To observe:

1. Load demo session
2. Click a group tile in the context map
3. The inspector's group summary should show structured `[Asks]`/`[Files]`
   sections (if the group contains user messages or tool calls)

## Key files

| File | Purpose |
|------|---------|
| `app/src/lib/engine/bm25.ts` | BM25 search implementation |
| `app/src/lib/engine/extractors.ts` | Semantic section extractors + composer |
| `conductors/my-customize-conductor/my-customize-conductor.ts` | Wiring: calls `buildSemanticDigest()` on group creation |
| `extension/accordion.ts` | `recall` tool: threads `query` param to engine |
| `app/src/lib/live/plan.ts` | `resolveRecall`: BM25 branch via `recallText` helper |
| `app/src/lib/live/protocol.ts` | `RecallRequestMessage.query` field |
