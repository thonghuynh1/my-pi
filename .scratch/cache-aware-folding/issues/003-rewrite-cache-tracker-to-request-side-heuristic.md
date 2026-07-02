---
id: "003"
title: "Rewrite cache-tracker to request-side heuristic"
labels: [ready-for-agent]
depends_on: []
status: closed
---

## What to build

Replace the dead response-driven cache tracker with a request-side heuristic that compares consecutive outgoing payloads to compute `frozenFromIndex`. Install the tracker in `accordion.ts` so it receives `before_provider_request` events and publishes its result through `getFrozenFromIndex()`.

After this slice, `cacheTracker.getFrozenFromIndex()` returns a real heuristic boundary instead of always zero.

**PRD decisions implemented**: DEC-002, DEC-003, DEC-004, DEC-005, DEC-006, DEC-007, DEC-008, DEC-009, DEC-010, DEC-011

**User stories covered**: 1, 2, 5, 6, 9, 10

## Implementation map

### Area: `cache-tracker.ts` — rewrite to request-side heuristic

- **Decision IDs**: DEC-002, DEC-003, DEC-004, DEC-005, DEC-006, DEC-007, DEC-008, DEC-009, DEC-010, DEC-011
- **Current code anchors**:
  - `vendor/accordion/extension/cache-tracker.ts` — `install()`, `extractCacheMetrics()`, `computeFrozenFromIndex()`, `pickUsage()`, `getFrozenFromIndex()`, `reset()`
  - `vendor/accordion/extension/cache-tracker.test.ts` — 13 existing tests covering old response-driven logic
- **Existing behavior**: The module registers on `after_provider_response`, reads `event.usage`, extracts per-provider cache metrics, walks blocks by token count, and computes `frozenFromIndex`. All of this is dead for the new design.
- **Required edits**:
  1. Delete `extractCacheMetrics`, `computeFrozenFromIndex`, `pickUsage`, all provider-specific extractors, `ProviderCacheMetrics` interface, and `getLatestMetrics()` export. (DEC-009)
  2. Delete the `after_provider_response` listener. (DEC-008)
  3. Add `PrefixSnapshot` interface. (DEC-003, DEC-005, DEC-007)
  4. Add `before_provider_request` listener that builds a current snapshot from the payload, compares against the previous snapshot, and computes `frozenFromIndex`. (DEC-002, DEC-003, DEC-004, DEC-005, DEC-006, DEC-011)
  5. Keep `getFrozenFromIndex()` and `reset()` exports unchanged. (DEC-008)
  6. Update `install()` signature to take only `pi` and `getProvider`. (DEC-008, DEC-010)
- **Snippet(s)**:
  - `decision artifact` (normative).
    ```ts
    interface PrefixSnapshot {
      messageStrings: string[];  // full JSON.stringify of each conversation message
      systemHash: string;        // JSON.stringify of system payload
      toolsHash: string;         // JSON.stringify of tools payload
      provider: string;          // provider identifier at snapshot time
    }
    ```
  - `decision artifact` (normative).
    ```ts
    // In before_provider_request handler:
    // 1. Build current PrefixSnapshot from event.payload
    //    - systemHash = JSON.stringify(payload.system ?? payload.messages?.[0] for openai)
    //    - toolsHash = JSON.stringify(payload.tools ?? payload.toolConfig)
    //    - messageStrings = payload.messages (or payload.input) sliced past system,
    //      each entry JSON.stringify'd individually
    //    - provider = getProvider()
    // 2. If previous is null → frozenFromIndex = 0 (cold start)
    // 3. If systemHash, toolsHash, or provider changed → frozenFromIndex = 0
    // 4. Otherwise walk messageStrings positionally:
    //    matchedPrefix = count of leading identical strings
    //    frozenFromIndex = max(0, matchedPrefix - 1)   // safety margin
    // 5. Store current snapshot as previous
    ```
  - `current code anchor` (seam to replace).
    ```ts
    export function install(
      pi: ExtensionAPI,
      getProvider: () => string | undefined,
      getBlocks: () => CacheBlock[],
      getHarness: () => number,
      getCalibration: () => number,
    ): void {
      if (installed) return;
      installed = true;

      const api = pi as unknown as {
        on?: (event: string, handler: (event: { usage?: unknown }) => unknown) => void;
      };

      api.on?.("after_provider_response", (event) => {
    ```
- **Tests to extend**:
  - `vendor/accordion/extension/cache-tracker.test.ts` — rewrite entirely.
  - Run: `npx vitest run vendor/accordion/extension/cache-tracker.test.ts`
  - Expected: all new tests pass. Test cases:
    1. Cold start → 0
    2. Identical messages second turn → `length - 1`
    3. Mismatch at index 5 → 4
    4. System prompt change → 0
    5. Tools change → 0
    6. Provider change → 0
    7. Empty messages → 0
