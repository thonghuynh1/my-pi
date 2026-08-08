---
Status: ready-for-agent
status: closed
---

# Issue 02: Codebase Map Generation + Disk Cache

**Label:** `ready-for-agent`

## Parent

`.scratch/aiknow-proactive/PRD.md`

## What to build

Implement `buildCodebaseMap` — a function that generates a compact Graft-style directory listing with hub annotations (symbols with highest in-degree), caches it to disk, and integrates it into the proactive injection block. After this issue, the agent sees a structural overview of the repo before its first action.

**Covers:** US-001, RB-005, DEC-004, DEC-003 (disk cache)

## Implementation map

### buildCodebaseMap (DEC-004)

**New file:** `src/core/proactive/codemap.ts`

**Contract:**
```typescript
function buildCodebaseMap(store: QueryStore, repoRoot: string): string
```

**Algorithm:**
1. `store.listFiles()` → group files by 2-level directory path (e.g., `src/core/retrieval/`)
2. For each directory, query nodes in that directory from the store
3. For each node, count in-degree: `store.getEdgesTo(nodeId).length`
4. Select hubs: nodes with in-degree ≥ 5
5. Show subdirectories only when they contain hubs with ≥ 5 in-degree
6. Format one line per directory:
   ```
   src/core/          42 files  hubs: runSearch (retrieval.ts, 34←) · QueryStore (coordinator.ts, 21←)
   src/infrastructure/ 18 files  hubs: SqliteStore (store.ts, 15←)
   integrations/pi/    3 files
   ```

**Data sources (verified):**
- `store.listFiles()` → `FileRecord[]` with `pathKey`, `displayPath` (at `src/infrastructure/sqlite/store.ts:354`)
- `store.getEdgesTo(nodeId)` → `EdgeRecord[]` (at `src/infrastructure/sqlite/store.ts:799`)
- Nodes: need `store.listNodes()` or equivalent — check `QueryStore` interface for node enumeration. If not available, query nodes by iterating edges or add a bounded query method.

**Choices left to implementer:** Exact hub annotation format string, tie-breaking for equal in-degree, method for enumerating nodes per directory (may need a new store method or SQL query).

### Disk cache (DEC-003, RB-005)

**Cache location:** `.aiknow/cache/codemap.md` (relative to repo root)

**Implementation:**
- On `buildCodebaseMap` call: check if cache file exists and is fresh
- Cache freshness: invalidate after any sync (simplest: delete cache file at end of `runSync`/`runSyncAsync`)
- Write: `fs.writeFileSync(cachePath, mapContent)`
- Read: `fs.readFileSync(cachePath, 'utf8')` with existence check
- Create `.aiknow/cache/` directory on first write

**Cache invalidation wiring:**
- In coordinator's sync completion path (after `runSync` returns in `src/core/indexing/indexer.ts:115`), delete the cache file
- Or: store a `lastSyncTimestamp` and compare with cache file mtime

**Choices left to implementer:** Exact invalidation mechanism (delete file vs. timestamp comparison).

### Integration into proactive block

**File:** `integrations/pi/aiknow/index.ts` → proactive handler (from issue #01)

**Required edit:** Add `buildCodebaseMap(server.store, server.repoRoot)` to the `Promise.all` array. Pass result as first argument to `formatProactiveBlock(map, ranking, recent)`.

**File:** `src/core/proactive/formatter.ts` (from issue #01)

**Required edit:** When `map` is not null, include `## Codebase Map\n` + map content in the formatted block.

### Producer output from issue #01

- `formatProactiveBlock(map, ranking, recent)` accepts `map: string | null` — this issue provides a non-null string
- Hook handler's `Promise.all` array — this issue adds `buildCodebaseMap` as the third branch
- All-or-nothing error handling from #01 covers `buildCodebaseMap` failures automatically

## Acceptance criteria

- [ ] Codebase map generated with correct format
  - Run: `npx vitest run src/test/proactive-codemap.test.ts`
  - Test: `src/test/proactive-codemap.test.ts` → `generates one-liner-per-dir format with hub annotations`
  - Expected: Output contains directory lines with file counts; directories with hubs show `hubs: SymbolName (file.ts, N←)` annotations; hub threshold is in-degree ≥ 5
  - Fails when: hubs with in-degree < 5 are shown, or directories with hubs are missing annotations

- [ ] Two-level depth respected
  - Run: `npx vitest run src/test/proactive-codemap.test.ts`
  - Test: `src/test/proactive-codemap.test.ts` → `limits output to 2-level directory depth`
  - Expected: No directory path has more than 2 segments from repo root (e.g., `src/core/` yes, `src/core/retrieval/` only if it has hubs ≥5 in-degree). Fixture has 3+ level dirs; deeper ones without qualifying hubs roll into parent.
  - Fails when: 3+ level directories appear without qualifying hubs

- [ ] Cache written to disk after generation
  - Run: `npx vitest run src/test/proactive-codemap.test.ts`
  - Test: `src/test/proactive-codemap.test.ts` → `writes cache file on first call`
  - Expected: After `buildCodebaseMap` call, `.aiknow/cache/codemap.md` exists in temp fixture repo with content matching the returned string
  - Fails when: no cache file written, or content differs from return value

- [ ] Cache read on subsequent call (no recomputation)
  - Run: `npx vitest run src/test/proactive-codemap.test.ts`
  - Test: `src/test/proactive-codemap.test.ts` → `reads from cache on second call`
  - Expected: Second call returns same content without calling `store.getEdgesTo` (spy call count = 0 on second invocation)
  - Fails when: `getEdgesTo` called on cache-hit path

- [ ] Cache invalidated after sync
  - Run: `npx vitest run src/test/proactive-codemap.test.ts`
  - Test: `src/test/proactive-codemap.test.ts` → `invalidates cache after sync`
  - Expected: After simulated sync completion, cache file is deleted or marked stale; next `buildCodebaseMap` call recomputes (spy confirms `getEdgesTo` called again)
  - Fails when: stale cache served after sync

- [ ] Map appears in proactive injection block
  - Run: `npx vitest run src/test/pi-proactive-injection.test.ts`
  - Test: `src/test/pi-proactive-injection.test.ts` → `includes codebase map in proactive block`
  - Expected: System prompt contains `## Codebase Map` section with directory lines
  - Fails when: map section missing from injected system prompt

## Blocked by

- `01-walking-skeleton-hook-ranking-recent.md` — provides the hook handler, `formatProactiveBlock` function (with null map slot), and Promise.all orchestration that this issue extends.
