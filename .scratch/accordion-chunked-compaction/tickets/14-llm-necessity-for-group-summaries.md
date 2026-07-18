---
labels: wayfinder:grilling
status: done
claimed_by: pi-agent (grill session wayfinder-14-a)
map: ../MAP.md
blocks: [01-destination-shape]
---

# LLM broker necessity: do we actually need an LLM for group summaries?

## Resolution

**D1 accepted: α — no LLM.** Group digests are deterministic pure functions of the pre-group corpus (structural core per engine default + recovery-codes footer per ticket 06 §2). `host.complete()` is not called anywhere in `my-customize-conductor`. The conductor stays synchronous.

### Load-bearing grounding

1. The deterministic per-block path in `my-customize-conductor` is already unusually rich: every foldable `tool_result` gets an identity-preserving structured `replace` via `mcpSummary` / `pstackRecallSummary` / `genericRecallSummary` / `toolResultSummary` (see grill ledger G1).
2. MCP results and recall results are **architectural group boundaries** — the blocks worth prose-synthesizing are excluded from group runs by construction (grill ledger G4).
3. `GroupCommand.digest` is optional per protocol; the engine's default recap is already structural (kind counts + turn range + token estimate + first user message) (grill ledger G3).
4. Immutability of group summaries is trivially honored when the digest is a pure function of the corpus — no cache, no persistence needed for byte-identical restore across reload.
5. `recall` reversibility on every folded block (standing preference) is preserved via ticket 06 §2's tail-append mechanism, which is independent of who wrote the digest text.

### Consequences (applied to the map + tickets in the same turn)

- **MAP Destination bullet 2** rewritten to drop "broker LLM" and state the deterministic digest.
- **MAP standing preferences** pruned: broker latency removed from telemetry list; per-session JSON write-through persistence replaced with "determinism (not persistence) provides byte-identical restore"; "cache the summary by content-hash" bullet dropped.
- **MAP Not yet specified**: broker prompt-template details and D5 JSON persistence sub-bullet dropped; "exact composition rule for the deterministic digest body under α" added as a downstream PRD concern.
- **Ticket 03** amended (see its §α amendment): sync/async shape replaced with synchronous single-pass emission; `pendingRolloverHash` bookkeeping removed; failure/unavailability table evaporates (no `host.complete()` to fail); rejected-shapes list becomes moot. Trigger predicate, escape valve, min-savings gate, and force-alignment all stand.
- **Ticket 04** amended (see its §α amendment): D2 narrowed to deterministic, D3 narrowed (no broker latency, no failure surface), D5 dropped in full. D1/D4/D6 stand.
- **Ticket 06** amended (see its §α amendment): §1 narrowed to deterministic digest, §3 Layer 1 broker cache dropped; §2 (tail-append recall) and §4 (no protocol change) stand.
- **Ticket 13** closed as `wontfix` — superseded by this ticket. Grill ledger wayfinder-13-a archived as historical.
- **Ticket 11** (draft ADR-0004) blocklist reduced: 13 and 14 removed.
- **Frontier** collapses from {03, 07, 14} to {03, 07}.

## Question (historical)

The MAP-as-written assumes a broker LLM produces group summaries at rollover:

- **Destination bullet 2**: *"When it exceeds threshold, a **broker LLM** summarizes it once into a new immutable group summary."*
- **Ticket 06 (closed)**: *"reuse `GroupCommand` with a **broker-produced digest string** + deterministic recovery-codes footer."*
- **Ticket 04 (closed) D2/D3/D5**: broker `host.complete()` lives per-session inside the conductor; header carries `broker latency`; per-session JSON write-through persistence exists specifically because LLM calls are expensive enough to survive reconnect.

Grilling ticket 13 surfaced a prior question that these three decisions all quietly assumed away: **is the LLM actually needed?**

`my-customize-conductor` today already runs entirely without `host.complete()`:

- Per-block: deterministic template functions in `mcp-summary.ts` — `mcpSummary(block, callBlock)`, `pstackRecallSummary(identity)`, `genericRecallSummary(codes)`, `toolResultSummary(block, callBlock)` — emitted as `{ kind: "replace", id, content: summary, recoverable: true }`.
- Per-group: `{ kind: "group", ids: [...] }` with **no digest field**, falling back to the engine's default group digest (see `estimateDefaultGroupDigestCost` at `my-customize-conductor.ts:49`).

What neither path produces is a **prose synthesis across many pre-group blocks at once** — a paragraph that says "the agent read foo.ts, discovered X, ran tests, three failed, fixed by editing bar.ts". That prose is the specific product the LLM is being brought in for. Whether it's worth the machinery it drags in (async `host.complete`, `pendingSummaryHashes` dedup, `groupSummaryCache`, per-session JSON persistence, failure modes at rollover, KV-cache-warmth trades) is the open call.

## Three realistic shapes

- **α — No LLM.** Rollover commits a group with either the engine's default digest or an enriched deterministic digest (e.g. concatenated per-block `toolResultSummary` / `mcpSummary` outputs, or an aggregated structural summary like "N MCP calls to X, N reads under Y, N assistant turns spanning turns 42–51"). Simplest, most cache-warm, no failure modes to design.
- **β — Deterministic first, LLM opportunistic.** Rollover always commits a deterministic digest immediately (defends the budget, cache-warm). If `host.can("complete")` is true, an LLM summary is fetched in parallel and, once it arrives, augments the group as a companion artifact — never load-bearing. Failure of the LLM is a non-event.
- **γ — LLM-first (MAP-as-written).** Rollover blocks on `host.complete()`; deterministic path exists only as a failure fallback. Highest fidelity when it works; most machinery to design and defend.

## Downstream impact per outcome

- **α wins**: re-open tickets 04 and 06 (their accepted resolutions assume broker-produced digests); rewrite Destination bullet 2; ticket 13 closes as superseded (its D1 fallback / D2 prompt shape / D3 cost-and-latency questions evaporate); MAP standing prefs about broker latency and per-session JSON write-through persistence get pruned or narrowed.
- **β wins**: 04 and 06 stand but their scopes narrow (LLM is an opportunistic add-on, not the digest); ticket 13 re-scopes to "when the opportunistic LLM is used, what shape / what fallback"; MAP's LLM-related machinery mostly survives but stops being load-bearing.
- **γ wins**: no MAP change; ticket 13 proceeds under its current premise (grill D1 fallback, D2 prompt shape, D3 cost / latency knobs).

## Framing for the grill

The load-bearing question is: **what does the pre-group carry, in *this* conductor, in a realistic session?** If it is mostly tool-churn (file reads, greps, shell dumps, MCP calls — the traffic `my-customize-conductor` is already tuned for), α is very defensible: the agent doesn't need prose synthesis of ten `read foo.ts` results, it needs to know which files were touched and that it can `recall` them by identity. If the pre-group is mostly conversational reasoning worth reconstructing later (design discussions, decision trees, multi-turn debugging that the agent later needs to consult), γ is warranted. β is the hedge for "we don't know yet, and don't want to bet on it".

Blocks tickets 13 and 11.
