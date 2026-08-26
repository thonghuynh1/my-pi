# Group-first compaction: eliminate individual folds

## 🔄 What this changes

- **All compaction now uses groups exclusively.** The conductor no longer emits individual `fold` or `foldOrReplace` commands — every compaction action is a batched `group` command with `lifecycle: "rollover"`.

- **`planFoldsToCap` → `planOverflowGroups`:** The old overflow handler folded blocks one-by-one until under cap. The replacement routes overflow candidates through `sliceCandidateRunsIntoGroups`, producing ~15k-token rollover groups.

- **`planNormalPressure` simplified:** Previously created one group then fell back to per-block folds for the remainder. Now everything goes through group batching — no fallback path.

- **Dead code removed (net −115 lines):** `foldOrReplace`, `precomputeDigests`, `findPairedArgs`, `detach`, and the per-block digest cache are all gone.

- **Group boundary preservation:** `sliceCandidateRunsIntoGroups` (renamed from `sliceSegmentIntoGroups`) correctly handles non-contiguous candidate lists by splitting on gaps and trimming partial turns at run edges before grouping.

- **Cache-safe by design:** Ungrouped blocks (MCP/recall boundaries, sub-threshold residue, non-foldable kinds) sit passively without breaking cache. Only rollover groups cross the frozen boundary (controlled, one-time). No emergency path triggers unless the real context window overflows.

---

## 🔍 How to review

- **Start here** — `extensions/accordion/extension/conductors/my-customize-conductor/my-customize-conductor.ts`
  - Look at `sliceCandidateRunsIntoGroups` (line ~368) for the core batching logic
  - Look at `planOverflowGroups` for the new overflow path
  - Note that `planNormalPressure` no longer has a for-loop fallback

- **Proof** — `conductor.my-customize-conductor.test.ts` (14 group-specific tests passing)
  - `frozen-prefix-evidence.test.ts`: 6-turn lifecycle showing `folds=0, groups=6` every turn
  - Run: `cd extensions/accordion/app && npx vitest run conductor`

- **Watch for** — The rename from `sliceSegmentIntoGroups` → `sliceCandidateRunsIntoGroups` touches multiple call sites. The logic change is in the body: it now detects non-contiguous gaps and flushes runs independently.
