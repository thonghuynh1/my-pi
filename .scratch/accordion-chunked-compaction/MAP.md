---
labels: wayfinder:map
status: done
---

# Accordion chunked-compaction (pre-group + broker) — Map

## Destination

A new ADR (`docs/adr/0004-accordion-chunked-compaction.md`) accepted **plus** a PRD at `.scratch/accordion-chunked-compaction/PRD.md` ready for `skill-to-issues` handoff. Both artifacts describe a four-zone context layout:

```
System + tool defs │ Immutable Group Summaries │ Pre-Group (raw, ≤ 15k) │ Protected Tail (raw, ~20k)
```

- The pre-group stages aged messages between the frozen prefix and the tail.
- When it exceeds threshold, a **deterministic digest** (structural core + per-member recovery-codes footer, computed by the conductor as a pure function of the pre-group corpus) is committed as a new immutable **group summary**, appended to the immutable groups section. **No LLM call at rollover.**
- KV-cache prefix invalidation happens **at most once per rollover**, never per message.
- The tail is never rewritten. Older group summaries are never regenerated.

Reaching the destination = ADR-0004 merged as `accepted` + `PRD.md` written and confirmed ready for `skill-to-issues` — precise enough that a downstream implementer can enforce every claim (including "at most one KV-cache-prefix break per rollover") with a test, without any code shipped from this map.

## Notes

**Domain:** accordion extension (`F:/MyWork/my-pi/vendor/accordion`) — specifically `conductors/my-customize-conductor/` and `extension/cache-tracker.ts`.

**Every session should consult first:**
- `docs/adr/0002-authoritative-accordion-folding-runtime.md` — cache-aware folding contract (`frozenFromIndex`).
- `docs/adr/0003-proactive-content-compression.md` — the transport-layer precedent this work extends.
- `F:/MyWork/my-pi/vendor/accordion/docs/conductor-protocol.md` — `ConductorView` / `Command` shapes.
- `F:/MyWork/my-pi/vendor/accordion/conductors/README.md` — conductor catalog and roadmap.
- `F:/MyWork/my-pi/vendor/accordion/conductors/code-skeleton/` — deterministic-digest cache-warmth pattern (α lineage).

**Standing preferences:**
- Preserve `recall` / unfold reversibility on every folded block.
- Group digests are **deterministic pure functions of the pre-group corpus**; reload re-emits byte-identical `GroupCommand`s without any cache. No LLM call at rollover.
- Never split a `tool_call` from its `tool_result` across a group boundary.
- Group summaries are **immutable** once written — no re-summarizing prior groups.
- Chunked compaction ships in **both** direct and broker (multi-session dashboard) modes with the same conductor code; no mode-detection lives in the conductor.
- Group summaries are **strictly per-session**; determinism (not persistence) provides byte-identical restore across reconnect.
- Conductor emits `conductor/status` telemetry (rollover start / success, pre-group fill %); group digest strings begin with the `⟨chunked-compaction · N blocks · turns X–Y · content-hash <hash>⟩` header (private convention of `my-customize-conductor`).
- All work is **planning** (per wayfinder default). This map ends at ADR-0004 accepted and `PRD.md` ready for `skill-to-issues`; no code lands in `conductors/my-customize-conductor/` during this map. Implementation is a downstream effort keyed on the PRD. Downstream tickets resolve at spec fidelity — "the PRD will say X" / "the ADR will document Y" — not "the code does X".

## Decisions so far

