# Ledger — accordion-vcc-upgrade

Feature: accordion-vcc-upgrade
Grill: ticket 02 (search-within-fold) + ticket 04 (group semantic sections)

## Decisions — Ticket 02 (search-within-fold)

### D1 — Tool surface for search-within-fold
Status: accepted
Choice: Option A — extend `recall` with optional `query` parameter
Rationale: Search is code-scoped (agent picks the block/group), so the input shape is the same as recall — adding `query` narrows what comes back, doesn't change addressing.
Evidence: `recall` already accepts `codes: string[]` (accordion.ts:1548); `RecallRequestMessage` (protocol.ts:214) — adding `query?: string` is backward-compatible.
Dependencies: none

### D2 — Wire result shape for query-recall
Status: accepted
Choice: Reuse `RecallContent.text` for fragments
Rationale: `text` already means "the content you asked for." With query, that's matching fragments. No new types needed.
Evidence: `RecallContent` (protocol.ts:319).
Dependencies: D1

### D3 — Search algorithm
Status: accepted
Choice: BM25 (clean-room, ~200 lines)
Rationale: Groups contain multiple blocks (plan.ts:204 joins member texts). BM25 ranks fragments across members. Substring can't rank.
Dependencies: D1, D2, wayfinder ticket 05

### D4 — Result cap
Status: accepted
Choice: Top 5 by BM25 score, no pagination
Rationale: Agent already narrowed to one group — corpus is small. Pagination adds wire complexity for an unlikely scenario. Can add later if needed.
Dependencies: D3

### D5 — Fragment / snippet boundary
Status: accepted
Choice: ±3 lines context around matching lines, merged if overlapping
Rationale: Gives the agent enough surrounding context to understand the match without dumping the whole block.
Dependencies: D3

## Decisions — Ticket 04 (group semantic sections)

### D6 — Where semantic extraction lives
Status: accepted
Choice: Option C — shared library, conductor calls
Rationale: Extractors are pure functions over Block[]/ViewBlock[]. Shared module (like bm25.ts). Conductor imports, calls, composes digest string, passes via GroupCommand.digest. Engine's groupDigest() stays as fallback.
Evidence: GroupCommand contract (conductor.ts:245–280) — digest supplies the summary body; lifecycle separates transient pressure groups from stable rollovers.
Dependencies: none

