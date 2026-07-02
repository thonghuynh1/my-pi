---
id: "003"
title: "Consume the installed pi usage hook in Accordion end-to-end"
labels: [ready-for-agent]
depends_on: []
status: open
---

## What to build

Finish cache-aware folding by consuming the installed public `pi` hook contract inside Accordion. This slice proves the full path from provider `usage` data to `frozenFromIndex` behavior in the live conductor contract.

This slice adapts the existing `cache-tracker.ts` runtime listener, installs the tracker in `accordion.ts`, carries `frozenFromIndex` through the harness frame, and ingests it in the GUI store.

The installed `pi` package in this workspace already exposes `usage?: unknown` and emits `usage: response.usage` on `after_provider_response`. Do not add a package blocker and do not edit `node_modules` as part of this slice.

**PRD decisions implemented**: DEC-001, DEC-002, DEC-003, DEC-004, DEC-005, DEC-006, DEC-007, DEC-008, DEC-009, DEC-010, DEC-011

**User stories covered**: 1, 2, 5, 6, 7, 8, 10, 11

## Implementation map

### Area: installed `pi` package — verification anchors only

- **Decision IDs**: DEC-004, DEC-011
- **Current code anchors**:
  - `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts` — `AfterProviderResponseEvent`
  - `node_modules/@earendil-works/pi-coding-agent/dist/core/sdk.js` — `onResponse`
- **Existing behavior**: The installed package type already exposes `usage?: unknown`, and the installed runtime already emits `usage: response.usage` on `after_provider_response`.
- **Required edits**: No package code change is required for this feature in this workspace. Treat these files as compatibility anchors that this slice must verify before and after wiring.
- **Snippet(s)**:
  - `current code anchor`.
    ```ts
    export interface AfterProviderResponseEvent {
        type: "after_provider_response";
        status: number;
        headers: Record<string, string>;
        /** Provider usage data, if present on the response at emit time. Shape varies by provider. */
        usage?: unknown;
    }
    ```
    Normative for the released contract this workspace already has.
  - `current code anchor`.
    ```js
    await runner.emit({
        type: "after_provider_response",
        status: response.status,
        headers: response.headers,
        usage: response.usage,
    });
    ```
    Normative for the released runtime seam this workspace already has.
- **Tests to extend**: None in this repo. Verification is by grep or read against the installed package artifacts.
- **Wiring/build notes**: Do not edit `node_modules` as part of the real feature slice. These files are proof points, not ownership targets.

### Area: `cache-tracker.ts` — Accordion provider normalization

- **Decision IDs**: DEC-002, DEC-003, DEC-004, DEC-005, DEC-006, DEC-007, DEC-010, DEC-011
- **Current code anchors**:
  - `vendor/accordion/extension/cache-tracker.ts`
  - `vendor/accordion/extension/cache-tracker.test.ts`
  - `vendor/accordion/extension/payload-audit.ts`
- **Existing behavior**: The pure normalization and frozen-boundary math exist and are tested. The runtime listener was written against the stale shape and must consume `event.usage` from the real installed `pi` hook.
- **Required edits**:
  1. Read `event.usage` in the install listener.
  2. Keep provider normalization in Accordion. `extractCacheMetrics(provider, usage)` remains the boundary that maps Anthropic, Bedrock, OpenAI, Google, and fallback providers.
  3. Keep the current response-driven overwrite behavior and safety-margin boundary math.
  4. Update tests so the fake hook event uses `usage` directly.
- **Snippet(s)**:
  - `current code anchor`.
    ```ts
    api.on?.("after_provider_response", (event) => {
      try {
        const provider = getProvider() ?? "";
        const metrics = extractCacheMetrics(provider, pickUsage(provider, event?.usage));
        latestMetrics = metrics;
        latestFrozenFromIndex = computeFrozenFromIndex(
          getBlocks(),
          metrics.cacheReadTokens,
          getHarness(),
          getCalibration(),
        );
      } catch {
    ```
    Normative for the local adaptation seam.
- **Tests to extend**:
  - `vendor/accordion/extension/cache-tracker.test.ts`
  - Run: `npx vitest run vendor/accordion/extension/cache-tracker.test.ts`
  - Expected: `Tests 13 passed` or higher.
- **Wiring/build notes**: `cache-tracker.ts` stays the only place that knows provider-specific usage shapes. `pi` stays provider-agnostic beyond surfacing `usage`.

### Area: `accordion.ts` — live wiring into the harness frame

- **Decision IDs**: DEC-002, DEC-008, DEC-011
- **Current code anchors**:
  - `vendor/accordion/extension/accordion.ts` — `harnessFrame()`
  - `vendor/accordion/extension/accordion.ts` — `session_shutdown`
  - `vendor/accordion/extension/accordion.ts` — `payloadAudit.install(pi)`
