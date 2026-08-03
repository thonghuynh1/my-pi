# Rollover-Only Fold Strategy for MyCustomizeConductor

Status: ready-for-agent
Owner: (unassigned)
Related: `.scratch/accordion-large-session-perf/`, `.scratch/conductor-sent-unfolded-invariant/`
Supersedes: `.scratch/conductor-sent-unfolded-invariant/PRD.md` (the `sentUnfolded` approach)

## Problem Statement

Under real fold pressure on long agentic sessions (~250k pre-fold, budget 70k), `MyCustomizeConductor` adds **+88.8% to total dollar cost** vs. running without Accordion. The root cause is **13 separate cache-invalidation events** per session, each forcing ~38k tokens to be re-sent as fresh input (1.0× rate instead of 0.1× cache-read rate).

These invalidations come from the conductor's multiple independent fold/replace/group paths firing on separate turns — each one mutating the provider's cached prefix at a different position. The pre-group rollover (chunked compaction) is cache-efficient (1 break per rollover), but the normal fold loop, suffix grouping, and epoch-hold replanning leak individual cache breaks between rollovers.

The previously proposed `sentUnfolded` invariant ("never fold a block already sent unfolded") would progressively freeze all blocks, rendering the conductor unable to compact context for long (500k+) sessions — defeating its core purpose and causing model hallucination from oversized context.

**Affected actors**: All Accordion-enabled Pi sessions using models with prefix caching (OpenAI, Anthropic).

## Solution

Consolidate all fold/replace/group decisions into **rollover events only**. Between rollovers, the conductor does nothing — it tolerates being over budget. Each rollover produces exactly 1 cache-invalidation event regardless of how many groups or replaces it emits. The pre-group zone grows dynamically until it has enough content to bring the session back to budget in one shot.

This preserves the conductor's ability to keep context compact for long sessions (the key advantage over `strict-monotonic`) while eliminating the per-turn cache-invalidation tax.

## User Stories

1. As a Pi user with Accordion enabled, I want context compaction to cost at most one cache invalidation per rollover event, so that my session cost stays within ~15% of running without Accordion.

2. As a Pi user who attaches Accordion mid-session (150-200k already present), I want Accordion to group all existing content down to budget in a single operation, so that late-attach costs exactly one cache break.

3. As a Pi user on a long session (500k+), I want the conductor to keep compacting context at budget through repeated rollovers, so that the model doesn't hallucinate from an oversized context window.

## Walking Skeleton

`US-001` — Implement the rollover-only `conduct()` path: remove the between-rollover fold loop and suffix grouping, implement the B2 dynamic trigger with multi-group slicing, and verify that the conductor produces at most 1 cache-invalidation event per rollover on a multi-turn session.

Acceptance criterion: A test constructs a session where `liveTokens > cap` with 30k+ in the pre-group zone. The conductor emits a single plan containing multiple groups (sliced at 15k boundaries) plus MCP summary replaces for MCP blocks in the zone. A second call with `liveTokens < cap` emits an empty plan with replayed previous groups. No fold commands appear in either plan.

## Required Behaviors

- `RB-001`: Between rollovers, the conductor returns an empty plan (plus `replayablePreviousGroups`) even when `liveTokens > cap`, as long as `liveTokens ≤ hardCap`.
- `RB-002`: When `liveTokens > hardCap` (context window limit), the hardCap emergency brake fires regardless of rollover state. This is the only path that folds/groups outside of rollover.
- `RB-003`: Each rollover plan contains all group commands plus MCP summary replaces for the pre-group zone. The host applies them as one atomic plan → one cache-invalidation event.
- `RB-004`: MCP/recall/pstack blocks remain group boundaries. Groups split around them. MCP blocks in the pre-group zone receive identity-preserving `replace` commands at rollover time.
- `RB-005`: `replayablePreviousGroups` continues to replay all prior group commands on every `conduct()` return, ensuring previously committed groups don't flash open.
- `RB-006`: The `FOLDABLE_KINDS` gate (`tool_call` and `user` never individually folded) is unchanged. Groups may contain any block kind as part of structurally complete turn units.
- `RB-007`: The dynamic trigger tolerates being over budget between rollovers. The conductor does not attempt to bring `liveTokens` under `cap` between rollovers.

