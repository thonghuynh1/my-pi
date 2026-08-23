# 08 — Should Proactive Content Compression be removed?

Type: grilling
Status: open
Blocked by: 07

## Question

With richer fold digests (ticket 07) and pre-computed digest caching in the conductor, the conductor now folds blocks with structured summaries as they leave the protected tail. PCC was introduced to solve the Frozen-Prefix Deadlock — large tool_results becoming frozen at full size before the conductor could act. If the conductor now handles blocks before they reach the frozen prefix, PCC may be redundant complexity.

### Sub-questions

1. **Is there still a race between provider request and conductor fold?**
   - Today: block arrives → `before_provider_request` (PCC shrinks) → frozen prefix advances → `conduct()` runs
   - Without PCC: block arrives → provider request fires (full size) → frozen prefix includes it → conduct() runs (too late?)
   - Does the Pre-Group Interval guarantee blocks are folded before they age into the frozen zone?

2. **What does PCC's removal simplify?**
   - No more `proactivelyCompressed` flag on blocks
   - No more `originals` Map in extension process (volatile, two-process split concern)
   - No more A1 Exemption List
   - No more "proactively-compressed" clamp reason in substOne
   - Recall path simplification: no more `resolveOriginals()` bypass
   - ViewBlock no longer needs `proactivelyCompressed` field

3. **What guarantees must the conductor provide to replace PCC safely?**
   - Every block must be folded (with rich digest) before it can enter the frozen prefix at full size
   - Or: `breakFrozen` + rich digest must handle the case where a block slips through unfoldable

4. **Migration path?**
   - Can PCC be removed in one slice, or does it need a feature flag / gradual rollout?
   - Existing sessions with PCC blocks in-flight — what happens on upgrade?

## Constraints

- Must not regress the frozen-prefix deadlock (the original problem PCC solved)
- Must not break recall for blocks that were previously PCC'd (migration concern)
- Conductor's dirty-guard performance must remain O(1) for no-op passes
