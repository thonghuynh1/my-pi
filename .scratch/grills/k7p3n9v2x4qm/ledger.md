# Grill ledger

- **Shared-understanding confirmation:** accepted by user
- **Outcome:** READY_FOR_PRD
- **Consumption:** consumed by `.scratch/pre-group-visibility/PRD.md`

## D-001 — Scope and authority of the Pre-Group UI section

- **Status:** accepted
- **Decision:** Render a conductor-specific third section whose membership exactly matches `MyCustomizeConductor`'s current Pre-Group Interval.
- **Rationale:** Users must be able to trust that the section identifies the exact blocks kept full until rollover; a token-based visual approximation could disagree with runtime behavior.
- **Dependencies:** None.
- **Evidence:** See `grounding.md`.
- **Domain update:** `CONTEXT.md` now defines **Pre-Group Interval**.

## D-002 — Interaction and lifecycle contract inside the Pre-Group section

- **Status:** accepted
- **Decision:** While blocks are displayed in the Pre-Group section, neither the human nor `MyCustomizeConductor` may fold or group them. Inspection remains available. The sole grouping transition is automatic rollover: qualifying members leave the Pre-Group Interval and become the next rollover group atomically.
- **Rationale:** The Protected-Tail-like presentation must match observable behavior, and the accumulating interval must remain full and intact until its defined rollover transition.
- **Dependencies:** D-001.
- **Evidence:** `ContextMap.svelte` currently treats all blocks before `protectedFromIndex` as range-selectable and potentially foldable; `MyCustomizeConductor` already excludes Pre-Group IDs from normal folds and non-rollover groups, then emits a rollover group when its threshold or escape valve fires.

## D-003 — Visibility across the context-map lenses

- **Status:** accepted
- **Decision:** Show Pre-Group in both context-map lenses: a distinct framed section in Map and a corresponding boundary/indicator in Transcript.
- **Rationale:** The lifecycle stage must remain visible regardless of which existing lens the user chooses.
- **Dependencies:** D-001, D-002.
- **Evidence:** `ContextMap.svelte` provides both `map` and `transcript` lenses. Protected Tail is a separate framed box in map mode and is also indicated per row with a lock flag in transcript mode.

## D-004 — Explanatory status shown with the Pre-Group section

- **Status:** accepted
- **Decision:** Show a visible Pre-Group label, current/target token counts, fill percentage, and an explanation that members remain full until safe rollover.
- **Rationale:** A border identifies a region but does not explain the lifecycle stage or its progress.
- **Dependencies:** D-001, D-003.
- **Evidence:** `MyCustomizeConductor.finishConduct` already publishes `preGroupTokens` and `preGroupFillPct`; the current map boxes have no visible headings.

## D-005 — Runtime seam for authoritative region membership

- **Status:** accepted
- **Decision:** Make the Pre-Group Interval first-class behavioral state owned narrowly by `MyCustomizeConductor` and enforced by the store; do not derive it from display status. Ownership covers exact membership and rollover, permits inspection, and ends when members roll over, leave the interval, or the conductor detaches. Protected Tail remains host-owned, and older context outside the declared interval remains unaffected.
- **Rationale:** This keeps status display-only, avoids stale telemetry controlling context, and provides one trustworthy interface for enforcement and UI rendering without taking a global human-steering lock.
- **Dependencies:** D-001, D-002.
- **Evidence:** `ConductorHost.setStatus` and remote `conductor/status` are explicitly display-only. Existing lock declarations can disable all human steering but cannot reserve only the Pre-Group interval. No current typed conductor-region seam exists.

## D-006 — Snapshot metadata versus incremental region commands

- **Status:** accepted
- **Decision:** Each conductor plan declaratively carries the complete current Pre-Group membership. Membership and commands apply in one revision; empty membership clears ownership. Legacy plans without region metadata mean no owned region.
- **Rationale:** Complete snapshots reuse existing stale-revision handling, make rollover atomic, and avoid a second incremental reserve/release state machine.
- **Dependencies:** D-005.
- **Evidence:** Remote conductor command replies already use revisioned snapshots and drop stale revisions.

## Settled implementation defaults

- Plans from conductors other than `MyCustomizeConductor`, conductor detach, and conductor replacement clear Pre-Group ownership.
- The store validates membership IDs against the current block snapshot and never estimates a missing/stale interval for display.
- Human fold/group operations intersecting current Pre-Group membership are refused at the store interface, not merely hidden in `ContextMap`.
- Ordinary conductor folds and non-rollover groups may not intersect the membership declared by the same plan. Rollover is represented by empty next membership plus the rollover group in that atomic plan.
- Progress below target is `accumulating`; target reached without a safe complete-turn/tool-pair boundary is `waiting for safe rollover`, not a promise that grouping occurs exactly at 100%.
- Empty or unavailable authoritative membership preserves the existing two-region UI; it is never reconstructed from token telemetry.
