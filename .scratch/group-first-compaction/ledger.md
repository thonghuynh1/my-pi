# Group-First Compaction — Grill Ledger

## Decisions

| # | Decision | Status | Rationale | Dependencies |
|---|----------|--------|-----------|--------------|
| 1 | Single vs chunked groups for overflow batching | accepted | Chunked ~15k (scaling to 30k). Cache breaks accepted as trade-off. | — |
| 2 | Overflow group lifecycle | accepted | `"rollover"`. Individual folds eliminated; groups are sole primitive. | D1 |
| 3 | planNormalPressure scope | accepted | In scope — all compaction uses groups, no individual folds anywhere. | D1, D2 |
| 4 | trimOpenToolPairs handling | accepted | Inherited from `createGroup` internals. No special logic. | D1 |
| 5 | Fallback when grouping fails | accepted | No fallback. Accept over-cap temporarily; next cycle catches up. | D1, D2 |
