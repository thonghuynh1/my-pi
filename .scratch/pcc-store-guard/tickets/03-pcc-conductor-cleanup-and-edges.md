---
status: closed
---

Status: ready-for-agent

## Parent

`.scratch/pcc-store-guard/PRD.md`

## What to build

Refinement of the walking skeleton. Cover the remaining PCC behaviors: `breakFrozen` cannot bypass the store guard (DEC-004), PCC blocks can be group members and collapse normally (DEC-003, RB-003), and the now-redundant PCC detection in `my-customize-conductor` is removed.

**Covers:** DEC-003, DEC-004, RB-003, plus cleanup of `my-customize-conductor`.

## Implementation map

### 1. `my-customize-conductor.ts` — remove redundant PCC detection

- **File**: `vendor/accordion/conductors/my-customize-conductor/my-customize-conductor.ts`
- **Symbols to remove**:
  - Line 45: `const PROACTIVE_COMPRESS_MARKER = ...`
  - Lines 334–336: `function isProactivelyCompressed(b: ViewBlock): boolean { ... }`
  - Line 135: `&& !isProactivelyCompressed(b)` from the `candidates` filter
- **Optional optimization**: add `&& !b.proactivelyCompressed` to the candidates filter to avoid emitting commands the store will clamp. Left to implementer.

### 2. `conductor.my-customize-conductor.test.ts` — update fixture

- **File**: `vendor/accordion/app/src/lib/engine/conductor.my-customize-conductor.test.ts`
- **Symbol**: `it("skips proactively-compressed tool results as fold candidates")`
- **Edit**: fixture uses `proactivelyCompressed: true` on the `ViewBlock` instead of marker text.

### 3. `store.foldgate.test.ts` — edge cases

- **File**: `vendor/accordion/app/src/lib/engine/store.foldgate.test.ts`
- **New describe block**: `describe("PCC guard — edge cases")`
- **Tests**:
  1. `it("a conductor 'fold' with breakFrozen of a PCC block is still clamped (no bypass)")`
     - Create PCC block in frozen prefix (`order < frozenFromIndex`).
     - Apply `{ kind: "fold", ids: [id], breakFrozen: true }`.
     - Assert: clamped `"proactively-compressed"` — breakFrozen does NOT bypass.
  2. `it("a PCC block inside a group collapses normally (no clamp)")`
     - Create PCC block, add it to a group via `{ kind: "group", ids: [...] }`.
     - Assert: group is created, PCC block is a member, no clamp report for the group command.
  3. `it("a conductor 'replace' of a PCC block is clamped 'proactively-compressed' and not folded")`
     - Apply `{ kind: "replace", id, content: "summary" }`.
     - Assert: clamp report, no `subst` set.

### Grounding evidence

GROUND-001, GROUND-007

## Acceptance criteria

- [ ] `breakFrozen` does not bypass PCC guard
  - Run: `pnpm --filter accordion-app test -- store.foldgate.test.ts`
  - Expected: `"a conductor 'fold' with breakFrozen of a PCC block is still clamped (no bypass)"` passes — clamped despite `breakFrozen: true`.

- [ ] Grouping PCC blocks works normally
  - Run: `pnpm --filter accordion-app test -- store.foldgate.test.ts`
  - Expected: `"a PCC block inside a group collapses normally (no clamp)"` passes — group created, no clamp on the group command.

- [ ] `replace` on PCC block is clamped
  - Run: `pnpm --filter accordion-app test -- store.foldgate.test.ts`
  - Expected: `"a conductor 'replace' of a PCC block is clamped 'proactively-compressed' and not folded"` passes.

- [ ] Conductor regex cleanup compiles and existing tests pass
  - Run: `pnpm --filter accordion-app test -- conductor.my-customize-conductor.test.ts`
  - Expected: `"skips proactively-compressed tool results as fold candidates"` passes with the updated fixture; all ~55 existing tests pass.

## Blocked by

- `01-pcc-store-refuses-double-fold.md` — walking skeleton must land before refinements.
