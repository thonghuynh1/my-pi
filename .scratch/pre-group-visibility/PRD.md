# Authoritative Pre-Group visibility and ownership

Status: ready-for-agent

## Problem Statement

When `MyCustomizeConductor` accumulates blocks in its Pre-Group Interval, Accordion’s browser UI renders those blocks as ordinary older/foldable context. Users cannot see that the blocks are deliberately kept full while awaiting safe rollover, and existing human controls can appear to permit actions that contradict that lifecycle stage.

## Solution

Make Pre-Group a first-class, conductor-owned region carried atomically with each conductor plan. The store will enforce its exact membership, while Map and Transcript display the same region with progress and safe-rollover status. Protected Tail remains host-owned, and older context outside Pre-Group retains its existing behavior.

## User Stories

1. `US-001`: As an Accordion user running `MyCustomizeConductor`, I want its exact Pre-Group Interval shown as a protected middle section, so that I understand which blocks are intentionally being kept full before rollover.
2. `US-002`: As a user reading the Transcript lens, I want the same Pre-Group boundary and indicators shown there, so that changing lenses does not hide the lifecycle stage.
3. `US-003`: As a user monitoring context pressure, I want current/target tokens, fill percentage, and safe-rollover status shown with Pre-Group, so that I understand its progress without assuming grouping happens exactly at 100%. 

## Walking Skeleton

`US-001` — In a real `MyCustomizeConductor` plan, exact Pre-Group member IDs flow through the conductor contract into `AccordionStore`, render as a framed middle Map section, refuse human fold/group actions, and atomically leave that section when the same plan rolls eligible members into a rollover group.

## Required Behaviors

- `RB-001`: A `MyCustomizeConductor` plan declares the complete next Pre-Group membership by durable block ID; an empty list clears ownership.
- `RB-002`: Membership and commands from one in-process return or remote revision apply atomically. A stale remote revision changes neither commands nor membership.
- `RB-003`: Legacy in-process `Command[]` results and plan/message payloads without Pre-Group metadata own no Pre-Group region.
- `RB-004`: Detach, conductor replacement, and plans from conductors without Pre-Group metadata clear ownership.
- `RB-005`: The store validates declared IDs against the current block snapshot and exposes only authoritative membership; the UI never reconstructs membership from token telemetry.
- `RB-006`: Human fold and manual-group operations intersecting current Pre-Group membership are refused at the store interface. Inspection remains available.
- `RB-007`: Ordinary conductor fold/replace and non-rollover group commands cannot overlap membership declared by the same plan. Rollover removes eligible IDs from next membership while grouping those IDs in that same plan.
- `RB-008`: A partial safe rollover preserves unconsumed members. Example: current `[b21,b22,b23,b24]`, safe group `[b21,b22,b23]` → next membership `[b24]` plus the rollover group command.
- `RB-009`: Existing rollover safety remains authoritative: complete turns, hard barriers, balanced tool pairs, minimum useful saving, threshold/escape-valve behavior, early rollover under budget pressure, and Atomic Budget Rebase behavior are preserved.
- `RB-010`: Map renders `Older/Foldable → Pre-Group → Protected Tail`; Transcript renders a matching boundary and per-row Pre-Group indicator.
- `RB-011`: Pre-Group UI includes its canonical label, current/target tokens, fill percentage, and explanatory text that members stay full until safe rollover.
- `RB-012`: Reaching the target without a safe boundary reports `waiting for safe rollover`; budget pressure may safely roll over below 100%, so percentage is a target rather than a deadline.
- `RB-013`: Empty or unavailable authoritative membership preserves the existing two-region UI.
- `RB-014`: The remote conductor contract, protocol version, developer reference, bundled remote conductor version literals, and their smoke/handshake tests move together.

## Accepted Decision Register

### `DEC-001` — Exact third UI region

