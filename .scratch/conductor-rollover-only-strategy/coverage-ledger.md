# Coverage Ledger: Rollover-Only Fold Strategy

## Decisions

| ID | Description | Status | Owning Issue |
|---|---|---|---|
| DEC-001 | Rollover-only fold timing | covered by issue | #01 |
| DEC-002 | Dynamic rollover trigger (B2) | covered by issue | #01 |
| DEC-003 | Multi-group slicing at rollover | covered by issue | #01 |
| DEC-004 | Late-attach as B2 special case | covered by issue | #01 |
| DEC-005 | MCP blocks as group boundaries with rollover-time replaces | covered by issue | #01 |
| DEC-006 | Remove epoch hold / stability gating | covered by issue | #01 |
| DEC-007 | Remove reachability graph from main path | covered by issue | #01 (main path), #02 (hardCap oldest-first) |
| DEC-008 | Remove escape valve | covered by issue | #01 |
| DEC-009 | Keep hardCap emergency brake | covered by issue | #02 |

## User Stories

| ID | Description | Status | Owning Issue | Proving Criterion |
|---|---|---|---|---|
| US-001 | Cache-efficient compaction (≤1 invalidation per rollover) | covered by issue | #01 | AC-01-1: multi-group rollover emits no fold commands; AC-01-2: between-rollover returns empty plan |
| US-002 | Late-attach groups everything in one shot | covered by issue | #01 | AC-01-3: late-attach produces N groups covering all non-protected content |
| US-003 | Long session sustainability (repeated rollovers) | covered by issue | #01 (AC-01-7), #03 | AC-01-7: repeated rollovers stack groups; AC-03-1: benchmark ≤ 2 events |

## Required Behaviors

| ID | Description | Status | Owning Issue | Proving Criterion |
|---|---|---|---|---|
| RB-001 | Between rollovers, empty plan when live > cap but ≤ hardCap | covered by issue | #01 | AC-01-2: conduct() returns empty commands when preGroup < threshold |
| RB-002 | hardCap emergency brake fires when live > hardCap | covered by issue | #02 | AC-02-1: frozen-prefix folds/groups fire with oldest-first |
| RB-003 | Rollover plan contains all groups + MCP replaces atomically | covered by issue | #01 | AC-01-1: single plan with N groups + MCP replaces |
| RB-004 | MCP blocks are group boundaries, get replace at rollover | covered by issue | #01 | AC-01-4: MCP blocks produce replace commands, groups split around them |
| RB-005 | replayablePreviousGroups replayed on every return | covered by issue | #01 | AC-01-6: prior groups replayed between rollovers |
| RB-006 | FOLDABLE_KINDS gate unchanged | covered by issue | #02 | AC-02-3: hardCap path filters out tool_call/user |
| RB-007 | Dynamic trigger tolerates over-budget between rollovers | covered by issue | #01 | AC-01-2: no folds when live > cap but preGroup < threshold |

## Area Edits

| Area | Status | Owning Issue |
|---|---|---|
| Conductor main path (conduct()) | covered by issue | #01 |
| Chunked compaction (chunked-compaction.ts) | covered by issue | #01 |
| Constants (constants.ts) | covered by issue | #01 |
| MCP summary (mcp-summary.ts) — call site move | covered by issue | #01 |
| hardCap emergency brake | covered by issue | #02 |

## Test Seams

| Test | Status | Owning Issue |
|---|---|---|
| Between-rollover tolerance test | covered by issue | #01 |
| Multi-group rollover test | covered by issue | #01 |
| Late-attach test | covered by issue | #01 |
| MCP replace at rollover test | covered by issue | #01 |
| hardCap emergency test | covered by issue | #02 |
| Replay previous groups test | covered by issue | #01 |
| Repeated rollover test | covered by issue | #01 |
| hardCap FOLDABLE_KINDS test | covered by issue | #02 |
| Benchmark verification | covered by issue | #03 (HITL) |

## Blocking Edges

| Edge | Producer | Consumer | Contract |
|---|---|---|---|
| #02 blocked by #01 | #01 provides rollover-only conduct() with removed sortCandidates | #02 replaces hardCap sort with oldest-first | sortCandidates removed from main path; hardCap path needs its own sort |
| #03 blocked by #01, #02 | #01 + #02 provide complete conductor | #03 runs benchmark | Full conductor behavior |

## Intentional Deferrals

| Item | Reason |
|---|---|
| PCC hook ordering | Out of scope per PRD |
| ADR-0005 MCP grouping | Out of scope per PRD (miss-follow risk) |
| Group slice mid-turn handling | Left to implementer per PRD |

Coverage gaps: None
