# pr-watch

Notify-only watcher for my open PRs in Aspia-MyBusiness. A standalone script, not a pi
extension (pi loads only `extensions/` and `prompts/` from my-pi); tracked here in my-pi.

- Runs from Windows Task Scheduler (`pr-watch`, every 10 min while logged in) through
  `~/.pi/agent/pr-watch`, a junction to this folder.
- Each run: `gh api graphql` â†’ compare with `state.json` â†’ Windows toast for new comments/reviews
  from anyone but me (bots included) and CI failing on the head commit.
- `state.json`, `pr-watch.log`, `last-error-notified` are runtime files (gitignored).

```powershell
.\install.ps1 [-IntervalMinutes 10]   # register/replace the task
.\uninstall.ps1 [-Purge]              # remove the task (and runtime files)
.\pr-watch.ps1 -TestToast             # sample toast
powershell -File .\test.ps1           # offline tests
```

## Triage in pi (toast button)

The toast's **Triage in pi** (or **Triage all in pi**) button opens `prwatch://triage?prs=<Repo>:<n>,...&since=<UTC>`.
`install.ps1` registers that protocol for the current user (HKCU) → `run-hidden.vbs triage` → `triage.ps1`, which:
fills `triage-prompt.md` (`{{PRS}}`, `{{SINCE}}`, `{{ORG}}`) into `runs/triage-*.md` (kept 7 days, gitignored),
then starts `pi --name "PR triage <Repo>#<n>" @<file>` in a new herdr tab (the repo's main workspace if one
exists) or, if herdr is not running, a new PowerShell window. Links of any other shape are rejected.

`config.json`:

| Key | Meaning |
|---|---|
| `open` | `auto` (herdr, else window), `herdr` (herdr only), `window` (always a PowerShell window) |
| `model` | pi `--model`, e.g. `anthropic/claude-sonnet-5-5`; empty = pi default |
| `thinking` | pi `--thinking`: off, minimal, low, medium, high, xhigh, max; empty = default |
| `piArgs` | extra pi arguments, e.g. `["--no-mcp"]` |
| `promptFile` | prompt template, relative to this folder or absolute |
| `reposRoot` | where `<Repo>` checkouts live (cwd for a single-repo triage) |

Changes to `config.json` and `triage-prompt.md` apply on the next click; no reinstall needed.
