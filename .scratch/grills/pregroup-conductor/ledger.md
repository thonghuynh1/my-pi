# Grill Ledger: Pre-Group Conductor Fixes

## DEC-001: Fix pre-group visibility — start rollover from preGroupFromIndex
- **Status:** accepted
- **Rationale:** `selectCompactionRange` treats held blocks at `frozenFromIndex` as a hard barrier, returning null and preventing rollover. Starting from `preGroupFromIndex` bypasses held blocks in the frozen prefix.
- **Evidence:** Failing test `"runs authoritative pre-group accumulation through rollover"` — after `store.fold("pg:1", "you")`, `groups.length` is 0. Root cause: `blocks[0].held === true` → `harderEnd = 0` → range collapses to zero.
- **Safe because:** Dynamic `preGroupTarget` ensures `preGroupFromIndex ≈ frozenFromIndex` on first attach (mid-session 100k+). On subsequent passes, the gap contains only frozen/grouped blocks.
- **Decided:** Change `planRollover(view, view.frozenFromIndex, ...)` → `planRollover(view, preGroupFromIndex, ...)`
- **Left to implementer:** Whether to add a defensive clamp `Math.max(preGroupFromIndex, frozenFromIndex)`.

## DEC-002: Stable plan with dirty triggers — stop cache thrashing
- **Status:** accepted
- **Rationale:** Current wipe-and-reapply on every `conduct()` call recalculates boundaries, producing slightly different commands when tokens shift, causing cache invalidation.
- **Evidence:** User observes UI ungrouping then regrouping on each new turn. `clearConductorState()` wipes `subst`/folds every pass; conductor recalculates fresh; boundaries shift with new tokens.
- **Decided:**
  - `conduct()` short-circuits when nothing material changed → returns prior plan + updated preGroup membership.
  - Dirty triggers that force full re-plan: first attach, hard-cap breach, budget decrease, block held/unheld.
  - New blocks only → extend preGroup membership; if threshold crossed, append new rollover groups (never re-slice old groups).
- **Dependencies:** DEC-003 (dirty detection mechanism).
- **Left to implementer:** Internal memoization structure, exact equality check for "nothing changed."

## DEC-003: O(1) dirty detection via markDirty()
- **Status:** accepted
- **Rationale:** O(n) scanning for held-state changes is too expensive at 2,000–5,000 blocks per pass. The store already knows exactly when held state changes (explicit user actions).
- **Evidence:** `fold()`, `pin()`, `unpin()`, `unfold()` are the only store methods that change held state.
- **Decided:**
  - Add `markDirty(): void` to the conductor interface.
  - Store calls `this.conductor?.markDirty()` from fold/pin/unpin/unfold.
  - Conductor tracks `this.dirty: boolean` (starts `true` on attach).
  - Full dirty check: `dirty || !lastPlan || hardCap || cap < lastCap || blockCount !== lastBlockCount` — all O(1).
- **Left to implementer:** Whether `markDirty()` is on `Conductor` interface or passed via `attach(host)` callback, exact placement in store.
