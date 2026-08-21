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
- [03 — What pi-vcc ranking signals can we port?](wayfinder/03-portable-ranking-signals.md): **All 10 signals are feasible.** `toolName`, `isError`, `tokens`, `order` are first-class fields; tool args and bash commands parseable from `text`.
- [05 — Can we port pi-vcc's BM25 search?](wayfinder/05-bm25-portability.md): **Yes, ~200 lines, self-contained.** But no LICENSE in pi-vcc repo — write clean-room implementation instead.
- [02 — How should search-within-fold work architecturally?](wayfinder/02-search-within-fold-architecture.md): **Extend `recall` with optional `query` param.** BM25 search within the targeted block/group, top-5 fragments in `RecallContent.text`, ±3-line context windows. Wire: add `query?: string` to `RecallRequestMessage` (backward-compatible). No new tool, no new message types, no pagination.

## Not yet specified

- Performance implications of BM25 on large groups (pi-vcc caps at 3 seconds)

## Out of scope

- LLM-based summarization (both pi-vcc and accordion default are zero-LLM; keeping it that way)
- Changes to non-`my-customize-conductor` conductors (builtin, naive-compaction, bear-2, etc.)
- Changes to pi-vcc itself
