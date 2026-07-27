# PRD — Pre-group zone reliability

**Status**: `ready-for-agent`
**Grill ledger**: `.scratch/grills/bbe115d8a5dd/ledger.md`

## Problem Statement

The `my-customize-conductor`'s pre-group zone — the token window before the protected tail that accumulates blocks for chunked compaction rollover — has two reliability issues:

1. **Blocks in the pre-group zone still appear folded.** The backward walk that computes the zone stops at group boundaries (`user`, `mcp`, `recall`, pstack blocks). When these appear near the protected tail (the common case), the zone is empty or tiny, and blocks that should be protected from folding are exposed as regular fold candidates.

2. **The rollover fires inconsistently.** Because boundaries fragment the zone, it rarely reaches the 15k target. The broader `selectCompactionRange` fallback groups from `frozenFromIndex` but may overshoot significantly (25k–40k), or not fire at all when conditions aren't met.

Both issues stem from using a single boundary concept (`isChunkedPreGroupBoundary`) for two distinct purposes: controlling how far back the zone extends (accumulation) and controlling which blocks group together (grouping).

## Solution

Decouple the accumulation boundary from the grouping boundary. The pre-group zone walks past `user`, `mcp`, `recall`, and pstack blocks, reliably reaching ~15k tokens regardless of conversation shape. Under budget pressure, the conductor flushes the zone early via an early rollover — grouping whatever it has accumulated — instead of leaving blocks stuck (protected from folding but too fragmented to group).

## User Stories

1. As an agent session managed by `my-customize-conductor`, I want the pre-group zone to accumulate blocks across user/MCP/recall boundaries, so that blocks near the protected tail are never prematurely folded.

2. As an agent session under budget pressure, I want the conductor to flush the pre-group zone early when non-pre-group candidates are exhausted, so that context stays within budget instead of the conductor being stuck with no foldable blocks.

## Walking Skeleton

`US-001` — Relax the accumulation boundary so the pre-group zone crosses `user`/`mcp`/`recall`/pstack blocks. Acceptance: a view where a `user` block sits between tool results before the protected tail produces a pre-group zone that includes all of them; none are folded; the rollover fires when the zone reaches the target.

## Required Behaviors

- `RB-001`: The pre-group backward walk must stop only at `held`, `grouped`, or `proactivelyCompressed` blocks. `user`, `mcp`, `recall`, and pstack blocks must not stop the walk.
- `RB-002`: The existing `isGroupBoundary` function must remain unchanged — it governs suffix grouping (`groupRuns`) and group-boundary detection for other purposes.
- `RB-003`: Under budget pressure (`liveTokens > cap` after exhausting non-pre-group candidates), the conductor must attempt an early rollover on the pre-group zone using `selectCompactionRange` and `tryEmitGroup`.
- `RB-004`: The early rollover must respect the existing `minSaving = max(2_000, 0.05 * cap)` guard — groups too small to justify their digest overhead are rejected.
- `RB-005`: `trimOpenToolPairs` must continue to prevent orphaned tool_call/tool_result pairs in groups.
- `RB-006`: The early rollover must increment `rolloverCount` and `tokensSavedByRollover` and call `finishConduct` with `rolloverJustFired = true` — same bookkeeping as the normal rollover.
- `RB-007`: The pre-group restore logic for frozen-prefix blocks must use the new accumulation boundary, not `isChunkedPreGroupBoundary`.

## Accepted Decision Register

### DEC-001 — Decouple accumulation boundary from grouping boundary

