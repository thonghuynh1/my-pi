---
status: closed
---

Status: ready-for-agent

## Parent

`.scratch/pcc-store-guard/PRD.md`

## What to build

Enabling issue for the walking skeleton. The `proactivelyCompressed` flag pipeline: when Proactive Content Compression compresses a `tool_result`, the flag flows from the message through linearization into `Block`, through `buildView()` into `ViewBlock`, and the `ClampReason` union gains `"proactively-compressed"`. This exists so `01-pcc-store-refuses-double-fold.md` can prove end-to-end refusal.

**Covers:** US-001, DEC-001, RB-001

**Next tracer-bullet consumer:** `01-pcc-store-refuses-double-fold.md`.

## Implementation map

### 1. `proactive-compress.ts` — set flag at origin

- **File**: `extensions/accordion/extension/proactive-compress.ts`
- **Symbol**: `handleBeforeProviderRequest()` → line 72
- **Existing**: `return { ...message, content: compress(message.content, code) };`
- **Edit**:
  ```ts
  return { ...message, content: compress(message.content, code), _pccCompressed: true };
  ```

### 2. `types.ts` — add field to `Block`

- **File**: `extensions/accordion/app/src/lib/engine/types.ts`
- **Symbol**: `Block` interface (line 34)
- **Edit**: add `proactivelyCompressed: boolean;`. Default `false` at all block creation sites.

### 3. `conductor.ts` — add field to `ViewBlock` and extend `ClampReason`

- **File**: `extensions/accordion/conductors/contract/conductor.ts`
- **Symbol**: `ViewBlock` interface (line 57), `ClampReason` type (line 292)
- **Edit**: add `proactivelyCompressed: boolean;` to `ViewBlock`; add `| "proactively-compressed"` to `ClampReason`.

### 4. `mapping.ts` — propagate in linearizer

- **File**: `extensions/accordion/app/src/lib/live/mapping.ts`
- **Symbol**: `linearize()` (line 154), `push()` helper (line 159), `case "toolResult":` (line 195)
- **Edit**: in `case "toolResult":`, include `proactivelyCompressed: !!m._pccCompressed` in the extra passed to `push()`. Non-toolResult branches default to `false`.

### 5. `store.svelte.ts` — propagate in `buildView()`

- **File**: `extensions/accordion/app/src/lib/engine/store.svelte.ts`
- **Symbol**: `buildView()` (line 1018)
- **Edit**: add `proactivelyCompressed: b.proactivelyCompressed` to the `ViewBlock` object literal.

### Grounding evidence

GROUND-002, GROUND-003, GROUND-004, GROUND-006, GROUND-008, GROUND-009

## Acceptance criteria

- [ ] Compressed message carries `_pccCompressed: true`
  - Run: `pnpm --filter accordion-extension test -- proactive-compress.test.ts`
  - Expected: new test `"sets _pccCompressed on compressed messages"` passes — `result._pccCompressed === true` on compressed output; absent/falsy on skipped messages.

- [ ] `linearize()` propagates the flag from message to block
  - Run: `pnpm --filter accordion-app test -- mapping.test.ts` (or nearest linearizer test file)
  - Expected: a `toolResult` message with `_pccCompressed: true` produces `Block` with `proactivelyCompressed === true`; a normal message produces `false`.

- [ ] `buildView()` propagates the flag from `Block` to `ViewBlock`
  - Run: `pnpm --filter accordion-app test -- store.foldgate.test.ts`
  - Expected: new test `"ViewBlock.proactivelyCompressed reflects Block"` passes — PCC block yields `ViewBlock.proactivelyCompressed === true`; normal block yields `false`.

## Blocked by

None.
