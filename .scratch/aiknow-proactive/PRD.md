# PRD: aiKnow Proactive Context Injection

**Status:** `ready-for-agent`

## Problem Statement

Agents using aiKnow waste 1–2 tool calls "orienting" themselves at the start of each session — discovering repo structure and identifying relevant files before they can act on the user's intent. Benchmark data (35 trials, 7 prompts) shows this costs ~6% token efficiency and 0.5 quality points versus Graft, which pre-injects codebase orientation for free. The affected actor is any developer using Pi with aiKnow; the session-start orientation tax adds latency, burns tokens, and reduces output quality.

## Solution

Before the agent sees the user's prompt, aiKnow injects a compact proactive context block into the system prompt containing: (1) a codebase map showing directory structure and hub symbols, (2) query-aware file ranking of the 8 most relevant files for the user's prompt, and (3) recently-changed files from git. This eliminates orientation tool calls, matches Graft's efficiency, and improves quality by ensuring the agent starts with structural awareness. An `AIKNOW_PROACTIVE=0` env var disables injection for A/B testing.

## User Stories

1. As a developer using Pi, I want the agent to see a compact codebase map before it starts working, so that it can navigate the repo without exploratory tool calls.
2. As a developer using Pi, I want the agent to see the 8 most relevant files ranked for my specific query, so that it immediately knows where to look.
3. As a developer using Pi, I want the agent to see recently-changed files, so that it has awareness of active work areas without needing to run git commands.
4. As a developer using Pi, I want to see how many tokens aiKnow saved me on each search response, so that I can gauge the tool's value.
5. As a developer using Pi, I want helpful nudges when aiKnow returns few results, so that I know what alternative actions to take.
6. As a developer using Pi, I want to disable proactive injection via `AIKNOW_PROACTIVE=0`, so that I can A/B test or opt out.

## Walking Skeleton

`US-002` — the thinnest end-to-end path: wire the `before_agent_start` hook, call `runSearch` in pointer mode against the user's prompt, format 8 ranked results with confidence label, and inject them into the system prompt. This exercises the full hook → server → search → format → inject pipeline with real wiring.

Combined with `US-003` (recently-changed files via `git diff`) as the minimal tracer bullet, since both share the hook wiring and the injection formatter.

## Required Behaviors

- `RB-001`: When `AIKNOW_PROACTIVE=0` is set, the `before_agent_start` handler returns `{}` immediately — zero injection, zero server calls.
- `RB-002`: When the repo has no aiKnow index (server returns no store for `cwd`), the handler returns `{}` silently — no error, no log, no user-facing message.
- `RB-003`: When the index is stale, the handler calls `ensureFresh()` (incremental sync) before computing injection data.
- `RB-004`: If any injection branch (map, ranking, recent) fails or times out, the handler returns `{}` — all-or-nothing injection. Timing telemetry is emitted for diagnostics.
- `RB-005`: The codebase map is cached to disk at `.aiknow/cache/codemap.md` (keyed by repo+branch); cache is invalidated and rebuilt on each `sync`.
- `RB-006`: Token-saved estimates (`tokensSaved`, `tokensSavedPercent`, `filesAvoided`) are returned as structured fields on every `aiknow_search` response, even when savings = 0.
- `RB-007`: Escalation nudge is appended to `aiknow_search` responses only when result count ≤ 2. Zero-result nudge interpolates the search term and mentions unindexed possibility.

## Accepted Decision Register

### DEC-001 — Hook mechanism
- **Decision**: Use `pi.on("before_agent_start", handler)` returning `{ systemPrompt: augmented }` to inject proactive context.
- **Rationale**: Fully typed, chainable across extensions, fires after skill/template expansion, provides `cwd` via `systemPromptOptions`.
- **Rejected alternatives**: `promptSnippet` (static, not query-aware), `before_provider_request` (fires every turn, wasteful).
- **Downstream impact**: Handler must await server init and search; must respect timeout budget.
- **Depends on**: None
- **Decided implementation**: Register hook in `aiknowExtension()` body. Handler calls `getServer(ctx)`, computes 3 injection branches, concatenates formatted output, appends to `event.systemPrompt`.
- **Left to the implementer**: Exact string concatenation order within the injection block.

