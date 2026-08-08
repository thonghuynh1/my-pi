---
Status: ready-for-agent
status: closed
---

# Issue 01: Walking Skeleton — Proactive File Ranking + Recent Changes via Hook

**Label:** `ready-for-agent`

## Parent

`.scratch/aiknow-proactive/PRD.md`

## What to build

Wire the `before_agent_start` hook in the aiKnow Pi extension to inject proactive context (file ranking + recently-changed files) into the agent's system prompt before it sees the user's message. This is the full end-to-end tracer bullet: env var gate → server init → freshness check → parallel compute (ranking + recent) → format → inject.

**Covers:** US-002, US-003, US-006, RB-001, RB-002, RB-003, RB-004, DEC-001, DEC-002, DEC-003 (minus disk cache), DEC-005, DEC-007

## Implementation map

### Hook registration (DEC-001)

**File:** `integrations/pi/aiknow/index.ts` (line ~175, inside `aiknowExtension()` body)

**Existing:** Registers two tools via `pi.registerTool()`. Uses `getServer(ctx)` for lazy server init. Zero hooks today.

**Required edits:**
- Add `pi.on("before_agent_start", proactiveHandler)` after tool registrations
- `proactiveHandler` implements: env var check → getServer → unindexed check → ensureFresh → Promise.all → format → return

**Normative handler structure:**
```typescript
pi.on("before_agent_start", async (event) => {
  if (process.env.AIKNOW_PROACTIVE === "0") return {};
  const server = await getServer(event); // null if unindexed
  if (!server) return {};
  await server.coordinator.ensureFresh({ timeoutMs: 5000 });
  try {
    const [ranking, recent] = await Promise.all([
      rankFilesForQuery(event.prompt, server.store),
      getRecentChanges(server.repoRoot),
    ]);
    const block = formatProactiveBlock(null, ranking, recent);
    return { systemPrompt: event.systemPrompt + "\n\n" + block };
  } catch {
    // all-or-nothing: inject nothing on failure
    return {};
  }
});
```

**Choices left to implementer:** Exact timeout duration for Promise.all race, telemetry event naming.

### File ranking — `rankFilesForQuery` (DEC-005)

**New file:** `src/core/proactive/file-ranking.ts`

**Contract:**
```typescript
interface RankedFileResult {
  confidence: 'high' | 'medium' | 'low';
  lines: string[];  // "file:line — Symbol (kind)"
  raw: RetrievalCandidate[];
}

function rankFilesForQuery(query: string, store: QueryStore): RankedFileResult
```

**Implementation:**
- Call `runSearch({ query, mode: 'pointer', limit: 8, tier: 'compact' }, store)` (existing at `src/core/retrieval/retrieval.ts:288`)
- Compute spread: `(entryPoints[0].score - entryPoints[last].score) / entryPoints[0].score`
- Classify: <0.15 → low, 0.15–0.39 → medium, ≥0.4 → high
- Format each entry as `pathKey:line — name (kind)`
- When fewer than 8 results: use all available

**Dependency:** `runSearch` from `src/core/retrieval/retrieval.ts:288` — takes `SearchArgs` + `QueryStore`, returns `RetrievalResult` with `entryPoints: RetrievalCandidate[]` each having `score`, `pathKey`, `line`, `name`, `kind`.

### Recently-changed files — `getRecentChanges` (US-003)

**New file:** `src/core/proactive/recent-changes.ts`

**Contract:**
```typescript
function getRecentChanges(repoRoot: string): string[]
```

**Implementation:**
- Execute `git diff --name-only HEAD` (unstaged) + `git diff --name-only --cached` (staged)
- Deduplicate results
- Return array of relative paths; empty array on any git error
- Use `child_process.execSync` with `{ cwd: repoRoot, encoding: 'utf8' }`

### Formatter — `formatProactiveBlock` (US-002, US-003)

**New file:** `src/core/proactive/formatter.ts`

**Contract:**
```typescript
function formatProactiveBlock(
  map: string | null,
  ranking: RankedFileResult,
  recent: string[]
): string
```

**Output format:**
```
[aiknow proactive context]

## Relevant Files (confidence: high)
src/core/retrieval/retrieval.ts:288 — runSearch (function)
src/core/indexing/coordinator.ts:113 — ensureFresh (method)
...

## Recently Changed
src/core/proactive/codemap.ts
integrations/pi/aiknow/index.ts
```

