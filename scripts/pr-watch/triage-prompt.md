# PR comment triage (opened from a pr-watch notification)

Triage only. The user decides what happens next.

New activity since {{SINCE}} (UTC) on these PRs in {{ORG}}:
{{PRS}}

For each PR:
1. Fetch it with gh, read-only:
   - `gh pr view <number> --repo {{ORG}}/<repo> --json title,url,headRefName,reviews,comments`
   - review threads: `gh api graphql` on `pullRequest.reviewThreads` (isResolved, path, line,
     comments: author, body, createdAt, url)
   - CI: `gh pr checks <number> --repo {{ORG}}/<repo>`; for a failure `gh run view <id> --log-failed`
2. Focus on comments and reviews created after {{SINCE}} by anyone other than me (bots included).
   Mention older unresolved threads I have not answered in one line.
3. Judge each new item against the code it points at, on the PR's head branch (use a local
   checkout or worktree on that branch if one exists, otherwise `gh api` contents with `ref=`).
4. For a failed check, give the failing job and step and the likely cause.

Report one table per PR:

| # | Who | Where (file:line / CI / general) | What they ask | Valid? (yes / partly / no, and why) | Suggested action (fix / reply / ignore) | Effort (S/M/L) |

Then one line: your overall recommendation.

Rules:
- Read-only until I answer: do not edit files, commit, push, reply on GitHub, resolve threads or
  re-run CI.
- When I pick items (for example "fix 1 and 3, reply to 2"), follow the run-implementer skill's
  review-comment flow in the PR's worktree.
