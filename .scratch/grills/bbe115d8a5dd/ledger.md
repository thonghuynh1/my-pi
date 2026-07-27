# Grill Ledger — Pre-group zone reliability

**Requirement**: Fix two issues with the Accordion conductor's pre-group zone in `my-customize-conductor`:
1. Blocks that fall within the pre-group zone should never appear folded in the UI
2. The chunked compaction rollover should fire more consistently near the 15k token target

## Decisions

| # | Decision | Status | Rationale | Depends on |
|---|----------|--------|-----------|------------|
| 1 | Decouple accumulation boundary from grouping boundary | accepted | Pre-group walk uses relaxed boundary (only held/grouped/proactivelyCompressed stop it); grouping boundary (`isGroupBoundary`) stays strict for suffix grouping. Allows zone to reliably reach ~15k across user/MCP/recall/pstack blocks. | — |
| 2 | Early rollover under budget pressure | accepted | When liveTokens > cap and folding non-pre-group candidates isn't enough, fire rollover on whatever the pre-group zone has (must pass minSaving). With the relaxed accumulation boundary this becomes the primary budget relief mechanism, not a rare fallback. | 1 |
| 3 | Grouping user/tool_call blocks is safe | accepted | ADR 0006 explicitly allows groups to include non-foldable kinds. wireFoldable gate blocks individual folds only. trimOpenToolPairs prevents orphaned pairs. Current-turn trimming protects active exchange. Recall preserves full access. Same mechanism as existing 15k rollover. | — |
| 4 | Early rollover inserts after step 4 (fold candidates) | accepted | After exhausting non-pre-group candidates, the natural next step is processing the pre-group zone. Suffix grouping (step 5) fragments at user/MCP and produces tiny groups; the early rollover via selectCompactionRange produces a single better group. | 2 |

## Superseded / closed questions

- ~~Should the pre-group walk cross group boundaries?~~ → Decision 1
- ~~What happens when pre-group can't reach 15k?~~ → Decision 2
- ~~Does grouping non-foldable kinds break model behavior?~~ → Decision 3
- ~~Where does the early rollover go in conduct()?~~ → Decision 4

## Unresolved gaps

None

## Status

**Consumed** — PRD published to `.scratch/pre-group-reliability/PRD.md`
