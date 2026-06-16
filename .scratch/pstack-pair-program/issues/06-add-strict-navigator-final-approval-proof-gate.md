---
status: ready-for-agent
---

# Add strict Navigator final approval proof gate

Status: ready-for-agent

## Parent

- [PRD](../PRD.md)

## What to build

Make `final_approve` hard. Navigator final approval must include a bullet-by-bullet proof map, cite compatible successful telemetry for each acceptance criterion, perform independent verification, block unproven criteria with a per-bullet gap report, and persist non-blocking follow-ups when the pinned end goal is proven.

Decision IDs: `DEC-017`, `DEC-018`, `DEC-019`, `DEC-020`, `DEC-021`, `DEC-022`, `DEC-026`, `DEC-027`.

User stories covered: 8, 9, 10, 11, 18.

## Implementation map

### Area: Final Approval, Proof Mapping, and Follow-ups

- **Decision IDs**: `DEC-017`, `DEC-018`, `DEC-019`, `DEC-020`, `DEC-021`, `DEC-022`, `DEC-026`, `DEC-027`
- **Current code anchors**:
  - `extensions/lib/pair-protocol.ts` `statusFromNavigatorDecision`
  - `extensions/lib/pair-protocol.ts` `buildNavigatorReviewPrompt`
  - `extensions/lib/pair-protocol.ts` final verification branch inside `runPairProtocolDryRun`
- **Existing behavior**: `final_approve` maps to success. Optional final verification runs one `testCommand` if present. There is no bullet-by-bullet proof map or Navigator independent verification requirement.
- **Required edits**:
  - Add final review sections requiring acceptance proof map, independent verification summary, and follow-up list.
  - For each acceptance criterion, require compatible successful telemetry proof or mark the criterion unmet. Unmet criteria block final approval.
  - Allow one telemetry item to prove multiple criteria when explicitly referenced under each criterion.
  - Produce blocked final approval with per-bullet gap report including missing proof, attempted verification, and recommended next action.
  - Persist coordinator-owned follow-ups when final approval succeeds with non-blocking discoveries.
- **Snippet(s)**:

```ts
// current code anchor. Existing final_approve success path is too shallow for the accepted workflow.
export function statusFromNavigatorDecision(decision: NavigatorDecisionValue): PairRuntimeStatus | null {
  switch (decision) {
  case "blocked":
    return "blocked";
  case "final_approve":
    return "success";
  case "approve_next":
  case "request_revision":
    return null;
  }
}
```

```ts
// decision artifact. Normative proof matrix.
type AcceptanceCriterionClass = "structural" | "runtime" | "mixed";

interface AcceptanceCriterion {
  id: string;
  text: string;
  proofClass: AcceptanceCriterionClass;
}

interface AcceptanceProof {
  criterionId: string;
  telemetryIds: string[];
  status: "proven" | "unmet";
  gapReason?: string;
}
```

- **Tests to extend**:
  - Final approval accepted only with per-bullet compatible proof.
  - Runtime criterion rejects read/search-only proof.
  - Structural criterion accepts read/search proof.
  - Mixed criterion requires both structural and runtime proof.
  - Failed telemetry cannot prove success.
  - Invalid telemetry references trigger one repair and then block.
  - Follow-ups persist on successful final approval.
- **Wiring/build notes**:
  - Remove current `testCommand`-driven final verification path. Verification should come from Navigator telemetry and proof map.

### Area: Markdown Output Parsing and Validation

- **Decision IDs**: `DEC-004`, `DEC-012`, `DEC-018`, `DEC-020`, `DEC-022`, `DEC-023`, `DEC-025`, `DEC-026`
- **Current code anchors**:
  - `extensions/lib/pair-protocol.ts` `parseNavigatorDecision`
  - `extensions/lib/pair-protocol.ts` `extractHeadingBody`
  - `extensions/lib/pair-protocol.ts` `buildNavigatorDecisionRepairPrompt`
- **Required edits for this slice**:
  - Final review validation is stricter than intermediate review validation.
  - `final_approve` requires per-acceptance-bullet proof map, telemetry ID references, and independent verification summary.
  - `blocked` final review requires per-bullet gap report when acceptance criteria are unproven.
  - Invalid telemetry references trigger one Navigator repair pass, then block.

### Area: Role Sessions and Telemetry Capture

- **Decision IDs**: `DEC-003`, `DEC-014`, `DEC-015`, `DEC-016`, `DEC-017`
- **Required edits for this slice**:
  - Use sanitized telemetry summaries and exposed IDs to validate final proof maps.
  - Failed telemetry can appear only in gap reports, not successful proof.

### Area: Pair Protocol State Machine

- **Decision IDs**: `DEC-004`, `DEC-005`, `DEC-008`, `DEC-010`, `DEC-011`, `DEC-012`, `DEC-023`, `DEC-027`
- **Required edits for this slice**:
  - Persist coordinator-owned non-blocking follow-ups on successful final approval.
  - Persist blocked final approval gap reports in transcript/result details.
  - Remove or bypass `testCommand` final verification path.

### Area: Prompt Files and Renderer

- **Decision IDs**: `DEC-024`, `DEC-025`, `DEC-026`
- **Required edits for this slice**:
  - Render Navigator review prompt with acceptance checklist, proof classes, relevant telemetry summaries, and final approval decision contract.
  - Make clear that `approve_next` may be lightweight but `final_approve` requires proof mapping.

## Acceptance criteria

- [ ] Navigator final review prompt requires proof map, independent verification summary, and follow-up list.
- [ ] `final_approve` is invalid unless every acceptance criterion is `proven` with compatible successful telemetry.
- [ ] Structural criteria accept `file_read` or `search` proof.
- [ ] Runtime criteria require `command` or `artifact_inspection` proof.
- [ ] Mixed criteria require both structural and runtime proof.
- [ ] One telemetry item may prove multiple criteria only when explicitly referenced under each criterion.
- [ ] Failed telemetry cannot prove success but can support blocked gap reports.
- [ ] Unknown, missing, wrong-role, failed, or proof-class-incompatible telemetry references trigger one repair pass and then block if still invalid.
- [ ] Blocked final approval includes per-bullet gap report with missing proof, attempted verification, and recommended next action.
- [ ] Successful final approval persists non-blocking follow-ups in coordinator-owned run state/result details.
- [ ] Current top-level `testCommand` final verification path is removed or no longer used.
- [ ] Tests cover proof matrix, invalid-reference repair, blocked gap reports, and follow-up persistence.
- [ ] Runtime evidence captured: run the new final approval/proof-map tests and `npm run check`, and include passing output in the implementation summary.

## Blocked by

- [02-add-markdown-prompt-renderer-and-structured-output-parser.md](02-add-markdown-prompt-renderer-and-structured-output-parser.md)
- [03-build-file-backed-preflight-and-canonical-pair-run-state.md](03-build-file-backed-preflight-and-canonical-pair-run-state.md)
- [04-capture-role-telemetry-with-sanitized-proof-ids.md](04-capture-role-telemetry-with-sanitized-proof-ids.md)
- [05-enforce-driver-pstack-startup-and-playbook-lifecycle.md](05-enforce-driver-pstack-startup-and-playbook-lifecycle.md)
