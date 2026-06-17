---
status: closed
---

# Enforce Driver pstack startup and playbook lifecycle

Status: ready-for-agent

## Parent

- [PRD](../PRD.md)

## What to build

Enforce the Driver's `poteto-mode` startup ritual and playbook lifecycle. The Driver must accept the Navigator's initial playbook recommendation by default, may use one evidence-tied first-turn override, and can only switch later through a blocker/contradiction amendment. The coordinator must validate declared playbooks/leaves against the pstack registry and role telemetry.

Decision IDs: `DEC-011`, `DEC-012`, `DEC-013`, `DEC-023`.

User stories covered: 1, 2, 17, 19.

## Implementation map

### Area: Pair Protocol State Machine

- **Decision IDs**: `DEC-004`, `DEC-005`, `DEC-008`, `DEC-010`, `DEC-011`, `DEC-012`, `DEC-023`, `DEC-027`
- **Current code anchors**:
  - `extensions/lib/pair-protocol.ts` `PairRunMemory`
  - `extensions/lib/pair-protocol.ts` `runPairProtocolDryRun`
  - `extensions/lib/pair-protocol.ts` `PairProtocolResult`
  - `extensions/lib/pair-protocol.ts` `PairCycleRecord`
- **Existing behavior**: `PairRunMemory` is compact and TDD-specific. The first Driver prompt is just a normal TDD cycle prompt. There is no Driver startup gate.
- **Required edits for this slice**:
  - Add `driverStartupCompleted` handling.
  - Until startup validates, use the Driver first-turn prompt rather than normal cycle prompt.
  - Record `activePlaybook`, loaded leaves, skipped playbook steps, and override/amendment state.
  - Enforce one normal playbook override with explicit evidence. Later switches require contradiction/blocker amendment.
  - Add one repair pass for malformed Driver startup.
- **Snippet(s)**:

```ts
// decision artifact. Startup state lives in the coordinator-owned run state.
interface PairRunState {
  initialPlaybookRecommendation: string;
  activePlaybook: string;
  playbookOverrideReason?: string;
  loadedLeaves: LoadedLeaf[];
  skippedPlaybookSteps: SkippedStep[];
  driverStartupCompleted: boolean;
  allowedAmendments: Amendment[];
}
```

### Area: Pstack Registry and Skill-load Validation

- **Decision IDs**: `DEC-011`, `DEC-012`, `DEC-013`, `DEC-015`
- **Current code anchors**:
  - `extensions/lib/pair-program-helpers.ts` `verifySkillTddAvailable`
  - MCP tool metadata for `engineering_skills_skill-pstack` lists available Skills and Playbooks.
- **Existing behavior**: There is no pstack registry snapshot and no leaf/playbook validation.
- **Required edits for this slice**:
  - Validate Driver-selected playbook slugs against the run-start registry snapshot.
  - Validate Driver-declared loaded leaves against the registry.
  - Cross-check loaded leaves against Driver telemetry when telemetry is available.
  - Mark Markdown-only loaded-leaf claims as unverified if telemetry cannot prove them.
- **Snippet(s)**:

```ts
// current code anchor. Existing helper shape can inspire registry verification, but TDD-specific names must go.
const SKILL_TDD_PATTERNS = [/skill[-_]tdd/i];
```

### Area: Markdown Output Parsing and Validation

- **Decision IDs**: `DEC-004`, `DEC-012`, `DEC-018`, `DEC-020`, `DEC-022`, `DEC-023`, `DEC-025`, `DEC-026`
- **Required edits for this slice**:
  - Validate Driver first-turn required sections.
  - Required sections should include startup todo list, principles read, selected playbook, playbook steps, loaded leaves, skipped steps, and override packet when applicable.
  - Validate canonical playbook and leaf slugs.

### Area: Prompt Files and Renderer

- **Decision IDs**: `DEC-024`, `DEC-025`, `DEC-026`
- **Required edits for this slice**:
  - Render `driver-first-turn.md` with pstack startup ritual instructions, preflight end goal, initial playbook recommendation, registry summary, task packet, and required structured headings.
  - Render normal Driver cycle only after `driverStartupCompleted` is true.

### Area: Role Sessions and Telemetry Capture

- **Decision IDs**: `DEC-003`, `DEC-014`, `DEC-015`, `DEC-016`, `DEC-017`
- **Required edits for this slice**:
  - Use Driver telemetry to confirm `poteto-mode` and routed leaves were actually loaded when possible.

## Acceptance criteria

- [ ] The first Driver working turn uses `driver-first-turn.md` until startup validation passes.
- [ ] `driverStartupCompleted` remains false until the startup ritual validates.
- [ ] Driver startup requires structured sections for todo list, principles read, selected playbook, playbook steps, loaded leaves, skipped steps, and override packet when relevant.
- [ ] Driver accepts Navigator's initial playbook by default.
- [ ] One first-turn playbook override is allowed only with recommended playbook, chosen replacement, repo/task evidence, and pinned-goal rationale.
- [ ] Later playbook switches require blocker/contradiction amendment.
- [ ] Playbook and leaf slugs validate against the run-start pstack registry snapshot.
- [ ] Loaded-leaf claims are cross-checked against Driver telemetry when available.
- [ ] Malformed Driver startup gets one repair pass and then blocks/fails if still invalid.
- [ ] Tests cover startup validation, repair, playbook override policy, switch amendment policy, and registry/telemetry cross-checking.
- [ ] Runtime evidence captured: run the new Driver startup/playbook lifecycle tests and `npm run check`, and include passing output in the implementation summary.

## Blocked by

- [01-replace-tdd-contract-with-pstack-registry-gate.md](01-replace-tdd-contract-with-pstack-registry-gate.md)
- [02-add-markdown-prompt-renderer-and-structured-output-parser.md](02-add-markdown-prompt-renderer-and-structured-output-parser.md)
- [03-build-file-backed-preflight-and-canonical-pair-run-state.md](03-build-file-backed-preflight-and-canonical-pair-run-state.md)
- [04-capture-role-telemetry-with-sanitized-proof-ids.md](04-capture-role-telemetry-with-sanitized-proof-ids.md)
