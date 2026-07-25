# To-Issues Coverage Ledger

Status: complete

## PRD IDs

| Obligation | State | Owner | Proving criterion |
|---|---|---|---|
| US-001 | covered by issue | 01 | Walking-skeleton test applies a real conductor group and recalls one named MCP member while the group remains folded |
| US-002 | covered by issue | 02 | Oversized-turn tests prove safe split and indivisible-message overshoot |
| DEC-001 | covered by issue | 01 | Complete-turn selector and endpoint regression tests |
| DEC-002 | covered by issue | 01 | One order-preserving group digest ends with MCP index |
| DEC-003 | covered by issue | 01 | Member recall returns one original with no store mutation |
| DEC-004 | covered by issue | 03 | Repeated identity test marks newest full entry and older compact refs |
| DEC-005 | covered by issue | 01 | Canonical identity equivalence/difference/redaction tests |
| DEC-006 | covered by issue | 02 | Safe oversized-turn fallback tests |
| DEC-007 | covered by issue | 03 | Compact repeated-occurrence formatting tests |
| RB-001 | covered by issue | 01 | Complete-turn selection tests |
| RB-002 | covered by issue | 01, 02 | Current partial turn test; bounded oversized fallback test |
| RB-003 | covered by issue | 01 | Hard-barrier table plus MCP/recall/pstack inclusion cases |
| RB-004 | covered by issue | 02 | messageKey/callId safe-cut tests |
| RB-005 | covered by issue | 01, 02 | Applied group has contiguous balanced IDs and >=2 survivors |
| RB-006 | covered by issue | 01, 03 | deterministic basic index; final digest-cost/min-saving test |
| RB-007 | covered by issue | 01 | Exact final-section/index format test |
| RB-008 | covered by issue | 01 | canonical args and redaction tests |
| RB-009 | covered by issue | 03 | newest/default and compact earlier refs test |
| RB-010 | covered by issue | 03 | malformed/missing call metadata generic recovery row test |
| RB-011 | covered by issue | 01 | single member original/ID recall test |
| RB-012 | covered by issue | 01 | no group mutation and no appendToTail test |
| RB-013 | covered by issue | 01 | existing group recall/member unfold regression tests |
| RB-014 | covered by issue | 01, 03 | group unchanged after recall; deterministic replay and reconnect/invariant suite |
| RB-015 | covered by issue | 02 | 128k/null gate regression tests |
| RB-016 | covered by issue | 01, 02, 03 | no protocol/command/persistence wiring in implementation maps and full checks |

## Area and implementation obligations

| Obligation | State | Owner | Proof |
|---|---|---|---|
| Turn/unit selector contract in `chunked-compaction.ts` | covered by issue | 01 | focused conductor/store tests |
| Oversized safe-cut extension | covered by issue | 02 | focused oversized/property tests |
| Chunked barrier policy in `my-customize-conductor.ts` | covered by issue | 01 | inclusion/barrier table tests |
| Canonical MCP identity owner in `mcp-summary.ts` | covered by issue | 01 | canonicalization/redaction tests |
| Basic final MCP Retrieval Index | covered by issue | 01 | walking skeleton and digest assertions |
| Repeated occurrence compaction and generic fallback | covered by issue | 03 | formatter tests |
| Final digest cost in savings gate | covered by issue | 03 | threshold discrimination test |
| Grouped-member recall in `plan.ts` | covered by issue | 01 | `resolveRecall` tests and walking skeleton |
| Existing extension recall wiring | covered by issue | 01 | unchanged registration plus returned single content assertion at resolver seam; existing Pi tool history contract consumed |
| Engine/wire/cache invariants | covered by issue | 03 | invariant, JSONL, property, and full suite |
| Domain/ADR consistency | covered by issue | 03 | docs/status audit; ADR-0005 remains accepted |
| Helper naming/local organization left to implementers | covered by issue | 01 | issue fixes shared names only where blockers consume them; private helpers remain free |
| Compact punctuation/line wrapping left to implementers | covered by issue | 03 | deterministic normative fields enforced; formatting internals remain free |
| Identity fingerprint representation left to implementers | covered by issue | 01 | fingerprint must be deterministic, redacted in display, and no weaker than six-character recovery handles |

## Blocking edges

| Producer → consumer | State | Crossing contract | Wiring proof |
|---|---|---|---|
| 01 → 02 | covered by issue | `chunked-compaction.ts::selectCompactionRange` returns contiguous `SafeCompactionRange`; 02 adds oversized-turn safe-cut branch consumed by `MyCustomizeConductor.conduct` | 02 applied-group test fails if selector output is ignored or host clamps the range |
| 02 → 03 | covered by issue | Final selected `members` from `MyCustomizeConductor.conduct` feed `buildMcpRetrievalIndex` and completed-digest savings calculation | 03 integration fixture uses a safely selected range with repeated MCP identities and asserts emitted index + min-saving behavior |

## Verification command validation

All commands were validated before publication from repository root on the current baseline.

| Command | Result |
|---|---|
| `npm --prefix extensions/accordion/app test -- src/lib/engine/conductor.compaction-naive.test.ts src/lib/live/plan.test.ts src/lib/live/plan.groups.test.ts` | PASS — 114 tests passed |
| `npm --prefix extensions/accordion/app test -- src/lib/engine/conductor.compaction-naive.test.ts src/lib/engine/store.groups.test.ts` | PASS — 96 tests passed |
| `npm --prefix extensions/accordion/app test -- src/lib/engine/conductor.my-customize-conductor.test.ts src/lib/engine/conductor.compaction-naive.test.ts ../extension/chunked-compaction-invariant.test.ts ../extension/accordion.chunkedCompactionJsonl.test.ts` | PASS — 149 tests passed |
| `npm --prefix extensions/accordion/app run check` | PASS — svelte-check completed with zero errors |
| `git diff --check -- CONTEXT.md docs/adr/0004-accordion-chunked-compaction.md docs/adr/0005-turn-aligned-chunked-compaction-and-mcp-retrieval.md` | PASS — exit 0, no whitespace errors |
| `python -c "from pathlib import Path; c=Path('CONTEXT.md').read_text(); a4=Path('docs/adr/0004-accordion-chunked-compaction.md').read_text(); a5=Path('docs/adr/0005-turn-aligned-chunked-compaction-and-mcp-retrieval.md').read_text(); assert all(x in c for x in ('## Complete Accordion Turn','## MCP Retrieval Index','## Canonical MCP Identity')); assert 'status: superseded by ADR-0005' in a4; assert 'status: accepted' in a5"` | PASS — exit 0, canonical glossary headings and ADR statuses verified |

## Deferrals and findings

- **Rejected verification seam:** baseline `npm --prefix extensions/accordion/app test` is not feasible in this checkout because `extension/broker/__tests__/broker.test.ts` cannot resolve `ws`; the run reached 967 passing tests and one failed suite before feature changes. Issues therefore use the validated focused app/extension suites plus `svelte-check`, which cover every changed module and accepted invariant without requiring unrelated broker dependency repair.
- Physical message movement, name-based recall API, nested groups, persistence, protocol changes, and Proactive Content Compression changes are deferred as explicit PRD out-of-scope work.
- No HITL work is required.
- No blocked decision remains.
- Coverage gaps: None.
