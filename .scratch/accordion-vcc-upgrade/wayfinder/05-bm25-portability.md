# 05 — Can we port pi-vcc's BM25 search implementation?

Type: research
Status: resolved

## Question

pi-vcc implements BM25 search in `src/core/search-entries.ts` with:
- IDF weighting, stop-word filtering, term-frequency saturation with length normalization
- Regex fallback on empty results
- 5 results/page pagination
- `mode:'touched'` for file-ops aggregation
- `#N:path` drill-down for specific entry content
- 3-second wall-clock safety budget

**Can this implementation be adapted for accordion?** Specifically:
- What's the data shape difference? (pi-vcc searches raw JSONL session entries; accordion would search stored block content)
- Is the BM25 implementation self-contained enough to extract as a module?
- What's the storage model? (accordion's `proactiveCompress` already stores originals — can we piggyback on that?)
- License compatibility (pi-vcc license vs accordion)?

Review `src/core/search-entries.ts` and `src/tools/recall.ts` in pi-vcc for extractability.

## Answer

**Yes — highly portable.** Key findings:

- **~200 lines** for the BM25+regex search core (self-contained)
- **Zero runtime pi SDK dependency** — only type-level imports
- **3 pure utility functions** from `content.ts` are the only runtime deps
- `mode:touched` and `#N:path` drill-down are separate exported functions — can be dropped
- 3-second timeout is plain `Date.now()` — trivially portable
- **⚠️ No LICENSE file in repo** — BM25 core has no attribution. Need to write our own implementation inspired by the approach, or contact author.

**Recommended:** Write a clean-room BM25 module (~200 lines) inspired by pi-vcc's approach, adapted to accordion's `Block` type instead of `RenderedEntry`/`Message`. No direct copy due to license ambiguity.