When `map` is null, the Codebase Map section is omitted (added by issue #02).

### Env var gating (RB-001, US-006)

- Check `process.env.AIKNOW_PROACTIVE === "0"` as first line in handler
- Return `{}` immediately — no server call, no computation

### Unindexed repo skip (RB-002)

- `getServer(event)` returns the server connection or null if no index exists for `cwd`
- On null: return `{}` silently

### Stale index freshness (RB-003)

- Call `server.coordinator.ensureFresh({ timeoutMs: 5000 })` (existing API at `src/core/indexing/coordinator.ts:113`)
- This runs incremental sync if dirty, waits up to timeout

### All-or-nothing failure (RB-004)

- Wrap `Promise.all` in try/catch
- On any error: return `{}`
- Emit timing telemetry (implementer chooses shape)

### Module barrel

**New file:** `src/core/proactive/index.ts` — re-exports `rankFilesForQuery`, `getRecentChanges`, `formatProactiveBlock`

### Test pattern

Follow `src/test/pi-aiknow-hybrid-guidelines.test.ts` — fake `ExtensionAPI` with `on()` spy capturing the registered handler, mock `QueryStore` returning fixture candidates.

## Acceptance criteria

- [ ] Hook registered and injects ranked files into system prompt
  - Run: `npx vitest run src/test/pi-proactive-injection.test.ts`
  - Test: `src/test/pi-proactive-injection.test.ts` → `injects ranked files into systemPrompt when index exists`
  - Expected: Returned `systemPrompt` contains `[aiknow proactive context]` header, `## Relevant Files (confidence:` section, and 8 formatted `file:line — Symbol (kind)` lines
  - Fails when: handler returns `{}` instead of augmented systemPrompt, or ranking is not called

- [ ] Env var `AIKNOW_PROACTIVE=0` disables all injection
  - Run: `npx vitest run src/test/pi-proactive-injection.test.ts`
  - Test: `src/test/pi-proactive-injection.test.ts` → `returns empty when AIKNOW_PROACTIVE=0`
  - Expected: Handler returns `{}`. `getServer` is never called (spy call count = 0).
  - Fails when: handler proceeds past env var check, or server is contacted

- [ ] Unindexed repo returns empty silently
  - Run: `npx vitest run src/test/pi-proactive-injection.test.ts`
  - Test: `src/test/pi-proactive-injection.test.ts` → `returns empty for unindexed repo`
  - Expected: Handler returns `{}`. No error thrown, no console output.
  - Fails when: handler throws or logs an error

- [ ] Stale index triggers ensureFresh before ranking
  - Run: `npx vitest run src/test/pi-proactive-injection.test.ts`
  - Test: `src/test/pi-proactive-injection.test.ts` → `calls ensureFresh before computing results`
  - Expected: `ensureFresh` spy called before `runSearch` spy. Both called exactly once.
  - Fails when: `runSearch` called before or without `ensureFresh`

- [ ] All-or-nothing: failure in any branch returns empty
  - Run: `npx vitest run src/test/pi-proactive-injection.test.ts`
  - Test: `src/test/pi-proactive-injection.test.ts` → `returns empty when ranking throws`
  - Expected: Handler returns `{}` when `runSearch` throws. No unhandled rejection.
  - Fails when: error propagates or partial injection is returned

- [ ] Confidence classification is correct per spread formula
  - Run: `npx vitest run src/test/proactive-file-ranking.test.ts`
  - Test: `src/test/proactive-file-ranking.test.ts` → `classifies confidence by spread`
  - Expected: Scores with spread 0.5 → 'high', spread 0.25 → 'medium', spread 0.10 → 'low'
  - Fails when: wrong confidence label for given score spread

- [ ] Recently-changed files returned from git diff
  - Run: `npx vitest run src/test/proactive-recent-changes.test.ts`
  - Test: `src/test/proactive-recent-changes.test.ts` → `returns changed files from git diff`
  - Expected: Returns deduplicated array of paths matching files modified in temp git fixture (fixture has specific staged + unstaged changes distinct from empty repo default)
  - Fails when: returns empty array for a repo with known changes, or includes duplicates

- [ ] Recently-changed files returns empty on git failure
  - Run: `npx vitest run src/test/proactive-recent-changes.test.ts`
  - Test: `src/test/proactive-recent-changes.test.ts` → `returns empty array on git error`
  - Expected: Returns `[]` when cwd is not a git repo (fixture: temp dir without .git)
  - Fails when: throws an error instead of returning empty

## Blocked by

None - can start immediately.
