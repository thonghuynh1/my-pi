---
Status: ready-for-agent
status: closed
---

## Parent

`.scratch/accordion-large-session-perf/PRD.md`

## What to build

The walking skeleton: fix the pre-group reactive regression, add transactional `applySync()` to AccordionStore, adopt it in `liveClient.svelte.ts`, and prove via a store-level benchmark that the 982-block fixture reconciles in exactly 1 `refold()` under 100ms.

Covers: `DEC-001`, `DEC-002`, `DEC-003`, `DEC-004`, `US-001`, `US-002`, `RB-001` (liveClient), `RB-002`, `RB-003`, `RB-005`, `RB-006`

## Implementation map

### Store reactive fixes (`store.svelte.ts`)

**DEC-002 — No-op guard on preGroupMemberIds (line 985 in `runConductor`):**
```ts
// Before:
this.preGroupMemberIds = plan.preGroup?.memberIds ?? [];

// After:
const newIds = plan.preGroup?.memberIds ?? [];
if (!arraysEqual(this.preGroupMemberIds, newIds)) {
  this.preGroupMemberIds = newIds;
}
```
`arraysEqual`: simple shallow comparison — `a.length === b.length && a.every((v, i) => v === b[i])`. Inline as a private helper or module-level utility.

**DEC-003 — Set-based isPreGroup (line 864):**
```ts
// Add derived Set:
private preGroupSet = $derived(new Set(this.preGroupMemberIds));

// Change isPreGroup (line 864):
isPreGroup(blockOrId: Block | string): boolean {
  const id = typeof blockOrId === "string" ? blockOrId : blockOrId.id;
  return this.preGroupSet.has(id);
}
```

**DEC-004 — Reuse this.index in normalizeConductorResult (line 928):**
```ts
// Before:
const blockOrder = new Map(this.blocks.map((block, index) => [block.id, index]));
const memberIds = [...new Set(result.preGroup.memberIds)]
  .filter(id => typeof id === "string" && blockOrder.has(id))
  .sort((a, b) => (blockOrder.get(a) ?? 0) - (blockOrder.get(b) ?? 0));

// After:
const memberIds = [...new Set(result.preGroup.memberIds)]
  .filter(id => typeof id === "string" && this.index.has(id))
  .sort((a, b) => (this.index.get(a) ?? 0) - (this.index.get(b) ?? 0));
```

### Store transactional sync (`store.svelte.ts`)

**DEC-001 — applySync method** (add near line 1270, next to setHarnessBreakdown):
```ts
/**
 * Transactional sync: apply harness, blocks, contextWindow, and budget in one
 * pass with exactly one refold(). Used by sync handlers to avoid 2-4× refold
 * per message. Standalone setters remain for UI controls and tests.
 */
applySync(opts: {
  harness?: HarnessBreakdown;
  blocks: Block[];
  contextWindow?: number;
  budget?: number;
}): boolean {
  let changed = false;
  // Order matters: contextWindow → budget → harness+calibration → blocks
  if (opts.contextWindow != null && opts.contextWindow !== this.contextWindow) {
    this._contextWindow = opts.contextWindow;  // internal set without refold
    changed = true;
  }
  if (opts.budget != null && opts.budget !== this.budget) {
    this._budget = opts.budget;  // internal set without refold
    changed = true;
  }
  if (opts.harness) {
    this._applyHarness(opts.harness);  // extracted harness logic without refold
    changed = true;
  }
  const fresh = this._dedupeAndAppend(opts.blocks);  // extracted append logic without refold
  if (fresh > 0) changed = true;
  if (changed) this.refold();
  return changed;
}
```

The implementer extracts the internal logic from `setHarnessBreakdown` and `appendBlocks` into private helpers (`_applyHarness`, `_dedupeAndAppend`) that both the standalone setters and `applySync` share. The standalone setters continue to call `refold()` individually.

### liveClient adoption (`liveClient.svelte.ts`)

