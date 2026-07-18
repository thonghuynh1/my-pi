# Grill Ledger — Ticket 05 (Cache-invalidation accounting)

Status legend: `accepted` | `provisional` | `superseded` | `open`

## Candidate material decisions

- D1 **Break-even model shape** — `accepted` (A)
  - **A: reuse ticket-03 gate `≥ max(2_000, 0.05*cap)` unchanged; T03's gate IS the break-even rule.** ADR carries the amortisation prose (~14.5 k saved vs ~2 k penalty at 10× on the tail) as its justification, but names no new symbol.
  - B: explicit `expected_future_requests × tokens_saved > digest_cost + kv_break_penalty` — rejected: `expected_future_requests` isn't observable at trigger time, would force plumbing already ruled out by T04 D6.
  - C: instrument-first — rejected: defers material decisions past the map boundary.
  - Consequence: pre-answers D4 (provider-agnostic v1 — gate is provider-agnostic and Anthropic dominates); collapses D2 to "no plumbing" (policy doesn't consult observed hit rate).

- D2 **Observed prefix-match rate surfacing to conductor** — `accepted` (A)
  - A: no plumbing; conductor uses only `view.frozenFromIndex`; observed rates stay in existing JSONL + sync-frame paths.
  - Rationale: with D1=A, policy doesn't consult observed hit rate, so B (protocol change) is unmotivated and already ruled out by T04 D6.

- D3 **Diagnostic metric surface — where and what** — `accepted` (C)
  - **C: both.** `conductor/status` emitted every `conduct()` pass with `{ preGroupTokens, preGroupFillPct, rolloverCount, tokensSavedByRollover, lastEstimatedGroupSaving, breakFrozenCount }` + human `text` for the live extension badge. Extension appends `chunkedCompaction` block to per-turn JSONL on rollover turns: `{ event: "rollover", preGroupTokensBefore, preGroupBlockCount, preGroupTurnRange, digestTokens, estimatedGroupSaving, frozenFromIndexBefore, frozenFromIndexAfter, cacheTrackerReasonBefore, cacheTrackerReasonAfter, digestContentHash }`.
  - **JSONL record authored by extension**, not the conductor — conductor stays JSONL-oblivious, no new upward channel, respects T04 D6.
  - `my-customize-conductor` gains its first `attach(host)` implementation.
  - Consequence: pins D5 to B (grep on JSONL is the named verification seam).

- D4 **Provider-specific rules** — `accepted` (A)
  - A: provider-agnostic v1 (Anthropic-tuned; same policy everywhere). Per-provider tuning deferred to a future map.
  - Rationale: D1=A commits to the T03 gate as the whole policy; the gate has no provider-specific inputs. Codebase already delegates all cache-cost math to Pi SDK.

- D5 **Verification surface for "≤1 KV-break per rollover"** — `accepted` (B, inherited from D3=C)
  - **B: JSONL-grep static replay.** ADR names as its verification claim: over any session's JSONL, `count(chunkedCompaction.event == "rollover") == count(cacheDiagnostics.reason == "prefix-mismatch") − coldStartCount`, where `coldStartCount ≤ 1` per session. Any deviation is a bug in the conductor or the extension.
  - Unit tests on the conductor emission shape remain an implementer choice — not prescribed at ADR level.
  - **Cold-start caveat**: the invariant excludes the initial cold-start break (a legitimate session-start break, not caused by a rollover). ADR must state this explicitly.

## Ordering rationale

D1 is upstream of D3 and D4 (shape of "the math" decides what we log and whether providers matter). D2 is nearly foreclosed by T04 D6 but the ticket explicitly asks it. D5 is normatively required by the destination but its shape depends on D3.

**Highest-risk unresolved:** D1. Ask first.

## Turn log

- Turn 1: D1 asked. User: "A look correct". → D1 = A `accepted`. D2 and D4 collapse to A `provisional` (foreclosed).
- Turn 2: D3 asked (metric surface). User: "can we have prototype for this". → built markdown mock; sub-decision surfaced (extension owns JSONL record).
- Turn 3: user: "yeah option C looking good". → D3 = C `accepted`. D5 inherits as B `accepted` (grep on JSONL). D2 and D4 promote from `provisional` to `accepted` (no further changes surfaced).
- Turn 4 (pending): present compact handoff to user; on confirm, close the ticket and update the map.
