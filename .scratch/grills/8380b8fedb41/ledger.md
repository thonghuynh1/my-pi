# Grill Ledger — Browser Broker Freeze in Large Accordion Sessions

**ID:** 8380b8fedb41  
**Requirement:** Fix browser broker mode freezing in large sessions (~500 blocks, 500k context window) with accordion + my-customize-conductor during rollovers.

## Critical Finding

The original PRD's main fixes (DEC-001 through DEC-005) are **already implemented**:
- ✅ DEC-001: `applySync()` transactional method exists (store.svelte.ts:1208–1232) — single `refold()`
- ✅ DEC-002: `arraysEqual` guard on `preGroupMemberIds` (store.svelte.ts:1041)
- ✅ DEC-003: `preGroupSet = $derived(new Set(...))` with O(1) `isPreGroup()` (store.svelte.ts:235, 920)
- ✅ DEC-004: Need to verify `normalizeConductorResult` — still uses `new Set` + spread + filter + sort
- ✅ DEC-005: Ghost loop already uses `schedulePartialRedraw(ghostIndices)` (TileCanvas.svelte:~250)

**The freeze is happening DESPITE these fixes.** Root causes must be elsewhere.

## Decisions

| # | Decision | Status | Rationale | Dependencies |
|---|----------|--------|-----------|--------------|
| D-01 | Identify root causes beyond existing PRD fixes | open | Original PRD fixes already implemented; freeze persists at 500 blocks / 500k | — |

## New Root Cause Candidates (from investigation)

### Store-level
1. `runConductor()` still runs 5+ O(n) passes per call (snapshot, heal, clear, buildView, recordTransitions)
2. `buildView()` called TWICE per pass when a group is created — full O(n) block allocation each time
3. `protectedFromIndex` $derived has O(n) walk + O(n) snapPair = O(n²) worst case
4. `groupWire` / `groupAt` rebuild full Maps on every groups change → cascades to `liveTokens`
5. `normalizeConductorResult` still allocates new Set + spread + filter + sort per pass

### Conductor-level (my-customize-conductor)
6. `viewKey = view.blocks.map(b => b.id).join("\0")` — unconditional O(n) string alloc BEFORE fast-path
7. `callById` Map + `blockById` Map in `replayPriorCommands` — O(n) each, on every non-fast-path call
8. Rollover: `createGroup` → `digestBody(blocks)` is O(n × block-text-size) string construction
9. `trimOpenToolPairs` receives full `view.blocks` — O(total blocks) not O(candidates)

### UI-level (ContextMap/TileCanvas)
10. `tiles` $derived maps ALL blocks on every change
11. `olderTiles`, `preGroupTiles`, `protectedTiles` each slice+filter `tiles`
12. `displayRows` → `segments` → `olderSegmentSpecs` cascade on every blocks change
13. Sliver mode: one DOM node per block (500 DOM elements)
14. `navOrder` $derived iterates all blocks
15. `rangeSet` $derived calls `findIndex` twice on all blocks

### Broker-specific
16. `attachActiveConductor` called twice on full sync (lines 266 + 278 in sessionSlots)
17. `pending` Map not drained on `hello` reconnect — old promises linger 120s
