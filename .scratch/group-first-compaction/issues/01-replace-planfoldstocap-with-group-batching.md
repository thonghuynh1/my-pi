---
repo: F:/MyWork/my-pi
status: closed
---

## Parent

Wayfinder map: `.scratch/group-first-compaction/map.md`, Slice 1.

## What to build

Replace `planFoldsToCap` with chunked group batching. After rollover fires and `liveTokens > cap`, instead of emitting individual fold/replace commands per block, batch all eligible overflow blocks into chunked ~15k-token groups using the same slicing logic as `sliceSegmentIntoGroups`.

Covers decisions: 01 (chunked ~15k groups), 02 (lifecycle: "rollover"), 04 (trimOpenToolPairs inherited), 05 (no fallback — accept over-cap).

## Implementation map

**File:** `extensions/accordion/extension/conductors/my-customize-conductor/my-customize-conductor.ts`

### Current behavior (to remove)

`planFoldsToCap` (lines 417–437) loops blocks in `[0, min(preGroupFromIndex, protectedFromIndex))`, calling `foldOrReplace` per block until `projected <= cap`. Emits 0 groups, N individual fold/replace commands.

Called from:
- Line 661: `const folds = view.liveTokens > cap ? this.planFoldsToCap(view, preGroupFromIndex, cap, rollover.saving, consumed) : [];`
- Line 698: `const folds = view.liveTokens > cap ? this.planFoldsToCap(view, preGroupFromIndex, cap, early.saving, consumed) : [];`

### New behavior

Replace `planFoldsToCap` with a new method (e.g. `planOverflowGroups`) that:

1. Collects all eligible blocks in `[view.frozenFromIndex, min(preGroupFromIndex, protectedFromIndex))` — same filter as current: skip `excluded`, `held`, `protected`, `grouped`, non-`FOLDABLE_KINDS`, already-fully-folded.
2. Passes them to `sliceSegmentIntoGroups(segment, view, minimumSaving, out, onSaving)` which slices into ~`DEFAULT_PRE_GROUP_TOKENS` chunks and calls `createGroup` per chunk.
3. Each group gets `lifecycle: "rollover"` (already the default in `createGroup`).
4. Returns the group commands. No individual folds.
5. No cap check — group everything available, accept over-cap if grouping doesn't suffice (next cycle catches up).

### Call site changes

At lines 661 and 698, replace:
```ts
const folds = view.liveTokens > cap ? this.planFoldsToCap(...) : [];
```
With:
```ts
const overflowGroups = view.liveTokens > cap ? this.planOverflowGroups(view, preGroupFromIndex, consumed) : [];
```

Then merge into commands:
```ts
commands = [...rollover.commands, ...overflowGroups];
```

### Key constraints
- `createGroup` already calls `trimOpenToolPairs` internally — no special handling needed
- `createGroup` gates on `minimumSaving = max(2000, 0.05 * cap)` — keep this gate; blocks below threshold just stay uncompacted until next cycle
- `sliceSegmentIntoGroups` already exists (line 439) and does exactly this slicing — reuse it directly

## Acceptance criteria

- [ ] After rollover, overflow compaction emits only `kind: "group"` commands (no `kind: "fold"` or `kind: "replace"` from this path)
  - Run: `CW=70000 CONTEXT_WINDOW=272000 GROW=1 TPS=5000 node mock-server.mjs` and observe plan log
  - Expected: Plan commands after rollover are all groups; no individual fold/replace commands from overflow
  - Fails when: `planFoldsToCap` still exists or emits fold/replace commands

- [ ] Overflow groups use `lifecycle: "rollover"` and replay stably across cycles
  - Run: Same demo, observe plan across multiple cycles
  - Expected: Overflow groups appear in `replayPriorCommands` output on subsequent cycles (not re-derived)
  - Fails when: Groups are recreated from scratch each cycle

- [ ] Plan size is O(groups) not O(blocks) after overflow
  - Run: Same demo, count commands in plan log after 5+ rollovers
  - Expected: Total commands grow linearly with groups (~50 per overflow batch), not linearly with blocks (~700)
  - Fails when: Plan contains hundreds of individual fold/replace commands

## Blocked by

None - can start immediately.
