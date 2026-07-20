---
labels: wayfinder:grilling
status: done
claimed_by: pi-agent (grill session)
map: ../MAP.md
blocks: [01-destination-shape]
---

# Define the four-zone layout precisely

## Question

The layout is:

```
System + tool defs │ Immutable Group Summaries │ Pre-Group (raw, ≤ ~10k) │ Protected Tail (raw, ~20k)
```

Nail down the concrete numbers and mechanics:

- What is the **pre-group token cap** (10k default? tunable? relative to `contextWindow`?).
- How does the pre-group interact with the existing `protectedFromIndex` and `frozenFromIndex`? Is it a third derived index or purely a conductor-internal notion?
- What happens when `contextWindow` is small (e.g. 32k) and the tail + pre-group would exceed budget?
- Do the four zones live in `ConductorView` (protocol change) or entirely inside `MyCustomizeConductor` state?
- Precedence when zones overlap (e.g. a message that's both in the pre-group span and freshly frozen by the provider).

## Resolution

All five sub-questions resolved. The four zones are **a rendering of existing wire state, not a new protocol surface**.

### Zone → wire-state mapping

| Zone | Source of truth | On the wire? |
|------|-----------------|--------------|
| System + tool defs | `view.harnessOverhead` (optional field, already on the wire) | Yes |
| Immutable Group Summaries | Contiguous prefix of `view.blocks` with `grouped: true` after `frozenFromIndex` | Yes (via `ViewBlock.grouped`) |
| Pre-Group (raw) | `view.blocks[preGroupFromIndex .. protectedFromIndex − 1]` — conductor-internal derived index | No wire field; derived per `conduct()` pass |
| Protected Tail (raw) | `view.blocks[protectedFromIndex ..]` | Yes (via `protectedFromIndex`) |

**No changes to `ConductorView` / `ContextUpdateMessage` / `docs/conductor-protocol.md`. No `CONDUCTOR_PROTOCOL_VERSION` bump.** ADR-0004 must state this constraint verbatim so downstream implementers cannot quietly regrow it into a protocol change.

### Pre-group sizing (walk-back mirroring protected-tail)

- **`preGroupTokens` default = 15_000** (estimate tokens, chars/4). Overrides the ticket's original "≤ ~10k" note — chosen for 3:4 symmetry with `protectTokens = 20_000`.
- **Overflow cap = 1.25** (constant `PRE_GROUP_OVERFLOW_CAP` mirroring `PROTECT_OVERFLOW_CAP`). Hard ceiling 18_750.
- Walk-back algorithm (mirrors `store.svelte.ts:824–847`):
  1. Start at `view.blocks[protectedFromIndex − 1]`; always include that block (parity with tail's "newest block always included").
  2. Walk backwards summing `ViewBlock.tokens`; stop when `sum >= target` **or** next block would push `sum > target × 1.25` **or** next block fails the groupability predicate (below).
  3. **Groupability predicate**: `!grouped && !held && !proactivelyCompressed`. Walk-back terminates at any block failing any of these three.
  4. Result: `preGroupFromIndex` = first block in the pre-group. If `protectedFromIndex == 0` or `target == 0`, pre-group is empty.
- **Invariant**: the pre-group is always a contiguous run of blocks satisfying the groupability predicate, ending at `protectedFromIndex − 1`, sized ≤ `preGroupTokens × 1.25`. It may be under-target (rollover just doesn't fire that pass — trigger detail deferred to ticket 03).
- Tool-pair atomicity (ticket 07) may further tighten the older edge to a safe boundary.

### Tunability surface

- **Constants file** local to the conductor (`conductors/my-customize-conductor/constants.ts` or nearest existing convention). Exports `DEFAULT_PRE_GROUP_TOKENS = 15_000`, `PRE_GROUP_OVERFLOW_CAP = 1.25`, `MIN_CONTEXT_WINDOW_FOR_CHUNKED_COMPACTION = 128_000`, plus any siblings D3/D4 introduce.
- **Constructor option**: `MyCustomizeConductor` accepts `preGroupTokens: number` (default from constants file). Not user-facing. Not a UI setting. No persistence.
- **Naming symmetry with `protectTokens`** is deliberate: same suffix, same units, same `0 = disabled` convention, same walk-back algorithm. ADR-0004 calls the symmetry out.
- **Option surface stays minimal** — only `preGroupTokens`. `PRE_GROUP_OVERFLOW_CAP` and `MIN_CONTEXT_WINDOW_FOR_CHUNKED_COMPACTION` stay as constants-file exports until a test or downstream conductor needs to vary them.
- **Promotion path**: if a second conductor adopts chunked compaction (Milestone C4 "The Archivist"), the constants file moves to a shared location and the same constructor-option surface becomes the reuse story.

### Small-`contextWindow` fallback

- **`view.contextWindow >= 128_000`** → chunked compaction active with `preGroupTokens = 15_000`.
- **`view.contextWindow < 128_000` or `contextWindow == null`** → `effectivePreGroupTokens = 0`, walk-back returns empty, rollover never fires, `MyCustomizeConductor` falls back to its non-grouping path with the tail untouched.
- Concrete gate:

  ```ts
  function effectivePreGroupTokens(view, opts): number {
      if (view.contextWindow == null || view.contextWindow < MIN_CONTEXT_WINDOW_FOR_CHUNKED_COMPACTION) return 0;
      return opts.preGroupTokens;
  }
  ```
- No fractional scaling. Two integration tests suffice: `contextWindow = 200_000` (chunked compaction fires), `contextWindow = 32_000` (it doesn't), plus a `null` case confirming the disabled default.

### Zone overlap precedence

- **Pre-group ∩ protected**: impossible by construction — walk-back starts at `protectedFromIndex − 1`, so `preGroupFromIndex ≤ protectedFromIndex − 1` always. ADR-0004 states this invariant.
- **Pre-group ∩ frozen**: **rollover deliberately breaks the frozen prefix**. Every rollover is designed as the sole KV-cache-prefix-break event (MAP invariant: "at most one KV-cache-prefix break per rollover"). Requires a **small, additive engine change** in `substOne`: when `kind === "group" && digest !== null`, the frozen-region clamp is bypassed — no `breakFrozen` flag required, no `hasHardContextPressure()` gate. `fold`/`replace` gating is **unchanged**; irreversible DROP (`group` with `digest: null`) inside frozen still requires hard pressure. Reversibility preserved by requiring `recoverable: true` on rollover groups (backed by the MAP.md ticket-06 recall-injection mechanism: recall of a group-member code is a tail-append via synthesised `recall(<code>)` tool_call/tool_result, frozen prefix never rewritten). Engine change surface lands on a downstream implementation issue keyed off ADR-0004.
- **Pre-group ∩ existing group** (`grouped: true`): walk-back stops at the group boundary. Keeps v1 strictly single-level; level-2 rollover (summary-of-summaries) remains in MAP.md "Not yet specified".
- **Pre-group ∩ `held` / `proactivelyCompressed`**: walk-back stops (unified rule with `grouped`). Keeps group members contiguous by construction.

### Consequences for downstream tickets

- **Ticket 03 (rollover-trigger-policy)**: inherits the walk-back algorithm, `preGroupTokens = 15_000`, and the P3′ engine-gate relaxation. Must decide when a rollover *actually* fires given that the pre-group could be under-target for various reasons.
- **Ticket 05 (cache-invalidation-accounting)**: inherits the P3′ relaxation — exactly one KV-cache-prefix break per rollover, none between rollovers. Must specify the accounting (how the conductor measures and reports this).
- **Ticket 07 (tool-call-pair-integrity)**: inherits the walk-back's groupability predicate; must add tool-pair atomicity as a further stop condition (never split a `tool_call` from its `tool_result`).
- **Ticket 11 (draft ADR-0004)**: must include all invariants stated above verbatim (zone → wire-state mapping, walk-back algorithm, P3′ engine change, 128k threshold, groupability predicate), and the naming-symmetry paragraph.
- **Ticket 12 (compile PRD)**: must lift the downstream implementation surface (constants-file, constructor option, P3′ engine change in `substOne`) into concrete implementation tickets.

## Ledger

Private grill ledger: `.scratch/grills/wayfinder-02-a/ledger.md`.

