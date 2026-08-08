# Handoff: aiKnow Proactive Context Injection

## Context

We benchmarked 5 context tools (35 trials, 7 realistic developer prompts, hackathon-ralph-loop TypeScript repo):

| Profile | Avg Tokens | Savings | Quality | Strategy |
|---------|-----------|---------|---------|----------|
| grep-graft (winner) | 35,334 | **-30%** | 7.7/8 | Pre-injected codebase map at session start |
| grep-aiknow (ours) | 38,248 | -24% | 7.2/8 | Reactive tool calls only |
| grep-graft-live | 41,370 | -18% | 7.0/8 | Live MCP graph queries |
| grep-prepass | 41,936 | -17% | 7.3/8 | Pre-injected BM25F file ranking |
| grep (baseline) | 50,364 | — | 7.0/8 | No assistance |

**The gap:** aiKnow loses 6% to Graft because the agent wastes 1-2 tool calls orienting itself before it knows what to search for. Graft gives that orientation for free at session start.

**Per-scenario winners reveal what to steal:**
- Quick lookups → Prepass wins (file ranking points to the right file immediately)
- Find-and-edit → **aiKnow already wins** (graph finds type + callers in one shot)
- Module understanding / architecture → Graft wins (codebase map guides multi-file trace)

## What to Implement

All changes go in `F:/MyWork/aiKnow/integrations/pi/aiknow/index.ts` (the Pi extension) and supporting modules in `F:/MyWork/aiKnow/src/core/`.

### Feature 1: Codebase Map (from Graft)

**What Graft does:** `graft map` produces a ~300-token structural overview:
```
repo — 180 files · 1517 symbols · 4137 edges · typescript

src/core/           42 files  hubs: ralphLoop (ralph-loop.ts, 34←) · TaskPipeline (task-pipeline.ts, 21←)
src/core/runs/      12 files  hubs: AgentClient (agent-client.ts, 18←) · resolveAgentClient (runner.ts, 9←)
src/core/loop-run/   8 files  hubs: LoopRunTracker (loop-run-tracker.ts, 34←) · RunSnapshot (state.ts, 28←)

hotspots: LoopRunTracker·34← · ralphLoop·34← · RunSnapshot·28← · TaskPipeline·21←
```

The "34←" means 34 incoming edges (calls/references/imports). High in-degree = architecturally important.

**What aiKnow already has:**
- `listFiles()` in `src/core/tools/tools.ts` — files grouped by role
- Graph edges stored via `getEdgesTo(nodeId)` / `getEdgesFrom(nodeId)` — never surfaced as "hotspots"
- `file_map` endpoint exists in HTTP/MCP but NOT exposed in Pi extension

**What to build:**
1. `getHotspots(repoRoot, limit=12)` — iterate nodes, count incoming edges, sort by in-degree
2. `getDirectoryHubs(repoRoot)` — group by directory, pick top 2-3 hubs per dir
3. `buildCodebaseMap(repoRoot)` → formatted markdown string (~300 tokens)

### Feature 2: Query-Aware File Ranking (from Prepass)

**What Prepass does:** Before the agent starts, runs BM25F scoring on the user's prompt and injects:
```xml
<file path="src/core/runs/agent-client.ts" score="23.196" />
<file path="src/core/utils/task-pipeline.ts" score="18.440" />
```
Plus a confidence label (low/medium/high) based on score spread.

**What aiKnow already has:**
- Full BM25 + graph-rank scoring pipeline in `src/core/retrieval/retrieval.ts` (`runSearch()`)
- `mode="pointer"` already returns minimal file:line output
- `classifyQueryBreadth()` already classifies precise/broad/hybrid

**What to build:**
1. `rankFilesForQuery(repoRoot, userPrompt, limit=8)` — thin wrapper around `runSearch()` in pointer mode
2. Confidence scoring: `spread = (top - last) / top`. < 0.15 → low, ≥ 0.4 → high
3. Output format:
   ```
   ## Likely Relevant (confidence: high)
   1. src/core/runs/agent-client.ts:25 — SteerableImplementationOptions (interface)
   2. src/core/utils/task-pipeline.ts:222 — executeTask (method)
   Note: Ranked guesses. Open to confirm before editing.
   ```

### Feature 3: before_agent_start Hook (the integration point)

**What Pi's API provides:** `pi.on("before_agent_start", async ({ cwd, userPrompt }) => { return { inject: "..." } })`

This hook fires before the agent sees the user's message. Whatever you return in `inject` gets added to the agent's context for free.

