# 06 — Escalation nudge triggers and wording

Type: grilling
Status: resolved

## Question

Feature 5 appends hints when `aiknow_search` returns thin results. Decisions:

1. **Threshold**: ≤2 results triggers the nudge. Is this the right number? Should it also trigger on low-confidence results (high result count but all low-scored)?
2. **Wording**: Should nudges be prescriptive ("try: grep -r ...") or suggestive ("consider using grep for literal matches")? The former trains agents better but might confuse human readers of logs.
3. **Zero results**: The scratch file distinguishes 0 vs ≤2. Should 0-result nudges mention that the file might be unindexed, or that the query terms might not match indexed symbols?
4. **Interaction with proactive injection**: If the proactive map already pointed the agent at the right area, should nudges reference that ("the codebase map showed X — try reading it directly")?

## Answer

1. **Threshold: ≤2 only.** Single count-based trigger. No confidence-based second path — keep it simple.
2. **Wording: Prescriptive.** Direct commands (`try: grep -r ...`). The consumer is an LLM agent; explicit tool suggestions work better. Matches Pi's existing system prompt tone and Graft's proven style.
3. **Zero results: Mention unindexed + show the search term.** Template: `[aiknow] No indexed results for "<term>". Try grep, or the symbol may be in an unindexed file.` Interpolating the term so the agent can copy it directly into grep.
4. **No cross-referencing with proactive map.** Nudges are fully self-contained. The map is already in the system prompt; the agent connects the dots itself. Keeps features independently shippable and avoids coupling/state tracking.
