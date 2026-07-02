---
id: "001"
title: "Contract + Host Enforcement + Conductor Adaptation for frozenFromIndex"
labels: [ready-for-agent]
depends_on: []
status: closed
---

## What to build

Add `frozenFromIndex` to the conductor contract, enforce it at the host level with a new `"frozen"` clamp reason, and update `my-customize-conductor` to respect it. This slice delivers the full vertical path: contract definition → host enforcement → conductor consumption → tests proving the chain.

No real cache data flows yet — `frozenFromIndex` defaults to `0` in `buildView()` and is passed directly in test fixtures.

**PRD decisions implemented**: DEC-001, DEC-009

**User stories covered**: 2, 3, 4, 8, 9, 10

## Implementation map

### Area: `conductor.ts` — contract

- **Decision IDs**: DEC-001, DEC-009
- **Current code anchors**:
  - `ConductorView` interface (`conductors/contract/conductor.ts` ~line 75)
  - `ClampReason` type (~line 249)
  - `availableCap()` function (~line 120) — takes structural subtype, does NOT need changes
- **Existing behavior**: `ConductorView` has `protectedFromIndex` for the tail. `ClampReason` has 7 variants. No frozen-head concept.
- **Required edits**:
  1. Add `frozenFromIndex: number` to `ConductorView` after `protectTokens` (DEC-001):
     ```ts
     // decision artifact (normative)
     /** Index of the first block the conductor may fold. Blocks before this
      *  index are in the provider's prompt cache prefix. 0 = no frozen prefix
      *  (cold start, unknown provider, or cache expired). Host-enforced: fold/replace
      *  commands targeting blocks below this index are clamped with reason "frozen". */
     frozenFromIndex: number;
     ```
  2. Add `"frozen"` to `ClampReason` union after `"protected"` (DEC-009):
     ```ts
     // decision artifact (normative)
     | "frozen"  // block is in the provider's cached prefix
     ```
- **Wiring/build notes**: This file is deliberately dependency-free. No imports to add.

### Area: `store.svelte.ts` — host enforcement

- **Decision IDs**: DEC-001, DEC-009
- **Current code anchors**:
  - `buildView()` (~line 1007) — assembles `ConductorView` with `protectedFromIndex`
  - `applyCommands()` (~line 1050) — delegates to `substOne()` for fold/replace
  - `substOne()` — clamp chain: `unknown-id` → `human-override` → `grouped` → `protected` → `not-foldable`
  - `setHarnessBreakdown()` — receives harness data from sync, stores as state
