# Group-First Compaction

Status: ✅ destination-reached

## Destination

Replace the accordion conductor's individual-fold-heavy compaction with group-first compaction, so that rollover sessions produce O(groups) commands instead of O(blocks). After rollover fires, the old zone should be handled by batched groups (using existing `sliceCandidateRunsIntoGroups` infrastructure), with individual folds eliminated entirely.

## Notes

- Domain: accordion extension, `my-customize-conductor.ts`
- Key file: `extensions/accordion/extension/conductors/my-customize-conductor/my-customize-conductor.ts`
- Supporting: `chunked-compaction.ts`, `constants.ts`
- Issue 1 (rollover gated by context window) is already resolved — this effort focused solely on Issue 2.
- The investigation is documented in `.scratch/investigate-rollover-demo-gap.md`
- Three approaches were identified (A: larger rollover window, B: replace planFoldsToCap with group batching, C: eliminate between-rollover individual folds). Approach B was implemented and expanded to cover C as well.

## Decisions (all confirmed by build)

- [Single vs chunked groups](wayfinder/01-single-vs-chunked-groups.md): ✅ Chunked ~15k groups (Option B). Accept cache breaks for bounded digest quality and design consistency.
- [Overflow group lifecycle](wayfinder/02-overflow-group-lifecycle.md): ✅ `lifecycle: "rollover"` — persists, replays stably, crosses frozen boundary. Groups are the sole compaction primitive.
- [planNormalPressure scope](wayfinder/03-normal-pressure-scope.md): ✅ In scope — planNormalPressure also switches to group-only. No individual folds anywhere.
- [trimOpenToolPairs handling](wayfinder/04-trim-open-tool-pairs.md): ✅ Already handled internally by `createGroup`. No special logic needed.
- [Fallback strategy](wayfinder/05-fallback-strategy.md): ✅ No fallback. Accept over-cap temporarily; next cycle catches up. No individual folds ever.

## Issues (all closed)

- [01 — Replace planFoldsToCap with group batching](issues/01-replace-planfoldstocap-with-group-batching.md): ✅ Closed
- [02 — Remove individual folds from normal pressure](issues/02-remove-individual-folds-from-normal-pressure.md): ✅ Closed
- [03 — Remove dead fold code](issues/03-remove-dead-fold-code.md): ✅ Closed

## Not yet specified

_(cleared — all fog graduated to tickets and resolved)_

## Parked ideas

_(none)_

## Out of scope

- Issue 1 fix (already resolved — separate `CONTEXT_WINDOW` env var)
- Changes to the legacy (non-harness) code path
