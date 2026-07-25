---
status: closed
---

Status: ready-for-agent
Type: AFK

# Complete repeated MCP indexing and cross-layer compaction invariants

## Parent

`.scratch/accordion-turn-aligned-mcp-retrieval/PRD.md`

## What to build

Complete the MCP Retrieval Index for repeated and partially identifiable calls, account for the final index-bearing digest in rollover savings, and prove the finished turn-aligned implementation preserves deterministic replay, immutable recall, wire balance, diagnostics, and cache-break accounting.

Covers `DEC-004`, `DEC-007`, `RB-006`, `RB-009`, `RB-010`, `RB-014`–`RB-016`, completes `DEC-005`, and closes integration proof for `US-001` and `US-002`.

## Implementation map

### Producer outputs consumed from issues 01 and 02

- From `01-complete-turn-mcp-recall-skeleton.md`:
  - `mcp-summary.ts::CanonicalMcpIdentity` and `canonicalMcpIdentity(callText)` provide stable key, safe display identity, and fingerprint.
  - `chunked-compaction.ts::buildMcpRetrievalIndex` emits the basic final index section.
  - `plan.ts::resolveRecall` resolves one chunked group member read-only.
- From `02-oversized-turn-safe-boundaries.md`:
  - `chunked-compaction.ts::selectCompactionRange` returns the final normal/oversized-safe range consumed by `MyCustomizeConductor.conduct`.
- Crossing contract: the exact selected `members` corpus is passed, in canonical conversation order, to identity occurrence collection, final digest composition, content hashing, and savings calculation.
- Wiring owner: this issue updates `MyCustomizeConductor.conduct` so the completed digest—not `estimateDefaultGroupDigestCost` alone—controls the existing min-saving gate.

### Repeated occurrences

- Group occurrences by the full Canonical MCP Identity key, not display label alone.
- Sort occurrences by conversation order/turn deterministically.
- Emit one full entry for the newest occurrence with label, identity, newest turn/code, and exact recall instruction.
- Emit retained older occurrences as compact `turn <n> · {#<code>}` references on that identity entry. Do not repeat full identity/instruction text.
- An unqualified name is documentation for the agent to choose the newest displayed code; do not add a name-based runtime recall API.
- Across multiple immutable group summaries, do not rewrite an older index; natural rightmost/newest group order remains authoritative.

### Generic fallback

- If call/result pairing or call JSON does not yield a Canonical MCP Identity, preserve a generic MCP row with safe label, turn, and exact member code. Do not omit its recovery route and do not invent server/tool values.
- Preserve existing pstack name/label handling and recall-result identity carry-forward.

### Final digest cost and invariants

- Build the complete deterministic digest—including MCP index and older references—before applying the existing min-saving threshold `max(2_000, 0.05 * cap)`.
- Use the completed digest's estimated token cost in `estimatedGroupSaving`; an index that makes the candidate fail the threshold must suppress rollover.
- Preserve content hash determinism, non-empty digest frozen-prefix bypass, no repeated rollover, no protocol changes, and JSONL/cache diagnostics.
- Keep documentation aligned with existing `CONTEXT.md` terms and accepted `docs/adr/0005-turn-aligned-chunked-compaction-and-mcp-retrieval.md`; do not edit the accepted decision unless code evidence contradicts it.

### Blocking-edge wiring proof

Create one integration fixture containing an oversized-safe selected range with two occurrences of the same identity, one different identity, and one malformed MCP call. Run the real conductor and apply the emitted group. Assert the final digest has one newest/full row, compact older reference, separate identity row, generic fallback row, and valid recall codes. Use a near-threshold variant whose rollover result changes when the final index cost is included; this fails if issue-02 range output or the final formatter is stubbed/disconnected.

## Acceptance criteria

- [ ] Repeated exact identities produce one newest/full entry and compact older turn/code references, while different arguments remain separate identities.
  - Run: `npm --prefix extensions/accordion/app test -- src/lib/engine/conductor.my-customize-conductor.test.ts src/lib/engine/conductor.compaction-naive.test.ts ../extension/chunked-compaction-invariant.test.ts ../extension/accordion.chunkedCompactionJsonl.test.ts`
  - Expected: tests `MCP retrieval index defaults to newest exact identity`, `MCP retrieval index compacts older occurrences`, and `different canonical arguments remain separate MCP entries` pass with deterministic ordering.

- [ ] Missing or malformed MCP call metadata retains a generic individually recallable index row.
  - Run: `npm --prefix extensions/accordion/app test -- src/lib/engine/conductor.my-customize-conductor.test.ts src/lib/engine/conductor.compaction-naive.test.ts ../extension/chunked-compaction-invariant.test.ts ../extension/accordion.chunkedCompactionJsonl.test.ts`
  - Expected: `retains a generic MCP recovery row when canonical identity is unavailable` passes and asserts a turn, member code, and no fabricated server/tool value.

- [ ] The completed digest cost controls the minimum-savings decision.
  - Run: `npm --prefix extensions/accordion/app test -- src/lib/engine/conductor.my-customize-conductor.test.ts src/lib/engine/conductor.compaction-naive.test.ts ../extension/chunked-compaction-invariant.test.ts ../extension/accordion.chunkedCompactionJsonl.test.ts`
  - Expected: discriminating test `suppresses rollover when the final MCP index erases minimum savings` passes; its paired control fixture emits when the index is small enough.

- [ ] The issue-02 selected corpus reaches the repeated-index formatter and grouped-member codes remain individually recallable.
  - Run: `npm --prefix extensions/accordion/app test -- src/lib/engine/conductor.compaction-naive.test.ts src/lib/live/plan.test.ts src/lib/live/plan.groups.test.ts`
  - Expected: `indexes repeated MCP occurrences from an oversized safely selected range` passes; emitted membership matches the safe range and recalling each displayed code returns only its referenced original while the group stays folded.

- [ ] Cache, replay, diagnostics, and wire invariants remain satisfied after the complete feature is connected.
  - Run: `npm --prefix extensions/accordion/app test -- src/lib/engine/conductor.my-customize-conductor.test.ts src/lib/engine/conductor.compaction-naive.test.ts ../extension/chunked-compaction-invariant.test.ts ../extension/accordion.chunkedCompactionJsonl.test.ts`
  - Expected: all focused tests pass, deterministic replay remains byte-identical, rollover diagnostics are emitted once per new group, and `count(rollover) == cacheBreaks - coldStarts` remains true in the invariant fixture.

- [ ] The complete changed-feature test and type-check surfaces pass without protocol, persistence, or UI changes.
  - Run: `npm --prefix extensions/accordion/app run check`
  - Expected: svelte-check reports zero errors; the focused Vitest suites in the preceding criteria report zero failed tests.

- [ ] Domain and ADR terms remain aligned with the shipped behavior.
  - Run: `python -c "from pathlib import Path; c=Path('CONTEXT.md').read_text(); a4=Path('docs/adr/0004-accordion-chunked-compaction.md').read_text(); a5=Path('docs/adr/0005-turn-aligned-chunked-compaction-and-mcp-retrieval.md').read_text(); assert all(x in c for x in ('## Complete Accordion Turn','## MCP Retrieval Index','## Canonical MCP Identity')); assert 'status: superseded by ADR-0005' in a4; assert 'status: accepted' in a5"`
  - Expected: exit code 0, proving ADR-0004 remains superseded by accepted ADR-0005 and all three canonical glossary headings remain present.

## Blocked by

- `02-oversized-turn-safe-boundaries.md`
