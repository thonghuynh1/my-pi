---
status: accepted
---

# Proactively compress tool results before they enter the provider cache

Accordion will structurally compress large tool_result blocks at the transport layer (`before_provider_request`) before the provider first sees them. This ensures that when the provider caches these messages, it caches already-small content — eliminating the frozen-prefix deadlock where blocks that need folding are untouchable because they are already cached.

## Context

The cache-aware folding system (ADR 0002, `.scratch/cache-aware-folding`) correctly prevents folding inside the provider's frozen prefix. However, this creates a deadlock in practice: by the time the budget is exceeded, most blocks are frozen and cannot be folded. The conductor finds no viable candidates and returns an empty plan. Sessions that should benefit from folding never actually fold.

Headroom (headroomlabs-ai/headroom) solves this by compressing tool results *before* the provider caches them. The provider then caches the compressed version. The frozen prefix contains already-small blocks, so the budget is rarely exceeded and the deadlock disappears.

## Decision

Add a proactive content compression pass in the extension's `before_provider_request` hook. This pass:

1. Targets `tool_result` blocks above a token threshold.
2. Structurally shrinks them to a fixed compact representation (first/last lines + shape + recall marker).
3. Stores the original content in the existing recall store (keyed by the block's fold code).
4. Exempts MCP tool results (`toolName === "mcp"`) because they carry operational directives (e.g. poteto-mode pstack skill content).
5. Marks compressed blocks so the conductor skips them (clean separation: A1 owns tool_result compression, conductor owns conversation/MCP blocks).

The agent retrieves originals via the existing `recall(code)` mechanism, which appends content at the conversation tail — inherently cache-safe.

## Considered Options

**Lowering the `breakFrozen` gate** to allow folding frozen blocks at soft budget pressure. Simpler change, but pays a cache miss on every fold batch and defeats the purpose of cache-aware folding (ADR 0002).

**Adaptive pressure on the conductor** — making the conductor fold more aggressively based on context fill. Does not solve the fundamental problem: frozen blocks are still untouchable regardless of aggressiveness.

**Double-layer (A1 + conductor fold)** — proactive compression followed by conductor folding the compressed output. Creates a recall-chain problem: `recall(code)` returns the compressed version, not the original. The 2000→500→summary chain loses the original content.

## Consequences

The conductor's role narrows: it owns conversation blocks (assistant, user) and MCP/pstack blocks. Tool_result compression is handled before the conductor sees them. The poteto-mode special case in `my-customize-conductor` is unaffected because MCP results are exempt from proactive compression. The frozen-prefix deadlock is resolved because frozen blocks are already small. The existing `recall` mechanism provides the safety net for agents needing full content.
