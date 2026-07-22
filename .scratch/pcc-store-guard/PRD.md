# PRD — PCC Store-Level Guard & Dashboard Badge

Status: ready-for-agent

## Problem Statement

When Proactive Content Compression (PCC) compresses a large `tool_result` block into a compact recall stub, the compressed block is protected from individual conductor folding only by a regex check inside `my-customize-conductor`. Once the block exits the protected tail, two gaps allow the conductor to touch it:

1. The `breakFrozen` emergency path filters from `allCandidates` which has no PCC guard.
2. The `groupRuns` logic operates on `view.blocks` without PCC awareness, sweeping compressed stubs into groups whose digest replaces the stub — a useless double-compression that busts the provider's KV cache prefix.

Other conductors (builtin and any future ones) have zero PCC awareness.

Additionally, dashboard users have no visual indicator that a block was compressed by PCC, leading to confusion about why a block appears smaller than expected.

**Affected actors:** Agent sessions using Accordion with `my-customize-conductor` or any conductor; dashboard users observing folding state via the Global Accordion Dashboard or Accordion Browser Broker.

## Solution

1. Add a `proactivelyCompressed` flag to `Block` and `ViewBlock`, set at the PCC origin (`proactive-compress.ts`) and propagated through the linearizer and store to the conductor view.
2. Enforce at the store level (`substOne`) that PCC blocks cannot be individually folded, replaced, or breakFrozen-folded — matching the same pattern used for `held` and `protected` blocks. PCC blocks **can** be grouped and collapse into group digests normally.
3. Show a "PCC" badge on compressed blocks in the dashboard Inspector, using the same visual treatment as the existing fold/protected badges. The badge is visible both on standalone PCC blocks and when inspecting expanded group members.

## User Stories

- `US-001`: As a **conductor author**, I want PCC-compressed blocks to carry a `proactivelyCompressed` flag on `ViewBlock`, so that I can see which blocks were already compressed without relying on fragile regex matching.

- `US-002`: As an **agent session**, I want the store to refuse individual fold/replace/breakFrozen commands on PCC-compressed blocks, so that already-compressed stubs are never double-folded, preserving the provider KV cache prefix.

- `US-003`: As a **dashboard user**, I want to see a "PCC" badge on proactively compressed blocks in the Inspector panel, so that I can distinguish PCC compression from conductor folding.

## Walking Skeleton

`US-002` — the thinnest end-to-end path that must ship as one issue before any refinement. Its acceptance criterion runs the full user-visible flow via real wiring: a PCC-compressed message flows through `linearize()` and `buildView()`, `my-customize-conductor` emits a fold on the resulting block, and `substOne()` clamps the command with reason `"proactively-compressed"` — proving the flag propagates and the store guard fires against real conductor output, not a stub.

## Required Behaviors

- `RB-001`: A `tool_result` block compressed by PCC must have `proactivelyCompressed: true` on both `Block` (engine) and `ViewBlock` (conductor contract). Uncompressed blocks must have `proactivelyCompressed: false`.
- `RB-002`: `substOne()` must refuse fold and replace commands on PCC blocks with clamp reason `"proactively-compressed"`, regardless of `breakFrozen`. The refusal is absolute — no bypass path.
- `RB-003`: PCC blocks may be members of groups. When a group containing PCC blocks is folded, PCC members collapse into the group digest like any other member.
- `RB-004`: The dashboard Inspector must display a "PCC" pill badge on proactively compressed blocks, visible both standalone and inside expanded (unfolded) groups.
- `RB-005`: Dashboard interaction with PCC blocks is read-only. Recall of original content remains agent-side only.

## Accepted Decision Register

### DEC-001 — Flag origin at PCC source
- **Decision**: Set `_pccCompressed: true` metadata on the message object in `proactive-compress.ts` when compressing. The linearizer propagates this to `Block.proactivelyCompressed`, and `buildView()` propagates it to `ViewBlock.proactivelyCompressed`.
- **Rationale**: Source-of-truth at compression origin avoids fragile regex detection. The flag is set once and flows downstream.
- **Rejected alternatives**: Detect at linearization time via `PROACTIVE_COMPRESS_MARKER` regex (fragile, couples on marker format; detection duplicated).
- **Downstream impact**: `linearize()` must read `_pccCompressed` from message metadata. `buildView()` must map `Block.proactivelyCompressed` → `ViewBlock.proactivelyCompressed`.
- **Depends on**: None
- **Decided implementation**: `proactive-compress.ts` sets `_pccCompressed: true` on the compressed message object alongside the content replacement. `linearize()` reads `m._pccCompressed` and sets `block.proactivelyCompressed`. `buildView()` maps it to `ViewBlock`.
- **Left to the implementer**: Exact property name on `PiMessage` (suggested `_pccCompressed`); whether to use a symbol or string key.

