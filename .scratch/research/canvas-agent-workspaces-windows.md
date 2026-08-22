# Windows canvas workspaces for AI coding agents

**Question:** Find workspace agents similar to [Cate](https://github.com/0-AI-UG/cate): a desktop canvas/spatial UI for managing terminals and AI coding work, with Windows as the primary constraint.

**Research date:** 2026-08-10
**Method:** Primary sources only: project-owned GitHub repositories/releases and October's official website. GitHub search was used for discovery; claims below link to the repository README, metadata, package/build configuration, or release assets that owns the claim.

## Short answer

The best open-source Windows matches are:

1. **OpenCove** — closest overall match to Cate plus agent/task/knowledge organization. It explicitly describes an infinite canvas for Claude Code, Codex, terminals, tasks, and notes, and publishes a Windows x64 executable.
2. **Seizen** — strongest Windows-first product direction. It describes one project canvas containing Claude Code, Codex, OpenCode, editors, browser, and other movable panels, with an assistant that can build the workspace. It is Wails + Go + React and labels itself Windows x64, but is still pre-release.
3. **STIRUAL** — very close conceptually: canvas tiles for terminals, browsers, notes, attention queue, and a Windows Electron app. It is early-stage (few stars and no GitHub releases found), so it is better as a prototype/reference than a dependable install.
4. **Void** — best native-performance option when the core need is many terminals on a spatial canvas. It is Rust/wgpu, Windows-capable, and explicitly avoids Electron/WebView, but it is primarily a terminal emulator rather than a full multi-agent workspace.

**Cate itself already satisfies the Windows requirement:** its official README lists a Windows NSIS installer and x64 ZIP, and the latest GitHub release exposes `Cate.Setup.1.6.0.exe` plus `Cate-1.6.0-win.zip`.

## Comparison

| Project | Canvas + terminal fit | AI-agent/workspace fit | Windows evidence | Maturity / caveat | License |
|---|---|---|---|---|---|
| [OpenCove](https://github.com/DeadWaveWave/opencove) | Infinite canvas; terminals and spatial workspaces | Claude Code, Codex, tasks, knowledge, research, notes | README says macOS/Windows/Linux; latest release has `OpenCove-0.2.0-win-x64.exe` | Strongest direct alternative; release is still 0.x/nightly-oriented | MIT |
| [Seizen](https://github.com/FaridDevU/Seizen) | Movable panels on one canvas per project | Claude Code, Codex, OpenCode, VS Code, Zed, browser; assistant operates workspace | README badge says Windows x64; Wails desktop app | Pre-release alpha; no `latest` release API result, so validate installer flow | Repository metadata has no SPDX license assertion |
| [STIRUAL](https://github.com/Laurits123456/stirual) | Draggable terminal/browser/text tiles, minimap, attention queue | Coordinates multiple Claude Code/Codex sessions and remote VPS work | README explicitly says Windows desktop app built with Electron; includes `dist:win` | Very early project; no releases found and only 2 GitHub stars at research time | MIT |
| [Cate](https://github.com/0-AI-UG/cate) | Infinite zoomable canvas with editor, terminal, browser panels | Baseline/reference implementation for the requested interaction model | Official README lists Windows NSIS + x64 ZIP; release has Windows installer | Most established direct baseline in this list | MIT |
| [Void](https://github.com/190km/void) | Infinite 2D terminal canvas; pan/zoom; no tabs/splits | Can run Claude Code, Codex, and OpenCode in separate workspaces | README says Windows/Linux/macOS; release has `void-1.3.0-x86_64-setup.exe` | Excellent native terminal UX; less orchestration/notes/agent graph | MIT |
| [OpenLoaf](https://github.com/OpenLoaf/OpenLoaf) | Desktop project/workspace shell; broader than a terminal canvas | Local AI teams, project windows, linked projects, Secretary Agent | README badge says macOS/Windows/Linux; package lists Windows support | Broad personal AI workspace, not the closest Cate replacement | AGPL-3.0 |
| [KanVibe](https://github.com/rookedsysc/kanvibe) | Task detail workspace with embedded terminal; Kanban rather than infinite canvas | Claude Code, Gemini CLI, Codex CLI, OpenCode hooks and worktrees | Electron architecture is documented, but latest release assets inspected were macOS-only; Windows status is not established | Good workflow/task-management reference; do not assume Windows binary | AGPL-3.0 |
| [CodeGrid](https://github.com/ZipLyne-Agency/CodeGrid) | 2D canvas with many agent sessions | AI coding-agent session workspace | Official README labels it macOS-only; not a Windows candidate | Useful interaction reference only | MIT |
| [Pudding](https://github.com/teatak/pudding) | Shared canvas plus browser/terminal tools | Local-first multi-session AI workspace, MCP, skills, voice | Official README says macOS Apple Silicon/Intel preview only | Not a Windows candidate today | No SPDX license listed in repository metadata |

## October reference

[October's official site](https://www.october.dev/) describes the product as an operating layer for coding agents: agents run on laptops, desktops, and servers; agents can discover, message, delegate, and receive mid-turn nudges; visual workflows are made from living agents; and the desktop supports a multiplayer spatial workspace plus an IDE mode with files, terminals, diffs, and previews. Its embedded Schema.org metadata lists **macOS Apple silicon and Windows x64** as operating systems and describes a native desktop app.

October is therefore the closest product reference for the *agent orchestration + spatial canvas + Windows desktop* direction, while OpenCove/Seizen are the closest open-source repositories to inspect.

## Recommendation

- **If the immediate goal is to install and evaluate on Windows:** start with **OpenCove**, then compare against **Cate** and **Void**.
- **If the goal is to build a Windows-first product:** study **Seizen** for workspace composition/assistant control, **Cate** for spatial editor/terminal/browser interaction, and **Void** for native terminal performance.
- **If the desired product includes agent-to-agent delegation, persistent processes, and a visual workflow graph:** use **October** as the product benchmark; OpenCove and Seizen are the closest open implementations, but their feature/maturity claims should be tested locally.
- **If Windows terminal fidelity is the main risk:** prioritize a native/PTY proof of concept early. Electron projects are easier to iterate but need deliberate Windows PTY, process lifecycle, focus, shortcut, and packaging QA.

## Primary sources

- Cate repository: https://github.com/0-AI-UG/cate
- Cate releases: https://github.com/0-AI-UG/cate/releases
- OpenCove repository: https://github.com/DeadWaveWave/opencove
- OpenCove releases: https://github.com/DeadWaveWave/opencove/releases
- Seizen repository: https://github.com/FaridDevU/Seizen
- STIRUAL repository: https://github.com/Laurits123456/stirual
- Void repository: https://github.com/190km/void
- Void releases: https://github.com/190km/void/releases
- OpenLoaf repository: https://github.com/OpenLoaf/OpenLoaf
- KanVibe repository: https://github.com/rookedsysc/kanvibe
- CodeGrid repository: https://github.com/ZipLyne-Agency/CodeGrid
- Pudding repository: https://github.com/teatak/pudding
- October official site: https://www.october.dev/
