# Candidate 2 — rationale

## Problem

Accordion currently crosses three coordinate systems without an explicit mapping:

1. the cache tracker counts provider messages;
2. `ConductorView.frozenFromIndex` promises a block boundary;
3. the store compares that value with `Block.order`.

In the broken run, provider messages grew by three per turn while Accordion blocks grew by two. Assigning `matchedPrefix - 1` directly to `frozenFromIndex` therefore advanced the block boundary faster than the block list. The store's defensive clamp made the value numerically valid but semantically wrong: by turn 8 every block appeared frozen.

The empty-plan branch compounded the drift by not recording the messages that were actually passed through. Each later comparison used a stale conversation baseline. At the same time, the conductor treated frozen content as unavailable until the real 1.1M context window overflowed. That policy cannot enforce a 70k product budget; the observed transcript reached roughly 840k while returning 120 empty plans.

The fix needs both accounting correctness and a budget escape path. Correct indexing alone can still produce a legitimately fully frozen prefix in a rapid append-only conversation. Conversely, allowing arbitrary soft-budget `breakFrozen` would hide the unit bug and turn every overage into cache churn.

## Usage (caller's view)

The extension builds one `ProjectedConversation` for the final messages selected for a model call. That value carries both outbound messages and their source block spans. It commits the projection on every delivered path:

```ts
const outbound = hasCommands(plan)
	? projectPlan(originalMessages, plan.ops, plan.groups)
	: projectPlan(originalMessages, [], []);

cacheTracker.commitConversation(outbound, provider);
return outbound.changed ? { messages: outbound.messages } : undefined;
```

The GUI continues to receive one number:

```ts
harness.frozenFromIndex = cacheTracker.currentFrozenBoundary().blockIndex;
```

The conductor API does not grow. `MyCustomizeConductor.conduct(view)` first compacts enough unfrozen material when possible. If unfrozen savings cannot reach `availableCap(view)`, it emits an atomic, turn-aligned rollover group over the smallest safe old range needed to close the remaining deficit. The protected tail and human-held blocks are never candidates.

Callers do not set `breakFrozen` for budget pressure. That flag remains reserved for per-block hard-window recovery.

## Shape

The design has two joined parts.

First, cache accounting becomes provenance-based. `projectPlan` records the exclusive source block boundary represented by each outbound Pi message. Prefix matching stays in message units. Only after matching does the tracker translate the safe matched prefix through those spans into a block boundary. Provider, system, and tool changes remain independent invalidators. A stable envelope plus equal outbound Pi messages is a conservative witness for an equal provider prefix; it no longer assumes equal cardinality.

The one-message cache safety margin remains, but it is applied before conversion:

```text
matched outbound messages
  → subtract one message
  → look up sourceBlockEnd
  → frozenFromIndex in block units
```

Every final outbound choice is committed, including an empty-plan passthrough. The baseline therefore describes what crossed the model-call boundary rather than only successful Accordion rewrites.

Second, budget enforcement becomes a pressure ladder:

1. replay valid committed groups;
2. use ordinary unfrozen pressure groups and rollover work;
3. calculate the residual saving required by `availableCap(view)`;
4. if legal unfrozen capacity is insufficient, perform one intentional budget rollover across the frozen boundary;
5. retain the existing hard-cap emergency for actual context-window overflow.

The budget rollover uses the existing `GroupCommand` with `lifecycle: "rollover"`. This command already represents an intentional cache-invalidating structural rebase and is host-permitted across the frozen boundary. It groups whole messages and complete turns, preserves tool pairs, and carries a semantic digest. The planner splits at held/grouped barriers and never scans beyond `protectedFromIndex`.

Pre-group release and command application are one transaction. IDs consumed by the budget rollover are omitted from the returned authoritative `preGroup` membership before the host validates the group, avoiding a self-inflicted `"pre-group"` clamp.

The public surface stays small:

- one provenance-bearing projection type in mapping;
- one block-branded frozen-boundary result in the cache tracker;
- no new command kind;
- no new conductor;
- no relaxation of `substOne`.

## Synthesis decision

candidate, not synthesized

## Tradeoffs accepted

