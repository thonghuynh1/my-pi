# 05 — File ranking confidence and presentation

Type: grilling
Status: resolved

## Question

Feature 2 wraps existing `runSearch()` in pointer mode. Decisions needed:

1. **Confidence thresholds**: The scratch file proposes `spread = (top - last) / top` with <0.15 → low, ≥0.4 → high. Is this the right formula? Should low-confidence results be suppressed entirely or shown with a warning?
2. **Result count**: Fixed 8 results, or adaptive (fewer when confidence is high, more when low)?
3. **What to show**: Just file:line + symbol name (like the scratch file), or include a one-line description?
4. **Query too short**: What if the user prompt is "fix the bug" with no specific terms? Skip ranking or attempt it anyway?
5. **Interaction with reactive search**: If proactive ranking already pointed at the right files, should the agent's subsequent `aiknow_search` call be aware of this (to avoid redundant work)?

## Answer

1. **Confidence thresholds**: Keep the `spread = (top - last) / top` formula with <0.15 → low, 0.15–0.39 → medium, ≥0.4 → high. Always show all results with the confidence label in the header — never suppress. The label communicates trust level; the disclaimer note provides the safety net.

2. **Result count**: Fixed 8 results. No adaptive sizing. ~200 tokens is negligible; the confidence label already signals trustworthiness without needing a second knob. Adaptive is a benchmark-driven tuning decision for later.

3. **What to show**: `file:line — Symbol (kind)` format. Line number provides jump-to precision within multi-export files; symbol name anchors reasoning; kind (interface/function/class) disambiguates same-named exports and helps the agent prioritize without opening files. Already produced naturally by pointer mode — no extra plumbing.

4. **Query too short**: Always attempt ranking. The spread formula is itself the quality gate — vague queries produce flat scores → low confidence label → agent self-calibrates. No separate "too vague" heuristic needed. Avoids false-negative gating and silent feature failures.

5. **Interaction with reactive search**: No programmatic coupling in v1. Proactive results are in the system prompt — the agent already sees them when deciding whether to call `aiknow_search`. Coupling would require new parameters and conditional logic for a gain not yet measured. Benchmark will show whether redundant searches happen; if they do, that's a prompting fix first, architecture fix second.
