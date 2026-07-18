---
status: accepted
---

# Chunk aged messages into a deterministic four-zone context layout

`MyCustomizeConductor` will render each `ConductorView` as four ordered zones — **System + tool defs**, **Immutable Group Summaries**, **Pre-Group (raw)**, **Protected Tail (raw)** — and periodically roll the oldest slice of the Pre-Group into a new immutable group summary. The group summary is a **deterministic pure function of the pre-group corpus**, computed synchronously in the same `conduct()` pass that fires the trigger, so reload re-emits byte-identical `GroupCommand`s without any cache. KV-cache prefix invalidation happens **at most once per rollover**, never per message; the Protected Tail is never rewritten; older group summaries are never regenerated.

## Context

Proactive Content Compression (ADR-0003) closed the Frozen-Prefix Deadlock for individual tool_result blocks but leaves conversational turns (assistant messages, MCP tool results, pstack recalls) accumulating in the frozen prefix as sessions age. On models with 128k–200k context windows a long-running session eventually exhausts the budget with blocks the conductor cannot touch and A1 has already exempted. The next step in the transport-layer compression story (ADR-0003) is to **group aged conversational blocks into an immutable summary** and free the space they occupied, without invalidating the KV-cache on every turn.

Two failure modes must be avoided:

1. **KV-cache thrash.** The provider caches on prefix identity. Any change to a block that has already been sent forces the provider to re-tokenize everything after it. A naive summariser that overwrites the prefix on every turn is worse than doing nothing — the cache savings evaporate under re-tokenisation cost.
2. **Non-determinism on reconnect.** If the summary text differs across reconnect (LLM sampling, model version drift, cache miss), the frozen prefix diverges byte-for-byte and every downstream cache lookup misses. Persisting the summary to disk is one answer; the other — chosen here — is to make the summary a pure function of the input.

The design was charted on the map at `.scratch/accordion-chunked-compaction/MAP.md` and resolved through nine decision tickets:

- **02** [Four-zone layout](../../.scratch/accordion-chunked-compaction/tickets/02-four-zone-layout.md)
- **03** [Rollover trigger and batch policy](../../.scratch/accordion-chunked-compaction/tickets/03-rollover-trigger-policy.md)
- **04** [Broker-dashboard integration](../../.scratch/accordion-chunked-compaction/tickets/04-broker-model-integration.md)
- **05** [Cache-invalidation accounting](../../.scratch/accordion-chunked-compaction/tickets/05-cache-invalidation-accounting.md)
- **06** [Group representation on the wire](../../.scratch/accordion-chunked-compaction/tickets/06-group-representation.md)
- **07** [Tool-call/tool-result pair integrity](../../.scratch/accordion-chunked-compaction/tickets/07-tool-call-pair-integrity.md)
- **14** [LLM necessity for group summaries](../../.scratch/accordion-chunked-compaction/tickets/14-llm-necessity-for-group-summaries.md) — α accepted: no LLM broker; ticket 13 superseded

Evidence for the design comes from three research tickets: [08 findings](../../.scratch/accordion-chunked-compaction/tickets/08-findings.md) (the-conductor-v2 + code-skeleton reuse patterns), [09 findings](../../.scratch/accordion-chunked-compaction/tickets/09-findings.md) (constraints from vendor ADRs 0007/0008/0010/0016), and [10 findings](../../.scratch/accordion-chunked-compaction/tickets/10-findings.md) (prior design work — Auto-Coalesce C2.5, Archivist C4).

## Decision

### 1. Four-zone layout is a rendering of existing wire state, not a new protocol surface

Every `ConductorView` decomposes into four ordered zones. Only two zones require existing wire fields; the other two are already exposed on the fields the protocol has today.

| Zone | Source of truth | Wire representation |
|------|-----------------|---------------------|
| System + tool defs | `view.harnessOverhead` | Existing field |
| Immutable Group Summaries | Contiguous prefix of `view.blocks` with `grouped: true` after `frozenFromIndex` | `ViewBlock.grouped` (existing) |
| Pre-Group (raw) | `view.blocks[preGroupFromIndex .. protectedFromIndex − 1]` | **Conductor-internal derived index**; no wire field |
| Protected Tail (raw) | `view.blocks[protectedFromIndex ..]` | `view.protectedFromIndex` (existing) |

