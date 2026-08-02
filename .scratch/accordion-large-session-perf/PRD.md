# PRD: Accordion Large-Session Performance

## Problem Statement

When an Accordion-managed Pi session reaches ~150k+ provider tokens (~1000 blocks), the browser dashboard tab freezes and becomes unresponsive. The freeze is caused by:

1. **Redundant reactive cascades** introduced by the `feature/pre-group-visibility` branch — `preGroupMemberIds` is reassigned on every conductor pass (even when unchanged), cascading through ContextMap filter-based derivations.
2. **Double/quadruple reconciliation per sync** — `setHarnessBreakdown` and `appendBlocks` each independently call `refold()`, causing 2–4 full O(n)×5 conductor passes per incoming message.
3. **Full canvas redraw at 60fps** — the ghost animation loop calls `scheduleRedraw()` (full O(n) repaint) every frame instead of repainting only ghost tiles via the existing partial redraw infrastructure.

The Accordion broker and extension remain alive during the freeze — the failure is purely main-thread saturation in the browser frontend.

## Solution

Eliminate the freeze by: fixing the pre-group reactive regression, reducing reconciliation passes to exactly one per sync, converting the ghost loop to partial redraws, and establishing a performance harness that guards against future regressions at scale.

## User Stories

1. As a developer using Accordion in a long session, I want the dashboard to remain responsive at 150k+ tokens, so that I can observe and control folding without reloading the tab.

2. As a developer, I want a store-level performance benchmark that runs in CI, so that regressions in reconciliation cost are caught before merge.

3. As a developer, I want a browser-level parameterized performance harness, so that I can validate end-to-end responsiveness across different scenarios (append, full-reset, rapid-fire, ghost-idle, budget-drag).

## Walking Skeleton

`US-001` — the thinnest end-to-end path: implement the targeted reactive fix + `applySync()` + ghost partial redraw, validated by a store-level benchmark proving exactly 1 refold per sync at 982 blocks under 100ms.

## Required Behaviors

- `RB-001`: `applySync` must apply harness before blocks (correct ordering), regardless of how callers previously ordered individual setter calls. Fixes the sessionSlots reversed-order bug (GROUND-007).
- `RB-002`: `preGroupMemberIds` must not trigger Svelte reactivity when the new value is content-equal to the current value.
- `RB-003`: `isPreGroup()` must remain O(1) per call (Set lookup), not O(n) (array includes).
- `RB-004`: Ghost animation must not cause full canvas redraws. Only ghost tile positions are repainted per frame.
- `RB-005`: All existing conductor and store tests (65+) must continue to pass with no behavioral changes to fold/group/override output.
- `RB-006`: The store-level performance benchmark must run without a browser (vitest, agent-runnable in worktrees).
- `RB-007`: The browser-level performance harness must be isolated in its own `package.json` and must not affect the pi root or accordion app dependencies.

## Accepted Decision Register

### DEC-001 — Transactional sync via `applySync()` method
- **Decision**: Add a public `applySync(opts)` method to `AccordionStore` that applies harness, blocks, contextWindow, and budget in one call with exactly one `refold()`. Standalone setters (`setHarnessBreakdown`, `appendBlocks`, `setBudget`) retain their own `refold()` calls.
- **Rationale**: The sync handler is the only hot path calling 2+ setters sequentially. UI controls and tests call individual setters — they're fine with one refold each.
- **Rejected alternatives**: Transaction/commit pattern (Option B) — adds lifecycle complexity, breaks every test, no current caller needs it beyond the sync handler.
- **Downstream impact**: Both `liveClient.svelte.ts` and `sessionSlots.svelte.ts` sync handlers change to call `applySync()` instead of individual setters. Fixes sessionSlots order bug implicitly.
- **Depends on**: None
- **Decided implementation**: New method on `AccordionStore` at ~line 1270 area. Internally: contextWindow → budget → harness+calibration → dedupe+append → one `refold()`. Returns `boolean` (true if state changed).
- **Left to the implementer**: Parameter validation order within `applySync`, exact JSDoc wording.