- **Existing behavior**: `harnessFrame()` reports token diagnostics only. `cache-tracker.ts` is not installed, and no frozen boundary is shipped to the GUI.
- **Required edits**:
  1. Import `cache-tracker.ts` and install it after `payloadAudit.install(pi)`.
  2. Include `frozenFromIndex` in `harnessFrame()`.
  3. Reset `cacheTracker` on `session_shutdown`.
- **Tests to extend**: No direct unit test exists for `harnessFrame()`. Verification happens through the store ingest and existing clamp behavior.
- **Wiring/build notes**: Install `cacheTracker` after `payloadAudit.install(pi)` so harness subtraction can read the latest payload sizes.

### Area: `protocol.ts` and `store.svelte.ts` — GUI ingest of the frozen boundary

- **Decision IDs**: DEC-001, DEC-008, DEC-009
- **Current code anchors**:
  - `vendor/accordion/app/src/lib/live/protocol.ts` — `SyncMessage.harness`
  - `vendor/accordion/app/src/lib/engine/store.svelte.ts` — `setHarnessBreakdown()`
  - `vendor/accordion/app/src/lib/engine/store.svelte.ts` — `buildView()`
  - `vendor/accordion/app/src/lib/engine/store.svelte.ts` — frozen clamp in `substOne()`
- **Existing behavior**: The store already has `frozenFromIndex` state, passes it into `buildView()`, and clamps frozen blocks. The missing piece is ingest. `setHarnessBreakdown()` still ignores `harness.frozenFromIndex`, and the wire protocol type still lacks the field.
- **Required edits**:
  1. Add `frozenFromIndex?: number | null` to `SyncMessage.harness`.
  2. In `setHarnessBreakdown()`, store `h.frozenFromIndex ?? 0` into the reactive state before recalculating derived values.
  3. Leave the existing host clamp and conductor contract untouched.
- **Tests to extend**:
  - `vendor/accordion/app/src/lib/engine/conductor.test.ts`
  - `vendor/accordion/app/src/lib/engine/store.foldgate.test.ts`
  - Run: `npx vitest run vendor/accordion/app/src/lib/engine/conductor.test.ts vendor/accordion/app/src/lib/engine/store.foldgate.test.ts`
  - Expected: both suites pass.
- **Wiring/build notes**: This is the consumer side of the local adaptation. The proof must show `frozenFromIndex` reaches behavior, not just types.

### Global Build & Wiring Notes

- `vendor/accordion` is the implementation target in this workspace.
- The installed `pi` package is a compatibility anchor, not an edit target for the real feature work.
- Run frontend tests with `npx vitest run <path>`.
- Contract and host-enforcement work from local issues `001` and `002` are already present in `vendor/accordion`. This slice must not re-open those decisions.

## Acceptance criteria

- [ ] The consuming repo proves it is using the installed public hook contract. Run: `grep -n 'usage\?: unknown' node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts && grep -n 'usage:' node_modules/@earendil-works/pi-coding-agent/dist/core/sdk.js`. Expected: both commands find the released package contract and emit path.
- [ ] `cache-tracker.ts` reads `event.usage` from `after_provider_response`. Run: `grep -n 'event\.usage\|event\.response' vendor/accordion/extension/cache-tracker.ts`. Expected: at least one `event.usage` match in the listener and no listener path that depends on `event.response` for hook consumption.
- [ ] The cache-tracker lifecycle tests emit `usage` directly on the fake hook event and still pass. Run: `npx vitest run vendor/accordion/extension/cache-tracker.test.ts`. Expected: `Tests 13 passed` or higher.
- [ ] `accordion.ts` installs `cacheTracker`, includes `frozenFromIndex` in `harnessFrame()`, and resets the tracker on shutdown. Run: `grep -n 'cacheTracker\|frozenFromIndex' vendor/accordion/extension/accordion.ts`. Expected: matches for the import, install call, `harnessFrame()` return field, and reset call.
- [ ] `SyncMessage.harness` includes `frozenFromIndex?: number | null`, and `setHarnessBreakdown()` ingests `h.frozenFromIndex ?? 0`. Run: `grep -n 'frozenFromIndex' vendor/accordion/app/src/lib/live/protocol.ts vendor/accordion/app/src/lib/engine/store.svelte.ts`. Expected: harness-type match in `protocol.ts`, plus state, ingest, and `buildView()` matches in `store.svelte.ts`.
- [ ] Existing clamp behavior stays green after the ingest path is wired. Run: `npx vitest run vendor/accordion/app/src/lib/engine/conductor.test.ts vendor/accordion/app/src/lib/engine/store.foldgate.test.ts`. Expected: both suites pass.

## Blocked by

None - can start immediately.
