---
status: closed
---

# Authoritative Pre-Group plan, enforcement, and Map slice

Type: AFK
Status: ready-for-agent

## Parent

`.scratch/pre-group-visibility/PRD.md`

## What to build

Deliver the walking skeleton for `US-001`: `MyCustomizeConductor` must declare its complete next Pre-Group membership as plan metadata; `AccordionStore` must atomically own and enforce that region; and `ContextMap` must render the exact members as a framed middle Map section. A real rollover must remove consumed IDs from membership in the same plan that creates the rollover group.

Covers `DEC-001`, `DEC-002`, `DEC-005`, `DEC-006`, `US-001`, and `RB-001` through `RB-009`, plus the Map variant of `RB-010`, `RB-011` telemetry production, and `RB-013`.

## Implementation map

### Shared contract — owned by this issue

Edit `extensions/accordion/conductors/contract/conductor.ts` at `Command` and `Conductor` and re-export through `conductors/contract/index.ts`:

```ts
interface PreGroupRegion {
  memberIds: string[];
}

interface ConductorPlan {
  commands: Command[];
  preGroup?: PreGroupRegion;
}

type ConductorResult = Command[] | ConductorPlan | null;
```

Change `Conductor.conduct` to return `ConductorResult`. Legacy arrays remain complete command snapshots and own no Pre-Group region. `null` holds the previous complete normalized plan, including membership. Do not add a `Command` variant and do not use conductor status as membership.

### Plan producer

Edit `extensions/accordion/conductors/my-customize-conductor/my-customize-conductor.ts` at `conduct`, `finishConduct`, `preGroupBlocks`, and `tryEmitGroup`.

The conductor already computes:

```ts
const preGroupBlocks = view.blocks.slice(preGroupFromIndex, view.protectedFromIndex);
```

Package those durable IDs through every non-null return path. The declared IDs are the complete **next** membership:

- ordinary accumulation: all current eligible `preGroupBlocks`;
- full rollover: `[]` plus the rollover `group` command;
- partial safe rollover: current IDs minus consumed group IDs;
- no-region/disabled path: `[]`;
- replay, early rollover, Atomic Budget Rebase, and hold-band paths must preserve these semantics.

Preserve all existing safe-range logic in `chunked-compaction.ts`: complete turns, held/grouped/proactively-compressed barriers, balanced tool pairs, minimum useful saving, normal target/escape valve, early rollover under budget pressure, and Atomic Budget Rebase. Ordinary fold/replace/group planning must continue excluding next membership.

Extend display-only status metrics with `preGroupTargetTokens` and `preGroupPhase: "inactive" | "accumulating" | "waiting-safe-rollover" | "rolled-over"`; keep existing `preGroupTokens` and `preGroupFillPct`. `rolled-over` includes safe budget-pressure rollover below the normal target.

### Store ownership and enforcement

Edit `extensions/accordion/app/src/lib/engine/store.svelte.ts` at `runConductor`, `applyCommands`, `canFold`, `fold`, `toggle`, `createGroup`, `attach`, `detach`, and conductor-state clearing.

Normalize every conductor result once. Apply next membership and commands as one observable store transition. Store membership by durable ID and expose reactive helpers used by callers, including `isPreGroup(blockOrId)` and an ordered membership/boundary read. Validate against the current block snapshot; never estimate from status metrics. Invalid metadata must not crash or expose nonexistent members and must follow existing conductor diagnostic/clamp conventions.

Enforcement rules:

- `canFold` is false for Pre-Group members.
- Human `fold`/`toggle` on a member is a no-op and creates no override.
- A human `createGroup` whose whole-message-snapped range intersects membership is rejected wholesale.
- Conductor `fold`/`replace` and snapped `group` ranges intersecting the plan’s next membership are clamped/refused.
- `restore` remains legal because it keeps a member full.
- A rollover group is legal because its consumed IDs are absent from next membership in the same plan.
- Unrelated older blocks retain existing controls.
- Detach, conductor replacement, legacy/no-region plans, and explicit empty membership clear ownership.
- Protected Tail remains host-owned and unchanged.

