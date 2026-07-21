---
labels: wayfinder:research
status: done
map: ../MAP.md
blocks: []
findings: ./08-findings.md
---

# Survey the-conductor-v2 and code-skeleton for reusable LLM + digest patterns

## Question

Extract patterns from existing shipped conductors that we should reuse or explicitly diverge from:

- `F:/MyWork/my-pi/extensions/accordion/conductors/the-conductor-v2/` — how does it wire `attach(host)` + `host.complete()`, cache summaries, dedupe in-flight work, and handle broker errors? Which parts are `strategy.ts`-swappable and which are baked in?
- `F:/MyWork/my-pi/extensions/accordion/conductors/code-skeleton/` — how are deterministic digests keyed and cached to keep the prefix warm? What's the recovery / recall story for skeletonized blocks?

Deliverable: a short (~1 page) findings note listing concrete file/line references, reusable primitives (function names, host-API calls), and gotchas. Save on a throwaway `research/accordion-chunked-compaction-08` branch or as a comment on this ticket if the agent can't branch. Link the findings from this ticket before closing.

## Resolution

Findings written to `./08-findings.md`. Summary: reuse the `contentHash` cache key + `pendingSummaryHashes` dedup + silent-skip fallback + `onSummary`→re-plan pattern from `the-conductor-v2/strategy.ts`. Reuse `ReplaceCommand.recoverable: true` from `code-skeleton`. Diverge on cache key (hash the pre-group corpus, not per-block), keep a separate never-pruned `groupSummaryCache`, use in-process `host.complete()` gated by `host.can("complete")`. Key gotcha: `pruneEmbeddingCache` is misnamed and also prunes `summaryCache` — do not pass a group-summary cache to it.