**Replace lines 318–383** (the setHarnessBreakdown + appendBlocks sequence in the sync handler):
```ts
// Before:
if (msg.harness && typeof msg.harness === "object") session.store.setHarnessBreakdown(msg.harness);
// ... (60+ lines of other logic) ...
session.store.appendBlocks(msg.blocks.map(wireToBlock));

// After:
session.store.applySync({
  harness: msg.harness && typeof msg.harness === "object" ? msg.harness : undefined,
  blocks: msg.blocks.map(wireToBlock),
  contextWindow: /* existing cw logic */,
  budget: /* existing budget logic, only if not budgetLive or changed */,
});
```

The contextWindow/budget logic currently at lines 306–315 folds into the `applySync` call. Only provide `budget` when `!budgetLive || windowChanged`.

### Store-level performance benchmark (`extensions/accordion/app/perf/`)

Create:
- `perf/package.json` — `{ "private": true, "scripts": { "test": "vitest run store/" }, "devDependencies": { "vitest": "..." } }`
- `perf/vitest.config.ts` — mirrors app's alias setup: `$conductors → ../../conductors/`, svelte plugin with runes
- `perf/fixtures/helpers.ts` — `makeStore(blocks)`, `blk(i, kind, tokens)`, `loadSampleSession()` (reads `../../static/sample-session.jsonl`)
- `perf/store/refold-count.test.ts` — asserts exactly 1 refold per applySync
- `perf/store/timing.bench.ts` — asserts 982-block append < 100ms
- `perf/store/regression.test.ts` — asserts no-op sync returns false; unchanged preGroupMemberIds doesn't cascade

**Refold count test approach**: Spy on `refold` (or the internal `runConductor`) call count:
```ts
const store = loadSampleSession();
store.setBudget(80_000);
const spy = vi.spyOn(store as any, 'runConductor');
store.applySync({ harness: mockHarness, blocks: [newBlock] });
expect(spy).toHaveBeenCalledTimes(1);
```

**Timing test approach**:
```ts
const store = loadSampleSession();
store.setBudget(80_000);
const start = performance.now();
store.applySync({ harness: mockHarness, blocks: [newBlock] });
const elapsed = performance.now() - start;
expect(elapsed).toBeLessThan(100);
```

## Acceptance criteria

- [ ] `applySync` fires exactly 1 `refold()` when given harness + blocks
  - Run: `cd extensions/accordion/app/perf && npx vitest run store/refold-count`
  - Expected: Test passes asserting `runConductor` called exactly once

- [ ] `applySync` returns `false` and fires 0 `refold()` when all blocks are already known and harness is unchanged
  - Run: `cd extensions/accordion/app/perf && npx vitest run store/regression`
  - Expected: Test passes asserting `runConductor` not called, return value is `false`

- [ ] 982-block sample session + 1 appended block reconciles in < 100ms
  - Run: `cd extensions/accordion/app/perf && npx vitest run store/timing`
  - Expected: `elapsed` assertion passes under 100ms threshold

- [ ] `preGroupMemberIds` assignment is skipped when content is unchanged
  - Run: `cd extensions/accordion/app/perf && npx vitest run store/regression`
  - Expected: Test asserts that after two consecutive `applySync` calls with same blocks, `preGroupMemberIds` setter is NOT invoked on the second call

- [ ] `isPreGroup()` uses Set (not `.includes()`)
  - Run: `cd extensions/accordion/app && npx vitest run src/lib/engine/`
  - Expected: All existing 65+ store/conductor tests pass (behavioral equivalence)

- [ ] `normalizeConductorResult` uses `this.index` (no `new Map(this.blocks.map(...))`)
  - Run: `cd extensions/accordion/app && npx vitest run src/lib/engine/`
  - Expected: All existing tests pass (same sort order)

- [ ] liveClient sync handler calls `applySync` (not individual setters)
  - Run: `cd extensions/accordion/app && npx vitest run src/lib/engine/` and `cd extensions/accordion/extension && npx vitest run`
  - Expected: All existing tests pass; no `setHarnessBreakdown` + `appendBlocks` sequence in the sync handler

- [ ] Existing 65+ conductor/store tests remain green
  - Run: `cd extensions/accordion/app && npx vitest run src/lib/engine/`
  - Expected: All tests pass with zero failures

## Blocked by

None - can start immediately.
