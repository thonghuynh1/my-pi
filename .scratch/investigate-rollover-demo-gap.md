# Investigation: Rollover behavior in mock-server demo

## Summary

Two issues found with the mock-server demo using `my-customize-conductor`:

1. **Rollover was completely disabled** because `CW` sets both `contextWindow` and `budget`. With `CW=70000 < MIN_CONTEXT_WINDOW_FOR_CHUNKED_COMPACTION (128000)`, the rollover code path is gated off.
2. **After fixing contextWindow**, rollover fires but individual folds dominate (700+ folds vs 11 groups). The conductor's "group-first" intent is not realized.

## Issue 1: Rollover gated by context window size

### Root cause

```
mock-server.mjs:
  CW = 70,000 → sends as BOTH contextWindow AND budget

my-customize-conductor conduct():
  → chunkedCompaction.effectivePreGroupTokens(view, opts)
    → constants.ts line 3: MIN_CONTEXT_WINDOW_FOR_CHUNKED_COMPACTION = 128,000
    → chunked-compaction.ts line 33: if (view.contextWindow < 128_000) return 0
    → returns 0 → baseTarget = 0 → rolloverEnabled = false
```

### Fix applied

Added `CONTEXT_WINDOW` env variable to mock-server.mjs (separate from `CW` which controls budget):

```bash
CW=70000 CONTEXT_WINDOW=272000 GROW=1 TPS=5000 node mock-server.mjs
```

Now `contextWindow=272000` (above 128k threshold) and `budget=70000`. Rollover fires correctly.

### What the demo was actually showing before the fix

The `groups=1` in the original plan log was a **normal-pressure transient group** from `planNormalPressure()`, not a rollover group. The demo evidence summary mislabeled it as "stable 1-group rollover."

---

## Issue 2: Individual folds dominate over groups

With the fix applied (`contextWindow=272000, budget=70000`), rollover fires repeatedly. But individual folds grow much faster than groups:

```
groups=1  → folds=0
groups=2  → folds=2
groups=3  → folds=103
groups=4  → folds=273
groups=5  → folds=317
groups=7  → folds=496
groups=9  → folds=705
groups=11 → folds=774
```

### Why this happens

Three code paths emit individual fold/replace commands:

**1. `planFoldsToCap()` (lines 417–433)** — runs after EVERY rollover.

After a rollover saves ~15k tokens via a group, `liveTokens` is still massively over cap (800k - 15k still leaves ~715k over the 70k budget). This loops every foldable block in the old zone (index 0 to `preGroupFromIndex`) and individually folds/replaces them one by one until `projected <= cap`.

```ts
// Called at lines 661 and 698 after every rollover:
const folds = view.liveTokens > cap
  ? this.planFoldsToCap(view, preGroupFromIndex, cap, rollover.saving, consumed)
  : [];
```

**2. `planNormalPressure()` (lines 395–415)** — runs BETWEEN rollovers.

