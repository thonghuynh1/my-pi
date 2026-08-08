# Grounding Evidence — aiKnow Proactive Context Injection

## GROUND-001 — Pi Extension Entry Point
- Source: `F:/MyWork/aiKnow/integrations/pi/aiknow/index.ts` → `aiknowExtension`
- Existing behavior: Default export `function aiknowExtension(pi: ExtensionAPI): void` (line ~175). Registers two tools (`aiknow_search`, `aiknow_external_search`) via `pi.registerTool()`. Uses `getServer(ctx)` for lazy server init with branch-aware caching (`serverCache: Map<string, ServerConnection>`). Zero hooks registered today.
- Current excerpt: `export const piExtension = { id: "aiknow" };` (line 14), `export default function aiknowExtension(pi: ExtensionAPI): void` (line ~175)
- Test prior art: `src/test/pi-aiknow-hybrid-guidelines.test.ts` — spins up fake `ExtensionAPI`, calls `aiknowExtension(fakePi)`, asserts tool registration and metadata

## GROUND-002 — before_agent_start Hook API
- Source: Pi `dist/core/extensions/types.d.ts` → `BeforeAgentStartEvent`, `BeforeAgentStartEventResult`
- Existing behavior: Event provides `{ type, prompt, images?, systemPrompt, systemPromptOptions }`. `systemPromptOptions` exposes `cwd`. Result shape: `{ message?: Pick<CustomMessage, ...>; systemPrompt?: string }`. Multiple extensions chain `systemPrompt` replacements.
- Current excerpt: `BeforeAgentStartEventResult { message?: ...; systemPrompt?: string; }`
- Test prior art: None in aiKnow (hook unused)

## GROUND-003 — runSearch (File Ranking Engine)
- Source: `F:/MyWork/aiKnow/src/core/retrieval/retrieval.ts` → `runSearch`
- Existing behavior: `export function runSearch(args: SearchArgs, store: QueryStore): RetrievalResult` (line ~288). Hybrid search combining symbol, lexical, path, and graph-neighbor candidates. Returns `RetrievalResult` with `entryPoints` (≤8 broad, ≤3 precise), `candidates` (full ranked pool), `metrics`, `negativeEvidence`.
- Current excerpt: `interface RetrievalResult { query, terms, mode, interpretation, candidates, entryPoints, allCount, capped, tier, tokenBudget, metrics, negativeEvidence? }`
- Test prior art: Extensive tests under `src/test/` (retrieval tests)

## GROUND-004 — Graph Edges (In-Degree Source)
- Source: `F:/MyWork/aiKnow/src/infrastructure/sqlite/store.ts` → `getEdgesTo`
- Existing behavior: `getEdgesTo(nodeId: string): EdgeRecord[]` (line ~799). SQL: `SELECT source_id, target_id, kind, confidence, path_key, line, reason FROM edges WHERE target_id = ? ORDER BY source_id, kind`. Returns all incoming edges for a node.
- Current excerpt: Part of `QueryStore` interface defined in `src/core/indexing/coordinator.ts:87–88`
- Test prior art: Used extensively in retrieval tests

## GROUND-005 — File List
- Source: `F:/MyWork/aiKnow/src/infrastructure/sqlite/store.ts` → `listFiles`
- Existing behavior: `listFiles(): FileRecord[]` (line ~354). SQL: `SELECT path_key, display_path, role, origin, language, index_capability, size_bytes, mtime_ns, content_hash, freshness, index_status, reason FROM files`. Returns all indexed files.
- Current excerpt: Returns `FileRecord[]` with `pathKey`, `displayPath`, `role`, `language`, `sizeBytes`
- Test prior art: Used by HTTP `file_map` handler

## GROUND-006 — Index Freshness / Sync
- Source: `F:/MyWork/aiKnow/src/core/indexing/coordinator.ts` → `ensureFresh`
- Existing behavior: `ensureFresh(options: EnsureFreshOptions): Promise<SyncResult>` — ensures index is reasonably fresh before a query; starts incremental sync if dirty, waits up to `timeoutMs`. `sync(options): Promise<SyncResult>` — full incremental sync.
- Current excerpt: Part of `IndexCoordinator` interface (line ~107–130). `InProcessCoordinator` (line 235), `AutoSyncCoordinator` (line 325), `WorkerCoordinator` (line 484).
- Test prior art: Coordinator tests

## GROUND-007 — Nodes Table (Hub Data Source)
- Source: `F:/MyWork/aiKnow/src/infrastructure/sqlite/store.ts` → nodes table
- Existing behavior: `nodes` table stores symbols with `id`, `path_key`, `name`, `kind`, `line`, etc. Combined with `edges` table (GROUND-004), in-degree = count of edges where `target_id = nodeId`.
- Current excerpt: Schema includes `nodes` and `edges` tables in SQLite (better-sqlite3, WAL mode, FTS5)
- Test prior art: Store tests

## GROUND-008 — Server Connection / ensureServer
- Source: `F:/MyWork/aiKnow/integrations/pi/aiknow/index.ts` → `getServer`
- Existing behavior: `async function getServer(ctx: ExtensionContext): Promise<ServerConnection>` (lines ~177–193). Resolves `ctx.cwd`, gets branch via `git rev-parse`, builds cache key `${canonical}\0${branch}`, checks `serverCache`, calls `ensureServer(...)` on miss. Server runs as local HTTP process.
- Current excerpt: Lazy init pattern; server available at first tool call
- Test prior art: `pi-aiknow-hybrid-guidelines.test.ts` exercises full path

## GROUND-009 — No Existing Proactive Functions
- The following do NOT exist in the codebase and must be built new:
  - `buildCodebaseMap` — no function anywhere
  - `getHotspots` / `getDirectoryHubs` — no function
  - `getRecentChanges` / git diff integration — no function (git used only in tests and branch detection)
  - Persistent disk cache — no mechanism (only request-scoped in-memory caches exist)
  - `isIndexed` — no exported function (existence checked via store file presence)
  - Token-saved estimate calculation — no function

## GROUND-010 — Store Query Interface
- Source: `F:/MyWork/aiKnow/src/core/indexing/coordinator.ts` → `QueryStore`
- Existing behavior: Interface with `listFiles()`, `getEdgesTo?()`, `getEdgesFrom?()`, symbol/lexical search methods. Implemented by SQLite store. Available via coordinator.
- Current excerpt: Lines 75–100 define the full `QueryStore` interface
- Test prior art: All retrieval tests use `QueryStore`

## GROUND-011 — Test Infrastructure
- Runner: Vitest (`^4.1.10`), command: `npm test` or `vitest`
- Pi integration tests: `src/test/pi-aiknow-broad-packet.test.ts`, `src/test/pi-aiknow-hybrid-guidelines.test.ts`
- Pattern: Fake `ExtensionAPI` passed to `aiknowExtension()`, assertions on registered tools/metadata
- No test files in `integrations/pi/` directory itself
