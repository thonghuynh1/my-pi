---
status: closed
---

Status: ready-for-agent

# Group/drop protection for pstack identity blocks

## Parent

PRD: `F:/MyWork/my-pi/.scratch/pstack-folded-recall-routing/PRD.md`

## What to build

Add regression protection that `my-customize-conductor` does not hide pstack identity or Poteto beacon blocks behind conductor-created group/drop summaries while Poteto mode is active. Current `my-customize-conductor` does not emit group commands, so this slice is primarily an invariant test and a small explicit guard if needed.

Decision IDs: `DEC-014`, `DEC-018`, `DEC-020`.

User stories / required behaviors covered: 1, 2, 6, 8, 13.

## Implementation map

### Area: my-customize-conductor planning and Poteto mode beacon

- **Decision IDs**: `DEC-014`, `DEC-018`, `DEC-020`.
- **Current code anchors**:
  - `vendor/accordion/conductors/my-customize-conductor/my-customize-conductor.ts`
  - Symbol: `MyCustomizeConductor.conduct`
- **Existing behavior**: The conductor currently emits `replace` commands for MCP summaries and one optional `fold` command for plain folded ids. It does not currently emit `group` or drop-group commands.
- **Required edits**:
  - Preserve the invariant that conductor-created groups/drops do not hide pstack identity/beacon blocks while Poteto mode is active.
  - If implementation added any group/drop behavior in earlier slices, exclude ranges that contain pstack identity blocks or beacon blocks.
  - If implementation still emits no groups, add explicit regression tests only; do not add unnecessary code.
  - Human overrides still win: grouped blocks from human state are not fought by the conductor; the conductor simply must not create hiding groups itself.

`decision artifact` — group/drop invariant, normative:

```text
While Poteto mode is active, my-customize-conductor must not emit a conductor-created group/drop command whose covered range hides:
- skill-pstack(name="poteto-mode") identity blocks
- pstack folded recall identity blocks
- the active Poteto beacon block
```

### Area: Direct conductor tests

- **Decision IDs**: `DEC-020`.
- **Current code anchors**:
  - `vendor/accordion/app/src/lib/engine/conductor.my-customize-conductor.test.ts`
  - Helpers: `vb`, `makeView`, `foldIdsOf`, `replaceOf`, `projected`
- **Existing behavior**: Direct tests assert emitted `Command[]` from synthetic `ConductorView` instances. No E2E store test is required for MVP.
- **Required edits**:
  - Add a test that creates an active Poteto-mode scenario and enough token pressure to force conductor action.
  - Assert no command of kind `group` is emitted.
  - Assert no drop-style command is emitted. In current command vocabulary, drop is a `group` command with `digest: null` or `digest: ""`; if no group commands exist, this is satisfied directly.
  - Assert the pstack block is represented by a recoverable `replace`, not hidden by a plain `fold` or group/drop.

### Global build / wiring notes

- This slice is blocked by issue 03 because it verifies the final active Poteto beacon behavior.
- The conductor contract currently supports `fold`, `replace`, `group`, `restore`, and `pin`; there is no synthetic insert.
- Do not add E2E AccordionStore tests for this MVP.

## Acceptance criteria

- [ ] Active Poteto mode scenario emits no group command. Run: `cd vendor/accordion/app && npm test -- conductor.my-customize-conductor.test.ts`. Expected: a test named like `does not group pstack identity blocks while Poteto mode is active` passes and asserts `result.some(c => c.kind === "group")` is false.
- [ ] Active Poteto mode scenario emits no drop group. Run: `cd vendor/accordion/app && npm test -- conductor.my-customize-conductor.test.ts`. Expected: a test named like `does not drop pstack identity blocks while Poteto mode is active` passes and asserts no command has `kind === "group"` with `digest === null` or `digest === ""`.
- [ ] Pstack identity block is recoverably replaced, not hidden by plain fold. Run: `cd vendor/accordion/app && npm test -- conductor.my-customize-conductor.test.ts`. Expected: a test named like `keeps pstack identity visible as recoverable replace` passes and asserts the pstack block has a `replace` command with `recoverable: true` and is not included in any `fold` command ids.
- [ ] Human grouped state is not fought. Run: `cd vendor/accordion/app && npm test -- conductor.my-customize-conductor.test.ts`. Expected: a test named like `does not fight human grouped pstack blocks` passes and asserts a `ViewBlock` with `grouped: true` receives no replace/fold/group command from `my-customize-conductor`.
- [ ] Full focused test file passes. Run: `cd vendor/accordion/app && npm test -- conductor.my-customize-conductor.test.ts`. Expected: stdout includes `conductor.my-customize-conductor.test.ts` and all tests in the file pass.

## Blocked by

- `03-poteto-mode-active-beacon-lifecycle.md`
