---
repo: F:/MyWork/my-pi/extensions/accordion
status: closed
---

## Parent

[Wayfinder map](../map.md) — Slice 5. Covers ticket [08 — Remove PCC](../wayfinder/08-remove-pcc.md), decisions D31 (remove PCC), D33 (remove from ClampReason).

## What to build

Remove all remaining PCC artifacts from the type system, store guards, conductor contract, wire protocol mapping, UI, and tests. After this issue, zero references to `proactivelyCompressed` or `_pccCompressed` remain in the codebase.

## Implementation map

### Remove from type system

1. **`app/src/lib/engine/types.ts:57`** — Remove `proactivelyCompressed: boolean` from `Block` type.

2. **`app/src/lib/live/protocol.ts:68`** — Remove `proactivelyCompressed: boolean` from `WireBlock` type.

3. **`conductors/contract/conductor.ts:66`** — Remove `proactivelyCompressed: boolean` from `ViewBlock` type.

### Remove from wire mapping

4. **`app/src/lib/live/mapping.ts:207`** — In `linearize()`, remove `proactivelyCompressed: !!m._pccCompressed` from the block construction.

5. **`app/src/lib/live/mapping.ts:236`** — In `wireToBlock()`, remove `proactivelyCompressed: !!w.proactivelyCompressed` from the block construction.

6. **`app/src/lib/live/mapping.ts:~54`** — Remove `_pccCompressed` from the internal message type if present.

### Remove from store guard

7. **`app/src/lib/engine/store.svelte.ts:1223–1230`** — In `substOne()`, remove the PCC guard block:
   ```ts
   if (b.proactivelyCompressed)
       return void reports.push(clamp(kind, [id], "proactively-compressed",
           `${label(b)} was proactively compressed — recall-only`));
   ```
   The guard chain becomes: `unknown-id → human-override → pre-group → grouped → protected → frozen`.

### Remove from conductor contract

8. **`conductors/contract/conductor.ts:335`** — Remove `"proactively-compressed"` from the `ClampReason` union type.

### Remove from conductor candidate filtering

9. **`conductors/my-customize-conductor/my-customize-conductor.ts`** — At ~lines 76, 358, 379, 402, 428, 480, 647: remove `proactivelyCompressed` from candidate exclusion guards (where PCC blocks are skipped alongside `held` / `grouped`). These are conditions like:
   ```ts
   if (b.held || b.grouped || b.proactivelyCompressed) continue;
   ```
   Simplify to:
   ```ts
   if (b.held || b.grouped) continue;
   ```

### Remove from ViewBlock construction in store

10. **`app/src/lib/engine/store.svelte.ts:1149`** — Remove `proactivelyCompressed` from ViewBlock construction.

### Remove from Inspector UI

11. **`app/src/lib/ui/map/Inspector.svelte:229`** — Remove PCC pill rendering.
12. **`app/src/lib/ui/map/Inspector.svelte:282`** — Remove PCC-based fold/unfold button disable logic.
13. **`app/src/lib/ui/map/Inspector.svelte:319–325`** — Remove PCC tooltip text.

### Remove PCC-specific tests

14. **`app/src/lib/engine/store.foldgate.test.ts:295–367`** — Remove PCC-specific test cases:
    - Test that fold with `breakFrozen=true` on PCC block is clamped
    - Test that replace on PCC block is clamped
    - Keep any nearby non-PCC tests intact

### Cleanup pass

15. After all removals, grep for any remaining references:
    ```
    grep -rn "proactivelyCompressed\|proactively-compressed\|_pccCompressed\|pcc\|PCC" --include="*.ts" --include="*.svelte"
    ```
    Remove any stragglers (comments, type guards, diagnostics).

## Acceptance criteria

- [ ] Zero references to `proactivelyCompressed` in TypeScript/Svelte files
  - Run: `grep -rn "proactivelyCompressed" --include="*.ts" --include="*.svelte" .`
  - Expected: no matches
  - Fails when: any field, guard, or UI reference remains

- [ ] Zero references to `_pccCompressed` in TypeScript files
  - Run: `grep -rn "_pccCompressed" --include="*.ts" .`
  - Expected: no matches
  - Fails when: wire mapping flag still present

- [ ] `"proactively-compressed"` removed from ClampReason
  - Run: `grep -n "proactively-compressed" conductors/contract/conductor.ts`
  - Expected: no matches
  - Fails when: dead variant still in union type

- [ ] substOne guard chain no longer mentions PCC
  - Run: `grep -n "proactively" app/src/lib/engine/store.svelte.ts`
  - Expected: no matches
  - Fails when: guard block still present

- [ ] TypeScript compiles cleanly
  - Run: `npx tsc --noEmit`
  - Expected: no errors
  - Fails when: dangling references to removed fields

- [ ] Full test suite passes
  - Run: `npm test`
  - Expected: all tests pass (PCC-specific tests deleted, all other tests unaffected)
  - Fails when: any test failure

- [ ] Inspector renders without PCC artifacts
  - Run: `grep -n "PCC\|pcc\|proactively" app/src/lib/ui/map/Inspector.svelte`
  - Expected: no matches
  - Fails when: PCC pill, tooltip, or button-disable logic remains

## Blocked by

- `11-remove-pcc-module.md`
