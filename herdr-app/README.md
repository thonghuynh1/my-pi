# GitHub Workspace for Herdr

One portable home for the custom Herdr layout and mods. This directory is the
source of truth; `~/.config/herdr-app` is the installed copy.

## Install on this or another computer

Install **Herdr**, **Node.js 20+**, **Git**, and **GitHub CLI** first, with
`herdr-app`, `node`, `git`, and `gh` on PATH. Use a compatible/current Herdr version;
these personal clones started from Herdr 0.1.12 and do not inherit shipped updates.

From your `my-pi` checkout:

```sh
gh auth login
node herdr-app/install.mjs --activate
```

Skip `gh auth login` if already authenticated. Team review discovery requires
permission to read your organization teams (usually `read:org`); missing access
shows a warning while direct review requests still work.

The same install command updates an existing installation. It:

1. Copies the five workspace mod folders and `github-workspace` layout.
   With `--with-keys`, also installs the shared `keys.json` and `legacy-prefix` helper.
2. Backs up the previous versions under `~/.config/herdr-app/backups/github-workspace-*`.
3. Runs `herdr-app check` on each installed mod; attempts to restore all previous files,
   including opted-in keybindings, if checks fail (reports the backup path and any locked-file restore failures).
4. Switches to the layout when `--activate` is supplied.

No `npm install` or Pi extension registration is needed for this bundle.
Without `--activate`, the layout is installed without switching your window.
`--home <path>` overrides the Herdr configuration directory for installation;
activation still targets the running Herdr app, so omit `--activate` for a staging directory.

**Never copied or replaced:** GitHub credentials, settings, terminal sessions,
machines, layout click state, or `shared.json`. Keyboard bindings are unchanged
unless you explicitly pass `--with-keys`. Your PR
dismissals and seen-feedback state survive an update. They remain local to each
computer/account; cloning this repository does not transfer them.

The installer intentionally replaces the named custom folders, after backup.
Keep your code edits here rather than editing the installed copies. Shipped Herdr
mods and layouts are untouched. To undo, restore the managed paths from the
printed backup (six for a normal install; eight with `--with-keys`), removing any
that did not exist before installation; switch to `main` to leave this layout.

### Share the same keybindings across computers

This bundle includes `keys.json`, copied from this computer's Herdr keybindings,
and `mods/legacy-prefix`, the personal **Ctrl+B** prefix menu those bindings use.
To apply the same bindings on another computer, first commit/push these files and
pull the updated `my-pi` checkout there, then run:

```sh
node herdr-app/install.mjs --with-keys --activate
```

**`--with-keys` replaces that computer's entire `keys.json`; it does not merge.**
This is intentional so shortcuts are identical. Its previous bindings and prefix
helper are backed up in the printed backup directory and restored if mod checks
fail. A normal install without `--with-keys` leaves both alone. To undo just the
bindings, restore `keys.json` from that backup; if no keys existed before, remove
the installed file. Herdr applies key-file changes live.

The preset includes **Ctrl+B** then a second key for the prefix menu, **Alt+1–9**
for spaces, **Ctrl+1–9** for tabs, **Alt+H/J/K/L** for pane focus, and terminal
copy/paste and word-editing shortcuts. These are this computer's Windows-oriented
bindings: Ctrl+B is taken from the terminal program, AltGr can conflict with
Ctrl+Alt, and Option combinations can affect character entry on macOS. Review
`keys.json` before applying it on a different OS or keyboard layout.

This is Git-based sharing, not automatic live sync. After changing bindings in
Herdr, copy its `~/.config/herdr-app/keys.json` back to `herdr-app/keys.json`, commit
and push, then pull and rerun the command on the other computer. Do not copy
settings or session files to share shortcuts.

## What's included

