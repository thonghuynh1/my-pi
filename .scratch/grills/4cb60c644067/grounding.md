# Grounding — Pre-Group Fold Exemption

## GROUND-001 — allCandidates filter
- Source: `conductors/my-customize-conductor/my-customize-conductor.ts` → `allCandidates` (lines 206–208)
- Existing behavior: `view.blocks.filter((b) => !b.held && !b.protected && !b.grouped && b.foldedTokens < b.tokens && FOLDABLE_KINDS.has(b.kind))` — includes pre-group blocks
- Test prior art: No direct test of `allCandidates`. Downstream effects tested in `conductor.compaction-naive.test.ts`

## GROUND-002 — candidates filter (frozenFromIndex)
- Source: `conductors/my-customize-conductor/my-customize-conductor.ts` → `candidates` (lines 209–211)
- Existing behavior: `allCandidates.filter((b) => b.order >= view.frozenFromIndex && !b.proactivelyCompressed)`
- Current excerpt: Secondary filter for non-frozen, non-PCC blocks

## GROUND-003 — computePreGroupFromIndex
- Source: `conductors/my-customize-conductor/my-customize-conductor.ts` → line 161 (inside `if (preGroupTarget > 0)` block at line 160)
- Existing behavior: `chunkedCompaction.computePreGroupFromIndex(view, preGroupTarget, (block) => isChunkedPreGroupBoundary(block, pstackByBlockId))`
- Note: Currently scoped inside `if (preGroupTarget > 0)` — must be hoisted for exemption filter

## GROUND-004 — Budget check early return
- Source: `conductors/my-customize-conductor/my-customize-conductor.ts` → lines 197–204
- Existing behavior: `if (view.liveTokens <= cap)` clears epoch state and returns `[]`

## GROUND-005 — Rollover GroupCommand emission
- Source: `conductors/my-customize-conductor/my-customize-conductor.ts` → lines 170–195
- Existing behavior: `if (fastPathFires || escapeValveFires)` emits `[{ kind: "group", ids, digest }]` and returns early

## GROUND-006 — accordion.ts empty-plan branch
- Source: `extension/accordion.ts` → line 1170
- Existing behavior: `if (plan.ops.length === 0 && plan.groups.length === 0)` skips `applyPlan` and `cacheTracker.observeMessages`
- Bare `return;` at ~line 1229 passes messages through unchanged

## GROUND-007 — accordion.ts hold-last-plan
- Source: `extension/accordion.ts` → lines 1173–1178
- Existing behavior: `shouldHoldLastPlan = lastNonEmptyPlan !== null && !plan.steeringOff && contextWindow !== null && originalTokensApprox > Math.max(0, contextWindow - 8_192)`
- Only fires when tokens are within 8k of context window — not triggered by pre-group overshoot in typical scenarios

## GROUND-008 — accordion.ts applyPlan + cacheTracker
- Source: `extension/accordion.ts` → lines 1233–1234
- Existing behavior: `applyPlan(originalMessages, plan.ops, plan.groups)` then `cacheTracker.observeMessages(messagesForModel, latestModel?.provider)` — only reached on non-empty plans

## GROUND-009 — FOLDABLE_KINDS
- Source: `conductors/cold-score/score.ts` → lines 38–42
- Existing behavior: `Set(["text", "thinking", "tool_result"])` — `user` and `tool_call` excluded

## GROUND-010 — chunked-compaction-invariant.test.ts
- Source: `extension/chunked-compaction-invariant.test.ts`
- Test prior art: 4 tests verifying `count(rollover) == cacheBreaks - coldStarts`
- Command: `cd extensions/accordion/app && npx vitest run ../extension/chunked-compaction-invariant.test.ts`

## GROUND-011 — conductor.compaction-naive.test.ts
- Source: `app/src/lib/engine/conductor.compaction-naive.test.ts` → lines 1620–1820
- Test prior art: Tests `preGroupTokens`, `preGroupFillPct` in setStatus metrics; tests `trimOpenToolPairs`; tests frozen-grouping pressure valve
- Command: `cd extensions/accordion/app && npx vitest run src/lib/engine/conductor.compaction-naive.test.ts`

## GROUND-012 — resolveUnfold chunked-compaction group member
- Source: `app/src/lib/live/plan.ts` → lines 148–157
- Existing behavior: `isChunkedCompactionGroupMember(store, b)` → `store.appendToTail(b.id)` — tail-append, group stays immutable

## GROUND-013 — constants
- Source: `conductors/my-customize-conductor/constants.ts`
- Values: `DEFAULT_PRE_GROUP_TOKENS = 15_000`, `PRE_GROUP_OVERFLOW_CAP = 1.25`, `MIN_CONTEXT_WINDOW_FOR_CHUNKED_COMPACTION = 128_000`