### DEC-002 — All features in one PRD, walking skeleton F2+F3+F7
- **Decision**: All 7 features ship in one release. Walking skeleton = file ranking (F2) + hook wiring (F3) + recent changes (F7).
- **Rationale**: Features are independently shippable but share the hook; one PRD enables vertical slicing by `to-issues`.
- **Rejected alternatives**: Multi-PRD phased delivery (overhead, shared wiring).
- **Downstream impact**: `to-issues` slices vertically; skeleton issue must include hook + ranking + recent.
- **Depends on**: None
- **Decided implementation**: Single PRD; `to-issues` creates vertical slices.
- **Left to the implementer**: Issue ordering beyond skeleton-first.

### DEC-003 — Unindexed/stale/failure behavior
- **Decision**: Unindexed → silent skip. Stale → sequential `ensureFresh()` then parallel compute. Timeout/failure → all-or-nothing (inject nothing). Large repos → cache `buildCodebaseMap` to disk.
- **Rationale**: Silent skip avoids confusing users. Sequential freshness ensures data quality. All-or-nothing prevents partial/misleading injection.
- **Rejected alternatives**: Background index trigger (complexity), partial injection (confusing), in-memory-only cache (lost on restart).
- **Downstream impact**: Cache invalidation must be wired to sync completion. Telemetry needed for timeout diagnosis.
- **Depends on**: None
- **Decided implementation**: `getServer()` returns connection or null for unindexed. `ensureFresh()` on coordinator (existing API). Disk cache at `.aiknow/cache/codemap.md` written by `buildCodebaseMap`, invalidated on sync. `Promise.all` for 3 branches with shared deadline; catch → return `{}`.
- **Left to the implementer**: Exact timeout duration (suggested ≤500ms total), telemetry event shape.

### DEC-004 — Codebase map format
- **Decision**: Graft-style compact one-liner-per-dir. No hard token cap. Pure in-degree for hub selection. 2-level depth; subdirs shown when hubs ≥ 5 in-degree.
- **Rationale**: Format density is the token constraint (~250–600 tokens). In-degree is stable and cacheable. 2-level gives orientation without overwhelming.
- **Rejected alternatives**: Tree-style (verbose), token-capped (arbitrary), recency-weighted hubs (unstable, separate via F7).
- **Downstream impact**: `buildCodebaseMap` needs `listFiles()` + `getEdgesTo()` + `nodes` query. Cache stores formatted markdown.
- **Depends on**: DEC-003 (cache strategy)
- **Decided implementation**: New function `buildCodebaseMap(store: QueryStore, repoRoot: string): string`. Groups files by directory (2 levels). For each directory, counts in-degree of its nodes. Directories with hubs (in-degree ≥ 5) get hub annotations. Output: one line per directory with file count and hub list.
- **Left to the implementer**: Exact formatting of hub annotation string, tie-breaking for equal in-degree.

### DEC-005 — File ranking confidence and presentation
- **Decision**: Spread formula `(top - last) / top`. <0.15 low, 0.15–0.39 medium, ≥0.4 high. Always show 8 results with confidence label. Format: `file:line — Symbol (kind)`. Always attempt ranking. No reactive coupling in v1.
- **Rationale**: Spread formula is the quality gate; confidence label self-calibrates agent behavior. Fixed 8 gives consistent UX. Line numbers enable jump-to.
- **Rejected alternatives**: Adaptive result count (inconsistent), suppressing low-confidence (loses useful context), reactive search coupling (deferred to post-benchmark).
- **Downstream impact**: Needs `runSearch` in pointer mode with query = user's prompt. Post-process scores for spread.
- **Depends on**: None
- **Decided implementation**: Call `runSearch({ query: userPrompt, mode: 'pointer', limit: 8, tier: 'compact' }, store)`. Compute spread from `candidates[0].score` and `candidates[7].score`. Format each entry as `file:line — Symbol (kind)`. Prepend confidence label line.
- **Left to the implementer**: Handling when fewer than 8 candidates returned (use all available).

