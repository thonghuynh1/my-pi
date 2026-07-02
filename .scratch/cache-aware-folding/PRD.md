# PRD: Cache-Aware Folding for Accordion

## Problem Statement

Accordion folds content in the middle of the conversation by replacing block content with `{#code FOLDED}` summaries at their existing position. LLM providers cache prompts by matching the longest unchanged byte prefix. If Accordion mutates a block inside that cached prefix, the provider cache misses for that block and everything after it. That turns a cheap cache read into expensive prompt reprocessing with no visible error.

## Solution

Track the provider's cached prefix by comparing consecutive outgoing request payloads and enforce a frozen boundary that no conductor can fold into. No `pi` package changes are required.

On each `before_provider_request` hook, Accordion captures a snapshot of the conversation messages portion of the payload. On the next turn, it compares the new snapshot against the stored one, finds the longest unchanged leading prefix, subtracts a one-block safety margin, and publishes that as `frozenFromIndex`. The host clamp and conductor contract (already implemented in issues 001 and 002) enforce this boundary across all conductors.

The conversation is split into three zones:

- **Frozen head** (`blocks[0 .. frozenFromIndex-1]`). Prefix unchanged since last request. Host-enforced.
- **Live zone** (`blocks[frozenFromIndex .. protectedFromIndex-1]`). The only range where folding is allowed.
- **Protected tail** (`blocks[protectedFromIndex .. end]`). Recent working context. Already host-enforced.

## User Stories

1. As a developer using Accordion, I want the prompt cache to remain valid across turns, so that I pay cache-read prices instead of full re-processing prices for the unchanged prefix.
2. As a conductor author, I want `frozenFromIndex` on `ConductorView`, so that I can respect the cache boundary without implementing tracking logic.
3. As a conductor author, I want fold commands targeting frozen blocks to be clamped with reason `"frozen"`, so that even a conductor that ignores `frozenFromIndex` cannot accidentally bust the cache.
4. As a user who changes budget mid-session, I want the frozen prefix to remain untouched regardless of budget pressure, so that lowering the budget does not invalidate the cache.
5. As a user on any provider, I want the frozen boundary to self-correct with a one-turn lag on cold start, so that cache protection starts after the second turn.
6. As a user of `my-customize-conductor`, I want the conductor to skip frozen blocks in its candidate filter, so that fold decisions respect the cache boundary.
7. As a user of any conductor, I want cache safety enforced at the host level, so that all conductors get cache protection for free.
8. As a developer reviewing `ClampReport`s, I want a clear `"frozen"` reason when a fold is rejected, so that I can distinguish cache-based rejections from other clamp reasons.
9. As a user who switches models mid-session, I want the frozen boundary to reset to zero on provider or model change, so that stale assumptions do not persist across providers.
10. As a user whose system prompt or tools change mid-session, I want the frozen boundary to reset to zero, so that the stale prefix is not falsely protected.

## Accepted Decision Register

- **DEC-001** — **Host-owned `frozenFromIndex` on `ConductorView`**
  - Lens: `contract`
  - Rationale: Same pattern as `protectedFromIndex`. Every conductor gets cache safety without reimplementing tracking logic.
  - Rejected alternatives: Conductor-owned heuristic. Hybrid phased approach.
  - Downstream impact: Already implemented in issue 001.

- **DEC-002** — **Request-side heuristic frozen boundary with no `pi` package changes**
  - Lens: `strategy`
  - Rationale: Avoids upstream dependency. Ships today. Acceptable accuracy trade-off. Cannot detect provider TTL expiry, but over-freezing costs only folding room, not correctness.
  - Rejected alternatives: Response-side telemetry via upstream `pi` hook (rejected because user does not want to change `pi`). Heuristic-only with no request data (weaker signal).
  - Downstream impact: `cache-tracker.ts` switches from `after_provider_response` to `before_provider_request`.

- **DEC-003** — **Per-message string comparison from the provider payload, mapped to block indices**
  - Lens: `runtime`
  - Rationale: Compares exactly what the provider sees. Position-indexed comparison handles duplicate messages naturally.
  - Rejected alternatives: Per-block content hash (mapping drift risk). Single prefix hash (all-or-nothing collapse).
  - Downstream impact: `cache-tracker.ts` stores full serialized message strings from the previous turn.

