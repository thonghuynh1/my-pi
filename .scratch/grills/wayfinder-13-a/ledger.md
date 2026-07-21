> Historical path note: Accordion was later relocated to `extensions/accordion/` and `extensions/accordion/broker/` by `.scratch/accordion-first-party-extension/issues/01-adopt-accordion-as-first-party-extension.md`.

# Grill ledger — wayfinder ticket 13 (Summarizer-LLM choice)

> **ARCHIVED AS HISTORICAL.** Ticket 13 was superseded by ticket 14's α outcome (no LLM broker for group summaries). All open decisions below (D1 fallback, D2 prompt shape, D3 cost/latency budget) evaporated with the LLM itself. Preserved here for provenance; do not resume grilling.

Map: `.scratch/accordion-chunked-compaction/MAP.md`
Ticket: `.scratch/accordion-chunked-compaction/tickets/13-summarizer-llm-choice.md`
Type: `wayfinder:grilling` (HITL)

## Grounding (verified before grill opens)

- **`host.complete(req)` signature** — `{ system?: string, prompt: string, maxOutputTokens?: number, signal?: AbortSignal } → Promise<{ text, model, inputTokens, outputTokens }>`. Source: `F:/MyWork/my-pi/vendor/accordion/docs/conductor-protocol.md` L516; ADR-0013 §L77-82.
- **Conductor cannot pick a model.** Per `conductor-protocol.md` L516: *"specific model id strings are reserved for future use and treated as `current`"*. Model selection lives in `ctx.modelRegistry.getApiKeyAndHeaders(ctx.model)` inside the pi extension (`extension/accordion.ts` L896 area; ADR-0013 §4). Backend-factory questions collapse to "call `host.complete()`; host routes".
- **In-process precedent** — `conductors/compaction-naive/`, `conductors/keel/`, `conductors/bear2-hybrid/`, `conductors/thermocline/` all call `host.complete()` with no provider factory. Only `the-conductor-v2` has factories (Haiku/Ollama/Gemini/OpenAI-compat) because it is an out-of-process WS server; even IT proxies back to the same `host.complete` via `cap/request{complete}`.
- **`can("complete")` gate + async pattern + AbortSignal on detach()** — locked by ADR-0013 §2 (worked example), ADR-0016 constraint 8/10, and ticket-08 findings §1a. All new conductors mirror this shape.
- **Fallback precedents:**
  - `the-conductor-v2` (ticket-08 §1d): silent-skip on error — `.catch` logs, deterministic per-block digest stands in, `pendingSummaryHashes` cleared in `.finally()`, passive retry on next `conduct()`. NO `setStatus`.
  - `compaction-naive` (ADR-0014 §7): visible-wait — when `can("complete") === false` OR summary pending, preserves any existing summary, leaves newly-aged blocks live, `host.setStatus(...)` tells the human it is waiting. Explicitly NOT a silent switch to deterministic grouping.
  - MAP standing preference: group summaries are **immutable once written** — a lower-quality fallback digest committed as a group would freeze forever.

## Decisions

## Session status

**PAUSED** — human surfaced a prior question mid-grill: does the MAP need an LLM broker at all, or is `my-customize-conductor`'s existing deterministic path (per-block `mcpSummary` / `pstackRecallSummary` / `genericRecallSummary` / `toolResultSummary` + engine-default group digest) sufficient? Confirmed with human by re-reading MAP: destination bullet 2, ticket-06 resolution, and ticket-04 D2/D3/D5 all assume broker LLM. Human chose to spawn a new ticket to grill that question rather than resolve it inside 13.

Spawned **ticket 14 — LLM broker necessity: do we actually need an LLM for group summaries?** with the α (no LLM) / β (opportunistic LLM) / γ (LLM-first, MAP-as-written) frame. Ticket 13 now blocked-by 14; grill wayfinder-13-a paused pending 14's resolution.

On 14 outcome:
- **α**: 13 closes as superseded (D1/D2/D3 evaporate). Ledger archived as historical.
- **β**: 13 re-opens with narrowed scope ("when the opportunistic LLM runs, what shape and fallback"). D1 recommendation likely still holds (visible-wait); D2/D3 largely intact.
- **γ**: 13 resumes as originally scoped. All work below stands.

### D1 — Failure fallback on broker error / `can("complete") === false`

status: **paused (deferred to ticket 14 outcome)**