### DEC-006 — Escalation nudge triggers and wording
- **Decision**: Trigger on ≤2 results only. Prescriptive wording. Zero-result template: `[aiknow] No indexed results for "<term>". Try grep, or the symbol may be in an unindexed file.` Self-contained (no cross-reference with map).
- **Rationale**: Prescriptive nudges work better with LLM consumers. Interpolating the search term aids direct reuse. Self-contained keeps features independently shippable.
- **Rejected alternatives**: Confidence-based trigger (over-engineered), suggestive wording (less effective with LLMs), map cross-reference (coupling).
- **Downstream impact**: Nudge logic lives in the search response formatter, not in the proactive hook.
- **Depends on**: None
- **Decided implementation**: In `aiknow_search` response formatting: if `entryPoints.length <= 2`, append nudge. If 0 results, use zero-result template with interpolated term. If 1–2 results, use low-result template suggesting broadening.
- **Left to the implementer**: Exact 1–2 result nudge wording.

### DEC-007 — Acceptance criteria scope
- **Decision**: AC covers code correctness only. Benchmark targets (≥−30% tokens, ≥7.5/8 quality, ≤15 tool calls) are reference context for human reviewer — NOT automated gates.
- **Rationale**: Benchmark requires human judgment (scenario variability, environment differences). Code correctness is machine-testable.
- **Rejected alternatives**: Automated benchmark gates (flaky, environment-dependent).
- **Downstream impact**: Tests assert feature behavior, env var gating, silent skip. No benchmark integration in CI.
- **Depends on**: None
- **Decided implementation**: Unit tests for each feature function. Integration test for hook registration. No benchmark in test suite.
- **Left to the implementer**: Test file naming conventions.

### DEC-008 — Token-saved estimates placement
- **Decision**: Calculation in core engine (structured fields). Always returned. 4 chars/tok approximation. Consumers format their own display.
- **Rationale**: Core placement makes estimates reusable across Pi, VS Code, CLI. Structured data is flexible. 4 chars/tok avoids tokenizer dependency.
- **Rejected alternatives**: Per-integration calculation (duplication), tokenizer dependency (heavy), conditional return (inconsistent).
- **Downstream impact**: Core response formatter gains 3 new fields. Pi integration formats display string from structured data.
- **Depends on**: None
- **Decided implementation**: In search response assembly: compute `tokensSaved = (sum of file sizes for files NOT read) / 4`, `tokensSavedPercent`, `filesAvoided = count of files agent didn't need to read`. Return as structured fields on `SearchMetrics` or response envelope.
- **Left to the implementer**: Exact field placement on response type (metrics vs top-level), display threshold in Pi consumer.

### DEC-009 — Feature 6 (wiring cards) out of scope
- **Decision**: Deferred. F2 (codebase map) + F3 (file ranking with `file:line — Symbol (kind)`) subsume the need.
- **Rationale**: Cards solve "what's in this file?" — map + ranking already answer that. Defer until post-launch benchmark shows agents still waste reads.
- **Rejected alternatives**: Ship cards now (unnecessary given map+ranking).
- **Downstream impact**: No `cards/` generation, no per-file markdown. Simplifies scope.
- **Depends on**: None
- **Decided implementation**: Not implemented. Revisit post-launch based on benchmark evidence.
- **Left to the implementer**: N/A

## Implementation Plan

### Area: Hook Wiring & Orchestration

- **Coverage**: DEC-001, DEC-002, DEC-003, US-001, US-002, US-003, US-006, RB-001, RB-002, RB-003, RB-004
- **Contract**: `before_agent_start` handler returns `{ systemPrompt: string }` with proactive block appended, or `{}` on skip/failure. Env var `AIKNOW_PROACTIVE=0` short-circuits. Unindexed repos short-circuit. Stale index triggers `ensureFresh()` before compute.
- **Decision constraints**: DEC-001 (hook mechanism), DEC-003 (failure = inject nothing, sequential freshness then parallel compute)
- **Code anchors**: `integrations/pi/aiknow/index.ts:175` → `aiknowExtension`, `getServer` (lines ~177–193)
- **Existing behavior**: Extension registers tools only. `getServer(ctx)` lazily inits server connection with branch-aware cache.
- **Required edits**:
  - Add `pi.on("before_agent_start", proactiveHandler)` inside `aiknowExtension()` body
  - `proactiveHandler`: check `AIKNOW_PROACTIVE` env var → `getServer(ctx)` → check index exists → `ensureFresh()` → `Promise.all([buildCodebaseMap, rankFiles, getRecentChanges])` with deadline → format → return `{ systemPrompt }`
  - Add timing telemetry emission on completion/failure
