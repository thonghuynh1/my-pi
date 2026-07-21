> Historical path note: Accordion was later relocated to `extensions/accordion/` and `extensions/accordion/broker/` by `.scratch/accordion-first-party-extension/issues/01-adopt-accordion-as-first-party-extension.md`.

# Grill ledger — wayfinder ticket 07 (Tool-call/tool-result pair integrity across zone boundaries)

Map: `.scratch/accordion-chunked-compaction/MAP.md`
Ticket: `.scratch/accordion-chunked-compaction/tickets/07-tool-call-pair-integrity.md`
Type: `wayfinder:grilling` (HITL)
Blockers (both closed): 02-four-zone-layout, 06-group-representation
Status: **closed** — handoff `READY_FOR_PRD` confirmed by user.

## Sub-questions inherited from the ticket body

Q1. Legal cut points inside the pre-group — turn boundary? assistant-message boundary? never mid-tool-span?
Q2. If tail growth pushes the pre-group over cap mid-tool-span — temporarily exceed cap, or defer rollover?
Q3. Does the group summary preserve tool `callId`s that later tail messages reference?
Q4. Does the group summary carry fold codes forward so `recall` still resolves for a member id?

## Preliminary triage vs verified grounding

- **Q3 largely settled by grounding.** `app/src/lib/live/mapping.ts::applyPlan` runs a **tool-pair balance fixpoint** (Phase A): if a `tool_call` is inside a group's `ids` and its paired `tool_result` is outside (or vice versa), the straggler is *demoted to stay-live*. Orphans are unrepresentable on the wire. Ticket 07 doesn't need to re-decide this — it just needs to state that the conductor *should not rely on the fixpoint* to fix its own boundary choices (that would silently shrink groups and could zero the token saving, aborting the emit).
- **Q4 fully settled by ticket 06.** Group digest carries a `Members: {#a3f9} {#b7c2} …` recovery-codes footer, one deterministic `foldCode(memberId)` per member. Recall of any member code tail-appends via synthesized `recall(<code>)` tool_call/tool_result. Nothing new for ticket 07.
- **Q1 + Q2 are one design.** Both concern where the pre-group's edges may legally land relative to tool-pairs.
- Existing `isGroupBoundary()` (my-customize-conductor.ts:68) already treats `user` blocks as hard stops, but ticket 02's *walk-back* predicate deliberately narrows to `!grouped && !held && !proactivelyCompressed` and defers the tool-pair rule to this ticket.
- Left edge (walk-back) is elastic: we can always walk one more step back to close a pair. Right edge (`protectedFromIndex − 1`) is fixed by the host — a `tool_call` at `protectedFromIndex − 1` whose `tool_result` is at `protectedFromIndex` is the sharp case.

## Decisions

- **D1 — Right-edge tool-pair rule**
  - status: **accepted**
  - resolution: **contract-to-close**. Before emitting a `GroupCommand`, the conductor scans `group.ids`; for every `callId` referenced, if either half of the pair is outside `ids` (frozen prefix or protected tail), the *inside* half is removed from `ids`. Dropped block stays live between the group and the tail (or between the frozen prefix and the group).
  - rationale: keeps the pair-integrity invariant a *correctness* rule of the conductor, not a safety-net effect of `applyPlan`'s fixpoint. Prevents wasted broker calls on runs the engine would later shrink; keeps token-saving estimates honest. The four zones remain a *rendering* — at most a handful of live "seam" blocks decorate the boundary.

- **D2 — Left-edge (walk-back) rule**
  - status: **accepted**
  - resolution: **symmetric contract-to-close**. Same trim pass covers both edges: any `callId` with its partner outside `ids` loses its inside half. On the left this drops a leading `tool_result` whose paired `tool_call` sits in the frozen prefix; the pre-group effectively starts one block later. One rule, one pass, no asymmetry to remember.
  - note: this scenario is rare in practice (requires the paired `tool_call` to be `held` or `proactivelyCompressed`, both unusual for `tool_call` blocks), but the symmetric rule costs nothing to specify.

