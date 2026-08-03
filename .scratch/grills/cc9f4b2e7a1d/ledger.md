# Grill Ledger: Rollover-Only Fold Strategy

Status: consumed
PRD: `.scratch/conductor-rollover-only-strategy/PRD.md`

## Context
Reworking `my-customize-conductor` to consolidate all fold/replace/group decisions into rollover events only, eliminating between-rollover cache invalidations.

## Decisions

### D1: Fold timing model
- Status: accepted
- Choice: Rollover-only. No between-rollover folds. All fold/replace/group decisions consolidated into rollover events.
- Rationale: Eliminates the 13 separate cache invalidation events. Each rollover = exactly 1 cache break.

### D2: Rollover trigger threshold
- Status: accepted
- Choice: B2 — dynamic trigger. Rollover fires when `pre-group ≥ (live - cap)` AND on a turn boundary.
- Rationale: Naturally adapts to overage size. Always 1 cache break to get back to budget.
- Safety: hardCap (context window limit) forces immediate rollover regardless.

### D3: Late-attach behavior
- Status: accepted
- Choice: Same as steady-state. First view triggers B2 dynamic threshold. Entire non-protected region becomes pre-group, sliced into N × 15k groups in one plan.
- Rationale: No special-case needed. B2 naturally handles it.

### D4: MCP/recall/pstack block handling
- Status: accepted
- Choice: Keep MCP as group boundaries. Apply MCP summary replaces to MCP blocks inside pre-group zone at rollover time (free — same cache break).
- Rationale: MCP stays visible to model (prevents miss-follow). Replace is free at rollover time.

### D5: Kind-gate vs grouping
- Status: accepted (non-issue)
- Finding: FOLDABLE_KINDS only prevents individual folding. Group collapse can contain tool_call/user. No conflict.

### D6: Between-rollover over-budget tolerance
- Status: accepted
- Choice: Tolerate over cap between rollovers. Only hardCap is emergency brake.

### D7: Interaction with proactive content compression
- Status: accepted (out of scope)
- Finding: PCC effectively never fires when Accordion is active (context hook folds before PCC's before_provider_request runs). This is a separate issue to track outside this grill.

### D8: Existing fold paths disposition
- Status: accepted
- Choice: Remove normal fold loop (path 2) and non-frozen suffix grouping (path 4). Keep hardCap emergency brakes (paths 3, 5). Simplify atomic rebase into B2 rollover.
- Rationale: Paths 2 and 4 are the source of between-rollover cache breaks. Paths 3 and 5 are last-resort safety nets that rarely fire.

### D9: Escape valve removal
- Status: accepted
- Choice: Remove the 18.75k (1.25×) escape valve. Let pre-group grow freely until B2 dynamic threshold fires.

### D10: Epoch hold / stability gating
- Status: open

### D11: Reachability graph / scoring
- Status: open