- **Wiring/build notes**: Register on `before_provider_request` using the same `(pi as unknown as { on }).on(...)` casting pattern as `payload-audit.ts`. Event shape is `{ payload?: unknown }`.

### Area: `accordion.ts` — install the heuristic tracker

- **Decision IDs**: DEC-002, DEC-008
- **Current code anchors**:
  - `vendor/accordion/extension/accordion.ts` — `payloadAudit.install(pi)` (line ~1270)
  - `vendor/accordion/extension/accordion.ts` — `session_shutdown` (line ~1199)
- **Existing behavior**: `payloadAudit.install(pi)` is called. No cache-tracker install exists. No `cacheTracker.reset()` in shutdown.
- **Required edits**:
  1. Import `cache-tracker` module. (DEC-008)
  2. Call `cacheTracker.install(pi, () => latestModel?.provider)` alongside `payloadAudit.install(pi)`. (DEC-002, DEC-008)
  3. Call `cacheTracker.reset()` in `session_shutdown`. (DEC-002)
- **Snippet(s)**:
  - `current code anchor`.
    ```ts
    // line ~1270 in accordion.ts
    payloadAudit.install(pi);
    ```
    This is the seam. Add `cacheTracker.install(pi, () => latestModel?.provider)` after it.
  - `current code anchor`.
    ```ts
    pi.on("session_shutdown", () => {
      if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
      // ... existing cleanup ...
    });
    ```
    Add `cacheTracker.reset()` inside this handler.
- **Tests to extend**: No direct unit test for install wiring. Verified transitively by cache-tracker tests plus the downstream slice.
- **Wiring/build notes**: Install `cacheTracker` after `payloadAudit.install(pi)`.

## Acceptance criteria

- [ ] `cache-tracker.ts` no longer imports or exports `extractCacheMetrics`, `computeFrozenFromIndex`, `pickUsage`, `ProviderCacheMetrics`, or `getLatestMetrics`. Run: `grep -n 'extractCacheMetrics\|computeFrozenFromIndex\|pickUsage\|ProviderCacheMetrics\|getLatestMetrics' vendor/accordion/extension/cache-tracker.ts`. Expected: no matches.
- [ ] `cache-tracker.ts` registers on `before_provider_request` instead of `after_provider_response`. Run: `grep -n 'before_provider_request\|after_provider_response' vendor/accordion/extension/cache-tracker.ts`. Expected: one `before_provider_request` match, no `after_provider_response` match.
- [ ] Cold start returns `frozenFromIndex = 0`. Run: `npx vitest run vendor/accordion/extension/cache-tracker.test.ts --reporter=verbose`. Expected: test named `cold start` passes with assertion `getFrozenFromIndex() === 0`.
- [ ] Second turn with 10 identical messages returns `frozenFromIndex = 9`. Run: `npx vitest run vendor/accordion/extension/cache-tracker.test.ts --reporter=verbose`. Expected: test named `identical messages` passes with assertion `getFrozenFromIndex() === 9`.
- [ ] Second turn with mismatch at index 5 returns `frozenFromIndex = 4`. Run: `npx vitest run vendor/accordion/extension/cache-tracker.test.ts --reporter=verbose`. Expected: test named `mismatch at index 5` passes with assertion `getFrozenFromIndex() === 4`.
- [ ] System prompt change resets to 0. Run: `npx vitest run vendor/accordion/extension/cache-tracker.test.ts --reporter=verbose`. Expected: test named `system prompt change` passes with assertion `getFrozenFromIndex() === 0`.
- [ ] Tools change resets to 0. Run: `npx vitest run vendor/accordion/extension/cache-tracker.test.ts --reporter=verbose`. Expected: test named `tools change` passes with assertion `getFrozenFromIndex() === 0`.
- [ ] Provider change resets to 0. Run: `npx vitest run vendor/accordion/extension/cache-tracker.test.ts --reporter=verbose`. Expected: test named `provider change` passes with assertion `getFrozenFromIndex() === 0`.
- [ ] Empty messages returns 0. Run: `npx vitest run vendor/accordion/extension/cache-tracker.test.ts --reporter=verbose`. Expected: test named `empty messages` passes with assertion `getFrozenFromIndex() === 0`.
- [ ] `accordion.ts` installs `cacheTracker` and resets it on shutdown. Run: `grep -n 'cacheTracker' vendor/accordion/extension/accordion.ts`. Expected: matches for import, install call, and reset call.

## Blocked by

None - can start immediately.