- **Existing behavior**: `buildView` passes `protectedFromIndex` to the view. `substOne` checks 5 clamp reasons. No `frozenFromIndex` anywhere.
- **Required edits**:
  1. Add `frozenFromIndex` state (Svelte 5 runes, follow `harnessOverhead` pattern). Default to `0`.
  2. Pass `frozenFromIndex` into `ConductorView` in `buildView()` (DEC-001).
  3. Add frozen clamp check in `substOne()`, after `protected` check, before `not-foldable` (DEC-009):
     ```ts
     // decision artifact (normative)
     if (b.order < this.frozenFromIndex) {
       reports.push({ command: op, ids: [id], reason: "frozen",
         detail: `block ${id} is in the provider's cached prefix (order ${b.order} < frozen ${this.frozenFromIndex})` });
       return;
     }
     ```
- **Wiring/build notes**: `frozenFromIndex` is reactive state (Svelte 5 runes). Follow the pattern of `harnessOverhead` storage. The `setHarnessBreakdown` wiring for real data comes in Slice 3; this slice only adds the state, the default, the `buildView` passthrough, and the clamp.

### Area: `my-customize-conductor.ts` — conductor adaptation

- **Decision IDs**: DEC-001
- **Current code anchors**:
  - Candidate filter (~line 74): `!b.held && !b.protected && !b.grouped && b.foldedTokens < b.tokens && FOLDABLE_KINDS.has(b.kind)`
  - Epoch hold guard (~line 53): `if (b && !b.held && !b.protected && !b.grouped) projectedHeld -= saving`
- **Existing behavior**: Conductor folds oldest-first without cache awareness. Epoch hold reuses previous plan if under 0.9 × cap.
- **Required edits**:
  1. Add frozen check to candidate filter (DEC-001):
     ```ts
     // decision artifact (normative)
     const candidates = view.blocks.filter(
       (b) =>
         !b.held &&
         !b.protected &&
         !b.grouped &&
         b.order >= view.frozenFromIndex &&  // NEW: respect frozen prefix
         b.foldedTokens < b.tokens &&
         FOLDABLE_KINDS.has(b.kind),
     );
     ```
  2. Add frozen check to epoch hold guard:
     ```ts
     if (b && !b.held && !b.protected && !b.grouped
         && b.order >= view.frozenFromIndex)  // NEW
       projectedHeld -= saving;
     ```

### Global Build & Wiring Notes

- **TypeScript compilation**: Adding `frozenFromIndex` to `ConductorView` will cause compile errors in any test `makeView` helper that doesn't include it. Update all `makeView` helpers across conductor test files to include `frozenFromIndex: 0` as default.
- **Test runner**: `npx vitest run <path>` for all frontend tests. Expected output: `Tests X passed`.

## Acceptance criteria

- [ ] `ConductorView` interface in `conductors/contract/conductor.ts` has a `frozenFromIndex: number` field with JSDoc.
  Run: `npx vitest run app/src/lib/engine/conductor.test.ts`. Expected: all existing tests pass (no regression from adding the field).

- [ ] `ClampReason` type includes `"frozen"` variant.
  Run: `grep -n '"frozen"' conductors/contract/conductor.ts`. Expected: line containing `| "frozen"`.

- [ ] `buildView()` in `store.svelte.ts` passes `frozenFromIndex` (defaulting to `0`) into the `ConductorView`.
  Run: `grep -n 'frozenFromIndex' app/src/lib/engine/store.svelte.ts`. Expected: at least two matches (state declaration + buildView assignment).

- [ ] `substOne()` clamps fold/replace commands targeting blocks with `order < frozenFromIndex` with reason `"frozen"`.
  Run: `npx vitest run app/src/lib/engine/conductor.test.ts --reporter=verbose`. Expected: new test `frozen clamp` (or similar) passes — issues a fold on a block at order 3 with `frozenFromIndex = 5`, asserts `ClampReport` with `reason: "frozen"`.

- [ ] `substOne()` clamps replace commands on frozen blocks (not just fold).
  Run: `npx vitest run app/src/lib/engine/store.foldgate.test.ts --reporter=verbose`. Expected: new test for frozen replace clamp passes.

- [ ] `my-customize-conductor` candidate filter excludes blocks where `b.order < view.frozenFromIndex`.
  Run: `npx vitest run app/src/lib/engine/conductor.my-customize-conductor.test.ts --reporter=verbose`. Expected: new test creates view with `frozenFromIndex = 5` and 10 blocks, asserts blocks 0–4 are NOT in fold commands.

- [ ] Epoch hold in `my-customize-conductor` invalidates a stale plan when a previously-touched block is now frozen.
  Run: `npx vitest run app/src/lib/engine/conductor.my-customize-conductor.test.ts --reporter=verbose`. Expected: new test — previous plan touched block at order 3, now `frozenFromIndex = 5` → plan is recomputed (not held).

- [ ] When all foldable blocks are frozen, `my-customize-conductor` returns `[]` (accepts over-budget).
  Run: `npx vitest run app/src/lib/engine/conductor.my-customize-conductor.test.ts --reporter=verbose`. Expected: new test — all blocks below `protectedFromIndex` are frozen → `conduct()` returns empty array.

- [ ] All existing conductor tests still pass (no regression from `makeView` changes).
  Run: `npx vitest run app/src/lib/engine/`. Expected: all tests pass.

## Blocked by

None — can start immediately.
