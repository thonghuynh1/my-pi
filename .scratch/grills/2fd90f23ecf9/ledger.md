# Grill Ledger — Conductor Pre-Guard Restructure Decision

**Ticket:** `.scratch/accordion-broker-freeze/issues/02-conductor-pre-guard-restructure-decision.md`
**Map:** `.scratch/accordion-broker-freeze/map.md`

## Decisions

### D1: Restructuring approach for pre-fast-path O(n) work
- **Status:** accepted
- **Answer:** Option D (A+C). Add an O(1) pre-guard before viewKey computation; move all other O(n) work (computePreGroupFromIndex, replayPriorCommands, noOpenToolPairAcrossPreGroupTail, preGroupBlocks chains) below the guard.
- **Rationale:** Append-only block invariant proves viewKey is redundant when blockCount unchanged and !dirty. Remaining O(n) work is only consumed by rollover decision paths.
- **Dependencies:** D2 (block ID stability)

### D3: Caching finishConduct arguments for the O(1) pre-guard return
- **Status:** accepted
- **Answer:** Cache `lastResult` as a whole — already implemented. `finishConduct()` (line 148) already maintains `this.lastResult`, `this.lastResultCommands`, `this.lastResultMemberKey`. The O(1) pre-guard can return `this.lastResult` directly without recomputing preGroupTokens/memberIds.
- **Evidence:** `finishConduct()` lines 148–191, existing `lastResult` caching pattern.

### D2: Edge case — can block IDs change without block count changing?
- **Status:** accepted
- **Answer:** No. Block IDs are content-anchored and stable. The block array is append-only in production. GroupOps affect the pi-side message array, not the store's block array. Positional fallback IDs are guarded against folding.
- **Evidence:** `mapping.ts` lines 55–76 (`blockId()`), `store.svelte.ts` lines 1401–1453 (`appendBlocks` is push-only), no `replaceBlock`/`splice` in production code.

### D4: Dirty flag completeness for O(1) pre-guard
- **Status:** accepted
- **Answer:** The pre-guard checks (`!dirty`, `blockCount`, `cap`, `liveTokens <= hardCap`) are complete. No additional `liveTokens` equality check needed.
- **Rationale:** Proactive compression (PCC) never fires in practice — confirmed by user. The only mutations affecting conductor output are: new blocks (count change), fold/pin/unfold (markDirty), cap/budget change (cap check), hard-cap emergency (liveTokens check). All are covered.
- **Dependencies:** D1

### D5: finishConduct bypass on pre-guard path
- **Status:** accepted
- **Answer:** The O(1) pre-guard returns `this.lastResult` directly, bypassing `finishConduct()` entirely. No need to recompute metrics or call `host.setStatus()` — nothing changed, so status text and metrics are identical.
- **Evidence:** `finishConduct()` lines 186–191 already cache `lastResult`/`lastResultCommands`/`lastResultMemberKey`.
- **Dependencies:** D1

## Notes

- Prior perf fixes (DEC-001–005) all implemented
- Conductor runs in browser main thread — heavy computation = UI freeze
- Proactive compression (PCC) never fires in practice — confirmed by user