### DEC-002 — No-op guard on preGroupMemberIds
- **Decision**: Before reassigning `preGroupMemberIds` in `runConductor()`, compare with shallow array equality. Skip assignment if unchanged.
- **Rationale**: Prevents spurious Svelte reactive cascade through ContextMap derivations on every conductor pass when pre-group membership hasn't changed (the common case).
- **Rejected alternatives**: Deep reactive proxy comparison (Svelte handles this for objects but not array reference changes).
- **Downstream impact**: ContextMap derivations (`olderTiles`, `preGroupTiles`, `olderBlocks`, etc.) only re-run when pre-group membership actually changes.
- **Depends on**: None
- **Decided implementation**: `arraysEqual(oldIds, newIds)` check at line 985 in `runConductor()`. Utility is a simple shallow length + element comparison.
- **Left to the implementer**: Whether `arraysEqual` is inline or imported from a utils module.

### DEC-003 — Set-based isPreGroup
- **Decision**: Replace `this.preGroupMemberIds.includes(id)` with a `Set<string>` lookup derived from `preGroupMemberIds`.
- **Rationale**: `isPreGroup()` is called per-block in `canFold()` which appears in multiple ContextMap derivations. O(1) vs O(n) per call.
- **Rejected alternatives**: None credible — `.includes()` on a per-block-called method is categorically wrong.
- **Downstream impact**: None externally — same semantics, faster.
- **Depends on**: DEC-002 (the Set invalidates only when the array actually changes)
- **Decided implementation**: `private preGroupSet = $derived(new Set(this.preGroupMemberIds))` as a class field. `isPreGroup` reads `this.preGroupSet.has(id)`.
- **Left to the implementer**: Whether to use `$derived` or manually maintain the Set in the no-op guard.

### DEC-004 — Use existing this.index in normalizeConductorResult
- **Decision**: Replace `new Map(this.blocks.map(...))` in `normalizeConductorResult()` with `this.index` (which already maps id→position).
- **Rationale**: Eliminates an O(n) Map allocation on every conductor pass. `this.index` is maintained in lockstep with `this.blocks` already.
- **Rejected alternatives**: None — `this.index` is the same data.
- **Downstream impact**: None — same sort result.
- **Depends on**: None
- **Decided implementation**: Change `normalizeConductorResult` (line 928) to use `this.index` directly for the `.sort()` comparator.
- **Left to the implementer**: None.

### DEC-005 — Ghost partial redraw
- **Decision**: Replace `scheduleRedraw()` in the ghost tick loop with `schedulePartialRedraw(ghostIndices)`, using the existing partial redraw infrastructure.
- **Rationale**: Ghost tiles are typically 1–5 at a time. Full O(n) redraw at 60fps is wasteful. The partial mechanism already exists and is proven (used for hover).
- **Rejected alternatives**: None — existing infrastructure covers this exactly.
- **Downstream impact**: Ghost animation visually identical. Other spec-change or resize paths still trigger full redraws (unchanged).
- **Depends on**: None
- **Decided implementation**: In `TileCanvas.svelte` at line 257, replace `scheduleRedraw()` with a ghost-index collection + `schedulePartialRedraw(ghostIndices)`.
- **Left to the implementer**: Whether to cache ghost indices between ticks (micro-optimization for very large spec arrays).

### DEC-006 — Performance harness location and structure
- **Decision**: All performance infrastructure lives in `extensions/accordion/app/perf/` with its own `package.json`, `vitest.config.ts`, and optional Playwright deps. Store-level tests in `perf/store/`, browser-level in `perf/browser/`.
- **Rationale**: Isolation from pi root and accordion app. Agents run `store/` tests; humans/CI run `browser/` tests. Own deps don't pollute.
- **Rejected alternatives**: Putting benchmarks in `engine/__bench__/` (mixes concerns with correctness tests); putting browser harness at extension root (pollutes pi package).
- **Downstream impact**: New folder, new `package.json`. Not referenced by app or extension builds.
- **Depends on**: None
- **Decided implementation**: `perf/store/` contains vitest tests importing AccordionStore via relative path. `perf/browser/` contains scenario runner with WS injection.
- **Left to the implementer**: Exact Playwright version pin, README content.

