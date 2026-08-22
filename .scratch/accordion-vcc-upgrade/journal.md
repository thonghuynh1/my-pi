# Accordion VCC Upgrade — Journal

## Slice 1 — Search-within-fold (BM25 + recall query)

### What was built
- [01-bm25-module](issues/01-bm25-module.md): ✅ Built — clean-room BM25 search module (`bm25.ts`, 110 lines), pure function, zero deps, 3s budget, ±3-line context windows, top-5 cap. All 5 AC met on first attempt.
- [02-wire-query-param](issues/02-wire-query-param.md): ✅ Built — `query?: string` added to `RecallRequestMessage` in protocol.ts, threaded through tool schema and `requestRecall` in accordion.ts. All 4 AC met on first attempt.
- [03-recall-query-integration](issues/03-recall-query-integration.md): ✅ Built — `resolveRecall` in plan.ts now accepts optional `query`, calls `searchBlocks()` over block/group texts, returns joined snippets. WebSocket handler threads `msg.query`. All 5 AC met on second attempt (first attempt verifier-rejected, likely a wiring issue).

### What surprised us
- Issue 03 needed two attempts — the first was verifier-rejected. Not a design problem; the architecture (Option A from ticket 02) worked exactly as specified once the integration was wired correctly.
- The `recallText` helper function emerged as a clean abstraction not explicitly called out in the design — it encapsulates the "full text vs BM25 fragments" branch in one place, used by all three recall paths (group, chunked-compaction member, standalone block).

### What we learned
- Decision 02 (extend recall with query) was confirmed end-to-end. No new wire types, no new tools, backward-compatible — the architecture was right.
- Decision 05 (clean-room BM25) was confirmed — 110 lines, self-contained, no licensing concern.
- The `proactiveCompress.resolveOriginals` path also needed `query` threading — a seam not explicitly called out in the issue specs but handled correctly by the implementation.

### Map updates
- Closed: [02 — search-within-fold architecture](wayfinder/02-search-within-fold-architecture.md) — confirmed by build; Option A works, all wire/tool/integration changes landed
- Closed: [05 — BM25 portability](wayfinder/05-bm25-portability.md) — confirmed by build; clean-room ~110 lines, self-contained