- **Decision**: Render a conductor-specific third section whose membership exactly matches `MyCustomizeConductor`’s Pre-Group Interval.
- **Rationale**: An approximation could disagree with runtime behavior and mislead users.
- **Rejected alternatives**: Token-based visual estimation.
- **Downstream impact**: UI partitioning must consume store-owned member IDs.
- **Depends on**: None.
- **Decided implementation**: Exact region membership, not inferred token boundaries.
- **Left to the implementer**: Reversible spacing, color, and typography details consistent with Protected Tail styling.

### `DEC-002` — Keep-full interaction and rollover lifecycle

- **Decision**: While displayed in Pre-Group, blocks cannot be human-folded, manually grouped, ordinarily conductor-folded, or ordinarily conductor-grouped. Inspection remains available. Safe rollover is the sole grouping transition.
- **Rationale**: Presentation and behavior must both honor “full until grouped.”
- **Rejected alternatives**: Visual distinction while retaining manual fold/group controls.
- **Downstream impact**: Enforcement belongs in store entry points and plan validation, not only disabled UI controls.
- **Depends on**: `DEC-001`.
- **Decided implementation**: Store gates human mutations; rollover removes grouped IDs from next declared membership atomically.
- **Left to the implementer**: Private helper names and local validation organization.

### `DEC-003` — Visibility in both lenses

- **Decision**: Show Pre-Group in Map and Transcript.
- **Rationale**: Users must not lose lifecycle visibility by switching lenses.
- **Rejected alternatives**: Map-only visibility.
- **Downstream impact**: Both render paths use the same store membership helper.
- **Depends on**: `DEC-001`, `DEC-002`.
- **Decided implementation**: Framed Map section plus Transcript boundary/row indicator.
- **Left to the implementer**: Exact icon and accessible label wording, provided “Pre-Group” remains explicit.

### `DEC-004` — Visible progress and safe-rollover explanation

- **Decision**: Show label, current/target tokens, fill percentage, and lifecycle status.
- **Rationale**: A border alone does not explain the stage or transition conditions.
- **Rejected alternatives**: Boundary-only presentation.
- **Downstream impact**: Existing status metrics gain target and phase information but remain display-only.
- **Depends on**: `DEC-001`, `DEC-003`.
- **Decided implementation**: Distinguish `accumulating` from `waiting for safe rollover`; do not promise rollover exactly at 100%.
- **Left to the implementer**: Number formatting and whether explanatory copy is inline or in an accessible tooltip.

### `DEC-005` — Narrow conductor ownership through the store

- **Decision**: Pre-Group is first-class behavioral state owned narrowly by `MyCustomizeConductor` and enforced by `AccordionStore`; display status is not a behavioral source.
- **Rationale**: Status is explicitly display-only and can be stale. Global involvement locks are too broad.
- **Rejected alternatives**: Status-carried member IDs and a global `human-steering` lock.
- **Downstream impact**: Contract, store, remote runner, and UI share one typed membership seam. Protected Tail and unrelated older blocks remain unaffected.
- **Depends on**: `DEC-001`, `DEC-002`.
- **Decided implementation**: Ownership ends on rollover/removal, detach, or conductor replacement; observation remains available.
- **Left to the implementer**: Internal collection representation, provided reads are reactive and ID-based.

### `DEC-006` — Complete declarative plan snapshots

- **Decision**: Each region-aware conductor plan carries complete next membership rather than incremental reserve/release commands.
- **Rationale**: Complete snapshots reuse revision staleness handling, make rollover atomic, and avoid a second state machine.
- **Rejected alternatives**: Incremental reserve/release commands.
- **Downstream impact**: In-process results accept a plan envelope; remote command messages carry equivalent optional metadata; the store holds the last complete plan for `null`/remote-wait behavior.
- **Depends on**: `DEC-005`.
- **Decided implementation**: Empty membership clears; partial rollover declares only remaining members; legacy command arrays normalize to no owned region.
- **Left to the implementer**: Equivalent local normalization helpers and naming.

