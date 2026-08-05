# Grounding — Browser Broker Freeze

## Existing Evidence (from PRD)

| ID | Source | Fact |
|---|---|---|
| G-01 | `store.svelte.ts:205,985` | `preGroupMemberIds = $state<string[]>([])` reassigned every `runConductor()` even when unchanged → spurious Svelte cascade |
| G-02 | `store.svelte.ts:864` | `isPreGroup()` uses O(n) `.includes()` per block |
| G-03 | `store.svelte.ts:928` | `normalizeConductorResult` allocates redundant `new Map(this.blocks.map(...))` |
| G-04 | `store.svelte.ts:949` | `runConductor` = 5× O(n) sub-passes per call |
| G-05 | `store.svelte.ts:1270,1299` | `setHarnessBreakdown` + `appendBlocks` each call `refold()` → 2–4 passes per sync |
| G-06 | `sessionSlots.svelte.ts:385,389` | Bug: blocks appended before harness (reversed order) |
| G-07 | `TileCanvas.svelte:253,257` | Ghost loop calls `scheduleRedraw()` (full) at 60fps |
| G-08 | `TileCanvas.svelte:171` | `schedulePartialRedraw(indices)` already exists |

## Broker-Specific Evidence

| ID | Source | Fact |
|---|---|---|
| G-09 | `brokerIntegration.svelte.ts` | Polls `/__accordion/sessions` every 2s via `setInterval` |
| G-10 | `sessionSlots.svelte.ts` | Per-slot WS connect; each session gets own store + conductor |
| G-11 | `brokerMode.ts` | `detectBrokerMode()` distinguishes broker vs direct mode |
| G-12 | broker architecture | Broker is transport-only; conductor runs per-store in browser main thread |

## New Scenario Parameters

- 500 blocks (vs PRD's 1000-block fixture)
- 500k context window (vs PRD's 150k scenario — much larger window)
- my-customize-conductor with active rollovers
- Freeze occurs specifically in browser broker mode
