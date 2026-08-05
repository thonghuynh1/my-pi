# Grounding — Conductor Rerun Deferral (#05)

## requestConductorRerun
- **Path**: `extensions/accordion/app/src/lib/engine/store.svelte.ts`
- **Symbol**: `requestConductorRerun` (line 675)
- **Behavior**: Defers `this.refold()` via `queueMicrotask`. Called at line 1067 after `applyCommands` when a new group was created and liveTokens still exceeds availableCap.

## createGroup — missing markDirty
- **Path**: `extensions/accordion/app/src/lib/engine/store.svelte.ts`
- **Symbol**: `createGroup` (lines 1831–1862)
- **Behavior**: Creates group, pushes to `this.groups`, calls `this.refold()` (no-op during conducting). Does NOT call `this.conductor?.markDirty?.()`.
- **Contrast**: `fold()` (1641), `unfold()` (1661), `pin()` (1684), `unpin()` (1697) all call `markDirty()`.

## O(1) pre-guard
- **Path**: `extensions/accordion/conductors/my-customize-conductor/my-customize-conductor.ts`
- **Symbol**: conduct() pre-guard (line 449)
- **Checks**: `!dirty && lastResult && blockCount===lastBlockCount && cap<=lastCap && liveTokens<=hardCap`

## Rollover trigger
- From ADR-0005: rollover fires when preGroupTokens ≥ 15,000 at turn boundary with min-savings gate.
- Group is committed synchronously during `applyCommands` in `runConductor()`.
- The `conducting=true` latch prevents re-entrant `refold()` from `createGroup`.

## Key question from profiling (#01)
- ~32 O(n) passes per rollover sync at 500 blocks = ~16,000 block-ops
- Second buildView() was eliminated by #04 decision
- Pre-guard restructure from #02 converts fast-path to O(1)
