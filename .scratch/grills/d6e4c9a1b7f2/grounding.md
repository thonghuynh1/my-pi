# Grounding — large Accordion session broker freeze

## GROUND-001 — Broker sync already uses a transactional store seam

Source: `extensions/accordion/app/src/lib/live/sessionSlots.svelte.ts`, `connectSlot()` sync branch, lines 356–395.

Current behavior: a broker full sync disposes and replaces the slot's `AccordionStore`, attaches the active conductor at line 373, then the handler calls `attachActiveConductor(slot.store)` again at line 387 before calling `slot.store.applySync(...)` at line 389.

Exact excerpts:

```ts
if (msg.full) {
    ...
    slot.store.completer = sendCompletion;
    attachActiveConductor(slot.store);
}
...
attachActiveConductor(slot.store);
const harness = ...;
slot.store.applySync({
    harness,
    blocks: msg.blocks.map(wireToBlock),
    contextWindow,
    budget,
});
```

Test prior art: `extensions/accordion/app/perf/store/refold-count.test.ts` exercises the store-level `applySync()` seam. `extensions/accordion/app/src/lib/live/sessionSlots.test.ts` currently covers slot lifecycle, not the WebSocket sync path.

## GROUND-002 — Direct mode has the intended one attach site for full reset

Source: `extensions/accordion/app/src/lib/live/liveClient.svelte.ts`, sync handler, lines 275–322.

Current behavior: `attachActiveConductor(session.store)` appears inside `if (msg.full)` at line 301, then the handler calls `session.store.applySync(...)` at line 322. There is no unconditional attach immediately before `applySync()` in this handler.

Exact excerpt:

```ts
if (msg.full) {
    ...
    session.store.completer = sendCompletion;
    attachActiveConductor(session.store);
}
...
session.store.applySync({
    harness,
    blocks: msg.blocks.map(wireToBlock),
    contextWindow,
    budget,
});
```

Test prior art: `extensions/accordion/app/src/lib/live/liveClient.budget.test.ts` covers budget defaults; no direct sync-handler performance seam exists.

## GROUND-003 — Store transactional sync avoids repeated refolds for changed sync state

Source: `extensions/accordion/app/src/lib/engine/store.svelte.ts`, `AccordionStore.applySync()`, lines 1346–1373.

Current behavior: `applySync()` applies context window, budget, harness, and blocks, then calls `this.refold()` once when state changed. The method comment states:

```ts
 * Transactional sync: apply harness, blocks, contextWindow, and budget in one
 * pass with exactly one refold(). Used by sync handlers to avoid 2-4× refold
 * per message. Standalone setters remain for UI controls and tests.
```

Test prior art: `extensions/accordion/app/perf/store/refold-count.test.ts` asserts the one-refold contract.

## GROUND-004 — The main-thread hot path already uses partial canvas repaint

Source: `extensions/accordion/app/src/lib/ui/map/TileCanvas.svelte`, `startGhostLoop()`, lines 253–268.

Current behavior: the animation loop collects ghost tile indices and calls `schedulePartialRedraw(ghostIndices)` rather than scheduling a full canvas redraw every frame.

Exact excerpt:

```ts
const ghostIndices: number[] = [];
for (let i = 0; i < specs.length; i++) {
    if (specs[i].kind === "ghost") ghostIndices.push(i);
}
schedulePartialRedraw(ghostIndices);
```

Test prior art: `.scratch/accordion-large-session-perf/issues/05-browser-perf-validation.md` defines the `ghost-idle` browser scenario and its long-task/FPS thresholds.

## GROUND-005 — Existing performance work defines the browser proof seam

Source: `.scratch/accordion-large-session-perf/issues/05-browser-perf-validation.md`.

Current behavior: the issue is `Status: ready-for-human`; it requires running the app and `npm run perf` from `extensions/accordion/app/perf`, then checking six scenarios and a 500ms hard ceiling.

Relevant scenarios: `one-message-at-scale`, `full-reset-at-scale`, `rapid-fire-10`, `ghost-idle`, `budget-drag`, and `group-large-range`.

## GROUND-006 — The authoritative runtime boundary is per Pi session, not the browser broker

Source: `docs/adr/0002-authoritative-accordion-folding-runtime.md`, especially the decision summary and broker section.

Current behavior: the AccordionStore in each Pi session remains authoritative for folding. The browser dashboard observes and controls revisioned state; the broker is not the owner of folding policy. ADR-0002 explicitly targets both direct and broker modes without a mode branch in the conductor.

## GROUND-007 — Existing working-tree changes are unrelated and must be preserved

Source: `git status --short` at investigation time.

Current behavior: the worktree already contains modifications to `.scratch/conductor-sent-unfolded-invariant/PRD.md` and `extensions/aiknow/index.ts`, plus an untracked `nul`. These are outside the Accordion freeze repair and must not be reverted or included accidentally.