## Implementation Plan

### Area: Conductor plan contract

- **Coverage**: `DEC-005`, `DEC-006`, `US-001`, `RB-001`, `RB-003`, `RB-005`, `RB-007`
- **Contract**: Add a typed complete-plan envelope while preserving legacy `Command[] | null` results. Pre-Group metadata contains durable member IDs and represents complete next membership.
- **Decision constraints**: Metadata is behavioral plan state, not a new `Command` kind and not conductor status.
- **Code anchors**: `extensions/accordion/conductors/contract/conductor.ts` → `Command`, `Conductor`; `extensions/accordion/conductors/contract/index.ts` → contract barrel.
- **Existing behavior**: `Conductor.conduct(view)` returns `Command[] | null`; arrays are complete desired command state.
- **Required edits**: Introduce and export `PreGroupRegion`, `ConductorPlan`, and a backward-compatible conductor result type; update contract comments.
- **Normative snippet**:

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

`MyCustomizeConductor` always supplies `preGroup`, including `{ memberIds: [] }`; a legacy array or omitted field owns no region.
- **Test seam**: Type-check all in-process conductors and run Vitest; recognizable success is a green suite with existing legacy conductor results unchanged.
- **Wiring**: Re-export through the existing contract barrel and update imports where results are normalized.
- **Grounding evidence**: `GROUND-004`, `GROUND-005`.

### Area: MyCustomizeConductor plan production

- **Coverage**: `DEC-001`, `DEC-002`, `DEC-004`, `DEC-006`, `US-001`, `US-003`, `RB-001`, `RB-007`, `RB-008`, `RB-009`, `RB-011`, `RB-012`
- **Contract**: Every non-null return declares the exact next Pre-Group member IDs. Ordinary commands exclude those IDs. Rollover commands remove consumed IDs from next membership and retain unconsumed safe-range residue.
- **Decision constraints**: Reuse existing calculation and safety functions; do not create a second UI-specific boundary algorithm.
- **Code anchors**: `extensions/accordion/conductors/my-customize-conductor/my-customize-conductor.ts` → `conduct`, `finishConduct`, `preGroupBlocks`, `tryEmitGroup`; `chunked-compaction.ts` → `computePreGroupFromIndex`, `selectCompactionRange`, `trimOpenToolPairs`, `noOpenToolPairAcrossPreGroupTail`.
- **Existing behavior**: Exact blocks and IDs are already computed and excluded from ordinary folds/groups. `finishConduct` emits token/fill telemetry. Rollover safety and early-pressure paths already exist.
- **Required edits**: Make `finishConduct` return a `ConductorPlan`; carry next member IDs through every early return, hold/replay, Atomic Budget Rebase, normal, early-rollover, and partial-rollover path; add `preGroupTargetTokens` and a display phase metric.
- **Test seam**: Extend `extensions/accordion/app/src/lib/engine/conductor.compaction-naive.test.ts`. Assert exact member IDs, no ordinary overlap, full and partial rollover, open-pair waiting, complete-turn trimming, below-100% pressure rollover, and over-100% waiting.
- **Wiring**: No new registration; `MyCustomizeConductor` remains in `IN_PROCESS_CONDUCTORS`.
- **Grounding evidence**: `GROUND-002`, `GROUND-003`.

### Area: AccordionStore ownership and enforcement