**There are no changes to `ConductorView`, `ContextUpdateMessage`, or `docs/conductor-protocol.md`. `CONDUCTOR_PROTOCOL_VERSION` is not bumped.**

**Pre-group sizing:**

- `preGroupTokens` default = **15,000** (chars/4 estimation). Chosen for 3:4 symmetry with `protectTokens = 20,000`.
- `PRE_GROUP_OVERFLOW_CAP` = **1.25**. Hard ceiling before the escape valve fires = 18,750 tokens.
- Walk-back algorithm mirrors `store.svelte.ts:824–847` (the existing protected-tail walk-back):
  1. Start at `view.blocks[protectedFromIndex − 1]`; always include that block.
  2. Walk backwards summing `ViewBlock.tokens`; stop when `sum >= target`, or the next block would push `sum > target × 1.25`, or the next block fails the groupability predicate.
  3. **Groupability predicate:** `!grouped && !held && !proactivelyCompressed`. Walk-back terminates at any block failing any of these three.
  4. Result: `preGroupFromIndex` = first block in the pre-group. If `protectedFromIndex == 0` or `target == 0`, the pre-group is empty.

The pre-group is always a contiguous run of blocks satisfying the groupability predicate, ending at `protectedFromIndex − 1`, sized ≤ `preGroupTokens × 1.25`.

**Small-context-window gate:**

Chunked compaction is inert when `view.contextWindow < 128_000` or `null`. `effectivePreGroupTokens(view)` returns `0` in that case, the walk-back returns empty, and the rollover never fires — the conductor falls back to its non-grouping path. `MIN_CONTEXT_WINDOW_FOR_CHUNKED_COMPACTION = 128_000` is a constants-file export, not a user setting.

**Zone overlap precedence:**

- Pre-Group ∩ Protected Tail: impossible by construction — walk-back starts at `protectedFromIndex − 1`.
- Pre-Group ∩ frozen prefix: the rollover **deliberately** breaks the frozen prefix — this is the sole KV-cache-prefix-break event per rollover. Enforced by the engine tweak in §5 below.
- Pre-Group ∩ existing group (`grouped: true`): walk-back stops at the group boundary. v1 is strictly single-level; nested groups are out of scope (see [ticket 10 findings](../../.scratch/accordion-chunked-compaction/tickets/10-findings.md) for the Archivist C4 line).
- Pre-Group ∩ `held` / `proactivelyCompressed`: walk-back stops.

**Tunability:** constants file at `conductors/my-customize-conductor/constants.ts` (or nearest existing convention) exports `DEFAULT_PRE_GROUP_TOKENS = 15_000`, `PRE_GROUP_OVERFLOW_CAP = 1.25`, `MIN_CONTEXT_WINDOW_FOR_CHUNKED_COMPACTION = 128_000`. `MyCustomizeConductor` accepts a single constructor option `preGroupTokens: number` (default from constants). Not user-facing, no UI setting, no persistence.

### 2. Two-tier hybrid rollover trigger, synchronous single-pass emission

**Fast path** (proactive, aligned):

```text
preGroupTokens ≥ 15_000
  && preGroupEndsOnTurnBoundary
  && noOpenToolPairAcrossPreGroupTail
  && estimatedGroupSaving ≥ max(2_000, 0.05 * cap)
```

**Escape valve** (reactive ceiling):

```text
preGroupTokens > 18_750
  → force-align backwards to the nearest safe boundary
    (trailing unsafe blocks stay live between the group and the tail)
```

Turn-boundary alignment and tool-pair integrity are folded **into** the predicate — there is no separate hold mechanism. `ViewBlock.turn` and `ViewBlock.callId` are consulted directly. `noOpenToolPairAcrossPreGroupTail` is the boolean form of the invariant in §4 below; the escape valve consumes the same invariant as its trim rule.

**Synchronous single-pass emission.** The digest is a deterministic function of the pre-group corpus, computed and emitted in the same `conduct()` pass that fires the trigger. There is no `host.complete()` call, no `pendingRolloverHash`, no `host.requestRerun()`, no cache lookup, no async broker. The "at most one KV-cache-prefix break per rollover" invariant is preserved **trivially** by single-emission: the group summary substitution happens once, atomically.