### DEC-002 — Store-level enforcement (not per-conductor)
- **Decision**: The store's `substOne()` method enforces PCC protection. Conductors do not need PCC awareness — the store refuses the command and reports the clamp.
- **Rationale**: Same pattern as `held`, `protected`, `not-foldable` guards. Prevents any conductor (current or future) from accidentally double-compressing. Stronger guarantee than per-conductor opt-in.
- **Rejected alternatives**: Per-conductor guard (each conductor checks `isProactivelyCompressed`; error-prone, requires every conductor to opt in). View-level informational flag only (conductors can ignore it).
- **Downstream impact**: `ClampReason` union gains `"proactively-compressed"`. `my-customize-conductor` can remove `PROACTIVE_COMPRESS_MARKER` regex and `isProactivelyCompressed()` helper (store now enforces). Existing test `"skips proactively-compressed tool results as fold candidates"` can be supplemented with store-level clamp tests.
- **Depends on**: DEC-001 (flag must exist on `Block`)
- **Decided implementation**: New guard in `substOne()` after `grouped` and before `protected`: `if (b.proactivelyCompressed) → clamp "proactively-compressed"`. Absolute — no `breakFrozen` bypass.
- **Left to the implementer**: Exact guard ordering within `substOne()` (suggested: after `grouped`, before `protected`).

### DEC-003 — PCC blocks can be grouped
- **Decision**: PCC blocks are allowed as group members and collapse into group digests normally. They are NOT group boundaries.
- **Rationale**: PCC blocks should behave as normal blocks for grouping purposes. Treating them as boundaries would create visual gaps in the timeline.
- **Rejected alternatives**: PCC blocks as group boundaries (simpler but creates gaps). PCC blocks as stragglers inside groups (stays live, defeats grouping benefit).
- **Downstream impact**: No change to `createGroup()` or `groupRuns()` for the grouping path itself. The store guard in `substOne()` only blocks individual fold/replace, not group commands.
- **Depends on**: DEC-002 (store enforcement scope)
- **Decided implementation**: No code change required for the grouping path. `substOne()` guard fires only for `fold`/`replace` commands, not `group` commands (group commands go through `createGroup()`, not `substOne()`).
- **Left to the implementer**: None.

### DEC-004 — breakFrozen cannot override PCC protection
- **Decision**: The PCC guard in `substOne()` is absolute. `breakFrozen: true` does not bypass it.
- **Rationale**: A PCC stub is ~50 tokens. Folding it saves ~20–30 tokens — negligible in a hard overflow. Folding it loses the recall code, destroying the agent's ability to recover original content. In overflow scenarios, raw (non-PCC) blocks offer hundreds or thousands of tokens of savings each.
- **Rejected alternatives**: Allow `breakFrozen` to override PCC (negligible savings, loses recall code).
- **Downstream impact**: The `breakFrozen` path in `my-customize-conductor` (line 233, `allCandidates` filter) becomes a non-issue — even if the conductor emits a `breakFrozen` fold on a PCC block, the store refuses it.
- **Depends on**: DEC-002
- **Decided implementation**: `substOne()` places the PCC guard before the `frozen` guard, so PCC blocks are refused before `breakFrozen` is even evaluated.
- **Left to the implementer**: None.

### DEC-005 — Dashboard "PCC" badge
- **Decision**: The Inspector panel shows a "PCC" pill badge on proactively compressed blocks, using the same visual style as existing `folded`/`protected` pills. Badge is visible on standalone PCC blocks and inside expanded group member lists.
- **Rationale**: Users need to distinguish PCC compression (transport-layer, automatic) from conductor folding (strategy-driven). Without this, a compressed block looks confusingly small with no explanation.
- **Rejected alternatives**: Tooltip only (too hidden). Distinct background color (too heavy for a metadata indicator). No indicator (causes user confusion).
- **Downstream impact**: `Inspector.svelte` gains a new conditional pill. `TileSpec` may optionally gain a `pcc` field for canvas tile visual differentiation.
- **Depends on**: DEC-001 (flag must flow to the view)
- **Decided implementation**: `Inspector.svelte` reads `block.proactivelyCompressed` (or the store-mapped equivalent) and renders `<span class="pill pill-info">PCC</span>`. The pill appears alongside existing `folded`/`live`/`protected` pills.
- **Left to the implementer**: Exact pill color class (`pill-info` suggested). Whether to also add a PCC visual cue to `TileSpec`/canvas tiles.