- **Decision**: Introduce `isAccumulationBoundary(block)` that returns true only for `held`, `grouped`, or `proactivelyCompressed` blocks. Use it exclusively in the `computePreGroupFromIndex` call. Leave `isGroupBoundary` and `isChunkedPreGroupBoundary` unchanged for their other uses.
- **Rationale**: The pre-group zone exists to protect blocks from premature folding until rollover. Using the same strict boundaries for "don't fold this" and "group these together" conflates two concerns and makes the zone empty in common conversation shapes.
- **Rejected alternatives**: (a) Keep current boundaries but fix only the "newest block is boundary → empty pre-group" edge case — too narrow, doesn't address fragmentation. (b) Make the entire non-frozen suffix the pre-group zone — protects too many blocks, no budget relief.
- **Downstream impact**: The pre-group zone now includes `user`/`mcp`/`recall`/pstack blocks. The zone is larger on average. Under budget pressure, the early rollover (DEC-002) becomes the primary relief mechanism.
- **Depends on**: None
- **Decided implementation**: New `isAccumulationBoundary` function in `my-customize-conductor.ts`. The `computePreGroupFromIndex` call at line 169 passes it instead of `isChunkedPreGroupBoundary`. The `isChunkedPreGroupBoundary` call in `isChunkedPreGroupBoundary` for the restore logic (pre-group frozen restore) also switches to `isAccumulationBoundary`.
- **Left to the implementer**: Whether to keep `isChunkedPreGroupBoundary` (still used by other code paths) or inline it where still needed.

### DEC-002 — Early rollover under budget pressure

- **Decision**: After the main fold loop (line 355) exhausts non-pre-group candidates, if `live > cap` and `preGroupBlocks.length >= 2`, attempt an early rollover: call `selectCompactionRange(view, preGroupFromIndex)` and `tryEmitGroup` on the result. If it succeeds, return via `finishConduct` with `rolloverJustFired = true`.
- **Rationale**: With the relaxed accumulation boundary, most blocks land in the pre-group zone. The conductor needs a way to process them under budget pressure instead of being stuck. The 15k target is a batch-when-comfortable preference; budget pressure overrides it.
- **Rejected alternatives**: (a) Shrink the pre-group zone proportionally under pressure — reintroduces premature folding. (b) Fire after suffix grouping and frozen-prefix breaking — delays the inevitable, adds unnecessary churn.
- **Downstream impact**: The early rollover becomes the primary budget relief mechanism in many sessions. Produces smaller groups (< 15k) under pressure, with proportionally higher digest overhead but always above `minSaving`.
- **Depends on**: DEC-001
- **Decided implementation**: New `if` block in `conduct()` between the main fold loop (line 355) and suffix grouping (line 394). Reuses existing `selectCompactionRange` and `tryEmitGroup`. Increments `rolloverCount` and `tokensSavedByRollover`.
- **Left to the implementer**: Epoch hold cache invalidation after early rollover (existing mechanism should handle it). Status text formatting — whether to distinguish "early rollover" from "normal rollover" in the status line.

### DEC-003 — Grouping non-foldable kinds is safe

- **Decision**: Groups produced by early rollover may contain `user` and `tool_call` blocks. This is safe and requires no additional guards.
- **Rationale**: ADR 0006 explicitly allows groups to include non-foldable kinds. `wireFoldable` (digest.ts:54) blocks individual folds only. `trimOpenToolPairs` prevents orphaned pairs. `selectCompactionRange` trims current-turn blocks. `recall` preserves full access to grouped members. This is the same mechanism the existing 15k rollover uses.
- **Rejected alternatives**: None — restricting groups to foldable kinds would prevent grouping most conversation blocks and defeat the purpose of chunked compaction.
- **Downstream impact**: None — no behavioral change from existing rollover grouping.
- **Depends on**: None
- **Decided implementation**: No code change needed. Existing `selectCompactionRange` already includes these kinds. Existing `tryEmitGroup` already groups them.
- **Left to the implementer**: Nothing.

### DEC-004 — Early rollover insertion point

- **Decision**: Insert the early rollover check after the main fold loop (after line 355, before the suffix grouping gate at line 394).
- **Rationale**: After exhausting non-pre-group fold candidates, the pre-group zone is the natural next source of budget relief. Suffix grouping (line 394) fragments at `isGroupBoundary` and produces tiny groups; the early rollover via `selectCompactionRange` produces a single better group.
- **Rejected alternatives**: Inserting after suffix grouping and frozen-prefix breaking — delays inevitable rollover and adds frozen-prefix churn.
- **Downstream impact**: Suffix grouping and frozen-prefix breaking become fallbacks for edge cases where the early rollover returns null (pre-group too small for `minSaving`).
- **Depends on**: DEC-002
- **Decided implementation**: The new `if` block sits between the end of the `applyCandidate` loop and the `groupRuns` block.
- **Left to the implementer**: Exact placement within the gap between lines 355–394 (after the frozen `applyCandidate` loop, before `groups` array init).

