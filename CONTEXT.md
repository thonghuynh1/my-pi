# Context Glossary

## Engineering Skills MCP

The MCP server named `engineering-skills` that exposes reusable engineering skills and prompts, including `grill-with-docs`, `to-prd`, and `skill-tdd`. It is the contract source for planning, PRD handoff, and TDD workflow protocols that Pi tools should follow.

## Global Accordion Dashboard

A browser-served Accordion dashboard that can discover and monitor multiple local Pi sessions from one URL, including sessions running in different repositories or Pi processes. It is distinct from subagent monitoring: the primary unit is a Pi session advertised through Accordion's local session registry.

## Accordion Browser Broker

A local HTTP/WebSocket service that makes Accordion's filesystem-backed session registry available to a plain browser dashboard. It owns browser discovery APIs, session list updates, and routing browser connections to per-session Accordion extension servers without requiring the Tauri desktop app.

## Authoritative Accordion Folding Runtime

The browser-independent folding engine hosted by each Pi session extension whose plan and calculation state are authoritative for both model requests and optional dashboard controls.

## Warm Folding Calculation

An incremental Accordion plan update that reuses an active session’s block index, conductor state, and prior plan instead of recomputing the full history.

## Complete Accordion Turn

A user message together with all following assistant message parts and balanced tool-call/tool-result activity up to, but not including, the next user message.

## MCP Retrieval Index

The final section of a deterministic Accordion group digest that maps recognizable MCP identities to exact grouped-member recall codes without changing canonical message order.

## Canonical MCP Identity

A stable MCP invocation identity composed from server, tool, and a deterministic fingerprint of canonical arguments, with safe identifying arguments displayed for agent recognition.

## Capability Visibility

A `my-pi` configuration layer that controls which managed custom extension tools are exposed to the agent and which managed commands are registered for human slash-command use.

## Managed Extension

A custom `my-pi` extension that opts into Capability Visibility by declaring a stable `piExtension.id`. Capability Visibility settings target this ID rather than the extension file path.

## First-Party Accordion

The complete Accordion fork owned and evolved within `my-pi`, including its Authoritative Accordion Folding Runtime, browser/desktop app, conductors, tests, and supporting documentation and assets; it is not an upstream-tracking vendored dependency.

## Agent-Visible Tool

A managed extension tool that is included in the agent's active callable tool schema.

## Agent-Hidden Tool

A managed extension tool that is registered internally but excluded from the agent's active callable tool schema.

## Proactive Content Compression

A transport-layer pass in the Accordion extension's `before_provider_request` hook that structurally shrinks tool_result blocks above a token threshold to a fixed compact representation plus a recall marker. The original is stored in the recall store. The conductor does not fold these blocks. Distinct from conductor folding, which handles conversation and MCP/pstack blocks. Resolves the frozen-prefix deadlock where blocks are untouchable by the time the budget is exceeded.

## A1 Exemption List

Tool_result blocks that Proactive Content Compression never compresses because their full content carries operational meaning, not just data. Includes MCP tool results (pstack/skill content such as poteto-mode) and recall tool results. Analogous to Headroom's `DEFAULT_EXCLUDE_TOOLS`.

## Frozen-Prefix Deadlock

The failure mode where Accordion's cache-aware folding guard prevents any folding because the frozen prefix has grown to cover most blocks by the time the budget is exceeded. Proactive Content Compression resolves this by ensuring frozen blocks are already small.

## Atomic Budget Rebase

The one-pass `MyCustomizeConductor` transition for a first-observed or budget-decrease over-cap session. It emits one deterministic chunked-compaction group plus any non-overlapping folds needed to leave one normal Pre-Group interval of runway.

## Pre-Group Interval

The exact conductor-owned contiguous region between Accordion’s older foldable context and Protected Tail whose blocks remain full while accumulating toward the next safe rollover group.

## Human Accordion Budget Minimum

The 50,000-token minimum enforced by human Accordion budget controls. `AccordionStore.setBudget()` intentionally preserves lower programmatic budgets; below the conductor's active Pre-Group target, `MyCustomizeConductor` uses safe fallback planning.
