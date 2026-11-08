# tstack value vs cost analysis

Scorecard of every metric: [MEASURES.md](MEASURES.md). Latest generated numbers: `out/report-<host>.md`.

Does moving to tstack workers + side conversations help ship, and is the token cost per
task worth it? Data: aiNho Memory Store (Pi sessions, all machines) + git history.
Generated 2026-11-09 on DESKTOP-LJB4PL8. Work repos (Tickets, Documents) still need a run on
the work machine — see [Re-run](#re-run).

## Method

- **Tokens** = `input + cacheRead + cacheWrite` from each assistant message's `metadata.usage`.
  `messages.tokens_in` is uncached input only and is useless here. Cost fields are 0
  (subscription), so there are no dollar figures; ~95% of input is cache reads in both eras.
- **Eras**: before = 2026-07-01 → 2026-09-24; after = 2026-09-25 → 2026-11-08 (first tstack
  worker). Work repos use 2026-08-27 (first tstack session there).
- **Session kind**: `import_path` under `tstack-worker-sessions` = worker,
  `tstack-side-conversation-sessions` = side conversation, otherwise main chat.
- **Parent linkage**: a worker/side conversation belongs to the main chat that mentions its
  tstack session id and was active when it started (121/121 side, 656/704 workers linked).
- **Human messages** exclude `[Background…`, `===…` injections and tstack assignments.
- **Task** (personal repos) = one `.scratch/<feature>/issues/NN-*.md`; closed when its
  `Status:` first becomes closed/resolved/done in git. **Task** (work repos) = ticket number.

## Findings

### 1. Cost

| Era / kind | Sessions | Input tokens | Per session | Avg context/turn | Cache hit |
|---|---|---|---|---|---|
| before, main | 2,594 | 7.2B | 2.8M | 92k | 92.7% |
| after, main | 1,154 | 5.5B | 4.8M | 109k | 95.3% |
| after, side conversation | 121 | 0.9B | 7.2M | 118k | 94.9% |
| after, worker | 702 | 2.8B | 4.0M | 91k | 97.3% |

Per day: input 90M → 204M (2.3×), output 0.49M → 1.01M (2×).

Planning effort: an old in-chat planning session (grill/PRD/issues) averaged **4.8M**
(median 1.8M). A new main chat that used side conversations averaged **35.8M** (own 9.5M +
side 12.5M + workers 13.9M; planning median 13.2M). Side conversations did not make the main
chat leaner.

### 2. Automation

| | Human msgs/session | Agent turns per human msg | Tool calls per human msg |
|---|---|---|---|
| main, before | 4.1 | 7.4 | 10.9 |
| main, after | 5.6 | 7.9 | 8.5 |
| side conversation | 8.2 | 7.4 | 8.1 |
| **worker** | **0.6** | **79** | **80** |

Per day: human messages +31% (133 → 174), agent turns 2× (985 → 1,974). Workers carry the
automation; side conversations are as hands-on as normal chat.

### 3. Shipping and cost per task (personal repos)

| Repo | Closed issues before → after | Closed/day | Tokens per closed issue |
|---|---|---|---|
| tstack | 23 → 319 | 0.27 → 7.1 | 50M → **6.4M** |
| aiNho | 38 → 36 | 0.44 → 0.80 | 3.4M → **17.5M** |
| my-pi | 84 → 1 | — | work moved elsewhere |
| **all three** | 145 → 356 | 1.7 → **7.9** (4.7×) | 12.8M → **8.0M** (−38%) |

Commits/day across the three repos: 5.9 → 25.3. Lead time per issue is not measurable: most
issue files are created and closed in the same commit.

### 4. Reliability

- Tool error rate unchanged: ~4.7% in every era/kind.
- Team runs (23 traceable features): 9 eventually completed after **5.4 runs each**;
  10 were stopped and never completed (30 runs). About half of stopped runs are pure waste.

### 5. Work repos (Tickets, Documents) — from aiNho only

| | Tickets before → after | Documents before → after |
|---|---|---|
| Input tokens / active day | 10M → 75M | 9M → 63M |
| Human msgs / active day | 28 → 55 | 17 → 38 |
| Tickets touched / active week | 1.9 → 11 | 1 → 21 (noisy) |
| Median tokens per ticket, with tstack vs main only | 7.4M vs 0.8M | 3.6M vs 9.0M |

Before tstack, agents did almost no git work here (3 commits, 0 pushes); after, they commit,
push, merge and call Azure DevOps. Your own effort roughly doubled. Shipping (merged PRs) is
not in aiNho — run `merged_prs.py` on the work machine to get tokens per merged ticket.

### Verdict

| Repo | Verdict |
|---|---|
| tstack | ✅ Clearly pays: 26× closed issues/day, 7.7× cheaper per issue |
| Documents | 🟡 Promising: tstack tickets cheaper, zero human msgs; shipping unconfirmed |
| Tickets | 🟠 Unproven: 7× tokens, 2× human effort, ~46M avg per tstack ticket |
| aiNho | ❌ Not paying: 5× tokens per closed issue, heavy side-conversation planning |

Recommendations: keep workers for well-sliced issue work; use side conversations only for large
features (not aiNho-sized ones); stop a feature after ~2 failed runs and re-plan instead of 5.

## What aiNho could not prove (gaps)

| Gap | Workaround used | What would close it |
|---|---|---|
| **No outcome data**: commits, merges and PRs are not linked to sessions | Separate `git log` per repo; work repos impossible from this machine | Import commit SHAs/PR ids produced by a session (from `git commit`/`az repos pr` tool results), or a commits table keyed by repo |
| **No task identity** | Regex 5-digit ticket numbers from paths and messages (noisy) | Auto-fill Work Session `external_id` from worktree branch / tstack `featureTag` |
| **No tstack lineage** | Substring match of child ids in parent transcripts + time window (48 workers unlinked) | Store `parent_session_id`, `team_run_id`, `side_conversation_id` at import |
| **No team-run ledger** | Parse CSV text out of `tstack_run_status` results; 89 runs have no final status | Import tstack run records (status, verdict, repair rounds, merged) |
| **Usage buried in JSON**; `tokens_in` misleading | `json_extract` of `usage.input/cacheRead/cacheWrite` | First-class `cache_read`/`cache_write` columns and a per-session usage view |
| **No price data** (cost = 0 on subscription) | Raw token counts | Model price table → cost-weighted view |
| **Human vs injected user messages** not distinguished | Prefix filter on content | Message `origin` flag (human / background / tstack injection) |
| **Issue lifecycle** not captured | Git history of `.scratch` files (created-closed same commit) | Track issue status events with timestamps |
| **`aiNho sql` ergonomics** | Statement as one argv; on Windows the `.CMD` shim eats `%` and newlines | `aiNho sql --file q.sql` or stdin |

## Re-run

```bash
analyse/run.sh --import          # aiNho import, then everything below
```

- `sql/01..07-*.sql` → `out/<name>.csv` (eras via `CUTOFF`/`SINCE`, defaults 2026-09-25 / 2026-07-01).
- `issues.py` → `out/issues-summary-<host>.csv` for `ISSUE_REPOS` that exist on this machine.
- `merged_prs.py` → `out/work-repos-<host>.md` for `WORK_REPOS` that exist (Tickets, Documents).

**On the work machine** (has `C:/GitRepos/Tickets` and `C:/GitRepos/Documents`): pull this
repo, then `analyse/run.sh --import`, or only the work-repo part:

```bash
python -I analyse/merged_prs.py --cutoff 2026-08-27 --out analyse/out/work-repos.md \
  C:/GitRepos/Tickets C:/GitRepos/Documents
```

It counts merges / Azure DevOps "Merged PR" squashes on the main branch authored by your
`git config user.email` (`--all-authors` to drop that filter) and joins them to aiNho tokens per
ticket: merged tickets/week, tokens per merged ticket, and median lead (first session → merge).
Commit the `out/work-repos-*.md` result back to fill section 5.
