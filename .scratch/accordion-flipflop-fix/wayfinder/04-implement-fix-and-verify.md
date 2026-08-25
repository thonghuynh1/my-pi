# 04 — Implement the fix and verify with tests

Type: task
Status: resolved
Blocked by: 01, 02, 03

## Question

After decisions 01–03 are resolved, implement the changes in `my-customize-conductor.ts` and verify.

## Answer

All fixes implemented and verified. **411 conductor tests pass** (43 in the my-customize-conductor suite, 3 new).

### Changes made:

**`my-customize-conductor.ts`** — 5 fixes:
1. **Removed restore phase** (~10 lines deleted) — no longer restores folded blocks in frozen prefix
2. **Clamped `rolloverFromIndex`** — added `rolloverFromIndex = Math.max(rolloverFromIndex, view.frozenFromIndex)` after barrier-skip loop
3. **`replayPriorCommands` replace guard** — added `block.order >= view.frozenFromIndex` to replace branch
4. **`planNormalPressure` frozen guard** — added `block.order >= view.frozenFromIndex` to candidate filter
5. **`planFoldsToCap` frozen guard** — added `if (block.order < view.frozenFromIndex) continue`
6. **Pre-guard frozen tracking** — added `lastFrozenFromIndex` field; all 3 fast-path guards and all 7 exit points now track/check `frozenFromIndex`

**`conductor.my-customize-conductor.test.ts`** — 3 new tests:
- `does NOT restore folded blocks inside the frozen prefix`
- `produces stable plans across turns (no flip-flop cycle)`
- `does not replay replace commands on frozen blocks`

**`conductor.compaction-naive.test.ts`** — 2 tests updated:
- `early rollover skips frozen-prefix blocks to preserve cache` (was: asserted old grouping behavior)
- `does NOT restore folded blocks in the frozen prefix` (was: asserted old restore behavior)