### DEC-006 — Dashboard is read-only for PCC blocks
- **Decision**: The dashboard displays PCC block state but does not allow expanding or recalling original content. Recall remains agent-side only via the `recall` tool.
- **Rationale**: The `originals` map lives in-process in the extension. Exposing it over the Broker WebSocket would add API surface for minimal benefit. The agent already has the recall mechanism.
- **Rejected alternatives**: Dashboard inline expansion via Broker API (adds complexity, exposes internal state over WebSocket).
- **Downstream impact**: Inspector fold/unfold controls are disabled or hidden for PCC blocks. No new Broker API surface introduced. No other UI components affected.
- **Depends on**: None
- **Decided implementation**: No new Broker API. Inspector fold/unfold buttons are disabled or hidden for PCC blocks.
- **Left to the implementer**: Whether to disable or fully hide fold/unfold controls on PCC blocks.

## Implementation Plan

### Area: Proactive Content Compression — Flag Origin

- **Coverage**: DEC-001, US-001, RB-001
- **Contract**: When `handleBeforeProviderRequest` compresses a message, the returned message object must include `_pccCompressed: true`.
- **Decision constraints**: DEC-001 — flag set at compression origin only.
- **Code anchors**: `extensions/accordion/extension/proactive-compress.ts` → `handleBeforeProviderRequest()`, line `return { ...message, content: compress(message.content, code) }`
- **Existing behavior**: Returns `{ ...message, content: compress(...) }` with no metadata flag.
- **Required edits**: Add `_pccCompressed: true` to the spread: `return { ...message, content: compress(message.content, code), _pccCompressed: true }`.
- **Test seam**: `extensions/accordion/extension/proactive-compress.test.ts` → `describe("proactive compression")`. Add assertion: compressed message has `_pccCompressed: true`; uncompressed messages do not.
- **Wiring**: None — existing hook registration unchanged.
- **Grounding evidence**: GROUND-006

### Area: Engine Types — Block & ViewBlock

- **Coverage**: DEC-001, DEC-002, US-001, RB-001
- **Contract**:
  ```ts
  // Block (engine)
  proactivelyCompressed: boolean;  // default false

  // ViewBlock (conductor contract)
  proactivelyCompressed: boolean;

  // ClampReason (conductor contract)
  "proactively-compressed"  // new union member
  ```
- **Decision constraints**: DEC-001, DEC-002
- **Code anchors**:
  - `extensions/accordion/app/src/lib/engine/types.ts` → `Block` interface (line 34)
  - `extensions/accordion/conductors/contract/conductor.ts` → `ViewBlock` interface (line 57), `ClampReason` type (line 257)
- **Existing behavior**: Neither type has a `proactivelyCompressed` field. `ClampReason` has no PCC variant.
- **Required edits**:
  - Add `proactivelyCompressed: boolean` to `Block` interface (default `false` in block creation).
  - Add `proactivelyCompressed: boolean` to `ViewBlock` interface.
  - Add `"proactively-compressed"` to `ClampReason` union.
- **Test seam**: `store.foldgate.test.ts` — new tests for PCC clamp behavior.
- **Wiring**: None.
- **Grounding evidence**: GROUND-002, GROUND-003, GROUND-004

### Area: Linearizer — Flag Propagation

- **Coverage**: DEC-001, US-001, RB-001
- **Contract**: `linearize()` reads `_pccCompressed` from the source message and sets `proactivelyCompressed: true` on the output `WireBlock`/`Block`.
- **Decision constraints**: DEC-001 — metadata passthrough from message to block.
- **Code anchors**: `extensions/accordion/app/src/lib/live/mapping.ts` → `linearize()` (lines ~148–185), `push()` helper
- **Existing behavior**: `push()` spreads `extra` fields into the block. `_pccCompressed` is not read from messages.
- **Required edits**: In the `case "toolResult"` branch of `linearize()`, read `m._pccCompressed` and include `proactivelyCompressed: !!m._pccCompressed` in the block. Alternatively, add to `push()` helper: `proactivelyCompressed: !!(extra as any)._pccCompressed || false`.
- **Test seam**: Add unit test for `linearize()` with a message carrying `_pccCompressed: true` → output block has `proactivelyCompressed: true`.
- **Wiring**: None.
- **Grounding evidence**: GROUND-008