## Implementation Plan

### Area: Accumulation boundary

- **Coverage**: DEC-001, US-001, RB-001, RB-002, RB-007
- **Contract**: `isAccumulationBoundary(block: ViewBlock): boolean` returns true iff `block.held || block.grouped || block.proactivelyCompressed`. Used only for the pre-group backward walk.
- **Decision constraints**: DEC-001 — `isGroupBoundary` and `isChunkedPreGroupBoundary` must remain unchanged for their other uses (suffix grouping, group-boundary detection in `isGroupBoundary`).
- **Code anchors**: `isChunkedPreGroupBoundary` at `my-customize-conductor.ts:51` (GROUND-001); `computePreGroupFromIndex` call at `my-customize-conductor.ts:169` (GROUND-002); `computePreGroupFromIndex` function at `chunked-compaction.ts:44` (GROUND-003)
- **Existing behavior**: `isChunkedPreGroupBoundary` stops the walk at `user`/`mcp`/`recall`/pstack/`proactivelyCompressed`/`held`/`grouped` blocks. The zone is often empty or tiny.
- **Required edits**:
  - Add `isAccumulationBoundary` function (US-001, RB-001)
  - Change the `computePreGroupFromIndex` call at line 169 to pass `isAccumulationBoundary` instead of `(block) => isChunkedPreGroupBoundary(block, pstackByBlockId)` (US-001, RB-001)
  - Update the pre-group restore filter to use `isAccumulationBoundary` for consistency (RB-007) — the `isChunkedPreGroupBoundary` reference in `isChunkedPreGroupBoundary` used for restore must match the new boundary
- **Normative snippet**:
  ```ts
  function isAccumulationBoundary(block: ViewBlock): boolean {
      return block.held || block.grouped || block.proactivelyCompressed;
  }
  ```
- **Test seam**: `conductor.compaction-naive.test.ts` → existing pre-group tests (GROUND-010). Add new tests verifying the zone crosses `user`/`mcp`/`recall` blocks.
- **Wiring**: No registration/DI changes. Pure function addition in the same file.
- **Grounding evidence**: GROUND-001, GROUND-002, GROUND-003, GROUND-010

### Area: Early rollover

- **Coverage**: DEC-002, DEC-004, US-002, RB-003, RB-004, RB-005, RB-006
- **Contract**: When `live > cap` after the main fold loop and `preGroupBlocks.length >= 2`, call `selectCompactionRange(view, preGroupFromIndex)` → `tryEmitGroup(candidates)`. If the group passes `minSaving`, emit it and return via `finishConduct(cmds, preGroupTokens, preGroupTarget, true)`.
- **Decision constraints**: DEC-002 — must fire after step 4, before suffix grouping. DEC-004 — insertion between lines 355–394. `tryEmitGroup` already enforces `minSaving` (RB-004) and calls `trimOpenToolPairs` (RB-005).
- **Code anchors**: Main fold loop at `my-customize-conductor.ts:355` (GROUND-005); suffix grouping gate at `my-customize-conductor.ts:394` (GROUND-006); `tryEmitGroup` at `my-customize-conductor.ts:190` (GROUND-004); `selectCompactionRange` at `chunked-compaction.ts:247` (GROUND-007)
- **Existing behavior**: After the fold loop, the conductor falls through to suffix `groupRuns` which fragments at `isGroupBoundary`. No early rollover exists.
- **Required edits**:
  - Add early rollover `if` block between lines 355–394 (US-002, RB-003)
  - Ensure `rolloverCount` and `tokensSavedByRollover` are incremented (RB-006) — `tryEmitGroup` already does this
- **Normative snippet**:
  ```ts
  // Early rollover: flush pre-group zone under budget pressure
  if (live > cap && preGroupBlocks.length >= 2) {
      const range = chunkedCompaction.selectCompactionRange(view, preGroupFromIndex);
      const earlyCandidates = range
          ? view.blocks.slice(range.fromIndex, range.toIndexExclusive)
          : preGroupBlocks;
      const cmds = tryEmitGroup(earlyCandidates);
      if (cmds) return this.finishConduct(cmds, preGroupTokens, preGroupTarget, true);
  }
  ```
