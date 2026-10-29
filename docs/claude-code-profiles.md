# Claude Code profiles in Pi (work + personal)

Use two Claude subscriptions on one machine — e.g. work OAuth in `~/.claude`
and personal OAuth in `~/.claude-personal` — and switch between them inside Pi.
Model calls go through the `pi-claude-bridge` provider (persistent Claude Code
session per Pi session); usage for
both subscriptions shows in the footer.

## Parts

| Piece | What it does |
|---|---|
| `pi-claude-bridge` (bundled via `my-pi` dependencies) | Registers provider `claude-bridge` (full Anthropic catalog). Keeps one persistent Claude Code session per Pi session via the Agent SDK, so steady turns hit prompt cache. |
| `extensions/claude-profile.ts` | `/claude-profile` picker: shows only logged-in profiles, hides the rest behind `+ Set up ...`, and can save profile folders for you. |
| `extensions/lib/claude-profiles.ts` | Profile registry: precedence is env var > saved file > default. |
| `extensions/lib/provider-usage/` | Footer rows `Claude-W` / `Claude-P` plus `/provider-usage` detail. A profile with no readable login simply shows no row. |

## One-time setup: personal login

Prerequisite: a personal Claude account with Pro or Max.

In Git Bash (PowerShell equivalent below), log the **personal** account into
its own isolated config dir. This never touches the work login in `~/.claude`:

```bash
CLAUDE_CONFIG_DIR=~/.claude-personal claude login
```

Sign in with the **personal** email in the browser tab (switch accounts there
if it defaults to work), authorize, and wait for terminal success. Then:

```bash
CLAUDE_CONFIG_DIR=~/.claude-personal claude -p --model sonnet "Reply with exactly OK"
```

PowerShell:

```powershell
$env:CLAUDE_CONFIG_DIR="$HOME\.claude-personal"; claude login
$env:CLAUDE_CONFIG_DIR="$HOME\.claude-personal"; claude -p --model sonnet "Reply with exactly OK"
```

If you keep a work `ANTHROPIC_API_KEY` exported in your shell profile, prefix
personal CLI calls with `env -u ANTHROPIC_API_KEY` so the key doesn't shadow
personal OAuth. (Inside Pi the profile switcher handles this for you.)

## Daily use in Pi

1. Restart Pi after installs.
2. `/claude-profile` — pick **Claude Work** or **Claude Personal**. The pick is
   remembered, so new sessions start on it; you only switch when you want the
   other one.
3. `/model` — provider `claude-bridge`, e.g. `claude-bridge/claude-sonnet-5` (or `opus`/`haiku` equivalents from the catalog).
4. Footer shows `Claude-W` /
   `Claude-P`; `/provider-usage` then `r` refreshes both.

Your existing work-token Pi provider is independent — switching profiles only
affects `claude-bridge` turns (a mid-session switch forces one session rebuild,
then caching resumes).

## Adding a profile from inside Pi

If a profile isn't logged in yet, the picker shows `+ Set up Claude ...`
instead of hiding silently. Picking it asks for a folder (prefilled,
`~`-aware), creates it, saves it to `~/.pi/agent/claude-profiles.json`, and
prints the one `claude login` command to run outside Pi. The profile appears
as a real choice once that login succeeds. `Esc` goes back without saving.

Script-friendly equivalents (no TUI needed):

```text
/claude-profile use work|personal   # switch (refuses if that side isn't logged in)
/claude-profile status              # dirs, readiness, API-key state
```

## Configuration

| Env var | Purpose | Default |
|---|---|---|
| `CLAUDE_PROFILE_WORK_DIR` | Work `CLAUDE_CONFIG_DIR` | `~/.claude` |
| `CLAUDE_PROFILE_PERSONAL_DIR` | Personal `CLAUDE_CONFIG_DIR` | `~/.claude-personal` |
| `CLAUDE_CONFIG_DIR` | Active dir (set by the switcher per session) | unset = work default |

`~/.pi/agent/claude-profiles.json` stores `{"workDir": ..., "personalDir": ...}`
as a fallback when the env vars are unset, plus `"activeProfile"`, the last
profile you picked. Each session starts on that profile if it is still logged
in, and falls back to Work otherwise. A `CLAUDE_CONFIG_DIR` preset before
launching Pi wins over the saved pick.

## Models and thinking effort

Models come from the Anthropic catalog via the bridge (dated snapshot ids
excluded). Effort is controlled per model or session through Pi's thinking
level; higher effort plus long transcripts drains plan quota faster, so reserve
top effort for single hard turns. (With the retired per-turn bridge, every turn
additionally re-sent the full transcript — that penalty no longer applies.)

## The bridge: `claude-bridge`

Single provider. It holds one Claude Code session per Pi session and resumes it
(`--resume`), so steady turns send only new messages and hit prompt cache.
Expect a full resend (cache miss) after abort, `/compact`, branch navigation,
provider switch, or a pause past the ~5-minute server cache TTL — then caching
resumes. `CLAUDE_BRIDGE_DEBUG=1` logs `syncResult: path=reuse|rebuild` per turn
in `~/.pi/agent/claude-bridge.log` if you want to verify.

(Retired: `npm:claude-code-pi` spawned a fresh `claude -p` per turn with no
session, so every turn paid full input. Removed in favor of the bridge.)

Session dollars appear in the main `$` total, just like Codex. Positive
provider-reported costs take precedence. When the bridge reports zero prices,
known Claude model IDs use Pi's installed Anthropic catalog and pricing tiers.
Unknown model IDs contribute tokens but no estimated dollars.
These dollars represent API-equivalent usage, not an additional subscription
charge. There is no separate plan suffix.

If your plan is Max (or needs 1M context gating), copy the sample config to
`~/.pi/agent/claude-bridge.json` and set `provider.plan` (see the bridge
README); default is `pro`.

## Troubleshooting

- **Both rows show identical usage** — the personal folder got the work token
  (wrong browser account at login). Delete `~/.claude-personal` and redo the
  login with the personal email.
- **Personal row missing / `use personal` refused** — no login in that folder
  yet; run the setup entry, then `claude login`.
- **Unexpected API billing instead of plan quota** — a work `ANTHROPIC_API_KEY`
  is shadowing OAuth. Unset it for personal shells; in Pi, re-run
  `/claude-profile use personal`.
- **Work calls rate-limited** — check the `Claude-W` row; a maxed spend limit
  (e.g. `$500/$500 critical`) only resets on Anthropic's side. Use personal
  meanwhile.