**Min-savings gate.** `max(2_000, 0.05 * cap)` is inherited unchanged from `my-customize-conductor`'s existing frozen-grouping gate. No new tunable, no new formula. The one-time KV-break penalty is ≤ ~2k tokens against the ~10× cache-miss premium the vendor ADR-0010 attention-conductor analysis established on the tail; the 2,000-token floor dominates the penalty on any conversation with ≥1 subsequent turn.

**No failure path.** There is no `host.complete()` to fail. `host.can("complete")` is not consulted. `conductor/status.lastSummaryError` and `summaryErrors` telemetry do not exist for chunked compaction. The pre-existing frozen-grouping pressure valve at `live > hardCap` remains as the unshared hard-pressure fallback — unchanged by this ADR.

**Idle/human-invoked rollover is out of scope for v1.** Force-alignment algorithm (walk-back vs bisection) is left to the PRD/implementer.

### 3. Group representation reuses `GroupCommand` with a deterministic digest

The wire form of a rollover is a single `GroupCommand { ids, digest }` — no new command variant, no new fields on any existing command, no `CONDUCTOR_PROTOCOL_VERSION` bump. `GroupCommand.recoverable: true` is **not** introduced (this diverges from `ReplaceCommand.recoverable`; recoverability for group members is handled by §3.b below).

**a. Digest is a deterministic pure function of the pre-group corpus.** Format:

```text
⟨chunked-compaction · N blocks · turns X–Y · content-hash <hash>⟩
<deterministic body>
Members: {#a3f9} {#b7c2} …
```

The header is a `my-customize-conductor`-private convention — dashboards pattern-match on the leading `⟨chunked-compaction ·` string; no field on any protocol type carries it. The `<deterministic body>` composition rule (structural aggregation vs concatenated per-block `replace` outputs vs both) is a PRD/implementation detail, not fixed here; the load-bearing property is byte-identical output on identical input. The trailing `Members: {#code} …` is the recovery-codes footer defined in §3.b.

The engine's default group recap (`digest.ts:198` via `store.svelte.ts:745`) emits a single `{#code FOLDED}` tag for the group as a whole. Since per-member recall reversibility is required, the conductor always emits an explicit `digest` string with the codes footer rather than passing `undefined`. Test `app/tests/conductor.compaction-naive.test.ts:336–338` (which asserts `expect(g.digest).not.toMatch(/\{#\w+\s+FOLDED\}/)`) is v0 behavioural, not a contract; chunked compaction supersedes it.

**b. Recall via tail-append; group summary and frozen prefix never rewritten.**

- The conductor derives one fold code per member block id (deterministic function of the id — not random, not turn-scoped) and appends them as `Members: {#code} …`.
- On unfold of a group-member code, the engine's fold-code resolver **appends full original member text into the Protected Tail** as a `tool_result` on a synthesised `recall(<code>)` `tool_call`/`tool_result` pair. Human GUI unfold synthesises the same shape.
- The group summary block is left untouched. Every downstream block is left untouched. **The KV-cache prefix is preserved.**
- Tail-appended blocks count against `liveTokens` and the tail budget like any other tail content. Repeated recalls produce repeated tail entries; history stays canonical.
- The engine's fold-code resolver gains a policy branch: normal fold code → restore in place (existing behaviour); group-member fold code → tail-append. This is an engine change, not a conductor-contract change, and is specified in the PRD.

**c. Stable identity across reload is provided by determinism, not persistence.** On reconnect, the conductor re-reads raw blocks, re-computes the pre-group corpus, and re-emits the same `GroupCommand` with the same digest text. The content-hash IS the group's stable identity. No cache, no persistence file, no cache-key content-hash memo.

### 4. Tool-call/tool-result pair integrity is a pre-emit invariant on `group.ids`

**The invariant:**

> For every `GroupCommand` emitted by `MyCustomizeConductor`, every `callId` referenced by any block in `group.ids` has both halves of its pair present in `group.ids`.

