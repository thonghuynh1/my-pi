# Grill ledger — wayfinder ticket 02 (Define the four-zone layout precisely)

Ticket: `.scratch/accordion-chunked-compaction/tickets/02-four-zone-layout.md`
Map: `.scratch/accordion-chunked-compaction/MAP.md`
Type: `wayfinder:grilling` (HITL)
Claim: `pi-agent (grill session)`

## Decision plan

- **D1** — Where does the pre-group boundary live? (protocol field vs conductor-internal)
- **D2** — Pre-group token cap (value, tunability, absolute vs relative to `contextWindow`)
- **D3** — Precedence when zones overlap (pre-group ∩ frozen; pre-group ∩ protected)
- **D4** — Small-window fallback (32k class: tail + pre-group vs budget)

## Reading loaded

- ADR-0002 (thin — the normative contract lives in `store.svelte.ts:substOne`, `cache-tracker.ts:computeDiagnostics`).
- ADR-0003 (transport-layer precedent; ADR is silent on numeric threshold, small windows, and staging bands).
- `conductors/contract/conductor.ts:85–158` — `ConductorView` (10 fields, `frozenFromIndex` + `protectedFromIndex` are the only host-supplied indices; `availableCap()` = min(budget, contextWindow − overhead − reserve)).
- `conductors/contract/protocol.ts:25–77` — wire `ContextUpdateMessage` (v3); additive changes ship without version bump (precedent: `harnessOverhead`, `outputReserve`, `calibration` — optional, in-process only).
- `app/src/lib/engine/store.svelte.ts:824–847, 990, 1002, 1045–1116, 1629` — walk-back algorithm; `protectTokens = 20_000` default with ×1.25 overflow cap; `substOne` gate order (protected → frozen → grouped → held → proactivelyCompressed); groups refused inside protected tail; conductor state cleared each pass except folds inside protected or frozen regions.
- Ticket 01 resolution (destination: ADR-0004 accepted + PRD ready; no code lands this map).
- Findings tickets 08/09/10.

## D1 — Where does the pre-group boundary live?

Status: **accepted — Option A (conductor-internal).**

Answer:

- Pre-group span is a **conductor-internal derived index** in `MyCustomizeConductor`, computed each `conduct()` pass from `view.blocks[i].grouped` (+ `order`, `frozenFromIndex`, `protectedFromIndex`).
- **No** additions to `ConductorView` / `ContextUpdateMessage`. **No** `CONDUCTOR_PROTOCOL_VERSION` bump. `docs/conductor-protocol.md` is not touched.
- ADR-0004 phrases the four zones as **a rendering of existing wire state, not a new protocol surface** — an explicit constraint downstream implementers must not regrow into a protocol change. Zone → wire-state mapping the ADR must state verbatim:
  - **System + tool defs** ← `harnessOverhead` (already on the wire, optional).
  - **Immutable Group Summaries** ← contiguous prefix of `view.blocks` with `grouped: true` (after `frozenFromIndex`).
  - **Pre-Group (raw)** ← blocks with `!grouped` and `order < protectedFromIndex` and `order >= <last-grouped-index + 1>`; conductor-internal cursor.
  - **Protected Tail (raw)** ← `view.blocks[protectedFromIndex..]`.
- Rationale recorded: `ViewBlock.grouped` is host truth already; `frozenFromIndex`/`protectedFromIndex` are on the protocol only because they encode host-side policy the conductor cannot reconstruct — the pre-group boundary is *conductor policy* (rollover threshold), so it stays with the conductor. Reconsider promotion to an additive field only if a second conductor adopts chunked compaction (Milestone C4 map).

Closes sub-questions 2 and 4 of the ticket.

## D2 — Pre-group token cap

Split into three sub-decisions.

### D2a — Value

Status: **accepted — 15k**.

- `preGroupTokens = 15_000`. Ratio 3:4 with `protectTokens = 20_000` — chosen for symmetry with the tail, memorable, defensible.
- Rollover cadence at steady state (default budget ≈ 170k, million-token window): a broker call every ~14 aged turns, i.e. ~7 broker calls per 100 turns.
- Overrides the map's "~10k" note; MAP.md destination text should be updated on ticket 11 (ADR draft) or ticket 12 (PRD compile) to match. Log the drift so it's not silent.

### D2c — Sizing shape (absolute / relative / walk-back)

Status: **accepted — walk-back mirroring the protected-tail algorithm**.

- The pre-group's older edge is a **conductor-derived index** — call it `preGroupFromIndex` internally — computed each `conduct()` pass by walking backwards from `protectedFromIndex − 1`, accumulating `ViewBlock.tokens`, with the same whole-block overflow-cap idiom as `protectedFromIndex`.
- Concretely (mirrors `store.svelte.ts:824–847`):

  ```
  const PRE_GROUP_OVERFLOW_CAP = 1.25;  // same as PROTECT_OVERFLOW_CAP
  const target = effectivePreGroupTokens(view);  // 15_000 by default; see D4 for small-window clamp
  const cap = target * PRE_GROUP_OVERFLOW_CAP;   // hard ceiling 18_750
  // walk backwards from view.blocks[protectedFromIndex - 1], always include that block,
  // stop when sum >= target or next block would push sum > cap.
  // Result: preGroupFromIndex = first block in the pre-group.
  ```