- **Coverage**: `DEC-002`, `DEC-005`, `DEC-006`, `US-001`, `RB-002`, `RB-003`, `RB-004`, `RB-005`, `RB-006`, `RB-007`, `RB-008`, `RB-013`
- **Contract**: Store applies complete membership and commands as one state transition. Current membership is reactive, ID-based, and is the sole behavioral/UI source. Human fold/group intersections are no-ops/refusals. Inspection does not mutate ownership.
- **Decision constraints**: Preserve Protected Tail, existing involvement-lock behavior, provider-validity clamps, human ownership outside Pre-Group, and detach freeze semantics.
- **Code anchors**: `extensions/accordion/app/src/lib/engine/store.svelte.ts` → `runConductor`, `applyCommands`, `canFold`, `fold`, `toggle`, `createGroup`, `attach`, `detach`, `clearConductorState`.
- **Existing behavior**: `runConductor` resets conductor state and applies complete command arrays; store methods independently enforce Protected Tail, groups, pins, and locks.
- **Required edits**: Normalize legacy arrays and plan envelopes; retain the last complete plan for `null`; validate and set next membership before presenting the atomic result; reject human ranges intersecting membership; expose `isPreGroup` and ordered membership/boundary helpers; clear membership on detach/swap/no-region plans; report malformed or overlapping plan intent through existing conductor diagnostics/clamp patterns without crashing.
- **Normative snippet**:

```text
next membership = declared IDs still present and valid in the current snapshot
ordinary command overlaps next membership → clamp/refuse
rollover command IDs absent from next membership → apply normally
membership + commands become observable together
```

- **Test seam**: Extend store host/fold/group tests. Verify human fold/group refusal, unrelated older controls unchanged, inspection availability, malformed-ID safety, `null` holding the last complete plan, empty/legacy clearing, detach/swap clearing, and atomic partial rollover.
- **Wiring**: All Map, Transcript, Inspector, and remote code consume store helpers rather than duplicating membership checks.
- **Grounding evidence**: `GROUND-004`, `GROUND-005`; governed by Accordion ADRs 0006, 0007, 0008, and 0011.

### Area: Remote conductor protocol

- **Coverage**: `DEC-005`, `DEC-006`, `RB-002`, `RB-003`, `RB-004`, `RB-014`
- **Contract**: `ConductorCommandsMessage` carries optional complete Pre-Group metadata in the same revision as commands. Stale messages alter neither. Missing metadata owns no region.
- **Decision constraints**: Preserve the shared command vocabulary and revision gate; status remains display-only.
- **Code anchors**: `extensions/accordion/conductors/contract/protocol.ts` → `CONDUCTOR_PROTOCOL_VERSION`, `ConductorCommandsMessage`; `extensions/accordion/app/src/lib/live/conductorClient.svelte.ts` → `RemoteRunner` command/status handlers.
- **Existing behavior**: Protocol v3 carries revisioned command arrays; stale revisions are ignored; status is independent and display-only.
- **Required edits**: Add optional `preGroup`; update the accepted protocol version and history; make the remote runner pass one complete plan into the store only after greeting/revision validation; update bundled remote conductor version literals and message shapes where required.
- **Test seam**: Extend `conductorClient.test.ts` for metadata application, stale metadata rejection, missing metadata, handshake version, and status non-interference; run bundled conductor smoke tests that pin protocol version.
- **Wiring**: Update `extensions/accordion/docs/conductor-protocol.md`, `extensions/accordion/conductors/README.md`, and bundled wire conductors/version literals discovered under `extensions/accordion/conductors/`.
- **Grounding evidence**: `GROUND-003`, `GROUND-005`, `GROUND-006`.

### Area: Map and Transcript presentation