- **DEC-004** — **Offset past system and tools, 1:1 ordered mapping to blocks**
  - Lens: `runtime`
  - Rationale: Simple. The conversation portion of the payload maps directly to Accordion blocks in order. If `pi` injects unexpected messages, the hash comparison detects the mismatch and conservatively resets to zero.
  - Rejected alternatives: Content-based correlation (fragile).
  - Downstream impact: `cache-tracker.ts` skips non-conversation prefix messages.

- **DEC-005** — **Reset on system prompt or tools change, and on model or provider change**
  - Lens: `runtime`
  - Rationale: These structural changes invalidate the provider cache prefix. Cheap and deterministic to detect.
  - Rejected alternatives: Idle timeout (magic numbers, no real TTL knowledge).
  - Downstream impact: `PrefixSnapshot` includes system, tools, and provider fingerprints.

- **DEC-006** — **One-block safety margin**
  - Lens: `runtime`
  - Rationale: Without response confirmation, one block of margin is cheap insurance. Cost is roughly 500 tokens of lost folding room.
  - Rejected alternatives: No margin (risks silent cache bust on edge cases).
  - Downstream impact: Subtract one from the computed prefix length.

- **DEC-007** — **Full serialized message strings in memory, no hashing**
  - Lens: `runtime`
  - Rationale: Simple, exact, no collision concern. Memory cost is negligible for one turn of conversation.
  - Rejected alternatives: Short hashes (unnecessary complexity for marginal memory saving).
  - Downstream impact: `PrefixSnapshot.messageStrings` is `string[]`.

- **DEC-008** — **Separate `cache-tracker.ts` module using `before_provider_request`**
  - Lens: `scope`
  - Rationale: Single responsibility. Module already exists. Tests stay isolated.
  - Rejected alternatives: Extending `payload-audit.ts` (mixed concerns).
  - Downstream impact: `cache-tracker.ts` registers its own `before_provider_request` listener.

- **DEC-009** — **Delete dead response-side extraction code**
  - Lens: `scope`
  - Rationale: Dead code confuses readers. Restorable from git if upstream ever ships the hook.
  - Rejected alternatives: Keep dormant (reader load, false coverage).
  - Downstream impact: `extractCacheMetrics`, `pickUsage`, all provider extractors, and `computeFrozenFromIndex` are removed.

- **DEC-010** — **Inline the safety margin subtraction**
  - Lens: `scope`
  - Rationale: The logic is one line. The real testable behavior is the prefix matching.
  - Rejected alternatives: Named function (over-abstraction for subtraction).
  - Downstream impact: No standalone `computeFrozenFromIndex` function.

- **DEC-011** — **One-turn-behind timing, cold start at zero**
  - Lens: `runtime`
  - Rationale: Natural for request-side design. The boundary reflects what was stable as of the last sent payload. Matches the lag-one behavior from Headroom's Guard B.
  - Rejected alternatives: Current-turn (impossible without response data).
  - Downstream impact: `frozenFromIndex = 0` on the first turn. First real boundary after the second turn.

- **DEC-012** — **Carry `frozenFromIndex` on the existing harness frame**
  - Lens: `contract`
  - Rationale: The harness frame already carries context-sizing data. One optional field is enough.
  - Rejected alternatives: New wire message type.
  - Downstream impact: `protocol.ts`, `accordion.ts`, and `store.svelte.ts` must thread the field through the existing sync flow.

- **DEC-013** — **Host-enforced with `"frozen"` clamp reason**
  - Lens: `contract`
  - Rationale: Cache busting is silent and expensive. Host enforcement gives every conductor the same floor.
  - Rejected alternatives: Advisory only.
  - Downstream impact: Already implemented in issue 001.

## Implementation Plan

Issues `001` (contract and host enforcement) and `002` (cache-tracker pure functions) are already closed. This PRD covers only the remaining implementation work.

### Area: `cache-tracker.ts` — rewrite to request-side heuristic

- **Decision IDs**: DEC-002, DEC-003, DEC-004, DEC-005, DEC-006, DEC-007, DEC-008, DEC-009, DEC-010, DEC-011
- **Current code anchors**:
  - `vendor/accordion/extension/cache-tracker.ts` — `install()`, `extractCacheMetrics()`, `computeFrozenFromIndex()`, `pickUsage()`, `getFrozenFromIndex()`, `reset()`
  - `vendor/accordion/extension/cache-tracker.test.ts` — 13 existing tests covering the old response-driven logic
