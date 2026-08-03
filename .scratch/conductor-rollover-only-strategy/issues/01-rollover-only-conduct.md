---
status: closed
---

# 01 — Rollover-only conduct() with B2 dynamic trigger and multi-group slicing

Status: ready-for-agent

## Parent

`.scratch/conductor-rollover-only-strategy/PRD.md`

## What to build

Rewrite `MyCustomizeConductor.conduct()` to a rollover-only model: all fold/replace/group decisions are consolidated into rollover events. Between rollovers, the conductor returns an empty plan and tolerates being over budget. Each rollover slices the pre-group zone into N × 15k groups and applies MCP summary replaces — all in one plan (one cache-invalidation event).

This is the walking skeleton (`US-001`). It delivers the full end-to-end flow: accumulate → dynamic trigger → multi-group rollover → tolerate between rollovers.

**Covers**: DEC-001, DEC-002, DEC-003, DEC-004, DEC-005, DEC-006, DEC-007 (main path), DEC-008, US-001, US-002, RB-001, RB-003, RB-004, RB-005, RB-006, RB-007

## Implementation map

### Conductor main path — `my-customize-conductor.ts`

**File**: `extensions/accordion/conductors/my-customize-conductor/my-customize-conductor.ts`
**Entry**: `conduct()` at line 184

**Simplified flow** (replaces current multi-path logic):
```
1. Compute cap, hardCap, pre-group zone
2. If live ≤ cap → return [] + replayablePreviousGroups
3. If preGroupTokens ≥ (live - cap) AND turnBoundary:
     slice pre-group into N × 15k groups
     replace MCP blocks in pre-group with mcpSummary()
     return [groups + replaces] + replayablePreviousGroups
4. If live > hardCap → emergency brake (unchanged — issue #02 simplifies sort)
5. Otherwise → return [] + replayablePreviousGroups (tolerate over-budget)
```

**Remove** (DEC-001):
- Normal fold loop: lines 478–481 (`for (const b of sortCandidates(candidates)) { ... applyCandidate(b, false) }`) — GROUND-001
- Non-frozen suffix grouping: lines 532–535 (`groupRuns(view.blocks, block => block.order >= view.frozenFromIndex ...)`) — GROUND-002

**Remove** (DEC-006):
- Epoch hold: lines 342–353 (view-key match, projection hold band, semantic key check) — GROUND-004
- Instance fields: `lastPlan`, `lastSavings`, `lastSemanticKey`, `lastViewKey`, `HOLD_BAND` (line 59)

**Remove** (DEC-007):
- Reachability graph: line 367 (`markReachable(buildGraph(view.blocks), roots)`) — GROUND-005
- `sortCandidates` function and `FOLD_RANK` usage from main path
- Import: `import { buildGraph, markReachable } from "../garbage-collector/edges"` (line 25) — **do not remove the import in this issue**; issue #02 owns final removal after verifying the hardCap path no longer needs it

**Remove/simplify** (DEC-004):
- Atomic rebase: lines 233–234 (definition), lines 439–475 (main block) — GROUND-009
- The B2 dynamic trigger naturally handles first-view (late-attach) without a separate path
- `isFirstObservedView` flag: retain for metrics/logging if already wired to telemetry; otherwise remove. Left to implementer.

**Replace** (DEC-002):
- Fast-path/escape-valve trigger: lines 273–280 (`fastPathFires || escapeValveFires`) — GROUND-003, GROUND-007
- New trigger: `preGroupTokens >= (liveTokens - cap) && isOnTurnBoundary()`
- `isOnTurnBoundary()` checks that the last block in the pre-group zone completes a turn (existing `noOpenToolPairAcrossPreGroupTail` logic)

**Add** (DEC-003):
- Multi-group slicing: after `selectCompactionRange` identifies the full eligible range, iterate in `DEFAULT_PRE_GROUP_TOKENS` (15k) slices, emitting a group command per slice via `tryEmitGroup`. Turn-boundary alignment: if a 15k boundary falls mid-turn, advance to the next turn boundary.

**Add** (DEC-005):
- MCP replace pass at rollover time: after slicing groups, scan the pre-group zone for `isMcpResult(b)` blocks. For each, emit a `replace` command using `mcpSummary(result, call)`. These replace commands are part of the same plan as the group commands.
- `isMcpResult` and `mcpSummary` are imported from `mcp-summary.ts` (no changes to that file — GROUND-012)
- `isGroupBoundary` (GROUND-013) is unchanged — MCP blocks are still boundaries, groups split around them
- **Out of scope**: Applying `toolResultSummary()` for non-MCP tool results (read/grep/find/ls/subagent) at rollover time — those are handled by group digests

