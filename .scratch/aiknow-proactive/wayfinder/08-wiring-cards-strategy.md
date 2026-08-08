# 08 — Wiring cards storage and generation strategy

Type: grilling
Status: closed (out of scope)

## Question

Feature 6 generates per-file markdown "cards" (~50 tokens vs ~500 for the full file). Decisions:

1. **Storage location**: Global `~/.aiknow/cards/<repo>/` vs repo-local `.aiknow-cards/` (gitignored)?
2. **Generation trigger**: On index build only? On-demand when a card is requested? Incremental (only changed files)?
3. **Card format**: The scratch file proposes `name · kind · span — one-line description`. Should cards include import relationships? Export lists?
4. **Threshold**: Only files with ≥3 symbols get cards. Is that the right threshold, or should it be all indexed files?
5. **Staleness**: When a file changes, is the card invalidated immediately or on next index rebuild?

## Resolution

**Out of scope for v1.** The card use case is already subsumed by Features 2 + 3:

- **Codebase map (F2)** provides query-free directory-level browsing
- **aiknow_search (F3)** returns `file:line — Symbol (kind)` — the same data a card would contain, ranked by relevance

Cards would only add value if agents are still burning tokens on "what's in this file?" reads after the map + search are live. Defer to post-launch benchmark evidence; if the gap exists, cards become a data-driven addition with known implementation path (render from existing `nodes` table, ~15 LOC).