- **`mods/project-spaces`** — persistent project groups with every registered Git worktree, including closed checkouts.
- **`mods/workspace-files`** — file browser and simple local text editor, with safe saves, draft recovery, and right-click path insertion into the active terminal.
- **`mods/github-tabs`** — workspace tabs with Files, Changes, and PRs buttons.
- **`mods/github-prs`** — PR dashboard, My PRs, All PRs, detail view, and wrapping merge chain.
- **`mods/git-changes`** — Changes and Git History, Apple-inspired cards and file disclosures.
- **`layouts/github-workspace.json`** — connects those mods to Herdr's standard workspace.
- **`keys.json` + `mods/legacy-prefix`** — shared keyboard preset and Ctrl+B menu, installed only with `--with-keys`.

### Projects and worktrees

The expanded left sidebar discovers repositories from open spaces and remembers
projects locally, even after their spaces close. **+** adds a local repository via
the folder picker. Click a project header/arrow to expand or collapse its worktrees; the choice is
remembered locally, with new projects expanded by default. Expanded projects list all registered worktrees (including
locked/missing checkouts), branch, clean/dirty state, upstream ahead/behind, open
spaces and agent status in compact two-line cards. Compact project headers use a subtle, rounded, theme-aware background instead of
oversized containers or extra labels. Unmatched spaces appear separately under
**Other spaces**. Theme-aware project avatars,
branch icons, colored health dots, and Here/agent badges add visual hierarchy;
project colors stay stable when reordered. Full paths and upstream details
appear on hover. Click a checkout row to open/switch (no separate Go/Open button). Right-click
any checkout for **Remove worktree…**; open checkouts also offer rename/close
space actions. Removal is only in that menu, never inline. Multiple spaces on one checkout remain individually
selectable. Agents stay in the section below. **Machines** opens Herdr's original
space/machine controls. Git refreshes every 15 seconds while the window is active;
**↻** refreshes manually. Remote projects use their own machine. Failed refreshes
show an error and retain old data, with checkout actions disabled.

**Remove worktree…** opens a confirmation with an animated status check and a clear\npermanent-deletion warning. Confirming closes the modal and queues removal in the\nsidebar, which shows progress and success/error notifications. Queued/running\nworktree cards show **Deleting…** with a spinner and disable opening and right-click\nactions. Success removes the card; failure unlocks it for retry. The background worker\nrechecks the target before deleting; keep this layout open until it finishes.
It uses `git worktree remove --force --force -- <path>` to delete the checkout
(including uncommitted, untracked and ignored files) and its Git registration,
even when locked. Missing registrations can also be cleaned up. Main/bare,
unverifiable unlocked existing or Herdr-open checkouts remain blocked; close their
spaces/terminals first. It never closes terminals, deletes branches, or prunes
other worktrees. Detached HEAD commits may become unreachable. The dialog shows
commits not on local remote-tracking refs and upstream status, which may be stale
(no fetch/network). External editors/processes cannot be detected reliably. Project memory stays in this computer's per-mod storage and
is not copied to other machines.

### Edit files

In **Files**, click a local text file to edit it with syntax highlighting, line
numbers, and folding. Click **Save**, or press **Ctrl+S** (**Cmd+S** on macOS)
while the editor has focus. A dot marks unsaved changes. Saving updates the
working tree; it does not stage, commit, or push anything. Use **Changes** to
review the diff. The compact header shows **Save** only when there are unsaved
changes; routine hints and saved/backup messages stay out of the way. **← Files**
returns to the tree. The eight most recent native editor buffers retain cursor,
scroll and undo state while this mod stays open; older drafts retain their text.
Clean buffers are checked against disk before reuse so external edits are not hidden.

Unsaved drafts are backed up in Herdr's per-mod local storage and restored when
you reopen the file, including after switching folders or reloading the mod.
These backups contain the original and edited text in plaintext on this computer;
avoid editing secrets if that is unsuitable. Successful saves clear the backup
unless newer edits remain. For responsive typing, the first edit is backed up
immediately; subsequent edits are batched at most every 300 ms, and flushed on
blur, navigation, Save, or normal close. An abrupt crash/mod reload can lose that
last 300 ms. The hidden file tree and Git badges are rescanned when you return
with Back, not continuously while editing. Storage failures show a warning: save before closing.
Herdr's mod API cannot veto app/pane closure; recovery is best-effort, not a
replacement for saving.

