# #02 — Early rollover under budget pressure

**Type**: AFK · `ready-for-agent`

## What to build

When `liveTokens > cap` after exhausting non-pre-group fold candidates, flush the pre-group zone early via `selectCompactionRange` + `tryEmitGroup` instead of leaving the conductor stuck. This is the primary budget relief mechanism when the relaxed accumulation boundary (issue #01) causes most blocks to land in the pre-group zone.

**Covers**: `DEC-002`, `DEC-003`, `DEC-004`, `US-002`, `RB-003`, `RB-004`, `RB-005`, `RB-006`

## Implementation map

All edits are in `conductors/my-customize-conductor/my-customize-conductor.ts` (paths relative to repo root `C:\my-pi\extensions\accordion`).

### 1. Add early rollover check after the main fold loop

Insert between the main fold loop (ends around line 358 after the frozen `applyCandidate` loop) and the suffix grouping gate (`if (live > cap)` at line 394).

**`DEC-004` placement**: After the `applyCandidate` loops, before the `const groups: Command[] = []` line.

```ts
// Early rollover: flush pre-group zone under budget pressure (DEC-002)
if (live > cap && preGroupBlocks.length >= 2) {
    const range = chunkedCompaction.selectCompactionRange(view, preGroupFromIndex);
    const earlyCandidates = range
        ? view.blocks.slice(range.fromIndex, range.toIndexExclusive)
        : preGroupBlocks;
    const cmds = tryEmitGroup(earlyCandidates);
    if (cmds) return this.finishConduct(cmds, preGroupTokens, preGroupTarget, true);
}
```

**How this works:**

- `selectCompactionRange(view, preGroupFromIndex)` returns a contiguous range that crosses `user`/`mcp`/`recall` blocks (only stops at `held`/`grouped`/`proactivelyCompressed`). It trims current-turn blocks from the protected tail. (`GROUND-007`)
- `tryEmitGroup` (line 190) already:
  - Calls `trimOpenToolPairs` to prevent orphaned tool_call/tool_result pairs (`RB-005`)
  - Checks `minSaving = Math.max(2_000, 0.05 * cap)` — rejects groups too small to justify digest overhead (`RB-004`)
  - Increments `this.rolloverCount` and `this.tokensSavedByRollover` (`RB-006`)
  - Returns `null` when the group doesn't pass, falling through to suffix grouping and frozen-prefix breaking as normal
- `finishConduct(cmds, preGroupTokens, preGroupTarget, true)` records the rollover in status metrics (`RB-006`)

**`DEC-003` — No additional guards needed.** Groups produced by `selectCompactionRange` + `tryEmitGroup` may contain `user` and `tool_call` blocks. This is safe per ADR 0006: `wireFoldable` (digest.ts:54) blocks individual folds only; grouping is a separate mechanism that legitimately includes all block kinds. The group digest preserves 160-char excerpts per member and recall codes for full access.

### Producer from #01

This issue consumes the relaxed accumulation boundary from `01-relax-accumulation-boundary.md`:
- **Producer output**: `isAccumulationBoundary` function; `preGroupFromIndex` computed with relaxed boundary; `preGroupBlocks` includes blocks across user/MCP boundaries
- **Consumer input**: The early rollover reads `preGroupBlocks.length` and passes `preGroupFromIndex` to `selectCompactionRange`
- **Contract**: `preGroupBlocks` contains all non-held, non-grouped, non-proactivelyCompressed blocks from `preGroupFromIndex` to `protectedFromIndex`, regardless of block kind

### Tests

Tests are in `app/src/lib/engine/conductor.compaction-naive.test.ts`.

**New tests to add:**

1. **Early rollover fires under budget pressure**: Create a view with `contextWindow >= 128_000`, `liveTokens > budget` (over cap), and all non-pre-group candidates already folded (or none exist). The pre-group zone has < 15k tokens but >= 2 blocks with enough saving. Assert the plan contains a `group` command with a chunked-compaction digest.

2. **Early rollover skipped when under budget**: Same view but `liveTokens <= budget`. Assert no group command is emitted (normal pre-group accumulation continues).

3. **Early rollover respects minSaving**: Create a view where the pre-group zone has 2 blocks totaling ~200 tokens. `liveTokens > budget`. Assert no group command — the saving is below `max(2_000, 0.05 * cap)`.

4. **Early rollover includes non-foldable kinds**: Create a view with `[tool_result] [user] [text] [protected_tail]`, `liveTokens > budget`. Assert the emitted group's `ids` include the `user` block's id.

5. **Early rollover trims open tool pairs**: Create a view with `[tool_call(callId=X)] [tool_result(callId=Y)] [protected_tail(tool_result callId=X)]`. The `tool_call` straddles the group boundary. Assert the group's `ids` do not include the `tool_call`.

6. **Update "conductor returns empty plan when only pre-group blocks would be candidates"** (line 1875): With DEC-002, the conductor should now emit a group command instead of an empty plan when `liveTokens > cap`. Update the expectation.

**Run**:
```bash
cd app && npx vitest run src/lib/engine/conductor.compaction-naive
cd app && npx vitest run src/lib/engine/conductor.my-customize-conductor
```

## Acceptance criteria

- [ ] **Early rollover fires under budget pressure**
  - Run: `cd app && npx vitest run src/lib/engine/conductor.compaction-naive`
  - Expected: New test passes — when `liveTokens > cap` and only pre-group blocks remain, the plan contains a `{ kind: "group" }` command with digest starting with `⟨chunked-compaction ·`

- [ ] **Early rollover skipped when not over budget**
  - Run: `cd app && npx vitest run src/lib/engine/conductor.compaction-naive`
  - Expected: New test passes — when `liveTokens <= cap`, no group command is emitted despite pre-group blocks existing

- [ ] **minSaving guard rejects tiny groups**
  - Run: `cd app && npx vitest run src/lib/engine/conductor.compaction-naive`
  - Expected: New test passes — pre-group zone with ~200 total tokens under pressure produces no group command

- [ ] **Non-foldable kinds included in group**
  - Run: `cd app && npx vitest run src/lib/engine/conductor.compaction-naive`
  - Expected: New test passes — `user` block id appears in the group's `ids` array

- [ ] **Open tool pairs trimmed from early rollover group**
  - Run: `cd app && npx vitest run src/lib/engine/conductor.compaction-naive`
  - Expected: New test passes — straddling `tool_call` is excluded from group ids

- [ ] **Updated existing test expectation**
  - Run: `cd app && npx vitest run src/lib/engine/conductor.compaction-naive`
  - Expected: "conductor returns empty plan when only pre-group blocks would be candidates" updated to assert a group command instead of an empty plan; passes

- [ ] **Full regression suite green**
  - Run: `cd app && npx vitest run src/lib/engine/conductor.compaction-naive && npx vitest run src/lib/engine/conductor.my-customize-conductor`
  - Expected: All tests pass

## Blocked by

- `01-relax-accumulation-boundary.md`