## Accepted Decision Register

### DEC-001 — Rollover-only fold timing
- **Decision**: All fold/replace/group decisions happen at rollover time only. No between-rollover folds.
- **Rationale**: Eliminates 13 separate cache-invalidation events. Each rollover = exactly 1 cache break.
- **Rejected alternatives**: `sentUnfolded` invariant (progressively freezes all blocks, conductor becomes inert on long sessions); cost-aware between-rollover folds (adds complexity, still leaks individual cache breaks).
- **Downstream impact**: Normal fold loop (GROUND-001) and non-frozen suffix grouping (GROUND-002) are removed. MCP summary replaces move into rollover path.
- **Depends on**: None
- **Decided implementation**: Remove lines 478–481 (normal fold loop) and lines 532–535 (suffix grouping) from `conduct()`. All compaction happens through the rollover group-emission path.
- **Left to the implementer**: Exact cleanup of dead code paths and helper functions that become unreachable.

### DEC-002 — Dynamic rollover trigger (B2)
- **Decision**: Rollover fires when `preGroupTokens ≥ (liveTokens - cap)` AND the last block in the pre-group zone completes a turn. hardCap forces immediate rollover regardless.
- **Rationale**: Naturally adapts to overage size. Small overage → small rollover. Big overage → big rollover. Always 1 cache break to get back to budget. Handles both steady-state and late-attach.
- **Rejected alternatives**: Fixed 15k threshold (Option A — would require 2 cache breaks to drain 30k overage); fixed higher threshold (Option B1 — doesn't adapt to overage size).
- **Downstream impact**: Replaces the current fast-path (15k + turn boundary) and escape valve (18.75k) triggers.
- **Depends on**: DEC-001
- **Decided implementation**: Replace the `fastPathFires` / `escapeValveFires` logic (GROUND-003, GROUND-007) with the B2 condition. Remove `PRE_GROUP_OVERFLOW_CAP` from constants. Modify `computePreGroupFromIndex` (GROUND-008) to accept a dynamic target instead of capping at `target * 1.25`.
- **Left to the implementer**: Whether the dynamic target is computed inside `computePreGroupFromIndex` or passed in by the caller.

### DEC-003 — Multi-group slicing at rollover
- **Decision**: When rollover fires, slice the pre-group zone into N × 15k groups. Emit all group commands in a single plan return → 1 cache-invalidation event regardless of group count.
- **Rationale**: A 40k pre-group zone produces 2 groups (15k + 15k) with 10k remaining, all in one cache break. Without slicing, a single 40k group would produce an oversized digest.
- **Downstream impact**: `tryEmitGroup` logic changes from emitting one group to emitting N groups.
- **Depends on**: DEC-002
- **Decided implementation**: After `selectCompactionRange` identifies the full range, iterate through it in 15k slices (using `DEFAULT_PRE_GROUP_TOKENS` as slice size), emitting a group command for each slice. Turn-boundary alignment applies within each slice.
- **Left to the implementer**: How to handle a slice boundary that falls mid-turn (likely advance to the next turn boundary, making the slice slightly larger than 15k).

### DEC-004 — Late-attach as B2 special case
- **Decision**: Late-attach (Accordion attaches mid-session with 150-200k existing) uses the same B2 trigger. First view → `live - cap` is very large → rollover fires immediately → groups everything in one shot.
- **Rationale**: No special case needed. The atomic rebase path (GROUND-009) is simplified into the B2 trigger.
- **Downstream impact**: `atomicRebaseQualifies` logic is removed or simplified.
- **Depends on**: DEC-002, DEC-003
- **Decided implementation**: Remove the separate `atomicRebaseQualifies` path (lines 233–234, 439–475). On first view, the B2 trigger condition is immediately true (pre-group = entire non-protected region, `live - cap` is large). The standard multi-group slicing handles it.
- **Left to the implementer**: Whether `isFirstObservedView` flag is retained for metrics/logging or removed entirely.

### DEC-005 — MCP blocks as group boundaries with rollover-time replaces
- **Decision**: Keep MCP/recall/pstack blocks as group boundaries (groups split around them). Apply MCP summary replaces (`mcpSummary()`) to MCP blocks inside the pre-group zone at rollover time.
- **Rationale**: MCP content stays visible to the model as named summaries (prevents miss-follow from buried MCP content). Replacing at rollover time is free — same cache break. MCP blocks outside the pre-group zone are already tiny (~50 tokens from previous replaces) or inside group digests.
- **Rejected alternatives**: Group MCP blocks inside turn units (ADR-0005 allows it, but model may not recall buried content → miss-follow risk); accept leak without replacing (MCP blocks accumulate tokens indefinitely).
- **Downstream impact**: `applyCandidate` MCP replace logic (GROUND-012) moves from the normal fold loop into the rollover emission path.
- **Depends on**: DEC-001
- **Decided implementation**: At rollover time, after slicing groups, scan the pre-group zone for `isMcpResult(b)` blocks. For each, emit a `replace` command using `mcpSummary()`. These replace commands join the group commands in the same plan return. `isGroupBoundary` (GROUND-013) is unchanged.
- **Left to the implementer**: Whether to also apply `toolResultSummary()` for non-MCP tool results (read/grep/find/ls/subagent) at rollover time, or leave those to group digests.

### DEC-006 — Remove epoch hold / stability gating
- **Decision**: Remove the three-layer epoch hold (exact view-key match, projection hold band, semantic key check). The conductor's decision is now binary: rollover or do nothing.
- **Rationale**: The epoch hold was designed to prevent the fold loop from thrashing. Since the fold loop is removed (DEC-001), there is nothing to suppress.
- **Downstream impact**: Instance fields `lastPlan`, `lastSavings`, `lastSemanticKey`, `lastViewKey`, `HOLD_BAND` become dead code.
- **Depends on**: DEC-001
- **Decided implementation**: Remove lines 342–353 (GROUND-004) and associated instance fields. The rollover trigger (DEC-002) is the only decision gate.
- **Left to the implementer**: Whether `lastFrozenGroupEpochKey` is retained for the hardCap emergency path or simplified.

### DEC-007 — Remove reachability graph from main path
- **Decision**: Remove `buildGraph` / `markReachable` from the main rollover path. Rollover groups blocks chronologically (oldest-first, turn-aligned) — no ranking needed. Keep simplified oldest-first for the hardCap emergency path.
- **Rationale**: The reachability graph was used to sort fold candidates. In rollover-only, there are no individual fold candidates — the entire pre-group zone is grouped chronologically.
- **Downstream impact**: `buildGraph`, `markReachable` imports and the `sortCandidates` comparator become unused on the main path.
- **Depends on**: DEC-001
- **Decided implementation**: Remove line 367 (`markReachable(buildGraph(...))`) and the `sortCandidates` function from the main `conduct()` path. The hardCap emergency path (GROUND-006) can use a simplified oldest-first sort.
- **Left to the implementer**: Whether to remove the garbage-collector import entirely or keep it for the hardCap path.

### DEC-008 — Remove escape valve
- **Decision**: Remove the `PRE_GROUP_OVERFLOW_CAP = 1.25` escape valve. Let the pre-group zone grow freely until the B2 dynamic threshold fires.
- **Rationale**: The escape valve forced early rollovers at 18.75k, producing small single groups. Removing it lets content accumulate for bigger batch rollovers → fewer cache breaks.
- **Downstream impact**: `PRE_GROUP_OVERFLOW_CAP` constant becomes unused. `computePreGroupFromIndex` no longer caps at `target * 1.25`.
- **Depends on**: DEC-002
- **Decided implementation**: Remove `PRE_GROUP_OVERFLOW_CAP` from `constants.ts` (GROUND-014). Modify `computePreGroupFromIndex` (GROUND-008) to accept the dynamic target without the overflow cap.
- **Left to the implementer**: Whether `computePreGroupFromIndex` still has any upper bound or truly unbounded.

### DEC-009 — Keep hardCap emergency brake
- **Decision**: Keep the existing hardCap emergency brake (frozen prefix folds and frozen prefix grouping) as a last-resort safety net. If `liveTokens > hardCap`, force fold/group regardless of rollover state.
- **Rationale**: Prevents API call failure from exceeding the provider's context window. Almost never fires (Proactive Content Compression handles biggest token hogs). When it does fire, it's one cache break — acceptable vs. a failed session.
- **Rejected alternatives**: Remove entirely (risk of API failure on extreme sessions).
- **Downstream impact**: None — paths 3 and 5 (GROUND-006) are kept as-is.
- **Depends on**: None
- **Decided implementation**: Lines 483–486 (frozen prefix folds) and lines 541–560 (frozen prefix grouping) remain. Use oldest-first sort instead of reachability-based sort (per DEC-007).
- **Left to the implementer**: Whether to simplify the frozen grouping epoch key logic or keep it as-is.

## Implementation Plan

### Area: Conductor main path (`conduct()`)

- **Coverage**: DEC-001, DEC-002, DEC-003, DEC-004, DEC-005, DEC-006, DEC-007, US-001, US-002, US-003, RB-001, RB-003, RB-004, RB-005, RB-007
- **Contract**: `conduct(view)` returns a `ConductorPlan` with at most one set of cache-invalidating commands per call. Between rollovers, returns empty commands + replayed previous groups. At rollover, returns N group commands + MCP replace commands for the pre-group zone.
- **Decision constraints**: DEC-001 (no between-rollover folds), DEC-002 (B2 trigger), DEC-003 (multi-group slicing), DEC-005 (MCP replaces at rollover), DEC-006 (no epoch hold), DEC-007 (no reachability graph)
- **Code anchors**: `my-customize-conductor.ts` → `conduct()` (line 184), normal fold loop (lines 478–481), suffix grouping (lines 532–535), epoch hold (lines 342–353), reachability (line 367), atomic rebase (lines 439–475)
- **Existing behavior**: Multi-path fold/replace/group with epoch hold, reachability scoring, and per-turn fold decisions.
- **Required edits**:
  - Remove normal fold loop (lines 478–481) [DEC-001]
  - Remove non-frozen suffix grouping (lines 532–535) [DEC-001]
  - Remove epoch hold (lines 342–353) and associated fields (`lastPlan`, `lastSavings`, `lastSemanticKey`, `lastViewKey`, `HOLD_BAND`) [DEC-006]
  - Remove `buildGraph`/`markReachable` call (line 367) and `sortCandidates` from main path [DEC-007]
  - Simplify atomic rebase (lines 439–475) into B2 trigger [DEC-004]
  - Replace fast-path/escape-valve trigger (lines 273–280) with B2 dynamic trigger: `preGroupTokens >= (liveTokens - cap) && isOnTurnBoundary()` [DEC-002]
  - Add multi-group slicing: iterate pre-group zone in 15k slices, emit group command per slice [DEC-003]
  - Add MCP replace pass: scan pre-group zone for `isMcpResult(b)`, emit `replace` with `mcpSummary()` [DEC-005]
- **Normative snippet** — simplified `conduct()` flow:
  ```
  1. Compute cap, hardCap, pre-group zone
  2. If live ≤ cap → return [] + replayablePreviousGroups
  3. If preGroupTokens ≥ (live - cap) AND turnBoundary:
       slice pre-group into N × 15k groups
       replace MCP blocks in pre-group with mcpSummary()
       return [groups + replaces] + replayablePreviousGroups
  4. If live > hardCap → emergency brake (oldest-first frozen folds/groups)
  5. Otherwise → return [] + replayablePreviousGroups (tolerate over-budget)
  ```
- **Test seam**: `conductor.my-customize-conductor.test.ts` — construct `ConductorView` with configurable `liveTokens`, `cap`, blocks, and assert returned commands. Command: `npx vitest run` from `extensions/accordion/app/`
- **Wiring**: No new wiring. `conduct()` signature and return type (`ConductorPlan`) unchanged. `finishConduct` (GROUND-011) unchanged.
- **Grounding evidence**: GROUND-001, GROUND-002, GROUND-003, GROUND-004, GROUND-005, GROUND-007, GROUND-008, GROUND-009, GROUND-010, GROUND-012

### Area: Chunked compaction (`chunked-compaction.ts`)

- **Coverage**: DEC-002, DEC-008
- **Contract**: `computePreGroupFromIndex` returns the start index of the pre-group zone, walking backward from `protectedFromIndex` and accumulating tokens up to the dynamic target. No overflow cap.
- **Decision constraints**: DEC-002 (dynamic target replaces fixed 15k + 1.25× cap), DEC-008 (escape valve removed)
- **Code anchors**: `chunked-compaction.ts` → `computePreGroupFromIndex` (line ~45), `effectivePreGroupTokens` (line ~35). `constants.ts` → `PRE_GROUP_OVERFLOW_CAP` (line 2).
- **Existing behavior**: `computePreGroupFromIndex` walks backward, caps at `target * PRE_GROUP_OVERFLOW_CAP` (18.75k). `effectivePreGroupTokens` returns 0 if context window < 128k.
- **Required edits**:
  - Modify `computePreGroupFromIndex` to accept a dynamic target (the B2 threshold: `liveTokens - cap`) without applying the `PRE_GROUP_OVERFLOW_CAP` multiplier [DEC-002, DEC-008]
  - Remove `PRE_GROUP_OVERFLOW_CAP` from `constants.ts` [DEC-008]
  - Remove `PRE_GROUP_OVERFLOW_CAP` import from `my-customize-conductor.ts` [DEC-008]
- **Test seam**: `conductor.my-customize-conductor.test.ts` — existing tests for pre-group boundary computation. Command: `npx vitest run` from `extensions/accordion/app/`
- **Grounding evidence**: GROUND-008, GROUND-014

### Area: Constants

- **Coverage**: DEC-008
- **Code anchors**: `constants.ts` → lines 1–4
- **Required edits**: Remove `PRE_GROUP_OVERFLOW_CAP` export (line 2). Keep `DEFAULT_PRE_GROUP_TOKENS = 15_000` (used as group slice size in DEC-003). Keep `MIN_CONTEXT_WINDOW_FOR_CHUNKED_COMPACTION = 128_000`.
- **Grounding evidence**: GROUND-014

### Area: MCP summary (`mcp-summary.ts`)

- **Coverage**: DEC-005
- **Contract**: `mcpSummary()`, `isMcpResult()`, `toolResultSummary()` remain unchanged. They are called from the rollover path instead of the normal fold loop.
- **Decision constraints**: DEC-005 (MCP replaces at rollover time)
- **Code anchors**: `mcp-summary.ts` → `mcpSummary` (line ~58), `isMcpResult` (line ~48)
- **Required edits**: None to `mcp-summary.ts` itself. The call site moves from `applyCandidate` (inside the removed fold loop) to the new rollover emission path in `conduct()`.
- **Grounding evidence**: GROUND-012

### Area: hardCap emergency brake

- **Coverage**: DEC-009, RB-002
- **Contract**: When `liveTokens > hardCap`, fold/group frozen-prefix blocks using oldest-first ordering until `liveTokens ≤ hardCap`.
- **Decision constraints**: DEC-009 (keep as-is), DEC-007 (use oldest-first instead of reachability-based sort)
- **Code anchors**: `my-customize-conductor.ts` → lines 483–486 (frozen folds), lines 541–560 (frozen grouping)
- **Existing behavior**: Folds/groups frozen-prefix blocks when `live > hardCap`. Currently uses `sortCandidates` with reachability-based ordering.
- **Required edits**: Replace `sortCandidates(allCandidates.filter(...))` with simple `allCandidates.filter(...).sort((a, b) => a.order - b.order)` (oldest-first) [DEC-007]
- **Grounding evidence**: GROUND-006

## Global Build & Wiring Notes

- No new wire protocol messages, no `CONDUCTOR_PROTOCOL_VERSION` bump, no changes to `ConductorView` or `ConductorPlan` types.
- `finishConduct` return shape unchanged — `{ commands, preGroup: { memberIds } }`.
- Build: `npm run build` in `extensions/accordion/app/`.
- The `isGroupBoundary` function (GROUND-013) is unchanged.
- `replayablePreviousGroups` (GROUND-010) is unchanged.

## Testing Decisions

### Existing tests to update
- `conductor.my-customize-conductor.test.ts` (~50+ tests): Update tests that assert fold commands from the normal fold loop. These should now assert empty plans (no folds) when `live > cap` but pre-group zone hasn't reached threshold. Tests that assert rollover behavior should be updated for multi-group slicing.
- `accordion.chunkedCompactionJsonl.test.ts`: Update for dynamic trigger threshold.
- `chunked-compaction-invariant.test.ts`: Verify invariants still hold with multi-group rollovers.

### New tests
1. **Between-rollover tolerance**: Construct session where `live > cap` but `preGroupTokens < (live - cap)`. Assert `conduct()` returns empty commands + replayed previous groups. No fold or replace commands.
2. **Multi-group rollover**: Construct session with 45k in pre-group zone, `live - cap = 30k`. Assert rollover fires, emits 2 groups (15k + 15k), 15k remains in pre-group.
3. **Late-attach**: Construct session with 200k total, 70k budget, first view. Assert rollover fires immediately, emits N groups covering all non-protected content. Single plan.
4. **MCP replace at rollover**: Construct pre-group zone with MCP blocks among regular blocks. Assert rollover emits group commands that split around MCP blocks, plus `replace` commands for MCP blocks with `mcpSummary()` content.
5. **hardCap emergency**: Construct session where `live > hardCap`. Assert frozen-prefix folds/groups fire with oldest-first ordering.

### Benchmark verification
Rerun `impact-wide × grep-accordion` from `F:\MyWork\benchmark\`:
- Command: `python scripts/run_single_trial.py impact-wide grep-accordion openai-codex/gpt-5.6-luna`
- Score: `python scripts/analyze_accordion_cost.py --auto --scenario impact-wide`
- Success: ≤ 2 cache-invalidation events (vs. 13 today), cost delta vs baseline ≤ +15% (vs. +88.8% today)

### Test command
```
cd extensions/accordion/app && npx vitest run
```

## Out of Scope

- **PCC hook ordering**: Proactive Content Compression's `before_provider_request` hook runs after Accordion's `context` hook, making PCC effectively inert when Accordion is active. This is a separate issue (noted in grill ledger D7).
- **ADR-0005 MCP grouping**: MCP blocks could be grouped inside complete turn units per ADR-0005. Deliberately excluded — model may not recall buried MCP content (miss-follow risk).
- **Conductor scoring/intelligence**: The rollover-only model does not rank blocks by relevance. It groups chronologically. More intelligent grouping (e.g., keeping recently-referenced content ungrouped) is a possible future enhancement.
- **`sentUnfolded` invariant**: The approach from `.scratch/conductor-sent-unfolded-invariant/PRD.md`. Superseded by this rollover-only strategy.
- **Group slice boundary mid-turn handling**: When a 15k slice boundary falls mid-turn, the implementer decides whether to advance to the next turn boundary or split the turn. Not specified by this PRD.

## Unresolved Gaps

None.

## Further Notes

- Grounding file: `F:/MyWork/my-pi/.scratch/grills/cc9f4b2e7a1d/grounding.md`
- Grill ledger: `F:/MyWork/my-pi/.scratch/grills/cc9f4b2e7a1d/ledger.md`
- Research on prefix cache mechanics: `F:/MyWork/my-pi/.scratch/grills/cc9f4b2e7a1d/research-prefix-cache-mechanics.md`
- The `strict-monotonic` conductor (`conductors/strict-monotonic/`) proved the cache-hygiene principle but is not the target of this change. It remains as a reference implementation.
