# Research: in-terminal source tree map extensions for Pi

Question: does anyone ship a Pi extension that shows a source/file tree you can select (and act on) without leaving the Pi TUI?

Answer: **yes.** Pi core does not ship a project-tree overlay, but several third-party extensions do. Closest matches stay inside the terminal via `ctx.ui.custom()` overlays.

## Official Pi (primary)

- Extensions are first-class: custom commands, `ctx.ui` prompts, and **custom TUI components** via `ctx.ui.custom()`. Source: installed docs `docs/extensions.md` in `@earendil-works/pi-coding-agent` (npm 0.85.0 at research time).
- Recommended picker primitive is `SelectList` from `@earendil-works/pi-tui`, not a file-tree widget. Source: `docs/tui.md` Pattern 1.
- Built-in file access is LLM tools (`ls` / `find` / `grep` / `read`), not an interactive explorer.
- `/tree` in Pi is **session/conversation branching**, not a filesystem tree.

This repo (`F:/MyWork/my-pi`) has no local source-tree extension. `extensions/tool-panel.ts` is a side overlay for tool activity, not files.

## Closest in-TUI extensions (verified on npm + GitHub)

### 1. `@guneriu/pi-files` — best match for “source tree map”

- npm: `@guneriu/pi-files@0.3.1`
- Source: https://github.com/guneriu/pi-extension-mono/tree/main/packages/pi-files
- Install: `pi install npm:@guneriu/pi-files`
- Official description: “Shows agent-edited files in a compact widget above the input bar, plus an on-demand interactive project tree (gitignore-aware)”
- Stays in Pi: **yes** (`/pi-files` full-screen overlay)
- Actions (from package README):
  - `↑/↓` select, `→/←` expand/collapse
  - type-to-filter all project files
  - `Space` in-TUI peek (syntax highlight, scroll)
  - `d` in peek: diff vs session baseline
  - `Enter` opens in OS default app (this one *does* leave the TUI)

### 2. `@narumitw/pi-file-context` — browse + select ranges as prompt context

- npm: `@narumitw/pi-file-context@0.54.2`
- Source: https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-file-context
- Install: `pi install npm:@narumitw/pi-file-context`
- Commands: `/file-context`, `/file-context browse`, default shortcut `Ctrl+Shift+X`
- Stays in Pi: **yes** (folder browser, fuzzy name/content search, line-range / hunk selection, queue review)
- Extra: can pause TUI to open Pi’s configured **external editor**, then return

### 3. `@signalridge/pi-files-widget` — in-terminal browser/viewer

- npm: `@signalridge/pi-files-widget@1.2.3`
- Source: https://github.com/signalridge/pi-extensions/tree/main/packages/pi-files-widget
- Install: `pi install npm:@signalridge/pi-files-widget`
- npm description: “In-terminal file browser and viewer for Pi.”
- README: navigate files, view diffs, select code, send comments to the agent without leaving the terminal; command `/readfiles`
- Requires extra CLI tools (`bat`, `git-delta`, `glow`) for `/readfiles`
- Related earlier/sibling package: `@tmustier/pi-files-widget@0.2.0` (same description; older)

### 4. `pi-diffffff` — two-pane tree + content, diff-oriented

- npm: `pi-diffffff@0.1.0`
- Source: https://github.com/j-joker/pi-diffffff
- Install: `pi install npm:pi-diffffff`
- Description: “Full-screen branch diff browser for Pi — file tree, syntax highlighting, and viewed tracking.”
- `/diff project` “browse all tracked and non-ignored project files”
- Stays in Pi: **yes** (keyboard two-pane overlay)

### 5. `@ramarivera/pi-television` — faster `@` picker, not a tree

- npm: `@ramarivera/pi-television@0.0.6`
- Source: https://github.com/ramarivera/pi-television
- Keeps Pi’s native `@file` picker UX; background search / optional select dialog
- In-terminal, but **not** a hierarchical source tree

## Nearby but not the same

| Package / repo | Why it is not a source-tree overlay |
|---|---|
| `pi-hashline-readmap` (https://github.com/coctostan/pi-hashline-readmap) | Agent-side hash-anchored read/edit + structural maps; replaces tools, not a user tree UI |
| `@aefree/pi-file-discovery` | Bounded candidate-file discovery tool, not interactive tree |
| `@elianiva/pi-ckers` | Namespace pickers (`@file:`, `@git:`, `@jj:`), not a tree map |
| `pi-files-touched` | Session file-activity tracker + picker of *touched* files |
| wangmiaozero/pi-harness | Desktop harness (leaves the Pi terminal) |
| je-boska/pi-vscode-file-context | VS Code tab/selection context (outside Pi TUI) |

## Recommendation

If the goal is “see the repo tree, pick a file, peek/select, stay in Pi”:

1. Try `@guneriu/pi-files` first (`/pi-files`).
2. If the goal is “attach exact lines/hunks to the next prompt”, use `@narumitw/pi-file-context`.
3. If the goal is “tree + diffs of the whole project”, use `pi-diffffff` (`/diff project`).

Pi’s own extension API is enough to build another tree if none of these fit (`docs/extensions.md` Custom UI + `docs/tui.md` SelectList/overlay patterns).

## Sources checked

- `@earendil-works/pi-coding-agent` docs: `docs/extensions.md`, `docs/tui.md`
- npm registry metadata for the packages named above (2026-09-05)
- GitHub READMEs: guneriu/pi-extension-mono `packages/pi-files/README.md`; narumiruna/pi-extensions `packages/pi-file-context/README.md`; j-joker/pi-diffffff `README.md`; ramarivera/pi-television `README.md`; signalridge package readme via npm
- Local tree: `F:/MyWork/my-pi/extensions/`