An atomic rollover deliberately invalidates part of the prompt cache. That is preferable to silently violating the selected 70k budget for hundreds of turns. The invalidation is bounded: unfrozen material is always preferred, and the selected old range is only large enough to close the residual deficit.

Tracking projected Pi messages is conservative rather than pretending to reconstruct an undocumented provider conversion. Equal stable-envelope input produces equal provider-prefix content under deterministic conversion, while source spans provide the block conversion Accordion actually needs. If provider conversion becomes nondeterministic, the tracker should reset rather than infer a larger boundary.

Adding provenance to `applyPlan` increases mapping complexity, particularly for dropped groups. Keeping it beside the existing whole-message and tool-pair logic avoids duplicating those rules in the extension.

The planner may be unable to reach budget when protected tokens, human-held blocks, or irreducible user/tool-call content alone exceed the cap. It reports the residual instead of violating those invariants.

Semantic rollover groups can compact user and tool-call content that individual folds cannot. This is intentional and already part of group semantics, but digest quality matters more than for a per-block fold.

## Alternatives considered

**Run the current hard-cap emergency at the soft budget.** This would make the failing test pass quickly, but it grants broad per-block cached-prefix rewrite authority whenever the budget is exceeded. It does not fix the provider-message/block-index category error or the stale empty-plan baseline. It also tends toward many small cache breaks in rapid conversations.

**Cap `frozenFromIndex` at 70% of blocks.** Rejected because it lies about the provider prefix. A plausible-looking block number is still incorrect and can make the host mutate content it claims is cache-safe.

**Only convert `matchedPrefix` with `Math.min(blocks.length, matchedPrefix)`.** This is the current failure in a different form. Clamping prevents out-of-range values but cannot convert message units to block units.

**Observe empty plans only.** Necessary but insufficient. It repairs snapshot freshness, yet provider message counts still cannot be compared with block order, and a legitimately frozen over-budget history still stalls.

**Use only proactive fold-before-freeze thresholds keyed to turn size.** This reduces the probability of a stall, especially near the budget crossing, but cannot recover an already fully frozen session and cannot guarantee enough foldable content remains outside the protected tail.

**Add a new conductor specialized for frozen prefixes.** Rejected by constraint and by ownership: cache accounting belongs in mapping/tracking, while budget rollover is a mode of the existing rollover conductor.

**Always group the whole frozen prefix when over budget.** Simpler, but unnecessarily destroys cache value and may cross held barriers. The residual-saving planner first consumes unfrozen capacity and chooses the smallest safe old range.

## Open questions and risks

- Confirm that provider conversion is deterministic for stable provider/system/tools plus equal outbound Pi messages. If any provider injects per-request conversation fields, define a provider-specific canonicalizer that strips only documented volatile fields.
- Define provenance for a dropped group carefully: no output message owns the dropped range. The following span must still preserve monotonic source progress, or the tracker should conservatively stop the frozen boundary before that hole.
- Verify host ordering for `ConductorPlan.preGroup`. If pre-group ownership is currently installed after command application, the transaction order must change without exposing a transient invalid UI state.
- `GroupCommand.lifecycle: "rollover"` already crosses frozen content. Tests and comments currently imply that all frozen rewrites require hard-window pressure. The policy distinction must be explicit: per-block `breakFrozen` is hard-only; an atomic rollover group is allowed at an unsatisfied soft budget.
- Saving estimates must include the actual semantic digest token cost. A planner that uses only member tokens can still return a plan above cap.
- Multiple held barriers may require more than one rollover group. The preferred shape is one cache break, but correctness requires enough safe groups to close the deficit when a single contiguous range cannot.
- The protected tail can itself exceed the budget. That state is irreducible by design and should surface a diagnostic rather than loop.
- Stable-plan memoization must not retain a known under-budget-failing empty plan merely because block count and frozen boundary are unchanged.

## Next implementation step

Implement and test `projectPlan` provenance first, including multi-part assistant messages, tool results, summary groups, and drops. Then change cache-tracker tests to prove that matched message prefixes map to block boundaries and that empty plans advance the committed baseline. With the index trustworthy, add the residual budget-rollover planner and update the two policy tests to distinguish hard-only per-block rewrites from soft-budget atomic rollover groups.
