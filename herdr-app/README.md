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

1. Copies only the three custom mod folders and `github-workspace` layout.
2. Backs up the previous versions under `~/.config/herdr-app/backups/github-workspace-*`.
3. Runs `herdr-app check` on all three mods; attempts to restore all previous files if checks fail (reports the backup path and any locked-file restore failures).
4. Switches to the layout when `--activate` is supplied.

No `npm install` or Pi extension registration is needed for this bundle.
Without `--activate`, the layout is installed without switching your window.
`--home <path>` overrides the Herdr configuration directory for installation;
activation still targets the running Herdr app, so omit `--activate` for a staging directory.

**Never copied or replaced:** GitHub credentials, settings, keyboard bindings,
terminal sessions, machines, layout click state, or `shared.json`. Your PR
dismissals and seen-feedback state survive an update. They remain local to each
computer/account; cloning this repository does not transfer them.

The installer intentionally replaces the named custom folders, after backup.
Keep your code edits here rather than editing the installed copies. Shipped Herdr
mods and layouts are untouched. To undo, restore the four managed paths from the
printed backup; switch to `main` to leave this layout.

## What's included

- **`mods/github-tabs`** — workspace tabs with Files, Changes, and PRs buttons.
- **`mods/github-prs`** — PR dashboard, My PRs, All PRs, detail view, and wrapping merge chain.
- **`mods/git-changes`** — Changes and Git History, Apple-inspired cards and file disclosures.
- **`layouts/github-workspace.json`** — connects those mods to Herdr's standard workspace.

### PR dashboard

Dashboard shows explicit review requests for you and up to 20 GitHub teams, without
repository or text filters. It searches the 25 most recently updated requests per
assignment; permission/search/coverage limits are shown, not silently hidden.
Refresh is manual. ✓ dismisses a PR locally until its `updatedAt` changes; **Show
dismissed** lets you restore it.

My PRs and All PRs retain repository/text filters. Your authored PRs show bell
badges for locally unseen recent comments, approvals, and review feedback. Opening
a detail successfully acknowledges the captured feedback, not newer arrivals.
Summaries are bounded to the last five issue comments and reviews, plus each
review's latest inline comment. Observed unseen events are remembered through
later replies; this is not a complete GitHub notification history/read-state sync.

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