- [Confirm destination shape: ADR + prototype vs ADR-only vs code-only](tickets/01-destination-shape.md) — destination redrawn to **ADR-0004 accepted + `PRD.md` ready for `skill-to-issues`**; no prototype patch, no `research/*` spike; all remaining tickets resolve at spec fidelity.
- [LLM necessity for group summaries](tickets/14-llm-necessity-for-group-summaries.md) — **α accepted: no LLM broker.** Group digest is a deterministic pure function of the pre-group corpus (structural core per engine default + recovery-codes footer per ticket 06 §2). Consequences: ticket 13 closed as superseded; tickets 03, 04, and 06 amended (LLM-dependent sub-decisions struck — see their α-amendment sections); Destination bullet 2, standing preferences, and Not-yet-specified pruned accordingly.
- [Survey the-conductor-v2 and code-skeleton](tickets/08-findings.md) — (**α-superseded** by ticket 14: the reused `pendingSummaryHashes` dedup / silent-skip fallback / `onSummary` re-plan / `groupSummaryCache` / `host.complete()` machinery were all borrowed from `the-conductor-v2` under a γ assumption. α removes them wholesale.) Historical reuse note: `ReplaceCommand.recoverable: true` (from `code-skeleton`) still stands and is used by the per-block deterministic path in `my-customize-conductor` today.
- [Read accordion ADRs 0007/0008/0010/0016](tickets/09-findings.md) — 12 hard constraints extracted. The closest precedent is ADR 0010's epoch pattern: hysteresis band + monotonic `appliedFoldSet` + self-tracked fullness ≠ `view.liveTokens`. Group summaries must use `group(digest: <text>)` with non-null string; DROP is irreversible. Broker output must be cached by content-hash of the pre-group corpus.
- [Locate existing hierarchical-grouping notes](tickets/10-findings.md) — **not a clean slate.** This is accordion's already-designed **Milestone C4 "The Archivist"** built on flat C2.5 "Auto-Coalesce". Cite `docs/conductor-plan.md` §C2.5+§C4, `docs/conductor-rework-roadmap.md` §C4, `VISION.md:100-102`. Recoverable prior code on `claude/busy-bose-bd815d:app/src/lib/engine/coalesce.ts`. **Open contract question surfaced**: add `era` command (protocol bump) vs host-automatic promotion — bears on ticket 06.
- [Group representation on the wire and in the store](tickets/06-group-representation.md) — reuse `GroupCommand` with a **deterministic** digest string (structural core + recovery-codes footer; fold codes derived from member ids) — α-amended: no broker-produced text; recall of a group-member code is a **tail-append** via synthesised `recall(<code>)` tool_call/tool_result, frozen prefix never rewritten (KV cache preserved); no cache persistence needed — digest is a pure function of the corpus so reload re-emits byte-identical (α-amended: Layer 1 broker cache dropped, Layer 2 remains ephemeral, corpus content-hash IS the group's identity); **no conductor-protocol change**; engine gains a policy branch on `unfold` for group-member codes (specified in the PRD, not shipped from this map).
- [Tool-call / tool-result pair integrity across zone boundaries](tickets/07-tool-call-pair-integrity.md) — **contract-to-close** applied symmetrically to both edges of `group.ids`: a single pre-emit trim pass removes the inside half of any `callId` whose partner sits outside the run, *before* the digest is computed and the `saving <= 0` guard runs. Ticket 03 imports this in two places — as the fast-path `noOpenToolPairAcrossPreGroupTail` predicate (boolean form) and as the escape-valve force-alignment (trim form); trimmed blocks stay live between the group and the tail. `callId` preservation is already structurally guaranteed by `applyPlan` Phase A fixpoint; contract-to-close is the conductor-level pre-image. Fold-code carry-forward for `recall` inherits from ticket 06's `Members: {#code} …` footer.
- [Broker (dashboard) integration](tickets/04-broker-model-integration.md) — chunked compaction ships in **both** direct and broker modes (D1); digest generation lives **per-session** in the conductor and is deterministic (D2, α-amended); dashboard reuses existing `group` rendering + `conductor/status` telemetry + textual header in the digest, no broker-latency metric (D3, α-amended); **strict per-session isolation** — no cross-session sharing (D4); **no persistence needed** — digest is a pure function of the corpus so reload re-emits byte-identical (D5, α-amended: JSON write-through persistence dropped); **no protocol change** — header is a `my-customize-conductor`-private convention (D6).
- [Define the four-zone layout precisely](tickets/02-four-zone-layout.md) — four zones are a **rendering of existing wire state, not a new protocol surface**; pre-group is a conductor-internal derived index (no `ConductorView` / `ContextUpdateMessage` change, no version bump); `preGroupTokens = 15_000` default with 1.25 overflow cap, walk-back mirrors protected-tail algorithm from `protectedFromIndex − 1`; unified stop predicate `!grouped && !held && !proactivelyCompressed`; **P3′ engine tweak** — `substOne` frozen-region clamp bypassed for `group` commands with non-null `digest` (fold/replace unchanged, DROP still requires hard pressure), preserves "at most one KV-cache-prefix break per rollover"; **128k threshold** — chunked compaction inert when `contextWindow < 128_000` or `null`; constants-file + constructor-option tunability, no user-facing setting.
- [Rollover trigger and batch policy](tickets/03-rollover-trigger-policy.md) — **two-tier hybrid trigger**: fast-path predicate `preGroupTokens ≥ 15_000 && preGroupEndsOnTurnBoundary && noOpenToolPairAcrossPreGroupTail && estimatedGroupSaving ≥ max(2_000, 0.05 * cap)`, plus reactive escape valve at `preGroupTokens > 18_750` with force-align backwards to the nearest safe boundary; turn/pair integrity is folded **into** the predicate (no separate hold mechanism); **α-amended: synchronous single-pass emission** — digest is a deterministic function of the pre-group corpus, computed and emitted in the same `conduct()` pass that fires the trigger; no `host.complete()`, no `pendingRolloverHash`, no `host.requestRerun()`; the ≤1-KV-break invariant is preserved trivially by single-emission; **α-amended: no failure path** — there is no `host.complete()` to fail; `host.can("complete")` is not consulted; the pre-existing frozen-grouping pressure valve remains as the unshared hard-pressure fallback at `live > hardCap`; rejected-shapes (emit-then-upgrade / two-flavour groups) and silent-skip-on-failure become moot under α; min-savings inherits `max(2_000, 0.05 * cap)` unchanged; force-alignment algorithm is an implementer choice; also amended: tickets 04 and 06.
- [Draft & accept ADR-0004: Accordion chunked compaction](tickets/11-draft-adr-0004.md) — **ADR-0004 accepted** at `docs/adr/0004-accordion-chunked-compaction.md`. Consolidates T02/T03/T04/T05/T06/T07 + T14 (α no-LLM) into seven sections plus the §5 engine tweak (`substOne` frozen-region clamp bypass for `group` with non-null `digest` — the sole load-bearing engine change). Ticket 12 (compile PRD) is now unblocked and is the sole open frontier ticket.
- [Cache-invalidation accounting](tickets/05-cache-invalidation-accounting.md) — T03's gate `estimatedGroupSaving ≥ max(2_000, 0.05 * cap)` **is** the break-even rule (~14.5k saved dominates ~2k KV-break penalty at 10× on the tail); no new formula. No `ConductorView` plumbing of observed hit rate (foreclosed). Diagnostic surface = **both**: (a) `conductor/status` from `my-customize-conductor` (adds `attach(host)`) every pass with `{ preGroupTokens, preGroupFillPct, rolloverCount, tokensSavedByRollover, lastEstimatedGroupSaving, breakFrozenCount }` + human `text`; (b) `chunkedCompaction` block appended to per-turn JSONL by `accordion.ts` on rollover turns, carrying `{ preGroupTokensBefore, preGroupBlockCount, preGroupTurnRange, digestTokens, estimatedGroupSaving, frozenFromIndexBefore/After, cacheTrackerReasonBefore/After, digestContentHash }`. **Extension owns the JSONL record** (already has both `GroupCommand` observation and `cacheTracker.getDiagnostics()` in scope); conductor is JSONL-oblivious; no new upward channel. Provider-agnostic v1 (Anthropic-tuned; all cache-cost math delegated to Pi SDK). Verification claim named in the ADR: `count(chunkedCompaction.event == "rollover") == count(cacheDiagnostics.reason == "prefix-mismatch") − coldStartCount` on any session's JSONL, `coldStartCount ≤ 1` — the cold-start break is explicitly excluded. Consequences: T11 must include D1 prose, D3 payload shapes, D5 grep claim + cold-start caveat; T12 specifies `attach(host)` and JSONL block field types.
- [Compile PRD via skill-to-prd](tickets/12-compile-prd.md) — [`PRD.md`](PRD.md) written at `.scratch/accordion-chunked-compaction/PRD.md` (`status: ready-for-agent`) with 20 `DEC-###` (covering every decision on this map), 5 `US-###`, 10 `RB-###`, 6 implementation areas (each with verified `F:/MyWork/my-pi/vendor/accordion/` code anchors), 5 test seams, walking skeleton `US-001`, `Unresolved Gaps: None`. Composed via `engineering-skills` MCP `skill-to-prd` template; grounding anchors verified. **Destination reached: ADR-0004 accepted + PRD ready for `skill-to-issues`.**

## Not yet specified

- Level-2 rollover (summary-of-summaries) when group summaries themselves accumulate — likely a follow-up map, not v1.
- Interaction with `code-skeleton` and other collaborative conductors when blocks that already went through skeletonization later fall into the pre-group.
- Exact composition rule for the deterministic digest body under α (structural aggregation vs concatenated per-block `replace` outputs vs both) — downstream implementation detail for ticket 11 / PRD.
- Behavior under `session_before_compact` (pi native `/compact`) when the four-zone layout is active.

## Out of scope

- Modifying `extension/store.svelte.ts` protected-tail semantics or `protectTokens` defaults — this effort adapts to the tail, does not redesign it.
- Cross-conductor coordination protocol changes to the conductor contract (only additive changes allowed, if any).
- Shipping chunked compaction as the default for other conductors — v1 lives in `my-customize-conductor` only.
- Cross-session summary dedup or shared caches — group summaries are strictly per-session (ruled out by ticket 04 D4).
- Any code merged to `conductors/my-customize-conductor/` — implementation ships on a downstream map keyed on the PRD. Ruled out by [Confirm destination shape](tickets/01-destination-shape.md).

## Tickets (index)

Open tickets live as files under `tickets/`. Frontier = open, unblocked, unclaimed.

Wiring:

- `01-destination-shape` — **closed** (see Decisions so far)
- `02-four-zone-layout` — **closed** (see Decisions so far)
- `03-rollover-trigger-policy` — **closed** (see Decisions so far)
- `04-broker-model-integration` — **closed** (see Decisions so far; scope narrowed to broker-dashboard integration only; summarizer LLM split to 13)
- `05-cache-invalidation-accounting` — **closed** (see Decisions so far)
- `06-group-representation` — **closed** (see Decisions so far)
- `07-tool-call-pair-integrity` — **closed** (see Decisions so far)
- `08-survey-conductor-v2-skeleton` — **closed**
- `09-read-accordion-adrs` — **closed**
- `10-roadmap-hierarchical-note` — **closed**
- `11-draft-adr-0004` — **closed** (see Decisions so far)
- `12-compile-prd` — **closed** (see Decisions so far; artifact: [`PRD.md`](PRD.md))
- `13-summarizer-llm-choice` — **closed** (`wontfix`; superseded by ticket 14 α outcome; wayfinder-13-a archived as historical)
- `14-llm-necessity-for-group-summaries` — **closed** (D1 accepted α: no LLM broker for group summaries)

Current frontier: **none**. All tickets closed; destination reached (ADR-0004 accepted + `PRD.md` at `ready-for-agent`). Map complete.
