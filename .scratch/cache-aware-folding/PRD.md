# PRD: Cache-Aware Folding for Accordion

## Problem Statement

Accordion folds content **in the middle of the conversation** by replacing block content with `{#code FOLDED}` summaries at their existing position. Since LLM providers (Anthropic, OpenAI) cache prompts by matching the **longest unchanged byte prefix**, modifying any byte in the middle invalidates the cache for that message and everything after it — turning a 90% cache-read discount into a 25% cache-write penalty. This is a silent performance cliff: no error, no crash, just significantly higher token costs.

## Solution

Track the provider's cached prefix across turns and enforce a **frozen boundary** (`frozenFromIndex`) that no conductor can fold into. The conversation is split into three zones:

- **Frozen head** (`blocks[0 .. frozenFromIndex-1]`) — provider-cached prefix, byte-identical across turns, host-enforced.
- **Live zone** (`blocks[frozenFromIndex .. protectedFromIndex-1]`) — the only range where folding is allowed.
- **Protected tail** (`blocks[protectedFromIndex .. end]`) — recent working context, already host-enforced.

Real cache metrics are captured from the LLM provider's response via a new internal `after_provider_response` hook, normalized across providers, and threaded through the existing wire protocol into `ConductorView`.

## User Stories

1. As a developer using Accordion, I want the prompt cache to remain valid across turns, so that I pay cache-read prices (~10%) instead of full re-processing prices (~100%) for the unchanged prefix.
2. As a conductor author, I want `frozenFromIndex` on `ConductorView`, so that I can respect the cache boundary without implementing provider-specific cache tracking.
3. As a conductor author, I want fold commands targeting frozen blocks to be clamped with reason `"frozen"`, so that even a conductor that ignores `frozenFromIndex` cannot accidentally bust the cache.
4. As a user who changes budget mid-session, I want the frozen prefix to remain untouched regardless of budget pressure, so that lowering the budget doesn't invalidate the cache.
5. As a user on OpenAI (which only reports cache reads, not writes), I want the system to self-correct with a one-turn lag on cold start, so that cache protection works across providers.
6. As a user on GitHub Copilot (which reports no cache data), I want Accordion to degrade gracefully to `frozenFromIndex = 0`, so that behavior is identical to today with no errors.
7. As a user in a long session, I want the frozen count to self-correct after long idle periods (provider TTL expiry), so that stale cache data doesn't permanently shrink the foldable window.
8. As a developer reviewing `ClampReport`s, I want a clear `"frozen"` reason when a fold is rejected, so that I can distinguish cache-based rejections from other clamp reasons.
9. As a user of `my-customize-conductor`, I want the conductor to skip frozen blocks in its candidate filter, so that fold decisions respect the cache boundary.
10. As a user of any conductor (builtin, keel, etc.), I want cache safety enforced at the host level, so that all conductors get cache protection for free.

## Accepted Decision Register

- **DEC-001** — **Host-owned `frozenFromIndex` on `ConductorView`**
  - Lens: `contract`
  - Rationale: Same pattern as `protectedFromIndex`; every conductor gets cache safety without reimplementing tracking logic.
  - Rejected: Conductor-owned heuristic (each conductor reinvents), hybrid phased approach.
  - Downstream: New field on `ConductorView`, new field on `SyncMessage.harness`, store must thread it through.

- **DEC-002** — **Real provider cache tokens via `after_provider_response` hook**
  - Lens: `runtime`
  - Rationale: Highest accuracy; Anthropic reports both read+write for immediate frozen count.
  - Rejected: Structural diff of messages (blind to TTL expiry), fold-history heuristic (blind to provider state).
  - Downstream: New internal hook in pi's provider path, new `cache-tracker.ts` module in extension.

- **DEC-003** — **Walk blocks with 1-block safety margin**
  - Lens: `runtime`
  - Rationale: Over-protection (freezing one extra block) costs ~500 tokens of folding room. Under-protection (folding into cache) costs full re-processing of all tokens after the bust point.
  - Rejected: Exact walk (risks undershooting), per-block `host.countTokens()` (expensive, still not provider tokenizer).
  - Downstream: `computeFrozenFromIndex` subtracts 1 from computed boundary.

- **DEC-004** — **Accordion-internal hook (not pi public API)**
  - Lens: `scope`
  - Rationale: Extension controls both emit and listener; no pi framework coupling needed.
  - Rejected: Pi-core public hook (premature, broader scope).
  - Downstream: Hook uses same casting escape hatch as `before_provider_request` in `payload-audit.ts`.

