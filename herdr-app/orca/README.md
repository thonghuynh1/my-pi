# Orca layout bundle

VladTemp27's [herdr-orca](https://github.com/VladTemp27/herdr-orca) layout plus
munza's `better-changes` (in the layout's Changes slot) and `better-config`,
packaged as one scoped bundle. Switching away from the layout makes all of it
inert; removing it is one script.

## Install on another computer

```sh
node herdr-app/orca/install.mjs --activate            # layout + 24 mods + keys
```

The installer backs up anything it replaces under
`~/.config/herdr-app/backups/orca-*` and restores it if a mod fails its check.
Only the `layout:orca` key section is merged — a binding you already have wins
and is reported. Everything else is copied to `layouts/orca.json`, `mods/`, and
`bundles/orca/` in the Herdr home.

## Local fits (already applied in `mods/`)

- `better-changes`: `place` set to `none`; the layout provides the slot.
- `better-config`: lists mod folders with PowerShell on Windows instead of
  `/bin/sh`.
- Automations is removed: the panel mod, its sidebar link, the Go scheduler
  source and binary, and the build and scheduler scripts are all gone. The
  bundle is JSON and JavaScript only. `remove.ps1` still cleans up the
  legacy `HerdrOrcaAutomations` task and config from older installs.
- `files-open-with`: the right-click menu opens on every platform (upstream
  is macOS-only) with built-in Insert path into terminal, Copy path, and
  Move to Recycle Bin (with an in-menu confirm; never a permanent delete).
  Its file viewer is also editable locally (upstream is read-only): Ctrl+S
  saves with a compare-and-swap guard, drafts survive a reload, and remote,
  binary or truncated files stay read-only.
- `better-sidebar`: projects are permanent — once a repo has been opened it
  stays in the sidebar after its last space closes (dimmed, marked closed);
  clicking reopens a space at the repo root, and only the row's × removes it.
- Excalidraw is removed, and the old right-panel **PRs** child and its top-bar
  button are gone too: the PR dashboard now lives in the **Issues** popup as
  its Dashboard tab (your PRs and review requests across repos, with the
  unseen-feedback bell, Dismiss/Remove/Restore and the same
  `github-prs.attention.<viewer>` state, so nothing was reset). The Issues
  PRs tab still covers one repo in detail. The workbench `github-prs` mod
  still serves the github-workspace layout.
- `better-sidebar`: worktrees show nested under their project (enumerated
  from git, even with no space open) and carry a delete: live ones open
  Orca's remove dialog, closed ones confirm inline and run
  `git worktree remove --force --force` (branch kept). A project's root row
  always shows a fold chevron: clicking it collapses the project, hiding its
  worktree rows and agents until clicked again (kept in `repos.folded`;
  navigating to a hidden space unfolds its project).
- `better-sidebar`: the first space on a repo's main checkout is the project
  root; sibling spaces on the same checkout nest under it with its worktrees.
  Nested spaces are grouped by the checkout they live in (its git top
  folder): a linked worktree's first space keeps the worktree row as before,
  and any further spaces in that same worktree sit inside it as spaces —
  own name, color tile, agent fold — instead of looking like more worktrees.
  Spaces on the main checkout stay under the root as before.
- `desktop-notifications`: `place` set to `none`, so it lives only in Orca's
  explicit slot and cannot inject itself into other layouts. (Notifications
  have no Windows sender upstream and stay silent there.)

## Remove

```powershell
powershell ~/.config/herdr-app/bundles/orca/remove.ps1
```

Switches away first if Orca is showing, then deletes the layout, the 24 mods,
their data folders, the `layout:orca` keys, any legacy Automations task and
config left by an older install, and the bundle folder itself. Your other
layouts and spaces are untouched.
