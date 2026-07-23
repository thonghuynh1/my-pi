# PRD — Pre-Group Fold Exemption

**Status**: `ready-for-agent`
**Grill ledger**: `.scratch/grills/4cb60c644067/ledger.md`
**Grounding**: `.scratch/grills/4cb60c644067/grounding.md`

---

## Problem Statement

In `MyCustomizeConductor`, blocks that exit the protected tail and enter the pre-group zone are currently eligible for individual fold/replace operations under budget pressure. In long sessions (e.g., 70k budget on a 128k model with ~200k conversation), budget pressure is nearly perpetual. This causes:

1. **Multiple cache invalidations per rollover cycle** — each individual fold changes the provider prefix, breaking KV cache. The epoch hold (HOLD_BAND = 0.9) cannot absorb the ~3-5k of new blocks per turn, so plans regenerate almost every turn.
2. **Delayed rollovers** — individually folded blocks contribute their smaller folded token count toward the 15k pre-group threshold, slowing accumulation.
3. **Degraded group digests** — blocks arriving at rollover already folded produce thinner digests built from fold summaries rather than full content.

The result is ~0% KV cache hit rate between rollovers, increased latency, and higher provider costs.

## Solution

Exempt pre-group blocks from individual fold/replace. Blocks accumulate unfolded in the pre-group zone until the rollover threshold (15k) fires a single `GroupCommand`. Between rollovers, the conductor returns an empty plan — `accordion.ts` passes messages through unchanged, the provider prefix is byte-stable, and every turn gets a full KV cache hit.

Expected cache hit rate improves from ~0% to ~80-90% between rollovers.

## User Stories

1. **US-001**: As a user in a long Accordion session, I want the KV cache prefix to remain stable between rollover events, so that provider responses are faster and cheaper due to cache hits.

2. **US-002**: As a user, I want rollover digests to be built from full unfolded block content, so that the agent has richer context when scanning group summaries.

## Walking Skeleton

`US-001` — the thinnest path: add the pre-group exclusion guard to the `allCandidates` filter in `conduct()`, verify that pre-group blocks are not emitted as fold/replace targets, and confirm the conductor returns `[]` between rollovers when only pre-group blocks would have been candidates.

## Required Behaviors

- `RB-001`: Pre-group blocks (blocks with index in `[preGroupFromIndex, protectedFromIndex)`) must not appear in any `FoldCommand`, `ReplaceCommand`, or `breakFrozen` fold emitted by `MyCustomizeConductor` when `preGroupTarget > 0`.
- `RB-002`: The rollover `GroupCommand` must continue to fire at the existing threshold (`preGroupTokens >= preGroupTarget` on fast path, `> preGroupTarget * PRE_GROUP_OVERFLOW_CAP` on escape valve). No change to rollover conditions.
- `RB-003`: When `preGroupTarget === 0` (context window < 128k), the exemption must be a no-op — behavior is identical to today.
- `RB-004`: Blocks outside the pre-group range (e.g., MCP/recall results in the gap between group summaries and pre-group) must remain fold candidates. No change to their treatment.
- `RB-005`: `liveTokens` may exceed `availableCap` by up to `preGroupTarget` between rollovers. This is intentional and must not exceed `contextWindowCap`.
- `RB-006`: The rollover invariant `count(rollover) == count(cacheBreaks) − coldStartCount` must continue to hold.

## Accepted Decision Register

### DEC-001 — Unconditional pre-group exemption
- **Decision**: Pre-group blocks are unconditionally excluded from the `allCandidates` filter. No escape valve.
- **Rationale**: In steady state, zero other fold candidates exist (group summaries are grouped, user/tool_call not in `FOLDABLE_KINDS`, tail is protected). The only effect of the exemption is that the conductor returns `[]` between rollovers instead of folding pre-group blocks. Budget overshoot is bounded (~7k in practice), self-correcting (fuller pre-group → sooner rollover), and well under the hard cap (~35k headroom on 128k models).
- **Rejected alternatives**: (A) Escape valve that folds pre-group under pressure — collapses to status quo because pressure is perpetual in long sessions. (B) Status quo — N+1 cache breaks per rollover cycle.
- **Downstream impact**: Conductor may return `[]` when `liveTokens > cap`. This is correct behavior — `accordion.ts` already handles empty plans (bare `return;`, no `applyPlan`).
- **Depends on**: None
- **Decided implementation**: One guard clause in the `allCandidates` filter at `my-customize-conductor.ts:206`. Hoist `preGroupFromIndex` computation from inside `if (preGroupTarget > 0)` block (line 160) to before the filter.
- **Left to the implementer**: Exact comparison mechanism (array index set vs order comparison). Whether to add an early return after empty candidate detection as an optimization.

