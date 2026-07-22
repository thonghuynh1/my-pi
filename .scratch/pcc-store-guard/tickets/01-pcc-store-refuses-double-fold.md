---
status: closed
---

Status: ready-for-agent

## Parent

`.scratch/pcc-store-guard/PRD.md`

## What to build

**Walking skeleton for this PRD.** The store refuses any conductor fold/replace on a PCC-compressed block. Prove it end-to-end via real wiring: a PCC-compressed message flows through `linearize()` and `buildView()`, `my-customize-conductor` emits a fold on the resulting block, and `substOne()` clamps the command with reason `"proactively-compressed"`.

**Covers:** US-002, DEC-002, RB-002

## Implementation map

### 1. `store.svelte.ts` — `substOne()` PCC guard

- **File**: `extensions/accordion/app/src/lib/engine/store.svelte.ts`
- **Symbol**: `substOne()` (line 1102)
- **Existing guard chain**: `unknown-id (1104) → human-override (1105) → grouped (1106) → protected (1109) → frozen (1110) → not-foldable (1121)`
- **Edit**: Insert PCC guard after `grouped` and before `protected`:
  ```ts
  if (b.proactivelyCompressed) {
      reports.push({ id, reason: "proactively-compressed", message: `${label} was proactively compressed — recall-only` });
      return;
  }
  ```
- **Position rationale**: fires before `protected` and `frozen` so PCC blocks are refused regardless of tail or frozen state (DEC-004: breakFrozen never gets a chance to bypass). Fires after `grouped` because grouped members are handled by the `grouped` guard (DEC-003).

### 2. Walking-skeleton integration test — real wiring end-to-end

- **File**: `extensions/accordion/app/src/lib/engine/store.foldgate.test.ts`
- **Prior art**: `describe("conductor path — substOne kind gate (fold & replace)")`
- **New describe block**: `describe("walking skeleton — PCC block is not double-folded end-to-end")`
- **Test**:
  ```ts
  it("a PCC-compressed message flows through linearize → buildView, and my-customize-conductor's fold is clamped by the store", () => {
    // 1. Create a PiMessage with _pccCompressed: true (as proactive-compress.ts would produce).
    // 2. Feed through the real linearize() from mapping.ts.
    // 3. Load blocks into the store; run the real buildView() to produce ViewBlocks.
    // 4. Invoke my-customize-conductor.step() with the view containing the PCC block.
    // 5. Apply the conductor's emitted commands via store.apply().
    // 6. Assert: clamp report contains { reason: "proactively-compressed" }.
    // 7. Assert: the PCC block is NOT folded (autoFolded remains false, no subst set).
  });
  ```
- **Discriminating**: fails if the flag pipeline is stubbed (`Block` missing `proactivelyCompressed`), if the store guard is missing, if the conductor short-circuits before emitting fold, or if any wiring edge is disconnected. Passing proves the whole chain lights up via real wiring.

### Grounding evidence

GROUND-001, GROUND-007 in `.scratch/pcc-store-guard/grounding.md`

## Acceptance criteria

- [ ] Walking-skeleton integration test proves PCC block is not double-folded end-to-end
  - Run: `pnpm --filter accordion-app test -- store.foldgate.test.ts`
  - Expected: `"a PCC-compressed message flows through linearize → buildView, and my-customize-conductor's fold is clamped by the store"` passes — the clamp report contains `reason: "proactively-compressed"`, and `block.autoFolded === false`.

## Blocked by

- `02-pcc-flag-pipeline.md` — requires `proactivelyCompressed` on `Block`, `ViewBlock`, and `"proactively-compressed"` in `ClampReason`.