When rollover is blocked (pre-group hasn't accumulated 15k yet), this handles pressure. Creates one transient group from old-zone candidates, then individually folds every remaining block not in that group.

```ts
for (const block of candidates) {
  if (grouped.has(block.id) || ...) continue;
  this.foldOrReplace(commands, block.id);  // ← individual fold for EACH remaining block
}
```

**3. `replayPriorCommands()` (lines 189–220)** — replays `replace` commands from all prior plans.

Replace commands are re-stated in every subsequent plan (unlike `fold` which the engine persists). After 11 rollovers each emitting ~64 replaces, the plan carries forward ~700 replaces as the baseline. Plan size grows linearly with session length.

### The design gap

The conductor only groups the **pre-group window** (~15k tokens per rollover). Everything else in the old zone is handled by individual folds. In an 800k/70k session:

| Zone | Strategy | Size |
|------|----------|------|
| Protected tail | Untouched | ~20k |
| Pre-group window | Rollover group (~15k per fire) | ~15k |
| Old zone (0 to preGroupFromIndex) | Individual folds only | ~765k |

The old zone is 50x larger than the rollover window.

---

## Proposed fix: Group-first compaction

### Approach A: Larger rollover window

Instead of grouping only the pre-group window (~15k), the rollover should consume the entire available range from `frozenFromIndex` to the pre-group boundary. This creates fewer, larger groups.

```
Current:  rollover covers rolloverFromIndex → preGroupFromIndex (15k slice)
Proposed: rollover covers entire old zone → one big group per rollover
```

### Approach B: Replace `planFoldsToCap` with group batching

Instead of individually folding blocks after rollover, batch them into additional groups. The `sliceSegmentIntoGroups` helper already exists (used in the legacy non-harness path at line 363).

```ts
// Instead of:
const folds = this.planFoldsToCap(view, preGroupFromIndex, cap, rollover.saving, consumed);

// Do:
const oldZone = view.blocks.slice(view.frozenFromIndex, preGroupFromIndex)
  .filter(b => !b.held && !b.protected && !b.grouped && !excluded.has(b.id));
const groupCommands = [];
this.sliceSegmentIntoGroups(oldZone, view, minimumGroupSaving, groupCommands, onSaving);
// Only individually fold what couldn't be grouped:
const groupedIds = commandIds(groupCommands);
const remainingFolds = this.planFoldsToCap(view, preGroupFromIndex, cap, saving, new Set([...excluded, ...groupedIds]));
```

### Approach C: Eliminate between-rollover individual folds

Make `planNormalPressure` only emit groups (remove the individual fold loop at lines 407–413). Accept that `liveTokens` may stay above `cap` between rollovers. The next rollover catches up.

### Recommended: Approach B

Approach B is the least disruptive. It:
- Keeps the rollover cadence (one new group per 15k)
- Groups old-zone blocks instead of individually folding them
- Uses existing infrastructure (`sliceSegmentIntoGroups`)
- Reduces plan size from O(blocks) to O(groups)

### Trade-off: cache breaks

More groups = more cache-break events for the provider. The current design minimizes cache breaks (one per rollover) at the cost of many individual folds. If the intent is "group-first," accept the cache breaks. In practice with Anthropic's prompt caching, grouping 50+ blocks into one digest is still cheaper than listing 50 individual replace commands per plan.

---

## Key file locations

| Concern | File | Line |
|---|---|---|
| `MIN_CONTEXT_WINDOW_FOR_CHUNKED_COMPACTION` | `conductors/my-customize-conductor/constants.ts` | 3 |
| `effectivePreGroupTokens` gating | `conductors/my-customize-conductor/chunked-compaction.ts` | 33–36 |
| `baseTarget` / `rolloverEnabled` | `conductors/my-customize-conductor/my-customize-conductor.ts` | 559, 651 |
| `planFoldsToCap` (post-rollover folds) | `my-customize-conductor.ts` | 417–433 |
| `planNormalPressure` (between-rollover folds) | `my-customize-conductor.ts` | 395–415 |
| `replayPriorCommands` (replace accumulation) | `my-customize-conductor.ts` | 189–220 |
| `sliceSegmentIntoGroups` (existing group batcher) | `my-customize-conductor.ts` | 363–391 |
| `planFoldsToCap` called after rollover | `my-customize-conductor.ts` | 661, 698 |
| Mock-server CW/CONTEXT_WINDOW | `extension/mock-server.mjs` | 61–62 |

---

## How to reproduce

```bash
cd extensions/accordion/extension

# With the fix (separate contextWindow from budget):
CW=70000 CONTEXT_WINDOW=272000 GROW=1 TPS=5000 node mock-server.mjs

# Then connect app at localhost:1420 to port 4317 and play via localhost:4318
```

Watch the plan log: groups should grow but folds still dominate. The design intent is that groups should handle the bulk of compaction with minimal individual folds.