### DEC-002 — Budget overshoot is acceptable
- **Decision**: `liveTokens` may exceed the soft cap (`availableCap`) by up to `preGroupTarget` (15k default) between rollovers.
- **Rationale**: The soft cap is a preference, not a hard limit. The hard cap (`contextWindowCap`) is what prevents context overflow. Peak overshoot in the 70k/128k scenario is ~85k — 35k under the hard cap. The overshoot is self-correcting: unfolded blocks accumulate full tokens toward the threshold, so rollovers fire faster.
- **Rejected alternatives**: Adjusting the budget slider internally to account for pre-group buffer — reduces effective budget permanently.
- **Downstream impact**: No changes to `accordion.ts` or `cache-tracker.ts`. The hold-last-plan safety net (fires at `contextWindow − 8192`) is never triggered by this overshoot level.
- **Depends on**: DEC-001
- **Decided implementation**: No code change needed — the overshoot emerges naturally from the exemption. The existing hard-cap guard (`if (live > hardCap)` frozen fold pass) remains as a safety net for extreme edge cases.
- **Left to the implementer**: None

### DEC-003 — Rollover invariant simplification
- **Decision**: The rollover invariant `count(rollover) == count(cacheBreaks) − coldStartCount` is preserved. It becomes trivially true because only rollovers (and rare MCP replaces) change the prefix.
- **Rationale**: Individual pre-group folds were the primary source of "extra" cache breaks that complicated the invariant. With the exemption, the only prefix-changing event between rollovers is a one-time MCP replace (if any), stabilized by epoch hold.
- **Rejected alternatives**: None
- **Downstream impact**: Existing invariant test should pass without modification.
- **Depends on**: DEC-001
- **Decided implementation**: No code change. The invariant test (`chunked-compaction-invariant.test.ts`) verifies the same formula.
- **Left to the implementer**: None

### DEC-004 — MCP/recall results remain foldable
- **Decision**: Blocks outside the pre-group range (MCP/recall tool_result blocks in the gap between group summaries and pre-group) remain fold candidates.
- **Rationale**: These are group boundaries, never part of the pre-group contiguous run. They're rare in steady state (most are grouped by earlier rollovers). When folded, the epoch hold stabilizes the plan — at most 1 extra cache break per rollover cycle.
- **Rejected alternatives**: Exempting all blocks between group summaries and the tail — would prevent any folding at all, removing the safety valve for extreme scenarios.
- **Downstream impact**: None — this is status quo for these blocks.
- **Depends on**: DEC-001
- **Decided implementation**: No code change. The exemption guard only applies to the pre-group index range.
- **Left to the implementer**: None

## Implementation Plan

### Area: Conductor candidate filter

- **Coverage**: DEC-001, DEC-002, US-001, US-002, RB-001, RB-003, RB-004, RB-005
- **Contract**: When `preGroupTarget > 0`, blocks with index in `[preGroupFromIndex, protectedFromIndex)` are excluded from `allCandidates`. When `preGroupTarget === 0`, the filter is unchanged.
- **Decision constraints**: DEC-001 — unconditional, no escape valve. DEC-004 — blocks outside pre-group range remain candidates.
- **Code anchors**:
  - `conductors/my-customize-conductor/my-customize-conductor.ts:206–208` — `allCandidates` filter (`GROUND-001`)
  - `conductors/my-customize-conductor/my-customize-conductor.ts:160–163` — `computePreGroupFromIndex` call inside `if (preGroupTarget > 0)` (`GROUND-003`)
- **Existing behavior**: `allCandidates` includes all non-held, non-protected, non-grouped, foldable blocks regardless of pre-group membership. `preGroupFromIndex` is computed inside the `if (preGroupTarget > 0)` block, after which the pre-group rollover check runs. The `allCandidates` filter comes later (line 206) and has no knowledge of the pre-group range.
- **Required edits**:
  1. Hoist `preGroupFromIndex` computation to before line 206. When `preGroupTarget === 0`, set `preGroupFromIndex = view.protectedFromIndex` (empty range → no exemption).
  2. Add exclusion guard to `allCandidates` filter: exclude blocks in `[preGroupFromIndex, protectedFromIndex)`.
  3. The pre-group rollover check (lines 160–195) continues to use the same `preGroupFromIndex` — no duplication needed.
- **Normative snippet**:
  ```ts
  // Hoist pre-group range computation
  const preGroupFromIndex = preGroupTarget > 0
      ? chunkedCompaction.computePreGroupFromIndex(view, preGroupTarget,
          (block) => isChunkedPreGroupBoundary(block, pstackByBlockId))
      : view.protectedFromIndex;

  // Build pre-group block ID set for exclusion
  const preGroupBlockIds = new Set(
      preGroupTarget > 0
          ? view.blocks.slice(preGroupFromIndex, view.protectedFromIndex).map(b => b.id)
          : []
  );

  // ... existing pre-group rollover check uses preGroupFromIndex ...

  const allCandidates = view.blocks.filter(
      (b) => !b.held && !b.protected && !b.grouped
          && b.foldedTokens < b.tokens
          && FOLDABLE_KINDS.has(b.kind)
          && !preGroupBlockIds.has(b.id),  // ← new: exempt pre-group
  );
  ```
