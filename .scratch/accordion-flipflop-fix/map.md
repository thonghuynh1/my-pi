# Wayfinder Map: Accordion my-customize-conductor flip-flop fix

Status: wayfinder:map

## Destination

Eliminate the fold/unfold flip-flop cycle in `my-customize-conductor` when running with a 70k budget against a cold-start ~120k context. After this fix, blocks folded into the provider's cached prefix stay folded — no random restores that break cache and trigger compensating folds on other blocks. The conductor should produce stable fold plans that preserve the prompt cache across turns.

## Notes

- Domain: `extensions/accordion/conductors/my-customize-conductor/`
- Key files: `my-customize-conductor.ts`, `chunked-compaction.ts`, `constants.ts`
- Contract file: `conductors/contract/conductor.ts` (`availableCap`, `ConductorView`)
- The conductor is rollover-only: it accumulates a pre-group window, then emits one cache-breaking batch of turn-aligned groups
- `frozenFromIndex` tracks the provider's cached prefix boundary (from `cache-tracker.ts`)
- The problem manifests when `preGroupTarget > 0` (contextWindow ≥ 128k) AND there are folded blocks inside the frozen prefix

## Decisions so far

- [Restore-in-frozen-prefix causes the flip-flop cycle](wayfinder/01-restore-in-frozen-prefix.md): Remove the restore phase entirely — never unfold frozen-prefix blocks. They're already compacted and cached.
- [Rollover fromIndex should respect frozen boundary](wayfinder/02-rollover-from-index-frozen-boundary.md): Clamp `rolloverFromIndex` to `Math.max(frozenFromIndex, ...)` so rollover never touches the cached prefix.
- [Implement the fix and verify with tests](wayfinder/04-implement-fix-and-verify.md): All 5 code changes + `lastFrozenFromIndex` tracking applied; 411 tests pass, 3 new tests cover the flip-flop scenario.

## Not yet specified

- Whether the digest precomputation batch (50 blocks/call) setting `dirty = true` each batch contributes to instability during the first few turns of a cold-start session (secondary concern — the restore flip-flop is the primary driver)

## Parked ideas

## Out of scope

- Changes to the conductor contract (`conductor.ts`)
- Changes to the cache-tracker itself
- Changes to the extension's `accordion.ts` host layer
- Builtin conductor or keel conductor changes
