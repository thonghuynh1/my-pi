# tstack value vs cost analysis

Scorecard of every metric: [MEASURES.md](MEASURES.md). Latest generated numbers: `out/report-<host>.md`.

Does moving to tstack workers + side conversations help ship, and is the token cost per
task worth it? Data: aiNho Memory Store (Pi sessions, all machines) + git history.
Personal repos generated 2026-11-09 on DESKTOP-LJB4PL8. Work repos (Tickets, Documents)
generated 2026-11-09 on PRDPF5DFZH6, which is the machine that has them.

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

### 5. Work repos (Tickets, Documents)

Effort, from aiNho:

| | Tickets before → after | Documents before → after |
|---|---|---|
| Input tokens / active day | 10M → 75M | 9M → 63M |
| Human msgs / active day | 28 → 55 | 17 → 38 |
| Tickets touched / active week | 1.9 → 11 | 1 → 21 (noisy) |
| Median tokens per ticket, with tstack vs main only | 7.4M vs 0.8M | 3.6M vs 9.0M |

Before tstack, agents did almost no git work here (3 commits, 0 pushes); after, they commit,
push, merge and call Azure DevOps. Your own effort roughly doubled.

Delivery, from `delivery.py` on PRDPF5DFZH6, measured against Azure DevOps work item state.

**Do not use merge-to-master as the shipping gate on this platform.** `merged_prs.py` answers
"what reached `origin/master` under your git email", and that gate is wrong twice over here.
Per `/feature-workflow`, pushing `feature/<id>-*` deploys to TST, and an item then sits in
`Ready for test`, `Test in TST`, `Test in ACC` or `Review` for weeks before master. Separately,
the agent commits under whatever `user.email` the worktree carries, which in `Documents` is
`fixture@test.local` (160 commits since 2026-06-01, against 10 under the human email), so a
human-email filter discards nearly all agent work. Its 917M-per-merged-ticket figure is an
artifact of both mistakes and must not be quoted.

Where the ticket-tagged spend actually sits, 2,448M tokens over 84 candidate ids:

| How far the item got in ADO | Items | Tokens | Share | Per item |
|---|---|---|---|---|
| delivered (`Done`) | 22 | 328M | 13% | 14.9M |
| in test (`Ready for test` / `Test in TST` / `Test in ACC` / `Review`) | 9 | 1,051M | 43% | 116.8M |
| in progress | 7 | 303M | 12% | 43.4M |
| not started (`Approved` / `New` / `Refinement`) | 7 | 585M | 24% | 83.6M |
| removed | 2 | 16M | 1% | 8.0M |
| test artifact, not work | 4 | 32M | 1% | 8.0M |
| not a real work item | 33 | 132M | 5% | 4.0M |

**56% of ticket-tagged spend is on work that reached test or Done.** 31 items got that far, and
tstack was involved in 17 of them carrying 1,258M of the 1,379M. Both repos deliver. Documents
has 10 `Done` quality issues plus 66240 in `Test in TST` and 70450 in `Review`.

Holding work item type and end state fixed, so tstack and main chat are compared on like work:

| Type and state | Via | Items | Median | Mean |
|---|---|---|---|---|
| Quality issue, `Done` | tstack | 7 | **4.0M** | 25.8M |
| Quality issue, `Done` | main chat | 7 | **3.9M** | 14.6M |
| Product Backlog Item, in test | tstack | 7 | 124.6M | 149.3M |
| Product Backlog Item, `Done` | main chat | 5 | 2.4M | 3.6M |

Quality issues are the only population large enough to compare, and there the median cost per
delivered item is a wash, 4.0M against 3.9M. The tstack mean is 1.8× higher, so the tail is
fatter, not the typical item. The two PBI rows are not comparable; they differ in both state and
almost certainly size, and the five main-chat `Done` PBIs are small older items. What the PBI
rows do show is that every one of the seven PBIs now in test runs through tstack.

