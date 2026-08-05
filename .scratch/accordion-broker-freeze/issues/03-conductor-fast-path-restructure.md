---
Status: resolved
Labels: wayfinder:task
Blocked-by: 01-profiling-dominant-freeze-contributor, 02-conductor-pre-guard-restructure-decision
Assigned: agent
---

# Implement conductor fast-path restructure

## Question

Once the profiling results (ticket #01) confirm which operations dominate, and the restructuring approach is decided (ticket #02), implement the chosen fix in `my-customize-conductor.ts`.

This is a task ticket — the implementation follows directly from the decisions in #01 and #02. The answer records what was changed and the measured improvement.

## Answer

Implemented **Option D** (O(1) pre-guard + move O(n) work below guard) in `extensions/accordion/conductors/my-customize-conductor/my-customize-conductor.ts`.

### Changes made

1. **Added O(1) pre-guard** at the top of `conduct()`, immediately after computing three O(1) scalars (`cap`, `hardCap`, `blockCount`). The guard checks five scalar conditions:
   ```
   !this.dirty && this.lastResult && blockCount === this.lastBlockCount
   && cap <= this.lastCap && view.liveTokens <= hardCap
   ```
   When all pass, it returns `this.lastResult` directly — no `finishConduct()`, no status update, no O(n) work at all.

2. **Moved all O(n) work below the pre-guard**: `viewKey` (map+join), `computePreGroupFromIndex`, `preGroupBlocks` slice/filter/reduce chains, `replayPriorCommands`, `noOpenToolPairAcrossPreGroupTail`, and `newPreGroupTokens` now execute only when the pre-guard fails.

3. **Retained the existing fast-path guard** (with `viewKey` comparison) as a secondary defence after O(n) viewKey computation — no behavioral change to existing logic.

### Safety basis

Block IDs are content-anchored and append-only; `blockCount` unchanged + `!dirty` guarantees `viewKey` is unchanged. Proactive compression (PCC) never fires, so no additional edge cases. The secondary viewKey guard remains as a fallback.

### Validation

All 31 `conductor.my-customize-conductor.test.ts` tests pass. All 50 `conductor.test.ts` tests pass. No behavioral regressions.
