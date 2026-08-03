Status: ready-for-agent

# Graph-grouped aiKnow packet candidates and delivery controls

## What to build

Expand the walking-skeleton producer into deterministic broad/hybrid packet candidates with objective group shape, graph-first grouping, path-family fallback, and explicit inclusion controls. The producer describes verification breadth but never selects or dispatches Subagents.

Covers US-002; DEC-008, DEC-009, DEC-010, DEC-012; RB-003, RB-007, RB-008, RB-017, RB-018.

## Implementation map

- Extend issue 01 producer in `integrations/pi/aiknow/evidence-packet.ts`; add `integrations/pi/aiknow/claim-grouper.ts`.
- In `integrations/pi/aiknow/index.ts`, add `verificationPacket?: boolean`: omitted auto-includes for broad/hybrid, `true` forces inclusion, `false` suppresses it.
- When packet generation is active, internally request sufficient `includeDetails` data without exposing verbose details in model content.
- Enrich candidate/relationship endpoint identity in `src/interfaces/http/http-tools.ts` enough to map caller/callee/shared-symbol edges. Existing six-edge cap remains; fallback is mandatory.
- Connected anchors (caller/callee/shared symbol/same claim) form cohesive groups. Disconnected small groups may merge only when deterministic top-level/repository path family overlaps. Independent groups share neither graph nor path family.
- Emit stable claim/group IDs, distinct file/anchor counts, subsystem, and `crossFileFlow`; cross-group anchors are references, never duplicate ownership.
- Consumer output from `01-walking-skeleton-evidence-packet.md`: canonical fixture and producer schema. This issue consumes it in `buildEvidencePacket` and owns richer producer wiring through registered `aiknow_search`.

## Acceptance criteria

- [ ] Graph-connected anchors group together while graph/path-disconnected subsystems remain independent with one claim owner.
  - Run: `npx vitest run src/test/pi-claim-grouper.test.ts` (cwd `C:/Hackathon/aiKnow/aiKnow`)
  - Test: planned `graph connectivity and independent subsystem partition`
  - Expected: caller/callee/shared-symbol fixtures form one group; unrelated path families form separate groups; no claim ID appears twice.
  - Fails when: grouping is directory-only, one-child-per-claim, or duplicates ownership.
- [ ] Missing or capped relationship edges use deterministic path-family fallback.
  - Run: `npx vitest run src/test/pi-claim-grouper.test.ts` (cwd `C:/Hackathon/aiKnow/aiKnow`)
  - Test: planned `path fallback with incomplete graph`
  - Expected: repeated runs produce identical IDs/groups and merge only matching path families.
  - Fails when: absent edges collapse all groups, fragment every claim, or produce unstable ordering.
- [ ] Inclusion semantics distinguish all three override branches.
  - Run: `npx vitest run src/test/pi-aiknow-broad-packet.test.ts` (cwd `C:/Hackathon/aiKnow/aiKnow`)
  - Test: planned `automatic forced and suppressed packet delivery`
  - Expected: omitted includes broad/hybrid but not narrow; true includes narrow; false omits broad; no second tool call occurs.
  - Fails when: packets appear on every search, are details-only, or override is ignored.
- [ ] Packet generation hydrates relationship details internally and emits objective shape through real registered adapter wiring.
  - Run: `npx vitest run src/test/pi-aiknow-broad-packet.test.ts src/test/pi-claim-grouper.test.ts` (cwd `C:/Hackathon/aiKnow/aiKnow`)
  - Test: planned `registered search consumes enriched relationship identities`
  - Expected: fixture with `includeDetails` absent still yields correct fileCount, anchorCount, subsystem, and crossFileFlow; producer output contains no execution strategy.
  - Fails when: relationship enrichment is disconnected or aiKnow mandates child count/dispatch.

## Blocked by

- Local: `01-walking-skeleton-evidence-packet.md`
  - Provides canonical packet/fixture and `buildEvidencePacket` seam.
  - This issue wires enriched HTTP match/relationship inputs into that producer and proves the registered adapter emits grouped output.
