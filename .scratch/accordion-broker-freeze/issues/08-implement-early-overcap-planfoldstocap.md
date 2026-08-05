---
Status: closed
Labels: wayfinder:task
Blocked-by: 
Assigned-to: agent
---

# Implement planFoldsToCap in early over-cap rollover path (decision from #05)

## Question

Implement the fix decided in [Should rollover-triggered conductor re-runs be deferred or batched?](05-conductor-rerun-deferral-decision.md) — **Option B**: make the early over-cap rollover path self-sufficient by adding `planFoldsToCap` so one pass emits both the rollover group + fold commands.

### What to do

In `my-customize-conductor.ts`, in the early over-cap rollover path (lines ~582–614):

1. After the early rollover is planned, add a `planFoldsToCap` call to emit fold commands alongside the group commands — mirroring how the normal rollover path at line ~569 does it.

2. This makes the early path self-sufficient: one `conduct()` call produces a complete plan (group + folds), so `requestConductorRerun` in `store.svelte.ts` becomes a no-op (the second pass would hit the O(1) pre-guard and return cached `lastResult`).

### Root cause context

The re-run was valid (prevents conductor stall) but broken because `createGroup()` (`store.svelte.ts:1831–1862`) never calls `markDirty()`, so pass 2 returns the cached plan anyway. Adding `planFoldsToCap` to the early path makes the first pass complete, removing the need for a second pass entirely.

### Done when

- The early over-cap rollover path in `conduct()` includes `planFoldsToCap`
- `requestConductorRerun` is effectively inert (the second pass returns cached result)
- All existing tests pass

## Resolution

Added `planFoldsToCap` call to the early over-cap rollover path in `my-customize-conductor.ts` (line ~604), mirroring the normal rollover path exactly:

```typescript
const consumed = commandIds(early.commands);
const folds = view.liveTokens > cap ? this.planFoldsToCap(view, preGroupFromIndex, cap, early.saving, consumed) : [];
const commands = [...early.commands, ...folds];
const plan = [...this.replayPriorCommands(view, commandIds(commands)), ...commands];
```

The early path now produces a complete plan (group + folds) in one pass. `replayPriorCommands` also receives the combined command IDs (including fold IDs) so prior commands are correctly replayed. All 95 tests pass (31 my-customize-conductor + 64 conductor/store).
