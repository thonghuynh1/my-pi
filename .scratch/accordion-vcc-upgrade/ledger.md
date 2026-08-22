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
