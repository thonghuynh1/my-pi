# Frozen Prefix Blocks Folding in Rapid Small-Turn Conversations

**Filed:** 2026-08-31
**Severity:** Product limitation — Accordion cannot fold when turns are small and frequent
**Reproducer:** `F:/MyWork/benchmark/results/accordion-real/luna-medium-tiny/`

---

## Summary

When a conversation consists of many small turns (~4k tokens each), the cache tracker's frozen prefix grows faster than the block count, leaving the conductor with **zero foldable blocks**. The conductor emits empty plans every turn despite `budgetExceeded: true` and context growing to 840k tokens (12× the 70k budget).

The same conductor folds correctly with fewer large turns (~40k each) targeting the same total context size.

## Evidence

### Working: 12 large turns (~40k each)

Diagnostics: `~/.accordion/diagnostics/s-26764-1788179900541.context.jsonl`

| Turn | Blocks | Frozen | Foldable | Orig tokens | Result |
|------|--------|--------|----------|-------------|--------|
| 1    | 1      | 0      | 1        | 52,563      | empty  |
| 2    | 3      | 0      | 3        | 106,828     | **FOLD** |
| 5    | 9      | 0      | 9        | 218,496     | **FOLD** |
| 8    | 15     | 0      | 15       | 328,605     | **FOLD** |
| 12   | 24     | 0      | 24       | 441,905     | **FOLD** |
| 17   | 34     | 0      | 34       | 659,348     | **FOLD** |

`frozenFromIndex` = **0 every turn**. All blocks are foldable. 16 reducing fold plans executed. Final compression: 659k → 53k (92%).

### Broken: 120 small turns (~4k each)

Diagnostics: `~/.accordion/diagnostics/s-34348-1788182857031.context.jsonl`

| Turn | Blocks | Frozen | Foldable | Orig tokens | Budget exceeded | Result |
|------|--------|--------|----------|-------------|-----------------|--------|
| 1    | 1      | 0      | 1        | 5,307       | no              | empty  |
| 2    | 3      | 0      | 3        | 10,948      | YES             | empty  |
| 5    | 9      | 6      | 3        | 32,073      | YES             | empty  |
| 7    | 13     | 12     | 1        | 46,146      | YES             | empty  |
| **8**| **15** | **15** | **0**    | 53,187      | YES             | empty  |
| 9    | 17     | 18     | **−1**   | 60,219      | YES             | empty  |
| 20   | 39     | 51     | −12      | 137,591     | YES             | empty  |
| 60   | 119    | 171    | −52      | 418,946     | YES             | empty  |
| 120  | 239    | 351    | −112     | 840,938     | YES             | empty  |

`frozenFromIndex` **overtakes** `blocksTotal` by turn 8. Zero fold plans in 120 turns. Context grew to 840k unchecked.

### Cost comparison (same model, same target, same budget)

|                    | 12 large turns | 120 small turns |
|--------------------|---------------|-----------------|
| Baseline cost      | $0.302        | $1.755          |
| Accordion cost     | $0.128        | $1.273          |
| Cost savings       | **57.6%**     | 27.4%           |
| Fold plans         | 16            | **0**           |
| Max context seen   | 42,882        | 488,848         |
| Real folding?      | ✅ Yes        | ❌ No           |

The 27.4% "savings" in the small-turn run is from extension overhead differences, not from folding.

## Root Cause Analysis

### The frozen prefix race condition

The cache tracker (`cacheTracker` in diagnostics) matches the provider's prompt cache prefix. With small rapid turns:

1. Each turn adds **2 messages** (user + assistant) = typically **2 blocks**
2. The cache tracker advances `frozenFromIndex` by **3 block indices** per turn (matched prefix grows by user + assistant + next-user)
3. `frozenFromIndex` grows at **1.5× the rate of `blocksTotal`**
4. By turn 8, `frozenFromIndex ≥ blocksTotal` → **zero foldable blocks**
5. The conductor cannot fold frozen blocks (they're protected to preserve the provider's prompt cache savings)