**Enforcement.** A single pre-emit trim pass over the tentative `ids`, *before* the digest is computed and *before* `estimateDefaultGroupDigestCost(run)` is evaluated. In pseudocode:

```text
collect callId → { inside, outsideLeft, outsideRight } for every block in ids
for each callId with any outside partner: remove the inside half(s) from ids
if |ids| < 2: skip emission this cycle (same fallthrough as saving <= 0 guard)
```

Trimmed blocks stay live between the group and the tail; they enter the next rollover cycle. `callId` structural preservation across `applyPlan` is guaranteed by `app/src/lib/live/mapping.ts::applyPlan` Phase A tool-pair balance fixpoint; the pre-emit trim is the conductor-level pre-image of that engine invariant.

**The invariant is used twice by §2 above.** As the boolean `noOpenToolPairAcrossPreGroupTail` predicate in the fast-path trigger, and as the trim rule in the escape-valve force-alignment. Fold-code carry-forward for `recall` inherits from §3.b: blocks excluded from `ids` by the trim retain their natural (non-group) fold code and there is no collision with the codes footer.

### 5. Engine tweak: `substOne` frozen-region clamp bypass for `group` with non-null digest

For chunked compaction to work, exactly one KV-cache-prefix break per rollover must be permitted — the rollover's whole purpose is to substitute a large frozen slice with a small one. `substOne` in the engine currently clamps all substitutions into non-frozen space (per ADR-0002's cache-aware folding contract).

**The tweak (additive, minimal):** when `kind === "group" && digest !== null`, the `substOne` frozen-region clamp is bypassed. Fold and replace commands remain clamped as today. `group` commands with `digest: null` (irreversible DROP) still require the pre-existing `hasHardContextPressure()` gate. **No `breakFrozen` flag is introduced.** The bypass rule is the flag.

This engine change is authored by the extension, not the conductor. It is the single load-bearing change ADR-0002's "cache-aware folding" contract needs to accept a controlled KV-cache-prefix break at rollover time.

### 6. Broker-dashboard integration: one conductor, both modes, no persistence

- **v1 mode target: both direct and broker.** The conductor emits chunked-compaction commands unconditionally. No mode-detection channel is added, no branch in the conductor code, no ambient signal.
- **Per-session computation in the conductor.** Deterministic and synchronous (§2). No cross-session sharing, ever — cross-session summary dedup is ruled out as a design principle, not a v1-only deferral.
- **Dashboard surfacing.** Reuses existing `group` rendering in `app/src/lib/engine/display.ts`, `tileDraw.ts:479`, and `ContextMap.svelte:1000`. Dashboards recognise a chunked-compaction group by pattern-matching the `⟨chunked-compaction · …⟩` header on `GroupCommand.digest`. `conductor/status` telemetry (§7) covers the operational surface.
- **No persistence.** Digest is a pure function of corpus; reload re-emits byte-identical `GroupCommand`s with the same digest text. No `groupSummaryCache`, no per-session JSON write-through file, no GC, no corruption/protocol-version handling.
- **No protocol change.** No `ViewBlock` field added, no `CONDUCTOR_PROTOCOL_VERSION` bump. The chunked-compaction header format is a `my-customize-conductor`-private convention.

### 7. Cache-invalidation accounting: the trigger is the model

**a. Break-even rule.** The T03 gate `estimatedGroupSaving ≥ max(2_000, 0.05 * cap)` **is** the break-even rule. A ~15k pre-group flushed into a ~500-token digest saves ~14.5k tokens per rollover. Against the ~10× cache-miss premium on the ~20k tail (per vendor ADR-0010), the one-time KV-break penalty is ≤ ~2k tokens — dominated by the 2,000-token floor on any conversation with ≥1 subsequent turn. No new formula, no new symbol, no per-provider math.

**b. No observed-hit-rate plumbing.** The conductor consults only `view.frozenFromIndex`. `cache-tracker.ts`'s `matchedPrefix` / `reason` / `frozenFromIndex` fields stay on their existing JSONL + sync-frame paths and are never fed back into conductor policy.

**c. Diagnostic surface — two sites.**

*Site 1 —* `conductor/status` emitted by `my-customize-conductor` (which gains an `attach(host)` implementation) on every `conduct()` pass:

