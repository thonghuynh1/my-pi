---
Status: research
---

# Rendering cascade during streaming causes real browser freeze

## Problem

Despite all conductor-level fixes (O(1) pre-guard, buildView caching, planFoldsToCap), the real browser UI remains frozen during broker streaming at 500 blocks / 500k context. The perf harness validated conductor logic in isolation (max 1.43ms/sync), but missed the **Svelte reactive cascade and DOM re-rendering** that happens in the real browser.

## Root Cause: Branch vs Main comparison

Comparing `feature/rebuild-my-conductor` to `main` reveals **three changes that compound into a rendering storm**:

### 1. `snapPair()` adds O(n²) to `protectedFromIndex` ($derived)

**Main:** `protectedFromIndex` is a simple O(n) walk-back over blocks.

**This branch:** Adds `snapPair()` inside the same `$derived.by()` — builds a `Set<callId>` of all tail blocks, then walks backward with nested forward scans. Worst-case O(n²) at 500 blocks = ~250k iterations per derivation.

This re-derives on **every sync** that adds a block (because `this.blocks` is `$state` and mutated by `_dedupeAndAppend`).

File: `extensions/accordion/app/src/lib/engine/store.svelte.ts` lines 875–905

### 2. Conductor pre-guard ineffective during streaming (every sync = full O(n) work)

**Main's conductor:** Had `HOLD_BAND = 0.9` epoch gating — if liveTokens < 90% of cap, returned the **cached plan unchanged** regardless of new blocks. This meant stable `preGroup.memberIds` across syncs.

**This branch's conductor:** Pre-guard checks `blockCount === this.lastBlockCount`. During streaming, EVERY sync adds a block → blockCount changes → pre-guard ALWAYS fails → full O(n) work runs:
- `viewKey = view.blocks.map(b => b.id).join("\u0000")` — creates large string (500 IDs)
- `preGroupBlocks` computation
- `preGroupMembers()` recalculation
- `noOpenToolPairAcrossPreGroupTail` O(n) scan

The secondary viewKey fast-path also checks `blockCount === this.lastBlockCount`, so it fails too.

File: `extensions/accordion/conductors/my-customize-conductor/my-customize-conductor.ts` lines 435–495

### 3. `preGroupMemberIds` instability → cascading tile re-renders

Because the conductor recalculates fully on every sync, and `protectedFromIndex` shifts by ±1 when a new block enters the tail, the pre-group window boundary moves. This means:

1. `preGroupMembers()` returns different IDs (±1 block at boundary)
2. Store: `preGroupMemberIds` updates (fails `arraysEqual`)
3. Store: `preGroupSet = $derived(new Set(...))` re-derives
4. ContextMap.svelte: `preGroupIds = $derived(new Set(store.preGroupIds))` re-derives
5. ContextMap.svelte: `olderTiles` re-filters all 500 tiles
6. ContextMap.svelte: `preGroupTiles` re-filters all 500 tiles
7. DOM: Svelte diffs and updates both tile lists

**On main**, the epoch hold returned cached memberIds → step 2 was skipped → no cascade.

## Combined effect during streaming

Per sync message (arriving every ~50-100ms during streaming):
- `snapPair` O(n²): ~2-5ms
- Full conductor work: ~3-5ms  
- `computeFoldOps` O(n): ~1ms
- Svelte $derived cascade (tiles, protectedTokens, liveTokens, olderTiles, preGroupTiles): ~2-5ms
- DOM re-render of tile grid: ~5-10ms

Total: **15-30ms per sync**. At streaming rates of 10-20 syncs/sec, this saturates 30-60% of the main thread, leaving no room for input event processing → UI feels frozen.

## Evidence

```
git diff main...HEAD -- extensions/accordion/app/src/lib/engine/store.svelte.ts
```
Shows `snapPair` addition (26 new lines inside `protectedFromIndex` $derived).

```
git diff main...HEAD -- extensions/accordion/conductors/my-customize-conductor/my-customize-conductor.ts
```
Shows entire conductor rewritten: HOLD_BAND epoch gating removed, replaced with blockCount-based pre-guard that fails on every streaming sync.

## Potential fixes

1. **Remove `snapPair` from `protectedFromIndex`** — enforce pair integrity at fold-time only (where it was already enforced), not at boundary construction. This restores O(n) derivation.

2. **Make conductor pre-guard blockCount-agnostic** — instead of `blockCount === lastBlockCount`, check whether the new blocks are all in the protected tail (outside the conductor's domain). If so, return cached result. OR restore the hold-band concept: if `liveTokens <= cap`, return cached.

3. **Stabilize `preGroupMemberIds`** — only update membership when the pre-group window actually gains/loses blocks that matter (not boundary jitter). Could use a dead-band: only update if ≥2 blocks changed.

4. **Debounce/batch syncs** — instead of processing each sync synchronously, batch syncs that arrive within 16ms (one frame) and process once.

## Acceptance

- ContextMap does NOT re-filter `olderTiles`/`preGroupTiles` on every sync during streaming
- `protectedFromIndex` derivation is O(n) not O(n²)
- Conductor returns cached result for syncs that only add blocks to the protected tail
- Real browser tab remains interactive (click/scroll responsive) during 500-block streaming
