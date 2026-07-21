# Grounding — PCC Store Guard

## GROUND-001 — `substOne()` guard chain
- Source: `extensions/accordion/app/src/lib/engine/store.svelte.ts` → `substOne()`
- Existing behavior: Ordered guard chain refuses fold/replace for: `unknown-id`, `human-override`, `grouped`, `protected`, `frozen` (bypassable via `breakFrozen + hardContextPressure`), `not-foldable` (`wireFoldable` gate). No PCC awareness exists.
- Current excerpt (guard chain):
  ```ts
  if (!b) → clamp "unknown-id"
  if (b.override !== null) → clamp "human-override"
  if (this.groupWire.has(id)) → clamp "grouped"
  if (this.isProtected(b)) → clamp "protected"
  if (b.order < this.frozenFromIndex && (!breakFrozen || !this.hasHardContextPressure())) → clamp "frozen"
  if (!wireFoldable(b)) → clamp "not-foldable"
  ```
- Test prior art: `extensions/accordion/app/src/lib/engine/store.foldgate.test.ts` → all `describe("conductor path — substOne kind gate")` tests

## GROUND-002 — `ViewBlock` type (conductor contract)
- Source: `extensions/accordion/conductors/contract/conductor.ts` → `ViewBlock` (lines 57–74)
- Existing behavior: Exposes `held`, `folded`, `protected`, `grouped` booleans plus `tokens`, `foldedTokens`, `text`, `preview`. No `proactivelyCompressed` field.
- Current excerpt:
  ```ts
  export interface ViewBlock {
      id: string; messageKey?: string; kind: ConductorBlockKind;
      turn: number; order: number; tokens: number; foldedTokens: number;
      toolName?: string; callId?: string; isError?: boolean;
      held: boolean; folded: boolean; protected: boolean; grouped: boolean;
      text?: string; preview?: string;
  }
  ```
- Test prior art: `store.foldgate.test.ts` → `describe("ConductorView.foldedTokens is honest")`

## GROUND-003 — `ClampReason` union
- Source: `extensions/accordion/conductors/contract/conductor.ts` → `ClampReason` (lines 257–274)
- Existing behavior: `"unknown-id" | "human-override" | "grouped" | "invalid-group" | "protected" | "frozen" | "not-foldable" | "noop"`. No PCC-specific reason.
- Test prior art: `store.foldgate.test.ts` → clamp reason assertions throughout

## GROUND-004 — `Block` type (engine)
- Source: `extensions/accordion/app/src/lib/engine/types.ts` → `Block` (lines 34–75)
- Existing behavior: Mutable fields: `override`, `autoFolded`, `by`, `subst`. No `proactivelyCompressed` field.
- Test prior art: `store.foldgate.test.ts`

## GROUND-005 — `wireFoldable()` (engine digest)
- Source: `extensions/accordion/app/src/lib/engine/digest.ts` → `wireFoldable()` (lines 51–56)
- Existing behavior: `FOLDABLE_KINDS = Set { "text", "thinking", "tool_result" }`. Pure kind-only gate. PCC `tool_result` blocks pass this gate.
- Test prior art: `store.foldgate.test.ts` → `describe("fold() — manual kind gate")`

## GROUND-006 — `proactive-compress.ts` (PCC origin)
- Source: `extensions/accordion/extension/proactive-compress.ts` → `handleBeforeProviderRequest()`
- Existing behavior: Compresses `tool_result` messages above `MIN_TOKEN_THRESHOLD` (300 tokens). Stores originals in `Map<code, string>`. Output format: `"<first 8 lines>...\n[N lines, ~T tokens. Full output: recall("code")]"`. No metadata flag set on the compressed message — detection relies on regex matching the output format.
- Test prior art: `extensions/accordion/extension/proactive-compress.test.ts` → `describe("proactive compression")`

## GROUND-007 — `my-customize-conductor` PCC handling
- Source: `extensions/accordion/conductors/my-customize-conductor/my-customize-conductor.ts`
- Existing behavior:
  - Line 45: `PROACTIVE_COMPRESS_MARKER` regex for detection
  - Line 135: `candidates` filter excludes PCC blocks from normal fold path ✓
  - Line 233: `breakFrozen` path uses `allCandidates` — NO PCC guard ✗
  - Line 266: `groupRuns` operates on `view.blocks` — NO PCC guard ✗
  - Line 68: `isGroupBoundary` does not check PCC ✗
- Test prior art: `extensions/accordion/app/src/lib/engine/conductor.my-customize-conductor.test.ts` → `it("skips proactively-compressed tool results as fold candidates")`

## GROUND-008 — `linearize()` (block creation)
- Source: `extensions/accordion/app/src/lib/live/mapping.ts` → `linearize()` (lines ~148–185)
- Existing behavior: Creates `WireBlock` from `PiMessage`. Maps `role/content → kind/text`, `toolName`, `callId`, `isError`. No metadata passthrough for arbitrary message fields.
- Test prior art: none specific to linearize

## GROUND-009 — `buildView()` (store → conductor view)
- Source: `extensions/accordion/app/src/lib/engine/store.svelte.ts` → `buildView()` (lines ~1020–1050)
- Existing behavior: Maps `Block` → `ViewBlock`. Sets `held: b.override !== null`, `protected: i >= protectedFrom`, `grouped: this.groupWire.has(b.id)`. No `proactivelyCompressed` mapping.
- Test prior art: `store.foldgate.test.ts` → `describe("ConductorView.foldedTokens is honest")`

## GROUND-010 — Dashboard badge rendering (Inspector)
- Source: `extensions/accordion/app/src/lib/ui/map/Inspector.svelte` (lines 256–265)
- Existing behavior: Renders `pill-warn folded` and `pill-ok live` status pills. `pill-accent protected` badge for protected blocks. No PCC-specific badge.
- Current excerpt:
  ```html
  {#if folded}
    <span class="pill pill-warn"><span class="pill-dot"></span>folded</span>
  {:else}
    <span class="pill pill-ok"><span class="pill-dot"></span>live</span>
  {/if}
  {#if protect}
    <span class="pill pill-accent" title="In the protected working tail — never folded">
      <Icon name="lock" />protected
    </span>
  {/if}
  ```
- Test prior art: none (Svelte component, visual)

## GROUND-011 — `TileSpec` and tile visual states
- Source: `extensions/accordion/app/src/lib/ui/map/tileDraw.ts` → `TileSpec` (lines 21–43)
- Existing behavior: `TileSpec` has `folded: boolean` and `pinned: boolean`. `folded` → diagonal hatch + desaturated fill. No PCC visual state.
- Test prior art: none (canvas rendering)

## GROUND-012 — Canonical conductor fold-candidate filter
- Source: all conductors (builtin, my-customize-conductor, keel, cold-score, etc.)
- Existing behavior: Universal pattern: `.filter((b) => !b.held && !b.protected && !b.grouped && b.foldedTokens < b.tokens)`. Adding `proactivelyCompressed` to `ViewBlock` makes all conductors aware without code changes (store enforcement handles it).
