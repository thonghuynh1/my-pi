---
Type: research
Status: open
---

# Real browser still freezes despite all conductor fixes

## Problem

After implementing all conductor optimizations (issues #02–#08) and passing the perf harness validation (issue #06, max 1.43ms per sync), the **real Accordion browser tab still freezes completely**.

Symptoms observed:
- Cannot click anything in the Accordion tab
- Cannot scroll or interact with any UI element
- Orca runtime connection drops when attempting to snapshot or eval the frozen page (`runtime closed the connection before responding`)
- The freeze is total — not a slow response, but a complete main-thread lockup

## What this means

The perf harness tested **store-level** `conduct()` timing in a synthetic harness. It proved the conductor fast-path and buildView caching work correctly at the unit level. But something **outside** the conductor's hot path is still blocking the main thread in the real browser:

Possible candidates:
1. **React/UI rendering cascade** — the store emits correct results quickly, but the React component tree re-renders expensively (e.g., reconciling 500+ block elements, layout thrashing)
2. **Broker sync message volume** — rapid sync messages from the extension may queue up faster than the browser can process them, each triggering a React render
3. **DOM size / paint cost** — 500 blocks rendered simultaneously may exceed what the browser can paint without jank, even if JS is fast
4. **Other store subscribers** — watchers, effects, or derived computations outside `conduct()` that run on every state change
5. **The `before_provider_request` hook's synchronous `JSON.stringify`** — noted in map.md as worth ruling out (runs extension-side, but if the broker relays it synchronously...)
6. **Broker HTTP polling or message deserialization** — parsing large JSON payloads on the main thread

## Key observation

Orca's own runtime crashes when trying to interact with the page. This suggests the freeze is not just "slow" — the page's main thread is blocked for so long that the WebSocket/IPC connection times out entirely. This points to either:
- An infinite loop or near-infinite synchronous computation
- A tight rapid-fire re-render loop (sync → state change → render → sync → ...)

## Root Cause Found

### 🔴 PRIMARY: Conductor singleton thrashing in broker mode

**File:** `app/src/lib/live/sessionSlots.svelte.ts` — `sync` handler

`attachActiveConductor(slot.store)` is called on **every single sync message** (not just `hello`). With multiple broker slots, each sync from slot A sets `lastStore = slotA.store`; the next sync from slot B fails the `alreadyCorrect` check, detaches from A, creates a fresh conductor on B calling `store.attach()` → `refold()`. Then A's next sync detaches from B and re-attaches to A.

**Result**: With 2+ active slots, every ~8ms there is a full conductor detach/re-attach + `refold()`, each doing 5–6 full O(N) block sweeps. At 500 blocks this is catastrophic.

### 🔴 SECONDARY: `refold()` → `runConductor()` is O(n) × 6, called per sync

Each `refold()` does: `snapshotFoldState()` + `snapshotFoldedConductorGroups()` + `clearConductorState()` + `buildView()` + `conduct()` + `recordConductorTransitions()` — all iterating ALL blocks.

### 🟡 TERTIARY: `runFoldCheck` on every `version++`

`app/src/routes/+page.svelte` has a `$effect` watching `st.version` that runs `runFoldCheck()` → iterates ALL blocks twice (viewSet + wireSet comparison).

### 🟡 ADDITIONAL: `console.log` + `globalThis.__accordion` on every sync

Three console.log calls + global assignment on every sync with harness data. If DevTools is open, this triggers serialization of the entire reactive store.

## Why the perf harness passes

The harness validation (issue #06) was done with **vitest store-level tests only** — pure in-memory `AccordionStore` with no DOM, no Svelte, no WebSocket, no multi-slot broker. The browser harness (Playwright-based, `app/perf/browser/run.ts`) exists but was never actually run against the live app for issue #06.

## Fix Plan

1. **Remove `attachActiveConductor(slot.store)` from the `sync` handler** in `sessionSlots.svelte.ts`. It's already called in `hello`. The route-level `$effect` handles re-attachment reactively. This alone should eliminate the thrashing freeze.
2. **Gate console.log/globalThis harness diagnostics** behind `import.meta.env.DEV` or remove from sync handler.
3. **Debounce `version++` signal** or the `foldAlarm` `$effect` so `runFoldCheck` doesn't run on every streaming token.
4. **Run the real browser harness** (`app/perf/browser/run.ts`) to validate the fix end-to-end.