Question posed to human; before pick, human raised the prior α/β/γ question that spawned ticket 14.

Options in play:

- **A. Silent-skip.** On error/no-link: log, do NOT commit the rollover, pre-group keeps growing, passive retry on next `conduct()` pass via cleared `pendingSummaryHashes`. No status surface. Precedent: `the-conductor-v2` §1d.
- **B. Deterministic fallback commit.** On error: synthesise a group digest from concatenated `host.digestOf(id)` outputs and commit anyway. Rollover advances. Downside: MAP immutability freezes the low-fidelity digest forever; ADR-0016 constraint 12 (recoverable) still satisfied.
- **C. Visible-wait (recommended).** On error/no-link: no commit, `host.setStatus("broker unavailable — waiting to roll over N blocks")` + `metrics: { pendingRollover, lastBrokerError }`, passive retry on next `conduct()` when hash clears. Ties `conductor/status` (ticket-04 D3) to failure surface. Never freezes a fallback digest.

Recommended: **C**. Reasons: (1) MAP standing preference "group summaries are immutable once written" makes B's committed low-fidelity digest a permanent tax; (2) `conductor/status` telemetry from ticket-04 D3 is already carrying rollover state and broker latency — failure belongs on the same channel; (3) `pendingSummaryHashes` + `null`-hold + `requestRerun` from ticket-08 §1a already gives passive-retry semantics for free — no new machinery needed.

Sub-nuances to close once the shape lands:
  - Bounded retries? (default: unbounded passive retry; the hash guard prevents duplicate in-flight calls; a runaway broker outage manifests only as static `setStatus`, not tight-loop spend.)
  - What happens when `can("complete")` flips true again mid-outage? (default: next `conduct()` pass fires the call; the pre-group corpus content-hash is unchanged, so if a stale completion for the same hash arrives after `detach()` it is discarded via `AbortSignal`.)

### D2 — Prompt shape (system + prompt content)

status: **queued** (opens after D1 accepted)

Sketch of options (will be refined at ask time):
- P1 — pre-group blocks only (block-kind labels + text, concatenated with a system prompt naming the compaction goal).
- P2 — pre-group blocks + prior group summaries (as prior-context header) — richer context, but non-deterministic across sessions if summaries are regenerated; content-hash MUST still key only on the pre-group corpus (ADR-0016 constraint 9).
- P3 — P2 + map goal / user-declared focus (session-supplied "what matters" hint) — highest fidelity, but adds a per-session config surface.

### D3 — Cost / latency budget knobs

status: **queued** (opens after D2 accepted)

Sketch:
- K1 — hard-coded defaults (e.g. 60 s timeout, `maxOutputTokens: 800`).
- K2 — env-overridable knobs (`ACCORDION_ROLLOVER_TIMEOUT_MS`, `ACCORDION_ROLLOVER_MAX_TOKENS`), mirroring `the-conductor-v2`'s `ACCORDION_SUMMARY_TIMEOUT_MS = 120 s`.
- K3 — accordion-extension setting surfaced in `SettingsPanel.svelte` (like `bear2ApiKey` in ADR-0015).

### D4..D7 — Locked without asking

- **D4 (backend choice)**: **locked A** — call `host.complete()` unmodified; the pi extension's model registry routes. No provider factory in `my-customize-conductor`. Justification: protocol L516 reserves model-id strings for future use; downstream ADRs assume `host.complete()` = single lawful path.
- **D5 (async pattern)**: **locked** — `conduct()` synchronous; on rollover need, check `host.can("complete")`; if in-flight (hash in `pendingSummaryHashes`) return `null`; else stash `AbortController`, `host.complete({ system, prompt, maxOutputTokens, signal })`, return `null`, resolve handler stores result in `groupSummaryCache[contentHash]` then calls `host.requestRerun()`. Mirrors ADR-0013 §2 worked example + ticket-08 §1a.
- **D6 (`AbortSignal` on `detach()`)**: **locked** — `detach()` calls `controller.abort()` on the in-flight `AbortController`; late completions for that `reqId` are silently ignored (ADR-0013 §L208-213). Prevents stale summaries landing after teardown.
- **D7 (where model choice lives)**: **moot** — settled by D4 (nowhere in the conductor).

## Open sub-questions to raise after ticket-close

None yet. If D2 lands on P3, an implementation ticket for "session focus surface" may graduate from MAP fog.