- **Test seam**: `conductor.compaction-naive.test.ts` (GROUND-010). Add new tests: early rollover fires under budget pressure; early rollover skipped when `liveTokens ≤ cap`; `minSaving` guard rejects tiny groups.
- **Wiring**: No registration/DI changes. Code addition in existing `conduct()` method.
- **Grounding evidence**: GROUND-004, GROUND-005, GROUND-006, GROUND-007, GROUND-010

### Area: Grouping safety (no change needed)

- **Coverage**: DEC-003, RB-005
- **Contract**: Groups may contain `user` and `tool_call` blocks. `trimOpenToolPairs` prevents orphaned pairs. `selectCompactionRange` trims current-turn blocks.
- **Decision constraints**: DEC-003 — no additional guards needed.
- **Code anchors**: `wireFoldable` at `digest.ts:54` (GROUND-008); `FOLDABLE_KINDS` at `score.ts:33` (GROUND-008); `trimOpenToolPairs` at `chunked-compaction.ts` (GROUND-007)
- **Existing behavior**: Already works this way for the 15k rollover. No code change.
- **Required edits**: None.
- **Test seam**: Existing `trimOpenToolPairs` tests cover pair safety. Add assertion in new early rollover test that `user`/`tool_call` blocks appear in group ids.
- **Grounding evidence**: GROUND-007, GROUND-008

## Global Build & Wiring Notes

No cross-cutting wiring changes. All edits are in `conductors/my-customize-conductor/my-customize-conductor.ts`. Tests are in `app/src/lib/engine/conductor.compaction-naive.test.ts`. Run:

```bash
cd app && npx vitest run conductor.compaction-naive
cd app && npx vitest run conductor.my-customize-conductor
```

## Testing Decisions

| Seam | Coverage | Prior art | Expected result |
|------|----------|-----------|-----------------|
| Pre-group zone crosses boundaries | US-001, RB-001 | "blocks outside pre-group range remain fold candidates" (GROUND-010, line 1889) | A `user` block between tool results does NOT stop the pre-group walk; all blocks are in the zone |
| Early rollover fires under pressure | US-002, RB-003 | "conductor returns empty plan when only pre-group blocks would be candidates" (GROUND-010, line 1875) — this test currently expects empty plan; it should be updated or a new test added | With `liveTokens > cap` and only pre-group candidates, the plan contains a `group` command |
| Early rollover respects minSaving | RB-004 | `tryEmitGroup` inline check | A pre-group zone with 1 block or < `minSaving` savings → no group emitted |
| trimOpenToolPairs in early rollover | RB-005 | "chunked-compaction group.ids has balanced tool pairs" (GROUND-010, line 1795) | Straddling tool pairs are excluded from the early rollover group |
| Groups include non-foldable kinds | DEC-003 | Existing rollover tests | `user` and `tool_call` block ids appear in early rollover group |
| Normal rollover still works | Regression | "walking skeleton emits one chunked-compaction group" (GROUND-010, line 1706) | Unchanged behavior when preGroupTokens ≥ 15k |
| Existing pre-group exclusion | Regression | "pre-group blocks are excluded from fold candidates under budget pressure" (line 1851) | Pre-group blocks still excluded from individual fold candidates |

## Out of Scope

- Changing the 15k default target (`DEFAULT_PRE_GROUP_TOKENS`)
- Changing the group digest format or content
- Changing the protected tail or frozen prefix logic
- Changing `isGroupBoundary` behavior for suffix grouping
- Changing `wireFoldable` or `FOLDABLE_KINDS`
- Conductor status text redesign (implementer may adjust formatting)
- Removing the broader `selectCompactionRange` fallback (now largely redundant but harmless)

## Unresolved Gaps

None.

## Further Notes

Grounding file: `.scratch/grills/bbe115d8a5dd/grounding.md`

The test "conductor returns empty plan when only pre-group blocks would be candidates" (line 1875) expects an empty plan when all blocks are in the pre-group zone and `liveTokens > cap`. With DEC-002, this test's expectation changes — the conductor should now emit a group command. The implementer should update or replace this test.
