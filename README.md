# my-pi

Personal Pi package that bundles:

- Pi built-in MCP configuration (no `pi-mcp-adapter`; uses `builtin:mcp`)
- `@narumitw/pi-file-context` (`/file-context` in-TUI file browser; Tab inserts `@path`)
- `usage-footer.ts` footer/status extension showing model and context usage
- `subagents.ts` in-process subagent tool with `explore`, `shell`, and `custom` modes

## Install locally

```bash
cd F:/MyWork/my-pi
npm install
pi install F:/MyWork/my-pi
```

Restart Pi or run `/reload`.

The `postinstall` script handles Accordion build automatically.

## Accordion

This repo owns First-Party Accordion under `extensions/accordion/` and registers its stable Pi entry automatically.

Setup is automatic via `postinstall`. Manual steps only if needed:

```bash
npm run accordion:install
npm run accordion:build
```

Then in Pi:

```text
/accordion
```

### Global Accordion Dashboard

The Global Accordion Dashboard lets you watch multiple Pi sessions in one browser tab, without the Tauri desktop app.

Run `/accordion` in any Pi session to add it to the dashboard and focus its entry in the sidebar:

```text
/accordion = watch + focus current Pi session in the global browser dashboard
```

**Multiple sessions.** Every Pi session gets its own sidebar entry. Two sessions open in the same repo are still separate entries, not one. Session identity is the Pi session ID, not the working directory.

**Browser refresh.** Refreshing the browser reconnects to all currently live watched sessions. Sessions that have already exited are not shown.

**Quitting Pi.** When a Pi session exits, its sidebar entry is removed automatically.

**MVP limitation.** Direct single-session Accordion links (opened outside the broker dashboard) remain independent. Opening a direct link for a session that is already watched in the broker dashboard can conflict with it, because Accordion supports only one active GUI client per session at a time.

### Accordion Browser Broker

The Accordion Browser Broker (`extensions/accordion/extension/broker/`) is a singleton local HTTP/WebSocket service that backs the Global Accordion Dashboard. Run it manually for debugging or development:

```bash
npm run accordion:broker
```

This starts the broker on a loopback port, prints the dashboard URL, and writes `~/.accordion/browser-broker.json`. The broker stays alive until you press `Ctrl+C`.

In normal use, `/accordion` starts the broker automatically, adds the current Pi session to the watched list, and opens the dashboard in your browser.

## MCP (Pi built-in)

This package no longer ships `pi-mcp-adapter`. Pi's built-in MCP (`builtin:mcp`)
reads:

| Scope | Path |
|-------|------|
| **Global (preferred)** | `~/.pi/agent/mcp.json` |
| Project (optional) | `.pi/mcp.json` (trusted projects only) |

Use the **global** file for personal servers (playwright, cua, azure-devops, …).
Project `.pi/mcp.json` is optional; when present, entries
with the same name **replace** the global ones. This repo does not require a
project MCP file — servers live in the global agent config.

Pi does **not** read `~/.config/mcp/mcp.json` or project-root `.mcp.json`.
Keep project `.mcp.json` only if other hosts (Cursor/Claude/Codex) need it.

Tools are named `mcp__<server>__<tool>`. Manage servers with:

```bash
pi mcp list
pi mcp add <name> -- <command> [args...]          # writes ~/.pi/agent/mcp.json
pi mcp add -l <name> -- <command> [args...]       # writes .pi/mcp.json
pi mcp remove <name>
```

Exposure: `direct`, `codemode`, `deferred`, `hidden`, plus per-tool
`toolExposure`. See Pi's `docs/mcp.md`.

**Important:** an extension that registers `/mcp` (such as `pi-mcp-adapter`)
replaces built-in MCP. Keep that package uninstalled for this setup.

## Configure Playwright MCP

Playwright + the local recorder are configured **globally** in
`~/.pi/agent/mcp.json` (Edge via `--browser msedge`). The recorder uses an
absolute path into this repo:

```json
{
  "playwright": {
    "command": "npx",
    "args": ["-y", "@playwright/mcp@latest", "--browser", "msedge"],
    "exposure": "direct"
  },
  "playwright-recorder": {
    "command": "node",
    "args": ["C:/my-pi/scripts/playwright-record-mcp.mjs"],
    "exposure": "direct"
  }
}
```

Cross-host copy (optional): project `.mcp.json` for Claude/Cursor/Codex — those
hosts do not read Pi's `mcp.json` files.

After changing MCP config, run `/reload` (or a new session). Verify with `/mcp`
or `pi mcp list`.

### Save a video recording

Playwright MCP does not expose video recording. For a small standalone Edge
recording, use the helper in `scripts/playwright-record.mjs`:

```bash
npm run playwright:record -- https://example.com --duration 30
```

Use `--duration 0` to record until `Ctrl+C`. Videos are saved as WebM files
under `./.playwright-mcp/videos/`:

```bash
npm run playwright:record -- https://localhost:5050 --duration 0
```

This launches a separate headed Edge context with Playwright's native
`recordVideo` support; it does not attach to the browser session owned by the
MCP server.

### Agent-facing recording tool

The same recorder is exposed as a second MCP server named
`playwright-recorder`, with the `record_video` tool. After restarting the
clients, an agent can call it with a URL and duration, for example:

```json
{
  "url": "https://example.com",
  "duration": 30
}
```

It returns the saved `.webm` path. The tool requires a bounded duration from
1 to 3600 seconds and launches a separate headed Edge context.

## Subagents

This package registers a `subagent` tool. It runs child Pi `AgentSession`s in-process (SDK-style, no subprocess) with isolated context.

Modes:

- `explore` - read-only codebase investigation using `read`, `grep`, `find`, `ls`
- `shell` - command-oriented investigation using `read`, `grep`, `find`, `ls`, `bash`
- `custom` - load a markdown agent from `~/.pi/agent/agents/*.md` or nearest `.pi/agents/*.md`

Custom agent example:

```md
---
name: reviewer
description: Review code for correctness and maintainability
tools: read, grep, find, ls
---

You are a focused review subagent. Return actionable findings with evidence.
```

Optional model config lives in `models.json` in the same directory as those markdown files.

Project `.pi/agents` files still override user `~/.pi/agent/agents` files when names match.

Agent keys in `models.json` must exactly match the custom agent `name` value.

`models.json` must be valid JSON. Comments are not allowed.

Example `models.json`:

```json
{
  "defaultModel": "github-copilot/claude-sonnet-4.6"
}
```

Model resolution order for custom agents is `params.model`, then `models.json`, then markdown frontmatter, then the inherited session model.

Subagent workflow mode is on by default. Future prompts in the session tell the main agent when and how to use `explore`, `shell`, and `custom` subagents automatically. Manage it with:

```text
/subagent status
/subagent off
/subagent on
```

List custom agents in Pi:

```text
/subagents
```

Edit per-agent model choices in a TUI and save them back to `models.json`:

```text
/subagents-model
```

## Install on another PC

Push this package to git, then:

```bash
pi install git:github.com/<you>/my-pi
```

The `postinstall` script runs automatically and handles:

1. `npm run accordion:install`
2. `npm run accordion:build` (if not already built)