- **Existing behavior**: The module registers on `after_provider_response`, reads `event.usage`, extracts per-provider cache metrics, walks blocks by token count, and computes `frozenFromIndex`. All of this is dead for the new design.
- **Required edits**:
  1. Delete `extractCacheMetrics`, `computeFrozenFromIndex`, `pickUsage`, all provider-specific extractors, and `ProviderCacheMetrics` interface. (DEC-009)
  2. Delete the `after_provider_response` listener. (DEC-008)
  3. Add `PrefixSnapshot` interface. (DEC-003, DEC-005, DEC-007)
  4. Add `before_provider_request` listener that builds a current snapshot from the payload, compares against the previous snapshot, and computes `frozenFromIndex`. (DEC-002, DEC-003, DEC-004, DEC-005, DEC-006, DEC-011)
  5. Keep `getFrozenFromIndex()` and `reset()` exports unchanged. (DEC-008)
  6. Remove `getLatestMetrics()` export. (DEC-009)
  7. Update `install()` signature. It no longer needs `getBlocks`, `getHarness`, or `getCalibration`. It needs the `pi` API only. (DEC-008, DEC-010)
- **Snippet(s)**:
  - `decision artifact` (normative).
    ```ts
    interface PrefixSnapshot {
      messageStrings: string[];
      systemHash: string;
      toolsHash: string;
      provider: string;
    }
    ```
  - `decision artifact` (normative).
    ```ts
    // In before_provider_request handler:
    // 1. Build current PrefixSnapshot from event.payload
    // 2. If previous is null → frozenFromIndex = 0 (cold start)
    // 3. If systemHash, toolsHash, or provider changed → frozenFromIndex = 0
    // 4. Otherwise walk messageStrings positionally:
    //    matchedPrefix = count of leading identical strings
    //    frozenFromIndex = max(0, matchedPrefix - 1)
    // 5. Store current snapshot as previous
    ```
  - `current code anchor`.
    ```ts
    export function install(
      pi: ExtensionAPI,
      getProvider: () => string | undefined,
      getBlocks: () => CacheBlock[],
      getHarness: () => number,
      getCalibration: () => number,
    ): void {
    ```
    This signature is the seam to replace. New signature needs only `pi` and `getProvider`.
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
- **Wiring/build notes**: `cache-tracker.ts` registers on `before_provider_request` using the same `(pi as unknown as { on }).on(...)` pattern as `payload-audit.ts`.

### Area: `accordion.ts` — install and wire the heuristic tracker

- **Decision IDs**: DEC-002, DEC-008, DEC-012
- **Current code anchors**:
  - `vendor/accordion/extension/accordion.ts` — `harnessFrame()` (line ~548)
  - `vendor/accordion/extension/accordion.ts` — `payloadAudit.install(pi)` (line ~1270)
  - `vendor/accordion/extension/accordion.ts` — `session_shutdown` (line ~1199)
- **Existing behavior**: `harnessFrame()` reports token diagnostics only. `cache-tracker.ts` is not installed. No frozen boundary flows to the GUI.
- **Required edits**:
  1. Import `cache-tracker` module. (DEC-008)
  2. Call `cacheTracker.install(pi, () => latestModel?.provider)` alongside `payloadAudit.install(pi)`. (DEC-002, DEC-008)
  3. Include `frozenFromIndex: cacheTracker.getFrozenFromIndex()` in `harnessFrame()` return. (DEC-012)
  4. Call `cacheTracker.reset()` in `session_shutdown`. (DEC-002)
- **Snippet(s)**:
  - `current code anchor`.
    ```ts
    function harnessFrame(): {
      totalTokens: number | null;
      systemPromptTokens: number | null;
      actualWireTokens: number | null;
      messagesTokens: number | null;
      toolsTokens: number | null;
      systemPayloadTokens: number | null;
    } | undefined {
      const wire = payloadAudit.getLatestSizes();
      if (tokens === null && systemPromptTokens === null && wire === null) return undefined;
      return {
        totalTokens: tokens,
        systemPromptTokens,
        actualWireTokens: wire?.actualWireTokens ?? null,
        messagesTokens: wire?.messagesTokens ?? null,
        toolsTokens: wire?.toolsTokens ?? null,
        systemPayloadTokens: wire?.systemPayloadTokens ?? null,
      };
    }
    ```
    Normative for the seam to extend.
