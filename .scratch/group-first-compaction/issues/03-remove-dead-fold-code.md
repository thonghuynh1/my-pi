---
repo: F:/MyWork/my-pi
status: closed
---

## Parent

Wayfinder map: `.scratch/group-first-compaction/map.md`, Slice 1.

## What to build

Remove dead code: `planFoldsToCap` method and `foldOrReplace` helper. After issues 01 and 02, these have zero call sites. Clean removal.

## Implementation map

**File:** `extensions/accordion/extension/conductors/my-customize-conductor/my-customize-conductor.ts`

### Methods to remove

| Method | Lines | Reason |
|--------|-------|--------|
| `foldOrReplace` | 169–177 | Only called from `planFoldsToCap` (line 432) and `planNormalPressure` (line 412). Both removed by issues 01 and 02. |
| `planFoldsToCap` | 417–437 | Replaced by `planOverflowGroups` in issue 01. |

### Verify before removing

- Grep for `foldOrReplace` — confirm zero remaining call sites
- Grep for `planFoldsToCap` — confirm zero remaining call sites
- Check if `FOLDABLE_KINDS` is still used elsewhere (it may be used in `planOverflowGroups` filter). Keep if still referenced; remove only if orphaned.

## Acceptance criteria

- [ ] `foldOrReplace` method does not exist in the file
  - Run: `grep -n "foldOrReplace" my-customize-conductor.ts`
  - Expected: No matches
  - Fails when: Method or any call site remains

- [ ] `planFoldsToCap` method does not exist in the file
  - Run: `grep -n "planFoldsToCap" my-customize-conductor.ts`
  - Expected: No matches
  - Fails when: Method or any call site remains

- [ ] TypeScript compiles cleanly
  - Run: `npx tsc --noEmit` from the conductor directory
  - Expected: No errors
  - Fails when: Compilation fails due to missing references

## Blocked by

- `01-replace-planfoldstocap-with-group-batching.md`
- `02-remove-individual-folds-from-normal-pressure.md`
