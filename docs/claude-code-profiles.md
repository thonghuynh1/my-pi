# Claude Code accounts in Pi (Claude 1, 2, 3, …)

Use any number of Claude subscriptions on one machine. Each account is a
numbered profile with its own `CLAUDE_CONFIG_DIR` (e.g. `~/.claude`,
`~/.claude-personal`, `~/.claude-3`) and its own provider, like Codex:

| Account | Provider | Example model |
|---|---|---|
| Claude 1 | `claude-bridge` | `claude-bridge/claude-sonnet-…` |
| Claude 2 | `claude-bridge-2` | `claude-bridge-2/claude-sonnet-…` |
| Claude 3 | `claude-bridge-3` | `claude-bridge-3/claude-opus-…` |

`claude-bridge-N` clones route through the one `pi-claude-bridge` instance and
pin their folder for each call. The footer shows usage per account as
`Claude 1`, `Claude 2`, ….

> Manage them in the `/account` modal (see [accounts.md](accounts.md)):
> pick a Claude account to make it the main session, add or remove accounts.

## Parts

| Piece | What it does |
|---|---|
| `pi-claude-bridge` (bundled via `my-pi` dependencies) | Registers provider `claude-bridge` (full Anthropic catalog). Keeps one persistent Claude Code session per Pi session via the Agent SDK, so steady turns hit prompt cache. It reads `CLAUDE_CONFIG_DIR` on every turn. |
| `extensions/account.ts` | Registers `claude-bridge-N` providers and pins `claude-bridge` to Claude 1. `/account` modal: Claude rows set the main session to that account's provider; `a` adds, `l` shows the login command, `x` removes. `/account status` lists accounts. |
| `extensions/lib/claude-profiles.ts` | Numbered profile registry in `~/.pi/agent/claude-profiles.json`. |
| `extensions/lib/claude-providers.ts` | The clone providers. |
| `extensions/lib/provider-usage/` | Footer rows `Claude 1`, `Claude 2`, … plus `/provider-usage` detail. A profile with no readable login shows no row. |

## Adding an account

1. `/account`, select a Claude row or `+ Add Claude account`, press `a`.
2. Accept the suggested folder (`~/.claude-N`) or type another; it is created
   and saved as the next number.
3. Run the printed command once **outside Pi** and sign in with that account
   (switch accounts in the browser tab if it picks the wrong one):

   ```bash
   CLAUDE_CONFIG_DIR=~/.claude-3 claude login
   ```

   ```powershell
   $env:CLAUDE_CONFIG_DIR="$HOME\.claude-3"; claude login
   ```

4. Restart Pi once so the footer gets the new usage row. In `/account` the
   row now shows as logged in; `Enter` makes it the main session.

## Daily use

- `/account` → `Enter` on `Claude N` sets the main model to
  `<its provider>/<model>` (the current Claude model, else the last one you
  used, else a Sonnet) and saves it as the default for new sessions.
- `/model` lists every account's models; `claude-bridge-2/<model>` runs on Claude 2.
- Accounts don't share state: a subagent on `claude-bridge-2/…` and a main
  session on `claude-bridge/…` run on their own logins at the same time.
- `claude-bridge` always means Claude 1. A `CLAUDE_CONFIG_DIR` set before
  launching Pi overrides that folder.
- Switching a session between accounts makes the next turn a full resend
  (the Claude Code session lives in the other account's folder).
- `/account status` lists accounts, providers, and login state.

## Configuration

`~/.pi/agent/claude-profiles.json`:

```json
{
  "profiles": [
    { "dir": "~/.claude", "provider": "claude-bridge", "apiKey": true },
    { "dir": "~/.claude-personal", "provider": "claude-bridge-2" }
  ],
  "lastModel": "claude-sonnet-5"
}
```

- Order defines the display numbers; `provider` ids never change, so settings
  that name `claude-bridge-3/…` survive removing Claude 2 (it then shows as
  Claude 2 but keeps `claude-bridge-3`). The folder and login stay on disk.
- `apiKey: true` keeps `ANTHROPIC_API_KEY` while that profile is active. Other
  profiles hide it so it can't shadow their OAuth login.
- Without the file, profiles default to `~/.claude` (with key) and
  `~/.claude-personal`. The old `{"workDir", "personalDir"}` format migrates to
  profiles 1 and 2 automatically.

| Env var | Purpose |
|---|---|
| `CLAUDE_PROFILE_<N>_DIR` | Override profile N's folder |
| `CLAUDE_PROFILE_WORK_DIR` / `CLAUDE_PROFILE_PERSONAL_DIR` | Legacy overrides for profiles 1 and 2 |
| `CLAUDE_CONFIG_DIR` | Active folder (set by the switcher) |

## Models and thinking effort

Models come from the Anthropic catalog via the bridge (dated snapshot ids
excluded). Effort is controlled per model or session through Pi's thinking
level; higher effort plus long transcripts drains plan quota faster, so reserve
top effort for single hard turns.

## The bridge: `claude-bridge`

Single provider. It holds one Claude Code session per Pi session and resumes it
(`--resume`), so steady turns send only new messages and hit prompt cache.
Expect a full resend (cache miss) after abort, `/compact`, branch navigation,
provider switch, profile switch, or a pause past the ~5-minute server cache
TTL — then caching resumes. `CLAUDE_BRIDGE_DEBUG=1` logs
`syncResult: path=reuse|rebuild` per turn in `~/.pi/agent/claude-bridge.log`.

Session dollars appear in the main `$` total, just like Codex. Positive
provider-reported costs take precedence. When the bridge reports zero prices,
known Claude model IDs use Pi's installed Anthropic catalog and pricing tiers.
Unknown model IDs contribute tokens but no estimated dollars. These dollars
represent API-equivalent usage, not an additional subscription charge.

If your plan is Max (or needs 1M context gating), copy the sample config to
`~/.pi/agent/claude-bridge.json` and set `provider.plan` (see the bridge
README); default is `pro`.

## Troubleshooting

- **Two rows show identical usage** — that folder got the other account's login
  (wrong browser account at login). Delete the folder and log in again with the
  right email.
- **Row says "not logged in"** — press `l` on it in `/account` and run the command.
- **Unexpected API billing instead of plan quota** — `ANTHROPIC_API_KEY` is
  shadowing OAuth. Only profiles with `apiKey: true` keep it; switch profile
  again in `/account` to re-apply.
- **A profile is rate-limited** — check its `Claude N` row; a maxed spend limit
  (e.g. `$500/$500 critical`) only resets on Anthropic's side. Switch to another
  Claude account meanwhile.
