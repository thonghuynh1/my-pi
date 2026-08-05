---
Status: resolved
Labels: wayfinder:task
Blocked-by: 
---

# Implement buildView() caching (decision from #04)

## Question

Implement the fix decided in [Should `buildView()` and `snapshotFoldState()` be cached or made incremental?](04-store-buildview-caching-decision.md) — **Option C**: eliminate the second `buildView()` call in `store.svelte.ts` at line ~1066 by reusing `availableCap()` from the first `buildView()` call at line ~1029.

### What to do

In `runConductor()` in `store.svelte.ts`:

1. At the first `buildView()` call (~line 1029), capture the view and extract `availableCap()`:
   ```ts
   const view = this.buildView(protectedFrom);
   const plan = this.conductor.conduct(view);
   const cap = availableCap(view);
   ```

2. At the second `buildView()` call (~line 1066), replace:
   ```ts
   if (createdGroup && this.liveTokens > availableCap(this.buildView(protectedFrom)) && this.conductor) {
   ```
   with:
   ```ts
   if (createdGroup && this.liveTokens > cap && this.conductor) {
   ```

The 5 budget scalars that `availableCap()` reads are stable within a single `runConductor()` invocation, so reuse is safe.

### Done when

- The second `buildView()` call is eliminated
- All existing tests pass

## Answer

Implemented in `extensions/accordion/app/src/lib/engine/store.svelte.ts` in `runConductor()`:

1. Captured the view from the first `buildView()` call and extracted `availableCap(view)` into a local `cap` variable before passing the view to `conductor.conduct()`.
2. Replaced the second `buildView()` call at the over-cap guard with the cached `cap` value.

The second `buildView()` call is eliminated. All 81+ existing tests pass.
