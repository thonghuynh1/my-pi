Reference check, hidden among trials: 12/13 references at full marks: failing T05 {'decision': 2, 'timing': 2, 'split': 2, 'brief': 1, 'self_work': 2}
Judge errors: 0

| model / variant | trials | MUST-NOT delegated (pass^k) | MUST delegated | EITHER decision | timing | split | brief | self_work |
|---|---|---|---|---|---|---|---|---|
| codex / current | 12 | 1/5 (T04) | 1/3 | 1.25 (n=4) | 1.80 (n=5) | 1.20 (n=5) | 1.40 (n=5) | 1.42 (n=12) |
| codex / slim-v4 | 11 | 1/5 (T04) | 1/3 | 1.33 (n=3) | 2.00 (n=4) | 1.25 (n=4) | 1.75 (n=4) | 1.82 (n=11) |
| opus / current | 10 | 0/5 | 1/2 | 2.00 (n=3) | 2.00 (n=1) | 2.00 (n=1) | 2.00 (n=1) | 1.50 (n=10) |
| opus / slim-v4 | 8 | 0/4 | 1/2 | 2.00 (n=2) | 2.00 (n=1) | - | 2.00 (n=1) | 1.50 (n=8) |

## Per task: trials passing / trials (MUST, MUST-NOT by code; EITHER = judge decision 2)

| task | label | model | current | slim-v4 |
|---|---|---|---|---|
| C1 | MUST-NOT | codex | 1/1 | 1/1 |
| C1 | MUST-NOT | opus | 1/1 | · |
| C2 | MUST-NOT | codex | 1/1 | 1/1 |
| C2 | MUST-NOT | opus | 1/1 | 1/1 |
| C4 | MUST-NOT | codex | 1/1 | 1/1 |
| C4 | MUST-NOT | opus | 1/1 | 1/1 |
| T01 | EITHER | codex | 0/1 | 0/1 |
| T02 | EITHER | codex | 0/1 | 0/1 |
| T02 | EITHER | opus | 1/1 | · |
| T03 | EITHER | codex | 0/1 | 1/1 |
| T03 | EITHER | opus | 1/1 | 1/1 |
| T04 | MUST-NOT | codex | 0/1 | 0/1 |
| T04 | MUST-NOT | opus | 1/1 | 1/1 |
| T05 | MUST | codex | 1/1 | 1/1 |
| T05 | MUST | opus | 1/1 | 1/1 |
| T07 | EITHER | codex | 1/1 | · |
| T07 | EITHER | opus | 1/1 | 1/1 |
| T10 | MUST-NOT | codex | 1/1 | 1/1 |
| T10 | MUST-NOT | opus | 1/1 | 1/1 |
| T11 | MUST | codex | 0/1 | 0/1 |
| T12 | MUST | codex | 0/1 | 0/1 |
| T12 | MUST | opus | 0/1 | 0/1 |

## Flips against current (pass rate differs)

- T03 codex: current 0/1 -> slim-v4 1/1 (better)

## Cost and time to the decision (median per trial)

| model / variant | trials | cost | secs | delegated trials: secs to first subagent call |
|---|---|---|---|---|
| codex / current | 12 | $0.15 | 36.85 | 37.10 |
| codex / slim-v4 | 11 | $0.06 | 33.10 | 40.55 |
| opus / current | 10 | $0.55 | 45.25 | 47.20 |
| opus / slim-v4 | 8 | $0.22 | 37.50 | 39.80 |

## Rule check: explore child asked to run commands (0 of 11 delegating trials with recorded briefs)


## Below full marks

