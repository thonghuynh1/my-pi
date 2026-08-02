# Grounding — Accordion Large-Session Performance

## GROUND-001 — Store: preGroupMemberIds reactive state
- Source: `extensions/accordion/app/src/lib/engine/store.svelte.ts` → `AccordionStore` (line 110)
- Symbol: `private preGroupMemberIds = $state<string[]>([])` (line 205)
- Existing behavior: Reassigned on every `runConductor()` pass (line 985) even when content is unchanged. Triggers full Svelte reactive cascade through `preGroupIds` getter (line 870) into ContextMap derivations.
- Test prior art: `store.svelte.test.ts`, `store.test.ts`, `conductor.builtin.test.ts` — all import from `./store.svelte`

## GROUND-002 — Store: isPreGroup uses array .includes()
- Source: `extensions/accordion/app/src/lib/engine/store.svelte.ts` → `isPreGroup` (line 864)
- Existing behavior: `this.preGroupMemberIds.includes(id)` — O(n) per call. Called in `canFold()` which is invoked per-block in ContextMap derivations.
- Current excerpt: `return this.preGroupMemberIds.includes(id) && this.index.has(id);`

## GROUND-003 — Store: normalizeConductorResult allocates Map per pass
- Source: `extensions/accordion/app/src/lib/engine/store.svelte.ts` → `normalizeConductorResult` (line 928)
- Existing behavior: `new Map(this.blocks.map((block, index) => [block.id, index]))` on every conductor pass. Redundant — `this.index` already holds the same mapping.
- Current excerpt: `const blockOrder = new Map(this.blocks.map((block, index) => [block.id, index]));`

## GROUND-004 — Store: runConductor O(n) passes
- Source: `extensions/accordion/app/src/lib/engine/store.svelte.ts` → `runConductor` (line 949)
- Existing behavior: Each call performs: snapshotFoldState (O(n)), healProtected (O(n)), clearConductorState (O(n)), buildView (O(n) allocation), recordConductorTransitions (O(n)). Called via `refold()` (line 911).

## GROUND-005 — Store: appendBlocks and setHarnessBreakdown each call refold
- Source: `extensions/accordion/app/src/lib/engine/store.svelte.ts`
- `setHarnessBreakdown` (line 1270) → calls `refold()` at end
- `appendBlocks` (line 1299) → calls `refold()` at end
- Existing behavior: On a normal sync, 2 `refold()` calls. On full-reset, up to 4.

## GROUND-006 — liveClient sync handler: correct order
- Source: `extensions/accordion/app/src/lib/live/liveClient.svelte.ts`
- `setHarnessBreakdown` called at line 318
- `appendBlocks` called at line 383
- `computePlan()` called at line 384
- Existing behavior: Harness first (correct), then blocks, then plan read.

## GROUND-007 — sessionSlots sync handler: REVERSED order (bug)
- Source: `extensions/accordion/app/src/lib/live/sessionSlots.svelte.ts`
- `appendBlocks` called at line 385
- `setHarnessBreakdown` called at line 389
- Existing behavior: Blocks appended with stale harness data → first refold uses wrong frozenFromIndex.

## GROUND-008 — TileCanvas ghost loop: full redraw per frame
- Source: `extensions/accordion/app/src/lib/ui/map/TileCanvas.svelte`
- `startGhostLoop` at line 253
- `scheduleRedraw()` inside tick at line 257
- Existing behavior: Full O(n) canvas clear + redraw at 60fps while any ghost tiles exist.

## GROUND-009 — TileCanvas: schedulePartialRedraw exists
- Source: `extensions/accordion/app/src/lib/ui/map/TileCanvas.svelte` → `schedulePartialRedraw` (line 171)
- Existing behavior: Takes `indices: number[]`, adds to `partialDirty` Set, arms one rAF. Clears only affected tile rects. Already used for hover updates.

## GROUND-010 — TileCanvas: drawOneTile handles ghost opacity
- Source: `extensions/accordion/app/src/lib/ui/map/TileCanvas.svelte` → `drawOneTile` (line 218)
- Existing behavior: For ghost tiles, injects `ghostOpacity(ghostPhase)` into finalSpec before drawing. Works correctly with partial redraw — reads current `ghostPhase` at draw time.

## GROUND-011 — ContextMap: pre-group derivations added by this branch
- Source: `extensions/accordion/app/src/lib/ui/map/ContextMap.svelte`
- Added: `preGroupIds` (Set), `olderTiles` (.filter), `preGroupTiles` (.filter), `olderBlocks` (.filter), `preGroupSpecs`, `preGroupProgress`, `preGroupPhaseLabel`, `preGroupProgressText`
- Existing behavior (before branch): `olderTiles = tiles.slice(0, protectedFrom)` (no filter), `olderBlocks = store.blocks.slice(0, protectedFrom)` (no filter).
- After branch: All filter on `preGroupIds` which cascades from `store.preGroupIds` which changes on every `runConductor()` reassignment.

## GROUND-012 — Vitest config and test command
- Source: `extensions/accordion/app/vitest.config.ts`
- Aliases: `$conductors` → `../conductors/`, `$conductors/contract` → `../conductors/contract/`
- Test command: `cd extensions/accordion/app && vitest run`
- Engine tests: `vitest run src/lib/engine/`
- Svelte runes enabled via compiler option

## GROUND-013 — Real large-session fixture
- Source: `extensions/accordion/app/static/sample-session.jsonl`
- Content: 982 blocks, 147,110 fullTokens (real ArsenalChaos session)
- Used by: `conductor.builtin.test.ts`, `conductor.keel.test.ts`, `conductor.code-skeleton.test.ts`

## GROUND-014 — Store: this.index already maps id→position
- Source: `extensions/accordion/app/src/lib/engine/store.svelte.ts`
- `this.index: Map<string, number>` — maintained in lockstep with `this.blocks`
- Existing behavior: Used for O(1) deduplication in `appendBlocks`. Same data as the Map allocated inside `normalizeConductorResult`.
