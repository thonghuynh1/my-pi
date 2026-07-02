---
id: "002"
title: "Cache Tracker Module — Provider Normalization + Frozen Index Computation"
labels: [ready-for-agent]
depends_on: []
status: closed
---

## What to build

Create `extension/cache-tracker.ts` — a new extension module that normalizes provider cache metrics and computes `frozenFromIndex` from cached token counts. This module is the data-source layer: it parses raw provider responses (Anthropic, Bedrock, OpenAI, Google, Copilot) into a common `ProviderCacheMetrics` shape, then walks blocks to compute the frozen boundary with harness subtraction and a 1-block safety margin.

Pure functions, fully testable in isolation. No wiring into accordion.ts yet (that's Slice 3).

**PRD decisions implemented**: DEC-002, DEC-003, DEC-005, DEC-006, DEC-007, DEC-010

**User stories covered**: 1, 5, 6, 7

## Implementation map

### Area: `cache-tracker.ts` — new extension module

- **Decision IDs**: DEC-002, DEC-003, DEC-005, DEC-006, DEC-007, DEC-010
- **Current code anchors**: `extension/payload-audit.ts` — pattern to follow for module structure (module-level state, `install()`, `getLatest*()` getter). `extension/accordion.ts` line ~207 `latestModel` (typed `any`) — source for provider detection via `latestModel.provider`.
- **Existing behavior**: No cache tracking exists. `payload-audit.ts` tracks wire payload sizes only.
- **Required edits**: Create `extension/cache-tracker.ts` with:

  1. `ProviderCacheMetrics` interface (decision artifact, normative):
     ```ts
     interface ProviderCacheMetrics {
       cacheReadTokens: number;
       cacheWriteTokens: number;  // 0 if provider doesn't report
       inputTokens: number;
     }
     ```

  2. `extractCacheMetrics(provider: string, usage: unknown): ProviderCacheMetrics` — per-provider field mapping (DEC-005, DEC-007):
     - `"anthropic"`: `usage.cache_read_input_tokens`, `usage.cache_creation_input_tokens`
     - `"amazon-bedrock"`: `usage.cacheReadInputTokenCount`, `usage.cacheWriteInputTokenCount`
     - `"openai"`: `usage.prompt_tokens_details.cached_tokens`, write = 0
     - `"google"`: `usageMetadata.cachedContentTokenCount`, write = 0
     - `"github-copilot"` / unknown: all zeros (DEC-007)
     - On parse failure (missing fields, wrong types): all zeros (graceful fallback)

  3. `computeFrozenFromIndex(blocks, cachedTokens, harnessEstimate, calibration): number` (decision artifact, normative):
     ```ts
     function computeFrozenFromIndex(
       blocks: { order: number; tokens: number }[],
       cachedTokens: number,
       harnessEstimate: number,  // (systemPayloadTokens + toolsTokens) from payload-audit
       calibration: number,      // session-wide estimate→real ratio
     ): number {
       const harnessReal = harnessEstimate * calibration;
       const messageCached = cachedTokens - harnessReal;
       if (messageCached <= 0) return 0;
       let accumulated = 0;
       let frozenCount = 0;
       for (const b of blocks) {
         accumulated += b.tokens * calibration;
         if (accumulated <= messageCached) {
           frozenCount = b.order + 1;
         } else {
           break;
         }
       }
       return Math.max(0, frozenCount - 1); // 1-block safety margin (DEC-003)
     }
     ```

  4. Session lifecycle:
     - `install(pi, getProvider, getBlocks, getHarness, getCalibration)` — registers `after_provider_response` listener using same `(pi as unknown as { on }).on(...)` casting pattern as `payload-audit.ts`. Stores latest metrics and computed `frozenFromIndex` in module-level state. Per DEC-006, each response overwrites (no timer decay).
     - `getFrozenFromIndex(): number` — returns latest computed value, `0` if no data.
     - `getLatestMetrics(): ProviderCacheMetrics | null` — for diagnostic/testing.
     - `reset()` — clears per-session state.

- **Tests to extend**: Create `extension/cache-tracker.test.ts`.

### Global Build & Wiring Notes

- `extractCacheMetrics` and `computeFrozenFromIndex` should be exported as named exports so they can be unit-tested independently of `install()`.
- Follow `payload-audit.ts` module structure: `let installed = false` guard in `install()`, module-level `latest` state, exported getter.

## Acceptance criteria

- [ ] `extractCacheMetrics("anthropic", usage)` correctly extracts `cache_read_input_tokens` and `cache_creation_input_tokens`.
  Run: `npx vitest run extension/cache-tracker.test.ts --reporter=verbose`. Expected: test `extractCacheMetrics — anthropic` passes. Input: `{ cache_read_input_tokens: 45000, cache_creation_input_tokens: 3000, input_tokens: 52000 }`. Asserts: `{ cacheReadTokens: 45000, cacheWriteTokens: 3000, inputTokens: 52000 }`.

- [ ] `extractCacheMetrics("amazon-bedrock", usage)` correctly extracts `cacheReadInputTokenCount` and `cacheWriteInputTokenCount`.
  Run: `npx vitest run extension/cache-tracker.test.ts --reporter=verbose`. Expected: test `extractCacheMetrics — bedrock` passes with equivalent mapping.

- [ ] `extractCacheMetrics("openai", usage)` extracts `prompt_tokens_details.cached_tokens` as read, write = 0.
  Run: `npx vitest run extension/cache-tracker.test.ts --reporter=verbose`. Expected: test `extractCacheMetrics — openai` passes. Asserts `cacheWriteTokens === 0`.

- [ ] `extractCacheMetrics("google", usage)` extracts `cachedContentTokenCount` as read, write = 0.
  Run: `npx vitest run extension/cache-tracker.test.ts --reporter=verbose`. Expected: test `extractCacheMetrics — google` passes.

- [ ] `extractCacheMetrics("github-copilot", usage)` returns all zeros.
  Run: `npx vitest run extension/cache-tracker.test.ts --reporter=verbose`. Expected: test `extractCacheMetrics — copilot` passes. Asserts `{ cacheReadTokens: 0, cacheWriteTokens: 0, inputTokens: 0 }`.

- [ ] `extractCacheMetrics("unknown-provider", undefined)` returns all zeros (graceful fallback on parse failure).
  Run: `npx vitest run extension/cache-tracker.test.ts --reporter=verbose`. Expected: test `extractCacheMetrics — unknown/malformed` passes.

- [ ] `computeFrozenFromIndex` with 10 blocks (100 tokens each), 500 cached tokens, 0 harness, calibration 1.0 → returns 4 (5 blocks fit, minus 1 safety margin).
  Run: `npx vitest run extension/cache-tracker.test.ts --reporter=verbose`. Expected: test `computeFrozenFromIndex — basic walk` passes.

- [ ] `computeFrozenFromIndex` with harness subtraction: 1000 cached, 400 harness estimate, calibration 1.0, blocks of 100 each → messageCached = 600, 6 blocks fit, returns 5 (safety margin).
  Run: `npx vitest run extension/cache-tracker.test.ts --reporter=verbose`. Expected: test `computeFrozenFromIndex — harness subtraction` passes.

- [ ] `computeFrozenFromIndex` returns 0 when `cachedTokens <= harnessEstimate * calibration` (all cache consumed by harness).
  Run: `npx vitest run extension/cache-tracker.test.ts --reporter=verbose`. Expected: test `computeFrozenFromIndex — harness exceeds cached` passes.

- [ ] `computeFrozenFromIndex` returns 0 when `cachedTokens = 0` (cold start).
  Run: `npx vitest run extension/cache-tracker.test.ts --reporter=verbose`. Expected: test `computeFrozenFromIndex — cold start` passes.

- [ ] `computeFrozenFromIndex` with calibration 1.3: blocks of 100 est tokens each, 500 cached real tokens → 500 / (100 * 1.3) ≈ 3.8 blocks fit → frozenCount = 3, minus safety = 2.
  Run: `npx vitest run extension/cache-tracker.test.ts --reporter=verbose`. Expected: test `computeFrozenFromIndex — calibration factor` passes.

- [ ] `getFrozenFromIndex()` returns 0 before any response is processed.
  Run: `npx vitest run extension/cache-tracker.test.ts --reporter=verbose`. Expected: test `getFrozenFromIndex — initial state` passes.

- [ ] `reset()` clears state back to `getFrozenFromIndex() === 0`.
  Run: `npx vitest run extension/cache-tracker.test.ts --reporter=verbose`. Expected: test `reset — clears state` passes.

## Blocked by

None — can start immediately (pure functions, no dependency on Slice 1's contract changes).
