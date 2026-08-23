# Wayfinder Map: Accordion VCC-Inspired Upgrade

Label: wayfinder:map

## Destination

Upgrade the `my-customize-conductor` accordion extension with pi-vcc's context summarization techniques so that:

1. **Richer fold digests** — folded blocks get ranked, semantically-aware summaries (not just first-120-chars truncation) using pi-vcc's signal scoring and structured extraction
2. **Search-within-fold** — a new `recall` mode that runs BM25/keyword search inside a folded block and returns only matching fragments, instead of expanding the entire block
3. **Smarter group digests** — group blocks get accumulated semantic sections (files touched, goals, outstanding context) instead of just "N blocks · turns X–Y"

The conductor is `my-customize-conductor` (the default). Changes touch the conductor, the digest layer, and the recall tool.

## Notes

- Domain: pi extension development (TypeScript)
- Key repos: `C:\my-pi\extensions\accordion` (target), `C:\Users\920287\.opensrc\repos\github.com\sting8k\pi-vcc\master` (reference)
- pi-vcc is zero-LLM, deterministic — same constraint applies here
- Accordion's digest lives in `app/src/lib/engine/digest.ts`; recall tool in `extension/accordion.ts`
- The conductor contract: `conduct(view) → Command[]` with `FoldCommand | ReplaceCommand | GroupCommand`
- `ReplaceCommand` already exists and is used for MCP summaries — this is the mechanism for richer digests
- pi-vcc's key files: `src/core/rank.ts` (scoring), `src/core/brief.ts` (compression), `src/core/summarize.ts` (pipeline), `src/core/search-entries.ts` (BM25 search), `src/extract/*.ts` (semantic sections)

## Decisions so far

- [01 — What data does the conductor actually see per block?](wayfinder/01-conductor-view-data.md): **Conductor sees everything** — `ViewBlock.text` (full content), `toolName`, `isError`, `callId`, `tokens`, `order`. Ranking/scoring lives in the conductor; richer digests delivered via `ReplaceCommand`.
- [03 — What pi-vcc ranking signals can we port?](wayfinder/03-portable-ranking-signals.md): **All 10 signals are feasible.** `toolName`, `isError`, `tokens`, `order` are first-class fields; tool args and bash commands parseable from `text`. ✅ *Confirmed by slice 2 build* — signals used by extractors (toolName, isError, text parsing) work in practice.
- [05 — Can we port pi-vcc's BM25 search?](wayfinder/05-bm25-portability.md): **Yes, ~110 lines clean-room, self-contained.** ✅ *Confirmed by slice 1 build* — `bm25.ts` landed, all tests pass.
- [02 — How should search-within-fold work architecturally?](wayfinder/02-search-within-fold-architecture.md): **Extend `recall` with optional `query` param.** ✅ *Confirmed by slice 1 build* — BM25 search within the targeted block/group, top-5 fragments in `RecallContent.text`, ±3-line context windows. Wire: `query?: string` on `RecallRequestMessage` (backward-compatible). No new tool, no new message types, no pagination. `recallText` helper abstracts the branch.

- [04 — How should group digests accumulate semantic sections?](wayfinder/04-group-semantic-sections.md): **Three sections (Asks, Files, Errors) + MCP Retrieval Index.** Shared library, conductor-invoked. Self-contained per group (flat invariant). Always extracted, empty sections omitted. Multi-line structured format for agent selection. ✅ *Confirmed by slice 2 build* — extractors, composer, and conductor wiring all landed.

- [06 — How should per-block ranking scores be computed?](wayfinder/06-per-block-ranking-scores.md): **3 structural tiers (High/Medium/Low), no recency, no fold-order change, no search boost.** Score gates digest quality only. `blockTier()` in `extractors.ts`. High = edit/write/multiedit, run_tests, isError, bash+test-regex. Medium = user, bash, assistant, MCP/subagent. Low = read, ls, find, grep, generic tool_result, thinking. ✅ *Confirmed by slice 3 build* — `blockTier()` implemented, 38 tests pass, all AC met.
- [07 — How should richer individual fold digests work?](wayfinder/07-richer-fold-digests.md): **Resolved.** Conductor-side `block-digest.ts`, pre-computed cache (50/pass amortized), 6 rich templates (read, subagent, isError, text, thinking, mcp), engine fallback for the rest. Paired lookup for read+subagent. Upgrade pass after cold-start catch-up. ✅ *Confirmed by slice 4 build* — `block-digest.ts` + conductor wiring landed, all AC met, `foldOrReplace` helper extracted by reviewer.
- [08 — Should Proactive Content Compression be removed?](wayfinder/08-remove-pcc.md): **Resolved — remove PCC entirely.** PCC is structurally dead (`mcp` exclusion blocks all MCP-routed tools, never fires in practice). Clean deletion, no migration. Conductor's richer digests + hard-cap `breakFrozen` cover the theoretical gap. `"proactively-compressed"` removed from `ClampReason`. ✅ *Confirmed by slice 5 build* — PCC module, types, guards, and UI fully deleted. Zero references remain.

## Not yet specified

- *(None — all questions resolved)*

## Out of scope

- LLM-based summarization (both pi-vcc and accordion default are zero-LLM; keeping it that way)
- Changes to non-`my-customize-conductor` conductors (builtin, naive-compaction, bear-2, etc.)
- Changes to pi-vcc itself
