# 06 — How should per-block ranking scores be computed?

Type: grilling
Status: closed
Blocked by: 01, 03 (both resolved)
Resolution: 3 structural tiers (High/Medium/Low). No recency, no fold-order change, no search boost. Score gates digest quality only. `blockTier()` in `extractors.ts`.

## Question

Decision 01 confirmed the conductor sees all data. Decision 03 confirmed all 10 pi-vcc ranking signals are feasible. But **how should the conductor actually compute a score per block** to decide fold priority and digest quality?

Pi-vcc's `rank.ts` uses a weighted additive scoring model:

| Signal | Weight | Source |
|--------|--------|--------|
| edit tool call | +34 | toolName === 'edit' |
| test command (npm test, vitest, pytest, etc.) | +26 | bash content regex |
| file path present | +18 | text contains path-like strings |
| non-zero exit / isError | +24 | isError flag |
| bash command | +12 | toolName === 'bash' |
| recency (position-based decay) | variable | order field |
| token size (large = more valuable) | variable | tokens field |
| user message (question/instruction) | +20 | kind === 'user' |
| assistant with tool_use | +16 | kind === 'assistant' + has tool calls |
| MCP/subagent call | +14 | toolName matches pattern |

### Sub-questions

1. **Do we use the same additive weights, or a different model?** pi-vcc tuned these for session-level context; accordion folds within a conversation turn window. Does that change the ranking?

2. **Where does the score live?** Is it ephemeral (recomputed every conduct cycle) or cached on the ViewBlock? If cached, what invalidates it?

3. **Does recency need special treatment?** Accordion's `order` field is absolute position. pi-vcc uses relative recency (distance from cursor). Should we normalize?

4. **What's the score threshold for "worth a rich digest"?** Low-scoring blocks (e.g., a simple `ls` output) might not benefit from structured extraction — just truncate. High-scoring blocks (test failures, edits) deserve rich digests. Where's the line?

5. **Should ranking influence fold ORDER (what gets folded first) or just digest QUALITY?** Currently `my-customize-conductor` folds oldest-first. Should low-ranked blocks fold before high-ranked regardless of age?

## Constraints

- Zero-LLM — scoring must be pure deterministic computation
- Must not regress conductor performance (scoring 1000+ blocks per conduct cycle)
- Scores are internal — never shown to the user, only used for fold decisions and digest quality tiers
