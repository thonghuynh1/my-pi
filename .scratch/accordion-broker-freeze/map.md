---
Status: wayfinder:map
---

# Fix Browser Broker UI Freeze in Large Accordion Sessions

## Destination

Eliminate the browser UI freeze that occurs in Accordion browser broker mode during large sessions (~500 blocks, 500k context window) when MyCustomizeConductor performs rollovers. The user must be able to interact with the dashboard (click, scroll, navigate) without the main thread locking up, even as the conductor processes rollover groups and sync messages arrive at sustained rate.

## Notes

- **Domain:** First-Party Accordion, Accordion Browser Broker, Authoritative Accordion Folding Runtime, MyCustomizeConductor
- **Skills:** Consult `CONTEXT.md` glossary for domain terms. The `accordion-large-session-perf` scratch project (issues #01–#05) documented and fixed an earlier round of performance bugs — all fixes are confirmed implemented. This effort targets the **remaining** bottlenecks exposed at higher scale (500 blocks / 500k context vs the prior 982 blocks / 150k tokens scenario, but now with active rollovers).
- **Key architectural fact:** The conductor runs **in the browser** (app-side `AccordionStore.runConductor()` → `conductor.conduct()`). Heavy computation here blocks the main thread and freezes all UI interaction. The extension side is not directly relevant to the browser freeze — only the data it sends (sync messages) triggers browser-side work.
- **Prior art:** `.scratch/accordion-large-session-perf/` — issues #01–#04 closed (reactive cascades, double refold, ghost redraw, O(n) includes/map). Issue #05 (browser perf validation) is `ready-for-human`.

## Tickets

### Frontier (unblocked, actionable now)
- [Real browser still freezes despite all conductor fixes](issues/09-real-browser-freeze-persists.md) — `research` — Root cause: `attachActiveConductor(slot.store)` called on **every sync message** in `sessionSlots.svelte.ts` causes conductor singleton thrashing between broker slots (detach→reattach→refold on every sync). Combined with O(n×6) `refold()` sweeps at 500 blocks, this locks the main thread. Perf harness only tested store-level (no Svelte, no multi-slot). Fix: remove the `attachActiveConductor` call from the sync handler.
- [Rendering cascade during streaming causes real browser freeze](issues/10-rendering-cascade-during-streaming.md) — `research` — THREE compounding causes: (1) `snapPair()` adds O(n²) to `protectedFromIndex` $derived on every sync, (2) conductor pre-guard fails on every streaming sync (blockCount check), forcing full O(n) recomputation, (3) `preGroupMemberIds` shifts ±1 on every sync → cascading re-derivation of all tile lists in ContextMap. Main avoids this because its HOLD_BAND epoch gating returns cached plan/memberIds during streaming.
- [Profiling: Identify the dominant freeze contributor](issues/01-profiling-dominant-freeze-contributor.md) — `research` — Which O(n) operations dominate the main-thread blocking?
- ~~[Should the conductor's pre-fast-path O(n) work be restructured?](issues/02-conductor-pre-guard-restructure-decision.md)~~ — `grilling` — **closed** → Option D (O(1) pre-guard + move work below guard)
- ~~[Should `buildView()` and `snapshotFoldState()` be cached or made incremental?](issues/04-store-buildview-caching-decision.md)~~ — `grilling` — **closed** → Option C (reuse `availableCap` from first view)
- ~~[Implement buildView() caching](issues/07-implement-buildview-caching.md)~~ — `task` — **resolved** → eliminated second `buildView()` call
- ~~[Implement planFoldsToCap in early over-cap rollover path](issues/08-implement-early-overcap-planfoldstocap.md)~~ — `task` — **resolved** → `planFoldsToCap` added to early over-cap path
- [Validate fixes with browser perf harness at 500 blocks / 500k context](issues/06-browser-perf-validation-with-rollovers.md) — `task` — **resolved** → all thresholds pass (max 1.43ms per sync, 35× below 50ms ceiling)

### Resolved
- ~~[Implement conductor fast-path restructure](issues/03-conductor-fast-path-restructure.md)~~ — `task` — **resolved** → O(1) pre-guard + O(n) work below guard implemented
- ~~[Should rollover-triggered conductor re-runs be deferred or batched?](issues/05-conductor-rerun-deferral-decision.md)~~ — `grilling` — **closed** → Option B (make early over-cap rollover path self-sufficient)
- ~~[Implement planFoldsToCap in early over-cap rollover path](issues/08-implement-early-overcap-planfoldstocap.md)~~ — `task` — **resolved**
- ~~[Validate fixes with browser perf harness at 500 blocks / 500k context](issues/06-browser-perf-validation-with-rollovers.md)~~ — `task` — **resolved** → all thresholds pass

## Decisions so far

- [Profiling: Identify the dominant freeze contributor](issues/01-profiling-dominant-freeze-contributor.md) — Not a single operation; ~32 O(n) passes per rollover sync (≈16,000 block-ops at 500 blocks). Top 3: `trimOpenToolPairs()` scanning all blocks, second `buildView()` for scalar-only `availableCap()`, viewKey O(n) string before fast-path.
- [Should the conductor's pre-fast-path O(n) work be restructured?](issues/02-conductor-pre-guard-restructure-decision.md) — **Option D**: O(1) pre-guard (5 scalar checks → return cached `lastResult`) + move all O(n) work below the guard. Safe because block IDs are append-only; PCC never fires.
- [Should `buildView()` and `snapshotFoldState()` be cached or made incremental?](issues/04-store-buildview-caching-decision.md) — **Option C**: Eliminate the second `buildView()` at line 1066; reuse `availableCap()` from the first view (5 budget scalars are stable within `runConductor()`). Options A/B subsumed by #02/#03 fast-path guard and low profiling priority respectively; Option D ruled out by #01 profiling.
- [Should rollover-triggered conductor re-runs be deferred or batched?](issues/05-conductor-rerun-deferral-decision.md) — **Option B**: Make the early over-cap rollover path self-sufficient by adding `planFoldsToCap` (mirroring the normal rollover path). One pass emits both group + folds; `requestConductorRerun` becomes inert. Root finding: the re-run was valid (prevents conductor stall) but broken (`createGroup` doesn't call `markDirty`, so pass 2 returns cached plan).
- [Implement conductor fast-path restructure](issues/03-conductor-fast-path-restructure.md) — O(1) pre-guard added to `conduct()` (5 scalar checks → return `lastResult`); all O(n) work (`viewKey`, `computePreGroupFromIndex`, `preGroupBlocks`, `replayPriorCommands`, `noOpenToolPairAcrossPreGroupTail`) moved below the guard. 81 tests pass.
- [Implement buildView() caching](issues/07-implement-buildview-caching.md) — Eliminated the second `buildView()` call in `runConductor()` by caching `availableCap(view)` from the first call. All tests pass.
- [Validate fixes with browser perf harness at 500 blocks / 500k context](issues/06-browser-perf-validation-with-rollovers.md) — All 3 thresholds pass. Store-level: max 1.43ms per sync (50ms threshold = 35× headroom). Browser scenario `rollover-at-500k` added to harness. No remaining bottlenecks at 500 blocks / 500k context.
- [Implement planFoldsToCap in early over-cap rollover path](issues/08-implement-early-overcap-planfoldstocap.md) — Added `planFoldsToCap` call to the early over-cap rollover path, mirroring the normal path. One `conduct()` pass now emits group + folds; `requestConductorRerun` is effectively inert. 95 tests pass.

## Not yet specified
- Whether the existing browser perf harness (issue #05 from prior effort) should be extended with a rollover-specific scenario or if a new harness is needed
- Whether the `before_provider_request` hook's synchronous `JSON.stringify` of all messages for cache-tracker contributes measurably to the freeze (this runs extension-side, so likely not the browser freeze, but worth ruling out)
- **What is blocking the real browser main thread** — IDENTIFIED: three compounding factors (see issue #10): (1) O(n²) `snapPair` in `protectedFromIndex` $derived, (2) conductor pre-guard always fails during streaming (blockCount changes), (3) cascading Svelte re-renders from unstable `preGroupMemberIds`. Combined cost: ~15-30ms per sync, saturating the main thread at streaming rates.

## Out of scope

- Extension-side (Node.js) performance of the `context` hook, `writeContextDiagnostic`, or `linearize()` — these affect model-call latency but not browser UI responsiveness
- Broker HTTP polling overhead (2s interval, disk reads) — this is I/O-bound and unlikely to freeze the UI thread
- The unbounded `earlyMessages[]` buffer in the broker proxy — low risk on loopback, not related to UI freeze
