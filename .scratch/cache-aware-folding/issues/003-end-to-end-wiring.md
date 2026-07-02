---
id: "003"
title: "End-to-End Wiring — pi hook → cache-tracker → wire → store"
labels: [ready-for-agent]
depends_on: ["001", "002"]
---

## What to build

Wire the cache tracker (Slice 2) into the live pipeline so real provider cache data flows through to the conductor contract (Slice 1). This slice connects all layers: pi emits `after_provider_response` → `cache-tracker.ts` extracts and computes → `accordion.ts` includes `frozenFromIndex` in the harness frame → WebSocket carries it to the GUI → `store.svelte.ts` reads it into state → `buildView()` passes it to `ConductorView`.

After this slice, the full cache-aware folding feature is live end-to-end.

**PRD decisions implemented**: DEC-002, DEC-004, DEC-008

**User stories covered**: 1, 2, 10

## Implementation map

### Area: pi internal — `after_provider_response` emit

- **Decision IDs**: DEC-002, DEC-004, DEC-005
- **Current code anchors**: The `before_provider_request` emit exists in pi's provider call path. Pattern is mirrored in `extension/payload-audit.ts` install() (~line 55) which listens via `(pi as unknown as { on }).on("before_provider_request", handler)`.
- **Existing behavior**: Pi emits `before_provider_request` with `{ payload }` before every LLM call. No post-response hook exists.
- **Required edits**: Add a symmetric `emit("after_provider_response", { response: rawResponseBody })` in pi's provider call path, after the response is received. The `response` should include the full `usage` object. Per DEC-004, use the same undocumented internal event API.
- **Wiring/build notes**: No new dependencies. Same `api.on?.(eventName, handler)` pattern.

### Area: `accordion.ts` — wire transport

- **Decision IDs**: DEC-008
- **Current code anchors**:
  - `harnessFrame()` (~line 356) — returns `{ totalTokens, systemPromptTokens, actualWireTokens, messagesTokens, toolsTokens, systemPayloadTokens }`
  - Five `send(ws, { ..., harness: harnessFrame() })` call sites (~lines 559, 607, 706, 778, 818)
  - `applyModel()` (~line 314) — stores full model object as `latestModel: any`, `latestModel.provider` is accessible
  - `session_shutdown` (~line 1220) — cleanup hook
  - `payloadAudit.install(pi)` call (~line 1350) — pattern for installing modules
- **Existing behavior**: `harnessFrame()` builds a diagnostic payload. No cache data flows to the GUI.
- **Required edits**:
  1. Import `cache-tracker` module (from Slice 2).
  2. Call `cacheTracker.install(pi, () => latestModel?.provider, getBlocks, getHarness, getCalibration)` alongside `payloadAudit.install(pi)` (~line 1350). `getBlocks`, `getHarness`, `getCalibration` are closures reading current session state.
  3. Extend `harnessFrame()` return type and include `frozenFromIndex`:
     ```ts
     // decision artifact (illustrative)
     function harnessFrame() {
       const wire = payloadAudit.getLatestSizes();
       const frozen = cacheTracker.getFrozenFromIndex();
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
  4. Call `cacheTracker.reset()` in `session_shutdown` (~line 1230).
  5. All five `send()` calls already pass `harness: harnessFrame()` — no changes needed.
- **Wiring/build notes**: `cacheTracker.install()` must be called after `payloadAudit.install()` since it reads `getLatestSizes()` for harness estimates.

### Area: `protocol.ts` — wire protocol

- **Decision IDs**: DEC-008
- **Current code anchors**: `app/src/lib/live/protocol.ts` — `SyncMessage` interface (~line 130). Harness type is inline.
- **Existing behavior**: Harness carries `totalTokens`, `systemPromptTokens`, and four wire-size fields.
- **Required edits**: Add `frozenFromIndex?: number | null` to the harness shape:
  ```ts
  // decision artifact (normative)
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
- **Wiring/build notes**: Optional field, backward-compatible. No protocol version bump needed.