- **Tests to extend**: No direct unit test for `harnessFrame()`. Verification through downstream consumer path.
- **Wiring/build notes**: Install `cacheTracker` after `payloadAudit.install(pi)`.

### Area: `protocol.ts` and `store.svelte.ts` — GUI ingest

- **Decision IDs**: DEC-001, DEC-012, DEC-013
- **Current code anchors**:
  - `vendor/accordion/app/src/lib/live/protocol.ts` — `SyncMessage.harness`
  - `vendor/accordion/app/src/lib/engine/store.svelte.ts` — `setHarnessBreakdown()` (line ~1187)
  - `vendor/accordion/app/src/lib/engine/store.svelte.ts` — `frozenFromIndex` state (line ~151)
  - `vendor/accordion/app/src/lib/engine/store.svelte.ts` — `buildView()` (line ~1040)
  - `vendor/accordion/app/src/lib/engine/store.svelte.ts` — `substOne()` frozen clamp (line ~1093)
- **Existing behavior**: The store has `frozenFromIndex` state, passes it into `buildView()`, and clamps frozen blocks. But `setHarnessBreakdown()` ignores the field, and `SyncMessage.harness` does not carry it.
- **Required edits**:
  1. Add `frozenFromIndex?: number | null` to the harness shape in `SyncMessage`. (DEC-012)
  2. Add `frozenFromIndex?: number | null` to `setHarnessBreakdown()` input type. (DEC-012)
  3. In `setHarnessBreakdown()`, store `h.frozenFromIndex ?? 0` into the reactive `frozenFromIndex` state. (DEC-001, DEC-012)
- **Snippet(s)**:
  - `current code anchor`.
    ```ts
    setHarnessBreakdown(h: {
      totalTokens: number | null;
      systemPromptTokens: number | null;
      actualWireTokens?: number | null;
      messagesTokens?: number | null;
      toolsTokens?: number | null;
      systemPayloadTokens?: number | null;
    } | null): void {
      this.harnessBreakdown = h;
      this.updateCalibration();
    }
    ```
    Normative for the seam to extend.
- **Tests to extend**:
  - `vendor/accordion/app/src/lib/engine/conductor.test.ts`
  - `vendor/accordion/app/src/lib/engine/store.foldgate.test.ts`
  - Run: `npx vitest run vendor/accordion/app/src/lib/engine/conductor.test.ts vendor/accordion/app/src/lib/engine/store.foldgate.test.ts`
  - Expected: both suites pass with `frozenFromIndex` now driven by real data through `setHarnessBreakdown`.
- **Wiring/build notes**: The existing `frozenFromIndex` state, `buildView()` pass-through, and `substOne()` clamp were all delivered in issue 001. This area only adds the ingest path.

## Global Build & Wiring Notes

- `vendor/accordion` is the implementation target in this workspace.
- No `pi` package changes are required for this feature.
- Run frontend tests with `npx vitest run <path>`.
- Contract and host-enforcement work from issues `001` and `002` are already present. Remaining slices must not re-open those decisions.
- The `before_provider_request` hook is already used by `payload-audit.ts`. Multiple listeners on the same event are supported by `pi`.

## Testing Decisions

- Test external behavior, not implementation details.
- The new `cache-tracker.ts` is a deep module with a simple interface (`install`, `getFrozenFromIndex`, `reset`) and complex internal logic. Test it in isolation through its public API.
- Prior art: `vendor/accordion/extension/cache-tracker.test.ts` (to be rewritten) and `vendor/accordion/extension/payload-audit.ts` (pattern for `before_provider_request` registration).
- Downstream clamp behavior is already tested in `conductor.test.ts` and `store.foldgate.test.ts`.

## Out of Scope

- Upstream `pi` package changes.
- Response-side provider cache telemetry.
- Provider TTL expiry detection.
- Idle timeout decay.
- GUI visualization of frozen versus live zones.
- Tool-order normalization.

## Unresolved Gaps

None.

## Further Notes

- Inspired by Headroom's Guard B (content-stability guard). Headroom's Guard A (response-driven) is deferred until `pi` ships the hook natively.
- Over-freezing on stale cache (provider TTL expiry) is an accepted trade-off. It costs folding room, not correctness.
- If `pi` ever exposes response usage, the design can be extended with a dual-guard model without changing the downstream consumer path.
