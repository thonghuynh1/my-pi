# Grill Ledger — Conductor Rerun Deferral Decision (#05)

## Ticket
`.scratch/accordion-broker-freeze/issues/05-conductor-rerun-deferral-decision.md`

## Map
`.scratch/accordion-broker-freeze/map.md` — Fix Browser Broker UI Freeze in Large Accordion Sessions

## Grounding

### requestConductorRerun mechanism
- **Defined**: `extensions/accordion/app/src/lib/engine/store.svelte.ts:675`
- **Triggered at**: `store.svelte.ts:1067` — after `applyCommands` creates a new group while still over soft budget
- **Mechanism**: `queueMicrotask(() => this.refold())` — defers second pass outside current call stack
- **Condition**: `createdGroup && this.liveTokens > availableCap(...) && this.conductor`

### Fast-path pre-guard (from #02 decision)
- **Location**: `my-customize-conductor.ts:449`
- **5 scalar checks**: `!dirty`, `lastResult` exists, `blockCount === lastBlockCount`, `cap <= lastCap`, `liveTokens <= hardCap`
- **Critical fact**: `createGroup()` (store.svelte.ts:1831–1862) does NOT call `this.conductor?.markDirty?.()`. Compare `fold()`, `unfold()`, `pin()`, `unpin()` which all call `markDirty()`.
- **Result**: Second conduct() call hits O(1) fast path, returns cached lastResult. The re-run is a no-op.

### The intent gap
- The re-run was designed so the conductor could "plan folds against the committed group"
- But the fast path defeats this: dirty=false, blockCount unchanged, cap unchanged → cached result returned
- The conductor never sees the group it just created as a state change requiring re-planning

## Decisions

| # | Decision | Status | Rationale |
|---|----------|--------|-----------|
| 1 | Is the fast-path bypass a bug or intended? Should createGroup markDirty? | accepted | It's a bug — createGroup doesn't markDirty, so the re-run (which exists to prevent conductor stall in the event-driven system) is defeated by the pre-guard. But the fix is not to add markDirty — it's to eliminate the need for the re-run entirely (decision #2). |
| 2 | Fix the re-run vs make it unnecessary | accepted | **Option B**: Add `planFoldsToCap` to the early over-cap rollover path, mirroring the normal rollover path. One pass emits both group + folds. The re-run becomes inert (fast-path hit, harmless). Avoids O(n) cost of a second conduct() pass. |
