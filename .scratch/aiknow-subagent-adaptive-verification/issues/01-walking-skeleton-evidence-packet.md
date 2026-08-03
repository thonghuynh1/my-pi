
---
status: closed
---

Status: ready-for-agent

# Walking skeleton: broad aiKnow evidence to structured child verification

## What to build

Deliver the first thin end-to-end Evidence Packet path across `C:/Hackathon/aiKnow/aiKnow` and `C:/my-pi`: a broad `aiknow_search` result emits one valid source-agnostic packet group, the existing `subagent` tool accepts a selected self-contained slice, and a valid packet child receives `report_verification` and returns structured claim outcomes. Ordinary calls remain on their existing path.

Covers US-001, US-003; DEC-001, DEC-003, DEC-004, DEC-013, DEC-014, DEC-015, DEC-021; RB-001, RB-002, RB-004, RB-005, RB-006, RB-011, RB-016, RB-018.

## Implementation map

- Canonical consumer contract owner: new `C:/my-pi/extensions/lib/evidence-packet.ts`, exporting `EvidencePacketV1`, verification result types, and strict runtime validation.
- Outer `SubagentParams` TypeBox field in `extensions/subagents.ts` must be permissive enough for later explicit fallback; omission must not alter resolved arguments.
- Add canonical fixture at `extensions/__tests__/fixtures/evidence-packet-v1.json`. Copy the same bytes into aiKnow test fixtures; no package/runtime/filesystem coupling.
- Producer: new aiKnow `integrations/pi/aiknow/evidence-packet.ts`, built from `FilePointer` output in `response-compressor.ts`. Attach full packet only after `adaptSearchDetailsForPi`; compact content includes packet/group/claim IDs, claim summaries, shape, and concrete path/line/symbol anchors.
- Runtime: in `runSubagent`/`createChildSession`, valid packets build a self-contained prompt and inject SDK `report_verification` through `customTools`; preserve `resourceLoaderOptions: { noExtensions: true }`. Ordinary children receive no custom completion tool.
- Report schema requires each owned claim once as confirmed/contradicted/unresolved; confirmed/contradicted require explanation and native path/line/symbol evidence. Leads carry summary, materiality, and anchors.
- This issue owns the PRD walking-skeleton implementation. Runtime lifecycle proof requiring a real child is intentionally assigned to HITL issue `06-runtime-smoke-and-benchmark-handoff.md` per DEC-018.

## Acceptance criteria

- [ ] The consumer accepts the canonical v1 fixture and rejects missing required fields, duplicate claim IDs, and unsupported versions.
  - Run: `npx tsx extensions/__tests__/evidence-packet.test.ts` (cwd `C:/my-pi`)
  - Test: planned `canonical fixture and invalid variants`
  - Expected: all cases pass; only the valid v1 fixture returns an accepted selected slice.
  - Fails when: validation is absent, partial, or producer-specific.
- [ ] A broad aiKnow adapter scenario emits compact routing content and an identical full packet in post-adaptation details.
  - Run: `npx vitest run src/test/pi-aiknow-broad-packet.test.ts` (cwd `C:/Hackathon/aiKnow/aiKnow`)
  - Test: planned `broad search emits canonical packet through registered aiknow_search wiring`
  - Expected: content contains IDs/shape/anchors; details equal the canonical fixture; an `aiknow_read`-shaped path is unchanged by recursive detail rewriting.
  - Fails when: packet construction is stubbed, details are attached before adaptation, or a second tool is required.
- [ ] Packet completion validation accounts for every owned claim exactly once and rejects resolved outcomes without native evidence.
  - Run: `npx tsx extensions/__tests__/evidence-packet.test.ts` (cwd `C:/my-pi`)
  - Test: planned `verification report completeness and evidence rules`
  - Expected: all three statuses validate; duplicates, omissions, and evidence-free resolved claims fail.
  - Fails when: prose parsing or loose result validation is used.
- [ ] Ordinary child argument preparation is unchanged when `evidencePacket` is omitted, and only valid packet mode constructs the completion-tool definition.
  - Run: `npx tsx extensions/__tests__/subagents-compat.test.ts` (cwd `C:/my-pi`)
  - Test: planned `no-packet boundary and packet tool gating`
  - Expected: no-packet resolved config/prompt/tool names match baseline; valid packet mode includes only one extra `report_verification` custom tool and retains `noExtensions: true`.
  - Fails when: aiKnow is imported by Subagents, ordinary children gain a tool, or extension isolation changes.

## Blocked by

None - can start immediately.
