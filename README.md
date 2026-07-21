# my-pi

Personal Pi package that bundles:

- `pi-mcp-adapter`
- `/poteto-me` prompt template
- `engineering-skills` helper/footer extension
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

The Accordion Browser Broker (`extensions/accordion/broker/`) is a singleton local HTTP/WebSocket service that backs the Global Accordion Dashboard. Run it manually for debugging or development:

```bash
npm run accordion:broker
```

This starts the broker on a loopback port, prints the dashboard URL, and writes `~/.accordion/browser-broker.json`. The broker stays alive until you press `Ctrl+C`.

In normal use, `/accordion` starts the broker automatically, adds the current Pi session to the watched list, and opens the dashboard in your browser.

## Configure engineering-skills MCP

If your engineering-skills MCP repo is at the default local path:

```text
F:/MyWork/PrecioHackathon/hackathon-grill-me
```

run in Pi:

```text
/engineering-skills-mcp-setup
```

Or pass a repo path:

```text
/engineering-skills-mcp-setup D:/path/to/hackathon-grill-me
```

The command writes global MCP config to:

```text
~/.config/mcp/mcp.json
```

It expects the MCP server to already be built:

```bash
cd F:/MyWork/PrecioHackathon/hackathon-grill-me
npm install
npm run build
```

## Use

```text
/poteto-me fix this bug test-first
```

This loads `skill-pstack` with `name=poteto-mode` from the `engineering-skills` MCP server, then follows its routing instructions.

The package also adds a footer/status entry with the active model and context usage. Refresh manually with:

```text
/usage-footer
```

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

Enable session-level subagent workflow instructions:

```text
/subagent
```

After that, future prompts in the session tell the main agent when and how to use `explore`, `shell`, and `custom` subagents automatically. Manage it with:

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

Then clone/build `hackathon-grill-me` on that PC and run:

```text
/engineering-skills-mcp-setup <path-to-hackathon-grill-me>
```
