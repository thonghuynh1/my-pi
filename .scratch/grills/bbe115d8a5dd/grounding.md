# Grounding — Pre-group zone reliability

## Key files

| File | Role |
|------|------|
| `conductors/my-customize-conductor/my-customize-conductor.ts` | Conductor implementation — pre-group zone logic, fold/restore/group commands |
| `conductors/my-customize-conductor/chunked-compaction.ts` | `computePreGroupFromIndex`, `selectCompactionRange`, `trimOpenToolPairs` |
| `conductors/my-customize-conductor/constants.ts` | `DEFAULT_PRE_GROUP_TOKENS=15_000`, `PRE_GROUP_OVERFLOW_CAP=1.25` |
| `app/src/lib/engine/store.svelte.ts` | `clearConductorState` — clears conductor folds in non-frozen/non-protected suffix |
| `app/src/lib/engine/digest.ts` | `wireFoldable`, `FOLDABLE_KINDS` — the single foldability gate |
| `conductors/cold-score/score.ts` | `FOLDABLE_KINDS` (conductor-side) |
| `app/src/lib/engine/conductor.compaction-naive.test.ts` | Integration tests for chunked compaction and pre-group behavior |
| `app/src/lib/engine/conductor.my-customize-conductor.test.ts` | Conductor unit tests (no pre-group coverage currently) |

## Verified code anchors

### GROUND-001 — isChunkedPreGroupBoundary / isGroupBoundary
- Source: `conductors/my-customize-conductor/my-customize-conductor.ts` → `isGroupBoundary` (line 45), `isChunkedPreGroupBoundary` (line 51)
- Existing behavior: `isGroupBoundary` returns true for `user`, `held`, `protected`, `grouped`, `mcp`, `recall`, or pstack blocks. `isChunkedPreGroupBoundary` wraps it adding `proactivelyCompressed`.
- Current excerpt:
  ```ts
  function isGroupBoundary(block: ViewBlock, pstackByBlockId: Map<string, PstackIdentity>): boolean {
      if (block.kind === "user" || block.held || block.protected || block.grouped) return true;
      const tool = (block.toolName ?? "").trim().toLowerCase();
      return tool === "mcp" || tool === "recall" || pstackByBlockId.has(block.id);
  }
  function isChunkedPreGroupBoundary(block: ViewBlock, pstackByBlockId: Map<string, PstackIdentity>): boolean {
      return block.proactivelyCompressed || isGroupBoundary(block, pstackByBlockId);
  }
  ```
- Test prior art: `conductor.compaction-naive.test.ts` → "blocks outside pre-group range remain fold candidates" (line 1889)

### GROUND-002 — computePreGroupFromIndex call site
- Source: `conductors/my-customize-conductor/my-customize-conductor.ts` → line 169
- Existing behavior: Passes `isChunkedPreGroupBoundary` as the boundary function
- Current excerpt:
  ```ts
  const preGroupFromIndex = preGroupTarget > 0
      ? chunkedCompaction.computePreGroupFromIndex(view, preGroupTarget, (block) => isChunkedPreGroupBoundary(block, pstackByBlockId))
      : view.protectedFromIndex;
  ```

### GROUND-003 — computePreGroupFromIndex function
- Source: `conductors/my-customize-conductor/chunked-compaction.ts` → line 44
- Existing behavior: Walks backward from `protectedFromIndex`. If newest block is a boundary → returns `end` (empty pre-group). Stops at boundaries, caps at `target * PRE_GROUP_OVERFLOW_CAP`.

### GROUND-004 — tryEmitGroup helper
- Source: `conductors/my-customize-conductor/my-customize-conductor.ts` → line 190
- Existing behavior: Closure inside `conduct()`. Calls `trimOpenToolPairs`, computes `estimatedGroupSaving`, checks `minSaving = Math.max(2_000, 0.05 * cap)`, emits `{ kind: "group" }` command with chunked-compaction digest.

### GROUND-005 — Main fold loop
- Source: `conductors/my-customize-conductor/my-customize-conductor.ts` → line 355
- Existing behavior: `for (const b of sortCandidates(candidates))` — folds non-pre-group candidates until `live <= cap`.

### GROUND-006 — Suffix grouping gate
- Source: `conductors/my-customize-conductor/my-customize-conductor.ts` → line 394
- Existing behavior: `if (live > cap)` triggers `groupRuns` which splits at `isGroupBoundary` — fragments at user/MCP blocks.

### GROUND-007 — selectCompactionRange
- Source: `conductors/my-customize-conductor/chunked-compaction.ts` → line 247
- Existing behavior: Only stops at `held`/`grouped`/`proactivelyCompressed`. Crosses user/MCP/recall blocks. Trims current-turn blocks.

### GROUND-008 — FOLDABLE_KINDS / wireFoldable
- Source: `conductors/cold-score/score.ts` → line 33; `app/src/lib/engine/digest.ts` → line 54
- Existing behavior: `FOLDABLE_KINDS = Set(["text", "thinking", "tool_result"])`. `wireFoldable(b)` = `FOLDABLE_KINDS.has(b.kind)`. `user` and `tool_call` never individually folded. Grouping explicitly allowed to include them (digest.ts:50-52 comment, ADR 0006).

### GROUND-009 — clearConductorState
- Source: `app/src/lib/engine/store.svelte.ts` → line 989
- Existing behavior: Preserves folds for frozen prefix (`b.order < frozenFromIndex`) and protected tail. Clears all other conductor folds. Preserves chunked-compaction groups and frozen-prefix groups.

### GROUND-010 — Pre-group test suite
- Source: `app/src/lib/engine/conductor.compaction-naive.test.ts`
- Tests:
  - "pre-group blocks are excluded from fold candidates under budget pressure" (line 1851)
  - "conductor returns empty plan when only pre-group blocks would be candidates" (line 1875)
  - "blocks outside pre-group range remain fold candidates" (line 1889)
  - "pre-group exemption is a no-op when context window is below the chunked compaction gate" (line 1906)
  - "restores folded pre-group blocks that are in the frozen prefix" (line 1925)
- Note: `conductor.my-customize-conductor.test.ts` has zero pre-group tests
