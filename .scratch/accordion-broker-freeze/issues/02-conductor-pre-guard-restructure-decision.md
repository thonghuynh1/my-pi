---
Status: closed
Labels: wayfinder:grilling
Assigned: agent
---

# Should the conductor's pre-fast-path O(n) work be restructured?

## Question

The MyCustomizeConductor's `conduct()` method performs 5–6 O(n) operations **before** the fast-path guard at line 482 can short-circuit. At 500 blocks, this means thousands of object allocations and string operations on every call — even when nothing has changed.

The fast-path guard checks `!this.dirty && previousViewKey === viewKey && blockCount === this.lastBlockCount && cap <= this.lastCap && liveTokens <= hardCap`. But `viewKey` itself costs O(n) to compute, so the guard can never be truly O(1).

**Options to decide between:**

A. **Cheap pre-guard**: Gate the expensive work on `blockCount !== this.lastBlockCount || this.dirty` first — if block count unchanged and not dirty, skip `viewKey` computation entirely (return cached plan). This is safe because block IDs can't change without block count changing or a fold/unfold marking dirty.

B. **Rolling hash**: Replace the O(n) `map+join` viewKey with an incrementally maintained hash (updated on block append/removal). Avoids the string allocation entirely.

C. **Move work after the guard**: Relocate `computePreGroupFromIndex`, `replayPriorCommands`, `noOpenToolPairAcrossPreGroupTail`, and the `preGroupBlocks` slice/filter/reduce chains to execute **only** when the fast path doesn't fire. They're only needed for rollover decisions.

D. **Combination**: A or B for the viewKey + C for everything else.

Which approach is correct given the conductor's invariants? Are there edge cases where block IDs change without block count changing (e.g., a replace operation)?

## Resolution

**Option D (A+C)** — O(1) pre-guard + move O(n) work below the guard.

- **O(1) pre-guard**: `!this.dirty && this.lastPlan && blockCount === this.lastBlockCount && cap <= this.lastCap && view.liveTokens <= hardCap && this.lastResult` — returns `this.lastResult` directly, bypassing `finishConduct()` entirely (no status update or metric recomputation needed since nothing changed).
- **Move O(n) work below guard**: `viewKey`, `computePreGroupFromIndex`, `preGroupBlocks` chains, `replayPriorCommands`, `noOpenToolPairAcrossPreGroupTail`, and `newPreGroupTokens` execute only when the pre-guard fails.
- **Safety basis**: Block IDs are content-anchored and append-only in production — `viewKey` is provably redundant when `blockCount` unchanged and `!dirty`. Proactive compression (PCC) never fires, so no additional `liveTokens` equality check is needed.
- **Existing fast-path guard** (line 482) remains as a secondary guard after `viewKey` is computed — no behavioral change.

**Ledger**: `.scratch/grills/2fd90f23ecf9/ledger.md`
