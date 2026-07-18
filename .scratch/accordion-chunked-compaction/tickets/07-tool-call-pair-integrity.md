---
labels: wayfinder:grilling
status: closed
assignee: pi-agent
map: ../MAP.md
blocks: [02-four-zone-layout, 06-group-representation]
grill: ../../grills/wayfinder-07-a/ledger.md
---

# Tool-call / tool-result pair integrity across zone boundaries

## Question

The chunked layout means a rollover cut can land between a `tool_call` and its matching `tool_result`, which most providers reject. Define the rules:

- Where are the legal cut points inside the pre-group (turn boundaries only? assistant-message boundaries? never mid-tool-span?).
- If the tail pushes the pre-group over cap mid-tool-span, does the pre-group temporarily exceed its cap until the span closes, or do we defer a fold on that specific span?
- Does the group summary preserve tool `callId`s that are referenced later in the tail, or is that broken by design (since the group is opaque)?
- Analogous rule for `recall` handles: if a tail message references a fold-code that ended up inside the group summary, does the group summary carry the code forward so `recall` still resolves?

Related invariants already exist in `my-customize-conductor.ts` (`isGroupBoundary()`); reuse where possible.

## Resolution

**Contract-to-close** as the single conductor-level pair-integrity rule, applied symmetrically to both edges of the pre-group.

### The invariant (verbatim for the PRD)

> For every `GroupCommand` emitted by `MyCustomizeConductor`, every `callId` referenced by any block in `group.ids` has both halves of its pair present in `group.ids`.
>
> Enforced by a pre-emit trim pass over the tentative `ids`, *before* the digest is computed and *before* `estimateDefaultGroupDigestCost(run)` is evaluated. If the trim leaves fewer than 2 members, the group is not emitted this cycle (same fallthrough as the existing `saving <= 0` guard).

### How each sub-question resolves

- **Legal cut points.** Ticket 02's walk-back predicate `!grouped && !held && !proactivelyCompressed` is unchanged. Ticket 07 adds a *post-walk-back trim*: for every `callId` referenced by any block in `ids`, if either half of the pair is outside `ids`, the inside half is removed. Cut points are therefore *effectively* pair-boundary-aware without any change to the walk-back logic itself.
- **Mid-span overflow.** Ticket 07's contribution is the **invariant** on `group.ids`. Ticket 03's fast-path predicate consumes it as `noOpenToolPairAcrossPreGroupTail`; ticket 03's escape-valve force-alignment consumes it as the trim rule. The `PRE_GROUP_OVERFLOW_CAP = 1.25` elasticity from ticket 02 is untouched.
- **`callId` preservation.** Guaranteed structurally by `app/src/lib/live/mapping.ts::applyPlan` Phase A tool-pair balance fixpoint. Contract-to-close is the conductor-level pre-image of the same invariant, applied *before* digest emission so token-saving estimates stay honest and no work is spent on a run the engine would later shrink.
- **Fold-code carry-forward for `recall`.** Settled by ticket 06: the group digest ends in a `Members: {#code} …` recovery-codes footer, one deterministic `foldCode(memberId)` per member; recall of a member code tail-appends a synthesised `recall(<code>)` tool_call/tool_result. Blocks excluded from `ids` by contract-to-close retain their natural (non-group) fold code — no collision.

### Implementation shape (for the PRD)

In `MyCustomizeConductor.conduct()`, between `groupRuns` and `emitGroup`, one linear pass over the tentative run collects `callId → {inside, outsideLeft, outsideRight}`. Any `callId` with a partner outside removes its inside half from the run. Then the existing `saving <= 0` guard runs.

### Verification seams

- Property test over randomised `view.blocks` × `frozenFromIndex` × `protectedFromIndex` splits: emitted `group.ids` contains both halves of every referenced pair, or neither.
- Regression test: `protectedFromIndex − 1` is a `tool_call`, `protectedFromIndex` is its `tool_result` → emitted `ids` excludes the trailing `tool_call`, which stays live between the group and the tail.
- Cost-honesty test: digest cost estimate uses `|ids|` *after* trim, never before.

### Consumed by ticket 03

Ticket 03 (rollover trigger and batch policy) imports contract-to-close in two places:

1. **Fast-path trigger predicate.** 03's `noOpenToolPairAcrossPreGroupTail` = "for every `callId` in `blocks[preGroupFromIndex .. protectedFromIndex − 1]`, both halves of the pair are in that range." Boolean form of contract-to-close.
2. **Escape-valve force-alignment.** 03's "force-align backwards to the nearest safe boundary (leave trailing unsafe blocks in pre-group for the next rollover)" is the trim form: apply contract-to-close, and any blocks it drops stay live between the group and the tail until the next cycle.

Both are the same rule, applied in different situations. No new machinery on 03's side.


