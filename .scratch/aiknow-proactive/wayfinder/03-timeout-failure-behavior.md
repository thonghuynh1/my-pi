# 03 — Timeout, failure, and unindexed repo behavior

Type: grilling
Status: resolved
Blocked by: 01

## Question

The scratch file says "entire hook must finish in < 500ms" and "never block agent start." But several edge cases need decisions:

1. **Unindexed repo**: User opens a repo aiKnow hasn't indexed yet. Options: (a) silently inject nothing, (b) inject a "run aiknow index" hint, (c) trigger a background index and inject on next session.
2. **Partial index**: Index exists but is stale (>N commits behind). Inject stale data or skip?
3. **Timeout exceeded**: One of the three parallel promises (map, ranking, recent) times out. Inject whatever finished, or nothing?
4. **Large repos**: For repos with 1000+ files, can `getHotspots` and `buildCodebaseMap` finish in <500ms? If not, should we pre-compute and cache?

These decisions affect the contract between the hook and the core engine.

## Answer

**Four decisions on timeout, failure, and edge-case behavior:**

### 1. Unindexed repo → Silently inject nothing

`isIndexed(repoRoot) === false` → `return {}`. No hint, no background trigger. Auto-indexing is a separate future effort (index speed needs rethinking first). Deferred out of this map's scope.

### 2. Stale index → Detect staleness, sync, then inject fresh

Sequential order:
1. `isIndexed()` — no → skip (decision #1)
2. `isStale()` — compare stored SHA vs `HEAD` + `git status --porcelain`
3. If stale → run `sync()` (fast incremental update)
4. Then run the three parallel tasks with fresh data

Sync is assumed fast (incremental). It runs before injection, eating into the 500ms budget. The `Promise.race` deadline still protects agent start if sync is unexpectedly slow.

### 3. Partial timeout → All or nothing

If any of the three branches (map, ranking, recent) fails or times out, inject nothing. No partial injection. Rationale: all three are expected to be fast; partial context isn't worth the inconsistency.

**Action item:** Add timing telemetry to each branch to measure and detect if one is a consistent bottleneck. Revisit if data shows one branch is dragging the others to zero injection.

### 4. Large repos → Cache `buildCodebaseMap` to disk

- `buildCodebaseMap` is in-memory aggregation over graph data (not source parsing) — fast even for 1000+ files.
- Still, cache the result to disk (e.g. `.aiknow/cache/codemap.md`) as cheap insurance.
- **When fresh:** read cached file directly, skip rebuild.
- **When stale:** sync → rebuild codemap from fresh graph → write new cache → inject.
- `rankFilesForQuery` (query-dependent) and `getRecentChanges` (time-dependent) cannot be cached.

**Key insight:** `buildCodebaseMap` does NOT re-parse source code. It reads from the already-loaded index graph. Caching saves ~5ms on fresh sessions; no meaningful downside.