```ts
{
  type: "conductor/status",
  text: `chunked · ${preGroupFillPct}% pregroup · ${rolloverCount} rollovers · ${humanTokens(tokensSavedByRollover)} saved`,
  metrics: {
    preGroupTokens,           // current
    preGroupFillPct,          // 0–100+ (overflow visible)
    rolloverCount,            // cumulative since session start
    tokensSavedByRollover,    // cumulative sum of estimatedGroupSaving
    lastEstimatedGroupSaving,
    breakFrozenCount          // cumulative emitted group-with-non-null-digest count
  }
}
```

On the pass that emits a rollover, the `text` transitions to `"chunked · rollover · ${rolloverCount} rollover(s) · ${humanTokens(tokensSavedByRollover)} saved · pregroup ${before} → ${after}"`.

*Site 2 —* a `chunkedCompaction` block appended to the per-turn JSONL by `accordion.ts` on rollover turns only:

```jsonc
{
  "turn": <n>,
  "context": { /* existing fields */ },
  "chunkedCompaction": {
    "event": "rollover",
    "preGroupTokensBefore": 15850,
    "preGroupBlockCount": 47,
    "preGroupTurnRange": [17, 31],
    "digestTokens": 512,
    "estimatedGroupSaving": 15338,
    "frozenFromIndexBefore": 22,
    "frozenFromIndexAfter": 68,
    "cacheTrackerReasonBefore": "prefix-match",
    "cacheTrackerReasonAfter": "prefix-mismatch",
    "digestContentHash": "sha256:..."
  }
}
```

The extension owns the JSONL record (it already observes `GroupCommand`s and holds `cacheTracker.getDiagnostics()` in scope). The conductor stays JSONL-oblivious; no new upward channel exists.

**d. Provider-agnostic v1.** Same policy for all providers. All cache-cost math is delegated to the Pi SDK. Per-provider tuning is out of scope for this map.

**e. Verification invariant (normative).** Over any session's JSONL:

```text
count(chunkedCompaction.event == "rollover")
  == count(cacheDiagnostics.reason == "prefix-mismatch") − coldStartCount
```

where `coldStartCount ≤ 1` per session. **The cold-start break is explicitly excluded** — every session has at most one first-turn prefix-mismatch that is not attributable to chunked compaction. Any deviation is a bug in either the conductor's single-emission guarantee (§2) or the extension's JSONL author path.

## Considered Options

**Async LLM broker at rollover** (γ shape, MAP-as-originally-written). Explored on tickets 03/04/06 and closed by ticket 14. Rejected for three compounding reasons: (1) the deterministic per-block path in `my-customize-conductor` — `mcpSummary`, `pstackRecallSummary`, `genericRecallSummary`, `toolResultSummary` — is already unusually rich; the load-bearing blocks are already prose-preserved as `replace` commands. (2) MCP results and recall results are architectural group boundaries by the walk-back predicate, so the blocks worth prose-synthesising are excluded from group runs by construction. (3) A non-deterministic digest requires a persistent cache to survive reconnect byte-identical; determinism removes the cache, the persistence file, the GC, the corruption handling, `pendingSummaryHashes`, `host.can("complete")` gating, `AbortController`, timeout accounting, and every failure branch. The cost is a less "human-readable" summary; the win is a much simpler contract and no reconnect cliff.

**A deterministic-first + opportunistic LLM shape** (β). Rejected on the same ticket 14 analysis: the LLM never gets to run before the digest ships (single-pass emission), so opportunism reduces to "run the LLM to update a summary that already exists" — which either invalidates the frozen prefix or produces text the frozen prefix does not contain. Both defeat the invariant.

**A new `era` or `nest` command variant** for hierarchical grouping. Rejected in scope: [ticket 10 findings](../../.scratch/accordion-chunked-compaction/tickets/10-findings.md) surface this as an open contract question on accordion's own C4 "Archivist" roadmap. v1 chunked compaction is strictly single-level and reuses `GroupCommand`; the open question is deferred to whatever effort takes on level-2 rollover (summary-of-summaries) — a follow-up map, not this one.