- **Test seam**: `conductor.compaction-naive.test.ts` — existing tests for `preGroupTokens`, `preGroupFillPct` metrics (`GROUND-011`)
- **Wiring**: None — `MyCustomizeConductor` is directly imported by tests and the extension
- **Grounding evidence**: GROUND-001, GROUND-002, GROUND-003, GROUND-004, GROUND-009

### Area: Rollover behavior (no change)

- **Coverage**: RB-002, RB-006, DEC-003
- **Contract**: Rollover conditions (`fastPathFires`, `escapeValveFires`) and `GroupCommand` emission are unchanged.
- **Decision constraints**: DEC-003 — invariant preserved, no modification needed.
- **Code anchors**:
  - `conductors/my-customize-conductor/my-customize-conductor.ts:170–195` — rollover emission (`GROUND-005`)
- **Existing behavior**: Rollover fires when `preGroupTokens >= preGroupTarget` (fast path) or `> preGroupTarget * 1.25` (escape valve). Emits `[{ kind: "group", ids, digest }]`.
- **Required edits**: None. The rollover block already uses `preGroupFromIndex` — after hoisting, it references the same variable.
- **Test seam**: `chunked-compaction-invariant.test.ts` (`GROUND-010`), `accordion.chunkedCompactionJsonl.test.ts`
- **Wiring**: None
- **Grounding evidence**: GROUND-005, GROUND-010

### Area: Extension plan application (no change)

- **Coverage**: RB-005, DEC-002
- **Contract**: Empty plans pass through unchanged. Non-empty plans apply via `applyPlan` + `cacheTracker.observeMessages`.
- **Decision constraints**: DEC-002 — the empty-plan path in `accordion.ts` already handles this correctly.
- **Code anchors**:
  - `extension/accordion.ts:1170` — empty-plan check (`GROUND-006`)
  - `extension/accordion.ts:1173–1178` — hold-last-plan (`GROUND-007`)
  - `extension/accordion.ts:1233–1234` — applyPlan + cacheTracker (`GROUND-008`)
- **Existing behavior**: When `plan.ops.length === 0 && plan.groups.length === 0`, bare `return;` skips `applyPlan` and `cacheTracker.observeMessages`. Messages pass through byte-identical.
- **Required edits**: None.
- **Test seam**: Existing accordion integration tests
- **Wiring**: None
- **Grounding evidence**: GROUND-006, GROUND-007, GROUND-008

## Testing Decisions

### New tests in `conductor.compaction-naive.test.ts`

1. **Pre-group blocks excluded from fold candidates**: Construct a view where `preGroupTarget > 0`, place blocks in the pre-group range, set `liveTokens > cap`. Assert: `conduct()` returns no `FoldCommand` or `ReplaceCommand` targeting pre-group block IDs. Covers: RB-001, DEC-001.

2. **Conductor returns `[]` when only pre-group blocks are candidates**: Same setup but with no other foldable blocks outside pre-group. Assert: `conduct()` returns `[]`. Covers: US-001, RB-001.

3. **Blocks outside pre-group remain foldable**: Add a non-pre-group, non-protected, non-grouped `tool_result` block. Assert: it appears in fold/replace output. Covers: RB-004, DEC-004.

4. **Exemption is no-op when `preGroupTarget === 0`**: Set context window < 128k. Assert: pre-group-position blocks ARE fold candidates. Covers: RB-003.

### Existing tests (should pass without modification)

- `chunked-compaction-invariant.test.ts` — rollover invariant (`GROUND-010`)
- `accordion.chunkedCompactionJsonl.test.ts` — JSONL diagnostic
- `conductor.compaction-naive.test.ts` — existing preGroup metrics tests

### Test command

```bash
cd extensions/accordion/app && npx vitest run
```

## Out of Scope

- Changes to `accordion.ts`, `cache-tracker.ts`, `plan.ts`, `mapping.ts`, or `store.svelte.ts`
- Changes to the conductor contract or protocol version
- Changes to the rollover threshold (`DEFAULT_PRE_GROUP_TOKENS`), overflow cap (`PRE_GROUP_OVERFLOW_CAP`), or minimum context window (`MIN_CONTEXT_WINDOW_FOR_CHUNKED_COMPACTION`)
- Changes to `resolveUnfold` / `appendToTail` behavior for group members
- Performance optimization of the conductor when returning empty plans (optional follow-up)
- Adjusting the budget slider or epoch hold band to account for pre-group overshoot

## Unresolved Gaps

None.

## Further Notes

- Grounding file: `.scratch/grills/4cb60c644067/grounding.md`
- Grill ledger: `.scratch/grills/4cb60c644067/ledger.md`
- Relevant ADRs: ADR-0004 (chunked compaction 4-zone layout), ADR-0002 (authoritative folding runtime), ADR-0003 (proactive content compression)
