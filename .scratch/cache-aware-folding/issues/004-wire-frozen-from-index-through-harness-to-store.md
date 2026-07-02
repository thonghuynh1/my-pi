---
id: "004"
title: "Wire frozenFromIndex through harness frame to store"
labels: [ready-for-agent]
depends_on: ["003"]
status: open
---

## What to build

Thread the heuristic `frozenFromIndex` from `cache-tracker.ts` through the harness frame, across the WebSocket wire protocol, into the GUI store. After this slice, `frozenFromIndex` is driven by real heuristic data and the already-landed host clamp activates on live sessions.

**PRD decisions implemented**: DEC-001, DEC-012, DEC-013

**User stories covered**: 1, 2, 3, 4, 7, 8

## Implementation map

### Area: `accordion.ts` — include frozenFromIndex in harnessFrame

- **Decision IDs**: DEC-012
- **Current code anchors**:
  - `vendor/accordion/extension/accordion.ts` — `harnessFrame()` (line ~548)
- **Existing behavior**: `harnessFrame()` returns token diagnostics only. No `frozenFromIndex` field.
- **Required edits**:
  1. Read `cacheTracker.getFrozenFromIndex()` inside `harnessFrame()` and include it in the return object. (DEC-012)
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
- **Tests to extend**: No direct unit test for `harnessFrame()`. Verified through downstream ingest.
- **Wiring/build notes**: All five `send()` call sites already pass `harness: harnessFrame()`. The new field propagates automatically.

### Area: `protocol.ts` — wire protocol type

- **Decision IDs**: DEC-012
- **Current code anchors**:
  - `vendor/accordion/app/src/lib/live/protocol.ts` — `SyncMessage.harness`
- **Existing behavior**: Harness carries `totalTokens`, `systemPromptTokens`, and four wire-size fields. No `frozenFromIndex`.
- **Required edits**:
  1. Add `frozenFromIndex?: number | null` to the harness shape in `SyncMessage`. (DEC-012)
- **Snippet(s)**:
  - `decision artifact` (normative).
    ```ts
    harness?: {
      totalTokens: number | null;
      systemPromptTokens: number | null;
      actualWireTokens?: number | null;
      messagesTokens?: number | null;
      toolsTokens?: number | null;
      systemPayloadTokens?: number | null;
      frozenFromIndex?: number | null;
    };
    ```
- **Tests to extend**: Type-level. No runtime test needed for the addition.
- **Wiring/build notes**: Optional field. Backward-compatible. No protocol version bump.

### Area: `store.svelte.ts` — ingest frozenFromIndex from harness

- **Decision IDs**: DEC-001, DEC-012, DEC-013
- **Current code anchors**:
  - `vendor/accordion/app/src/lib/engine/store.svelte.ts` — `setHarnessBreakdown()` (line ~1187)
  - `vendor/accordion/app/src/lib/engine/store.svelte.ts` — `frozenFromIndex` state (line ~151)
  - `vendor/accordion/app/src/lib/engine/store.svelte.ts` — `buildView()` (line ~1040)
  - `vendor/accordion/app/src/lib/engine/store.svelte.ts` — `substOne()` frozen clamp (line ~1093)
- **Existing behavior**: `frozenFromIndex` state exists and defaults to `0`. `buildView()` passes it to `ConductorView`. `substOne()` clamps frozen blocks. But `setHarnessBreakdown()` ignores `frozenFromIndex` from the harness frame.
- **Required edits**:
  1. Add `frozenFromIndex?: number | null` to `setHarnessBreakdown()` input type. (DEC-012)
  2. Store `h.frozenFromIndex ?? 0` into the reactive `frozenFromIndex` state inside `setHarnessBreakdown()`. (DEC-001, DEC-012)
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
  - Expected: both suites pass.
- **Wiring/build notes**: The existing `frozenFromIndex` state, `buildView()` pass-through, and `substOne()` clamp were all delivered in issue 001. This area only adds the ingest path.

### Global Build & Wiring Notes

- `vendor/accordion` is the implementation target in this workspace.
- No `pi` package changes required.
- Run frontend tests with `npx vitest run <path>`.
- The downstream clamp behavior is already tested. This slice proves the data now flows.

## Acceptance criteria

- [ ] `harnessFrame()` includes `frozenFromIndex` in its return type and reads from `cacheTracker.getFrozenFromIndex()`. Run: `grep -n 'frozenFromIndex' vendor/accordion/extension/accordion.ts`. Expected: match inside `harnessFrame()` return object.
- [ ] `SyncMessage.harness` includes `frozenFromIndex?: number | null`. Run: `grep -n 'frozenFromIndex' vendor/accordion/app/src/lib/live/protocol.ts`. Expected: one match in the harness type.
- [ ] `setHarnessBreakdown()` ingests `h.frozenFromIndex ?? 0` into reactive state. Run: `grep -n 'frozenFromIndex' vendor/accordion/app/src/lib/engine/store.svelte.ts`. Expected: matches for state declaration (line ~151), `setHarnessBreakdown` ingest (new), and `buildView()` pass-through (line ~1040).
- [ ] Existing frozen clamp behavior stays green. Run: `npx vitest run vendor/accordion/app/src/lib/engine/conductor.test.ts`. Expected: all tests pass including the `frozen clamp` test.
- [ ] Existing foldgate frozen behavior stays green. Run: `npx vitest run vendor/accordion/app/src/lib/engine/store.foldgate.test.ts`. Expected: all tests pass including the frozen block rejection test.
- [ ] Integration proof. After issue 003 lands with a non-zero `getFrozenFromIndex()`, this slice carries that value through to `buildView()`. Run: `npx vitest run vendor/accordion/app/src/lib/engine/conductor.test.ts --reporter=verbose`. Expected: `frozen clamp` test uses `frozenFromIndex = 5` and asserts `ClampReport` with `reason: "frozen"`.

## Blocked by

- `003-rewrite-cache-tracker-to-request-side-heuristic.md`