The store—not hidden buttons—is the invariant owner. Inspection paths remain usable and must not mutate membership.

### Map walking-skeleton UI

Edit `extensions/accordion/app/src/lib/ui/map/ContextMap.svelte` at the current `protectedFrom`, `olderTiles`, `protectedTiles`, display rows, tile specs, range selection, tooltips, and `.boxes` markup.

Partition authoritative store membership into:

```text
Older/Foldable → Pre-Group → Protected Tail
```

Render Pre-Group as a distinct framed middle section visually related to `.box.prot`, but explicitly labeled `Pre-Group`. Its tiles remain inspectable and advertise that they stay full until safe rollover. They must not enter manual group ranges or advertise fold actions. When authoritative membership is empty, retain the existing two-region layout; never infer a section from telemetry.

Issue 02 owns Transcript and progress presentation refinements. This issue owns the shared Map hierarchy and the authoritative membership helpers it consumes.

### Tests and evidence

Grounding anchors: `GROUND-001`, `GROUND-002`, `GROUND-004`, and `GROUND-005` in `.scratch/grills/k7p3n9v2x4qm/grounding.md`.

Extend `src/lib/engine/conductor.compaction-naive.test.ts` and store host/fold/group tests. Add `src/lib/ui/map/ContextMap.pre-group-map.test.ts` using Testing Library/jsdom. The walking-skeleton test must instantiate the real `MyCustomizeConductor`, attach it to a real `AccordionStore`, render `ContextMap`, append distinct blocks through `appendBlocks`, and observe both accumulation and safe rollover without mocking membership.

## Acceptance criteria

- [ ] **AC-01-01 — Accumulation declares complete membership:** a non-rollover plan carries every current Pre-Group block ID in order.
  - Run: `npx vitest run src/lib/engine/conductor.compaction-naive.test.ts -t "declares complete accumulating pre-group membership"`
  - Expected: the plan’s ordered `memberIds` exactly equal the conductor’s computed interval; removing, adding, or reordering one ID fails.

- [ ] **AC-01-02 — Inactive membership is explicit empty state:** a non-null `MyCustomizeConductor` plan with Pre-Group disabled declares `memberIds: []`.
  - Run: `npx vitest run src/lib/engine/conductor.compaction-naive.test.ts -t "declares empty membership when pre-group is inactive"`
  - Expected: the returned plan contains an explicit empty list, not omitted, stale, or token-derived membership.

- [ ] **AC-01-03 — Store exposes only present declared IDs:** unknown IDs in metadata never appear through the public membership read.
  - Run: `npx vitest run src/lib/engine/store.host.test.ts -t "validates pre-group IDs against the current block snapshot"`
  - Expected: a distinct existing fixture ID is exposed and `missing:pg:91` is absent without a crash.

- [ ] **AC-01-04 — Status cannot create membership:** pre-group-like status metrics without plan metadata do not create a region.
  - Run: `npx vitest run src/lib/engine/store.host.test.ts -t "does not derive pre-group membership from conductor status"`
  - Expected: membership remains empty while status text and metrics are still retained for display.

- [ ] **AC-01-05 — Fold affordance gate is closed:** `canFold` returns false for a current Pre-Group member.
  - Run: `npx vitest run src/lib/engine/store.host.test.ts -t "reports pre-group members as not human-foldable"`
  - Expected: the member is otherwise wire-foldable but `canFold(member)` is false solely while membership is active.

- [ ] **AC-01-06 — Direct human fold is a no-op:** calling `fold(id, "you")` on a member creates no override or fold.
  - Run: `npx vitest run src/lib/engine/store.host.test.ts -t "refuses direct human fold inside pre-group"`
  - Expected: the member remains full, `override` stays null, and no human fold decision is recorded.

- [ ] **AC-01-07 — Human toggle is a no-op:** calling `toggle(id, "you")` on a full member does not fold it.
  - Run: `npx vitest run src/lib/engine/store.host.test.ts -t "refuses human toggle inside pre-group"`
  - Expected: full/folded state and override are unchanged.