**What to build in `integrations/pi/aiknow/index.ts`:**
```typescript
pi.on("before_agent_start", async ({ cwd, userPrompt }) => {
  try {
    const repoRoot = detectRepoRoot(cwd);
    if (!repoRoot || !isIndexed(repoRoot)) return {};
    
    const [map, ranking, recent] = await Promise.allSettled([
      buildCodebaseMap(repoRoot),                         // ~300 tokens
      rankFilesForQuery(repoRoot, userPrompt, 8),         // ~150 tokens
      git("diff --name-only HEAD~5", { cwd: repoRoot }), // ~50 tokens
    ]);
    
    const sections = [];
    if (map.status === 'fulfilled') sections.push(map.value);
    if (ranking.status === 'fulfilled') sections.push(ranking.value);
    if (recent.status === 'fulfilled') sections.push(`## Recent Changes\n${recent.value}`);
    
    return sections.length ? { inject: sections.join('\n\n') } : {};
  } catch { return {}; } // never block agent start
});
```

**Gating:** `AIKNOW_PROACTIVE=0` disables (for A/B testing). Default: on.
**Timeout:** Entire hook must finish in < 500ms (Promise.race with deadline).

### Feature 4: Token-Saved Estimates (from Graft)

Graft appends to every response:
```
[graft] tokens saved ≈ 4,200 (78%) — this pack ≈ 1,200 tok vs reading the 3 source file(s) whole ≈ 5,400 tok.
```

**What to build:** After `aiknow_search` returns results, compute:
- Sum file sizes of referenced files → estimate tokens at 4 chars/tok
- Compare to response size
- Append: `[aiknow] tokens saved ≈ X (Y%) vs reading N files whole`

This trains the agent to prefer aiknow_search over grep+read for discovery.

### Feature 5: Escalation Nudges (from Graft)

When Graft returns ≤ 2 results:
```
[graft] only 2 hits — switch tool: grep for literals · skeleton for file API · callers for who-uses.
```

**What to build:** When `aiknow_search` returns thin results (≤ 2 hits):
```
[aiknow] Few results — try: grep -r "exactTerm" for literals · aiknow_search with intent="callers" · read the file directly if you know it.
```

When 0 results:
```
[aiknow] No indexed results. Try grep, or the symbol may be in an unindexed file.
```

### Feature 6: Wiring Cards (from Graft, stretch goal)

Graft generates per-file markdown "cards" that mirror the source tree:
```
# src/core/runs/agent-client.ts
- SteerableImplementationOptions · interface · L25-L45 — prompt, model, cwd, tools, contextBudget...
- AgentClient · interface · L81-L95 — execute(options): Promise<AgentExecutionResult>
- LiveSteerableAgentClient · interface · L77 — extends AgentClient
```

These are ~50 tokens vs ~500 tokens for reading the full file. Agents can grep these cards to quickly locate symbols without opening source files.

**What to build:**
- On index build, generate `~/.aiknow/cards/<repo>/<file>.md` for files with ≥3 symbols
- Format: `name · kind · span — one-line description (from signature)`
- Optional: make cards greppable by adding them to a `.aiknow-cards/` dir in the repo (gitignored)

### Feature 7: Recently-Changed Files (from Prepass)

Prepass includes `<repo recently-changed="file1.ts, file2.ts" />` so the agent knows what was just touched.

**What to build:** In the hook, run `git diff --name-only HEAD~5` and include as a one-liner. Cost: ~50 tokens, saves the agent from running `git status` itself.

## Key Technical Details

### Where the hook goes
`F:/MyWork/aiKnow/integrations/pi/aiknow/index.ts` — currently registers 2 tools (`aiknow_search`, `aiknow_external_search`), zero hooks. Add the hook after tool registrations.

### Pi hook API
```typescript
// Pi extension API (already available, just unused)
pi.on("before_agent_start", async (context: { cwd: string; userPrompt: string }) => {
  return { inject?: string }; // injected into agent context
});
```

### Existing data to reuse
| Need | Already exists in aiKnow | Location |
|------|-------------------------|----------|
| File list by role | `listFiles()` | `src/core/tools/tools.ts` |
| Graph edges | `getEdgesTo(id)`, `getEdgesFrom(id)` | `src/core/graph/` |
| BM25 + graph search | `runSearch()` | `src/core/retrieval/retrieval.ts` |
| Query classification | `classifyQueryBreadth()` | `src/core/retrieval/retrieval.ts` |
| Symbol nodes | full AST index | `~/.aiknow/repos/<hash>/` |
| File map | `/tools/file_map` endpoint | `src/interfaces/http/http-tools.ts:414` |

### What's NOT available yet (must build)
1. In-degree counting (`getHotspots`) — edges exist, just need to iterate and count
2. Directory clustering with hubs — group files by dir, pick top-N per group
3. Confidence scoring — simple math on score spread
4. Token-saved estimates — file size sum vs response size
5. The `before_agent_start` hook wiring itself

## Validation

Re-run the benchmark with a new profile `grep-aiknow-proactive` (env: `AIKNOW_PROACTIVE=1`):

```bash
cd F:/MyWork/benchmark
PI_COMMAND="C:/Users/Admin/AppData/Roaming/npm/pi.cmd" python run_agent_only.py --model openai-codex/gpt-5.6-luna
```

**Targets:**
- Token savings: ≥ -30% vs grep baseline (match Graft)
- Quality: ≥ 7.5/8 (beat current aiKnow's 7.2/8)
- Tool calls: ≤ 15 avg (currently 20)

**Benchmark config lives at:** `F:/MyWork/benchmark/agent-suite-config.json`
**Results at:** `F:/MyWork/benchmark/results/agent-only-summary.json`

## Priority Order

1. **Hook + file ranking** (Feature 3 + 2) — fastest to implement, biggest bang. Just wrap existing `runSearch()` and wire the hook. Should get -5% immediately.
2. **Hotspot + codebase map** (Feature 1) — needs new code but data exists. Gets the remaining -5%.
3. **Token estimates + nudges** (Feature 4 + 5) — quick wins, improve reactive path.
4. **Wiring cards** (Feature 6) — stretch goal, biggest engineering effort.
5. **Benchmark validation** (always last) — prove it works end-to-end.