### D7 — Which semantic sections to include
Status: accepted
Choice: Three sections — Asks, Files, Errors — plus MCP Retrieval Index. Commits and Preferences excluded.
Rationale: Asks replaces Goals (honest about mixed-bag groups, no verb heuristic). Files are primary selection signal. Errors are what agents unfold for. Commits dropped — agent rarely commits to git within a session (pi-vcc journaling concern, not accordion's). Preferences are session-global, not group-scoped. MCP Retrieval Index maps non-file tool identities to recall codes.
Dependencies: D6

### D8 — Section accumulation across groups
Status: accepted
Choice: Self-contained per group, omit empty sections
Rationale: Groups are flat (store rejects nesting — createGroup() guard at store.svelte.ts:1878). No re-grouping exists. Each group's extractors run independently over its own members. Agent uses recall(codes, query) to search across groups. No carry-forward state needed.
Evidence: Group type doc comment: "flat (members are blocks, never groups)". createGroup() returns null if any member is already grouped.
Dependencies: D6

### D9 — Digest format
Status: accepted
Choice: Multi-line structured sections (Option A from format comparison)
Rationale: Optimized for agent selection, not human readability. Sections are independently scannable. Multi-line is fine — 3–4 line digest for a 2400-token group is still 99% compression. recall(codes, query) can match against digest text.
Dependencies: D7, D8

### D10 — Non-file tool activity representation
Status: accepted
Choice: MCP Retrieval Index (Option B) — Canonical MCP Identity mapped to recall codes
Rationale: Gives agent direct recall codes to jump to specific MCP/subagent results. Aligns with existing glossary terms (Canonical MCP Identity, MCP Retrieval Index). File tools feed [Files], not the index. Present only when non-empty.
Evidence: CONTEXT.md glossary — MCP Retrieval Index, Canonical MCP Identity definitions.
Dependencies: D7, D9
Prototype: .scratch/accordion-vcc-upgrade/prototype-digest-sections.html

### D11 — Asks extraction shape
Status: accepted
Choice: First line of each user block in the group, deduped, capped at 6, truncated at 60 chars. No overflow indicator.
Rationale: Mixed-bag groups have multiple unrelated asks. 6 is enough for selection; (+N more) doesn't help.
Dependencies: D7, D9

### D12 — Files extraction shape
Status: accepted
Choice: Full literal paths from strict allowlist (read, write, edit, find, grep, ls). Extract path argument. Deduped, capped at 8.
Rationale: Full paths are greppable — agent matches against them. Collapsing common prefix hurts selection. Allowlist avoids false positives from bash/MCP.
Dependencies: D7, D9

### D13 — Errors extraction shape
Status: accepted
Choice: isError === true blocks only. First line of text, truncated at 80 chars, capped at 3, deduped.
Rationale: isError is high-confidence signal from pi's tool framework. Regex scanning for error patterns (FAIL, Exception) risks false positives. Agent can use recall(query="FAIL") for soft failures.
Dependencies: D7, D9

## Decisions — Ticket 07 (richer fold digests)

### D19 — Where richer digest templates live
Status: accepted
Choice: Conductor-side, new module alongside extractors.ts. Engine's `digestBody()` remains universal fallback.
Rationale: Tier gating is a conductor concern. `ReplaceCommand` is the existing delivery mechanism. Isolated blast radius and testing. Engine fallback unchanged for other conductors.
Dependencies: none

### D20 — Emit timing and performance
Status: accepted
Choice: Pre-computed digest cache (`Map<blockId, string | undefined>`) populated incrementally while blocks are in the protected tail, consumed at fold time.
Rationale: Amortizes parsing cost to O(1–3 new blocks) per conduct() pass. Zero burst at fold time. Block.text is immutable — no invalidation needed. Piggybacks on existing dirty-guard trigger (headBlockCount changes on new block).
Dependencies: none

### D21 — Module shape
Status: accepted
Choice: New `block-digest.ts` module with single entry point `richDigest(block): string | undefined`.
Rationale: Distinct responsibility from extractors (one block → one string vs many blocks → accumulated list). Keeps extractors focused on group-level semantics.
Dependencies: D19

### D22 — Size indicator
Status: accepted
Choice: Token count (`ViewBlock.tokens`), not line count. Formatted as `~Nk tok`.
Rationale: Agent budgets in tokens, not lines. Zero parsing cost. Pre-compute makes line-counting feasible but unnecessary — tokens are the truth the agent acts on.
Dependencies: D20

### D23 — Input interface
Status: accepted
Choice: Add `tokens?: number` to existing `ExtractableBlock` interface.
Rationale: Thin interface already designed as Block/ViewBlock subset. One optional field serves both group extractors (ignore it) and per-block digest (use it).
Dependencies: D21

### D25 — Recall result tier
Status: accepted
Choice: `recall` tool_results use engine fallback (no rich digest). Re-derivable — agent can always re-query the original block.
Rationale: The original source block is still in the store with immutable text. Recall results are caches of queries the agent can repeat.
Dependencies: D28

### D26 — Paired tool_call lookup scope
Status: accepted
Choice: Paired tool_call lookup for `read` and `subagent` only. All other tool types use engine fallback digest.
Rationale: `read` result text is raw file content (no path header). `subagent` result doesn't self-describe its task. Other tools (bash, grep, find, ls) have adequate engine fallback: `<toolName> → OK/ERR, ~N tok · <peek>`.
Dependencies: D28

### D27 — Paired lookup mechanism
Status: accepted
Choice: Simple backwards scan of `view.blocks` for block with `id === callId`.
Rationale: Fires once per read/subagent block during pre-compute. Even with frequent use, cost is negligible (amortized, not burst).
Dependencies: D26

### D28 — Final template set
Status: accepted
Choice: Rich digest for 6 types, engine fallback for everything else.
- `read` result: `📄 <path> (~Nk tok)` — path from paired tool_call
- `subagent` result: `🔀 <type>: "<task>" (~Nk tok)` — task from paired tool_call
- `isError=true`: `❌ <first error line>` — first non-empty line of text
- `text` (assistant): `🤖 "<first sentence>" (~Nk tok)` — first sentence boundary
- `thinking`: `💭 (~Nk tok)` — just tokens
- `mcp__*`: `🔌 <server/tool> (~Nk tok)` — parsed from toolName
- Everything else (bash, run_tests, grep, find, ls, recall, generic): engine fallback `<toolName> → OK/ERR, ~N tok · <peek>`
Rationale: Focuses parsing effort on blocks where result text doesn't self-describe (read, subagent) or where structural signal matters most (errors, assistant reasoning). Engine fallback already produces informative digests for output-heavy tools.
Dependencies: D22, D23, D26, D27

### D29 — Tier gating
Status: accepted
Choice: No tier gating for digests. `richDigest()` pattern-matches on toolName/kind regardless of tier. `blockTier()` exists but is unused by digest system.
Rationale: Every recognized type that benefits from a rich template gets one. Tier distinction collapsed — the template set is the gate, not the tier score. `blockTier()` remains for ticket 08 (PCC removal) or future use.
Dependencies: D28

### D30 — Cold-start performance: amortized pre-compute + upgrade pass
Status: accepted
Choice: Batch pre-compute (50 blocks/pass) with high-water mark. After catch-up completes, one-time upgrade pass emits ReplaceCommand for folded blocks that were assigned engine fallback during catch-up. Frozen blocks are naturally rejected by existing substOne() guard — no special logic.
Rationale: Cold-start (enable mid-session, reattach) could face 300–500 blocks. Amortizing over 10 passes avoids blocking. Upgrade pass ensures blocks don't permanently miss rich digests. Frozen guard prevents unsafe prefix changes automatically.
Dependencies: D20

## Decisions — Ticket 06 (per-block ranking scores)

### D14 — Score purpose: fold order vs digest quality vs search boost
Status: accepted
Choice: Score gates digest quality ONLY. Does not influence fold order (stays oldest-first) or search results (stays pure BM25).
Rationale: Fold order is well-tested across 2 slices. BM25 handles search relevance within small group corpora (5–20 blocks) without needing structural boost. Score's sole consumer is ticket 07's richer digest system.
Dependencies: none

### D15 — Scoring model: continuous weights vs tiers
Status: accepted
Choice: 3 structural tiers (High / Medium / Low) — not continuous additive weights.
Rationale: Score is a digest quality gate, not a fine-grained ranking signal. Three tiers express the preference without pretending we have empirically-tuned weights for a novel use case. Easy to implement, test, and graduate later.
Dependencies: D14

### D16 — Recency in scoring
Status: accepted
Choice: No recency. Tier is purely structural (kind + toolName + isError).
Rationale: An edit deserves a rich digest whether 5 turns old or 50 turns old. Digest quality depends on what the block IS, not when it happened. Makes tier O(1), no caching, no invalidation.
Dependencies: D15

### D17 — Tier classification (High tier)
Status: accepted
Choice: High = edit/write/multiedit (toolName), run_tests (toolName), isError===true, bash+test-regex (fallback). Graceful degradation: if text absent, ambiguous bash defaults to Medium.
Rationale: run_tests is the primary test tool in pi; bash fallback covers cases where run_tests suggests manual bash. isError is high-confidence from pi's framework. Edit tools are primary session artifacts.
Dependencies: D15, D16

### D18 — Where tier logic lives
Status: accepted
Choice: `blockTier(block)` function in `extractors.ts`, operating on `ExtractableBlock` interface.
Rationale: Extractors already understand block signals, conductor already imports the module, ticket 07's digest templates will also consume it. No new file for a 10-line function.
Dependencies: D15
