# pr-watch

Notify-only watcher for my open PRs in Aspia-MyBusiness. A standalone script, not a pi
extension (pi loads only `extensions/` and `prompts/` from my-pi); tracked here in my-pi.

- Runs from Windows Task Scheduler (`pr-watch`, every 10 min while logged in) through
  `~/.pi/agent/pr-watch`, a junction to this folder.
- Each run: `gh api graphql` → compare with `state.json` → Windows toast for new comments/reviews
  from anyone but me (bots included) and CI failing on the head commit.
- `state.json`, `pr-watch.log`, `last-error-notified` are runtime files (gitignored).

```powershell
.\install.ps1 [-IntervalMinutes 10]   # register/replace the task
.\uninstall.ps1 [-Purge]              # remove the task (and runtime files)
.\pr-watch.ps1 -TestToast             # sample toast
powershell -File .\test.ps1           # offline tests
```