- **DEC-005** — **Raw response passed in hook**
  - Lens: `contract`
  - Rationale: Symmetric with `before_provider_request`. Provider normalization is the consumer's responsibility, not pi core's.
  - Rejected: Provider-normalized by pi (couples framework to cache concepts), normalized+raw (over-engineered).
  - Downstream: `cache-tracker.ts` handles per-provider field mapping.

- **DEC-006** — **Response-driven self-correction (no timer-based decay)**
  - Lens: `runtime`
  - Rationale: Every provider response overwrites the frozen count with fresh data. Worst case after long idle: one turn of over-protection, then self-corrects.
  - Rejected: Timestamp-based TTL decay (complexity for marginal edge case), hybrid (belt-and-suspenders overkill).
  - Downstream: No timer logic, no per-provider TTL constants needed.

- **DEC-007** — **Lag-one for providers without cache write metrics**
  - Lens: `runtime`
  - Rationale: OpenAI/Google report reads only (no writes). On cold start, `frozenFromIndex = 0` for one turn until the first read comes back. Same self-correcting pattern.
  - Rejected: Assume all input cached (too aggressive).
  - Downstream: Provider normalization maps missing write fields to `0`.

- **DEC-008** — **`frozenFromIndex` on `SyncMessage.harness` frame**
  - Lens: `contract`
  - Rationale: Harness frame already carries all context-sizing data (`totalTokens`, `systemPromptTokens`, wire sizes). One additional field, one read path, no new wire message type.
  - Rejected: New dedicated wire message type (more moving parts).
  - Downstream: `protocol.ts` harness type extends, store reads it in `setHarnessBreakdown`.

- **DEC-009** — **Host-enforced with `"frozen"` clamp reason**
  - Lens: `contract`
  - Rationale: Cache busting is silent and expensive. Same reasoning that makes `protected` host-enforced. No conductor can accidentally cause this.
  - Rejected: Advisory only (depends on each conductor opting in).
  - Downstream: New clamp check in `substOne` in `store.svelte.ts`, new `ClampReason` variant.

- **DEC-010** — **Harness subtraction via chars/4 × calibration**
  - Lens: `runtime`
  - Rationale: `systemPayloadTokens + toolsTokens` from `payload-audit.ts`, scaled by session-wide `calibration`. JSON schemas undercount by ~20% at chars/4 — pushes `frozenFromIndex` higher (safe over-protection direction). OpenAI's `systemPayloadTokens = 0` is same safe direction.
  - Rejected: Per-content-type density ratios (complexity for marginal accuracy gain).
  - Downstream: `computeFrozenFromIndex` uses existing `payload-audit` data.

## Implementation Plan

### Area: pi internal — `after_provider_response` emit

- **Decision IDs**: DEC-002, DEC-004, DEC-005
- **Current code anchors**: The `before_provider_request` emit exists in pi's provider call path (exact location internal to pi, not in accordion repo). Pattern is mirrored in `extension/payload-audit.ts` install() (~line 55) which listens via `(pi as unknown as { on }).on("before_provider_request", handler)`.
- **Existing behavior**: Pi emits `before_provider_request` with `{ payload }` before every LLM call. No post-response hook exists.
- **Required edits**: Add a symmetric `emit("after_provider_response", { response: rawResponseBody })` in pi's provider call path, after the response is received and before further processing. The `response` should include the full `usage` object. Per DEC-004, this is accordion-internal — use the same undocumented internal event API, not a public extension hook.
- **Tests to extend**: None in accordion repo (pi-internal change). Verify by checking that `payload-audit.ts` can register a listener and receive data.
- **Wiring/build notes**: No new dependencies. Same `api.on?.(eventName, handler)` pattern as `before_provider_request`.

### Area: `cache-tracker.ts` — new extension module

