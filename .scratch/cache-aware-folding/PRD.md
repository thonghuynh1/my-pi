# PRD: Cache-Aware Folding for Accordion

## Problem Statement

Accordion folds content in the middle of the conversation by replacing block content with `{#code FOLDED}` summaries at their existing position. LLM providers cache prompts by matching the longest unchanged byte prefix. If Accordion mutates a block inside that cached prefix, the provider cache misses for that block and everything after it. That turns a cheap cache read into expensive prompt reprocessing with no visible error.

The original plan was wrong about the `pi` hook surface. This workspace's installed `pi` package already exposes `after_provider_response` with `usage?: unknown` and emits `usage: response.usage` at runtime. The remaining problem is local. Accordion still reads the stale event shape and does not finish wiring the frozen boundary through the live harness path.

## Solution

Keep the frozen-head model in Accordion and consume the existing public `pi` hook contract as installed.

The conversation stays split into three zones:

- **Frozen head** (`blocks[0 .. frozenFromIndex-1]`). Provider-cached prefix. Host-enforced.
- **Live zone** (`blocks[frozenFromIndex .. protectedFromIndex-1]`). The only range where folding is allowed.
- **Protected tail** (`blocks[protectedFromIndex .. end]`). Recent working context. Already host-enforced.

Accordion should normalize the provider-specific `event.usage` payload inside `cache-tracker.ts`, compute `frozenFromIndex`, and thread it through the existing harness frame into `ConductorView`.

## User Stories

1. As a developer using Accordion, I want the prompt cache to remain valid across turns, so that I pay cache-read prices instead of full re-processing prices for the unchanged prefix.
2. As a conductor author, I want `frozenFromIndex` on `ConductorView`, so that I can respect the cache boundary without implementing provider-specific cache tracking.
3. As a conductor author, I want fold commands targeting frozen blocks to be clamped with reason `"frozen"`, so that even a conductor that ignores `frozenFromIndex` cannot accidentally bust the cache.
4. As a user who changes budget mid-session, I want the frozen prefix to remain untouched regardless of budget pressure, so that lowering the budget does not invalidate the cache.
5. As a user on OpenAI or Google, I want the system to self-correct with a one-turn lag on cold start, so that cache protection still works when the provider reports reads but not writes.
6. As a user on GitHub Copilot or another provider with no cache telemetry, I want Accordion to degrade gracefully to `frozenFromIndex = 0`, so that behavior stays identical to today with no errors.
7. As a user in a long session, I want the frozen count to self-correct after provider TTL expiry, so that stale cache data does not permanently shrink the foldable window.
8. As a developer reviewing `ClampReport`s, I want a clear `"frozen"` reason when a fold is rejected, so that I can distinguish cache-based rejections from other clamp reasons.
9. As a user of `my-customize-conductor`, I want the conductor to skip frozen blocks in its candidate filter, so that fold decisions respect the cache boundary.
10. As a user of any conductor, I want cache safety enforced at the host level, so that all conductors get cache protection for free.
11. As a maintainer upgrading `pi`, I want Accordion to depend on the released public hook contract already present in `pi`, so that we avoid a private package fork.
12. As a maintainer evaluating provider support, I want a live Anthropic and OpenAI/Codex check after the local wiring lands, so that we know which providers produce usable cache telemetry in practice.

## Accepted Decision Register

- **DEC-001** — **Host-owned `frozenFromIndex` on `ConductorView`**
  - Lens: `contract`
  - Rationale: Same pattern as `protectedFromIndex`. Every conductor gets cache safety without reimplementing tracking logic.
  - Rejected alternatives: Conductor-owned heuristic. Hybrid phased approach.
  - Downstream impact: `ConductorView`, `SyncMessage.harness`, and the store must thread the field through.

- **DEC-002** — **Real provider cache tokens via `after_provider_response`**
  - Lens: `runtime`
  - Rationale: Provider-reported usage is the most accurate signal. Anthropic reports both cache reads and writes, which gives an immediate frozen count.
  - Rejected alternatives: Structural diff of messages. Fold-history heuristic.
  - Downstream impact: Accordion keeps provider normalization in `cache-tracker.ts` and computes the boundary from usage data.

- **DEC-003** — **Walk blocks with a 1-block safety margin**
  - Lens: `runtime`
  - Rationale: Freezing one extra block costs a little foldable room. Folding one block too far can invalidate the cache for the rest of the prompt.
  - Rejected alternatives: Exact walk. Per-block token recount with host tokenization.
  - Downstream impact: `computeFrozenFromIndex` subtracts one block from the fitted boundary.

