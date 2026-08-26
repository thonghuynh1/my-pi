# Should planNormalPressure also switch to group-only?

Type: grilling
Status: resolved
Blocked by: 01

## Question

`planNormalPressure` currently emits 1 transient group + N individual folds for the remainder. With the `planFoldsToCap` fix in place, should `planNormalPressure` follow the same pattern (group batching instead of individual folds)?

Arguments for:
- Consistency — one compaction strategy everywhere
- Reduces plan noise between rollovers
- The same code path can be shared

Arguments against:
- `planNormalPressure` handles smaller pressure (not 700k over cap, just modest overshoot)
- The individual folds there may be for blocks too small to group (below `minimumSaving`)
- It's a separate concern from the main fix; can be done later

This is scoping: is it part of this effort's destination, or a follow-up?

## Answer

**Yes, in scope.** The design intent is that individual folds should not exist at all — all compaction uses groups. `planNormalPressure` must also switch to group-only. This is part of the same effort, not a follow-up.
