# 04 — Codebase map format and token budget

Type: grilling
Status: resolved

## Question

The codebase map (Feature 1) needs a format decision. Graft uses ~300 tokens. Questions:

1. **Format**: Markdown table vs. indented tree vs. compact one-liner-per-dir (like Graft's example)? The format affects both human readability and agent parse-ability.
2. **Token budget**: Is 300 tokens the hard cap? The scratch file mentions map (~300) + ranking (~150) + recent (~50) = ~500 tokens total injection. Is 500 tokens the overall budget for proactive injection?
3. **Hub selection**: Top 2-3 per directory — by in-degree only, or weighted by recency of changes?
4. **Depth**: Should the map show only top-level dirs, or nest 2 levels deep?

The answer defines the contract for `buildCodebaseMap()`.

## Answer

**Four decisions defining the `buildCodebaseMap()` contract:**

### 1. Format → Graft-style compact one-liner-per-dir

```
repo — 180 files · 1517 symbols · 4137 edges · typescript

src/core/           42 files  hubs: ralphLoop (ralph-loop.ts, 34←) · TaskPipeline (task-pipeline.ts, 21←)
src/core/runs/      12 files  hubs: AgentClient (agent-client.ts, 18←) · resolveAgentClient (runner.ts, 9←)
```

Consistent grammar: `dir → N files → hubs: name (file, N←)`. Empirically validated by benchmark (7.7/8 quality). Dense, scannable, agent-parseable.

### 2. Token budget → No hard cap; format-as-constraint

The format's density is the budget control. No artificial truncation — every directory with meaningful hubs gets a line. Budget scales naturally with repo size:
- Small repo (~8 dirs): ~250 tokens
- Medium repo (~20 dirs): ~400 tokens
- Large repo (~40 dirs): ~600 tokens

Total injection (map + ranking + recent) floats with repo size.

### 3. Hub selection → Pure in-degree; recency handled separately

Hubs are selected by in-degree only (incoming edge count). Stable, deterministic, cacheable at index time. Recency is a separate signal handled by Feature 7 (Recent Changes section via `git diff`). Clean separation: map = structural landmarks, recent = temporal breadcrumbs.

### 4. Depth → 2 levels; subdirectories shown when they have hubs ≥ 5 in-degree

Show subdirectories when they contain at least one hub with in-degree ≥ 5. Leaf dirs with no significant hubs roll into their parent line. Matches Graft's actual benchmark-winning output and gives agents sub-module navigation awareness.
