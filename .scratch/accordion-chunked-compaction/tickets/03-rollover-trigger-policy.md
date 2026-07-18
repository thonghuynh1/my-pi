---
labels: wayfinder:grilling
status: done
assignee: agent (this session)
map: ../MAP.md
blocks: [02-four-zone-layout]
amended_by: 14-llm-necessity-for-group-summaries
---

# Rollover trigger and batch policy

> **α amendment (ticket 14 — no LLM at rollover).** The async/broker-orchestration bits of the original resolution are struck; the trigger predicate, min-savings gate, escape valve, and force-alignment all stand. See **§α amendment** below.

## Question

Define **when** the pre-group flushes into an immutable group summary, and how we guarantee "at most one KV-cache-prefix break per rollover":

- Trigger candidates: (a) pre-group tokens ≥ cap; (b) turn boundary reached while over cap; (c) explicit budget-pressure signal from `availableCap(view)`; (d) idle/human-invoked.
- Do we hold off rollover during an active tool-call/result span?
- Once triggered, is the rollover synchronous within one `conduct()` pass, or async via `host.requestRerun()` (following the-conductor-v2's pattern)?
- What's the min-savings threshold below which rollover is skipped (analogous to the existing `>= max(2000, 0.05*cap)` gate on frozen grouping)?
- Failure/retry policy if the broker call errors mid-rollover.

## α amendment (from ticket 14)

Ticket 14 resolved α (no LLM broker for group summaries). Applied to this ticket:

- **Trigger predicate (fast path + escape valve)** — **stands.** The two-tier hybrid, turn-boundary alignment, tool-pair integrity, and `estimatedGroupSaving ≥ max(2_000, 0.05 * cap)` gate are all independent of who writes the digest.
- **Min-savings threshold** — **stands.**
- **Sync/async execution** — **replaced with synchronous single-pass emission.** Under α the digest is computed synchronously as a deterministic function of the pre-group corpus and emitted in the same `conduct()` pass that fires the trigger. No `host.complete()`, no `pendingRolloverHash`, no `host.requestRerun()`, no cache lookup. The "at most one KV-cache-prefix break per rollover" invariant is preserved trivially by single-emission (there is no in-flight state that could produce a second break).

  The rejected-shapes section of the original resolution (emit-then-upgrade; two-flavour `GroupCommand`s) becomes moot — both were LLM-specific pathologies. The ADR need not name them.
- **Failure / unavailability behaviour** — **evaporates in full.** There is no `host.complete()` to fail. The `pendingRolloverHash` field is removed. `host.can("complete")` is not consulted — chunked compaction is inert only on the ticket-02 `contextWindow < 128_000` gate, nothing else. `conductor/status.lastSummaryError` and `summaryErrors` telemetry are removed (nothing to report). The frozen-grouping pressure valve at `live > hardCap` remains as the pre-existing hard-pressure fallback — unchanged, and now unshared with any chunked-compaction failure path.
- **Tunability surface** — **stands.** `PRE_GROUP_OVERFLOW_CAP = 1.25` and the min-savings gate are unaffected. No broker timeout constant is needed.

### Amended consequences on the map

- ADR-0004 (ticket 11) drops: the async `host.complete()` shape, the `pendingRolloverHash` bookkeeping, the rejected-shapes list, the silent-skip-on-failure table, and any mention of broker latency in `conductor/status`.
- ADR-0004 adds: the deterministic single-pass emission shape, and the statement that the frozen-grouping pressure valve is the sole fallback (unshared with any chunked-compaction failure path, because chunked compaction under α has no failure path).
- Ticket 05 (cache-invalidation-accounting) inherits: exactly one KV-cache-prefix break per successful rollover (same as before); zero interstitial breaks while pending (there is no pending state under α). Ticket 05's spec need not carry the pending-state case at all.

## Original resolution (γ-shaped — historical)

### Trigger predicate (sub-questions a + b)

Two-tier hybrid. Every `conduct()` pass evaluates both tiers against the derived pre-group index from ticket 02.

**Fast path (proactive, aligned):**

```
preGroupTokens ≥ preGroupTokens_soft                        // default 15_000, from ticket 02
  && preGroupEndsOnTurnBoundary                             // no partial trailing turn
  && noOpenToolPairAcrossPreGroupTail                       // every tool_call has its tool_result
  && estimatedGroupSaving ≥ max(2_000, 0.05 * cap)          // inherited from my-customize-conductor's frozen-grouping gate
```

**Escape valve (reactive ceiling):**

```
preGroupTokens > preGroupTokens_soft × preGroupOverflowFactor     // default 1.25 → 18_750
  → force-align backwards to the nearest safe boundary
    (leave trailing unsafe blocks in pre-group for the next rollover)
```

- Turn-boundary alignment and tool-pair integrity are folded **into** the predicate, not enforced by a separate hold mechanism. `ViewBlock.turn` and `ViewBlock.callId` are already on every block; the predicate consults them directly. Ticket 07 pins the exact `noOpenToolPairAcrossPreGroupTail` definition (never split a `tool_call` from its `tool_result`).
- `availableCap(view)` (candidate (c) in the original ticket) is **not** a distinct trigger — it's the source of `cap` in the savings gate.
- Idle / human-invoked rollover (candidate (d)) is **out of scope for v1**.
- Force-alignment algorithm (walk-back from tail vs. bisection) is **left to the implementer** — both are correct against the predicate.

### Min-savings threshold (sub-question d)

Inherit **`max(2_000, 0.05 * cap)`** unchanged from `my-customize-conductor`'s existing frozen-grouping gate. Redundant on the fast path (a ~15k pre-group → ~500-token summary always clears it) but defense-in-depth against pathological pre-groups (long tool-result runs that summarize poorly). No new tunable.

### Sync/async execution (sub-question c)

The invariant "at most one KV-cache-prefix break per rollover" (MAP.md) plus the protocol shape (`host.complete()` is `Promise`-returning, `host.requestRerun()` is fire-and-forget) forces exactly one legal shape:

> When the trigger predicate fires, `MyCustomizeConductor` snapshots the pre-group corpus, computes its content-hash, and calls `host.complete()`. It stashes the pending hash on class-instance state and does **not** emit a `GroupCommand` on this pass. When the promise resolves, the digest is cached (per ticket 04 D5 write-through) and `host.requestRerun()` is called. The next `conduct()` pass sees the cache hit and emits the `GroupCommand` **once**, with the LLM-produced digest.

**Rejected shapes** (recorded so the ADR names them):

- **Emit-then-upgrade** (deterministic-digest `GroupCommand` synchronously, LLM-digest re-emit later via `onSummary` — the-conductor-v2 pattern). Costs 2 KV-cache breaks per rollover → violates invariant.
- **Emit two flavours of `GroupCommand`** (LLM digest on broker success, deterministic content-hash roll-up on broker failure). Contradicts ticket 06's commitment to LLM-produced digest strings as the group representation.

**Left to the implementer:** whether `conduct()` returns `null` (full hold) or a partial plan (continue fold/replace work on non-pre-group blocks) while broker is pending. Both variants preserve the invariant; the choice is a local liveness/UI-responsiveness tuning, not a spec-level contract.

**Left to the implementer:** broker timeout constant. `the-conductor-v2` uses `ACCORDION_SUMMARY_TIMEOUT_MS = 120_000`; overriding for `my-customize-conductor` is fine but doesn't need spec-level pinning.

### Failure / unavailability behaviour (sub-question e)

**There is no "failure/retry policy" as a distinct concept.** The conductor's minimum bookkeeping is one field, `pendingRolloverHash: string | null`, whose sole job is preventing concurrent broker calls for the same corpus (`conduct()` is called many times per turn — without this field, N in-flight `conduct()` passes would fire N concurrent `host.complete()` calls).

| Condition | Action |
|---|---|
| `host.can("complete") === false` (browser dev mode, read-only transcript, extension disconnected) | Rollover inert. Trigger predicate does not fire `host.complete()`, `pendingRolloverHash` stays `null`. Analogous to ticket 02's `contextWindow < 128_000` inertness gate — chunked compaction is simply off. |
| `host.complete()` in flight for hash `H` | Skip the trigger this pass — `pendingRolloverHash === H` is the in-flight guard. |
| `host.complete()` rejects / times out / returns empty | Clear `pendingRolloverHash`. Log via existing `conductor/status.lastSummaryError` + increment `summaryErrors` (already ticket 04 D3 telemetry). Emit nothing. |
| `host.complete()` succeeds | Cache the digest by content-hash (ticket 04 D5 write-through), clear `pendingRolloverHash`, call `host.requestRerun()`. Next `conduct()` pass emits the `GroupCommand`. |

After a failure the trigger predicate is re-evaluated on the next `conduct()` pass — same corpus → same hash → the broker is called again; different corpus (new turns arrived) → a new hash → fresh call. The trigger predicate itself **is** the retry loop; no attempt counter, no backoff, no dead-letter list. In a live session pre-group content changes fast enough that pathological "broker deterministically fails on same content forever" isn't a real concern.

**No deterministic-digest fallback.** `MyCustomizeConductor` already has a pre-chunked-compaction fallback: when `live > hardCap` and no group is emitted, the existing **frozen-grouping pressure valve** kicks in (`live > hardCap && frozenEpochKey !== last && totalFrozenSaving ≥ max(2_000, 0.05 * cap)`). That is the "chunked compaction unavailable" branch — it already works, needs no new code from us. ADR-0004 states explicitly: **chunked compaction is a proactive optimization; on any failure or unavailability, the conductor degrades to the pre-existing frozen-grouping pressure valve for that pass.**

### Tunability surface (delta on ticket 02's constants file)

No new user-facing settings. Adds to the same constants file introduced by ticket 02:

- `PRE_GROUP_OVERFLOW_CAP = 1.25` (already introduced by ticket 02 — reused here for the escape-valve threshold, not renamed).
- Min-savings gate reuses `max(2_000, 0.05 * cap)` — literal, no constant needed since the existing frozen-grouping call site already uses it inline.

### Consequences for downstream tickets

- **Ticket 05 (cache-invalidation-accounting)** — unblocked by this resolution. Inherits: exactly one KV-cache-prefix break per successful rollover; zero breaks on failure (nothing emitted); no interstitial breaks while broker is pending (nothing emitted). Must specify how the conductor measures and reports this.
- **Ticket 07 (tool-call-pair-integrity)** — must pin the exact `noOpenToolPairAcrossPreGroupTail` predicate consumed by the fast path here. Force-alignment algorithm details for the escape valve also depend on ticket 07's boundary definition.
- **Ticket 11 (draft ADR-0004)** — must include verbatim: the two-tier trigger predicate, the min-savings inheritance, the hold-until-resolved sync/async shape, the `pendingRolloverHash` bookkeeping, the rejection of emit-then-upgrade and two-flavour group commands, the silent-skip-on-failure policy, and the explicit statement that the frozen-grouping pressure valve is the fallback.
- **Ticket 12 (compile PRD)** — must lift the implementer choices (hold-full vs. hold-group, broker timeout constant, force-alignment algorithm) into concrete downstream implementation tickets so a downstream implementer knows they're theirs to make.