- **Decision IDs**: DEC-002, DEC-003, DEC-005, DEC-006, DEC-007, DEC-010
- **Current code anchors**: `extension/payload-audit.ts` — pattern to follow for module structure (module-level state, `install()`, `getLatest*()` getter). `extension/accordion.ts` line ~207 `latestModel` (typed `any`) — source for provider detection via `latestModel.provider`.
- **Existing behavior**: No cache tracking exists. `payload-audit.ts` tracks wire payload sizes only.
- **Required edits**: Create `extension/cache-tracker.ts` with:
  1. `ProviderCacheMetrics` interface:
     ```ts
     // decision artifact (normative)
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
     - On parse failure: all zeros (graceful fallback)
  3. `computeFrozenFromIndex(blocks, cachedTokens, harnessEstimate, calibration): number` — per DEC-003, DEC-010:
     ```ts
     // decision artifact (normative)
     function computeFrozenFromIndex(
       blocks: { order: number; tokens: number }[],
       cachedTokens: number,
       harnessEstimate: number,
       calibration: number,
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
       return Math.max(0, frozenCount - 1); // 1-block safety margin
     }
     ```
  4. `install(pi, getProvider, getBlocks, getHarness, getCalibration)` — registers `after_provider_response` listener, stores latest metrics and computed `frozenFromIndex`.
  5. `getFrozenFromIndex(): number` — returns latest computed value, `0` if no data.
  6. `reset()` — clears per-session state (called from `session_shutdown`).
- **Tests to extend**: Create `extension/cache-tracker.test.ts`:
  - Test `extractCacheMetrics` for each provider
  - Test `computeFrozenFromIndex` with various block/token scenarios
  - Test safety margin (result is 1 less than naive computation)
  - Test graceful fallback (unknown provider → 0)
  - Test harness subtraction (message cached = total - harness)
- **Wiring/build notes**: Import and call `install()` from `accordion.ts` alongside `payloadAudit.install(pi)` (~line 1350). Call `reset()` from `session_shutdown` hook (~line 1230).

### Area: `accordion.ts` — wire transport

- **Decision IDs**: DEC-008
- **Current code anchors**:
  - `harnessFrame()` (~line 356) — returns `{ totalTokens, systemPromptTokens, actualWireTokens, messagesTokens, toolsTokens, systemPayloadTokens }`.
  - Five `send(ws, { ..., harness: harnessFrame() })` call sites (~lines 559, 607, 706, 778, 818).
  - `applyModel()` (~line 314) — stores full model object as `latestModel: any`, `latestModel.provider` is accessible.
  - `session_shutdown` (~line 1220) — cleanup hook.
- **Existing behavior**: `harnessFrame()` builds a diagnostic payload from `ctx.getContextUsage()` and `payloadAudit.getLatestSizes()`. No cache data flows to the GUI.
- **Required edits**:
  1. Import `cache-tracker` module.
  2. Extend `harnessFrame()` return type to include `frozenFromIndex?: number | null`.
  3. Read `cacheTracker.getFrozenFromIndex()` inside `harnessFrame()` and include it.
  4. All five `send()` calls already pass `harness: harnessFrame()` — no changes needed there; the new field propagates automatically.
  5. Call `cacheTracker.reset()` in `session_shutdown`.
- **Snippet** (decision artifact, illustrative):
  ```ts
  // In harnessFrame():
  function harnessFrame() {
    const wire = payloadAudit.getLatestSizes();
    const frozen = cacheTracker.getFrozenFromIndex();
    // ...existing...
    return {
      totalTokens: tokens,
      systemPromptTokens,
      actualWireTokens: wire?.actualWireTokens ?? null,
      messagesTokens: wire?.messagesTokens ?? null,
      toolsTokens: wire?.toolsTokens ?? null,
      systemPayloadTokens: wire?.systemPayloadTokens ?? null,
      frozenFromIndex: frozen,  // NEW (DEC-008)
    };
  }
  ```
- **Tests to extend**: No direct unit tests for `harnessFrame()` (it's a private function in the extension). Covered by integration through the store's consumption of the harness frame.
- **Wiring/build notes**: `cacheTracker.install()` must be called after `payloadAudit.install()` since it may depend on `getLatestSizes()` for harness estimates.

### Area: `protocol.ts` — wire protocol

- **Decision IDs**: DEC-008
- **Current code anchors**: `app/src/lib/live/protocol.ts` — `SyncMessage` interface (~line 130). Harness type is inline (not a named interface).
- **Existing behavior**: Harness carries `totalTokens`, `systemPromptTokens`, and four wire-size fields.
- **Required edits**: Add `frozenFromIndex?: number | null` to the harness shape in `SyncMessage`.
- **Snippet** (decision artifact, normative):
  ```ts
  harness?: {
    totalTokens: number | null;
    systemPromptTokens: number | null;
    actualWireTokens?: number | null;
    messagesTokens?: number | null;
    toolsTokens?: number | null;
    systemPayloadTokens?: number | null;
    frozenFromIndex?: number | null;  // NEW (DEC-008)
  };
  ```
- **Tests to extend**: Protocol type changes are checked at compile time (TypeScript). No runtime tests needed for the type addition.
- **Wiring/build notes**: None.

### Area: `conductor.ts` — contract

- **Decision IDs**: DEC-001, DEC-009
- **Current code anchors**:
  - `ConductorView` interface (`conductors/contract/conductor.ts` ~line 75).
  - `ClampReason` type (~line 249).
  - `availableCap()` function (~line 120) — takes structural subtype, does NOT need changes.
- **Existing behavior**: `ConductorView` has `protectedFromIndex` for the tail. `ClampReason` has 7 variants. No frozen-head concept.
- **Required edits**:
  1. Add `frozenFromIndex: number` to `ConductorView` after `protectTokens` (DEC-001):
     ```ts
     // decision artifact (normative)
     /** Index of the first block the conductor may fold. Blocks before this
      *  index are in the provider's prompt cache prefix. 0 = no frozen prefix
      *  (cold start, unknown provider, or cache expired). Host-enforced: fold/replace
      *  commands targeting blocks below this index are clamped with reason "frozen". */
     frozenFromIndex: number;
     ```
  2. Add `"frozen"` to `ClampReason` union after `"protected"` (DEC-009):
     ```ts
     // decision artifact (normative)
     | "frozen"  // block is in the provider's cached prefix
     ```
- **Tests to extend**: Contract is tested transitively through conductor tests and store clamp tests. The `makeView` helper in `conductor.my-customize-conductor.test.ts` must include `frozenFromIndex: 0` (default) so existing tests compile.
- **Wiring/build notes**: This file is deliberately dependency-free. No imports to add.

### Area: `store.svelte.ts` — host enforcement

- **Decision IDs**: DEC-001, DEC-009
- **Current code anchors**:
  - `buildView()` (~line 1007) — assembles `ConductorView` with `protectedFromIndex`.
  - `applyCommands()` (~line 1050) — delegates to `substOne()` for fold/replace.
  - `substOne()` — clamp chain: `unknown-id` → `human-override` → `grouped` → `protected` → `not-foldable`.
  - `setHarnessBreakdown()` — receives harness data from sync, stores as state.
- **Existing behavior**: `buildView` passes `protectedFromIndex` to the view. `substOne` checks 5 clamp reasons. No `frozenFromIndex` anywhere.
- **Required edits**:
  1. Store `frozenFromIndex` from harness frame in `setHarnessBreakdown()`. Default to `0` when absent.
  2. Pass `frozenFromIndex` into `ConductorView` in `buildView()` (DEC-001).
  3. Add frozen clamp check in `substOne()`, after `protected` check, before `not-foldable` (DEC-009):
     ```ts
     // decision artifact (normative)
     // In substOne(), after the protected check:
     if (b.order < this.frozenFromIndex) {
       reports.push({ command: op, ids: [id], reason: "frozen",
         detail: `block ${id} is in the provider's cached prefix (order ${b.order} < frozen ${this.frozenFromIndex})` });
       return;
     }
     ```
- **Tests to extend**:
  - `app/src/lib/engine/conductor.test.ts` — add test for `"frozen"` clamp: create a view with `frozenFromIndex = 5`, issue a fold on block at order 3, assert clamp with `reason: "frozen"`.
  - `app/src/lib/engine/store.foldgate.test.ts` — add test that frozen blocks are rejected even for `replace` commands.
  - Run: `npx vitest run app/src/lib/engine/conductor.test.ts`
- **Wiring/build notes**: `frozenFromIndex` is reactive state (Svelte 5 runes). Follow the pattern of `harnessOverhead` storage.

### Area: `my-customize-conductor.ts` — conductor adaptation

- **Decision IDs**: DEC-001
- **Current code anchors**:
  - Candidate filter (~line 74): `!b.held && !b.protected && !b.grouped && b.foldedTokens < b.tokens && FOLDABLE_KINDS.has(b.kind)`.
  - Epoch hold guard (~line 53): `if (b && !b.held && !b.protected && !b.grouped) projectedHeld -= saving`.
  - No self-managed `frozenCount` exists (it was proposed but not yet implemented).
- **Existing behavior**: Conductor folds oldest-first without cache awareness. Epoch hold reuses previous plan if under 0.9 × cap.
- **Required edits**:
  1. Add frozen check to candidate filter (DEC-001):
     ```ts
     // decision artifact (normative)
     const candidates = view.blocks.filter(
       (b) =>
         !b.held &&
         !b.protected &&
         !b.grouped &&
         b.order >= view.frozenFromIndex &&  // NEW: respect frozen prefix
         b.foldedTokens < b.tokens &&
         FOLDABLE_KINDS.has(b.kind),
     );
     ```
  2. Add frozen check to epoch hold guard — a plan that previously saved tokens by touching a now-frozen block must be invalidated:
     ```ts
     // In epoch hold loop:
     if (b && !b.held && !b.protected && !b.grouped
         && b.order >= view.frozenFromIndex)  // NEW
       projectedHeld -= saving;
     ```
- **Tests to extend**:
  - `app/src/lib/engine/conductor.my-customize-conductor.test.ts`:
    - Add test: view with `frozenFromIndex = 5` → blocks at order 0–4 are NOT in candidates.
    - Add test: previous plan touched block at order 3, now frozen at 5 → epoch hold invalidated (plan recomputed).
    - Add test: all foldable blocks are frozen → conductor returns `[]` (nothing to fold, over-budget is accepted).
  - Run: `npx vitest run app/src/lib/engine/conductor.my-customize-conductor.test.ts`
- **Wiring/build notes**: No new imports needed. `frozenFromIndex` comes from the existing `ConductorView` import.

## Global Build & Wiring Notes

- **Test runner**: `npx vitest run <path>` for all frontend tests. Expected output: `Tests X passed`.
- **TypeScript compilation**: Adding `frozenFromIndex` to `ConductorView` will cause compile errors in any test `makeView` helper that doesn't include it. Update all `makeView` helpers across conductor test files to include `frozenFromIndex: 0` as default.
- **Conductor registry**: No registration change needed. `my-customize-conductor` is already registered in `conductors/index.ts` (entry 6 in `IN_PROCESS_CONDUCTORS`).
- **Wire protocol versioning**: `PROTOCOL_VERSION` in `protocol.ts` does not need a bump — the new field is optional (`frozenFromIndex?: number | null`), backward-compatible with older GUIs that ignore it.
- **pi internal emit**: The `after_provider_response` emit must be added in pi's provider call path. This is outside the accordion repo. Coordinate with pi maintainer or add it in the same workspace if accessible.

## Testing Decisions

- **Test external behavior, not implementation**: Tests should verify that frozen blocks are rejected (clamp report), not how the frozen count is computed internally.
- **Modules to test**:
  - `cache-tracker.ts` — unit test `extractCacheMetrics` per provider and `computeFrozenFromIndex` with edge cases (cold start, harness > cached, safety margin).
  - `store.svelte.ts` — integration test `applyCommands` with frozen blocks, verify `ClampReport` with `reason: "frozen"`.
  - `my-customize-conductor.ts` — unit test candidate filtering with `frozenFromIndex`, epoch hold invalidation.
- **Prior art**:
  - `conductor.test.ts` — tests `applyCommands` clamping for `protected`, `human-override`, etc. Follow the same `makeView` → `applyCommands` → assert `ClampReport` pattern.
  - `conductor.my-customize-conductor.test.ts` — tests fold priority, hold band, MCP protection. Follow the same `makeView` → `conduct(view)` → assert commands pattern.
  - `store.foldgate.test.ts` — tests `substOne` gate logic per kind. Add parallel tests for frozen gate.

## Out of Scope

- **Headroom-style tool array normalization** (sorting tool definitions for deterministic ordering). This is a separate optimization that prevents tool-order-induced cache busts — valuable but orthogonal to fold-induced busts.
- **Per-content-type token density** (using 3.2 chars/token for JSON instead of 4.0). The `chars/4` undercount on tools pushes `frozenFromIndex` in the safe direction. A density refinement is a future optimization.
- **Visual indicator in the GUI** showing frozen vs foldable zones. Useful for debugging but not required for the core feature.
- **Cache-aware folding in other conductors** (builtin, keel, etc.). The host enforcement (DEC-009) protects all conductors. Conductor-side awareness in `my-customize-conductor` is the only conductor change in scope.
- **Public pi extension API** for `after_provider_response`. This is accordion-internal for now (DEC-004).

## Unresolved Gaps

None. All material decisions were resolved during the grilling session.

## Further Notes

- **Headroom reference**: The design is inspired by [Headroom](https://github.com/headroomlabs-ai/headroom)'s Phase E cache stabilization, specifically `PrefixCacheTracker` (session-scoped freeze), `compute_frozen_count` (marker-based boundary), and the "bytes outside the live zone round-trip byte-equal" invariant.
- **Budget vs frozen trade-off**: When `frozen + protected > budget`, the system intentionally stays over-budget rather than busting the cache. Sending 10k extra tokens as cache-reads costs ~1k token-equivalents (90% discount); busting the cache to save those 10k costs re-processing the full 50k+ at write price.
- **ADR recommendation**: Consider writing `docs/adr/0017-cache-aware-folding.md` to record the frozen-head/live-zone/protected-tail three-zone model and the host-enforcement decision. This is hard to reverse (baked into the conductor contract), surprising without context (why can't I fold old blocks?), and the result of a real trade-off (cache savings vs folding freedom).