- **DEC-004** — **Consume the installed public `after_provider_response` hook as-is**
  - Lens: `scope`
  - Rationale: The installed `pi` package in this workspace already exposes `usage?: unknown` and emits `response.usage` on the hook. Accordion should adapt to that released contract instead of planning a new package change.
  - Rejected alternatives: Private `pi` fork. New upstream blocker. Accordion-specific event.
  - Downstream impact: The remaining code work is local to Accordion.

- **DEC-005** — **Keep provider normalization in Accordion**
  - Lens: `contract`
  - Rationale: Accordion needs provider usage data, not pi-side cache semantics. The hook should stay generic and Accordion should map provider shapes locally.
  - Rejected alternatives: Pi-side normalization into Accordion-specific fields. Full raw response dependence in Accordion.
  - Downstream impact: `cache-tracker.ts` remains the single normalization boundary.

- **DEC-006** — **Response-driven self-correction with no timer decay**
  - Lens: `runtime`
  - Rationale: Each provider response overwrites the frozen count with fresh data. After a long idle, the worst case is one over-protected turn before the next response corrects it.
  - Rejected alternatives: Timestamp-based TTL decay. Hybrid timer plus response logic.
  - Downstream impact: No timer logic or per-provider TTL constants are needed.

- **DEC-007** — **Lag one turn for providers without cache-write metrics**
  - Lens: `runtime`
  - Rationale: OpenAI and Google report cache reads but not writes. Cold start begins at zero and self-corrects on the next turn.
  - Rejected alternatives: Assume all input is cached.
  - Downstream impact: Provider normalization maps missing write fields to `0`.

- **DEC-008** — **Carry `frozenFromIndex` on the existing harness frame**
  - Lens: `contract`
  - Rationale: The harness frame already carries context-sizing data. One optional field is enough.
  - Rejected alternatives: New wire message type.
  - Downstream impact: `protocol.ts`, `accordion.ts`, and `store.svelte.ts` must thread the field through the existing sync flow.

- **DEC-009** — **Host-enforced cache safety with `"frozen"` clamp reason**
  - Lens: `contract`
  - Rationale: Cache busting is silent and expensive. Host enforcement gives every conductor the same floor.
  - Rejected alternatives: Advisory-only conductor behavior.
  - Downstream impact: Clamp logic must reject fold and replace commands targeting the frozen head.

- **DEC-010** — **Subtract harness overhead with chars-per-token calibration**
  - Lens: `runtime`
  - Rationale: `systemPayloadTokens + toolsTokens`, scaled by session calibration, is already available and safely over-protects when estimates are rough.
  - Rejected alternatives: Per-content-type token density tuning.
  - Downstream impact: `computeFrozenFromIndex` uses existing payload-audit data for harness subtraction.

- **DEC-011** — **No private `pi` package fork**
  - Lens: `scope`
  - Rationale: The released package already provides the needed hook contract in this workspace. A local fork would add risk without buying anything.
  - Rejected alternatives: Patch installed package locally and carry it forward.
  - Downstream impact: Remaining work stays in `vendor/accordion`, with package compatibility verified by inspection and live follow-up.

## Implementation Plan

This PRD covers the remaining work after the contract and host-enforcement slices landed in `vendor/accordion`. Issues `001` and `002` are already closed. The remaining implementation work is local adaptation plus live-provider verification.

### Area: installed `pi` package — verification anchors only

- **Decision IDs**: DEC-004, DEC-011
- **Current code anchors**:
  - `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts` — `AfterProviderResponseEvent`
  - `node_modules/@earendil-works/pi-coding-agent/dist/core/sdk.js` — `onResponse`
  - `node_modules/@earendil-works/pi-coding-agent/docs/extensions.md` — `after_provider_response`
