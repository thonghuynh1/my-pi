Status: ready-for-agent

# Deterministic adaptive routing and bounded reconciliation policy

## What to build

Implement pure generic policy modules that classify packet groups as direct, single-child, parallel-child, skip, or unresolved reporting, preserve one-owner coverage, and permit at most one material follow-up. Expose configurable defaults through existing Subagent settings layering.

Covers US-002; DEC-005, DEC-006, DEC-007, DEC-008, DEC-010, DEC-011; RB-005, RB-007, RB-008, RB-013, RB-015, RB-019.

## Implementation map

- Add `extensions/lib/routing-policy.ts` and `extensions/lib/reconciliation.ts` in `C:/my-pi`.
- Consume the `EvidencePacketV1`/shape types from issue 01; no aiKnow imports.
- Defaults: direct iff `fileCount <= 3`, `anchorCount <= 6`, and no cross-file flow. A cohesive group beyond any boundary is single-child. At least two independent child-qualified groups may be parallel. Confirmed groups skip. Child counts are never filled as quotas.
- Reconciliation terminal states: original claims confirmed/contradicted/unresolved; leads covered/irrelevant/assigned once. Only material unresolved claims/relevant leads may enter one follow-up batch; after follow-up, gaps remain unresolved.
- Limits default/cap at 16 turns, 30 calls, 300s; packet values may lower only. Global/project config may deliberately change caps/thresholds through `resolveRunConfig`'s existing package → user → project precedence.
- Issue 01 provides canonical shape/types. This issue's policy output is consumed by parent guidance/telemetry in issue 05; it does not auto-dispatch.

## Acceptance criteria

- [ ] Routing discriminates direct, single-child, parallel, and skip branches at exact boundaries.
  - Run: `npx tsx extensions/__tests__/routing-policy.test.ts` (cwd `C:/my-pi`)
  - Test: planned `adaptive route matrix`
  - Expected: 3 files/6 anchors/no flow is direct; either threshold exceeded or flow true is one child; two independent qualifying groups are parallel; confirmed group is skip.
  - Fails when: boundaries are off, related groups fan out, or child count is treated as a quota.
- [ ] Config precedence and packet lowering produce deterministic effective thresholds/caps.
  - Run: `npx tsx extensions/__tests__/routing-policy.test.ts` (cwd `C:/my-pi`)
  - Test: planned `configuration precedence and limit clamping`
  - Expected: project overrides user overrides package; packet 8/12/120 lowers defaults; packet 17/31/301 clamps to configured caps.
  - Fails when: packet raises a cap or existing layering is bypassed.
- [ ] Original claims and leads have exactly one terminal owner/state.
  - Run: `npx tsx extensions/__tests__/reconciliation.test.ts` (cwd `C:/my-pi`)
  - Test: planned `claim and lead ownership reconciliation`
  - Expected: duplicates are rejected; every claim ends in one verification state and every lead in covered/irrelevant/assigned-once.
  - Fails when: ownership overlaps or an item disappears.
- [ ] Follow-up selection permits one material batch and never recurses.
  - Run: `npx tsx extensions/__tests__/reconciliation.test.ts` (cwd `C:/my-pi`)
  - Test: planned `single material follow-up`
  - Expected: normal/irrelevant items do not qualify; material unresolved items qualify before follow-up; all remaining items become report-unresolved afterward.
  - Fails when: no material escape exists or a second automatic follow-up is possible.

## Blocked by

- Local: `01-walking-skeleton-evidence-packet.md`
  - Provides `EvidencePacketV1`, claim IDs, shape, limits, and verification outcomes.
  - This issue consumes those types in pure policy functions; tests import the real canonical validator/types rather than duplicate stubs.
