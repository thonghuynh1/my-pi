# Grounding: Pre-Group Conductor Fixes

## Key Files
- `extensions/accordion/conductors/my-customize-conductor/my-customize-conductor.ts` — the conductor implementation
- `extensions/accordion/conductors/my-customize-conductor/chunked-compaction.ts` — `computePreGroupFromIndex`, `selectCompactionRange`
- `extensions/accordion/app/src/lib/engine/store.svelte.ts` — `clearConductorState()`, `runConductor()`, `fold()`, `pin()`
- `extensions/accordion/conductors/contract/conductor.ts` — `Conductor` interface, `ConductorView`
- `extensions/accordion/app/src/lib/engine/conductor.my-customize-conductor.test.ts` — test suite

## Current Behavior (bugs)
1. `planRollover` called with `view.frozenFromIndex` → held block at index 0 kills the range → no groups ever emitted.
2. Every `refold()` → `clearConductorState()` → `conduct()` recalculates from scratch → different boundaries → cache thrash.

## Store Group Preservation
- `clearConductorState()` preserves groups with `CHUNKED_COMPACTION_PREFIX` digest — these are all rollover groups.
- `replace` commands (`subst`) are wiped every pass — must be re-emitted.
- Human groups (`by:"you"`) always survive.

## Conductor State
- `lastPlan`, `lastResult`, `lastResultMemberKey` — memoization cache, never explicitly cleared.
- No `detach()` or `reset()` method exists.
- `rolloverCount`, `tokensSavedByRollover` — telemetry only.

## Dynamic Pre-Group Target (late attach)
- `preGroupTarget = max(baseTarget, liveTokens - cap)` when over budget.
- On mid-session attach (100k+, budget 70k): target inflates to ~130k → `preGroupFromIndex ≈ 0` → all history grouped in one pass.
- On normal accumulation: target = 15k (`DEFAULT_PRE_GROUP_TOKENS`).

## frozenFromIndex
- Computed by `cache-tracker.ts` — counts how many prefix messages are byte-identical to prior request.
- Cold start = 0. After successful compaction, advances to cover the cached prefix.
- Blocks before `frozenFromIndex` are in provider cache — free, don't need compaction.

## Test Anchors
- `"late attach compacts the complete non-protected history in one plan"` — 40 blocks × 4k, budget 70k, frozenFromIndex=0 → all grouped.
- `"stacks prior groups with a later rollover"` — second pass with frozenFromIndex=10, new blocks grouped separately.
- `"runs authoritative pre-group accumulation through rollover"` — FAILING: groups.length=0 after fold.