With large turns, the provider's prompt cache doesn't match the prefix (each turn's content is too large or varies too much), so `frozenFromIndex` stays at 0.

### Why `budgetExceeded: true` doesn't help

The conductor checks `budgetExceeded` but it only matters if there are foldable blocks. The decision flow is:

```
context hook fires
  → cache tracker computes frozenFromIndex
  → conductor sees foldable_blocks = blocksTotal - frozenFromIndex
  → if foldable_blocks ≤ 0: emit empty plan (nothing to fold)
  → budget check is irrelevant since there's no material to work with
```

### Relevant code paths

| File | Location | What it does |
|------|----------|-------------|
| `extension/accordion.ts` | cache tracker | Computes `frozenFromIndex` from prefix match |
| `conductors/my-customize-conductor/my-customize-conductor.ts` | `planRollover` ~L200 | Checks `rolloverEnabled` and `canRollover` |
| `conductors/my-customize-conductor/chunked-compaction.ts` | `selectCompactionRange` ~L170 | Trims range to exclude frozen blocks; returns null if range collapses |
| `conductors/my-customize-conductor/chunked-compaction.ts` | `effectivePreGroupTokens` L13 | Returns 0 if `contextWindow < 128k` (secondary gate) |
| `conductors/my-customize-conductor/constants.ts` | L3 | `MIN_CONTEXT_WINDOW_FOR_CHUNKED_COMPACTION = 128_000` |
| `conductors/my-customize-conductor/my-customize-conductor.ts` | `sliceCandidateRunsIntoGroups` ~L315 | 15k flush threshold favors large blocks |
| `conductors/my-customize-conductor/my-customize-conductor.ts` | `createGroup` | Returns null if `ids.length < 2` after `trimOpenToolPairs` |

### Secondary gates that compound the problem

Even if the frozen prefix were relaxed, several other thresholds disfavor small messages:

1. **`MIN_CONTEXT_WINDOW_FOR_CHUNKED_COMPACTION = 128,000`** — if `contextWindow` reported by the model is below this, all rollover-based grouping is disabled entirely. (Not the blocker here since gpt-5.6-luna reports 1.1M, but would block smaller models.)

2. **`DEFAULT_PRE_GROUP_TOKENS = 15,000`** — the `newPreGroupTokens >= preGroupTarget` gate requires 15k of new (non-previously-grouped) tokens before triggering a rollover. With 4k turns, this needs 4 new turns minimum. With 40k turns, 1 turn triggers immediately.

3. **`sliceCandidateRunsIntoGroups` flush at 15k** — groups candidates into 15k slices. Small messages (4k) need 4+ to fill a slice; large messages (40k) fill immediately.

4. **`trimOpenToolPairs`** — removes blocks whose tool-call partner is outside the candidate set. With few small candidates, this can reduce `ids.length` below 2, returning null from `createGroup`.

5. **`isAccumulationBoundary`** — stops the pre-group window at any held/folded block. If earlier small messages were somehow folded, this truncates the accumulation window and stalls further rollovers.

## Suggested Investigation Paths

### Path A: Allow folding frozen blocks when budget is critically exceeded

The frozen prefix exists to preserve prompt-cache savings. But when context is 12× the budget, the cache savings are irrelevant — the session will degrade anyway. Consider:

```
if budgetExceeded && originalTokens > budget * N:
    // relax frozenFromIndex to allow folding old frozen blocks
    effectiveFrozen = min(frozenFromIndex, blocksTotal - minFoldableBlocks)
```

This is the most impactful fix since it addresses the root cause directly.

### Path B: Cap frozen prefix growth rate

Instead of letting `frozenFromIndex` grow unboundedly, cap it relative to `blocksTotal`:

```
effectiveFrozen = min(frozenFromIndex, floor(blocksTotal * 0.7))
```

This guarantees at least 30% of blocks are always foldable.

### Path C: Lower the secondary thresholds for small-message conversations

- Reduce `DEFAULT_PRE_GROUP_TOKENS` from 15k to 4k when average message size is below some threshold
- Reduce the `sliceCandidateRunsIntoGroups` flush threshold proportionally
- These are lower-priority since they only matter once the frozen-prefix blocker is resolved

### Path D: Detect the failure mode and warn

At minimum, if `budgetExceeded && foldableBlocks <= 0` for N consecutive turns, emit a diagnostic warning or status like `"frozen-prefix-stall"` so the user/benchmark knows Accordion is unable to fold.

## Reproduction

```powershell
cd F:\MyWork\benchmark

# Generate the 120-turn workload
python scripts/generate_accordion_workload.py --spec workloads/accordion-480k-tiny-spec.json --output .scratch/accordion-480k-tiny.json

# The full benchmark results are at:
#   results/accordion-real/luna-medium-tiny/baseline/summary.json
#   results/accordion-real/luna-medium-tiny/accordion/summary.json
#   ~/.accordion/diagnostics/s-34348-1788182857031.context.jsonl  (120 empty plans)

# Compare against the successful 12-turn run:
#   results/accordion-real/luna-medium/baseline/summary.json
#   results/accordion-real/luna-medium/accordion/summary.json
#   ~/.accordion/diagnostics/s-26764-1788179900541.context.jsonl  (16 fold plans)
```

## Workload specs

- **12-turn (works):** `workloads/accordion-400k-spec.json` — 12 × 32,000 words
- **120-turn (broken):** `workloads/accordion-480k-tiny-spec.json` — 120 × 3,200 words
- Both target 350k raw history, same vocabulary, same quality markers

## Related files

- Benchmark harness: `accordion_real_benchmark.py`
- Workload generator: `scripts/generate_accordion_workload.py`
- Browser controller: `scripts/accordion_browser_control.mjs`
- Benchmark docs: `docs/ACCORDION-REAL-COST.md`
- Visual report (12-turn valid run): `.lavish/accordion-benchmark-report.html`

## Comments

**2026-08-31 — stall recovery (rollover group, not breakFrozen).** Soft budget must not honor `breakFrozen` (ADR 0003 / DEC-012). When `frozenFromIndex >= protectedFromIndex` and live tokens exceed `availableCap` with a known window, `MyCustomizeConductor` emits one `lifecycle: "rollover"` group from index 0. That is the host-legal cache break (ADR 0004). Hard-cap emergency + `breakFrozen` stay reserved for real context-window overflow. Partial frozen prefixes (`frozenFromIndex < protectedFromIndex`) still skip the cached prefix.
