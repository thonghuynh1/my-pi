# Accounts modal (`/account`)

One modal for every subscription account: Codex accounts (assignable to the main
session or to subagents independently) and Claude accounts for the main session. No commands to
remember. Type `/account` and use the keys shown at the bottom of the modal.

```
╭──────────────────────────────── Accounts ────────────────────────────────╮
│ ROLES                                                                     │
│   Main session  openai-codex/gpt-6.1-sol                                  │
│   Subagents     codex-2/gpt-6.1-sol:high                                  │
│                                                                           │
│ CODEX ACCOUNTS                                                            │
│ ▸ Work          openai-codex   team     5h 12% · week 40%   [main]        │
│   Personal      codex-2        plus     5h 3% · week 9%     [subagents]   │
│   + Add Codex account                                                     │
│                                                                           │
│ CLAUDE ACCOUNTS                                                           │
│   Claude 1      claude-bridge     ~/.claude            [main]             │
│   Claude 2      claude-bridge-2   ~/.claude-personal   not logged in      │
│   + Add Claude account                                                    │
│                                                                           │
│ Enter/m main · s subagents · a add · l login · r rename · x remove · u usage │
╰───────────────────────────────────────────────────────────────────────────╯
```

| Key | On a Codex account |
|---|---|
| `Enter` / `m` | Main session uses this account now; new sessions too (`settings.json` default). |
| `s` | Subagents use this account (`~/.pi/agent/agents/models.json` → `subagents.default`). |
| `a` | Add an account: creates the next slot (`codex-2`, `codex-3`, …) and pre-fills `/login codex-N`. Press Enter and sign in. |
| `l` | Log in to (or re-log) this slot. |
| `r` | Rename the label shown in the modal and `/model`. |
| `x` | Remove a slot and its login (not the built-in one; use `/logout` for that). |
| `u` | Refresh 5h/week usage for every account. |

Claude accounts are providers too, like Codex: `claude-bridge` (Claude 1),
`claude-bridge-2`, `claude-bridge-3`, … so `/model` lists
`claude-bridge-2/claude-sonnet-…` and so on. On a Claude row: `Enter`/`m` makes
it the main session (keeps the current Claude model, saved for new sessions),
`a` adds an account, `l` shows its login command, `x` removes it (not Claude 1). See
[claude-code-profiles.md](claude-code-profiles.md).

## How it works

Pi's built-in `openai-codex` provider has a single login. Each extra account
is a **clone provider** (`codex-2`, `codex-3`, …) that reuses the built-in login flow,
token refresh, transport, and live model catalog, but stores its credential in
its own `auth.json` slot. So:

- Main and subagents really run on different accounts at the same time:
  `openai-codex/gpt-6.1-sol` for main, `codex-2/gpt-6.1-sol` for subagents.
- Pi handles login and locked token refresh per slot, just as it does for the
  built-in provider. Nothing copies or swaps tokens.
- Moving a role to another account keeps its model and thinking level when they
  are already Codex; otherwise it borrows the other role's Codex model.
- Clone models appear in `/model` and `/subagents-model` as `codex-N/<model>`,
  so you can also pick them there. Per-agent overrides in `/subagents-model`
  still win over the subagent default.

Slots and labels live in `~/.pi/agent/codex-slots.json`.

## Rules and troubleshooting

- **Use each ChatGPT account in only one slot.** Two slots with the same login
  would each refresh it, and OpenAI rejects reused refresh tokens, logging both
  out. The modal shows a red warning when it detects this; remove one slot.
- **Second login picked the wrong account**: the browser reused the signed-in
  ChatGPT session. Sign out there or use a private window, then press `l` on
  the slot.
- **"has no usable login"** when assigning: the slot's login is missing or expired.
  Press `l` on it.
- The footer now shows one usage row per configured Codex account: `Codex 1`, `Codex 2`, `Codex 3`, etc. in slot order.
  The `/provider-usage` modal and details view use the same separate rows.
  Add a slot in `/account`, then restart Pi once so the footer discovers it.
- Each `claude-bridge-N` call runs the shared bridge with that account's
  `CLAUDE_CONFIG_DIR`, so sessions on different Claude accounts can run side by
  side (a subagent `model:` may name `claude-bridge-N/<model>` too).
- The Codex CLI (`~/.codex/auth.json`) is separate and untouched.
