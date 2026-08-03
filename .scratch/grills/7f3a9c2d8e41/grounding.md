# Grounding

## Current implementation

- `extensions/accordion/conductors/my-customize-conductor/my-customize-conductor.ts::MyCustomizeConductor.conduct`
  - Computes `cap = availableCap(view)`.
  - Excludes pre-group blocks from ordinary fold candidates.
  - Plans ordinary replacement/fold savings first.
  - Runs the `Early rollover` branch only when projected `live > cap` after those planned savings.
  - Therefore ordinary folding can satisfy a newly lowered budget and suppress rollover for that pass; a later turn can make the pre-group trigger fire and cause a second prefix-changing action.
- `extensions/accordion/app/src/lib/engine/conductor.compaction-naive.test.ts`
  - Existing tests cover early rollover when no ordinary candidate resolves pressure and assert that rollover emits a group without folds.
  - No located test covers the reported sequence: large existing session → lower budget → ordinary fold makes it fit → next turn causes rollover.

## Architectural constraints

- `docs/adr/0004-accordion-chunked-compaction.md`
  - Defines rollover as deterministic, synchronous, single-pass `GroupCommand` emission.
  - States the intended cache contract as at most one KV-cache-prefix break per rollover.
  - Uses `estimatedGroupSaving >= max(2_000, 0.05 * cap)` as the minimum-savings gate.
  - Says broker and direct modes use the same conductor instance/policy; broker mode is not a separate compaction algorithm.

## Throwaway logic prototype

- Following the Engineering Skills `prototype` logic branch, production conductor and test changes were removed.
- Pure state model: `extensions/accordion/conductors/my-customize-conductor/budget-rebase.prototype-logic.mjs`.
- Interactive terminal shell: `extensions/accordion/conductors/my-customize-conductor/budget-rebase.prototype.mjs`.
- Run command: `npm run prototype:accordion-budget-rebase`.
- The prototype compares the current fold-first policy with a one-time rebase policy while displaying live tokens, ready raw tokens, grouping/folding totals, last plan, and cache-invalidation count after every action.
- First prototype target (90% of cap) failed under sustained growth: after nineteen 4k turns, current behavior had 6 invalidations while rebase had 11 because 7k runway was smaller than the 15k batching interval.
- Revised prototype makes the rebase one atomic plan (`group + any additional folds`) targeting `min(90% of cap, cap − preGroupTarget)`. At a 70k cap this is 55k, enough runway to reach the next 15k group.
- Scripted revised scenario (`lower 100k → 70k`, then nineteen 4k turns) reports 6 invalidations for current behavior and 5 for atomic rebase behavior.
- Both prototype files pass `node --check`; no production tests were added because the prototype skill requires throwaway interactive code rather than production enactment.

## PRD contradiction

- `extensions/accordion/app/src/lib/ui/map/MapHeader.svelte` → `BUDGET_MIN = 12_000` and budget controls clamp to that value.
- `extensions/accordion/app/src/lib/engine/store.svelte.ts` → `AccordionStore.setBudget()` accepts values down to 1,000.
- `extensions/accordion/conductors/my-customize-conductor/constants.ts` → `DEFAULT_PRE_GROUP_TOKENS = 15_000`.
- Therefore the accepted target `min(HOLD_BAND × cap, cap − preGroupTarget)` becomes negative for supported low-budget inputs; the returned decision raises the human minimum to 50k and gates atomic rebase below `preGroupTarget`.

### GROUND-001 — Current compaction ordering
- Source: `extensions/accordion/conductors/my-customize-conductor/my-customize-conductor.ts` → `MyCustomizeConductor.conduct`
- Existing behavior: derives the pre-group and proactive rollover first, but under unresolved budget pressure plans ordinary replacements/folds before the `Early rollover` branch. If those folds reach `cap`, early rollover does not run.
- Current excerpt: `for (const b of sortCandidates(candidates)) { if (live <= cap) break; applyCandidate(...) }` precedes `if (live > cap && preGroupBlocks.length >= 2) { ... tryEmitGroup(...) }`.
- Test prior art: `extensions/accordion/app/src/lib/engine/conductor.compaction-naive.test.ts` → `early rollover emits a chunked-compaction group when liveTokens exceeds cap and pre-group has enough saving`.

### GROUND-002 — Safe deterministic group selection
- Source: `extensions/accordion/conductors/my-customize-conductor/chunked-compaction.ts` → `selectCompactionRange`, `trimOpenToolPairs`, `estimateDefaultGroupDigestCost`
- Existing behavior: selects complete-turn ranges bounded by held/grouped/proactively-compressed blocks, trims straddling tool pairs, and estimates deterministic group savings.
- Test prior art: `extensions/accordion/app/src/lib/engine/conductor.compaction-naive.test.ts` → `early rollover trims a tool_call that has an open partner in the protected tail`.

### GROUND-003 — Complete-plan application seam
- Source: `extensions/accordion/app/src/lib/engine/store.svelte.ts` → `AccordionStore.runConductor`, `AccordionStore.applyCommands`
- Existing behavior: resets conductor-owned mutable state, requests one complete desired `Command[]`, and applies the entire batch before recording transitions.
- Current excerpt: `result = this.conductor ? this.conductor.conduct(this.buildView(protectedFrom)) : [];` followed by `this.applyCommands(cmds, by)`.
- Test prior art: `extensions/accordion/app/src/lib/engine/conductor.compaction-naive.test.ts` → `walking skeleton group is applied by the engine across the frozen boundary`.

### GROUND-004 — Structural disposition non-overlap
- Source: `extensions/accordion/conductors/my-customize-conductor/my-customize-conductor.ts` → final command assembly in `conduct`
- Existing behavior: tracks `groupedIds`, filters replacement and fold commands that target grouped members, then emits one command array.
- Test prior art: `extensions/accordion/app/src/lib/engine/conductor.my-customize-conductor.test.ts` → `does not give a block both a group and another structural disposition`.

### GROUND-005 — Budget control boundaries
- Source: `extensions/accordion/app/src/lib/ui/map/MapHeader.svelte` → `BUDGET_MIN`, editable budget `oncommit`, and range input
- Existing behavior: the human controls clamp at 12,000 tokens.
- Source: `extensions/accordion/app/src/lib/engine/store.svelte.ts` → `AccordionStore.setBudget`
- Existing behavior: programmatic budgets clamp at 1,000 and immediately call `refold()`.
- Test prior art: no existing MapHeader budget-boundary test; Vitest config assigns `src/lib/ui/**/*.test.ts` to jsdom and supports a focused component test.

### GROUND-006 — Governing architecture
- Source: `docs/adr/0005-turn-aligned-chunked-compaction-and-mcp-retrieval.md`
- Existing behavior: accepted ADR requires complete structural units, hard barriers for held/existing-group/proactively-compressed blocks, canonical chronology, and balanced tool pairs. It supersedes ADR-0004's block-level boundaries.
- Related retained constraint: ADR-0004 documents synchronous deterministic `GroupCommand` emission, shared direct/broker policy, the minimum-savings gate, and the one-prefix-break intent where not superseded by ADR-0005.

## PRD findings

- Incorporated: accepted atomic rebase, full-runway target, conductor-local trigger lifecycle, 50k human minimum, defensive low-cap fallback, existing safe range rules, and complete-plan store application.
- Rejected: applying under-target rebase on every over-cap pass; prototype showed more invalidations under sustained growth.
- Returned to grill and resolved: supported caps below the 15k pre-group target.
