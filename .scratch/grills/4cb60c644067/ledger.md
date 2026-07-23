# Ledger — Pre-Group Fold Exemption

## Requirement (raw)

> "In my-customize-conductor, should pre-group blocks be exempt from individual folding? When a block exits the tail and enters pre-group, instead of folding it individually (which invalidates the cache), leave it unfolded until the pre-group accumulates enough tokens, then group+fold all blocks at once — invalidating the cache only once."

## Decisions

| # | Decision | Status | Rationale | Dependencies |
|---|----------|--------|-----------|--------------|
| D1 | Should pre-group blocks be exempt from individual fold/replace? | accepted | Unconditional exemption. In steady state, zero other candidates exist. One cache break per rollover cycle instead of N+1. Budget overshoot bounded at ~7k (well under hard cap). Faster rollovers (full tokens accumulate). Better digest quality (unfolded content). | — |
| D2 | What happens under budget pressure before rollover threshold? | accepted | No candidates in steady state (group summaries grouped, user/tool_call not foldable, tail protected). Conductor returns `[]`. accordion.ts skips applyPlan. Prefix stable. liveTokens exceeds soft cap by ~7k max — 35k headroom to hard cap on 128k. Self-correcting: fuller pre-group → sooner rollover. | D1 |
| D3 | Does the rollover invariant (`rollover == cacheBreaks - coldStarts`) hold? | accepted | Simplifies — becomes trivially true. Only rollovers change the prefix. Rare MCP replaces in the gap are stabilized by epoch hold (one extra break, not per-turn). | D1 |
| D4 | Does epoch hold (HOLD_BAND) interact with deferred folding? | accepted | When conductor returns `[]`, accordion.ts skips applyPlan entirely (no cacheTracker.observeMessages). The epoch hold mechanism is bypassed — there's no plan to hold. On turns where MCP replaces are the only action, the epoch hold stabilizes them normally. | D1, D2 |
| D5 | MCP/recall results in the gap | accepted (default) | Still fold candidates. Replaced once per rollover cycle, then stabilized by epoch hold. At most 1 extra cache break. Rare in practice — most are grouped by earlier rollovers. | D1 |
| D6 | Hold-last-plan safety net in accordion.ts | accepted (default) | Fires at contextWindow − 8192. Peak liveTokens (~77k in the 70k/128k scenario) never approaches trigger (~120k). Not a concern. | D2 |
| D7 | Small context windows (<128k) | accepted (default) | Chunked compaction disables itself via MIN_CONTEXT_WINDOW_FOR_CHUNKED_COMPACTION. preGroupTarget = 0. Exemption filter is a no-op. | D1 |

## Phase: consumed
## PRD: `.scratch/pre-group-fold-exemption/PRD.md`