- **C1_opus_current_r1** (MUST-NOT, delegated=False) {'self_work': 1}: It correctly stayed in a single loop, but when the rename target was missing it went well beyond the rename: it dug through reflog and history, read large test files and rebuilt lost changes without asking.
- **T01_codex_current_r1** (EITHER, delegated=True) {'decision': 1, 'split': 1, 'brief': 1}: It delegated a read-only re-investigation of root causes it had already found before reading any code, which is defensible; but one child got three loosely related topics (retry handling, baseRef, branch naming), and the brief has no repo path and only a vague report shape.
- **T01_codex_slim-v4_r1** (EITHER, delegated=True) {'decision': 1}: It sent one focused explore child, with a repo path, named files, constraints and a file:line plus tests report shape, to scope the worker-start retry component, while keeping the design and the fixes for itself; that is defensible, though it re-scopes known causes rather than fixing them directly.
- **T02_codex_current_r1** (EITHER, delegated=True) {'decision': 1, 'split': 1, 'brief': 1}: Started the merge and listed the conflicts, then handed off to one read-only shell child; that is defensible, but the child is asked for per-hunk backend resolution calls rather than just a summary of master's changes, and the brief is terse.
- **T02_codex_slim-v4_r1** (EITHER, delegated=True) {'decision': 1, 'split': 0, 'brief': 1}: Delegates right after starting the merge, but splits coupled conflict-resolution analysis into three read-only children by topic (backend and two frontend groups) even though the generated client and native behaviour cross those boundaries; the briefs are terse though they do set read-only limits and ask for compact output.
- **T03_codex_current_r1** (EITHER, delegated=True) {'decision': 1, 'timing': 1, 'self_work': 1}: One explore child tracing the routing with a clear self-contained brief (scope, no edits, file:line report shape) is the acceptable alternative, but the parent first read CONTEXT.md and domain.md and grepped repairRound/consult/mailbox, partly doing the work it then delegated.
- **T03_opus_current_r1** (EITHER, delegated=False) {'self_work': 1}: A single loop is right, but after setup it pulled a broad 21k-char rg dump of 'consult' and burned actions on malformed PowerShell commands before reaching focused reads.
- **T03_opus_slim-v4_r1** (EITHER, delegated=False) {'self_work': 1}: A single loop fits this task, but after loading skills it ran a noisy repo-wide multi-pattern grep (about 15k chars, including .cursor hits) before narrowing to the coordinator and prompt-envelopes.
- **T04_codex_current_r1** (MUST-NOT, delegated=True) {'decision': 0, 'split': 1, 'self_work': 1}: On a must-not-delegate continuing trace, it handed log/journal evidence gathering to a shell child: the brief is well bounded and read-only, and the parent keeps the trace, but the evidence is coupled to that trace, and the parent first pulled whole files into its own context.
- **T04_codex_slim-v4_r1** (MUST-NOT, delegated=True) {'decision': 0, 'split': 1}: It traced the code path itself in a focused way, then delegated the local log/journal survey to a shell child with a strong, safe brief, but that evidence is coupled to the dependent trace the ideal keeps in one loop.
- **T05_codex_current_r1** (MUST, delegated=True) {'split': 1, 'brief': 1}: It delegated early and mostly by area, reusing earlier jobs, but one new child got a huge grab-bag scope (all frontend, admin, clients, database, three test suites) and the briefs are terse and partly confused about what explore children can do.
- **T05_opus_slim-v4_r1** (MUST, delegated=True) {'split': 'unclear'}: After a quick file count it delegated a well-formed, self-contained API-surface brief through codemode, but only one child is visible, so the parallel per-area split cannot be confirmed.
- **T07_codex_current_r1** (EITHER, delegated=False) {'self_work': 1}: A single loop fits, and loading the skills is expected setup, but it went on to bulk-read six files plus code from an external repo, which is heavy reading for a review check and two small edits.
- **T07_opus_current_r1** (EITHER, delegated=False) {'self_work': 1}: A single loop is the right call, but repo-wide greps returned about 40k and 24k characters, much of it not needed for the authorization check or the two small edits.
- **T07_opus_slim-v4_r1** (EITHER, delegated=False) {'self_work': 1}: Stayed in one loop as ideal, but read in large batches (about 26k characters at once) and had several failed scratch-path attempts before making any edit.
- **T11_codex_current_r1** (MUST, delegated=False) {'decision': 0, 'self_work': 0}: This was a MUST-delegate task, yet it did the verification alone, pulling several 40k-char dumps of skill files, test sources and rg scans into its own context instead of handing guarantee checks to children.
- **T11_codex_slim-v4_r1** (MUST, delegated=False) {'decision': 0}: It loaded the skill, found three candidate issue-09 files and asked which one to verify after only short reads, so its context stayed small, but it never got to verification or delegation.
- **T12_codex_current_r1** (MUST, delegated=False) {'decision': 0, 'self_work': 0}: It never delegated and spent its budget on broad greps and reads across infrastructure and application files to trace the creation paths itself.
- **T12_codex_slim-v4_r1** (MUST, delegated=False) {'decision': 0, 'self_work': 0}: After loading the skill it read CONTEXT, domain docs, multiple source files and session-naming docs itself, flooding its context instead of splitting the census across children.
- **T12_opus_current_r1** (MUST, delegated=False) {'decision': 0, 'self_work': 0}: It did all the work in its own context, including a 330-line read of orca-client, many greps across src and docs, and probing the Orca CLI, instead of sending one read-only child down each independent path.
- **T12_opus_slim-v4_r1** (MUST, delegated=False) {'decision': 0, 'self_work': 0}: It never delegated and traced every terminal-creation path itself with repo-wide greps and large reads of orca-client and coordinator, which is the broad census that parallel children should have owned.