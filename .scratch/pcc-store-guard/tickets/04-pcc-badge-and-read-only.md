---
status: closed
---

Status: ready-for-agent

## Parent

`.scratch/pcc-store-guard/PRD.md`

## What to build

Dashboard Inspector renders a "PCC" pill badge on `proactivelyCompressed` blocks and disables fold/unfold controls (pin remains enabled). Verified by a headless Svelte component test — no browser interaction required. Visual/styling confirmation is deferred to `05-pcc-badge-visual-verify.md` (HITL).

**Covers:** US-003, DEC-005, DEC-006, RB-004, RB-005

## Implementation map

### 1. `Inspector.svelte` — PCC pill badge

- **File**: `extensions/accordion/app/src/lib/ui/map/Inspector.svelte`
- **Symbol**: block-level pill section (lines 251–268), after the `protected` pill (line 265)
- **Edit**:
  ```svelte
  {#if block.proactivelyCompressed}
    <span class="pill pill-info" data-testid="pcc-pill" title="Proactively compressed — original available via agent recall">PCC</span>
  {/if}
  ```
- **Pill class**: `pill-info`. If not present in the project's CSS, add it following the existing `pill-warn` / `pill-ok` / `pill-accent` pattern.

### 2. `Inspector.svelte` — disable fold/unfold controls for PCC blocks

- **Existing**: fold/unfold/pin buttons are gated by `steerLocked`.
- **Edit**: extend the `disabled` condition on fold and unfold buttons to include `block.proactivelyCompressed`. Pin button unchanged.

### 3. `Inspector.svelte` — badge in expanded group member list

- **Symbol**: group-level section (lines 117–133)
- **Edit**: in the member rendering loop, render the same `pill-info PCC` badge when `member.proactivelyCompressed === true`.

### 4. Component test — headless verification

- **File**: `extensions/accordion/app/src/lib/ui/map/Inspector.test.ts` (new)
- **Test seam**: `vitest` + `@testing-library/svelte`
- **Tests**:
  1. `it("renders PCC pill when block.proactivelyCompressed is true")`
     - Render `Inspector` with a PCC block fixture.
     - Assert: element with `data-testid="pcc-pill"` exists and contains text `PCC`.
  2. `it("does not render PCC pill when block.proactivelyCompressed is false")`
     - Render with a non-PCC block.
     - Assert: no element with `data-testid="pcc-pill"`.
  3. `it("disables fold and unfold buttons on a PCC block, keeps pin enabled")`
     - Render with a PCC block.
     - Assert: fold and unfold buttons carry `disabled` attribute; pin button does not.
  4. `it("renders PCC pill on PCC members inside an expanded group")`
     - Render with an expanded group whose members include a PCC block.
     - Assert: within the group member list, the PCC member has a `data-testid="pcc-pill"` element.

**Seam feasibility**: if `@testing-library/svelte` is not installed, this issue is blocked pending an enabling issue to add it. Do not fall back to manual verification — return the blocker.

### Grounding evidence

GROUND-010, GROUND-011

## Acceptance criteria

- [ ] PCC pill renders when `proactivelyCompressed` is true
  - Run: `pnpm --filter accordion-app test -- Inspector.test.ts`
  - Expected: `"renders PCC pill when block.proactivelyCompressed is true"` passes — element with `data-testid="pcc-pill"` present containing text `PCC`.

- [ ] PCC pill absent when `proactivelyCompressed` is false
  - Run: `pnpm --filter accordion-app test -- Inspector.test.ts`
  - Expected: `"does not render PCC pill when block.proactivelyCompressed is false"` passes — no element with `data-testid="pcc-pill"`.

- [ ] Fold and unfold buttons are disabled on PCC blocks; pin is not
  - Run: `pnpm --filter accordion-app test -- Inspector.test.ts`
  - Expected: `"disables fold and unfold buttons on a PCC block, keeps pin enabled"` passes — fold and unfold buttons carry `disabled`; pin button does not.

- [ ] PCC pill renders on PCC members inside expanded groups
  - Run: `pnpm --filter accordion-app test -- Inspector.test.ts`
  - Expected: `"renders PCC pill on PCC members inside an expanded group"` passes — the group-member PCC element has `data-testid="pcc-pill"`.

## Blocked by

- `02-pcc-flag-pipeline.md` — requires `proactivelyCompressed` on `ViewBlock` for the Inspector component to read.
