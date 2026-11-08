# What we measure

Scorecard of every metric in this analysis: what it means, where it comes from, the current
result, and how far to trust it. Details and tables: [README.md](README.md). Fresh numbers after a
re-run: `out/report-<host>.md`.

Eras: **before** 2026-07-01 → 2026-09-24, **after** 2026-09-25 → 2026-11-08 (work repos: cutoff 2026-08-27).
Tokens = input + cacheRead + cacheWrite.

**Confidence**: ✅ measured directly · 🟡 measured with a proxy or heuristic · ❌ not measurable yet

## Cost

| Metric | Definition | Source | Before → after | Confidence |
|---|---|---|---|---|
| Input tokens per day | Sum of tokens, divided by active days | `sql/01` | 90M → 204M (2.3×) | ✅ |
| Output tokens per day | Sum of `usage.output` per active day | `sql/01` | 0.49M → 1.01M (2×) | ✅ |
| Cache hit rate | cacheRead ÷ tokens | `sql/01` | 92.7% → 95.3% main, 97.3% workers | ✅ |
| Context per turn | Average tokens per assistant turn | `sql/01` | main 92k → 109k; side 118k; worker 91k | ✅ |
| Tokens per session type | Average per session | `sql/01` | main 2.8M → 4.8M; side 7.2M; worker 4.0M | ✅ |
| Planning cost per effort | Old in-chat planning session vs new main chat + its side conversations + workers | `sql/02` | 4.8M → 35.8M avg (planning median 1.8M → 13.2M) | 🟡 old sessions picked by first-message keywords; parent links inferred |
| Dollar cost | Price × tokens | — | not available (subscription, cost fields = 0) | ❌ |

## Automation

| Metric | Definition | Source | Before → after | Confidence |
|---|---|---|---|---|
| Human messages per day | User messages you typed (injections and background notices excluded) | `sql/03` | 133 → 174 (+31%) | 🟡 prefix filter |
| Agent turns per human message | Assistant turns ÷ human messages | `sql/03` | main 7.4 → 7.9; side 7.4; **worker 79** | 🟡 |
| Tool calls per human message | Tool results ÷ human messages | `sql/03` | main 10.9 → 8.5; side 8.1; **worker 80** | 🟡 |
| Human messages per session | — | `sql/03` | main 4.1 → 5.6; side 8.2; worker 0.6 | 🟡 |

## Speed

| Metric | Definition | Source | Before → after | Confidence |
|---|---|---|---|---|
| Session length | Median started → ended | `sql/04` | main 4.7 → 11.4 min; worker 6.6 min; side 75 min | ✅ |
| Commits per day | `git log`, aiNho + tstack + my-pi | git | 5.9 → 25.3 | ✅ (commit size may differ) |
| Closed issues per day | `.scratch` issue files reaching closed/resolved/done | `issues.py` | 1.7 → 7.9 (tstack 0.27 → 7.1) | ✅ |
| Issue lead time | Opened → closed | `issues.py` | median 0 h (opened and closed in the same commit) | ❌ |
| Ticket lead time (work repos) | First session → merge on main | `merged_prs.py` | pending run on work machine | ❌ for now |

## Shipping and value

| Metric | Definition | Source | Before → after | Confidence |
|---|---|---|---|---|
| Tokens per closed issue | Repo tokens ÷ issues closed in era | `sql/07` + `issues.py` | all 12.8M → 8.0M; tstack 50M → 6.4M; aiNho 3.4M → 17.5M | ✅ (issues may be smaller after) |
| Close rate | Opened issues that got closed | `issues.py` | tstack 90% → 73%; aiNho 90% → 59% | ✅ |
| Merged tickets per week (work repos) | Merges on main with ticket number | `merged_prs.py` | pending run on work machine | ❌ for now |
| Tokens per merged ticket (work repos) | Repo tokens ÷ merged tickets | `merged_prs.py` | pending run on work machine | ❌ for now |
| Tokens per ticket touched (work repos) | Session tokens grouped by ticket number | aiNho | Tickets: tstack 7.4M vs main 0.8M median; Documents: 3.6M vs 9.0M | 🟡 regex ticket numbers |

## Reliability

| Metric | Definition | Source | Before → after | Confidence |
|---|---|---|---|---|
| Tool error rate | `tool_results.is_error` ÷ calls | `sql/05` | 4.7% → 4.8% (unchanged) | ✅ |
| Team-run completion | Last seen status per run | `sql/06` | 34% completed, 62% stopped (of runs with a final status) | 🟡 status snapshots |
| Runs per completed feature | Runs until a feature completes | `sql/06` | 5.4 | 🟡 23 features only |
| Wasted runs | Runs on features that never completed | `sql/06` | 30 runs over 10 features | 🟡 |

## Not measured yet

- **Work-repo shipping**: needs `merged_prs.py` on the work machine.
- **Plan quality**: whether side-conversation plans cause fewer redos. No signal links a plan to later rework.
- **Issue size**: lines changed per closed issue, to correct "per issue" numbers for smaller slicing.
- **Dollar cost**: needs a model price table.
