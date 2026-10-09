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

## Durable background work

- `bg_run` uses a detached supervisor: commands, logs, stdin, and timeout enforcement survive Pi exit/reload. Reopen the **same Pi session** to recover status and completion notifications. Stop persistent jobs explicitly with `bg_kill` or `/jobs kill <id>`; quitting Pi no longer stops them.
- Background subagents persist results, checkpoints, launch configuration, usage, and child audit transcripts. Their in-process execution cannot survive host exit: unfinished runs become `interrupted`, never automatically replayed.
- `subagent_resume({ jobId: "sa-1" })` explicitly starts a **new** run with a checkpoint handoff. Inspect uncertain side effects first. This is not exact tool/model replay; each interrupted run can have only one recovery child.
- Storage: `~/.pi/agent/jobs/`, isolated by Pi session ID. Override with `PI_DURABLE_JOBS_DIR`. IDs remain session-local and monotonic across reloads; logs/transcripts are retained. One host per session is supported.
- Completion delivery is at-least-once across crashes. Confirmed results stay queryable; unconfirmed notifications are recovered. Supervisor loss or host reboot yields an unknown/interrupted command outcome, not an automatic retry.

See [ADR 0006](docs/adr/0006-durable-background-work.md) for the recovery contract.

## Subagents

This package registers a `subagent` tool. It runs child Pi `AgentSession`s in-process (SDK-style, no subprocess) with isolated context.

Execution is **joined by default**: the launching tool stays pending until the child finishes and cleans up, then returns its report. Batch independent calls in the same assistant message to run children concurrently. `/subagent on/off` changes prompting only, not execution mode.

Fresh agents automatically receive a capability-selection guide through tool metadata and the startup system prompt while workflow mode is on (the default). The guide explains required joined work vs optional detached work, true parallel batches, saved-context follow-ups using the latest job ID, self-contained tasks, limited child tools, shared-filesystem ownership, evidence packets, context/slot limits, and explicit recovery. It warns against batching dependent edits with prerequisite research or duplicating a child's owned work. Workflow off removes coaching, not the joined runtime safeguards. The guide is shared between both instruction surfaces to avoid drift.

- `subagent({ type: "explore", task: "Find the route" })` returns the required joined result.
- `subagent({ type: "shell", task: "Investigate optional logs", mode: "detached" })` returns an immediate job ID with an optional result delivered later.
- Legacy `background: true` means detached; `false` means joined. Conflicting `mode`/`background` is rejected.
- Capacity is **6 running children across both modes**. Excess admission fails explicitly; there is no queue or silent mode switch. Repeated tool-call request IDs reuse the admitted job before the capacity check.
- Evidence packets honor either mode. Structured verification, packet diagnostics, limits, usage, and audit transcripts are retained for retrieval; packet children cannot be followed up. Result `mode` is joined/detached; packet/prose-fallback telemetry uses `evidenceMode`.
- `subagent_wait({ jobIds: ["sa-1"], waitFor: "any", timeoutSeconds: 120 })` retrieves outcomes. `waitFor` defaults to `all`; `any` returns after one targeted terminal outcome. Omitted IDs target running and undelivered finished jobs. Timeout defaults to 120 seconds (max 240); timeout or abort stops **waiting**, not children. Explicit IDs can retrieve already acknowledged outcomes.
- Joined cancellation aborts the child and awaits cleanup. Detached children are cancelled explicitly with `subagent_cancel`. Cancelling a wait never cancels its children.
- Completion saves the outcome/report atomically. If that save fails, the finished child remains terminal in memory, releases capacity, and returns an explicit `persistenceError` warning instead of losing its report or pretending to keep running. Detached automatic delivery waits for a confirmed registry write; explicit retrieval still works. A later successful snapshot confirms the in-memory outcomes. After a crash during persistent disk failure, inspect recorded tool results/transcripts before explicit recovery.
- Joined results are acknowledged only after the launching tool receipt (or a wait receipt) is recorded. Normal joined results are **not** automatically delivered again. After a crash, unacknowledged joined outcomes remain discoverable with `subagent_status` and retrievable with `subagent_wait`; there is no automatic restart. Legacy saved jobs remain detached and keep their outbox.

### Explicit follow-up and bounded context

`subagent_followup({ jobId: "sa-1", task: "Check a related detail" })` explicitly reopens a **successful normal** child's disk transcript using its saved resolved model, cwd, tools, and prompt. It also defaults to joined and accepts the same legacy mode alias. Unknown, failed, cancelled, interrupted, packet, and legacy jobs without reusable configuration/transcripts are rejected. The transcript lineage has exclusive ownership during execution/cleanup, including requests through ancestor IDs. Use the latest successful job ID only if there has been no later failed/cancelled/interrupted assignment. A failed lineage stays closed even when an older assignment succeeded: start an explicit new child with a reviewed handoff, or explicitly recover interrupted work after checking side effects. Ancestor receipts retain their original per-segment reports but their transcript pointer names mutable shared history. Unavailable saved models fail rather than silently switching.

Child-only in-memory settings enable native SDK compaction independently of the parent's Accordion/global settings, without loading extensions or writing settings to disk. The target context budget is 50k tokens, reduced for smaller model windows with response reserve and a recent-tail target no larger than 12k. Native estimates and indivisible messages mean this is a compaction target, not a hard per-request token ceiling. Status/report context usage is known tokens/window or explicitly unknown (especially immediately after compaction).

At an idle follow-up boundary, over-budget reusable context is compacted before prompting. After **3 assignments**, **1 MiB raw transcript**, or unknown/unsafe context, the next explicit follow-up uses a new session with a bounded handoff: original goal, previous report up to 8k characters, and the full audit transcript pointer. This is marked **fresh handoff, not full memory**, with reset reason and generation in the result. Oversized goals that cannot fit the bounded handoff fail visibly. Full old transcripts remain for audit. Compaction failures are visible errors requiring a reviewed new child/handoff, not infinite retries or replay of uncertain side effects. Usage, turns, tools, tokens, and costs are per assignment; historical usage is not billed again.

Types:

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


