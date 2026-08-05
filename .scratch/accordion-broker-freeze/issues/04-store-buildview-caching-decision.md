---
Status: resolved
Labels: wayfinder:grilling
---

# Should `buildView()` and `snapshotFoldState()` be cached or made incremental?

## Question

`AccordionStore.runConductor()` calls `buildView()` (O(n) — full `blocks.map(...)` creating fresh `ViewBlock[]`) and `snapshotFoldState()` (O(n) — full `Map` over all blocks) on **every** `refold()`. During group creation, `buildView()` fires a **second time** (line 1066) to check if liveTokens still exceed cap.

At 500 blocks these are ~1000 object allocations per refold, and a rollover turn triggers 2 refolds (initial + conductor re-run), so ~4000 objects per turn.

**Options:**

A. **Cache `buildView()`** with a version counter — only rebuild when blocks or fold state actually change. The `ViewBlock` shape is a projection of `Block` + fold state; if neither changed, the previous `ViewBlock[]` is valid.

B. **Make `snapshotFoldState()` incremental** — maintain a running snapshot and patch it on fold/unfold/group operations rather than rebuilding from scratch.

C. **Eliminate the second `buildView()` call** at line 1066 by reusing the view from line 1030 (it's still valid if only a group was created, not a fold change).

D. **Accept the cost** — if profiling (#01) shows these are minor contributors compared to the conductor's own O(n) work, skip this and focus on the conductor.

Which approach gives the best cost/complexity tradeoff? Does caching `buildView()` risk stale data if a fold operation mutates a block in-place?

## Answer

**Option C — eliminate the second `buildView()` at line 1066.** The call exists solely to feed `availableCap()`, which reads only 5 scalar budget fields (`budget`, `contextWindow`, `harnessOverhead`, `outputReserve`, `calibration`). Code verification confirmed none of these fields are mutated between the first `buildView()` (~line 1030) and the second (~line 1066) within `runConductor()` — `applyCommands()` only touches block-level fold state. The fix is to compute `availableCap()` once from the first view and reuse the value at line 1066. `this.liveTokens` (the left side of the comparison) is a `$derived` reactive sum that already reflects post-`applyCommands` mutations, so the comparison remains correct.

The other options are resolved without separate work:
- **Option A** (cache first `buildView()`) — subsumed by ticket #02/#03's fast-path guard, which skips `runConductor()` entirely (including `buildView()`) when nothing changed. When the guard falls through, blocks have actually changed, so a cache would invalidate anyway.
- **Option B** (incremental `snapshotFoldState()`) — `snapshotFoldState()` is purely journaling/diff infrastructure, not in the profiling top-3 from ticket #01. Not worth the complexity.
- **Option D** (accept the cost) — ruled out by ticket #01 profiling, which identified the second `buildView()` as a top-3 contributor to the ~32 O(n) passes per rollover sync.