### DEC-007 — Browser harness: parameterized scenarios
- **Decision**: Browser performance tests are defined as `PerfScenario` objects (setup + action + thresholds). A general runner executes any scenario. Built-in scenarios ship for: one-message-at-scale, full-reset, rapid-fire, ghost-idle, budget-drag, group-large-range.
- **Rationale**: Reusable for variant testing. New scenarios are data, not new test infrastructure.
- **Rejected alternatives**: Hard-coded single test (not extensible).
- **Downstream impact**: None to existing code.
- **Depends on**: DEC-006
- **Decided implementation**: `PerfScenario` interface with `setup`, `action` (union of action types), `thresholds`. `runScenario()` function handles setup via WS injection, executes action, collects Long Task API + timing, returns structured `PerfResult`.
- **Left to the implementer**: Exact threshold numbers (calibrated during implementation), additional action types added later.

### DEC-008 — Browser harness injection via real WebSocket
- **Decision**: The browser harness injects sessions by connecting as a fake extension over WebSocket (sends `hello` + `sync`), exercising the real liveClient → store → UI path.
- **Rationale**: Tests the actual path where the freeze occurred. Direct store hydration via `window.__perf__` bypasses the transport layer.
- **Rejected alternatives**: Option B (direct store hydration) — doesn't validate the full stack.
- **Downstream impact**: Harness needs to know the WS protocol shape (`hello`, `sync` frames).
- **Depends on**: DEC-006, DEC-007
- **Decided implementation**: `perf/browser/inject.ts` — opens WS, sends protocol-correct `hello` + `sync(full=true, blocks=[...])`, awaits `plan` reply.
- **Left to the implementer**: Port discovery, connection timeout handling.

## Implementation Plan

### Area: Store — Reactive Fix & Transactional Sync

- **Coverage**: DEC-001, DEC-002, DEC-003, DEC-004, US-001, RB-001, RB-002, RB-003, RB-005
- **Contract**: `applySync` applies state in correct order (contextWindow → budget → harness+calibration → blocks) and fires exactly 1 `refold()`. Returns `false` when no state changes. `preGroupMemberIds` is never reassigned when content-equal. `isPreGroup()` is O(1).
- **Decision constraints**: DEC-001 (applySync shape), DEC-002 (no-op guard), DEC-003 (Set), DEC-004 (reuse this.index)
- **Code anchors**:
  - `extensions/accordion/app/src/lib/engine/store.svelte.ts` → `AccordionStore` (line 110)
  - `preGroupMemberIds` (line 205)
  - `isPreGroup` (line 864)
  - `normalizeConductorResult` (line 928)
  - `runConductor` (line 949), reassignment at line 985
  - `setHarnessBreakdown` (line 1270)
  - `appendBlocks` (line 1299)
  - `refold` (line 911)
- **Existing behavior**: 2–4 `refold()` per sync; `preGroupMemberIds` reassigned unconditionally; `isPreGroup` uses `.includes()`; `normalizeConductorResult` allocates redundant Map.
- **Required edits**:
  - Add `applySync(opts)` public method (DEC-001, RB-001)
  - Add `arraysEqual` check before `preGroupMemberIds` assignment in `runConductor` (DEC-002, RB-002)
  - Add `private preGroupSet` derived from `preGroupMemberIds`; change `isPreGroup` to use it (DEC-003, RB-003)
  - Replace `new Map(...)` with `this.index` in `normalizeConductorResult` (DEC-004)
- **Normative snippet**:
  ```ts
  applySync(opts: {
    harness?: HarnessBreakdown;
    blocks: Block[];
    contextWindow?: number;
    budget?: number;
  }): boolean {
    let changed = false;
    if (opts.contextWindow != null) { /* set without refold */ }
    if (opts.budget != null) { /* set without refold */ }
    if (opts.harness) { /* updateHarness + calibration without refold */ changed = true; }
    /* dedupe + append blocks without refold */
    if (freshBlocks.length) changed = true;
    if (changed) this.refold();
    return changed;
  }
  ```
- **Test seam**: Existing tests — `cd extensions/accordion/app && vitest run src/lib/engine/` (65+ tests). New refold-count assertion in `perf/store/`.
- **Wiring**: None — internal method addition to existing class.
- **Grounding evidence**: GROUND-001, GROUND-002, GROUND-003, GROUND-004, GROUND-005, GROUND-006, GROUND-007, GROUND-014

### Area: Live Client & Session Slots — Adopt applySync

