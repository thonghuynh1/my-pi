---
labels: wayfinder:grilling
status: done
claimed_by: pi-agent (grill session)
map: ../MAP.md
blocks: []
amended_by: 14-llm-necessity-for-group-summaries
---

# Broker (dashboard) integration

> **α amendment (ticket 14 — no LLM at rollover).** The LLM-dependent bits of the original resolution are struck; the framework and non-LLM sub-decisions stand. See **§α amendment** below.

## Question (original)

Accordion runs in two modes: **direct** (one Pi session, one WebSocket) and **broker** (`accordion-broker` aggregates many Pi sessions; app becomes a multi-session dashboard, detected via `GET /__accordion/broker-meta`). Chunked compaction must work coherently in both.

Sub-questions:

- v1 mode target (both / direct-only / broker-only)?
- Where does the group-summary computation live (per-session conductor / broker-side service)?
- Dashboard surfacing of group summaries?
- Cross-session isolation vs cache sharing?
- Persistence contract across session resume / reconnect?
- `ConductorView` broadcast shape — any new fields on `ViewBlock`?

(Summarizer-LLM sub-questions from the original ticket were split off to ticket 13 mid-grill.)

## α amendment (from ticket 14)

Ticket 14 resolved α (no LLM broker for group summaries). Applied to this ticket:

- **D1 (both direct + broker modes)** — **stands.** Independent of LLM choice.
- **D2 (per-session computation in the conductor)** — **narrows.** "Computation" is now a deterministic pure function of the pre-group corpus (structural core + recovery-codes footer, per ticket 06 §2). No `host.complete()`, no `pendingSummaryHashes`, no `AbortController`, no `groupSummaryCache` — the conductor stays synchronous. The "per-session" framing survives trivially (each session's conductor computes its own).
- **D3 (dashboard surfacing)** — **narrows.** `conductor/status` telemetry still emitted on rollover start / success and periodic fill %; `lastBrokerLatencyMs` is dropped from the metrics payload. Rollover-failure events are dropped (there is no failure mode to surface — a deterministic function can't fail). Textual header `⟨chunked-compaction · N blocks · turns X–Y · content-hash <hash>⟩` still stands (deterministic, ~25 tokens).
- **D4 (strict per-session isolation)** — **stands** trivially. Under α there is no cache to share, ever.
- **D5 (per-session JSON write-through persistence)** — **dropped in full.** The digest is a pure function of the corpus; reload re-emits byte-identical `GroupCommand`s without any persistence. `groupSummaryCache` and the persistence file both cease to exist. All follow-on implementation questions (file path convention, GC of stale session files, corruption / protocol-version handling) evaporate.
- **D6 (no protocol change)** — **stands.**

### Amended consequences on the MAP

- **Standing preference** "per-session JSON file provides write-through persistence" → replaced with "determinism (not persistence) provides byte-identical restore across reconnect".
- **Standing preference** on `conductor/status` → "broker latency" and "rollover failure" removed from the telemetry list.
- **Not yet specified** → the JSON path convention / GC / corruption sub-bullet removed.

## Original resolution (γ-shaped — historical)

**D1 — v1 mode target: both (direct + broker).** Conductor emits chunked-compaction commands unconditionally; the app renders whatever it gets in either mode. No mode-detection channel added to the conductor. Matches ADR-0007/0008 (one view, one command batch, aggregator agnostic).

**D2 — Group-summary computation lives per-session inside the conductor.** `host.complete()` runs in the session's process; `groupSummaryCache: Map<contentHash, string>` is session-local. Broker sees the resulting `group(digest: <text>)` command in the aggregated view but has zero role in producing it.

**D3 — Dashboard surfacing: reuse existing `group` rendering + `conductor/status` telemetry + textual header in digest.** `GroupCommand` already renders as a distinct band/tile with its own color (`app/src/lib/engine/display.ts`, `tileDraw.ts:479`, `ContextMap.svelte:1000`); no new UI, no protocol change. On top of that:

- Conductor MUST emit `conductor/status` events on rollover start, rollover success (with broker latency ms), rollover failure (with error text), and periodic pre-group fill %. Payload includes `{ fill, rollovers, lastBrokerLatencyMs }` in `metrics`.
- Group summary `digest` string MUST begin with the textual header `⟨chunked-compaction · N blocks · turns X–Y · content-hash <hash>⟩\n\n<summary body>`. Header is machine-readable and agent-visible on unfold. Costs ~25 tokens per group.

**D4 — Strict per-session isolation of group summaries.** Each session runs its own conductor with its own `groupSummaryCache`; nothing is shared across sessions, ever. Cross-session summary dedup is ruled out as a design principle, not a v1-only deferral.

**D5 — Per-session JSON persistence of the group-summary cache (write-through).** Conductor persists a per-session JSON file (path convention TBD in implementation, e.g. `~/.accordion/sessions/<session-id>/group-summaries.json`) recording every completed rollover: `[{ contentHash, digest, members, turns: [X, Y], createdAt }]`.

- On `attach(host)`: read file → hydrate `groupSummaryCache`.
- On successful new rollover: append the new summary to the file (write-through).
- On cache hit by `contentHash` during `conduct()`: skip the LLM call, emit the cached digest verbatim → byte-identical group block → KV cache stays warm across reconnect.
- Disconnect-era fresh turns enter the pre-group on the next `conduct()` pass; if their content-hash matches a persisted entry, cache hits; otherwise a new LLM call runs once and the new summary is appended.
- Never re-summarize an already-immutable group (matches MAP standing preference).
- Engine-side fold state resets on reconnect; conductor re-emits `Command[]` on first `conduct()` pass, using cached digests → byte-identical groups → KV cache warm.
- Implementation-level open questions (land on downstream ticket): exact file path convention; when to garbage-collect entries for sessions that no longer exist; behavior when file is corrupt / missing / wrong protocol version.

**D6 — No protocol change; header format is a `my-customize-conductor`-private convention.** No `ViewBlock` field added, no `CONDUCTOR_PROTOCOL_VERSION` bump. The D3 header format is scoped to `my-customize-conductor`; no cross-conductor commitment. Dashboard tooling that wants to identify chunked-compaction groups pattern-matches on the header string.

## Consequences (applied to the map in the same turn)

- **Notes** gains three standing preferences:
  1. Chunked-compaction ships in both direct and broker mode with the same conductor code; no mode-detection in the conductor.
  2. Group summaries are strictly per-session; per-session JSON persistence provides byte-identical restore across reconnect.
  3. Conductor emits `conductor/status` telemetry (rollover start/success/failure, fill%, broker latency); group digest strings begin with the `⟨chunked-compaction · …⟩` header.
- **Out of scope** gains: cross-session summary dedup or shared caches (ruled out by D4).
- **Not yet specified** gains: exact JSON file path convention + garbage-collection policy for stale session files + corruption / protocol-version handling (all land on a downstream implementation ticket, not this map).
- **Not yet specified** loses: "Persistence: should group summaries survive session resume, or be regenerated?" (answered by D5) and "GUI (`accordion/app`) treatment of the pre-group band on the map view" (answered by D3).
- **Tickets** — 04 closes. Frontier collapses from {02, 04, 06, 13} to {02, 06, 13}.

## Ledger

Private grill ledger: `.scratch/grills/wayfinder-04-a/ledger.md` (decisions D1–D6 accepted).