**Keep unchanged**:
- `replayablePreviousGroups` (lines 121–136) — GROUND-010. Called on every return path.
- `finishConduct` (lines 147–182) — GROUND-011. Return shape unchanged.
- `isGroupBoundary` function (lines 47–51) — GROUND-013
- hardCap emergency brake paths (lines 483–486, 541–560) — GROUND-006. Kept as-is; issue #02 simplifies sort.

### Chunked compaction — `chunked-compaction.ts`

**File**: `extensions/accordion/conductors/my-customize-conductor/chunked-compaction.ts`

**Modify** (DEC-002, DEC-008):
- `computePreGroupFromIndex` (line ~45): Accept the dynamic target (`liveTokens - cap` instead of fixed `DEFAULT_PRE_GROUP_TOKENS`). Remove the `target * PRE_GROUP_OVERFLOW_CAP` cap inside the backward walk. The function accumulates tokens up to the dynamic target without an overflow multiplier.
- The caller in `conduct()` computes the dynamic target and passes it.

### Constants — `constants.ts`

**File**: `extensions/accordion/conductors/my-customize-conductor/constants.ts`

**Remove** (DEC-008):
- `PRE_GROUP_OVERFLOW_CAP = 1.25` (line 2)
- Remove import of `PRE_GROUP_OVERFLOW_CAP` from `my-customize-conductor.ts` (line 41)

**Keep**:
- `DEFAULT_PRE_GROUP_TOKENS = 15_000` — used as the group slice size in DEC-003
- `MIN_CONTEXT_WINDOW_FOR_CHUNKED_COMPACTION = 128_000`

### Tests

**File**: `app/src/lib/engine/conductor.my-customize-conductor.test.ts`
**Command**: `cd extensions/accordion/app && npx vitest run`

**Update existing tests**: Tests that assert fold commands from the normal fold loop should now assert empty plans (no folds) when `live > cap` but pre-group hasn't reached threshold. Tests that assert single-group rollover should be updated for multi-group slicing.

**New tests**:

1. **Between-rollover tolerance**: Construct `ConductorView` where `liveTokens = 85_000`, `cap = 70_000`, `preGroupTokens = 10_000` (below threshold of `85k - 70k = 15k`). Call `conduct()`. Assert: returned commands contain zero fold/replace/group commands (only replayed previous groups if any exist). This proves RB-001, RB-007.

2. **Multi-group rollover**: Construct view with `liveTokens = 100_000`, `cap = 70_000`, pre-group zone containing 45k tokens across multiple complete turns. B2 threshold = `100k - 70k = 30k`; pre-group 45k >= 30k → fires. Call `conduct()`. Assert: returned commands contain 3 group commands (each ≤ 15k token span), no fold commands. This proves DEC-003, RB-003.

3. **Late-attach**: Construct view with `liveTokens = 200_000`, `cap = 70_000`, `isFirstObservedView`-equivalent state (no prior plans), all blocks non-protected except tail. Assert: B2 trigger fires immediately (`200k - 70k = 130k`; pre-group covers the full non-protected zone). Plan contains N groups covering all non-protected content. Single plan return. This proves US-002, DEC-004.

4. **MCP replace at rollover**: Construct pre-group zone with 3 regular tool_result blocks and 2 MCP tool_result blocks interleaved. Trigger rollover. Assert: plan contains group commands that split around MCP blocks, plus 2 replace commands for the MCP blocks with `mcpSummary()` content. This proves DEC-005, RB-004.

5. **Replay previous groups between rollovers** (RB-005): Construct a view, trigger a rollover that produces 2 groups. On the next `conduct()` call where `live ≤ cap`, assert the returned plan contains the 2 prior group commands via `replayablePreviousGroups`. Then construct a between-rollover call where `live > cap` but below threshold — assert the prior groups are still replayed alongside the empty command set.

6. **Repeated rollover** (US-003): Construct a session that triggers rollover A (groups 30k). Add 20k more content. Trigger rollover B (groups 20k). Assert both rollover plans contain the correct groups, and `replayablePreviousGroups` stacks them (rollover B's plan includes rollover A's groups).

