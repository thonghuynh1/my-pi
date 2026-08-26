# What lifecycle should the overflow groups use?

Type: grilling
Status: resolved

## Question

Rollover groups use `lifecycle: "rollover"` which lets them cross the frozen boundary in `replayPriorCommands`. The transient group from `planNormalPressure` uses `lifecycle: "transient"`.

The new overflow groups (replacing `planFoldsToCap`) need a lifecycle decision:

- **`"rollover"`** — They persist across replanning cycles and cross the frozen boundary. Consistent with the rollover group they supplement. But they represent overflow, not the primary rollover target.
- **`"transient"`** — They're rebuilt each cycle. But then they won't replay via `replayPriorCommands`, which defeats the stability benefit.
- **New lifecycle `"overflow"`** — Explicit semantics for post-rollover cleanup groups. Would need new handling in replay logic.

This decision affects replay stability, plan size growth, and whether the groups accumulate or get recreated each cycle.

## Answer

**`lifecycle: "rollover"`**. Overflow groups persist and replay stably, same as primary rollover groups. Broader intent: individual folds should not exist — all compaction should be groups. This makes groups the sole compaction primitive.
