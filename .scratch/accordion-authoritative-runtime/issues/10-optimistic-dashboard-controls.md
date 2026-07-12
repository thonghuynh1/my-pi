Status: ready-for-agent

## Parent

`.scratch/accordion-authoritative-runtime/PRD.md`

## What to build

Deliver optimistic, target-local dashboard fold/unfold/pin/group and setting controls over the authoritative command protocol. Cover `DEC-017`, `US-005`, and `RB-012`.

## Implementation map

- Consume `DashboardCommand`/`DashboardAck`, observer snapshots, and multi-observer transport from `09-dashboard-observer-protocol.md`.
- Add per-session, per-target pending state to direct and broker slots. A user action immediately updates only the target's visual replica, marks it calculating, and disables repeated actions for that target.
- The extension validates block/group identity, ADR 0011 locks, protection/frozen constraints, and setting permissions, applies the intent to authoritative runtime state, creates a revision, and acknowledges only after authoritative acceptance/calculation.
- Applied/rebased acknowledgement clears pending state and reconciles with the broadcast snapshot. Rejected/error acknowledgement restores the prior authoritative target state and displays an inline error.
- Other targets and sessions remain interactive; never introduce a global dashboard loading overlay.
- Agent `unfold`/`recall` tools use the same authoritative state. Recall stays read-only/unblockable; unfold returns restored only after runtime acceptance.
- Dependency proof: a real manual unfold must change the next provider payload through the runtime revision gate, not merely the browser replica.
- Grounding: `GROUND-003`, `GROUND-009`, `GROUND-010`, existing `plan.ts` unfold/recall tests.

## Acceptance criteria

- [ ] Manual unfold updates only its block optimistically, shows localized calculating state, and disables repeat actions while sibling blocks/sessions remain usable.
  - Run: `npx vitest run vendor/accordion/app/src/lib/live/dashboard-controls.test.ts`
  - Expected: target-local pending/isolation assertions pass.
- [ ] Applied acknowledgement clears pending state and the next provider payload contains the authoritative unfolded content.
  - Run: `npx vitest run vendor/accordion/extension/runtime/dashboard-controls.test.ts vendor/accordion/app/src/lib/live/dashboard-controls.test.ts`
  - Expected: end-to-end unfold test passes and fails if only browser state changed.
- [ ] Rejected or failed actions roll back exactly that target and render an inline actionable error without global blocking.
  - Run: `npx vitest run vendor/accordion/app/src/lib/live/dashboard-controls.test.ts`
  - Expected: rollback/error test preserves sibling state and interactivity.
- [ ] Fold, unfold, pin, group, enabled, budget, protect-tail, and conductor targets use typed commands and create authoritative revisions.
  - Run: `npx vitest run vendor/accordion/extension/runtime/dashboard-controls.test.ts`
  - Expected: command-target matrix passes with matching ack/revision.
- [ ] Agent recall remains read-only/unblockable and agent unfold observes runtime lock outcomes.
  - Run: `npx vitest run vendor/accordion/app/src/lib/live/plan.test.ts vendor/accordion/app/src/lib/engine/store.locks.test.ts vendor/accordion/extension/runtime/dashboard-controls.test.ts`
  - Expected: recall/unfold/lock regression tests pass.

## Blocked by

- `09-dashboard-observer-protocol.md`
