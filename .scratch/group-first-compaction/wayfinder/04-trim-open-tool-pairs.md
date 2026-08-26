# How to handle trimOpenToolPairs constraints in batch grouping?

Type: grilling
Status: resolved
Blocked by: 01

## Question

`trimOpenToolPairs` is applied to avoid grouping across incomplete tool_use/tool_result pairs. Currently `planFoldsToCap` folds blocks individually so it naturally skips problematic ones. A batch group needs to handle this differently:

- Does `createGroup` already call `trimOpenToolPairs` internally? (Need to verify.)
- If a tool pair straddles the candidate set boundary, should we: (a) exclude both blocks, (b) split into two groups around the pair, or (c) extend the group to include the full pair?
- How does `sliceSegmentIntoGroups` handle this? (It calls `trimOpenToolPairs` per slice — verify behavior at slice boundaries.)

This is a technical constraint that shapes the implementation.

## Answer

**Already handled internally by `createGroup`.** Verified: `createGroup` calls `trimOpenToolPairs` on its candidates before building the group. Since overflow batching reuses `createGroup` (or `sliceSegmentIntoGroups` which also calls it per slice), the constraint is inherited. No special handling needed — the existing infrastructure handles it.