- **Coverage**: `DEC-001`, `DEC-003`, `DEC-004`, `US-001`, `US-002`, `US-003`, `RB-010`, `RB-011`, `RB-012`, `RB-013`
- **Contract**: Both lenses render exact store membership. Map places a distinct framed Pre-Group section between older context and Protected Tail. Transcript marks the same rows and boundary. Controls/tooltips truthfully advertise inspection-only behavior.
- **Decision constraints**: Visual treatment may echo Protected Tail but must say “Pre-Group” and communicate temporary conductor ownership rather than host-tail protection.
- **Code anchors**: `extensions/accordion/app/src/lib/ui/map/ContextMap.svelte` → `protectedFrom`, tile partitions, `displayRows`, `protSpecs`, `tip`, range selection, Map boxes, Transcript rows.
- **Existing behavior**: Two Map boxes and Protected Tail transcript flags; range selection clamps only at `protectedFromIndex`.
- **Required edits**: Partition older/pre-group/protected arrays; render a middle box and progress header; exclude Pre-Group from manual range selection and fold affordances through store helpers; add Transcript boundary/indicators and accessible explanatory text; retain the existing two-region layout when membership is empty.
- **Test seam**: Add a Testing Library/jsdom component test near `ContextMap.svelte` for both lenses, exact row membership, accessible label/progress text, disabled/refused controls, empty fallback, and partial rollover. Existing canvas-specific drawing remains covered by its current tests.
- **Wiring**: Read authoritative membership from `AccordionStore`; read progress from the existing conductor status source only for display.
- **Grounding evidence**: `GROUND-001`, `GROUND-003`, `GROUND-004`.

### Area: Domain and architecture documentation

- **Coverage**: `DEC-001`, `DEC-005`, `DEC-006`, `RB-014`
- **Contract**: Documentation describes Pre-Group as conductor-owned plan state and distinguishes it from Protected Tail and display telemetry.
- **Code anchors**: `CONTEXT.md` → `Pre-Group Interval`; `docs/adr/0001-conductor-owned-pre-group-region.md`; `extensions/accordion/docs/conductor-protocol.md`.
- **Existing behavior**: Glossary and ADR were created during the grill; conductor developer docs still describe only `Command[] | null`.
- **Required edits**: Keep glossary/ADR aligned with final type names and update copy-paste protocol examples and version history.
- **Test seam**: Type-check copied TypeScript snippets where existing documentation tests support it; otherwise verify references through the build/check gate.
- **Wiring**: Cross-link the new architectural decision from relevant Accordion conductor documentation when useful.
- **Grounding evidence**: `GROUND-006`.

## Global Build & Wiring Notes

- The in-process contract remains primary; the WebSocket form mirrors the same complete-plan semantics.
- Because the accepted handoff includes a protocol version update, update every bundled literal and handshake fixture found under `extensions/accordion/conductors/`, not only `protocol.ts`.
- Preserve the wire-facing `Command` union. Pre-Group is plan metadata, not a fold/group wire operation.
- Status metrics remain non-authoritative and display-only.

## Testing Decisions

- Extend existing deterministic `MyCustomizeConductor` tests rather than testing private helpers.
- Exercise store behavior through public interfaces: plan application, `canFold`, `fold`, `createGroup`, attach/detach, and observable membership.
- Exercise remote behavior through `RemoteRunner` messages and revision ordering.
- Exercise user-visible Map/Transcript behavior with Testing Library and accessible queries.
- Run from `extensions/accordion/app`:

```text
npm test
npm run check
```

Expected result: Vitest exits successfully with all suites green; `svelte-check` reports zero errors and zero warnings. Also run affected bundled remote-conductor smoke tests using their existing commands when protocol literals change.

## Out of Scope

- Changing Protected Tail ownership or sizing.
- Taking the global `human-steering`, `agent-unfold`, or `tail-size` locks for Pre-Group.
- Adding owned regions to conductors other than `MyCustomizeConductor`.
- Replacing existing complete-turn, barrier, tool-pair, minimum-saving, early-rollover, or Atomic Budget Rebase logic.
- Estimating Pre-Group membership from tokens or conductor status.
- Changing group wire semantics, digest generation, or agent recall/unfold behavior.
- Settling reversible visual polish beyond the explicit three-region hierarchy and accessible labels.

## Unresolved Gaps

None.

## Further Notes

- Grill ledger: `.scratch/grills/k7p3n9v2x4qm/ledger.md`
- Grounding evidence: `.scratch/grills/k7p3n9v2x4qm/grounding.md`
- Domain glossary: `CONTEXT.md`
- Architectural decision: `docs/adr/0001-conductor-owned-pre-group-region.md`