**Persisting group summaries to a per-session JSON file.** Rejected: with a deterministic digest, persistence has zero information content. The corpus content-hash IS the group's identity; the digest string is a pure function of the corpus. Persistence would add a file to GC, a version to migrate, and a corruption failure mode, for no gain over recomputation.

**Adding an observed cache-hit-rate signal to `ConductorView`.** Rejected: the trigger gate `estimatedGroupSaving ≥ max(2_000, 0.05 * cap)` already dominates the worst-case KV-break penalty by construction; runtime tuning based on hit rate cannot cross the break-even line without violating the invariant it was designed to protect. The observed rate is exposed via the JSONL diagnostic surface for offline analysis and the verification invariant.

## Consequences

**Preserved.** ADR-0002's Authoritative Accordion Folding Runtime is untouched: chunked compaction runs inside the per-session extension, uses only the existing `ConductorView` surface, and emits standard `GroupCommand`s. ADR-0003's Proactive Content Compression is untouched: MCP tool_results, recall results, and per-block structured `replace` commands continue to flow before the conductor sees them; the four-zone layout's groupability predicate (`!grouped && !held && !proactivelyCompressed`) explicitly walks around them.

**Additive changes.**

- One engine change: `substOne` frozen-region clamp bypass for `group` with non-null digest (§5). This is the sole load-bearing engine tweak.
- One conductor change: `MyCustomizeConductor` gains `attach(host)` and emits `conductor/status` metrics (§7.c).
- One extension change: `accordion.ts` appends a `chunkedCompaction` block to the per-turn JSONL on rollover turns (§7.c).
- One engine change: the fold-code resolver gains a policy branch for group-member codes → tail-append (§3.b). Specified in the PRD; not in the conductor contract.

**No change to.** `docs/conductor-protocol.md`, `ConductorView`, `ContextUpdateMessage`, `CONDUCTOR_PROTOCOL_VERSION`, `Command` union, any wire type. No cross-session shared cache. No user-facing setting.

**Immutability and irreversibility.** Group summaries emitted by chunked compaction are immutable once written — no re-summarising a prior group, no re-computing an existing digest under a new corpus. `GroupCommand` with `digest: null` (irreversible DROP) is not used by chunked compaction under any code path; the frozen-region clamp bypass (§5) applies only to `digest !== null`. DROP remains available to the pre-existing hard-pressure fallback, gated on `hasHardContextPressure()`.

**KV-cache invariant (verification claim).** At most one KV-cache-prefix break per rollover event, and the total count of such events matches the JSONL rollover count minus the ≤1 cold-start break, per §7.e. This invariant is the ADR's contract with the provider cache.

**Non-goals (currently listed under Not yet specified on the map).**

- **Level-2 rollover (summary-of-summaries)** when group summaries themselves accumulate. Likely a follow-up map keyed on accordion's C4 Archivist (see [ticket 10 findings](../../.scratch/accordion-chunked-compaction/tickets/10-findings.md)); scope of that map includes the open `era`/nest command contract question.
- **Interaction with other collaborative conductors** (`code-skeleton`, attention) when blocks that already went through skeletonisation later fall into the pre-group. v1 walks around them via the groupability predicate.
- **Behaviour under Pi's native `/compact`** (`session_before_compact` hook) when the four-zone layout is active.
- **Exact composition rule for the deterministic digest body** under §3.a — structural aggregation vs concatenated per-block `replace` outputs vs both. This is a PRD/implementation detail for the downstream map, not settled here.
- **GUI treatment** of chunked-compaction groups beyond reuse of the existing `group` rendering. If dashboards want a distinct visual, they pattern-match the `⟨chunked-compaction · …⟩` header.

**Out of scope (won't return without redrawing the destination).**

- Modifying `extension/store.svelte.ts` protected-tail semantics or `protectTokens` defaults.
- Non-additive changes to the conductor contract.
- Shipping chunked compaction as the default for conductors other than `my-customize-conductor`.
- Cross-session summary dedup or shared caches.
- Any code merged into `conductors/my-customize-conductor/` — implementation ships on a downstream map keyed on the PRD compiled by [ticket 12](../../.scratch/accordion-chunked-compaction/tickets/12-compile-prd.md).