- [ ] **AC-01-08 — Older context remains collaborative:** a distinct foldable block older than the declared region still accepts a human fold.
  - Run: `npx vitest run src/lib/engine/store.host.test.ts -t "keeps older blocks outside pre-group human-foldable"`
  - Expected: the control block acquires the normal human folded override while the member remains full.

- [ ] **AC-01-09 — Intersecting human group is rejected:** a whole-message-snapped human range touching one member creates no group.
  - Run: `npx vitest run src/lib/engine/store.host.test.ts -t "rejects a human group intersecting pre-group"`
  - Expected: `createGroup` returns null and the groups collection is unchanged.

- [ ] **AC-01-10 — Inspection remains available:** selecting a Map member invokes observation without mutating membership or fold state.
  - Run: `npx vitest run src/lib/ui/map/ContextMap.pre-group-map.test.ts -t "keeps pre-group members inspectable"`
  - Expected: `onselect` receives the exact member ID and store membership/fold state remain unchanged.

- [ ] **AC-01-11 — Conductor fold overlap is clamped:** a plan fold naming next membership does not fold that member.
  - Run: `npx vitest run src/lib/engine/store.host.test.ts -t "clamps conductor folds inside next pre-group membership"`
  - Expected: the member stays full and a non-noop clamp report names its ID.

- [ ] **AC-01-12 — Conductor replace overlap is clamped:** a plan replacement naming next membership does not substitute that member.
  - Run: `npx vitest run src/lib/engine/store.host.test.ts -t "clamps conductor replacements inside next pre-group membership"`
  - Expected: `subst` remains undefined and a non-noop clamp report names its ID.

- [ ] **AC-01-13 — Conductor group overlap is clamped after snapping:** a non-rollover group whose snapped range reaches next membership creates no group.
  - Run: `npx vitest run src/lib/engine/store.host.test.ts -t "clamps conductor groups intersecting next pre-group membership"`
  - Expected: no group is created and the clamp report identifies an invalid Pre-Group overlap.

- [ ] **AC-01-14 — Full rollover applies atomically:** a same-plan empty next membership and rollover group over the released IDs are both observable after one pass.
  - Run: `npx vitest run src/lib/engine/store.host.test.ts -t "atomically clears full membership and applies its rollover group"`
  - Expected: membership is empty and one group contains every released ID; no released block remains separately foldable between states.

- [ ] **AC-01-15 — Partial rollover preserves residue atomically:** `[b21,b22,b23,b24]` rolling `[b21,b22,b23]` declares `[b24]` as next membership.
  - Run: `npx vitest run src/lib/engine/conductor.compaction-naive.test.ts -t "partial rollover retains unconsumed pre-group members"`
  - Expected: one group contains exactly the first three IDs and `b24` remains the sole member.

- [ ] **AC-01-16 — Legacy arrays own no region:** a legacy `Command[]` result applies its commands with empty membership.
  - Run: `npx vitest run src/lib/engine/store.host.test.ts -t "normalizes legacy command arrays without pre-group ownership"`
  - Expected: the command effect is visible and the membership read is empty.

- [ ] **AC-01-17 — Null holds the complete prior plan:** after a complete plan, `null` preserves both prior commands and prior membership.
  - Run: `npx vitest run src/lib/engine/store.host.test.ts -t "holds commands and pre-group membership on null"`
  - Expected: both fields remain equal to the preceding non-null plan after refold.

- [ ] **AC-01-18 — Detach clears ownership:** detaching the active conductor empties membership while preserving existing detach freeze semantics.
  - Run: `npx vitest run src/lib/engine/store.host.test.ts -t "clears pre-group ownership on detach"`
  - Expected: membership is empty and the fixture’s conductor-folded view remains frozen according to ADR 0011.

- [ ] **AC-01-19 — Replacement clears old ownership:** replacing a region-owning conductor with a legacy/no-region conductor removes old membership.
  - Run: `npx vitest run src/lib/engine/store.host.test.ts -t "clears old pre-group ownership on conductor replacement"`
  - Expected: no old member remains reserved after the replacement’s first plan.