**Also update**:
- `extension/accordion.chunkedCompactionJsonl.test.ts` — update for dynamic trigger threshold
- `extension/chunked-compaction-invariant.test.ts` — verify invariants hold with multi-group rollovers

## Acceptance criteria

- [ ] **AC-01-1**: Multi-group rollover emits groups, no folds
  - Run: `cd extensions/accordion/app && npx vitest run`
  - Test: `conductor.my-customize-conductor.test.ts` → `"multi-group rollover"` (planned)
  - Expected: `conduct()` returns a plan with ≥ 2 group commands and 0 fold commands when `liveTokens = 100k`, `cap = 70k` (threshold = 30k), pre-group zone = 45k tokens
  - Fails when: fold loop is still present or single-group-only emission logic remains

- [ ] **AC-01-2**: Between-rollover tolerance — no folds when over budget but below threshold
  - Run: `cd extensions/accordion/app && npx vitest run`
  - Test: `conductor.my-customize-conductor.test.ts` → `"between-rollover tolerance"` (planned)
  - Expected: `conduct()` returns zero fold/replace/group commands when `liveTokens > cap` but `preGroupTokens < (liveTokens - cap)`. Only `replayablePreviousGroups` appear.
  - Fails when: normal fold loop (lines 478–481) or suffix grouping (lines 532–535) still executes

- [ ] **AC-01-3**: Late-attach produces N groups in one shot
  - Run: `cd extensions/accordion/app && npx vitest run`
  - Test: `conductor.my-customize-conductor.test.ts` → `"late-attach"` (planned)
  - Expected: With 200k total and 70k budget on first view, `conduct()` emits N groups covering all non-protected content in a single plan. No separate atomic-rebase code path fires.
  - Fails when: atomic rebase path (lines 439–475) is still the handler for first-view, or pre-group window is capped at 18.75k

- [ ] **AC-01-4**: MCP blocks get replace commands at rollover, groups split around them
  - Run: `cd extensions/accordion/app && npx vitest run`
  - Test: `conductor.my-customize-conductor.test.ts` → `"MCP replace at rollover"` (planned)
  - Expected: MCP tool_result blocks in the pre-group zone produce `replace` commands with `mcpSummary()` content. Group commands do not include MCP block IDs as members.
  - Fails when: MCP blocks are grouped (not replaced), or replace commands are missing from the rollover plan

- [ ] **AC-01-5**: Existing tests pass after refactor
  - Run: `cd extensions/accordion/app && npx vitest run`
  - Expected: All existing tests in `conductor.my-customize-conductor.test.ts`, `accordion.chunkedCompactionJsonl.test.ts`, and `chunked-compaction-invariant.test.ts` pass (updated for new behavior)
  - Fails when: any existing test regresses

- [ ] **AC-01-6**: Replayed previous groups are populated correctly between rollovers
  - Run: `cd extensions/accordion/app && npx vitest run`
  - Test: `conductor.my-customize-conductor.test.ts` → `"replay previous groups between rollovers"` (planned)
  - Expected: After a rollover produces 2 groups, a subsequent `conduct()` call returns those 2 prior group commands via `replayablePreviousGroups`. A between-rollover call (over budget, below threshold) also replays them.
  - Fails when: `replayablePreviousGroups` returns empty or omits prior group commands

- [ ] **AC-01-7**: Repeated rollovers stack groups correctly
  - Run: `cd extensions/accordion/app && npx vitest run`
  - Test: `conductor.my-customize-conductor.test.ts` → `"repeated rollover"` (planned)
  - Expected: After rollover A and rollover B, rollover B's plan includes rollover A's groups via `replayablePreviousGroups` plus rollover B's new groups
  - Fails when: prior rollover groups are lost on subsequent rollovers

- [ ] **AC-01-8**: Epoch hold, reachability graph, and escape valve code removed
  - Run: `cd extensions/accordion/app && npx vitest run`
  - Expected: No references to `HOLD_BAND`, `lastViewKey`, `lastSemanticKey`, `buildGraph`, `markReachable`, `escapeValveFires`, or `PRE_GROUP_OVERFLOW_CAP` in the main `conduct()` path. `PRE_GROUP_OVERFLOW_CAP` removed from `constants.ts`.
  - Fails when: dead code remains or `constants.ts` still exports `PRE_GROUP_OVERFLOW_CAP`

## Blocked by

None — can start immediately.
