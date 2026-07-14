# Context Glossary

## Pair Program Tool

A deterministic Pi extension tool that coordinates an autonomous pair-programming run for one task. It is not an LLM agent. It owns turn order, transcript display, transcript persistence, completion checks, and message passing between the Driver Agent and Navigator Agent.

## Engineering Skills MCP

The MCP server named `engineering-skills` that exposes reusable engineering skills and prompts, including `grill-with-docs`, `to-prd`, and `skill-tdd`. It is the contract source for planning, PRD handoff, and TDD workflow protocols that Pi tools should follow. Pair Program Tool runs in TDD mode should depend on this MCP capability rather than hardcoded skill file paths.

## Global Accordion Dashboard

A browser-served Accordion dashboard that can discover and monitor multiple local Pi sessions from one URL, including sessions running in different repositories or Pi processes. It is distinct from subagent monitoring: the primary unit is a Pi session advertised through Accordion's local session registry.

## Accordion Browser Broker

A local HTTP/WebSocket service that makes Accordion's filesystem-backed session registry available to a plain browser dashboard. It owns browser discovery APIs, session list updates, and routing browser connections to per-session Accordion extension servers without requiring the Tauri desktop app.

## Authoritative Accordion Folding Runtime

The browser-independent folding engine hosted by each Pi session extension whose plan and calculation state are authoritative for both model requests and optional dashboard controls.

## Warm Folding Calculation

An incremental Accordion plan update that reuses an active session’s block index, conductor state, and prior plan instead of recomputing the full history.

## Capability Visibility

A `my-pi` configuration layer that controls which managed custom extension tools are exposed to the agent and which managed commands are registered for human slash-command use.

## Managed Extension

A custom `my-pi` extension that opts into Capability Visibility by declaring a stable `piExtension.id`. Capability Visibility settings target this ID rather than the extension file path.

## Agent-Visible Tool

A managed extension tool that is included in the agent's active callable tool schema.

## Agent-Hidden Tool

A managed extension tool that is registered internally but excluded from the agent's active callable tool schema.

## Driver Agent

The child Pi agent responsible for changing the workspace inside the task worktree. It reads code, edits files, runs tests, and reports evidence for each implementation cycle.

## Navigator Agent

The child Pi agent responsible for reviewing the Driver Agent's plan, evidence, and changes. It can inspect the workspace and run focused verification commands, but it does not edit or write files.

## Pair Run Memory

The compact working memory maintained by the Pair Program Tool during a run. It contains the task summary, accepted constraints, unresolved risks, current cycle objective, latest agent handoff, and current evidence. It is used instead of replaying the full transcript into every agent turn.

## Pair Transcript

The human-auditable record of Driver Agent and Navigator Agent communication during a pair-programming run. The full transcript is saved for review, but only compact Pair Run Memory is passed back into agent prompts.

## End Goal To Prove

The canonical finish line for one Pair Program Tool run. For issue-file-driven runs, it is grounded in the issue's acceptance criteria and every acceptance criterion must be explicitly accounted for before final approval.

## Pair Acceptance Checklist

The concrete proof checklist used by the Navigator Agent to review whether the End Goal To Prove has been met. It may contain multiple acceptance-criteria bullets when they all verify the same vertical slice.

## Pair Run State

The coordinator-owned canonical state for a pair-programming run. It records the pinned end goal, acceptance checklist, playbook recommendation, active playbook, loaded leaves, skipped steps, permitted amendments, evidence, follow-ups, and Navigator verification telemetry so roles cannot silently redefine success.

## TDD Skill

The test-driven development workflow exposed by Engineering Skills MCP as `skill-tdd`. In TDD mode, Driver Agent and Navigator Agent are expected to use this skill for red-green-refactor behavior and evidence reporting.

## Proactive Content Compression

A transport-layer pass in the Accordion extension's `before_provider_request` hook that structurally shrinks tool_result blocks above a token threshold to a fixed compact representation plus a recall marker. The original is stored in the recall store. The conductor does not fold these blocks. Distinct from conductor folding, which handles conversation and MCP/pstack blocks. Resolves the frozen-prefix deadlock where blocks are untouchable by the time the budget is exceeded.

## A1 Exemption List

Tool_result blocks that Proactive Content Compression never compresses because their full content carries operational meaning, not just data. Includes MCP tool results (pstack/skill content such as poteto-mode) and recall tool results. Analogous to Headroom's `DEFAULT_EXCLUDE_TOOLS`.

## Frozen-Prefix Deadlock

The failure mode where Accordion's cache-aware folding guard prevents any folding because the frozen prefix has grown to cover most blocks by the time the budget is exceeded. Proactive Content Compression resolves this by ensuring frozen blocks are already small.
