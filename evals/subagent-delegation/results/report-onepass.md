Reference check, hidden among trials: 13/13 references at full marks
Judge errors: 0

| model / variant | trials | MUST-NOT delegated (pass^k) | MUST delegated | EITHER decision | timing | split | brief | self_work |
|---|---|---|---|---|---|---|---|---|
| codex / current | 21 | 2/11 (T04) | 2/2 | 1.00 (n=8) | 1.56 (n=9) | 0.89 (n=9) | 1.67 (n=9) | 1.81 (n=21) |
| codex / slim-v3 | 17 | 0/9 | 2/2 | 1.17 (n=6) | 1.86 (n=7) | 1.43 (n=7) | 1.86 (n=7) | 1.88 (n=17) |
| codex / slim-v4 | 1 | 0/1 | 0/0 | - | - | - | - | 2.00 (n=1) |
| opus / current | 20 | 0/10 | 1/2 | 1.75 (n=8) | 1.67 (n=3) | 1.67 (n=3) | 2.00 (n=3) | 1.84 (n=19) |
| opus / slim-v3 | 14 | 0/7 | 2/2 | 2.00 (n=5) | 2.00 (n=2) | 2.00 (n=2) | 2.00 (n=2) | 1.79 (n=14) |
| opus / slim-v4 | 1 | 0/1 | 0/0 | - | - | - | - | 2.00 (n=1) |

## Per task: trials passing / trials (MUST, MUST-NOT by code; EITHER = judge decision 2)

| task | label | model | current | slim-v3 | slim-v4 |
|---|---|---|---|---|---|
| C1 | MUST-NOT | codex | 1/1 | 1/1 | · |
| C1 | MUST-NOT | opus | · | 1/1 | · |
| C2 | MUST-NOT | codex | 1/1 | 1/1 | · |
| C2 | MUST-NOT | opus | 1/1 | 1/1 | · |
| C3 | MUST-NOT | codex | 2/2 | 2/2 | · |
| C3 | MUST-NOT | opus | 2/2 | · | · |
| C4 | MUST-NOT | codex | 2/2 | 1/1 | · |
| C4 | MUST-NOT | opus | 2/2 | 1/1 | · |
| T01 | EITHER | codex | 1/2 | 0/1 | · |
| T01 | EITHER | opus | 0/2 | · | · |
| T02 | EITHER | codex | 0/2 | 0/2 | · |
| T02 | EITHER | opus | 2/2 | 2/2 | · |
| T03 | EITHER | codex | 2/2 | 1/1 | · |
| T03 | EITHER | opus | 2/2 | 1/1 | · |
| T04 | MUST-NOT | codex | 0/2 | 2/2 | · |
| T04 | MUST-NOT | opus | 2/2 | 2/2 | · |
| T05 | MUST | codex | 2/2 | 2/2 | · |
| T05 | MUST | opus | 1/2 | 2/2 | · |
| T07 | EITHER | codex | 0/2 | 0/2 | · |
| T07 | EITHER | opus | 2/2 | 2/2 | · |
| T10 | MUST-NOT | codex | 3/3 | 2/2 | 1/1 |
| T10 | MUST-NOT | opus | 3/3 | 2/2 | 1/1 |

## Agreement with the earlier per-run judge

- decision: 63/70 equal, within 1: 70/70
- timing: 18/21 equal, within 1: 21/21
- split: 16/21 equal, within 1: 21/21
- brief: 16/21 equal, within 1: 21/21
- self_work: 48/69 equal, within 1: 69/69

## Below full marks

