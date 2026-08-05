---
Status: closed
Labels: wayfinder:grilling
Blocked-by: 01-profiling-dominant-freeze-contributor
Assigned-to: agent
---

# Should rollover-triggered conductor re-runs be deferred or batched?

## Question

When a rollover creates a group, `requestConductorRerun` triggers a **second** `conduct()` call within the same turn. At 500 blocks, each `conduct()` call has significant O(n) overhead (even with fast-path improvements), so doubling the calls doubles the main-thread blocking.

The re-run exists so the conductor can "plan folds against the committed group" — but is this truly needed synchronously within the same turn? Could the second pass be:

A. **Deferred to `requestAnimationFrame`** — let the UI paint between the two passes, preventing the freeze appearance even if total work is the same
B. **Batched with the next sync** — skip the immediate re-run and let the next incoming sync message trigger the conductor naturally
C. **Eliminated entirely** — if the rollover group is already committed, does the conductor really need to re-plan immediately? The next sync will trigger a plan anyway.
D. **Kept as-is** — if profiling shows the re-run is a minor contributor (e.g., the fast path fires on the second call because only a group was added), this may not be worth changing.

What are the correctness implications of deferring or skipping the re-run? Could the UI display a stale fold state between the two passes?

## Resolution

**Option B: Make the early over-cap rollover path self-sufficient (one pass, no re-run needed).**

### Findings

1. **The re-run exists for a valid reason**: the system is purely event-driven (no timers/polling). After a rollover group commits, if the session is still over budget and no new sync arrives, `requestConductorRerun` is the only mechanism that triggers another `conduct()` pass. Without it, the conductor stalls.

2. **But the re-run is currently broken**: `createGroup()` (store.svelte.ts:1831–1862) does not call `markDirty()`, so the O(1) pre-guard (my-customize-conductor.ts:449) returns the cached `lastResult` on pass 2 — the re-run is a no-op.

3. **Root cause — two rollover paths with different completeness**:
   - **Normal rollover** (`canRollover`, ~line 562): emits group command **+ fold commands** via `planFoldsToCap` → one pass is sufficient.
   - **Early over-cap rollover** (~line 583): emits group command **only**, no folds → depends on pass 2 for folds, but pass 2 is defeated by the pre-guard.

### Decision

Add `planFoldsToCap` to the early over-cap rollover path, mirroring the normal rollover path: `[...early.commands, ...folds]`. This makes one pass sufficient for both paths. The `requestConductorRerun` mechanism becomes truly inert (fast-path hit, harmless) — it can be removed as dead code later but there's no urgency.

### Key locations
- Early over-cap rollover path: `my-customize-conductor.ts` ~line 583
- Normal rollover path (model to follow): `my-customize-conductor.ts` ~line 562
- `planFoldsToCap`: same file
- `requestConductorRerun`: `store.svelte.ts:675`
- `createGroup` (missing `markDirty`): `store.svelte.ts:1831–1862`