### Area: Store — `buildView()` Propagation

- **Coverage**: DEC-001, US-001, RB-001
- **Contract**: `buildView()` maps `Block.proactivelyCompressed` → `ViewBlock.proactivelyCompressed`.
- **Decision constraints**: DEC-001
- **Code anchors**: `extensions/accordion/app/src/lib/engine/store.svelte.ts` → `buildView()` (lines ~1020–1050)
- **Existing behavior**: Maps `held`, `protected`, `grouped`, `folded`, `foldedTokens`. No `proactivelyCompressed`.
- **Required edits**: Add `proactivelyCompressed: b.proactivelyCompressed` to the `ViewBlock` object literal in `buildView()`.
- **Test seam**: `store.foldgate.test.ts` — assert `ViewBlock.proactivelyCompressed` reflects `Block.proactivelyCompressed`.
- **Wiring**: None.
- **Grounding evidence**: GROUND-009

### Area: Store — `substOne()` Guard

- **Coverage**: DEC-002, DEC-003, DEC-004, US-002, RB-002, RB-003
- **Contract**: `substOne()` refuses fold/replace on PCC blocks with `ClampReason "proactively-compressed"`. Guard is absolute (no `breakFrozen` bypass). Group commands are unaffected (they go through `createGroup()`, not `substOne()`).
- **Decision constraints**: DEC-002 (store enforcement), DEC-003 (grouping allowed), DEC-004 (no breakFrozen bypass)
- **Code anchors**: `extensions/accordion/app/src/lib/engine/store.svelte.ts` → `substOne()` (line 1102)
- **Existing behavior**: Guard chain: `unknown-id → human-override → grouped → protected → frozen → not-foldable`. No PCC guard.
- **Required edits**: Add after the `grouped` guard:
  ```ts
  if (b.proactivelyCompressed) {
      reports.push({ id, reason: "proactively-compressed", message: `${label} was proactively compressed — recall-only` });
      return;
  }
  ```
- **Normative snippet**: The guard must fire before `protected` and `frozen` so that PCC blocks are refused regardless of protection or frozen state.
- **Test seam**: `store.foldgate.test.ts` — new `describe("conductor path — PCC guard")` with tests:
  - `a conductor 'fold' of a PCC block is clamped 'proactively-compressed' and not folded`
  - `a conductor 'replace' of a PCC block is clamped 'proactively-compressed' and not folded`
  - `a conductor 'fold' with breakFrozen of a PCC block is still clamped (no bypass)`
  - `a PCC block inside a group collapses normally (no clamp)`
- **Wiring**: None.
- **Grounding evidence**: GROUND-001, GROUND-007

### Area: my-customize-conductor — Cleanup

- **Coverage**: DEC-002, US-002
- **Contract**: Remove `PROACTIVE_COMPRESS_MARKER` regex and `isProactivelyCompressed()` helper. The store now enforces PCC protection; conductor-side detection is redundant.
- **Decision constraints**: DEC-002 — store enforcement replaces per-conductor guard.
- **Code anchors**: `extensions/accordion/conductors/my-customize-conductor/my-customize-conductor.ts` → line 45 (`PROACTIVE_COMPRESS_MARKER`), line 135 (candidates filter), line 335 (`isProactivelyCompressed`)
- **Existing behavior**: `candidates` filter uses `!isProactivelyCompressed(b)` to exclude PCC blocks from fold candidates.
- **Required edits**:
  - Remove `PROACTIVE_COMPRESS_MARKER` const (line 45).
  - Remove `isProactivelyCompressed()` function (lines 334–336).
  - Remove `&& !isProactivelyCompressed(b)` from candidates filter (line 135). The store guard now handles this; any fold command targeting a PCC block will be clamped.
  - Optionally: add `!b.proactivelyCompressed` to the candidates filter as a performance optimization (avoids emitting commands that the store will clamp). Left to implementer.
- **Test seam**: `conductor.my-customize-conductor.test.ts` → existing test `"skips proactively-compressed tool results as fold candidates"` should be updated to set `proactivelyCompressed: true` on the `ViewBlock` fixture instead of relying on marker text.
- **Wiring**: None.
- **Grounding evidence**: GROUND-007

