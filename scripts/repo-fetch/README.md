# repo-fetch

Fetches `origin` for selected repos from Windows Task Scheduler every 15 minutes while logged in.
Fetches only: it never touches working trees or local branches. Missed runs start when available;
runs also proceed while the screen is locked. `repo-fetch.log` is a runtime file (gitignored).

`config.json` (read on every run; no reinstall needed):

| Key | Meaning |
|---|---|
| `reposRoot` | Parent folder of the repos |
| `repos` | Repo folder names to fetch sequentially |
| `timeoutSeconds` | Fetch timeout per repo |

```powershell
.\install.ps1 [-IntervalMinutes 15]   # register/replace the task
.\uninstall.ps1 [-Purge]              # remove the task (and log)
.\repo-fetch.ps1                      # run once manually
```

Each run appends one line: `yyyy-MM-dd HH:mm:ss ok=<n>/<total> changed=<names or -> failed=<name: reason; ... or ->  (<seconds>s)`.
Unexpected errors are logged as `error: <message>`. The log is capped at 512 KB by retaining the
last 500 lines when it exceeds that size.
