---
labels: wayfinder:research
status: done
map: ../MAP.md
blocks: []
findings: ./09-findings.md
---

# Read accordion ADRs 0007 / 0008 / 0010 / 0016 for protocol + cache-warmth rationale

## Question

Digest the following ADRs (path: `F:/MyWork/my-pi/vendor/accordion/docs/adr/`) and produce a findings note that pulls out anything that constrains or informs a chunked-compaction design:

- ADR 0007 / 0008 — conductor protocol tables (`ConductorView`, `Command` shapes, host capabilities).
- ADR 0010 — attention-folder / epoch-based folding, cache-stability rationale.
- ADR 0016 — code-skeleton, precision-gating and cache-warmth rationale.

Also check `docs/conductor-protocol.md` for anything the ADRs don't cover.

Deliverable: bullet notes per ADR, plus an explicit list of "constraints this places on chunked compaction" and "hooks / primitives available for reuse". Link back to this ticket.

## Resolution

Findings written to `./09-findings.md`. Top-5 hard constraints on chunked compaction: (1) full-state batch re-sent every `conduct()`; (2) `view.liveTokens` is the cleared baseline — self-track applied folds like ADR 0010's `appliedFoldSet`; (3) group summaries must use `group(digest: <text>)` with non-null string (DROP is irreversible); (4) `messageKey`-aligned contiguous groups only, `tool_call` never foldable; (5) broker LLM output must be cached by content-hash of pre-group corpus, else non-determinism breaks the frozen prefix. ADR 0010 (Attention Conductor's hysteresis-band + monotonic-fold-set epoch pattern) is the closest precedent for "≤1 cache miss per rollover".