- [ ] **AC-01-20 — Explicit no-region plan clears ownership:** a current plan with no region metadata clears membership left by the prior plan.
  - Run: `npx vitest run src/lib/engine/store.host.test.ts -t "clears pre-group ownership on a no-region plan"`
  - Expected: membership transitions from the prior IDs to empty in that pass.

- [ ] **AC-01-21 — Exact three-region Map hierarchy:** declared IDs render only in a labeled middle section between older context and Protected Tail.
  - Run: `npx vitest run src/lib/ui/map/ContextMap.pre-group-map.test.ts -t "renders exact older pre-group and protected map regions"`
  - Expected: DOM order is Older, Pre-Group, Protected Tail and each fixture tile ID occurs in exactly its expected region.

- [ ] **AC-01-22 — Empty membership preserves two-region Map:** an authoritative empty list renders no Pre-Group section.
  - Run: `npx vitest run src/lib/ui/map/ContextMap.pre-group-map.test.ts -t "keeps the existing two-region map when membership is empty"`
  - Expected: Older and Protected Tail remain and no accessible Pre-Group section exists.

- [ ] **AC-01-23 — Walking skeleton through real wiring:** actual conductor output reaches the store and Map, refuses a human fold, then rolls safe members into a group while retaining residue.
  - Run: `npx vitest run src/lib/ui/map/ContextMap.pre-group-map.test.ts -t "runs authoritative pre-group accumulation through rollover"`
  - Expected: exact initial Map membership, refused fold, one rollover group, consumed IDs absent, and remaining IDs present are observed without mocked membership or direct region mutation.

- [ ] **AC-01-24 — Complete-turn safety remains:** rollover membership metadata does not cause a group to split an Accordion turn.
  - Run: `npx vitest run src/lib/engine/conductor.compaction-naive.test.ts -t "rollover groups only complete turns"`
  - Expected: every grouped turn is complete and excluded turn residue remains declared when eligible.

- [ ] **AC-01-25 — Open tool pairs remain ungrouped:** a tool pair crossing into Protected Tail delays rollover.
  - Run: `npx vitest run src/lib/engine/conductor.compaction-naive.test.ts -t "chunked-compaction does not add a third trigger for open tool pairs"`
  - Expected: no rollover group is emitted and the safe Pre-Group members remain declared.

- [ ] **AC-01-26 — Early budget-pressure rollover remains:** an over-cap view can roll a safe range below the normal target.
  - Run: `npx vitest run src/lib/engine/conductor.compaction-naive.test.ts -t "early rollover"`
  - Expected: a safe rollover group is emitted below 100% and next membership excludes only consumed IDs.

- [ ] **AC-01-27 — Escape-valve rollover remains:** an interval above the overflow cap can roll over without the normal turn-boundary trigger.
  - Run: `npx vitest run src/lib/engine/conductor.compaction-naive.test.ts -t "escape valve"`
  - Expected: the existing escape-valve scenario emits its safe group and plan metadata matches the residue.

- [ ] **AC-01-28 — Atomic Budget Rebase remains one plan:** a qualifying first-observed or lowered-budget view emits its priority rollover and non-overlapping folds with matching next membership.
  - Run: `npx vitest run src/lib/engine/conductor.compaction-naive.test.ts -t "atomic rebase"`
  - Expected: one plan contains the priority group, required non-overlapping folds, and no ordinary command touching next membership.

- [ ] **AC-01-29 — Display metric contract is complete:** conductor status publishes current, target, fill percent, and one valid phase without carrying member IDs.
  - Run: `npx vitest run src/lib/engine/conductor.compaction-naive.test.ts -t "publishes complete display-only pre-group progress"`
  - Expected: all four metric values are exact for the fixture, phase is in the accepted union, and metrics/details contain no authoritative membership list.

- [ ] **AC-01-30 — Focused conductor regression suite passes:** all existing MyCustomize rollover tests remain green with the plan envelope.
  - Run: `npx vitest run src/lib/engine/conductor.compaction-naive.test.ts`
  - Expected: the focused suite passes with no failed existing or new cases.

## Blocked by

None - can start immediately.
