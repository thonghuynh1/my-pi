# 01 — What data does the conductor actually see per block?

Type: research
Status: resolved

## Question

The `ConductorView` gives each block `id`, `kind`, `tokens`, `foldedTokens`, `held`, `folded`, `protected`, `grouped`, `proactivelyCompressed`. But pi-vcc's ranking engine scores blocks on **semantic signals**: edit tool calls (+34), test commands (+26), file paths (+18), non-zero exit (+24), bash content, recency.

**Does the conductor see enough data to compute pi-vcc-style rankings?** Specifically:
- Can the conductor access the raw text/content of each block?
- Can it see tool names, arguments, exit codes?
- Or does it only see the metadata fields listed in `ConductorView`?

If the conductor can't see content, can the `ReplaceCommand` mechanism be used to push richer digests from the digest layer (which does see content) instead?

This determines whether ranking lives in the conductor or in the digest layer.

## Answer

**Ranking must live in the conductor.** The conductor sees everything needed:

- `ViewBlock.text` — full raw content (in-process conductors get this)
- `ViewBlock.toolName` — first-class field on tool_call and tool_result
- `ViewBlock.isError` — boolean error flag (non-zero exit proxy)
- `ViewBlock.callId` — links tool_call ↔ tool_result
- `ViewBlock.tokens`, `turn`, `order` — position/size metadata
- Tool arguments are JSON-embedded in `tool_call.text` and parseable

`ReplaceCommand` can push richer digest strings (arbitrary `content` + optional `recoverable: true` for unfold handle). The digest layer (`digest.ts`) does have full content but is a per-block formatter — no cross-block comparison, no budget awareness.

**Decision:** Scoring/ranking → conductor. Richer digests → `ReplaceCommand` from conductor.
