---
status: closed
---

# Build file-backed preflight and canonical Pair Run State

Status: ready-for-agent

## Parent

- [PRD](../PRD.md)

## What to build

Make Navigator preflight produce the canonical run contract. For file-backed tasks, read the referenced file, extract acceptance criteria plus explicit constraints/build notes, provide both the extracted packet and raw file path to the roles, and freeze the Navigator's preflight into coordinator-owned Pair Run State.

Decision IDs: `DEC-004`, `DEC-005`, `DEC-006`, `DEC-007`, `DEC-008`, `DEC-009`, `DEC-010`, `DEC-018`.

User stories covered: 3, 4, 5, 6, 12.

## Implementation map

### Area: File-backed Task Extraction

- **Decision IDs**: `DEC-006`, `DEC-007`, `DEC-008`, `DEC-009`
- **Current code anchors**:
  - No existing pair-specific file extraction module found.
  - `extensions/pair-program.ts` already receives `task` and `ctx.cwd` in `execute`.
- **Existing behavior**: Task text is passed directly into the protocol. Referenced issue/spec files are not read or summarized by the coordinator.
- **Required edits**:
  - Detect explicit file URLs and file paths in task text. The user expects that when they provide a file, agents can read it.
  - Read referenced file at run start.
  - Extract `## Acceptance criteria` plus explicit constraints/build notes/blocked-by when present.
  - Pass both extracted packet and raw file path into Navigator preflight and Driver prompts.
  - For issue-file-driven tasks, require `End Goal To Prove` to copy acceptance criteria verbatim.
- **Snippet(s)**:

```ts
// decision artifact. Normative extracted packet shape.
interface IssueTaskPacket {
  sourcePath: string;
  acceptanceCriteria: string;
  explicitConstraints: string[];
  buildOrWiringNotes: string[];
  blockedBy?: string;
}
```

- **Tests to extend**:
  - Parser tests using a fixture modeled after `.scratch/force-kill-undo/issues/09-persist-panic-undo-tracker-state-and-terminal-reasons.md`.
  - File URL and Windows path detection tests.
  - Preflight blocking test for vague plain-text tasks with no concrete end goal.
- **Wiring/build notes**:
  - This module should be pure file/text parsing plus a thin filesystem boundary.

### Area: Pair Protocol State Machine

- **Decision IDs**: `DEC-004`, `DEC-005`, `DEC-008`, `DEC-010`, `DEC-011`, `DEC-012`, `DEC-023`, `DEC-027`
- **Current code anchors**:
  - `extensions/lib/pair-protocol.ts` `PairRunMemory`
  - `extensions/lib/pair-protocol.ts` `runPairProtocolDryRun`
  - `extensions/lib/pair-protocol.ts` `PairProtocolResult`
  - `extensions/lib/pair-protocol.ts` `PairCycleRecord`
- **Existing behavior**: `PairRunMemory` is compact and TDD-specific. It stores freeform acceptance text, current objective, reports, and evidence summaries. The protocol has Navigator preflight, Driver cycle, Navigator review, one repair for malformed decision, optional Driver correction, and final verification driven by `testCommand`.
- **Required edits for this slice**:
  - Replace `PairRunMemory` with a protocol-complete `PairRunState` that owns the pinned end goal, acceptance criteria, proof classes, active playbook recommendation, amendments, and file-backed packet.
  - Freeze Navigator preflight into coordinator-owned state.
  - Support narrow amendment records for contradiction, ambiguity, implied missing requirement, and safety/verification gap.
- **Snippet(s)**:

```ts
// current code anchor. Existing state is too TDD/freeform for the accepted protocol.
export interface PairRunMemory {
  task: string;
  acceptedConstraints: string[];
  unresolvedRisks: string[];
  currentCycle: number;
  currentObjective: string | null;
  acceptanceChecklistText: string | null;
  lastDriverReport: string | null;
  lastNavigatorReview: string | null;
  evidenceSummaries: string[];
  initialWorkspace?: WorkspaceSnapshot;
}
```

```ts
// decision artifact. Normative target shape; exact names may be refined during implementation.
interface PairRunState {
  task: string;
  taskFile?: { path: string; extractedPacket: IssueTaskPacket };
  endGoalToProve: string;
  acceptanceChecklist: AcceptanceCriterion[];
  initialPlaybookRecommendation: string;
  activePlaybook: string;
  playbookOverrideReason?: string;
  loadedLeaves: LoadedLeaf[];
  skippedPlaybookSteps: SkippedStep[];
  driverStartupCompleted: boolean;
  allowedAmendments: Amendment[];
  driverEvidence: Evidence[];
  navigatorVerificationTelemetry: PairTelemetrySummary[];
  followUps: FollowUp[];
}
```

- **Tests to extend**:
  - Add pure unit tests for run-state creation from preflight, amendment acceptance/rejection, and preflight blocking for vague tasks.
  - Existing `pair-protocol.ts` pure functions should remain isolated from Pi runtime where possible.
- **Wiring/build notes**:
  - Preserve single-active-run guard from `pair-program-helpers.ts`.
  - Persist final `PairRunState` into JSON transcript for auditability.

### Area: Markdown Output Parsing and Validation

- **Decision IDs**: `DEC-004`, `DEC-012`, `DEC-018`, `DEC-020`, `DEC-022`, `DEC-023`, `DEC-025`, `DEC-026`
- **Required edits for this slice**:
  - Validate Navigator preflight required sections.
  - Validate issue-file end goal copies acceptance criteria verbatim.
  - Validate each acceptance criterion has a proof class of `structural`, `runtime`, or `mixed`.

### Area: Prompt Files and Renderer

- **Decision IDs**: `DEC-024`, `DEC-025`, `DEC-026`
- **Required edits for this slice**:
  - Render preflight prompt with task text, raw file path when present, extracted packet when present, workspace evidence, and required preflight output contract.

## Acceptance criteria

- [ ] Explicit file URLs and file paths in `task` are detected and read at run start.
- [ ] Issue/spec extraction captures acceptance criteria plus explicit constraints/build notes/blocked-by when present.
- [ ] The raw source file path and extracted packet are passed into Navigator preflight.
- [ ] Issue-file-driven `End Goal To Prove` must copy acceptance criteria verbatim.
- [ ] Plain-text tasks without one concrete end goal block during preflight.
- [ ] Pair Run State stores the pinned end goal, acceptance checklist, proof classes, initial playbook recommendation, active playbook, amendments, and task file packet.
- [ ] Multiple acceptance bullets are allowed when they prove one vertical slice.
- [ ] Tests cover file extraction, Windows/file URL path detection, preflight state creation, and vague-task blocking.
- [ ] Runtime evidence captured: run the new extraction/preflight state tests and `npm run check`, and include passing output in the implementation summary.

## Blocked by

- [02-add-markdown-prompt-renderer-and-structured-output-parser.md](02-add-markdown-prompt-renderer-and-structured-output-parser.md)