- Rules mirrored verbatim from the tail walk-back:
  1. **The block immediately older than the tail is always included**, even if it alone exceeds `cap` (parity with "we always protect at least the newest block when target > 0").
  2. **Stop when the next block would exceed `cap`** (not `target`) — so the pre-group can grow up to 18 750 tokens before the older edge is frozen.
  3. If `protectedFromIndex == 0` (whole conversation is tail) → pre-group is empty.
  4. If `target == 0` → pre-group disabled; chunked compaction inert (parity with `protectTokens == 0` disabling the tail).
- Zone → wire-state mapping from D1 refines to:
  - **Pre-Group (raw)** ← `view.blocks[preGroupFromIndex .. protectedFromIndex - 1]`, with `!grouped` on every member (invariant: rollover moves the boundary; it doesn't fold inside the pre-group).
- ADR-0004 vocabulary reuses the ADR-0002 tail terminology. A reader who understands `protectedFromIndex` understands `preGroupFromIndex` in one sentence: "same walk-back, started one block earlier, 15k target, same 1.25 overflow cap."

Closes sub-question 1 of the ticket (the cap value and its mechanics) and reframes sub-question 5 as "how do zones overlap given the walk-back is bounded by `protectedFromIndex`" — handled in D3.

### D2b — Tunability surface

Status: **accepted — S2 (constructor option) with defaults hoisted into a constants file**.

- **Defaults live in a constants file** local to the conductor: `conductors/my-customize-conductor/constants.ts` (or nearest existing convention). Exports named constants — `DEFAULT_PRE_GROUP_TOKENS = 15_000`, `PRE_GROUP_OVERFLOW_CAP = 1.25`, and any siblings D3/D4 introduce.
- **`MyCustomizeConductor` accepts a `preGroupTokens: number` constructor option** with the constants-file default. Tests construct with small values (e.g. `500`) to exercise rollover paths deterministically. Not user-facing; no engine-side setting, no UI, no persistence path.
- **Naming symmetry with `protectTokens`** is deliberate: same suffix, same units (estimate tokens, chars/4), same `0` = disabled convention, same walk-back algorithm. ADR-0004 calls the symmetry out.
- **Promotion path**: if a second conductor adopts chunked compaction (Milestone C4 "The Archivist"), the constants file moves to a shared location (`conductors/contract/` or a new `conductors/shared/`) and the same constructor-option surface becomes the reuse story. No user-facing setting is introduced without a broader adoption case — keeps map Out-of-scope ("v1 lives in `my-customize-conductor` only") intact.
- **Additional constructor options right now**: keep the option surface **minimal** — only `preGroupTokens`. `PRE_GROUP_OVERFLOW_CAP` and any small-window fraction stay as constants-file exports, not options, until a test or a downstream conductor needs to vary them. Prevents API surface bloat during v1.

Closes D2 in full. Sub-question 1 of the ticket is fully resolved.

## D3 — Precedence when zones overlap

Split into sub-overlaps.

### D3a — pre-group ∩ frozen

Status: **accepted — P3′ (pre-group wins; engine gate relaxes for `group` commands with non-null digest)**.

Corrected framing (from the grill): the pre-group span *itself* is the region the provider caches between rollovers, because everything up to the tail edge is byte-identical request-over-request. Every rollover, by construction, emits a `group` command against blocks with `order < frozenFromIndex`. The overlap is not a rare edge — it is the steady-state case rollover is designed for.

Resolution (ADR-0004 must state verbatim):

1. **Rollover is designed as the sole KV-cache-prefix break event.** The MAP invariant “at most one KV-cache-prefix break per rollover” is preserved by fiat: exactly one `group` command per rollover, exactly one prefix-change event downstream.
2. **Engine change (small, additive) in `substOne`**: when `kind === "group"` and `digest !== null`, the frozen-region clamp is bypassed — no `breakFrozen` flag required, no `hasHardContextPressure()` gate. `fold`/`replace` gating is unchanged. Irreversible DROP (`group` with `digest: null`) inside frozen still requires `hasHardContextPressure()`. Reversibility is preserved by requiring `recoverable: true` on rollover groups.
3. **Wire shape unchanged.** No new command kind, no new field on `Command`, no protocol bump.
4. **Cache-tracker unchanged.** `computeDiagnostics()` observes the mismatch on the next request and updates `frozenFromIndex` naturally. Frozen edge re-climbs over 1–2 exchanges after each rollover.

Engine-change surface belongs to a downstream implementation issue on the PRD (ticket 12), keyed off this ADR paragraph.

### D3b — pre-group ∩ existing group

Status: **accepted — G1 (walk-back stops at any `grouped: true` block).**

- Stop condition added to the walk-back algorithm from D2c: also terminate when `blocks[i - 1].grouped === true`.
- Corollary invariant for ADR-0004: **the pre-group is always a contiguous run of `!grouped` blocks**, ending at `protectedFromIndex − 1`, of at most `preGroupTokens × 1.25` estimated tokens. It may be smaller than `preGroupTokens` when a group boundary bounds the walk-back.
- Rationale (recorded once, applies to D3c too): keeps v1 strictly single-level (MAP.md "Not yet specified" defers level-2 rollover); keeps the rollover corpus definition trivial (`blocks[preGroupFromIndex .. protectedFromIndex − 1]`, all `!grouped`); preserves the map's "Group summaries are immutable once written" preference by construction.
- **Cross-reference to closed ticket 06** (`MAP.md:51`): the recall-injection mechanism ("recall of a group-member code is a **tail-append** via synthesised `recall(<code>)` tool_call/tool_result, frozen prefix never rewritten") means `grouped: true` is a stable, permanent property of a block — recall doesn't un-group, it injects a copy at the tail edge. The walk-back's stop predicate `b.grouped === true` is not racing any state transition. Recalled blocks re-enter the pre-group as normal raw blocks after aging.

### D3c — pre-group ∩ non-groupable (`held`, `proactivelyCompressed`)

Status: **accepted — H2 (walk-back stops at any non-groupable block).**

- Unified stop condition (single rule, subsumes D3b): walk-back terminates when `blocks[i - 1]` fails **any** of `!grouped && !held && !proactivelyCompressed`.
- Consolidated invariant for ADR-0004: **the pre-group is a contiguous run of blocks, ending at `protectedFromIndex − 1`, all satisfying `!grouped && !held && !proactivelyCompressed`**, sized ≤ `preGroupTokens × 1.25`. Tool-pair atomicity (ticket 07) may further tighten the older edge to a safe boundary.
- The pre-group being under-target is expected steady state; rollover simply doesn't fire on passes where the walk-back is bounded away from `preGroupTokens` — no harm done (trigger detail: ticket 03).

D3 closed — sub-question 5 of the ticket is fully resolved (`protectedFromIndex` overlap is an invariant by construction; `frozenFromIndex` overlap resolved by P3′ in D3a; `grouped`/`held`/`proactivelyCompressed` overlaps unified under H2/G1).

## D4 — Small-`contextWindow` fallback (e.g. 32k where tail + pre-group exceed budget)

Status: **accepted — F1 with a `contextWindow`-based threshold at 128k**.

- **Threshold**: `view.contextWindow >= 128_000` → chunked compaction active. Otherwise disabled.
- **`contextWindow == null` (unknown provider)**: treated as below threshold → **disabled** (safe default; opt-in-by-window-size).
- **Rule**:
  ```ts
  function effectivePreGroupTokens(view, opts): number {
      if (view.contextWindow == null || view.contextWindow < MIN_CONTEXT_WINDOW_FOR_CHUNKED_COMPACTION) return 0;
      return opts.preGroupTokens;
  }
  ```
  Walk-back returns empty when the result is 0; rollover never fires; `MyCustomizeConductor` falls back to its non-grouping path with the tail untouched, no broker calls, no KV-cache-break events.
- **Constants-file entry** (from D2b): `MIN_CONTEXT_WINDOW_FOR_CHUNKED_COMPACTION = 128_000`.
- **ADR-0004 states**: *"Chunked compaction is designed for large context windows and is only active when `view.contextWindow >= 128_000`. On smaller or unknown windows, `effectivePreGroupTokens = 0` disables the pre-group and the conductor falls back to its non-grouping path."*
- **Testability**: two integration tests — one with `contextWindow = 200_000` proving chunked compaction fires, one with `contextWindow = 32_000` proving it doesn't; a third with `contextWindow = null` confirming the disabled default.

Closes sub-question 3 of the ticket.

---

## Ticket 02 — resolution summary

All five sub-questions of the ticket are resolved:

1. **Pre-group token cap** (D2): `preGroupTokens = 15_000` (constants-file default), constructor-option tunable, walk-back mirroring the protected-tail algorithm with `PRE_GROUP_OVERFLOW_CAP = 1.25` (hard limit 18 750).
2. **Interaction with `protectedFromIndex` / `frozenFromIndex`** (D1 + D3a): pre-group is a **conductor-internal derived index**, computed each pass from `view.blocks` — no protocol change, no bump. Rollover deliberately breaks the frozen prefix via a P3′ engine-gate relaxation (`group` commands with non-null `digest` bypass the frozen clamp; `fold`/`replace` gating unchanged; DROP still requires hard pressure).
3. **Small `contextWindow`** (D4): F1 disable below `contextWindow < 128_000` (and on null). No fractional scaling; clean testable claim.
4. **Zone location** (D1): entirely inside `MyCustomizeConductor`; four zones are a rendering of existing wire state, not a new protocol surface.
5. **Precedence when zones overlap** (D3): unified stop rule — walk-back terminates at any block failing `!grouped && !held && !proactivelyCompressed`. Pre-group ∩ protected impossible by construction. Pre-group ∩ frozen resolved by P3′.

### Ledger closed.