### Area: Dashboard — Inspector "PCC" Badge

- **Coverage**: DEC-005, DEC-006, US-003, RB-004, RB-005
- **Contract**: Inspector renders a "PCC" pill badge for blocks with `proactivelyCompressed === true`. Badge visible standalone and inside expanded groups. Fold/unfold controls disabled for PCC blocks.
- **Decision constraints**: DEC-005 (badge), DEC-006 (read-only)
- **Code anchors**: `extensions/accordion/app/src/lib/ui/map/Inspector.svelte` (lines 256–265)
- **Existing behavior**: Renders `pill-warn folded` / `pill-ok live` / `pill-accent protected`. No PCC badge.
- **Required edits**: Add after the `protected` pill:
  ```svelte
  {#if block.proactivelyCompressed}
    <span class="pill pill-info" title="Proactively compressed — original available via agent recall">PCC</span>
  {/if}
  ```
  Conditionally disable fold/unfold buttons when `block.proactivelyCompressed`.
- **Test seam**: Visual / manual. Optionally add a Svelte component test asserting the pill renders when `proactivelyCompressed: true`.
- **Wiring**: `proactivelyCompressed` must flow from the store's block to the Inspector's reactive `block` binding. Verify the store→component data path includes the new field.
- **Grounding evidence**: GROUND-010, GROUND-011

## Global Build & Wiring Notes

- The `proactivelyCompressed` flag flows through four layers: `proactive-compress.ts` (message metadata) → `mapping.ts` (linearize to Block) → `store.svelte.ts` (buildView to ViewBlock) → UI components. Each layer reads from its upstream; no cross-cutting registration or DI needed.
- The `ClampReason` union change in `conductor.ts` is a contract-level type change visible to all conductors. No runtime registration — it is a TypeScript union extension.
- No migration, database, or build changes required.

## Testing Decisions

| Seam | Behavior covered | Prior art | Command | Expected result |
|---|---|---|---|---|
| `proactive-compress.test.ts` | PCC sets `_pccCompressed: true` on compressed messages | `describe("proactive compression")` | Existing test runner | New test: compressed message has flag; uncompressed does not |
| `store.foldgate.test.ts` | Store refuses fold/replace/breakFrozen on PCC blocks; allows grouping | `describe("conductor path — substOne kind gate")` | Existing test runner | New `describe("conductor path — PCC guard")`: 4 cases for clamp + 1 for group pass-through |
| `conductor.my-customize-conductor.test.ts` | Conductor test fixtures use `proactivelyCompressed` flag instead of marker text | `it("skips proactively-compressed...")` | Existing test runner | Updated fixture uses `proactivelyCompressed: true`; test still passes |
| Inspector component test | "PCC" badge renders; fold/unfold disabled; pin remains enabled | Svelte component test infrastructure (vitest + @testing-library/svelte) | Component test runner | Pill DOM present when `proactivelyCompressed`; fold/unfold buttons carry `disabled`; pin unaffected |
| Inspector visual smoke (HITL) | Badge styling matches existing pills; group expansion shows PCC members | None | Manual browser check | Human confirms styling and group-member behavior |

## Out of Scope

- **Recall expansion in dashboard**: The dashboard remains read-only for PCC blocks. No Broker API for serving original content.
- **Canvas tile PCC visual**: Whether to add a PCC cue to `TileSpec` / canvas tiles is left to the implementer as optional polish. The PRD requires only the Inspector pill.
- **Builtin conductor changes**: The builtin conductor has no PCC awareness and needs none — the store guard handles it.
- **`poteto-mode` interaction**: PCC blocks and poteto-mode pstack blocks are independent concerns. No change to poteto-mode logic.
- **A1 Exemption List changes**: The exemption list (which tools PCC skips) is unchanged.

## Unresolved Gaps

None.

## Further Notes

- Grounding file: `.scratch/pcc-store-guard/grounding.md`
- Governing ADRs: ADR-0002 (Authoritative Accordion Folding Runtime), ADR-0003 (Proactive Content Compression). This change **strengthens** ADR-0003's intent: the conductor's scope was deliberately narrowed so PCC blocks are the transport layer's domain. Store-level enforcement makes that boundary durable.
- CONTEXT.md vocabulary used: Proactive Content Compression, A1 Exemption List, Frozen-Prefix Deadlock, Authoritative Accordion Folding Runtime, Warm Folding Calculation, my-customize-conductor, Global Accordion Dashboard, Accordion Browser Broker.
