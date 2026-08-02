---
Status: ready-for-agent
status: closed
---

## Parent

`.scratch/accordion-large-session-perf/PRD.md`

## What to build

Adopt `applySync()` in `sessionSlots.svelte.ts` sync handler, replacing the individual `appendBlocks` + `setHarnessBreakdown` calls that are currently in **reversed order** (blocks before harness — a latent bug where the first refold uses stale harness/frozenFromIndex data in broker mode).

Covers: `DEC-001` (sessionSlots caller), `RB-001` (sessionSlots ordering fix)

## Implementation map

### sessionSlots.svelte.ts — sync handler

**File**: `extensions/accordion/app/src/lib/live/sessionSlots.svelte.ts`

**Current code (lines 385–389):**
```ts
slot.store.appendBlocks(msg.blocks.map(wireToBlock));   // line 385 — refold #1 with STALE harness
// ... possibly other logic ...
slot.store.setHarnessBreakdown(msg.harness);            // line 389 — refold #2
```

**Required edit** — replace with:
```ts
slot.store.applySync({
  harness: msg.harness && typeof msg.harness === "object" ? msg.harness : undefined,
  blocks: msg.blocks.map(wireToBlock),
  contextWindow: /* same cw logic as liveClient pattern from issue #01 */,
  budget: /* same budget logic, only if not budgetLive or changed */,
});
```

The contextWindow/budget handling should mirror the pattern established in `liveClient.svelte.ts` by issue #01.

### Blocking-edge contract from #01

- **Producer**: Issue #01 creates `AccordionStore.applySync()` method
- **Consumer**: This issue calls `slot.store.applySync(...)` in the sessionSlots sync handler
- **Contract**: `applySync(opts: { harness?, blocks, contextWindow?, budget? }): boolean`
- **Wiring**: Direct method call on the store instance held by the slot

## Acceptance criteria

- [ ] sessionSlots sync handler calls `applySync` instead of individual `appendBlocks` + `setHarnessBreakdown`
  - Run: `grep -n "appendBlocks\|setHarnessBreakdown" extensions/accordion/app/src/lib/live/sessionSlots.svelte.ts`
  - Expected: No matches in the sync message handler (only imports or unrelated code paths remain, if any)

- [ ] Harness is applied before blocks in broker mode (order bug fixed)
  - Run: `cd extensions/accordion/app/perf && npx vitest run store/refold-count`
  - Expected: Existing refold-count test (from #01) continues to pass — `applySync` guarantees correct internal ordering

- [ ] Broker-mode integration tests pass
  - Run: `cd extensions/accordion/app && npx vitest run src/lib/`
  - Expected: All tests pass including any broker/slot-related tests

## Blocked by

- `01-walking-skeleton-store-fix-and-benchmark.md` — provides the `applySync` method on `AccordionStore`
