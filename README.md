# my-pi

Personal Pi package that bundles:

- `pi-mcp-adapter`
- `/poteto-me` prompt template
- `engineering-skills` helper/footer extension
- `usage-footer.ts` footer/status extension showing model and context usage
- `subagents.ts` in-process subagent tool with `explore`, `shell`, and `custom` modes
- `opensource-cache-instructions.ts` system prompt guidance to use global `opensrc` (`~/.opensrc/`) for npm dependency source lookups

## Install locally

```bash
cd F:/MyWork/my-pi
npm install
pi install F:/MyWork/my-pi
```

Restart Pi or run `/reload`.

The `postinstall` script handles Accordion overlay and build automatically.

## Accordion

This repo vendors [Accordion](https://github.com/a-Fig/accordion) under `vendor/accordion` and registers its Pi extension automatically.

Setup is automatic via `postinstall`. Manual steps only if needed:

```bash
npm run setup:accordion
```

Then in Pi:

```text
/accordion
```

### Custom conductor overlay

This repo ships a custom conductor (`MCP-preserving GC`) that garbage-collects old context but never folds MCP tool results. It lives in `overlays/accordion/` and is injected into the vendor submodule at install time.

Defaults applied by the overlay:

- Conductor: `MCP-preserving GC`
- Steering (live folding): ON
- Budget: min(contextWindow, 100k)

The overlay is idempotent and re-applied on every `npm run accordion:overlay` or `npm run accordion:update`.

To pull upstream Accordion changes without losing the custom conductor:

```bash
npm run accordion:update
```

This re-applies the overlay and rebuilds. To incorporate new upstream Accordion code, update the vendored files in `vendor/accordion/` first, then run this command. If an upstream change breaks an anchor, the script fails with the exact missing line.

Notes:

- Keep local customizations in `overlays/accordion/` when possible so they can be re-applied after refreshing the vendored Accordion files.
- The overlay script handles CRLF/LF differences.
- You can still switch conductors in the Accordion UI. The overlay only sets the default.

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
  "defaultModel": "github-copilot/claude-sonnet-4.6",
  "agents": {
    "reviewer": "inherit",
    "test-runner": "github-copilot/gpt-4.1"
  }
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
2. `npm run accordion:overlay`
3. `npm run accordion:build` (if not already built)

Then clone/build `hackathon-grill-me` on that PC and run:

```text
/engineering-skills-mcp-setup <path-to-hackathon-grill-me>
```
