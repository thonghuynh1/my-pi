---
Status: ready-for-agent
status: closed
---

## Parent

`.scratch/accordion-large-session-perf/PRD.md`

## What to build

Convert the ghost animation loop in `TileCanvas.svelte` from full-canvas O(n) redraws at 60fps to partial redraws of only ghost tile positions, using the existing `schedulePartialRedraw` infrastructure.

Covers: `DEC-005`, `RB-004`, `RB-005`

## Implementation map

### TileCanvas.svelte — ghost loop

**File**: `extensions/accordion/app/src/lib/ui/map/TileCanvas.svelte`

**Current code (startGhostLoop → tick, line 253–260):**
```ts
function startGhostLoop() {
  if (ghostRafId !== null) return;
  function tick() {
    ghostPhase = (ghostPhase + 0.06) % (Math.PI * 2);
    scheduleRedraw();  // ← FULL O(n) canvas clear + redraw
    const hasGhosts = specs.some((s) => s.kind === "ghost");
    if (hasGhosts) {
      ghostRafId = requestAnimationFrame(tick);
    } else {
      ghostRafId = null;
    }
  }
  ghostRafId = requestAnimationFrame(tick);
}
```

**Required edit — replace `scheduleRedraw()` at line 257 with:**
```ts
function tick() {
  ghostPhase = (ghostPhase + 0.06) % (Math.PI * 2);
  const ghostIndices: number[] = [];
  for (let i = 0; i < specs.length; i++) {
    if (specs[i].kind === "ghost") ghostIndices.push(i);
  }
  schedulePartialRedraw(ghostIndices);
  const hasGhosts = ghostIndices.length > 0;
  if (hasGhosts) {
    ghostRafId = requestAnimationFrame(tick);
  } else {
    ghostRafId = null;
  }
}
```

**Why this works without further changes:**
- `schedulePartialRedraw` (line 171) adds indices to `partialDirty` Set and arms one rAF
- `runPartialRedraw` clears only affected tile rects via `tileRectCss(i, g)` then calls `drawOneTile(ctx, i, g)`
- `drawOneTile` (line 218) already reads current `ghostPhase` and computes `ghostOpacity(ghostPhase)` at draw time — no spec array mutation needed
- If a full redraw is also pending (from spec change or resize), it supersedes the partial — `partialDirty` is cleared when a full redraw fires first
- Bonus: reuse `ghostIndices.length > 0` instead of `specs.some(...)` — avoids a second O(n) scan

**Left to implementer**: Whether to hoist ghost index collection out of tick (only changes when specs change, not every frame). At typical ghost counts (1–5) the per-frame scan is trivial.

## Acceptance criteria

- [ ] Ghost animation loop uses `schedulePartialRedraw` instead of `scheduleRedraw`
  - Run: `grep -n "scheduleRedraw\|schedulePartialRedraw" extensions/accordion/app/src/lib/ui/map/TileCanvas.svelte`
  - Expected: Inside `tick()` function, only `schedulePartialRedraw` appears (no `scheduleRedraw`). `scheduleRedraw` remains in other contexts (spec change effect, resize, DPR change — those are correct full redraws).

- [ ] Ghost tiles still animate visually (opacity oscillation preserved)
  - Run: `cd extensions/accordion/app && npx vitest run src/lib/`
  - Expected: All existing tests pass. Ghost draw path unchanged — `drawOneTile` still applies `ghostOpacity(ghostPhase)`.

- [ ] Existing canvas rendering tests and full-redraw paths remain intact
  - Run: `cd extensions/accordion/app && npx vitest run`
  - Expected: All tests pass. `redraw()` still called from spec-change effect, resize, and DPR handlers.

## Blocked by

None - can start immediately.
