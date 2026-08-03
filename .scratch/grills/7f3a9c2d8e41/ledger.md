# Grill ledger

Status: consumed by `.scratch/accordion-atomic-budget-rebase/PRD.md`.

## Goal

Reduce Accordion KV-cache invalidations when `my-customize-conductor` reacts to a newly lowered budget on a large existing session.

## Decisions

### D1 — Over-budget compaction priority

- Status: accepted
- Decision: Use rollover-first atomic planning. When `liveTokens > cap` and an eligible pre-group passes existing validity and minimum-savings gates, plan its deterministic group before ordinary folds/replacements. Add any remaining compaction needed to satisfy the cap in the same conductor pass; use fold-only fallback when no valid group exists.
- Rationale: avoids a temporary fold-only request followed by a group rewrite on a later turn, while preserving a safe fallback.
- Evidence: `MyCustomizeConductor.conduct()` currently plans ordinary replacements/folds first and checks early rollover only if projected `live` remains above `cap` afterward.
- Dependencies: none.

### D2 — Trigger scope

- Status: superseded
- Prior decision: Apply rollover-first to every pass where `liveTokens > cap`.
- Superseded by: D3. Sustained prototype use showed that broad pressure-triggered rebasing can increase cache invalidations.
- Depends on: D1.

### D3 — One-time atomic budget rebase

- Status: accepted
- Decision: Distinguish a budget reduction from routine context growth. On a reduction that leaves the session over cap, emit one atomic plan containing a group plus any additional folds needed to reach `min(HOLD_BAND × cap, cap − preGroupTarget)`. Resume normal 15k batching afterward.
- Rationale: the full pre-group interval prevents small fold-only invalidations while waiting for the next normal rollover. The interactive behavior matches the user's intent.
- Evidence: The prototype disproved a 90%-only runway: over nineteen 4k turns it caused 11 invalidations versus 6 current. The accepted atomic full-runway rebase produced 5 invalidations versus 6 current in the same scenario.
- Prototype: `extensions/accordion/conductors/my-customize-conductor/budget-rebase.prototype-logic.mjs` with terminal shell `budget-rebase.prototype.mjs`; run via `npm run prototype:accordion-budget-rebase`.
- Depends on: D1.

### D4 — Rebase detection boundary

- Status: accepted
- Decision: Trigger an atomic rebase on the conductor's first over-cap view and whenever an observed budget reduction creates an over-cap state. Each trigger is consumed once; unchanged-budget passes use normal batching.
- Rationale: covers both attach-before-slider and attach-after-slider sequences without expanding the conductor or broker contracts.
- Evidence: `MyCustomizeConductor` already owns session-local planning state, so first-view and prior-budget tracking remain local to the policy.
- Depends on: D3.

### D5 — Human budget minimum and defensive low-cap behavior

- Status: accepted
- Decision: Raise the human-facing budget slider and editable control minimum to 50,000 tokens. Keep `AccordionStore.setBudget()` capable of lower programmatic values. Gate atomic rebasing on `cap >= preGroupTarget`; lower effective caps use the existing safe fold planner.
- Rationale: a sub-50k human budget is not useful for the intended large-session workflow, while retaining the store's low-value support avoids breaking tests, restored sessions, small-context models, or non-UI callers. The defensive gate prevents the runway formula from becoming negative.
- Evidence: `MapHeader.svelte` owns the current 12k human minimum; `AccordionStore.setBudget()` separately clamps at 1k; `DEFAULT_PRE_GROUP_TOKENS` is 15k.
- Depends on: D3.
