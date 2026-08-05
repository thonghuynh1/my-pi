---
Status: closed
Labels: wayfinder:research
---

# Profiling: Identify the dominant freeze contributor in browser broker mode

## Question

Which specific operation(s) dominate the main-thread blocking time when a 500-block / 500k-context session receives sync messages with active MyCustomizeConductor rollovers?

## Resolution

The freeze is **not a single dominant operation** but the **accumulation of ~32 distinct O(n) passes per sync message** during rollover events. At 500 blocks, this is ~16,000 block-operations in one synchronous main-thread block.

**Pass 1 (synchronous, `applySync → refold → runConductor → conduct()`):** ~22 O(n) passes including:
- Store overhead: `snapshotFoldState()`, `healProtected()`, `clearConductorState()`, `buildView()` ×2, `recordConductorTransitions()`, `liveTokens` $derived recompute
- Conductor pre-guard (unconditional): `viewKey` map+join, `computePreGroupFromIndex()`, preGroupBlocks filter+reduce, `replayPriorCommands()` (full Map), `noOpenToolPairAcrossPreGroupTail()`
- Conductor rollover path: `callById` Map, restores filter, `selectCompactionRange()`, turn accumulation, `trimOpenToolPairs()` (3 Maps from ALL blocks), second `replayPriorCommands()`, `planFoldsToCap()`

**Pass 2 (microtask via `requestConductorRerun`):** ~10 more O(n) passes (store overhead + conductor pre-guard work, even though fast-path fires).

**Top 3 actionable fixes by estimated impact:**
1. 🔴 `trimOpenToolPairs()` scans ALL 500 blocks to build 3 Maps, even though rollover candidates are a small slice → scope to candidates only
2. 🔴 Second `buildView()` at line 1066 allocates 500 ViewBlocks just to call `availableCap()` which only needs scalar fields → extract scalar-only path
3. 🟠 `viewKey` O(n) string construction runs before every fast-path check → replace with O(1) store version counter

**Validation:** Store timing test runs 982-block sample in 42ms (Node.js, no DOM). Browser overhead (Svelte 5 reactivity, DOM reconciliation, microtask second pass) pushes over 50ms jank threshold at rollover boundaries.