- **Coverage**: DEC-001, US-001, RB-001
- **Contract**: Sync handlers call `store.applySync(...)` instead of individual setters. Correct ordering guaranteed by `applySync` internals.
- **Decision constraints**: DEC-001 (callers switch to applySync)
- **Code anchors**:
  - `extensions/accordion/app/src/lib/live/liveClient.svelte.ts` → sync handler, `setHarnessBreakdown` (line 318), `appendBlocks` (line 383)
  - `extensions/accordion/app/src/lib/live/sessionSlots.svelte.ts` → sync handler, `appendBlocks` (line 385), `setHarnessBreakdown` (line 389)
- **Existing behavior**: liveClient: harness→blocks (correct order, 2 refolds). sessionSlots: blocks→harness (WRONG order, 2 refolds).
- **Required edits**:
  - In `liveClient.svelte.ts`: replace `setHarnessBreakdown` + `appendBlocks` calls with single `store.applySync({ harness: msg.harness, blocks: msg.blocks.map(wireToBlock), contextWindow, budget })`
  - In `sessionSlots.svelte.ts`: same replacement — fixes ordering bug implicitly
- **Test seam**: Integration tests in `extension/accordion.chunkedCompactionJsonl.test.ts` exercise the WS round-trip. Store-level perf tests validate refold count.
- **Wiring**: None — callers change, no new modules.
- **Grounding evidence**: GROUND-006, GROUND-007

### Area: TileCanvas — Ghost Partial Redraw

- **Coverage**: DEC-005, US-001, RB-004
- **Contract**: Ghost animation loop repaints only ghost tile positions per frame. Full redraws remain for spec changes, canvas resize, and geometry changes.
- **Decision constraints**: DEC-005
- **Code anchors**:
  - `extensions/accordion/app/src/lib/ui/map/TileCanvas.svelte` → `startGhostLoop` (line 253), `scheduleRedraw()` in tick (line 257), `schedulePartialRedraw` (line 171)
- **Existing behavior**: `scheduleRedraw()` per tick → full O(n) canvas clear + redraw at 60fps.
- **Required edits**:
  - In `tick()` at line 257: replace `scheduleRedraw()` with ghost-index collection + `schedulePartialRedraw(ghostIndices)`
- **Normative snippet**:
  ```ts
  function tick() {
    ghostPhase = (ghostPhase + 0.06) % (Math.PI * 2);
    const ghostIndices: number[] = [];
    for (let i = 0; i < specs.length; i++) {
      if (specs[i].kind === "ghost") ghostIndices.push(i);
    }
    schedulePartialRedraw(ghostIndices);
    // ... existing hasGhosts check + loop continuation
  }
  ```
- **Test seam**: Visual correctness validated by existing frontend-coach recordings. Performance validated by `perf/browser/` ghost-idle scenario.
- **Wiring**: None — internal change within TileCanvas.
- **Grounding evidence**: GROUND-008, GROUND-009, GROUND-010

### Area: Performance Harness — Store Level

- **Coverage**: DEC-006, US-002, RB-005, RB-006
- **Contract**: Vitest tests that assert: (a) exactly 1 `refold()` per `applySync` call, (b) 982-block append completes under 100ms, (c) no-op sync returns false with no reactive state change.
- **Decision constraints**: DEC-006 (location in `app/perf/`), DEC-001 (applySync is the target)
- **Code anchors**:
  - Fixture: `extensions/accordion/app/static/sample-session.jsonl` (982 blocks, 147k tokens)
  - Vitest config pattern: `extensions/accordion/app/vitest.config.ts`
  - AccordionStore import: `./store.svelte` (relative from engine); from perf: via alias or relative path to `src/lib/engine/store.svelte`
- **Required edits**:
  - Create `extensions/accordion/app/perf/package.json` (vitest dep)
  - Create `extensions/accordion/app/perf/vitest.config.ts` (mirrors app config aliases)
  - Create `extensions/accordion/app/perf/fixtures/helpers.ts` (shared `makeStore`, `blk`, `loadSampleSession`)
  - Create `extensions/accordion/app/perf/store/refold-count.test.ts`
  - Create `extensions/accordion/app/perf/store/timing.bench.ts`
  - Create `extensions/accordion/app/perf/store/regression.test.ts`
- **Test seam**: Self-contained — `cd extensions/accordion/app/perf && npx vitest run store/`
- **Wiring**: Own `vitest.config.ts` with same `$conductors` alias resolution as main app. Imports store via relative path traversal.
- **Grounding evidence**: GROUND-012, GROUND-013

### Area: Performance Harness — Browser Level