### Area: `store.svelte.ts` — consumption of real data

- **Decision IDs**: DEC-001, DEC-008
- **Current code anchors**:
  - `setHarnessBreakdown()` — receives harness data from sync, stores as state
  - `buildView()` (~line 1007) — already passes `frozenFromIndex` from Slice 1 (defaulting to `0`)
- **Existing behavior** (after Slice 1): `frozenFromIndex` state exists but is always `0`. `buildView` passes it through.
- **Required edits**:
  1. In `setHarnessBreakdown()`, read `harness.frozenFromIndex` and store it in the reactive state added by Slice 1. When absent/null, default to `0`.
  2. No changes to `buildView()` — it already reads the state (from Slice 1).
- **Wiring/build notes**: This is the integration seam between Slice 1 (contract/enforcement) and Slice 2 (data source). After this edit, real cache data from the provider flows all the way to the conductor.

### Global Build & Wiring Notes

- **pi internal emit**: The `after_provider_response` emit must be added in pi's provider call path. This is outside the accordion repo. If pi source is accessible in the same workspace, add it there. Otherwise coordinate with pi maintainer.
- **Wire protocol versioning**: `PROTOCOL_VERSION` does not need a bump — `frozenFromIndex` is optional.

## Acceptance criteria

- [ ] `after_provider_response` event is emitted by pi after every LLM provider call.
  Run: Add a temporary `console.log` in `cache-tracker.ts`'s handler, make a model call, check extension output. Expected: handler fires with `event.response` containing `usage` object.

- [ ] `cache-tracker.ts` is installed in `accordion.ts` alongside `payloadAudit.install()`.
  Run: `grep -n 'cacheTracker' extension/accordion.ts`. Expected: at least 3 matches — import, install() call, reset() call.

- [ ] `harnessFrame()` includes `frozenFromIndex` field from `cacheTracker.getFrozenFromIndex()`.
  Run: `grep -n 'frozenFromIndex' extension/accordion.ts`. Expected: match inside `harnessFrame()` return object.

- [ ] `SyncMessage.harness` type in `protocol.ts` includes `frozenFromIndex?: number | null`.
  Run: `grep -n 'frozenFromIndex' app/src/lib/live/protocol.ts`. Expected: one match in the harness type.

- [ ] `setHarnessBreakdown()` in `store.svelte.ts` reads `frozenFromIndex` from the harness frame and stores it.
  Run: `grep -n 'frozenFromIndex' app/src/lib/engine/store.svelte.ts`. Expected: at least 3 matches — state declaration (from Slice 1), setHarnessBreakdown read (new), buildView passthrough (from Slice 1).

- [ ] `cacheTracker.reset()` is called in `session_shutdown` hook.
  Run: `grep -n 'cacheTracker.reset' extension/accordion.ts`. Expected: one match inside the `session_shutdown` handler.

- [ ] After an Anthropic model call, `frozenFromIndex` in the next `ConductorView` is > 0 (real cache data flows through).
  Run: `npx vitest run app/src/lib/engine/conductor.test.ts`. Expected: all existing tests still pass (frozenFromIndex = 0 default is unchanged for tests that don't set it). Manual verification: in a live session with Anthropic, confirm `frozenFromIndex` is non-zero after the second turn.

- [ ] TypeScript compiles with no errors across all affected files.
  Run: `npx tsc --noEmit`. Expected: exit code 0.

- [ ] All existing tests pass (no regression).
  Run: `npx vitest run app/src/lib/engine/`. Expected: all tests pass.

## Blocked by

- Slice 001 — Contract + Host Enforcement + Conductor Adaptation (provides `frozenFromIndex` on `ConductorView`, clamp logic, and store state)
- Slice 002 — Cache Tracker Module (provides `extractCacheMetrics`, `computeFrozenFromIndex`, `getFrozenFromIndex`, `install`, `reset`)
