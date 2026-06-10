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
model: inherit
---

You are a focused review subagent. Return actionable findings with evidence.
```

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

## Install on another PC

Push this package to git, then install:

```bash
pi install git:github.com/<you>/my-pi
```

Then clone/build `hackathon-grill-me` on that PC and run:

```text
/engineering-skills-mcp-setup <path-to-hackathon-grill-me>
```