- **C1_opus_slim-v3_r1** (MUST-NOT, delegated=False) {'self_work': 0}: It stayed in one loop as it should, but when the rename target was missing it went digging through git fsck dangling blobs, the reflog and recursive file listings (51k chars), flooding its context instead of checking with the user.
- **C2_codex_current_r1** (MUST-NOT, delegated=False) {'self_work': 1}: It correctly stayed in a single loop and explained the resolution per conflict. However, its second wide git diff pulled roughly 40k characters of truncated output, more re-reading than an explanation from context needed.
- **C3_opus_current_r1** (MUST-NOT, delegated=False) {'self_work': 1}: It kept a single loop and found the real consult message, but used many lookups, including a 51KB database dump, instead of one targeted check.
- **C3_opus_current_r2** (MUST-NOT, delegated=False) {'self_work': 1}: It kept a single loop but spent its whole 15-action budget on deep journal database spelunking, far beyond one targeted lookup, and never answered.
- **T01_codex_current_r2** (EITHER, delegated=True) {'decision': 0, 'split': 1, 'brief': 1}: It delegated early with only orientation and skill loading first, but it handed the Jev one-tool design recommendation to a child, mixed the Jev architecture into the workspace-bug child so two children overlap, and the briefs ask only for a 'concise' report with no fixed shape.
- **T01_codex_slim-v3_r1** (EITHER, delegated=True) {'decision': 1, 'split': 1}: A read-only, word-capped child re-scopes placement root causes the main agent already found last turn, which is defensible but not ideal; the per-component split is implied by the task array, but only one child is visible.
- **T01_opus_current_r1** (EITHER, delegated=True) {'decision': 1, 'timing': 1}: Two independent, well-shaped explore children (baseRef path and retry bound) run in parallel, but the agent had already read the placement and coordinator code that the baseRef child re-traces.
- **T01_opus_current_r2** (EITHER, delegated=True) {'decision': 1, 'split': 1}: The retry-path research brief is strong (shared constraints, evidence, numbered questions, word cap) and keeps the design in the main agent, but re-researching known causes is not ideal and only one child of the split is visible.
- **T02_codex_current_r1** (EITHER, delegated=True) {'decision': 0, 'split': 0, 'brief': 1}: It gave a shell child the job of resolving and staging conflicts, splitting coupled merge work by path, though it delegated right after orientation and the brief has scope, constraints and a report request.
- **T02_codex_current_r2** (EITHER, delegated=True) {'decision': 0, 'split': 0, 'brief': 1}: It had three shell children resolve and stage conflicts by path, dividing coupled merge work, which the ideal marks as wrong.
- **T02_codex_slim-v3_r1** (EITHER, delegated=True) {'decision': 1, 'split': 1, 'brief': 1}: It used read-only explore children, which is defensible, but three of them carve all conflict analysis by area, and the briefs are terse and do not say a merge is in progress.
- **T02_codex_slim-v3_r2** (EITHER, delegated=True) {'decision': 1, 'split': 1}: It used two read-only explore children with clear compact report shapes, which is acceptable, but it splits the coupled conflict analysis frontend/backend instead of a single master-changes summary.
- **T03_opus_current_r2** (EITHER, delegated=False) {'self_work': 1}: It used a single loop, but broad recursive filesystem and grep sweeps pulled noisy log output (12k chars) into context before any focused code tracing.
- **T04_codex_current_r1** (MUST-NOT, delegated=True) {'decision': 0, 'timing': 1, 'split': 0}: It reads the core client and coordinator sections, then hands those same coupled halves of one causal timeout chain to two explore children, splitting a dependent trace that should stay in one loop.
- **T04_codex_current_r2** (MUST-NOT, delegated=True) {'decision': 0, 'timing': 1, 'split': 0}: After reading the key client and coordinator code, it splits the coupled timeout trace into host-side and coordinator-side explore children, cutting the causal chain the main agent should own.
- **T04_codex_slim-v3_r2** (MUST-NOT, delegated=False) {'self_work': 1}: It correctly stays in one loop, but it accumulates large and partly redundant reads, such as client.ts re-read and long session.ts and recover-accepted-work chunks, beyond what the trace needs.
- **T05_codex_current_r2** (MUST, delegated=True) {'self_work': 1}: Its parallel per-area children and search follow-up have complete exclusive-scope briefs, but beforehand it pulled a 16k-char file listing and set up the Book exclude file, which is heavier orientation than needed.
- **T05_codex_slim-v3_r1** (MUST, delegated=True) {'split': 1}: It delegated immediately with a well-specified brief, but to a single repo-wide inventory child rather than parallel per-area tracers.
- **T05_opus_current_r2** (MUST, delegated=False) {'decision': 0}: It never delegated, but its reads stayed focused, and it reasonably halted to ask the user because the checkout had been reset underneath it.
- **T07_codex_current_r1** (EITHER, delegated=True) {'decision': 1, 'timing': 1, 'split': 1, 'self_work': 1}: The authorization child is reasonable, but a second child to investigate the small batch-cap edit is unnecessary, and it came after the parent had already read about 36k chars of those same files.
- **T07_codex_current_r2** (EITHER, delegated=True) {'decision': 1, 'timing': 1, 'self_work': 1}: It delegated only the auth deep dive with a thorough brief, but first read the authorization and testing skills itself, about 32k chars that overlap the child's work.
- **T07_codex_slim-v3_r1** (EITHER, delegated=True) {'decision': 1}: It handed only the authorization deep dive to a read-only child, after reading just the batch and config files, and kept the small edits itself, which is the acceptable pattern.
- **T07_codex_slim-v3_r2** (EITHER, delegated=True) {'decision': 1, 'timing': 1, 'self_work': 1}: Its explore child for the auth deep dive has an excellent brief, but the parent first read the auth request file and about 28k chars of skills itself.
- **T07_opus_slim-v3_r1** (EITHER, delegated=False) {'self_work': 1}: Staying in one loop is right, but the first read pulled in a truncated 40k-char dump, which is broader than this task needs.
- **T10_opus_current_r2** (MUST-NOT, delegated=False) {'self_work': 'unclear'}: Timed out after two skill-location searches, so the transcript shows no investigation work to rate.