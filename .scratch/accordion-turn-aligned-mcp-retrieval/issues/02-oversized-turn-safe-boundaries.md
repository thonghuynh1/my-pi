Status: ready-for-agent
Type: AFK

# Add safe compaction fallback for oversized complete turns

## Parent

`.scratch/accordion-turn-aligned-mcp-retrieval/PRD.md`

## What to build

Extend complete-turn compaction so one pathological turn cannot consume the usable context indefinitely. When a Complete Accordion Turn exceeds bounded Protected Tail overflow, select the newest structurally safe within-turn cut; never split a provider message or tool-call/tool-result pair. Keep an indivisible oversized provider message intact.

Covers `US-002`, `DEC-006`, `RB-002`, `RB-004`, `RB-005`, `RB-014`–`RB-016`, and completes the boundary aspects of `DEC-001`/`US-001`.

## Implementation map

### Producer output consumed from issue 01

- Producer: `01-complete-turn-mcp-recall-skeleton.md`.
- Exact output: `extensions/accordion/conductors/my-customize-conductor/chunked-compaction.ts::selectCompactionRange`, returning a contiguous `SafeCompactionRange { fromIndex, toIndexExclusive, oversizedTurnSplit }` for normal complete turns.
- Consumer: `my-customize-conductor.ts::MyCustomizeConductor.conduct` uses that range to build the exact member corpus for digest and `GroupCommand.ids`.
- Crossing contract: all normal ranges are complete-turn aligned, hard-barrier safe, contiguous, and end before the Protected Tail.

### Oversized fallback

- Extend the selector rather than adding a second competing boundary mechanism.
- A turn is oversized when preserving it whole would exceed the existing bounded overflow policy (`preGroupTokens * PRE_GROUP_OVERFLOW_CAP`) for the selected tail/pre-group objective.
- Search for the newest cut that meets all conditions:
  1. the cut is between provider messages;
  2. no blocks sharing one `messageKey` lie on both sides;
  3. no `callId` has a call/result half on each side;
  4. the older side remains a contiguous group candidate with at least two IDs after existing safety trimming;
  5. held, existing-group, and proactively-compressed barriers are not crossed.
- Keep the suffix from the safe cut forward raw in the Protected Tail. Set `oversizedTurnSplit: true` for diagnostics/tests; no new protocol field is required.
- If one provider message is itself larger than the overflow allowance, keep it intact. Token targets are not permission to split it.
- Retain `trimOpenToolPairs` and host `snappedRange/createGroup` as defense in depth, but the selector must make the intended range valid before emission.
- Preserve the null/<128k context-window gate and existing non-chunked pressure folding.

### Blocking-edge wiring proof

Add an applied-store test using the issue-01 selector through `MyCustomizeConductor.conduct`, not a helper-only test. The fixture must contain one oversized turn with at least two balanced tool sub-chains and a cut candidate between them. It must fail if the conductor ignores the selector output: the host would snap/reject or the expected protected suffix would be grouped.

Nearby anchors: `chunked-compaction.ts::computePreGroupFromIndex`, `noOpenToolPairAcrossPreGroupTail`, `trimOpenToolPairs`; `store.svelte.ts::snappedRange/createGroup`; `conductor.compaction-naive.test.ts` open-pair and pair-balance property cases (`GROUND-001`, `GROUND-002`).

## Acceptance criteria

- [ ] An oversized turn splits at the newest safe provider-message and balanced-call boundary, and the real conductor consumes that range.
  - Run: `npm --prefix extensions/accordion/app test -- src/lib/engine/conductor.compaction-naive.test.ts src/lib/engine/store.groups.test.ts`
  - Expected: `splits an oversized turn at the newest safe sub-chain boundary through MyCustomizeConductor` passes; the applied group contains the older sub-chain, the newer sub-chain remains raw, and no clamp report is emitted.

- [ ] No safe cut splits a shared `messageKey` or an open `callId` pair.
  - Run: `npm --prefix extensions/accordion/app test -- src/lib/engine/conductor.compaction-naive.test.ts src/lib/engine/store.groups.test.ts`
  - Expected: table test `rejects oversized-turn cuts across messages tool pairs and hard barriers` passes for every fixture; the extended balanced-boundary property test reports at least one emitted group and zero invalid cuts.

- [ ] One indivisible oversized provider message remains intact even when it exceeds the token target.
  - Run: `npm --prefix extensions/accordion/app test -- src/lib/engine/conductor.compaction-naive.test.ts src/lib/engine/store.groups.test.ts`
  - Expected: `keeps one indivisible oversized provider message raw` passes and asserts no member of that message appears in `GroupCommand.ids`.

- [ ] Existing context-window gating and deterministic replay remain unchanged.
  - Run: `npm --prefix extensions/accordion/app test -- src/lib/engine/conductor.compaction-naive.test.ts src/lib/engine/store.groups.test.ts`
  - Expected: existing tests `chunked-compaction is inert below the context-window gate` and `chunked-compaction digest is byte-identical on replay` pass with the new oversized cases.

- [ ] The producer selector is connected to the conductor rather than duplicated or stubbed.
  - Run: `npm --prefix extensions/accordion/app test -- src/lib/engine/conductor.compaction-naive.test.ts src/lib/engine/store.groups.test.ts`
  - Expected: the applied-store oversized fixture asserts `oversizedTurnSplit === true` through observable selected membership and fails if `MyCustomizeConductor.conduct` reverts to the old block slice.

## Blocked by

- `01-complete-turn-mcp-recall-skeleton.md`