- **Existing behavior**: The installed package type already exposes `usage?: unknown`, and the installed runtime already emits `usage: response.usage` on `after_provider_response`. The docs still emphasize status and headers, so runtime and docs are slightly out of sync.
- **Required edits**: No package code change is required for this feature in this workspace. Treat these files as compatibility anchors that the Accordion slice must verify before and after wiring.
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
  1. Read `event.usage` in the install listener. It implements DEC-002 and DEC-004.
  2. Keep provider normalization in Accordion. `extractCacheMetrics(provider, usage)` remains the boundary that maps Anthropic, Bedrock, OpenAI, Google, and fallback providers. It implements DEC-005 and DEC-007.
  3. Keep the current response-driven overwrite behavior and safety-margin boundary math. It implements DEC-003, DEC-006, and DEC-010.
  4. Update tests so the fake hook event uses `usage` directly. It implements DEC-004 and DEC-011.
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
  1. Import `cache-tracker.ts` and install it after `payloadAudit.install(pi)`. It implements DEC-002 and DEC-011.
  2. Include `frozenFromIndex` in `harnessFrame()`. It implements DEC-008.
  3. Reset `cacheTracker` on `session_shutdown`. It implements DEC-002.
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
    ```
    Normative for the seam to extend.
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
  1. Add `frozenFromIndex?: number | null` to `SyncMessage.harness`. It implements DEC-008.
  2. In `setHarnessBreakdown()`, store `h.frozenFromIndex ?? 0` into the reactive state before recalculating derived values. It implements DEC-001 and DEC-008.
  3. Leave the existing host clamp and conductor contract untouched. Those were delivered by earlier slices and are the consumer proof for this wiring. It respects DEC-009.
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
    Normative for the seam to fix.
- **Tests to extend**:
  - `vendor/accordion/app/src/lib/engine/conductor.test.ts`
  - `vendor/accordion/app/src/lib/engine/store.foldgate.test.ts`
  - Run: `npx vitest run vendor/accordion/app/src/lib/engine/conductor.test.ts vendor/accordion/app/src/lib/engine/store.foldgate.test.ts`
  - Expected: both suites pass.
- **Wiring/build notes**: This is the consumer side of the local adaptation. The proof must show `frozenFromIndex` reaches behavior, not just types.

### Area: live provider verification — Anthropic and OpenAI/Codex

- **Decision IDs**: DEC-002, DEC-004, DEC-006, DEC-007, DEC-011
- **Current code anchors**:
  - `vendor/accordion/extension/cache-tracker.ts`
  - installed package anchors in `node_modules/@earendil-works/pi-coding-agent/dist/core/sdk.js` and `dist/core/extensions/types.d.ts`
- **Existing behavior**: Static inspection proves the hook shape. Unit tests prove provider extraction helpers and one Anthropic-style lifecycle path. A real provider session is still needed to confirm runtime telemetry behavior by provider.
- **Required edits**: No code change required in this area. This area defines the manual verification pass after the local adaptation lands.
- **Tests to extend**: Manual live verification.
  - Anthropic. Start a live session, send two turns, inspect whether `frozenFromIndex` becomes non-zero on the second turn.
  - OpenAI/Codex. Start a live session, send two turns, inspect whether cached-token telemetry appears and whether behavior stays lag-one or zero without errors.
- **Wiring/build notes**: This area is HITL by nature. The proof depends on real provider responses, not just repo-local headless tests.

## Global Build & Wiring Notes

- `vendor/accordion` is the implementation target in this workspace.
- The installed `pi` package is a compatibility anchor, not an edit target for the real feature work.
- Run frontend tests with `npx vitest run <path>`.
- Contract and host-enforcement work from local issues `001` and `002` are already present in `vendor/accordion`. Remaining slices must not re-open those decisions.

## Testing Decisions

- Test external behavior, not implementation details.
- Keep provider normalization unit-tested in `cache-tracker.test.ts`.
- Verify the released hook contract by inspecting installed package artifacts.
- Prove the Accordion consumer path in this repo by showing the local adaptation compiles, tests pass, and `frozenFromIndex` reaches existing clamp behavior.
- Treat live Anthropic and OpenAI/Codex checks as a separate human verification pass.

## Out of Scope

- A private `pi` package fork.
- Pi-side normalization into Accordion-specific fields such as `cacheReadTokens` or `frozenFromIndex`.
- Full raw provider response dependence in Accordion.
- Tool-order normalization and other unrelated cache-stability work.
- GUI visualization of frozen versus live zones.

## Unresolved Gaps

None.

## Further Notes

- The stale assumption in the earlier plan was that `pi` lacked the needed hook contract. This workspace proves the opposite.
- The real implementation change is smaller now. It is mostly local adaptation plus the remaining harness and store wiring.
- Live provider behavior is still worth checking after the local work lands, especially for OpenAI or Codex paths that may expose weaker cache telemetry than Anthropic.