Save checks the original disk content and refuses to overwrite external changes.
Your draft stays available to copy, even if the disk file disappears. **↻**
reloads from disk; with unsaved edits it shows a discard warning and requires a
second click to discard the draft. Remote files remain read-only because
Herdr's safe write API is local-only. Binary/unreadable files have no text preview;
files over 400,000 characters are truncated and read-only, never saved as partial
content. This is a single-file editor, not a full IDE or file-management suite.

### Insert file paths

In **Files**, right-click a file or folder → **Insert path into terminal**.
It pastes the absolute path into the terminal associated with the current Files
view, without Enter or submission. The preview header’s **⋯** opens the same menu.
**Copy path** is also available. Path insertion does not save or discard editor drafts.
The insertion uses the system clipboard (replacing its previous contents), checks
the target has not changed, focuses that terminal, and uses native text paste—not
`hc send`. Paths containing control characters are refused. Paths are inserted
verbatim, not shell-escaped; quote/escape as needed before running a shell command.
No file is uploaded or copied between machines. True file drag-and-drop is not
exposed by this Herdr version’s mod API.

### PR dashboard

Dashboard shows explicit review requests for you and up to 20 GitHub teams, without
repository or text filters. It searches the 25 most recently updated requests per
assignment; permission/search/coverage limits are shown, not silently hidden.
Refresh is manual. **Dismiss** hides only the current update; the PR returns
when it updates. **Remove** stops following a PR on this dashboard locally;
it stays hidden even after new updates. **Show hidden** exposes both dismissed
and removed PRs in the loaded results, with **Restore** to follow them again. This does not
unsubscribe on GitHub, remove a review request, or affect My PRs / All PRs.
Preferences are per GitHub account on this computer. Older temporary dismissals
keep their existing behavior until restored.

My PRs and All PRs retain repository/text filters. Across all three views, orange
bells show locally unseen feedback. Comment notifications show people and a count
(for example, **@Alice, @Bob · 4 new comments**), never comment text previews.
Approvals and change requests remain concise. Counts combine observed unseen
issue and inline comments, deduplicated across refreshes; a **+** indicates
incomplete activity or a capped count. Actor labels show up to three people,
then an others count. Opening a detail successfully acknowledges the captured
feedback, not newer arrivals; hovering or opening GitHub does not mark it read.
Summaries load the last five issue comments and reviews, plus each review's last
five inline comments. Up to 200 observed unseen events are remembered through
later replies. This is not a complete GitHub notification history/read-state sync.

Each PR card also shows GitHub's aggregate CI status for its latest head commit:
green passed, red failed, orange pending/building, or gray no checks/unavailable.
CI and feedback update on manual Refresh. Clicking a card opens in-app details;
clicking its right-hand external-link icon opens that PR directly on GitHub.
PR API operations are read-only. Comment, approve, and merge on GitHub. Credentials
remain managed by `gh`; nothing in this bundle contains account tokens.

### Changes and history

Changes shows the selected terminal's working tree. **Commit stages all changes
(`git add -A`) and creates a local commit**; it does not push. Git History starts
with 25 commits, with **Load 25 more**. Select a commit for a file list; each file
starts collapsed, and opening one loads only that file's patch. Merge commits
compare against their first parent. Previews cap at 1,500 lines; history previews show a notice when truncated.

## Develop and share

Edit this directory, then reinstall to apply changes:

```sh
node herdr-app/install.mjs
```

Commit `herdr-app/` to `my-pi`. On another computer, pull the repository and run the
same installer. Do not commit the runtime `~/.config/herdr-app` directory.

Tests (Node built-in runner; no external dependencies):

```sh
node --test herdr-app/tests/*.test.mjs herdr-app/mods/github-prs/tests/*.test.mjs
```
