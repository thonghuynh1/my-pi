# Grounding: Rollover-Only Fold Strategy

## GROUND-001 — Normal fold loop (to remove)
- Source: `conductors/my-customize-conductor/my-customize-conductor.ts` → lines 478–481
- Existing behavior: Iterates `sortCandidates(candidates)` where `candidates` = blocks with `order >= frozenFromIndex && !proactivelyCompressed`. Calls `applyCandidate(b, false)` until `live <= cap`.
- Current excerpt: `for (const b of sortCandidates(candidates)) { if (live <= cap) break; applyCandidate(b, false); }`
- Test prior art: `app/src/lib/engine/conductor.my-customize-conductor.test.ts`

## GROUND-002 — Non-frozen suffix grouping (to remove)
- Source: `my-customize-conductor.ts` → lines 532–535
- Existing behavior: Calls `groupRuns(view.blocks, block => block.order >= view.frozenFromIndex && !preGroupBlockIds.has(block.id))`, emits group for each run until `live <= cap`.
- Test prior art: `conductor.my-customize-conductor.test.ts`

## GROUND-003 — Escape valve (to remove)
- Source: `my-customize-conductor.ts` → line 278
- Existing behavior: `const escapeValveFires = preGroupTokens > preGroupTarget * PRE_GROUP_OVERFLOW_CAP;` where `PRE_GROUP_OVERFLOW_CAP = 1.25`.
- Source: `constants.ts` → line 2: `export const PRE_GROUP_OVERFLOW_CAP = 1.25;`
- Test prior art: `conductor.my-customize-conductor.test.ts`

## GROUND-004 — Epoch hold / stability gating (to remove)
- Source: `my-customize-conductor.ts` → lines 342–353
- Existing behavior: Three-layer hold: exact view-key match (line 343), projection hold band at 0.9× cap (line 352), semantic key check (line 342). Returns cached `lastPlan` when hold applies.
- Fields: `lastPlan` (line ~84), `lastSavings` (line ~85), `lastSemanticKey` (line 86), `lastViewKey` (line 88), `HOLD_BAND = 0.9` (line 59)
- Test prior art: `conductor.my-customize-conductor.test.ts`

## GROUND-005 — Reachability graph (to remove from main path)
- Source: `my-customize-conductor.ts` → line 367
- Import: `import { buildGraph, markReachable } from "../garbage-collector/edges";` (line 25)
- Existing behavior: `const marked = markReachable(buildGraph(view.blocks), roots)` where roots = protected + held + first user block. Used in `sortCandidates` comparator to put unreachable blocks first.
- Test prior art: `conductor.my-customize-conductor.test.ts`

## GROUND-006 — hardCap emergency brake (to keep)
- Source: `my-customize-conductor.ts` → lines 483–486 (frozen folds), lines 541–542 (frozen grouping)
- Existing behavior: When `live > hardCap`, folds/groups frozen-prefix blocks. Uses `applyCandidate(b, true)` with `breakFrozen: true` flag.
- Test prior art: `conductor.my-customize-conductor.test.ts`

## GROUND-007 — Pre-group rollover (to modify)
- Source: `my-customize-conductor.ts` → lines 273–290
- Existing behavior: Fast-path fires when `preGroupTokens >= preGroupTarget` + turn boundary + no open tool pairs. Escape valve at 1.25×. Calls `selectCompactionRange` → `tryEmitGroup`. Returns early with rollover group + `replayablePreviousGroups`.
- Test prior art: `conductor.my-customize-conductor.test.ts`, `extension/accordion.chunkedCompactionJsonl.test.ts`

## GROUND-008 — computePreGroupFromIndex (to modify)
- Source: `chunked-compaction.ts` → line ~45
- Signature: `computePreGroupFromIndex(view, target, isGroupBoundaryFn): number`
- Existing behavior: Walks backward from `protectedFromIndex`, accumulates tokens up to `target`, caps at `target * PRE_GROUP_OVERFLOW_CAP` (18.75k). Only looks at tail window, NOT full session.
- Test prior art: `conductor.my-customize-conductor.test.ts`

## GROUND-009 — Atomic rebase (to simplify into B2)
- Source: `my-customize-conductor.ts` → lines 233–234 (definition), lines 439–475 (main block)
- Existing behavior: Fires on first observed view OR budget drop. Selects wide compaction range, emits group, then runs fold loop. One-shot.
- Test prior art: `conductor.my-customize-conductor.test.ts`

## GROUND-010 — replayablePreviousGroups (to keep)
- Source: `my-customize-conductor.ts` → lines 121–136
- Signature: `replayablePreviousGroups(view, excludedIds?, priorPlan?): Command[]`
- Existing behavior: Filters prior group commands to those whose members are still live and either in non-frozen suffix or carry explicit digest string. Called at lines 290, 301, 461, 499.
- Test prior art: `conductor.my-customize-conductor.test.ts`

## GROUND-011 — finishConduct (to keep)
- Source: `my-customize-conductor.ts` → lines 147–182
- Signature: `finishConduct(plan, preGroupTokens, preGroupTarget, rolloverJustFired, memberIds): ConductorPlan`
- Existing behavior: Computes status metrics, memoizes result, returns `{ commands, preGroup: { memberIds } }`.

## GROUND-012 — MCP summary replaces (to move into rollover)
- Source: `mcp-summary.ts` → `mcpSummary` (line ~58), `isMcpResult` (line ~48), `toolResultSummary` (line ~121)
- Existing behavior: Called from `applyCandidate` when `isMcpResult(b)` is true. Emits `replace` command with identity-preserving summary. Shrinks MCP results from thousands of tokens to ~50 tokens.
- Test prior art: `conductor.my-customize-conductor.test.ts`

## GROUND-013 — isGroupBoundary (to keep)
- Source: `my-customize-conductor.ts` → lines 47–51
- Existing behavior: Returns true for `user` kind, `held`, `protected`, `grouped`, `toolName === "mcp"`, `toolName === "recall"`, pstack blocks. Groups split around these.

## GROUND-014 — constants
- Source: `constants.ts` → lines 1–4
- Values: `DEFAULT_PRE_GROUP_TOKENS = 15_000`, `PRE_GROUP_OVERFLOW_CAP = 1.25`, `MIN_CONTEXT_WINDOW_FOR_CHUNKED_COMPACTION = 128_000`

## GROUND-015 — Test infrastructure
- Framework: Vitest
- Main test: `app/src/lib/engine/conductor.my-customize-conductor.test.ts` (~50+ tests)
- Integration: `extension/accordion.chunkedCompactionJsonl.test.ts` (1 test)
- Invariant: `extension/chunked-compaction-invariant.test.ts` (4 tests)
- Run command: `npx vitest run` from `extensions/accordion/app/`
