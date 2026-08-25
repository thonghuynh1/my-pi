# 01 — Restore-in-frozen-prefix causes the flip-flop cycle

Type: grilling
Status: resolved

## Question

The restore phase in `conduct()` (my-customize-conductor.ts ~line 290) finds folded blocks inside the frozen prefix and emits restore commands:

```ts
const restores = preGroupTarget > 0
    ? view.blocks.filter((block) => block.order < view.frozenFromIndex && block.folded && !block.grouped && !block.held && !block.protected)
    : [];
if (restores.length > 0) {
    const plan: Command[] = [{ kind: "restore", ids: restores.map((block) => block.id) }];
    // returns early — no compensating folds
    return this.finishConduct(plan, ...);
}
```

**The cycle:**
1. Turn N: conductor folds blocks A,B,C to fit 120k→70k budget. Provider caches the folded payload.
2. Turn N+1: `frozenFromIndex` advances. Blocks A,B are folded AND inside frozen prefix. Restore fires → unfolds A,B (breaks cache). Returns early — no folds.
3. Turn N+2: `liveTokens` now >70k (A,B restored). Conductor folds different blocks D,E. Cache already broken.
4. Turn N+3: `frozenFromIndex` advances again. D,E are now folded in frozen prefix → restore fires again → breaks cache.
5. Repeat indefinitely.

**Decision needed:** Should the conductor:
(a) Never restore blocks in the frozen prefix — treat them as already compacted, rollover only operates on unfrozen blocks?
(b) Keep restore but combine it with rollover in one atomic plan (don't return early)?
(c) Only restore when a rollover is actually going to fire in the same conduct() call?

The core trade-off: the restore exists so rollover can group those blocks with their neighbors. But restoring a frozen-prefix block ALWAYS breaks cache, and the early return means no rollover compensates in the same plan.

## Answer

**Decision: Option (a) — Never restore blocks in the frozen prefix.**

The restore phase must be removed entirely. The rationale:

1. **The cache has the folded content.** When `block.folded && block.order < frozenFromIndex`, the provider's cache already contains the folded/replaced version. Restoring it changes the prefix → breaks cache.
2. **The early return creates a two-phase cycle with no guarantee of phase 2.** Restore returns immediately with no folds. Next `conduct()` may not trigger rollover (pair safety, minimum savings, etc.), so the cache break was for nothing.
3. **Rollover should respect the frozen boundary instead** (see ticket 02). Rather than restoring frozen blocks to group them, rollover should only operate on unfrozen blocks.
4. **Folded blocks in the frozen prefix are already compacted** — they're doing their job (saving tokens). Re-expanding them to re-group differently is wasteful cache churn.

**Implementation:** Delete the `restores` block entirely (~10 lines). This is safe because ticket 02 will clamp `rolloverFromIndex` to `frozenFromIndex`, so rollover never needs to consume frozen folded blocks.
