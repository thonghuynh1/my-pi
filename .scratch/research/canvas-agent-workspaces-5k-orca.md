# High-star AI coding workspaces similar to Cate and Orca

**Question:** Find projects with more than 5,000 GitHub stars that resemble Cate or [Orca](https://www.onorca.dev/), especially desktop/workspace tools for managing multiple AI coding agents and terminals on Windows.

**Research date:** 2026-08-10
**Sources:** Official project GitHub repositories, READMEs, package/build configuration, GitHub releases, and Orca's official documentation/site. Star counts are a snapshot and will change.

## Key conclusion

There is no obvious >5k-star project that combines all three of these at once:

1. Cate-style infinite/spatial canvas;
2. Orca-style fleet orchestration, isolated worktrees, and agent follow-up;
3. a well-established Windows desktop release.

The >5k-star ecosystem is instead split between **agent fleet/worktree workspaces** and **canvas-oriented newer projects**. For the user's Windows requirement, the strongest shortlist is:

1. **Orca** — exact product reference and itself >40k stars; Windows desktop; parallel agents/worktrees.
2. **Agent Orchestrator** — closest open-source Orca alternative for Windows; >9k stars; isolated workspaces, terminals, PR/review state, CI and merge-conflict loops.
3. **Claude Code Haha (cc-haha)** — >14k stars; Windows/macOS/Linux desktop workspace; multi-session, worktrees, diffs, browser preview, model/provider integrations.
4. **Kun** — >6k stars; local-first AI agent workspace with desktop GUI and TUI; Windows installer; broader than coding but very relevant.
5. **Paseo** — >12k stars; desktop/mobile/web/CLI orchestration for multiple coding agents; Windows executable is published, though it is more list/session oriented than a canvas.

For a visual canvas specifically, **OpenCove**, **Seizen**, **STIRUAL**, and **Void** remain better conceptual matches than most >5k-star repositories, but they do not meet the >5k threshold in the research snapshot.

## Ranked comparison

| Project | Stars snapshot | Similarity to Orca | Canvas/spatial UI | Windows evidence | Important caveat |
|---|---:|---|---|---|---|
| [Orca](https://github.com/stablyai/orca) | ~40.7k | Baseline: fleet of parallel agents, subscriptions, worktrees, desktop/mobile/VPS | Not primarily an infinite canvas; desktop workspace/control surface | Official README lists macOS, Windows, Linux; package scripts include `build:win`; latest release has Windows build assets | Best benchmark, not an alternative |
| [Claude Code Haha](https://github.com/NanmiCoder/cc-haha) | ~14.0k | Very close: multi-agent sessions, Git worktrees, diffs, approvals, browser preview, notifications | Workspace UI, not an infinite canvas | README explicitly says Windows/macOS/Linux; latest release includes Windows `.exe` assets | Strong Claude-centered desktop product; verify support for non-Claude agents in practice |
| [Paseo](https://github.com/getpaseo/paseo) | ~12.9k | Strong orchestration: multiple agents controlled from desktop, mobile, web, CLI; local daemon | App/session workspace rather than spatial canvas | README documents Electron desktop and Windows dev/build path; latest release includes `Paseo-Setup-0.3.1-arm64.exe` | Windows release architecture/CPU coverage should be checked before broad deployment |
| [Superset](https://github.com/superset-sh/superset) | ~12.8k | Strong: many CLI agents, isolated worktrees, terminals, review/merge workflow | Editor/workspace layout, not canvas | Electron desktop; inspected latest release assets were macOS/Linux, and README promotes macOS download | Excellent product design reference, but Windows availability is not established |
| [Agent Orchestrator](https://github.com/Untrivial-ai/agent-orchestrator) | ~9.1k | Closest open-source Orca analogue: fleets, isolated workspaces, live terminals, PR state, CI/review/merge loops | Project/session dashboard and inspector, not infinite canvas | Latest release includes `agent-orchestrator-win32-x64.exe` and `Agent.Orchestrator.Setup...exe` | 0.x product; check supported agent configuration and Windows PTY behavior |
| [Kun](https://github.com/KunAgent/Kun) | ~6.0k | AI workspace for coding, writing, design, research, automation; one desktop/TUI runtime | Workspace/GUI rather than spatial canvas | Latest release includes `Kun-0.2.37-win-x64.exe` | Broad local AI platform; not specifically a parallel coding-agent fleet |
| [OpenCove](https://github.com/DeadWaveWave/opencove) | ~1.6k | Agents, tasks, notes, knowledge and research in one workspace | **Yes: infinite canvas** | Windows x64 executable published | Best Cate-style open source candidate, but below 5k stars |
| [Seizen](https://github.com/FaridDevU/Seizen) | <5k | Agent workspace assistant, project-level panels, terminals/editors/browser | **Yes: movable panels on a project canvas** | README identifies Windows x64; Wails + Go + React | Pre-release/alpha |
| [STIRUAL](https://github.com/Laurits123456/stirual) | <5k | Multi-agent control-room concept with terminals, browser, notes | **Yes: draggable tiles/minimap** | README says Windows Electron app and has Windows packaging script | Very early project |
| [Void](https://github.com/190km/void) | <5k | Runs Claude Code/Codex/OpenCode in separate workspaces | **Yes: infinite 2D terminal canvas** | Windows setup executable published | Native terminal canvas, but limited orchestration compared with Orca |

## What Orca actually adds

Orca's official README and docs describe the distinguishing workflow as:

- run Codex, Claude Code, OpenCode, or Pi side-by-side;
- put each agent in its own isolated Git worktree;
- fan one prompt across multiple agents, compare results, and merge the winner;
- monitor and control work from desktop, mobile, or VPS;
- retain session/worktree state and support remote servers.

The official docs also expose concepts for parallel agents, remote worktrees, session restore, terminal control, supported agents, and CLI orchestration. This makes Orca a better comparison target for **agent operations** than for a literal canvas.

## Windows recommendation

### Best to install first

1. **Agent Orchestrator** — most direct Orca-like open-source Windows option.
2. **cc-haha** — strongest polished desktop workspace candidate with Windows binaries.
3. **Kun** — good if the desired product extends beyond coding into general AI workspaces.
4. **Paseo** — good for controlling agents across desktop/mobile/web, with daemon architecture.
5. **Cate/OpenCove/Void** — compare these for spatial terminal and canvas interaction.

### Best product architecture to study

A strong Windows product could combine:

- **Orca / Agent Orchestrator:** worktree isolation, session registry, fleet status, follow-up routing, PR/CI loops;
- **Cate / OpenCove / Void:** spatial canvas, movable terminals, pan/zoom, minimap, visual grouping;
- **cc-haha / Kun:** local-first desktop packaging, permissions, browser preview, model/provider settings;
- **Paseo:** daemon plus desktop/mobile/web clients.

## Primary sources

- Orca repository: https://github.com/stablyai/orca
- Orca official site: https://www.onorca.dev/
- Orca docs: https://www.onorca.dev/docs
- Claude Code Haha: https://github.com/NanmiCoder/cc-haha
- Kun: https://github.com/KunAgent/Kun
- Paseo: https://github.com/getpaseo/paseo
- Superset: https://github.com/superset-sh/superset
- Agent Orchestrator: https://github.com/Untrivial-ai/agent-orchestrator
- Cate: https://github.com/0-AI-UG/cate
- OpenCove: https://github.com/DeadWaveWave/opencove
- Seizen: https://github.com/FaridDevU/Seizen
- STIRUAL: https://github.com/Laurits123456/stirual
- Void: https://github.com/190km/void