- **Normative snippet**:
  ```typescript
  pi.on("before_agent_start", async (event) => {
    if (process.env.AIKNOW_PROACTIVE === "0") return {};
    const server = await getServer(event); // returns null if unindexed
    if (!server) return {};
    await server.ensureFresh();
    const [map, ranking, recent] = await Promise.all([
      buildCodebaseMap(server.store),
      rankFilesForQuery(event.prompt, server.store),
      getRecentChanges(server.repoRoot),
    ]);
    const block = formatProactiveBlock(map, ranking, recent);
    return { systemPrompt: event.systemPrompt + "\n\n" + block };
  });
  ```
- **Test seam**: `src/test/pi-aiknow-hybrid-guidelines.test.ts` pattern — fake `ExtensionAPI` with `on()` spy. New test: `src/test/pi-proactive-injection.test.ts`. Command: `npm test`. Success: all tests pass.
- **Wiring**: Registration happens inside existing `aiknowExtension()` factory. No new DI. `getServer` already handles lazy init.
- **Grounding evidence**: GROUND-001, GROUND-002, GROUND-008

### Area: Codebase Map (`buildCodebaseMap`)

- **Coverage**: DEC-004, DEC-003 (cache), US-001, RB-005
- **Contract**: `buildCodebaseMap(store: QueryStore, repoRoot: string): string` — returns Graft-style compact directory listing with hub annotations. Cached to `.aiknow/cache/codemap.md`; invalidated on sync.
- **Decision constraints**: DEC-004 (one-liner-per-dir, pure in-degree, 2-level depth, subdirs when hubs ≥5 in-degree)
- **Code anchors**: `src/infrastructure/sqlite/store.ts:354` → `listFiles()`, `src/infrastructure/sqlite/store.ts:799` → `getEdgesTo()`, `src/core/indexing/coordinator.ts:87` → `QueryStore` interface
- **Existing behavior**: `listFiles()` returns all `FileRecord[]`. `getEdgesTo(nodeId)` returns incoming edges. No map function exists today.
- **Required edits**:
  - New file: `src/core/proactive/codemap.ts`
  - Implement `buildCodebaseMap(store, repoRoot)`: group files by 2-level directory path, query nodes per directory, count in-degree via `getEdgesTo`, format hubs (≥5 in-degree) as annotations
  - Implement disk cache: write to `.aiknow/cache/codemap.md`, read on subsequent calls, invalidate after sync (wire into coordinator's sync completion)
- **Normative snippet**:
  ```
  src/core/          42 files  hubs: runSearch (retrieval.ts, 34←) · QueryStore (coordinator.ts, 21←)
  src/infrastructure/ 18 files  hubs: SqliteStore (store.ts, 15←)
  integrations/pi/    3 files
  ```
- **Test seam**: New test: `src/test/proactive-codemap.test.ts`. Uses test fixture store with known nodes/edges. Command: `npm test`. Success: output matches expected format, hubs correct by in-degree, 2-level depth respected.
- **Wiring**: Called from proactive handler (Area: Hook Wiring). Cache file written via `fs.writeFileSync`. Cache read via `fs.readFileSync` with existence check.
- **Grounding evidence**: GROUND-005, GROUND-004, GROUND-007, GROUND-009

### Area: File Ranking (`rankFilesForQuery`)

- **Coverage**: DEC-005, US-002, RB-004
- **Contract**: `rankFilesForQuery(query: string, store: QueryStore): RankedFileResult` — returns 8 ranked files with confidence label. Format: `file:line — Symbol (kind)`. Confidence: spread formula on scores.
- **Decision constraints**: DEC-005 (spread formula, always 8, always attempt, `file:line — Symbol (kind)` format)
- **Code anchors**: `src/core/retrieval/retrieval.ts:288` → `runSearch`
- **Existing behavior**: `runSearch` returns `RetrievalResult` with scored `entryPoints`. Up to 8 results in broad mode.
- **Required edits**:
  - New file: `src/core/proactive/file-ranking.ts`
  - Implement `rankFilesForQuery(query, store)`: call `runSearch({ query, mode: 'pointer', limit: 8, tier: 'compact' }, store)`, compute spread = `(top.score - last.score) / top.score`, classify confidence, format output lines
  - Return type: `{ confidence: 'high' | 'medium' | 'low'; lines: string[]; raw: RetrievalCandidate[] }`
- **Normative snippet**:
  ```typescript
  interface RankedFileResult {
    confidence: 'high' | 'medium' | 'low';
    lines: string[];  // formatted "file:line — Symbol (kind)"
    raw: RetrievalCandidate[];
  }
  ```
- **Test seam**: New test: `src/test/proactive-file-ranking.test.ts`. Mock `QueryStore` with known scored candidates. Command: `npm test`. Success: correct confidence classification, 8 results formatted.
- **Wiring**: Called from proactive handler. Uses existing `runSearch` — no new dependencies.
- **Grounding evidence**: GROUND-003, GROUND-009

### Area: Recently-Changed Files (`getRecentChanges`)

- **Coverage**: US-003, RB-004
- **Contract**: `getRecentChanges(repoRoot: string): string[]` — returns recently-changed file paths via `git diff --name-only HEAD` (unstaged + staged). Falls back to empty array on git failure.
- **Decision constraints**: DEC-002 (part of walking skeleton), DEC-003 (failure → empty, contributes to all-or-nothing)
- **Code anchors**: None — no git diff function exists (GROUND-009)
- **Existing behavior**: N/A — entirely new.
- **Required edits**:
  - New file: `src/core/proactive/recent-changes.ts`
  - Implement `getRecentChanges(repoRoot)`: exec `git diff --name-only HEAD` + `git diff --name-only --cached`, deduplicate, return paths. Catch errors → return `[]`.
- **Test seam**: New test: `src/test/proactive-recent-changes.test.ts`. Use temp git repo fixture. Command: `npm test`. Success: returns expected changed files.
- **Wiring**: Called from proactive handler. Uses `child_process.execSync` or equivalent.
- **Grounding evidence**: GROUND-009

### Area: Token-Saved Estimates

- **Coverage**: DEC-008, US-004, RB-006
- **Contract**: Core engine returns `{ tokensSaved: number; tokensSavedPercent: number; filesAvoided: number }` on every search response. Calculation: `tokensSaved = sum(file.sizeBytes for files in results but not read) / 4`. Always present (even if 0).
- **Decision constraints**: DEC-008 (core engine, structured fields, 4 chars/tok, always returned, consumers format display)
- **Code anchors**: `src/core/retrieval/retrieval.ts:883` → `buildMetrics`
- **Existing behavior**: `buildMetrics` assembles `SearchMetrics`. Does not include token estimates today.
- **Required edits**:
  - Extend `SearchMetrics` type with `tokensSaved`, `tokensSavedPercent`, `filesAvoided`
  - In `buildMetrics` (or post-search assembly): compute estimates from `candidates[].sizeBytes`
  - Pi integration: format display string from structured fields in `aiknow_search` response
- **Test seam**: Extend existing retrieval tests or new `src/test/proactive-token-estimates.test.ts`. Command: `npm test`. Success: estimates present on every response, math correct.
- **Wiring**: Extends existing `buildMetrics` return type. Pi integration reads new fields.
- **Grounding evidence**: GROUND-003, GROUND-009

### Area: Escalation Nudges

- **Coverage**: DEC-006, US-005, RB-007
- **Contract**: When `aiknow_search` returns ≤2 results, append a prescriptive nudge to the response. Zero results: `[aiknow] No indexed results for "<term>". Try grep, or the symbol may be in an unindexed file.` 1–2 results: suggest broadening.
- **Decision constraints**: DEC-006 (≤2 trigger, prescriptive, interpolated term, self-contained)
- **Code anchors**: `integrations/pi/aiknow/index.ts` → `aiknow_search` tool handler (response formatting section)
- **Existing behavior**: Search tool returns formatted results without nudges.
- **Required edits**:
  - In `aiknow_search` response formatting: check `entryPoints.length`, if ≤2 append appropriate nudge template
  - New helper: `formatEscalationNudge(query: string, resultCount: number): string | null`
- **Normative snippet**:
  ```typescript
  function formatEscalationNudge(query: string, resultCount: number): string | null {
    if (resultCount === 0)
      return `[aiknow] No indexed results for "${query}". Try grep, or the symbol may be in an unindexed file.`;
    if (resultCount <= 2)
      return `[aiknow] Only ${resultCount} result(s) for "${query}". Try broadening your search or using grep for unindexed files.`;
    return null;
  }
  ```
- **Test seam**: New test: `src/test/proactive-escalation-nudge.test.ts`. Command: `npm test`. Success: nudge appended for 0–2 results, absent for 3+.
- **Wiring**: Integrated into existing `aiknow_search` tool handler response path.
- **Grounding evidence**: GROUND-001, GROUND-009

### Area: Proactive Block Formatter

- **Coverage**: US-001, US-002, US-003
- **Contract**: `formatProactiveBlock(map: string, ranking: RankedFileResult, recent: string[]): string` — assembles the final injection string from the three branches. Sections clearly labeled for agent consumption.
- **Decision constraints**: DEC-004 (map format), DEC-005 (ranking format)
- **Code anchors**: None — entirely new.
- **Required edits**:
  - New file: `src/core/proactive/formatter.ts`
  - Concatenate sections with headers: `## Codebase Map`, `## Relevant Files (confidence: X)`, `## Recently Changed`
- **Normative snippet**:
  ```
  [aiknow proactive context]

  ## Codebase Map
  src/core/          42 files  hubs: runSearch (retrieval.ts, 34←) · QueryStore (coordinator.ts, 21←)
  ...

  ## Relevant Files (confidence: high)
  src/core/retrieval/retrieval.ts:288 — runSearch (function)
  src/core/indexing/coordinator.ts:107 — ensureFresh (method)
  ...

  ## Recently Changed
  src/core/proactive/codemap.ts
  integrations/pi/aiknow/index.ts
  ```
- **Test seam**: New test: `src/test/proactive-formatter.test.ts`. Command: `npm test`. Success: output contains all three sections with correct headers.
- **Wiring**: Called from hook handler. Pure formatting function, no dependencies beyond its inputs.
- **Grounding evidence**: GROUND-009

## Global Build & Wiring Notes

- **New module**: `src/core/proactive/` directory containing `codemap.ts`, `file-ranking.ts`, `recent-changes.ts`, `formatter.ts`
- **Cache directory**: `.aiknow/cache/` (created on first write; `.aiknow/` already used by the runtime)
- **Cache invalidation**: Wire `buildCodebaseMap` cache write into coordinator's sync completion path (after `runSync`/`runSyncAsync` returns)
- **Env var**: `AIKNOW_PROACTIVE` — checked in hook handler; `"0"` disables all proactive injection
- **No new npm dependencies** required — uses existing `child_process`, `fs`, `path`, and aiKnow internals
- **Export barrel**: `src/core/proactive/index.ts` re-exports public functions for use by the Pi integration

## Testing Decisions

- **Behavior seams**: Hook registration, env var gating, unindexed skip, stale sync trigger, map generation, ranking computation, recent changes detection, nudge triggering, token estimate calculation
- **Test files**: `src/test/pi-proactive-injection.test.ts` (integration), `src/test/proactive-codemap.test.ts`, `src/test/proactive-file-ranking.test.ts`, `src/test/proactive-recent-changes.test.ts`, `src/test/proactive-escalation-nudge.test.ts`, `src/test/proactive-formatter.test.ts`, `src/test/proactive-token-estimates.test.ts`
- **Prior art**: Follow `pi-aiknow-hybrid-guidelines.test.ts` pattern — fake `ExtensionAPI` with method spies, mock `QueryStore` with fixture data
- **Command**: `npm test` (Vitest)
- **Expected result**: All tests pass; no existing tests broken
- **Bounded support**: Temp git repos for `getRecentChanges` tests; fixture SQLite stores for map/ranking tests

## Out of Scope

- Changes to Pi's core extension API (consume existing `before_agent_start` hook as-is)
- Graft (competitor, not a dependency)
- Prepass tool (competitor, not a dependency)
- Benchmark framework changes (humans run benchmarks post-implementation)
- Feature 6 / wiring cards (deferred; DEC-009)
- Reactive search coupling between proactive results and `aiknow_search` (v1 relies on prompt visibility)
- Automated benchmark gates in CI
- Cross-extension interaction testing (out of scope per DEC-007)

## Unresolved Gaps

None.

## Further Notes

- Grounding file: `.scratch/aiknow-proactive/grounding.md`
- Benchmark reference targets (human-judged, not automated gates): ≥−30% tokens vs grep baseline, ≥7.5/8 quality, ≤15 avg tool calls
- Benchmark command: `F:/MyWork/benchmark/run_agent_only.py` with config `F:/MyWork/benchmark/agent-suite-config.json`
- Walking skeleton decision source: `.scratch/aiknow-proactive/wayfinder/02-feature-scope.md`