- **D3 — Overflow behavior mid-span**
  - status: **accepted** — *scope-boundary decision*, not a new invariant.
  - resolution: ticket 07's PRD contribution is the boundary **invariant** on `group.ids`. Trigger **cadence** — whether to defer firing during an active tool span for cost/coherence reasons — belongs to ticket 03. Contract-to-close removes the correctness motivation for holding off during an active span; 03 may still choose to defer for cost reasons, but not for pair integrity. The `PRE_GROUP_OVERFLOW_CAP = 1.25` elasticity established by ticket 02 is untouched.

- **D4 — `callId` preservation across a group**
  - status: **accepted (verified in code)** — `app/src/lib/live/mapping.ts::applyPlan` Phase A tool-pair balance fixpoint. D1's contract-to-close is the conductor-level pre-image of the same invariant, applied *before* the broker is called.

- **D5 — Fold-code carry-forward for recall of a group member**
  - status: **accepted (upstream, ticket 06)** — recovery-codes footer `Members: {#code} …` per member id via deterministic `foldCode(memberId)`; recall of a member code tail-appends a synthesised `recall(<code>)` tool_call/tool_result. Excluded seam blocks retain their natural (non-group) fold code — no collision.

## Handoff to ticket 03

Wire this ticket's decision into 03's grill: contract-to-close handles *correctness* for pair-integrity at every zone boundary regardless of trigger timing. 03 owns *when* to fire (including whether to defer during an active span for cost/coherence).

## Contracts (invariant statement for the PRD)

> For every `GroupCommand` emitted by `MyCustomizeConductor`, every `callId` referenced by any block in `group.ids` has both halves of its pair present in `group.ids`.
>
> Enforced by a pre-emit trim pass over the tentative `ids` (single linear scan, O(n) in run length), *before* the broker LLM is invoked and *before* `estimateDefaultGroupDigestCost(run)` is computed. If the trim leaves fewer than 2 members, the group is not emitted this cycle (same fallthrough as the existing `saving <= 0` guard).

## Proof (verification seams)

- Property test: generate `view.blocks` with a random `tool_call`/`tool_result` interleave; assert that for any `frozenFromIndex` / `protectedFromIndex` split, the conductor's emitted `group.ids` contains both halves of every `callId` it references, or neither.
- Regression test: the sharp case — `protectedFromIndex − 1` is a `tool_call`, `protectedFromIndex` is its `tool_result` — must produce a `group.ids` that excludes the trailing `tool_call`.
- Cost-honesty test: broker mock records how many blocks it was called on; assert it equals `|ids|` after the trim, never before.

## Grounding (concise pointers)

- `vendor/accordion/conductors/my-customize-conductor/my-customize-conductor.ts:68` — `isGroupBoundary()`; boundary set already includes `user`, `held`, `protected`, `grouped`, mcp/recall tool_results, pstack blocks.
- `vendor/accordion/conductors/my-customize-conductor/my-customize-conductor.ts:108–115` — `allCandidates` / `candidates` filters, showing `FOLDABLE_KINDS` excludes `tool_call`.
- `vendor/accordion/conductors/cold-score/score.ts:26` — `FOLDABLE_KINDS = { text, thinking, tool_result }` — `tool_call` never folds in place.
- `vendor/accordion/conductors/contract/conductor.ts` — "content substitution, never structural removal" invariant; `ClampReason: "not-foldable"` doc string.
- `vendor/accordion/app/src/lib/live/mapping.ts::applyPlan` Phase A — tool-pair balance fixpoint.
- Ticket 02 outcome: pre-group ends at `protectedFromIndex − 1`; walk-back predicate `!grouped && !held && !proactivelyCompressed`; `PRE_GROUP_OVERFLOW_CAP = 1.25`.
- Ticket 06 outcome: `Members: {#code} …` recovery footer; group-member recall = tail-append.
