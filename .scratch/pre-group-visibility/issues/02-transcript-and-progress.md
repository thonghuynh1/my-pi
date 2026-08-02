---
status: closed
---

# Pre-Group Transcript indicators and rollover progress

Type: AFK
Status: ready-for-agent

## Parent

`.scratch/pre-group-visibility/PRD.md`

## What to build

Complete the user-facing explanation of the conductor-owned Pre-Group Interval. Transcript must show the same authoritative membership as Map, and both lenses must show current/target tokens, fill percentage, and truthful lifecycle language for accumulation, safe-boundary waiting, and early safe rollover.

Covers `DEC-003`, `DEC-004`, `US-002`, `US-003`, the Transcript variant of `RB-010`, and `RB-011`, `RB-012`, `RB-013`.

## Implementation map

This issue consumes, and must not redefine, Issue 01’s outputs:

- `PreGroupRegion` and complete-plan semantics from `conductors/contract/conductor.ts`;
- `AccordionStore.isPreGroup` plus ordered authoritative membership;
- display-only metrics `preGroupTokens`, `preGroupTargetTokens`, `preGroupFillPct`, and `preGroupPhase`;
- the Map’s three-region hierarchy in `ContextMap.svelte`.

Edit `extensions/accordion/app/src/lib/ui/map/ContextMap.svelte` only after Issue 01 lands. Issue 01 owns the shared region partition; this issue owns Transcript and progress presentation.

### Transcript

Use the same store membership helper as Map. Insert an accessible `Pre-Group` boundary before the first member and mark each member row as temporarily conductor-owned. Keep role, token, inspection, and existing Protected Tail indicators intact. Pre-Group rows must not expose Fold or manual Group affordances; inspection remains available through the existing click/selection path. Do not label these rows as Protected Tail—the owner and lifecycle differ.

### Progress

Render visible, accessible text associated with the Pre-Group section, for example:

```text
Pre-Group · 10k / 15k · 67% · accumulating
```

Required semantics:

- `accumulating`: below target and no rollover just fired;
- `waiting for safe rollover`: target reached/exceeded but complete-turn/tool-pair safety delays grouping;
- `safe rollover`: rollover fired, including budget-pressure rollover below 100%;
- membership/progress unavailable: no fabricated values and no Pre-Group region.

Use conductor status only for explanatory metrics. Membership always comes from `AccordionStore`. Follow the existing local-vs-remote status selection pattern in `MapHeader.svelte`/`ConductorActivity.svelte`: prefer the active store’s status and fall back to `conductorStatus` for a remote runner. Exact number formatting, icon, and inline-vs-tooltip placement are reversible, but accessible text must contain the canonical `Pre-Group` name and numeric values.

Add `extensions/accordion/app/src/lib/ui/map/ContextMap.pre-group-transcript.test.ts` with Testing Library/jsdom. Use a real store with Issue 01’s plan application; status metrics may be set through the real conductor host/status seam, not by mocking membership.

Grounding: `GROUND-001`, `GROUND-002`, and `GROUND-003` in `.scratch/grills/k7p3n9v2x4qm/grounding.md`.

### Blocking edge

Producer: `01-authoritative-pre-group-map.md`.

Output: authoritative store membership helpers and display metric keys. Consumer: `ContextMap.svelte`. Crossing contract: member IDs determine rows/sections; metrics explain but never determine membership. This issue owns the real UI wiring and proves both values arrive together.

## Acceptance criteria

- [ ] **AC-02-01 — Transcript mirrors exact membership:** the first member has a visible Pre-Group boundary and every and only declared member row has a Pre-Group indicator.
  - Run: `npx vitest run src/lib/ui/map/ContextMap.pre-group-transcript.test.ts -t "mirrors authoritative pre-group membership in transcript"`
  - Expected: accessible queries find the boundary and exact declared row IDs; an older row and Protected Tail row are not marked Pre-Group.

- [ ] **AC-02-02 — Map shows accumulating values:** a real status update with `10_000` current, `15_000` target, and `67` percent appears in the Map Pre-Group section.
  - Run: `npx vitest run src/lib/ui/map/ContextMap.pre-group-transcript.test.ts -t "shows accumulating pre-group progress in map"`
  - Expected: accessible Map text contains `Pre-Group`, `10k`, `15k`, `67%`, and `accumulating`; changing any fixture value fails.

- [ ] **AC-02-03 — Transcript shows accumulating values:** the same real status update appears with the Transcript Pre-Group boundary.
  - Run: `npx vitest run src/lib/ui/map/ContextMap.pre-group-transcript.test.ts -t "shows accumulating pre-group progress in transcript"`
  - Expected: accessible Transcript text contains `Pre-Group`, `10k`, `15k`, `67%`, and `accumulating`.

- [ ] **AC-02-04 — Above-target waiting is truthful:** membership above target with an unsafe open-pair/turn boundary is labeled `waiting for safe rollover`.
  - Run: `npx vitest run src/lib/ui/map/ContextMap.pre-group-transcript.test.ts -t "labels above-target membership as waiting for safe rollover"`
  - Expected: the DOM contains `waiting for safe rollover`, retains member indicators, and contains no rolled-over state.

- [ ] **AC-02-05 — Early rollover does not treat percentage as a deadline:** a below-100% budget-pressure rollover reports safe rollover and consumes only released membership.
  - Run: `npx vitest run src/lib/ui/map/ContextMap.pre-group-transcript.test.ts -t "reports safe early rollover below the target percentage"`
  - Expected: percentage is below 100, phase is `safe rollover`, consumed indicators are absent, and declared residue remains.

- [ ] **AC-02-06 — Transcript inspection remains available:** clicking a Pre-Group row invokes inspection without changing membership.
  - Run: `npx vitest run src/lib/ui/map/ContextMap.pre-group-transcript.test.ts -t "keeps pre-group transcript rows inspectable"`
  - Expected: the inspection callback receives the exact member ID and membership is unchanged.

- [ ] **AC-02-07 — Transcript fold control is absent:** a foldable Pre-Group row exposes no Fold button while membership is active.
  - Run: `npx vitest run src/lib/ui/map/ContextMap.pre-group-transcript.test.ts -t "hides fold controls for pre-group transcript rows"`
  - Expected: the member row has no accessible Fold control; an older foldable control row still has one.

- [ ] **AC-02-08 — Empty Transcript fallback is clean:** empty authoritative membership shows no Pre-Group boundary or fabricated progress.
  - Run: `npx vitest run src/lib/ui/map/ContextMap.pre-group-transcript.test.ts -t "omits transcript pre-group UI for empty membership"`
  - Expected: existing older and Protected Tail rows remain, with no Pre-Group boundary, indicator, or progress text.

- [ ] **AC-02-09 — Focused UI regression suite passes:** existing map budget and protected-tail drain tests remain green.
  - Run: `npx vitest run src/lib/ui/map/ContextMap.pre-group-map.test.ts src/lib/ui/map/ContextMap.pre-group-transcript.test.ts src/lib/ui/map/MapHeader.budget.test.ts src/lib/ui/map/drain.test.ts`
  - Expected: all focused UI suites pass with no failed accessibility or behavior assertions.

## Blocked by

- `01-authoritative-pre-group-map.md`
