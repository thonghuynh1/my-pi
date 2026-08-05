# Grounding — Conductor Pre-Guard Restructure

## Key Files

| File | Symbol | Behavior |
|------|--------|----------|
| `extensions/accordion/conductors/my-customize-conductor/my-customize-conductor.ts` | `MyCustomizeConductor.conduct()` | Entry point; ~line 380. Computes viewKey, preGroup, replayPrior, pairSafe BEFORE fast-path guard at ~line 482 |
| same | `viewKey` (~line 444) | `view.blocks.map(b => b.id).join("\0")` — O(n) string alloc |
| same | fast-path guard (~line 482) | `!dirty && prevViewKey===viewKey && lastPlan && blockCount===lastBlockCount && cap<=lastCap && liveTokens<=hardCap` |
| `extensions/accordion/conductors/my-customize-conductor/chunked-compaction.ts` | `computePreGroupFromIndex()` | O(n) backward walk |
| same | `noOpenToolPairAcrossPreGroupTail()` | O(n) two-pass scan |
| `extensions/accordion/app/src/lib/engine/store.svelte.ts` | `AccordionStore.runConductor()` (~line 1004) | Calls `buildView()` then `conductor.conduct()` |
| same | `buildView()` (~line 1126) | O(n) ViewBlock[] construction |
| same | `appendBlocks()` (~line 1401) | Push-only; dedupes by ID |
| `extensions/accordion/app/src/lib/live/mapping.ts` | `blockId()` (lines 55–76) | Content-anchored, durable IDs |

## Block ID Stability

- IDs are content-anchored (`u:<ts>`, `a:<rid>:p<i>`, `r:<callId>`, `s:<ts>`)
- `isDurableId()` guards positional fallback IDs from folding
- No `replaceBlock`, `splice`, or index-based assignment in production
- Store block array is append-only (`this.blocks.push(...fresh)`)
- GroupOps affect pi-side message array only, not store blocks

## Dirty Flag

- `this.dirty` set by `markDirty()` — called on fold/pin/unfold state changes
- Reset at end of `conduct()` after plan is computed
