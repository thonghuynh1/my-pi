# #01 — Relax pre-group accumulation boundary

**Type**: AFK · `ready-for-agent`
**Walking skeleton**: Yes (`US-001`)

## What to build

Decouple the pre-group accumulation boundary from the grouping boundary so the pre-group zone reliably crosses `user`/`mcp`/`recall`/pstack blocks, reaching ~15k tokens regardless of conversation shape. Blocks in the zone are never individually folded.

**Covers**: `DEC-001`, `US-001`, `RB-001`, `RB-002`, `RB-007`

## Implementation map

All edits are in `conductors/my-customize-conductor/my-customize-conductor.ts` (paths relative to repo root `C:\my-pi\extensions\accordion`).

### 1. Add `isAccumulationBoundary` function

Add a new function near `isChunkedPreGroupBoundary` (line 51). Only truly immovable barriers stop the pre-group walk:

```ts
function isAccumulationBoundary(block: ViewBlock): boolean {
    return block.held || block.grouped || block.proactivelyCompressed;
}
```

`DEC-001`: `isGroupBoundary` (line 45) and `isChunkedPreGroupBoundary` (line 51) must remain unchanged — they govern suffix grouping (`groupRuns`) and other boundary detection.

### 2. Change the `computePreGroupFromIndex` call

At line 169, replace the boundary function passed to `computePreGroupFromIndex`:

**Current** (line 168–170):
```ts
const preGroupFromIndex = preGroupTarget > 0
    ? chunkedCompaction.computePreGroupFromIndex(view, preGroupTarget, (block) => isChunkedPreGroupBoundary(block, pstackByBlockId))
    : view.protectedFromIndex;
```

**New**:
```ts
const preGroupFromIndex = preGroupTarget > 0
    ? chunkedCompaction.computePreGroupFromIndex(view, preGroupTarget, isAccumulationBoundary)
    : view.protectedFromIndex;
```

### 3. Update pre-group restore boundary consistency (`RB-007`)

The pre-group restore filter at the `isChunkedPreGroupBoundary` call for computing `preGroupFromIndex` is the only place the boundary function is used for pre-group zone computation. Since the restore logic operates on `preGroupBlocks` (derived from `preGroupFromIndex`), changing step 2 automatically makes the restore zone consistent. No separate edit needed for the restore filter itself — it already works on the `preGroupBlocks` slice.

### Tests

Tests are in `app/src/lib/engine/conductor.compaction-naive.test.ts`.

**New tests to add:**

1. **Pre-group zone crosses user blocks**: Create a view with `[tool_result] [user] [tool_result] [protected_tail]` where `contextWindow >= 128_000`. Assert the conductor does NOT fold/replace the `tool_result` before the `user` block. (Currently "blocks outside pre-group range remain fold candidates" at line 1889 asserts the opposite — that block IS folded. This test's setup has a `user` boundary block; the expectation for `old0` changes with the relaxed boundary.)

2. **Pre-group zone crosses MCP result blocks**: Create a view with `[tool_result] [mcp_tool_result] [tool_result] [protected_tail]`. Assert no fold/replace targets any of them.

3. **Pre-group zone still stops at held blocks**: Create a view with `[tool_result] [held_block] [tool_result] [protected_tail]`. Assert the `tool_result` before the `held` block IS a fold candidate.

4. **Regression — existing pre-group exclusion**: The test "pre-group blocks are excluded from fold candidates under budget pressure" (line 1851) should still pass unchanged.

5. **Regression — normal rollover**: The test "walking skeleton emits one chunked-compaction group" (line 1706) should still pass unchanged.

6. **Update "blocks outside pre-group range remain fold candidates"** (line 1889): This test has a `user` boundary block between `old0` and the pre-group zone. With the relaxed boundary, `old0` is now IN the pre-group zone and should NOT be folded. Update the expectation: `old0` should NOT appear in fold/replace commands.

**Run**:
```bash
cd app && npx vitest run src/lib/engine/conductor.compaction-naive
cd app && npx vitest run src/lib/engine/conductor.my-customize-conductor
```

## Acceptance criteria

- [ ] **Pre-group zone crosses user boundaries**
  - Run: `cd app && npx vitest run src/lib/engine/conductor.compaction-naive`
  - Expected: New test "pre-group zone crosses user blocks" passes — a `user` block between tool results does not stop the pre-group walk; no fold/replace targets any pre-group block

- [ ] **Pre-group zone crosses MCP boundaries**
  - Run: `cd app && npx vitest run src/lib/engine/conductor.compaction-naive`
  - Expected: New test "pre-group zone crosses MCP result blocks" passes — an `mcp` tool_result between blocks does not stop the walk

- [ ] **Pre-group zone still stops at held blocks**
  - Run: `cd app && npx vitest run src/lib/engine/conductor.compaction-naive`
  - Expected: New test passes — a `held` block stops the walk; blocks before it remain fold candidates

- [ ] **isGroupBoundary unchanged**
  - Run: `cd app && npx vitest run src/lib/engine/conductor.compaction-naive`
  - Expected: All existing suffix-grouping tests pass without modification (`RB-002`)

- [ ] **Existing regression suite green**
  - Run: `cd app && npx vitest run src/lib/engine/conductor.compaction-naive && npx vitest run src/lib/engine/conductor.my-customize-conductor`
  - Expected: All existing tests pass (with updated expectation for "blocks outside pre-group range remain fold candidates")

## Blocked by

None — can start immediately.
