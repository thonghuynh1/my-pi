# Grill ledger — wayfinder ticket 04 (Broker dashboard integration)

Map: `.scratch/accordion-chunked-compaction/MAP.md`
Ticket: `.scratch/accordion-chunked-compaction/tickets/04-broker-model-integration.md`
Type: `wayfinder:grilling` (HITL)

## Decisions

- **D1 — v1 mode target: direct + broker (both)**
  - status: **accepted**
  - resolution: Option A. Conductor emits chunked-compaction commands unconditionally; the app renders whatever it gets in either mode. No mode-detection channel added to the conductor. Matches ADR-0007/0008 contract (one view, one command batch, aggregator agnostic).
  - superseded: B (direct-only + follow-up) and C (broker-first) rejected — B would require adding mode-awareness to the conductor that doesn't exist; C contradicts MAP out-of-scope (v1 lives in `my-customize-conductor`, not in the broker).
  - applied to map: pending (will fold once all D-decisions for ticket 04 resolve).

- **D2 — Group-summary computation lives per-session inside the conductor**
  - status: **accepted**
  - resolution: Option A. `host.complete()` runs in the session's process; `groupSummaryCache: Map<contentHash, string>` is session-local. Broker sees the resulting `group(digest: <text>)` command in the aggregated view but has zero role in producing it.
  - superseded: B (broker-side worker) rejected — breaks D1-A uniformity, adds new protocol edge, drags in the cross-session persistence question. C (hybrid opportunistic dedup) rejected — reintroduces mode-detection in the conductor, two code paths, not worth v1 complexity.
  - fog: cross-session summary dedup deferred to a follow-up map (add to MAP "Not yet specified" when the batch folds).
  - applied to map: pending.

- **D3 — Dashboard surfacing: reuse existing `group` rendering + `conductor/status` telemetry + textual header in digest**
  - status: **accepted**
  - resolution: Option C. `GroupCommand` already renders as a distinct band/tile with its own color (`app/src/lib/engine/display.ts`, `tileDraw.ts:479`, `ContextMap.svelte:1000`); no new UI, no protocol change. On top of the existing rendering:
    - Conductor MUST emit `conductor/status` events on rollover start, rollover success (with broker latency ms), rollover failure (with error text), and periodic pre-group fill %. Payload includes `{ fill, rollovers, lastBrokerLatencyMs }` in `metrics`.
    - Group summary `digest` string MUST begin with a textual header: `⟨chunked-compaction · N blocks · turns X–Y · content-hash <hash>⟩\n\n<summary body>`. Header is machine-readable and agent-visible on unfold. Costs ~25 tokens per group.
  - superseded: A (silent) rejected — dashboard operator has no observability. B (telemetry only, no header) rejected — loses agent-visible provenance and future-tooling identifier for free (~25 tokens is negligible next to a group summary).
  - applied to map: pending.

- **D4 — Strict per-session isolation of group summaries**
  - status: **accepted**
  - resolution: Option A. Each session runs its own conductor with its own `groupSummaryCache`; nothing is shared across sessions, ever. ADR-0004 rules out cross-session summary dedup as a design principle ("per-session conductor = per-session cache"), not as a v1-only deferral. Also removes the D2 fog entry ("cross-session summary dedup deferred to a follow-up map") — the door is closed, not fogged.
  - superseded: B (fog for future revisit) rejected — user framed isolation as an architectural principle, not a v1 punt. C (opt-in broker-side dedup) rejected — contradicts D2-A and the isolation principle.
  - applied to map: pending. Also unwind the "cross-session summary dedup" fog line queued from D2.

- **D5 — Per-session JSON persistence of the group-summary cache (write-through)**
  - status: **accepted**
  - resolution: Option B'. Conductor persists a per-session JSON file (path TBD in implementation, e.g. `~/.accordion/sessions/<session-id>/group-summaries.json`) recording every completed rollover: `[{ contentHash, digest, members, turns: [X, Y], createdAt }]`.
    - On `attach(host)`: read file → hydrate `groupSummaryCache`.
    - On successful new rollover: append the new summary to the file (write-through).
    - On cache hit by `contentHash` during `conduct()`: skip the LLM call, emit the cached digest verbatim → byte-identical group block → KV cache stays warm across reconnect.
    - Disconnect-era fresh turns: enter the pre-group on the next `conduct()` pass; if their content-hash matches a persisted entry, cache hits; otherwise a new LLM call runs once and the new summary is appended.
    - Never re-summarize an already-immutable group (matches MAP standing preference).
    - Engine-side fold state resets on reconnect; conductor re-emits `Command[]` on first `conduct()` pass. Cached digests keep the emitted groups byte-identical.
  - superseded: A (in-memory only) rejected — loses byte-identical redraw across reconnect, wastes broker calls, risks KV break from non-identical regenerated summaries. C (bounded/GC'd cache) rejected — marginal storage win, adds a GC rule for no real gain. D (punt) rejected — user made an active decision, not a fog.
  - open sub-questions (implementation-level, land on downstream ticket): exact file path convention; when to garbage-collect entries for sessions that no longer exist; behavior when file is corrupt/missing/wrong-protocol-version.
  - applied to map: pending. Also removes "Persistence: should group summaries survive session resume, or be regenerated?" from MAP fog list — answer is now "yes, via per-session JSON file, write-through."

- **D6 — No protocol change; header format is a `my-customize-conductor`-private convention**
  - status: **accepted**
  - resolution: Option A. No `ViewBlock` field added, no `CONDUCTOR_PROTOCOL_VERSION` bump. The D3-C header format (`⟨chunked-compaction · N blocks · turns X–Y · content-hash <hash>⟩`) is a private convention of `my-customize-conductor`; no cross-conductor commitment. Dashboard tooling that wants to identify chunked-compaction groups pattern-matches on the header string.
  - superseded: B (recommend header format as cross-conductor convention) rejected — user chose the narrower scope; convention stays scoped to `my-customize-conductor`. C (additive `ViewBlock.groupKind` field) rejected — protocol bump for zero v1 gain; contradicts D3-C's "no protocol change" framing.
  - applied to map: pending.

## Ticket 04: all decisions accepted — applying to MAP + ticket now.

## Grounding

- Ticket 04 was originally muddled — mixed "broker dashboard integration" (multi-session app mode) with "summarizer LLM choice" (Ollama/Haiku/Gemini). User confirmed "broker" = the accordion multi-session dashboard mode (`app/src/lib/live/brokerMode.ts`), not "LLM broker".
- Ticket split: 04 now covers dashboard integration only; new ticket 13 covers summarizer LLM. Ticket 11 blockers updated to include 13; MAP tickets list + frontier updated.
- Confirmed by user: "yeah go with X" (split option).
