# Ledger — search-within-fold architecture

Feature: accordion-vcc-upgrade / ticket 02
Grill: search-within-fold architectural approach

## Decisions

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
