---
labels: wayfinder:grilling
status: wontfix
claimed_by: pi-agent (grill session wayfinder-13-a — archived as historical)
map: ../MAP.md
blocks: [01-destination-shape, 14-llm-necessity-for-group-summaries]
superseded_by: 14-llm-necessity-for-group-summaries
---

# Summarizer LLM choice

> **Superseded by ticket 14 (α outcome: no LLM broker for group summaries).** All open sub-questions on this ticket presupposed an LLM at rollover; α removes that premise. D1 (fallback), D2 (prompt shape), D3 (cost/latency budget), and the async-pattern lock all evaporate. Grill ledger at `.scratch/grills/wayfinder-13-a/ledger.md` archived as historical.

## Question (historical)

`MyCustomizeConductor` currently makes **no** LLM calls (all summaries are deterministic templates). Chunked compaction adds one LLM call per rollover to produce the immutable group summary. This ticket resolves the summarizer-LLM design; broker-dashboard integration (mode targeting, dashboard surfacing) lives on ticket 04.

Open questions:

- **Backend(s) in v1** — Ollama, Haiku, Gemini, or all three via a strategy factory (like `the-conductor-v2/strategy.ts`)? Or none of the above — just call `host.complete()` and let the accordion host route to whatever provider is configured?
- **Where the model choice lives** — conductor constructor arg, accordion extension setting, user-visible per-session config?
- **Async pattern**: `attach(host)` + `host.can("complete")` gate + `host.complete()` + return `null` while pending + `host.requestRerun()` on completion (per ADR-0016 + ticket 08 §1a). Confirm and lock, or propose an alternative.
- **Prompt shape**: what goes in — serialized pre-group blocks only, or also prior group summaries as context, the map's goal/notes, a user-supplied focus?
- **Failure fallback** on broker error: fall back to per-block deterministic digests (roll over anyway with lower quality), or silent-skip (don't roll over, hold last batch, passive retry)?
- **Cost/latency budget**: soft ceilings per rollover (timeout, `maxOutputTokens`)? Env-overridable knobs or hard-coded?
- **`AbortSignal`** on `host.complete()` — wire through `detach()` to prevent stale summaries landing after teardown?

Ticket 08 §1a-d, ticket 09 constraints 6/8/9/10, and ADR-0016 primitives constrain several of these. This ticket confirms which upstream defaults we accept vs override.

Can resolve in parallel with 02/03/04/06 once 01 is settled.