- **Coverage**: DEC-006, DEC-007, DEC-008, US-003, RB-007
- **Contract**: Parameterized `PerfScenario` interface. General `runScenario()` runner. WS injection via protocol-correct `hello` + `sync`. Built-in scenarios: one-message-at-scale, full-reset, rapid-fire-10, ghost-idle, budget-drag, group-large-range.
- **Decision constraints**: DEC-007 (scenario-driven), DEC-008 (WS injection)
- **Code anchors**:
  - WS protocol: `liveClient.svelte.ts` message handler (hello at ~line 255, sync at ~line 282)
  - WireBlock type: `extensions/accordion/app/src/lib/live/mapping.ts`
- **Required edits**:
  - Create `extensions/accordion/app/perf/browser/scenarios.ts` (PerfScenario type + built-in scenarios)
  - Create `extensions/accordion/app/perf/browser/inject.ts` (WS client that sends hello + sync)
  - Create `extensions/accordion/app/perf/browser/run.ts` (Playwright runner)
  - Create `extensions/accordion/app/perf/browser/report.ts` (result formatting + threshold check)
  - Add Playwright to `perf/package.json`
- **Normative snippet**:
  ```ts
  export interface PerfScenario {
    name: string;
    setup: {
      blockCount: number;
      tokensPerBlock?: number;
      groups?: number;
      foldedPct?: number;
    };
    action:
      | { type: "append"; blocks: number }
      | { type: "full-reset" }
      | { type: "rapid-fire"; messages: number; intervalMs: number }
      | { type: "budget-drag"; from: number; to: number; steps: number }
      | { type: "idle-with-ghosts"; durationMs: number }
      | { type: "group-range"; blockCount: number };
    thresholds: {
      maxLongTask?: number;
      maxTotalBlocking?: number;
      minFPS?: number;
      maxMemoryDelta?: number;
    };
  }
  ```
- **Test seam**: `cd extensions/accordion/app/perf && npm run perf` (human/CI only)
- **Wiring**: Own `package.json` with Playwright. Connects to running app via WS (port from env or discovery). Does not import from app source at build time — uses protocol types only.
- **Grounding evidence**: GROUND-006, GROUND-013

## Global Build & Wiring Notes

- The `perf/` folder's `vitest.config.ts` must replicate the `$conductors` alias from the main app's vitest config: `$conductors → path.resolve(__dirname, "../../conductors")`.
- Svelte rune support requires `@sveltejs/vite-plugin-svelte` with `compilerOptions: { runes: true }` in the perf vitest config (same as main app).
- The browser harness needs the accordion app running locally (default `localhost:5173` or configured port). It does NOT need the pi extension or a real pi session.
- No changes to `extensions/accordion/extension/` are required — the extension's `linearize()` and hook behavior are unchanged.

## Testing Decisions

| Seam | What it tests | Command | Expected result |
|------|---------------|---------|-----------------|
| Store refold count | `applySync` fires exactly 1 `refold()` | `cd app/perf && npx vitest run store/refold-count` | All assertions pass |
| Store timing | 982-block append < 100ms | `cd app/perf && npx vitest run store/timing` | Bench completes under threshold |
| Store regression | No-op sync returns false; unchanged preGroupMemberIds doesn't trigger Set rebuild | `cd app/perf && npx vitest run store/regression` | All assertions pass |
| Existing conductor suite | All fold/group/override behavior unchanged | `cd app && vitest run src/lib/engine/` | 65+ tests pass |
| Browser scenarios | Tab stays responsive under each scenario's thresholds | `cd app/perf && npm run perf` | All scenarios pass thresholds |

## Out of Scope

- SQLite, IndexedDB, or any persistence/database architecture
- Web Worker for conductor/store computation
- ContextMap virtualization (windowed rendering of transcript rows)
- Incremental indexes or versioned budget reconciliation
- Changes to the extension's `linearize()` or context hook
- Changes to conductor algorithms or fold/group logic
- Proactive Content Compression changes

## Unresolved Gaps

None.

## Further Notes

- Grounding file: `.scratch/accordion-large-session-perf/grounding.md`
- The pre-group branch (`feature/pre-group-visibility`) merge base is `d54c675`. The regression was introduced by commits `77ca894` (store changes) and the ContextMap additions. These are the files that need the fix.
- The sessionSlots order bug (GROUND-007) predates this branch but is fixed implicitly by DEC-001.
