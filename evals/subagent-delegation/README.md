# Subagent delegation prompt eval

This eval checks whether the main agent uses subagents the way Anthropic's article recommends:
[Building agents: When to fold subagents into your main agent loop](https://claude.com/resources/articles/building-agents-when-to-fold-subagents-into-your-main-agent-loop)
(Diane Sarkis, 2026-10-22). It is structured by pstack `poteto-mode/playbooks/eval` and its
`references/eval-checklist.md`.

## Layout

| path | contents |
|---|---|
| `tasks.csv` | Replayed turns: session id, source repo, target prompt, path of the raw Pi session |
| `labels-article.json` | MUST / EITHER / MUST-NOT label and ideal behaviour per task |
| `references.json` | Ideal transcript per task for the reference check |
| `bases.json`, `overlays.json` | Pinned base commit per task; git-ignored context files to copy into the checkout |
| `prompts/` | Guideline variants (`current` is the built-in text in `extensions/subagents.ts`) |
| `scripts/` | `run_eval.py` (replay runner), `judge_onepass.py` + `report_onepass.py` (blinded judge and report), `judge_use.py` (tier 2: use of child reports), `smoke_harness.py` (harness check, no model calls) |
| `results/` | Judged summaries kept for reference; raw run logs stay out of git |

Run output (logs, sessions, judged files) goes to a run folder outside the repo; by convention
`.scratch/subagent-eval/runN`, which is excluded locally. Earlier runs: `run2` (tier 1),
`run3` (tier 2).

## Running it

Run everything from `scripts/`, on Windows `cmd`. Use `python -I` because the scripts read untrusted
session data.

```bat
rem harness check, no tokens: builds the checkouts and prints refs/remote/fingerprint timing
python -I smoke_harness.py ..\tasks.csv T02,T10

rem trials: EVAL_PLAN=<variant>:<repeat>,...; EVAL_MODELS=opus|codex (default both);
rem EVAL_REAL=1 lets children really run (tier 2)
set EVAL_PLAN=current:1,slim-v4:1&& python -I run_eval.py ..\tasks.csv C:\my-pi\.scratch\subagent-eval\run4 T01,T02

rem reference check, then one blinded pass over every trial, then the report
python -I judge_onepass.py ..\tasks.csv ..\labels-article.json ..\references.json <run>\judged-refcheck.jsonl <run> --refs-only
python -I judge_onepass.py ..\tasks.csv ..\labels-article.json ..\references.json <run>\judged-onepass.jsonl <run> [<older run> ...]
python -I report_onepass.py <run>\judged-onepass.jsonl - <run>\report-onepass.md
```

Run parallel jobs on disjoint task lists only: tasks that share a repo and base share a checkout.

## Another machine

To run the eval on another machine you need:

- **The pi CLI** on `PATH`, with the `subagents` extension from this repo, which honours
  `PI_SUBAGENT_PROMPT_FILE` and `PI_SUBAGENT_EVAL_DRYRUN`.
- **The raw aiNho Pi sessions** under `~/.pi/agent/sessions/`. The runner looks each one up by
  `sid` when the `import_path` in `tasks.csv` doesn't exist.
- **The source repos at the paths the sessions used:** `C:\GitRepos\Tickets`, `C:\GitRepos\Documents`,
  `C:\GitRepos\worktrees\Tickets\feature-66077-move-message-threads-to-tickets`,
  `C:\GitRepos\worktrees\Tickets\feature-66552-migrationActivities-target` and
  `C:\Hackathon\tstack`. Each must have the pinned base commits, and a reflog that covers the turn
  dates, for refs as of the turn. Without the reflog, refs that moved later are dropped.
  `WORK_DIRS` and the `LIVE` guard in `run_eval.py` hard-code these paths.
- **Models:** `anthropic/claude-opus-5-5:medium` (also the judge) and `openai-codex/gpt-6.1-sol:medium`.

## What the article asks of the eval, and where it is covered

| article | here |
|---|---|
| Track routing (did it pick the right subagent, skill, tool) | Delegation decision graded by code against the label; child type checked by code (an explore child asked to run git, builds or tests fails) |
| Don't just read the final score; look at which tasks flipped | `report_onepass.py` lists per-task flips against `current` |
| A task for every rule the agent must not break | Rule coverage table below |
| Run each task more than once (a break showed in 1 of 2 runs) | At least 2 trials per task and model before any claim; MUST-NOT is pass^k |
| Cost and latency, not just quality | Median cost, seconds, and seconds to the first subagent call per variant. Dry runs stop at the decision, so these are decision-point numbers, not whole-task numbers |
| Verify the subagent's conclusion against real data with the main agent | Tier 2 (`EVAL_REAL=1`, `judge_use.py`): the parent checks child claims before relying on them |
| Change one thing at a time; keep what holds up | One variant against `current` per round |

### Rule coverage (slim-v4)

| rule | tasks |
|---|---|
| Stay in your loop by default | all MUST-NOT tasks |
| FLOOD: survey across many areas | T05 (repo-wide Book trace). **Gap:** no huge-log task can be replayed (it would need CI, ADO or runtime DB access) |
| PARALLEL: independent paths, same report shape, one batch | T05; T12 (EITHER) |
| VERIFY: black-box check after a change | T11 (EITHER: a fresh session is already a clean-context verifier). **Gap:** no task where the agent verifies its own change |
| Stay in loop: continuing a trace | T04 (EITHER: a shell child for large local logs is acceptable FLOOD) |
| Stay in loop: one causal chain | T10 |
| Stay in loop: explaining own work | C2 |
| Stay in loop: clarifying / judging options | C4 (C3 dropped: not replayable) |
| Stay in loop: resolving conflicts | T02 (EITHER: one read-only master-diff child allowed) |
| Stay in loop: coupled edits | C1 |
| Stay in loop: small edits | T07 |
| Stay in loop: updating a plan or doc | **Gap:** T06 dropped (its plan folder no longer exists) |
| Delegate before reading the material | judge `timing` |
| Brief: goal, facts, paths, report shape | judge `brief` |
| explore cannot run commands | code check in the report |
| Children research; parent keeps edits | judge `self_work` |
| Treat child reports as leads | tier 2 only |

## Status (2026-10-29)

- Steps 1 to 3 are done: the harness rebuild, the reference check (13/13), the one-pass re-judge of
  run2, and the new MUST tasks T11 and T12. The one-pass results are in `results/report-onepass.md`.
- **Step 4 round 1 is done.** 52 trials plus judge cost $15.41; results are in
  `results/report-run4-round1.md`. The verdict is inconclusive with no regression: slim-v4 matches current on every
  delegation decision except T03 codex, which improves. Neither variant delegates on T11 or T12 (MUST), and
  codex delegates T04 (MUST-NOT) under both. The T11/T12 labels are in question (see below), C3 can't be
  replayed (every trial leaks into tstack runtime state), and the cost gap is confounded by prompt-cache order.
  The runner now alternates which variant goes first.
- **Fixes after round 1:**
  - T11, T12 and T04 are relabelled EITHER.
  - C3 is dropped (UNCLEAR).
  - T11's prompt names the herdr-provider issue, through `prompt-overrides.json`, because the repo has three issue-09
    files.
  - Labels now: MUST T05; EITHER T01, T02, T03, T04, T07, T11, T12; MUST-NOT T10, C1, C2, C4.
  - The labels moved after seeing results. Any round 2 claim must say so, and the old labels remain in
    `results/judged-run4-round1.jsonl`.
- Round 1 setup (for reference): current vs slim-v4, one trial per task per model, across
  13 tasks and 2 models (52 trials, about $13), into `.scratch/subagent-eval/run4`. Next, within the
  approved $16, only the tasks that flip or sit on the split (T02, T04, T05, T07, T11, T12) get a
  second and third trial. A second trial on every task, as the article suggests, would bring the
  total to about $26 and needs approval.
- **Harness additions for step 4:** a trial that writes outside its checkout counts as a leak (the
  write/edit path is checked, plus new entries in `C:\tmp`). Each trial records its subagent briefs
  and the time to the first subagent call.
- **Not yet run:** a tier 2 round on T05, T11 and T12 for the "treat reports as leads" rule. It needs
  its own approval.

## Claim

The claim we want to ship (pass^k: every trial must pass):

> With the slim-v4 guidelines, neither model delegates on a MUST-NOT task: 0 delegations across all
> MUST-NOT trials (current: codex 2/10 in run2). Both models delegate on every MUST task, on 3/3
> trials per task. On delegating trials, the judge's timing/split/brief scores are no worse than
> with the current guidelines. Models: anthropic/claude-opus-5-5:medium, openai-codex/gpt-6.1-sol:medium.

**Variant under test:** `prompts/slim-v4.txt`. This is the text shipped in `extensions/subagents.ts`
`subagentCapabilityGuidelines`, with no duplicate injection in `before_agent_start`.
**Baseline:** `current`, the 11-bullet guidelines plus the startup injection.

## Tier

- **Tier 1** (replay one turn, stop at the first subagent call): delegation decision, timing, split and
  brief. Cost is about $0.4–1.2 per Opus trial; codex runs on the subscription.
- **Tier 2** (real children, `EVAL_REAL=1`, run3): how the parent uses child reports. Run only for
  the report-use claims, and kept small.

## Tasks

The tasks come from real aiNho Pi sessions (Tickets, Documents, tstack), each replayed at an early
turn with no prior edits. Labels come from the article and live in `labels-article.json`.

| label | tasks |
|---|---|
| MUST | T05 (+ new MUST tasks from step 3) |
| EITHER | T01, T02, T03, T07 |
| MUST-NOT | T04, T10, C1, C2, C3, C4 |
| dropped | T06 (plan folder gone), T08 (unclear), T09 (localdev on the live checkout) |

**Balance gap:** there is only one MUST task, so the set rewards never delegating. Step 3 adds
flood, parallel and verify tasks.

## Graders

- **Decision on MUST / MUST-NOT:** code (`delegated` against the label). Any delegation on MUST-NOT
  fails; no delegation on MUST fails.
- **Decision on EITHER, and timing / split / brief / self_work:** a blinded Opus judge (`judge_onepass.py`).
  One call per task scores every trial of both variants and both models, plus a hidden reference
  trial, on one scale. Trials are shuffled under sanitized labels (run-A, run-B, …). Each criterion
  is scored 0/1/2, `unclear`, or null when it does not apply.
  - We grade the path, not the outcome, because the behaviour under test is delegation itself.
- **Reference check:** `references.json` holds one ideal transcript per task. It is judged alone
  first (`--refs-only`), then again hidden among the trials. The judge must give it full marks, or
  the task, the rubric or the judge is broken.

## Isolation

- **Clean clone per task:** `git clone --shared` at the pinned base (`bases.json`), into
  `C:\tmp\wt\<repo>-<sha7>-<id>`. The clone has no remote, so fetch and push reach nothing. Branches
  and tags are rebuilt as they stood at the turn (from the reflog where they moved later); refs
  created after the turn are left out.
- **Reset per trial:** `reset --hard` + `clean -fdx`, then the `overlays.json` context files are
  copied back (T05: docs, AGENTS.md, …).
- **Live-repo fingerprint** before and after each trial (HEAD, tracked status, refs, FETCH_HEAD).
  A trial with `live_changed` is contaminated and gets checked by hand.
- **Leak guard:** a tool call that names a live checkout, runs `git fetch`/`pull`, or reopens a child
  from the replayed history ends the trial; the trial is discarded.
- **Neutral paths:** the session file and guideline file the agent might see live in `%TEMP%\pi-run\<hash>`.

### Differences from production (each weakens the claim)

1. **Tools and MCP servers excluded:** herdr, bg_run/bg_input/bg_kill, tstack*, cua*, browser_*;
   MCP azure_devops, playwright, cua, radius, figma.
2. **Subagent calls are dry runs** in tier 1: the trial stops at the first call, so report use is not
   measured there.
3. **Budget:** 15 actions (skill loading and the codemode wrapper don't count) or 300 s. Production
   has no cap.
4. **Checkout state:** detached HEAD in a clone with no remote, and refs rebuilt from the reflog
   (refs without reflog coverage that moved later are dropped). Git-ignored context exists only for
   T05.
5. **Prompts rewritten** from `engineering_skills_<x>` spellings to the real tool names
   (`mcp__engineering_skills__<x>`).
6. **History cut** at the target turn; extension state from the original session (Accordion folds,
   live jobs) is not reproduced.
7. **Codex provider:** run3 codex trials used `github-copilot/gpt-6.1-sol` while the openai-codex quota
   was exhausted. Tier 1 uses openai-codex.
8. **Judge:** Opus, the same family as one candidate. It is blinded to the model and variant.

**Caveat on earlier trials (run2 and run3 up to 2026-10-28):** these ran in worktrees that shared
the live refs, so they saw later branches. T02 merged today's master (`df5f7d27`) instead of the
master at the turn (`a9d9ea05`). Opus T10 trials before the prompt rewrite mostly searched the disk
for skills. Step 4 re-runs both variants in the new harness instead of reusing these trials.

## Budget

- Step 2 (reference check + one-pass re-judge): about $2–4.
- Step 4: about 40 trials, $15–20 of Opus. Confirmed with the user before starting.

## Trials

Start with 1 trial per task and variant. Add trials up to 3 where the variants disagree or the result
is close, and up to 5 for the shipped claim. MUST-NOT is pass^k: stop a task at its first
delegation.
