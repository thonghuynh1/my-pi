---
repo: F:/MyWork/my-pi
status: closed
---

## Parent

Wayfinder map: `.scratch/group-first-compaction/map.md`, Slice 1.

## What to build

Remove individual folds from `planNormalPressure`. Currently it emits 1 transient group + N individual folds for leftover blocks. Change it to emit only groups (chunked, lifecycle: "rollover"), with no individual fold fallback.

Covers decisions: 03 (planNormalPressure in scope — group-only everywhere).

## Implementation map

**File:** `extensions/accordion/extension/conductors/my-customize-conductor/my-customize-conductor.ts`

### Current behavior (lines 395–415)

`planNormalPressure` collects eligible blocks in `[0, min(preGroupFromIndex, protectedFromIndex))`, creates one `"transient"` group via `createDefaultGroup`, then loops remaining ungrouped candidates calling `foldOrReplace` per block (lines 411–413):

```ts
for (const block of candidates) {
    if (grouped.has(block.id) || !FOLDABLE_KINDS.has(block.kind) || block.foldedTokens >= block.tokens) continue;
    this.foldOrReplace(commands, block.id);
}
```

### New behavior

1. Remove the `for...of` loop at lines 411–413 entirely.
2. Change the group from `"transient"` to `"rollover"` lifecycle (or replace `createDefaultGroup` with `sliceSegmentIntoGroups` to produce chunked rollover groups, consistent with issue 01).
3. Blocks that don't make it into any group (too small, trimmed by `trimOpenToolPairs`) simply stay uncompacted — next cycle catches up.

### Design choice

Two options for consistency:
- **Minimal:** Keep `createDefaultGroup` but change lifecycle to `"rollover"`, remove the fold loop. One group per normal-pressure event.
- **Consistent:** Replace with `sliceSegmentIntoGroups` (same as overflow path from issue 01). Multiple chunked groups.

Recommend: **Consistent** — use the same `sliceSegmentIntoGroups` path. One code path for all compaction.

## Acceptance criteria

- [ ] `planNormalPressure` emits zero individual fold/replace commands
  - Run: `CW=70000 CONTEXT_WINDOW=272000 GROW=1 TPS=5000 node mock-server.mjs`
  - Expected: Between rollovers, plan commands are only groups — no `kind: "fold"` or `kind: "replace"` from normal pressure
  - Fails when: The `foldOrReplace` loop still exists in `planNormalPressure`

- [ ] Normal-pressure groups use `lifecycle: "rollover"` and replay stably
  - Run: Same demo
  - Expected: Groups created by normal pressure persist in `replayPriorCommands`
  - Fails when: Groups are `"transient"` or recreated each cycle

## Blocked by

- `01-replace-planfoldstocap-with-group-batching.md`
