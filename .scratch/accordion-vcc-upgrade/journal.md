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

## Slice 2 — Semantic group digests (extractors + MCP index + composer + conductor wiring)

### What was built
- [04-extractor-module](issues/04-extractor-module.md): ✅ Built (2 attempts) — `extractAsks()`, `extractFiles()`, `extractErrors()` in `extractors.ts`. Deduped, capped, truncated per spec. All 4 AC met.
- [05-mcp-retrieval-index](issues/05-mcp-retrieval-index.md): ✅ Built (1 attempt) — `buildMcpIndex()` maps canonical MCP identities to recall codes. Capped at 6 identities. All 4 AC met.
- [06-digest-composer](issues/06-digest-composer.md): ✅ Built (2 attempts) — `buildSemanticDigest()` assembles sections with headers, omits empties. Multi-line structured format. All 4 AC met.
- [07-conductor-wiring](issues/07-conductor-wiring.md): ✅ Built (1 attempt) — `my-customize-conductor` calls `buildSemanticDigest()` on both `createGroup()` (rollover) and `createDefaultGroup()` (pressure) paths. Digest passed as `GroupCommand.digest`. All 5 AC met.

### User adjustments
- None. All commits are automated (ralph + reviewer).

### What surprised us
- Issues 04 and 06 each failed verifier on first attempt, then passed on second. Same pattern as Slice 1's issue 03 — integration wiring is the common failure mode, not architecture.
- The reviewer added a `lifecycle` field to the conductor contract and hardened the fold-tag seam in `store.svelte.ts` — scope creep, but correct (fold tag ownership is authoritatively engine-side, not conductor-side).
- Review phase cost ($8.35 of $9.47 total) dominated the run — gpt-5.6-sol is expensive for review.

### What we learned
- Decision 04 (semantic sections) confirmed end-to-end: Asks/Files/Errors/MCP Index extracted independently per group, no cross-group accumulation, empty sections omitted.
- The flat-group architectural invariant held without friction — extractors naturally scope to a single group's blocks.
- The reviewer's hardening pass (29 new conductor tests, 35 extractor tests) significantly improved coverage. Future slices start from a stronger test baseline.

### Map updates
- Closed: [04 — group semantic sections](wayfinder/04-group-semantic-sections.md) — confirmed by build; all extractors + composer + wiring landed
- Closed: [03 — portable ranking signals](wayfinder/03-portable-ranking-signals.md) — signals used by extractors (toolName, isError, text parsing) confirmed feasible in practice
- New ticket: [06 — per-block ranking scores](wayfinder/06-per-block-ranking-scores.md) — how to compute weighted scores per block for fold priority + digest quality
- New ticket: [07 — richer fold digests](wayfinder/07-richer-fold-digests.md) — structured per-block-type summaries via ReplaceCommand, gated by ranking score
- Fog resolved: BM25 performance on large groups — 3-second budget already baked in, confirmed working on 806-block group in demo session

## Slice 3 — Block tier scoring function

### What was built
- [08-block-tier-function](issues/08-block-tier-function.md): ✅ Built (1 attempt) — `blockTier()` exported from `extractors.ts`, classifies blocks into High/Medium/Low tiers. 38 tests pass. All 4 AC met on first attempt.

### User adjustments
- `229fd78` review: simplify block tier fallback — removed dead `LOW_TIER_TOOLS` set and explicit low-tier check. Tools in that set (read, find, grep, ls) already fell through to the default `return "low"`. Pure dead-code removal, no behavior change. Classified as: **fix** (cleanup).

### What surprised us
- Nothing. Smallest slice so far — single function, single file, single test describe block. First-attempt pass. Ralph cost only $2.11 (review dominated at $2.04 via gpt-5.6-sol).

### What we learned
- The tier model (3 discrete tiers vs continuous weights) was the right call for this stage — trivial to implement, test, and reason about. If ticket 07 reveals we need finer gradation, tiers can be graduated to a score later without breaking the interface.
- `ExtractableBlock` interface proved sufficient for scoring without modification — no new fields needed.

### Map updates
- Closed: [06 — per-block ranking scores](wayfinder/06-per-block-ranking-scores.md) — confirmed by build; `blockTier()` implements D14–D18, all AC met
- Unblocked: [07 — richer fold digests](wayfinder/07-richer-fold-digests.md) — now unblocked, ready for next slice
