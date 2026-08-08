# 07 — Acceptance criteria and benchmark targets

Type: grilling
Status: resolved
Blocked by: 02

## Question

The scratch file proposes hard targets: ≥-30% tokens vs baseline, ≥7.5/8 quality, ≤15 avg tool calls. Questions:

1. **Are these hard gates or aspirational?** If the implementation hits -28% and 7.4/8, does it ship?
2. **Per-scenario targets**: The benchmark has 7 prompts across different task types. Should the PRD set per-type targets (e.g., "architecture questions must improve ≥1 quality point") or only aggregate?
3. **Regression guard**: Should there be a "no scenario gets worse" constraint, or is aggregate improvement sufficient?
4. **A/B gating variable**: `AIKNOW_PROACTIVE=0` — is env var the right mechanism, or should it be a Pi config setting that persists across sessions?

## Answer

**Acceptance criteria cover code correctness only; benchmark performance is human-judged.**

1. **Hard gates, human-owned** — The targets (≥−30% tokens, ≥7.5/8 quality, ≤15 tool calls) are reference numbers for the human reviewer. They are NOT implementation acceptance criteria — the human runs the benchmark and judges the results.
2. **Per-scenario vs aggregate** — Human judgment; not in the AC.
3. **Regression guard** — Human judgment; not in the AC.
4. **`AIKNOW_PROACTIVE=0` env var** — Keep it. The AC says: code must check this var and disable all proactive injection when set to `0`.

**What the PRD's AC should gate (code correctness):**
- Each feature works as specified (hook fires, map generates, ranking returns results, nudges trigger)
- `AIKNOW_PROACTIVE=0` disables all proactive injection
- Silent skip on unindexed repos
- Benchmark targets remain in the PRD as reference context for the human reviewer, not as automated gates
