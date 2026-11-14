# Session bridge: resume agent conversations after a reboot

herdr-core restores a lost terminal as a plain shell and never re-runs the
original command (by design in core 0.1.21). The old herdr TUI resumed agent
conversations because each agent integration reported its session id per
pane. This bridge re-creates that data path for herdr-app.

**Everything is one file: `session-bridge.ps1`.** It dispatches on how it
was invoked:

| Invocation | Mode |
|---|---|
| Dot-sourced from `$PROFILE` | Wraps `codex`, `copilot`, and `cursor-agent` so the env bridge (`HERDR_*`) exists only inside those agent processes; the shell keeps a clean herdr-core environment |
| `session-bridge.ps1 pane report-agent-session …` (as `HERDR_BIN_PATH`) | Translates Herdr's Codex/Copilot/Cursor hook calls into `hc label` |
| `session-bridge.ps1 claude-hook` | Claude Code SessionStart recorder (stdin JSON; ignores `sdk-*` entrypoints so model-backend subprocesses cannot hijack the slot) |
| `session-bridge.ps1 record <app> <session> <kind>` | Generic label writer used by the generated Pi/OpenCode stubs |
| `session-bridge.ps1 -Install` | Generates the stubs, wires the Claude hook and the profile line |
| `session-bridge.ps1 cleanup [-DryRun] [-LiveDays n]` | Prunes dead or stale resume labels and caps the Claude debug log |

While an agent runs, its session identity lands on the terminal as labels:

```
hc label <terminal> resume.app=<agent> resume.session=<id-or-path> resume.kind=id|path resume.at=<epoch-ms>
```

Terminal addresses and labels survive a reboot, so after restart every
recovered shell pane still knows which conversation it held. The
`project-spaces` mod reads those labels and shows a one-click
**Resume <Agent>** button on the space's card, plus a **Resume N** button in
the sidebar header. Clicking types the agent's resume command into the pane.
Nothing auto-runs.

## Agent coverage

| Agent | Recorder | Resume line (in `mods/project-spaces/data.js`) |
|---|---|---|
| Pi | Generated extension in `~/.pi/agent/extensions/` (calls `record`) | `pi --session "<path>"` |
| Claude Code | `claude-hook` mode via `~/.claude/settings.json` | `claude --resume <id>` |
| Codex, Copilot, Cursor | Herdr's own PowerShell hooks via the shim mode | `codex resume`, `copilot --resume=`, `cursor-agent --resume` |
| OpenCode | Generated plugin in `~/.config/opencode/plugins/` (calls `record`) | `opencode --session <id>` |
| Antigravity, Gemini | No recorder yet (no verified hook surface) | Registered in the mod's table |

Pi and OpenCode still need a file inside their own runtime directories,
because that is the only code those programs load. They are generated stubs
that only shell out to this script. Never edit them by hand; regenerate with
`-Install`.

## Install on a machine

Prerequisites are Herdr (including `herdr-app` and `hc` on PATH), Node.js 20+,
Git, and PowerShell 7 (`pwsh`) on Windows.

From the root of a `my-pi` checkout:

```powershell
# 1. Install and activate the Herdr workspace bundle. This backs up the
#    previous custom mods/layout, copies this folder into the Herdr home,
#    checks every mod, and switches to the layout.
node herdr-app/install.mjs --activate

# 2. Wire the per-agent recorders. This is idempotent and backs up the
#    Claude settings and PowerShell profile it rewrites.
pwsh -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.config\herdr-app\session-bridge\session-bridge.ps1" -Install
```

If step 1 used `--home <path>`, run the script from that Herdr home instead
of `~/.config/herdr-app`. Omit `--activate` in step 1 if you do not want the
running window switched to the layout immediately.

`-Install` writes the Pi and OpenCode stubs, points Claude's SessionStart
hook in `~/.claude/settings.json` at the script, and reduces the PowerShell
profile to a single dot-source line. Recorders activate at each agent's next
launch. Running Pi sessions need a restart or `/reload` to pick up the stub.

### Verify the installation

1. Start a supported agent in a Herdr pane.
2. Run `hc get <terminal-address>` and confirm its labels include
   `resume.app`, `resume.session`, `resume.kind`, and `resume.at`.
3. Exit the agent so the pane returns to a shell, or reboot and reopen Herdr.
4. Confirm the sidebar offers **Resume <Agent>** for that space.
5. Optionally run `session-bridge.ps1 cleanup -DryRun` to confirm cleanup
   can read the terminal records without changing them.

Accepted Claude starts append one line to `claude-hook-log.jsonl` beside the
script, for tracing a wrong label to the payload that wrote it. Cleanup caps
that log once it passes 64 KiB.

## Cleanup and retention

A terminal carries at most one resume record, and recording a new session
overwrites it. Cleanup handles records whose anchor went away:

- labels on finished terminals are removed (closed pane or space);
- a path record is removed when its session file is gone and no agent state
  is still being reported for that terminal;
- if one session somehow has labels on multiple live terminals, only the
  newest record is kept;
- the Claude debug log is trimmed to its newest 200 lines once it exceeds
  64 KiB.

Cleanup never deletes a terminal record or an agent's own session file. It
removes only this bridge's four labels.

When a herdr-core shell starts, the profile bridge launches at most one
hidden cleanup per hour, tracked by `cleanup-state.json` beside the script.
Run it manually any time:

```powershell
pwsh -File ~\.config\herdr-app\session-bridge\session-bridge.ps1 cleanup -DryRun
pwsh -File ~\.config\herdr-app\session-bridge\session-bridge.ps1 cleanup
```

Live shell records normally stay until resumed or their pane closes. Add
`-LiveDays 30` to also expire inactive live records after 30 days; that
expiry is deliberately opt-in so a session is not forgotten merely because
the computer was off for a long time.

## Limits

- One-click only, by design. Auto-resume on app start would also resurrect
  agents in panes where you deliberately exited to a shell.
- The newest agent to run in a pane owns its resume slot (last report wins),
  matching the old herdr TUI.
- If you resume the same session by hand in a different pane, both panes
  keep labels for it. Resuming twice opens the conversation twice; the
  bridge does not track that yet.
