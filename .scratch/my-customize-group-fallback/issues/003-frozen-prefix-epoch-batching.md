---
id: "003"
title: "Add epoch-batched frozen-prefix group fallback"
labels: [ready-for-agent]
depends_on:
  - .scratch/my-customize-group-fallback/issues/002-safe-group-boundaries-and-integration.md
status: closed
---
Status: ready-for-agent

# Add epoch-batched frozen-prefix group fallback

## What to build

Extend My Customize's existing cache-aware planning with a frozen-prefix grouping pressure valve. Non-frozen grouping must run first. Frozen blocks may be grouped only when the plan remains over cap, the total frozen-group saving is significant, and the same frozen grouping epoch has not already been emitted. Semantic-key changes and returning under cap must reset the epoch guard.

This slice implements `DEC-009` and completes the frozen-prefix portion of the group-fallback behavior from `DEC-002` and `DEC-003`.

User stories covered:

- Old frozen folded regions can escape persistent framing overhead when savings is significant.
- Provider-cache prefix invalidation happens rarely rather than every pass.
- Repeated identical passes remain deterministic and do not create new frozen regroup epochs.

## Implementation map

### Frozen-prefix epoch batching

**Code anchors:**

- `F:/MyWork/my-pi/vendor/accordion/conductors/my-customize-conductor/my-customize-conductor.ts`
  - `MyCustomizeConductor.conduct()`
  - `frozenFromIndex`
  - `lastPlan`, `lastSavings`, `lastSemanticKey`
  - existing `breakFrozen` fold/replace commands
- `F:/MyWork/my-pi/vendor/accordion/conductors/contract/conductor.ts`
  - `ConductorView.frozenFromIndex`
  - `ViewBlock.order`
  - `FoldCommand.breakFrozen` and `ReplaceCommand.breakFrozen`
- `F:/MyWork/my-pi/vendor/accordion/app/src/lib/engine/conductor.my-customize-conductor.test.ts`

The contract meaning of the frozen prefix is:

```ts
/** Index of the first block the conductor may fold. Blocks before this
 *  index are in the provider's prompt cache prefix. */
frozenFromIndex: number;
```

Required behavior:

1. Run non-frozen fold/replace planning and non-frozen grouping first.
2. Consider blocks with `order < view.frozenFromIndex` only if projected tokens are still above the cap.
3. Require total frozen-group saving of at least:

```ts
Math.max(2000, 0.05 * cap)
```

4. Add minimal inspectable state, such as a frozen-group epoch key, so an identical pass does not emit another frozen-prefix rewrite.
5. Reuse `lastSemanticKey` invalidation. A semantic-key change, including Poteto beacon state changes handled by the existing conductor, must invalidate the held frozen-group epoch.
6. Reset the frozen-group epoch when live/projected tokens fit under cap.
7. Preserve safe group boundaries and default digest/no-drop behavior from issue 002.

The state must remain internal to the conductor and synchronous. Do not alter provider cache tracking outside this conductor.

### Plan holding and savings

The existing held-plan behavior uses `lastPlan`, `lastSavings`, and semantic-key checks. Extend its accounting so group savings are included when determining whether a prior plan remains valid; otherwise a plan containing groups can be incorrectly held or recomputed. Preserve the existing external behavior of returning the same effective plan for an identical view/semantic key.

Frozen groups must obey the same single-disposition invariant as non-frozen groups: grouped IDs must not remain in ordinary fold, `breakFrozen` fold, or replace commands in the same returned batch.

## Acceptance criteria

- [ ] Running `cd F:/MyWork/my-pi/vendor/accordion/app && npx vitest run src/lib/engine/conductor.my-customize-conductor.test.ts` exits with code 0 and all frozen-prefix tests pass.
- [ ] A fixture where non-frozen planning reaches the cap asserts that no group contains any block with `order < frozenFromIndex`.
- [ ] A fixture still above cap whose frozen-group saving is below `Math.max(2000, 0.05 * cap)` asserts that no frozen-prefix group is emitted.
- [ ] A fixture still above cap whose frozen-group saving meets or exceeds `Math.max(2000, 0.05 * cap)` asserts that a group containing eligible frozen IDs is emitted.
- [ ] A second conduct pass over the identical view and semantic key asserts that no new frozen-prefix grouping epoch is emitted and the effective command plan remains unchanged.
- [ ] A test changing the semantic key, including the existing Poteto state transition fixture, asserts that the prior frozen-group epoch guard no longer suppresses a newly eligible frozen grouping plan.
- [ ] A test bringing live/projected tokens under cap asserts that the frozen-group epoch is reset, allowing a later over-cap epoch to be considered.
- [ ] A test asserts frozen grouped IDs do not also appear in fold, `breakFrozen` fold, or replace commands.
- [ ] A test asserts frozen groups use omitted `digest` and never `null` or empty digest, proving the completed path still uses the host recoverable group application.
- [ ] The focused Vitest command above fails if the implementation groups frozen content on every identical pass or bypasses the significant-savings threshold.

## Blocked by

- `.scratch/my-customize-group-fallback/issues/002-safe-group-boundaries-and-integration.md`
