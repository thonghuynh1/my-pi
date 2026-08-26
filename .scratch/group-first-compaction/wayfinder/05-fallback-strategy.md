# What's the fallback when grouping fails to meet cap?

Type: grilling
Status: resolved
Blocked by: 01, 02

## Question

After replacing `planFoldsToCap` with group batching, there will be edge cases where the group(s) don't bring `projected` under `cap`:

- All candidates fail `minimumSaving` threshold
- `trimOpenToolPairs` removes too many blocks
- The blocks are already folded/replaced (nothing left to group)

Should the fallback be:
1. **Retain a minimal `planFoldsToCap`** — only fires when group batching is insufficient (graceful degradation)
2. **Accept being over cap** — let the next rollover cycle catch up (simpler, but may cause token pressure)
3. **Lower the `minimumSaving` threshold** for overflow groups specifically

This affects correctness guarantees (does the conductor always get under cap within one cycle?).

## Answer

**No fallback. Accept being over cap temporarily.** Everything gets grouped; if still over cap after grouping, the next rollover cycle catches up. No individual folds exist as a fallback path. The design is groups-only, no exceptions.