Two cost sinks worth attention. 585M sits on seven items still in `Approved` / `New` /
`Refinement`, which is either board hygiene lagging real work or work started ahead of the
backlog. And 132M went to 33 ids that are not work items at all, because the `[67]\d{4}` regex
matches any five-digit number; every id above 71566 in the candidate list is nonexistent.

Separately, sessions carrying no ticket number account for 2,103M tokens in Tickets (452
sessions, 52% of that repo) and 834M in Documents (204 sessions, 62%). Combined that is 2,937M
with no outcome attachable to it, 55% of all work-repo spend, and it is the single largest
measurement hole in this analysis.

### Verdict

| Repo | Verdict |
|---|---|
| tstack | ✅ Clearly pays: 26× closed issues/day, 7.7× cheaper per issue |
| Tickets | 🟡 Delivers at parity cost: same median per delivered quality issue as main chat, and it carries every PBI now in test |
| Documents | 🟡 Delivers: 10 quality issues `Done`, 66240 in `Test in TST`, 70450 in `Review` |
| aiNho | ❌ Not paying: 5× tokens per closed issue, heavy side-conversation planning |

Both work repos deliver, and neither shows a cost penalty on comparable work. The honest summary
is parity on quality issues and unmeasured on PBIs, because no main-chat PBI reached test in this
window to compare against.

Recommendations: keep workers for well-sliced issue work; use side conversations only for large
features (not aiNho-sized ones); stop a feature after ~2 failed runs and re-plan instead of 5.

## What aiNho could not prove (gaps)

| Gap | Workaround used | What would close it |
|---|---|---|
| **No outcome data**: commits, merges and PRs are not linked to sessions | ADO work item state per ticket via the Azure DevOps MCP, snapshot in `out/ado-states.csv` | Import commit SHAs/PR ids produced by a session, or a commits table keyed by repo |
| **Most work-repo spend is unattributable**: 55% of work-repo tokens are in sessions with no ticket number | Reported as its own bucket rather than spread over tickets | Work Session `external_id` from the worktree branch, so every session carries its ticket |
| **Git author is not the worker**: agent commits land under the worktree's `user.email`, `fixture@test.local` in Documents | Dropped the author filter and gated on ADO state instead | A stable agent identity, or session-to-commit links at import |
| **Ticket regex has a 39% false positive rate**: 33 of 84 ids are not work items | Validated every id against ADO before counting | `external_id` on Work Sessions removes the need to regex at all |
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

**On the work machine** (has `C:/GitRepos/Tickets` and `C:/GitRepos/Documents`):

```bash
analyse/run-work-repos.sh      # waits out the Memory Store lock, then imports and renders
```

The Memory Store is a single-writer DuckDB file, so a running `aiNho sync` or `aiNho import`
blocks every read with `IO Error: Cannot open file`. The wrapper polls until it clears. Launching
it from a background runner needs the full path to Git Bash, because `bash` under cmd.exe
resolves to the WSL launcher, which group policy blocks on this machine.

`delivery.py` is the one to trust for work repos. It joins token spend per work item to that
item's Azure DevOps state from `out/ado-states.csv`. That snapshot is taken through the Azure
DevOps MCP, since no CLI here reaches ADO, so refresh it by re-running `wit_work_item action=get`
for the candidate ids and rewriting the file. Without a refresh the states go stale while the
token numbers stay current.

`merged_prs.py` is kept only for repos where master really is the delivery gate. It now counts
three PR landing shapes (a real merge commit, an Azure DevOps `Merged PR NNNN:` squash, and a
GitHub `... (#NNN)` squash, both work repos having moved to GitHub during 2025) and takes an
explicit `--author`. Neither fix makes it the right tool for Tickets or Documents. See the gate
warning in section 5.

Commit the `out/work-repos-*.md`, `out/ado-states.csv` and `out/report-*.md` results back.
