# PRD: Pstack-driven Pair Program Tool

Status: ready-for-agent

## Problem Statement

The current Pair Program Tool is shaped around a TDD-only workflow. It defaults to `mode: "tdd"`, rejects every other mode, verifies `skill-tdd`, injects TDD-specific prompts, and lets the Navigator approve too easily from Driver prose. The user wants the tool to behave like real pair programming: the Driver executes using `poteto-mode`, the Navigator frames and verifies the end goal, and final approval is blocked unless the accepted outcome is proven.

## Solution

Replace the TDD-only pair workflow with a pstack-driven pair workflow. `pair_program` remains the tool name, but it no longer exposes `mode` or `testCommand`. The Driver loads `poteto-mode`, follows the selected playbook and leaf skills, and performs implementation. The Navigator remains non-writing and review-only, pins the end goal during preflight, and performs independent verification before final approval.

For file-backed issue/spec tasks, the coordinator reads the referenced file, extracts acceptance criteria and explicit constraints/build notes, and passes both that compact packet and the raw file path to the roles. The acceptance criteria become the verbatim `End Goal To Prove` for issue-file-driven work.

## User Stories

1. As a Pi user, I want `pair_program` to use `poteto-mode`, so that pair runs follow the broader pstack routing model instead of hardcoded TDD.
2. As a Pi user, I want `poteto-mode` to route to TDD only when appropriate, so that bug fixes can still use TDD without making every task TDD-shaped.
3. As a Pi user, I want the Navigator to pin an end goal before implementation starts, so that the Driver and reviewer share one finish line.
4. As a Pi user, I want issue-file acceptance criteria to become the end goal, so that implementation proves the ticket rather than a vague summary.
5. As a Pi user, I want multiple acceptance bullets to be allowed for one vertical slice, so that normal issue files do not get rejected for having a checklist.
6. As a Pi user, I want broad tasks with multiple independently shippable outcomes to fail fast, so that one pair run stays focused.
7. As a Pi user, I want the Navigator to be review-only, so that it does not redirect or co-implement the Driver's work.
8. As a Pi user, I want Navigator final approval to require independent verification, so that reviews do not rubber-stamp plausible Driver reports.
9. As a Pi user, I want every acceptance criterion accounted for, so that final approval means the end goal was actually proven.
10. As a Pi user, I want blocked final approvals to explain the exact missing proof, so that the next action is obvious.
11. As a Pi user, I want non-blocking discoveries preserved as follow-ups, so that useful findings are not lost while completed work can still pass.
12. As a Pi maintainer, I want coordinator-owned run state, so that roles cannot silently redefine the goal, playbook, or proof requirements.
13. As a Pi maintainer, I want child-session tool telemetry recorded, so that skill loads and verification actions are auditable.
14. As a Pi maintainer, I want telemetry summaries sanitized, so that run state remains safe and readable.
15. As a Pi maintainer, I want extracted markdown prompts, so that role and phase protocols are readable without editing TypeScript strings.
16. As a Pi maintainer, I want deterministic output validation with one repair pass, so that formatting mistakes are recoverable but protocol drift blocks.
17. As a Pi maintainer, I want pstack playbook and leaf names validated from MCP metadata, so that the pair tool stays aligned with `engineering-skills`.
18. As a Navigator Agent, I want a strict final proof map, so that each acceptance bullet has explicit evidence.
19. As a Driver Agent, I want a clear startup ritual, so that `poteto-mode` routing and playbook selection happen before implementation.
20. As an implementation agent, I want self-contained area blocks in this PRD, so that downstream issues can be generated without rereading the grill conversation.

## Accepted Decision Register

- `DEC-001`
  - Decision: `pair_program` becomes a single pstack-driven workflow. Remove `mode` and `testCommand`.
  - Lens: strategy
  - Rationale: `poteto-mode` already routes to `tdd` when needed. Keeping TDD as the top-level mode preserves the wrong mental model.
  - Rejected alternatives: Keep `mode`; keep compatibility aliases; keep `testCommand` as a top-level contract.
  - Downstream impact: Update parameter schema, normalizer, tests, tool descriptions, transcript model, and protocol prompts.

- `DEC-002`
  - Decision: Keep the public tool name `pair_program`, but rewrite descriptions and slash-command help around pstack-driven pair programming.
  - Lens: scope
  - Rationale: The concept remains pair programming. Renaming creates avoidable churn.
  - Rejected alternatives: Rename to a pstack-specific tool; keep old TDD wording.
  - Downstream impact: Update `extensions/pair-program.ts` tool metadata and command text.

- `DEC-003`
  - Decision: Driver is the only writing role. Navigator is review-only and non-writing.
  - Lens: contract
  - Rationale: This preserves real pair-program role separation and prevents the Navigator from becoming a second implementer.
  - Rejected alternatives: Let both roles load and act on `poteto-mode`; allow Navigator scratch writes.
  - Downstream impact: Keep Navigator tool allowlist read/search/bash only. Validation must reject any Navigator write telemetry if it appears.

- `DEC-004`
  - Decision: Navigator preflight pins `End Goal To Prove`, acceptance checklist, risk classification, initial playbook recommendation, and first cycle objective.
  - Lens: contract
  - Rationale: A real pair needs a shared finish line before implementation starts.
  - Rejected alternatives: Driver owns the goal; coordinator invents the goal; task text alone is the goal.
  - Downstream impact: Add preflight prompt and parser/validator requirements.

- `DEC-005`
  - Decision: Coordinator owns canonical Pair Run State after preflight.
  - Lens: contract
  - Rationale: Navigator can frame the contract, but the coordinator must freeze it so neither role moves the goalposts.
  - Rejected alternatives: Driver-owned report state; Navigator-owned mutable contract.
  - Downstream impact: Replace compact TDD memory with protocol-complete run state.

- `DEC-006`
  - Decision: Issue-file tasks provide both extracted packet and raw file path.
  - Lens: contract
  - Rationale: The packet gives deterministic grounding. The path lets agents inspect the source artifact like real workers.
  - Rejected alternatives: Packet only; raw file only.
  - Downstream impact: Add file reference detection, file read, acceptance/constraints extraction, and prompt payload sections.

- `DEC-007`
  - Decision: For issue-file-driven runs, `End Goal To Prove` copies acceptance criteria verbatim.
  - Lens: testing
  - Rationale: Verbatim criteria avoid accidental reinterpretation of the ticket.
  - Rejected alternatives: Summarize criteria into an outcome sentence; merge summary and checklist.
  - Downstream impact: Preflight validation must allow checklist-shaped end goals for issue files.

- `DEC-008`
  - Decision: Plain-text tasks are allowed only when preflight can pin one concrete end goal. Otherwise fail fast and ask for a file-backed issue/spec or narrower task.
  - Lens: scope
  - Rationale: Vague goals cause weak approvals.
  - Rejected alternatives: Always allow plain text; require files for every run.
  - Downstream impact: Preflight validation can block when no concrete end goal exists.

- `DEC-009`
  - Decision: Multiple acceptance bullets are allowed when they prove one vertical slice. Fail only when the task clearly mixes multiple independently shippable outcomes.
  - Lens: scope
  - Rationale: Normal issue files use several bullets to prove one slice.
  - Rejected alternatives: Reject any multi-bullet issue; let Navigator choose one bullet.
  - Downstream impact: Acceptance checklist can contain many bullets under one end goal.

- `DEC-010`
  - Decision: Amendments are narrow. Navigator may clarify the goal or tighten verification, but may not expand scope or introduce new design direction unless required by contradiction, ambiguity, implied requirement, or safety/verification gap.
  - Lens: runtime
  - Rationale: This keeps Navigator from redirecting the Driver mid-run.
  - Rejected alternatives: Navigator ad hoc amendments; no amendments after preflight.
  - Downstream impact: Add amendment records and validators.

- `DEC-011`
  - Decision: Driver accepts the preflight playbook by default. One normal override is allowed with an evidence-tied override packet. Later switches require blocker/contradiction amendment.
  - Lens: contract
  - Rationale: Preflight should guide execution without making the Driver ignore repo reality.
  - Rejected alternatives: Driver re-decides freely; coordinator locks playbook completely.
  - Downstream impact: Track `initialPlaybookRecommendation`, `activePlaybook`, override count, and override reason.

- `DEC-012`
  - Decision: First Driver turn must complete the `poteto-mode` startup ritual with structured sections and telemetry-backed skill loads.
  - Lens: contract
  - Rationale: The first turn is the strongest enforcement point for pstack routing.
  - Rejected alternatives: Prompt-only ritual; downgrade malformed startup to normal cycle.
  - Downstream impact: Add `driverStartupCompleted` flag and first-turn validation/repair.

- `DEC-013`
  - Decision: MCP `engineering-skills` `skill-pstack` metadata is the canonical playbook/leaf registry. Snapshot once at run start. If unavailable, block.
  - Lens: ops
  - Rationale: The MCP server is the registered skill surface. Hardcoding or file scanning drifts.
  - Rejected alternatives: Hardcoded slugs; local scan as primary; degraded run without registry.
  - Downstream impact: Registry resolver must use tool metadata and freeze it for the run.

- `DEC-014`
  - Decision: Child-session telemetry uses `tool_execution_start` and `tool_execution_end`, correlated by `toolCallId`.
  - Lens: runtime
  - Rationale: This captures both attempted and completed actions and is supported by Pi `AgentSession.subscribe()`.
  - Rejected alternatives: `tool_execution_end` only; `turn_end.toolResults` only.
  - Downstream impact: Extend role session telemetry recording.

- `DEC-015`
  - Decision: Persist sanitized telemetry summaries, not full raw payloads/results.
  - Lens: ops
  - Rationale: Full tool payloads can be large or sensitive. Summaries are enough for proof mapping.
  - Rejected alternatives: Full payloads; counters only.
  - Downstream impact: Add redaction and normalized telemetry kinds.

- `DEC-016`
  - Decision: Store raw `toolCallId` internally but expose coordinator-generated IDs like `driver-c1-t3` and `nav-final-t2`.
  - Lens: contract
  - Rationale: Human-readable IDs make proof maps usable while preserving traceability.
  - Rejected alternatives: Raw IDs only; long verbose IDs only.
  - Downstream impact: Add telemetry ID mapping layer.

- `DEC-017`
  - Decision: Failed telemetry actions can support blocked gap reports but cannot prove successful acceptance criteria.
  - Lens: testing
  - Rationale: Failed attempts are useful diagnostics, not proof.
  - Rejected alternatives: Ignore failed calls entirely; let failed calls prove negative facts.
  - Downstream impact: Proof validator must require successful compatible telemetry for passing criteria.

- `DEC-018`
  - Decision: Navigator preflight classifies each acceptance criterion as `structural`, `runtime`, or `mixed`. Final review may tighten, not loosen, without amendment.
  - Lens: testing
  - Rationale: Proof expectations must be set early but remain able to respond to discovered risk.
  - Rejected alternatives: Classify only at final review; classify once with no tightening.
  - Downstream impact: Add criterion class to checklist state.

- `DEC-019`
  - Decision: Use strict proof matrix: structural needs read/search proof; runtime needs command/artifact proof; mixed needs both.
  - Lens: testing
  - Rationale: This prevents code inspection from proving runtime behavior while allowing structural facts to be proven without redundant commands.
  - Rejected alternatives: Any proof kind can pass any bullet; every bullet requires commands.
  - Downstream impact: Final proof-map validator must check proof-kind compatibility.

- `DEC-020`
  - Decision: `final_approve` requires bullet-by-bullet proof mapping. Unverified acceptance bullets block approval.
  - Lens: testing
  - Rationale: This directly fixes the current rubber-stamp behavior.
  - Rejected alternatives: Shared proof section; Driver proof map only; allow unresolved gaps on acceptance criteria.
  - Downstream impact: Navigator final review prompt and validator must enforce proof maps.

- `DEC-021`
  - Decision: One verification command or artifact can prove multiple acceptance criteria if each criterion explicitly references the telemetry ID.
  - Lens: testing
  - Rationale: This avoids wasteful duplicated commands while preserving auditability.
  - Rejected alternatives: One command per bullet; ad hoc grouping.
  - Downstream impact: Proof map can reference telemetry IDs multiple times.

- `DEC-022`
  - Decision: Invalid proof telemetry references get one Navigator repair pass, then block if still invalid.
  - Lens: runtime
  - Rationale: Strict evidence gates should not fail permanently on one typo.
  - Rejected alternatives: Block immediately; ignore invalid references.
  - Downstream impact: Add final-review repair path.

- `DEC-023`
  - Decision: Every structured phase output gets at most one coordinator repair pass.
  - Lens: runtime
  - Rationale: This balances recoverability with deterministic enforcement.
  - Rejected alternatives: Critical-phase-only repair; unlimited retries; no repairs.
  - Downstream impact: Generalize repair handling beyond current Navigator decision repair.

- `DEC-024`
  - Decision: Extract prompts to shared base plus per-phase markdown files using named insertion markers. Missing required markers fail fast.
  - Lens: contract
  - Rationale: The new protocol is staged and too strict for large inline TypeScript prompts.
  - Rejected alternatives: One file per role; simple string replacement; JSON-only prompts.
  - Downstream impact: Add prompt loader/renderer and prompt files.

- `DEC-025`
  - Decision: Use deterministic markdown heading parsing with canonical heading normalization and section-specific validators.
  - Lens: contract
  - Rationale: Exact heading matching is brittle; LLM parsing is non-deterministic.
  - Rejected alternatives: Non-empty checks only; exact heading text only; LLM-based parsing.
  - Downstream impact: Add markdown section parser and validators.

- `DEC-026`
  - Decision: Final review validation is stricter than intermediate review validation.
  - Lens: testing
  - Rationale: Mid-cycle review can remain fast, while final approval must be hard.
  - Rejected alternatives: Same strictness everywhere; only final review strict.
  - Downstream impact: Branch validators by phase and decision value.

- `DEC-027`
  - Decision: Follow-up discoveries are persisted as coordinator-owned non-blocking follow-ups attached to the run result.
  - Lens: ops
  - Rationale: Findings should survive without expanding the current run scope.
  - Rejected alternatives: Final-review prose only; Driver-owned follow-ups.
  - Downstream impact: Add follow-up list to run state, transcript, and result details.

## Implementation Plan

### Area: Pair Program Tool Public Contract and Entrypoint

- **Decision IDs**: `DEC-001`, `DEC-002`, `DEC-013`
- **Current code anchors**:
  - `extensions/pair-program.ts` `PairProgramParams`
  - `extensions/pair-program.ts` `buildPairProgramToolDef`
  - `extensions/lib/pair-program-helpers.ts` `normalizeParams`
  - `extensions/__tests__/pair-program-params.test.ts`
- **Existing behavior**: The tool schema exposes `mode` and `testCommand`. Runtime rejects non-`tdd` mode and blocks if the engineering-skills MCP server is not configured for TDD.
- **Required edits**:
  - Remove `mode` and `testCommand` from `PairProgramParams`, `PairProgramRawParams`, and `PairProgramNormalizedParams`.
  - Rewrite tool descriptions, `promptSnippet`, prompt guidelines, slash command text, and result summary to say pstack-driven pair programming with Driver execution and review-only Navigator.
  - Replace skill-tdd-specific prerequisite language with an engineering-skills / `skill-pstack` registry prerequisite.
  - Snapshot allowed pstack registry once at run start from MCP tool metadata and block if unavailable.
- **Snippet(s)**:

```ts
// current code anchor. Normative seam to remove TDD-specific public API.
const PairProgramParams = Type.Object({
  task: Type.String({ description: "Task for the Driver/Navigator pair." }),
  mode: Type.Optional(
    StringEnum(["tdd"] as const, {
      description: "Pair workflow mode. MVP supports only tdd.",
    }),
  ),
  maxCycles: Type.Optional(Type.Number({ description: "Maximum Driver/Navigator cycles. Default: 4.", minimum: 1 })),
  testCommand: Type.Optional(Type.String({ description: "Test command to run during TDD red phase." })),
  driverModel: Type.Optional(Type.String({ description: "Model override for the Driver agent." })),
  navigatorModel: Type.Optional(Type.String({ description: "Model override for the Navigator agent." })),
});
```

```ts
// current code anchor. Normative seam to remove unsupported-mode rejection.
if (normalized.mode !== "tdd") {
  const errorResult: PairProgramDetails = {
    status: "error",
    summary: `Unsupported mode "${normalized.mode}". MVP only supports "tdd" mode.`,
    changedFiles: [],
    error: `Unsupported mode: ${normalized.mode}`,
  };
  return { content: [{ type: "text" as const, text: errorResult.summary }], details: errorResult, isError: true };
}
```

- **Tests to extend**:
  - Update `extensions/__tests__/pair-program-params.test.ts` to assert no `mode`, no `testCommand`, no unsupported-mode mapping, and new registry prerequisite behavior.
  - Add unit coverage for MCP pstack registry metadata parsing.
- **Wiring/build notes**:
  - Existing npm check command is `npm run check`.
  - Current pure helper test command is `npx tsx extensions/__tests__/pair-program-params.test.ts`.

### Area: Pair Protocol State Machine

- **Decision IDs**: `DEC-004`, `DEC-005`, `DEC-008`, `DEC-010`, `DEC-011`, `DEC-012`, `DEC-023`, `DEC-027`
- **Current code anchors**:
  - `extensions/lib/pair-protocol.ts` `PairRunMemory`
  - `extensions/lib/pair-protocol.ts` `runPairProtocolDryRun`
  - `extensions/lib/pair-protocol.ts` `PairProtocolResult`
  - `extensions/lib/pair-protocol.ts` `PairCycleRecord`
- **Existing behavior**: `PairRunMemory` is compact and TDD-specific. It stores freeform acceptance text, current objective, reports, and evidence summaries. The protocol has Navigator preflight, Driver cycle, Navigator review, one repair for malformed decision, optional Driver correction, and final verification driven by `testCommand`.
- **Required edits**:
  - Replace `PairRunMemory` with a protocol-complete `PairRunState` that owns the pinned end goal, acceptance criteria, proof classes, active playbook, loaded leaves, amendments, evidence, follow-ups, and telemetry summaries.
  - Add `driverStartupCompleted` and keep using Driver first-turn prompt until startup validates.
  - Add one repair pass for every structured phase output.
  - Add amendment records for goal/playbook changes. Enforce one normal playbook override and later blocker/contradiction-only switches.
  - Remove final verification by top-level `testCommand`. Final proof comes from Navigator verification telemetry and proof map.
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
  - Add pure unit tests for run-state transitions, playbook override policy, amendment acceptance/rejection, startup completion gating, and one-repair behavior.
  - Existing `pair-protocol.ts` pure functions should remain isolated from Pi runtime where possible.
- **Wiring/build notes**:
  - Preserve single-active-run guard from `pair-program-helpers.ts`.
  - Persist final `PairRunState` into JSON transcript for auditability.

### Area: Role Sessions and Telemetry Capture

- **Decision IDs**: `DEC-003`, `DEC-014`, `DEC-015`, `DEC-016`, `DEC-017`
- **Current code anchors**:
  - `extensions/lib/agent-session-utils.ts` `RoleSession`
  - `extensions/lib/agent-session-utils.ts` `DRIVER_TOOLS`, `NAVIGATOR_TOOLS`
  - `extensions/lib/agent-session-utils.ts` `createRoleSession`
  - Pi SDK docs: `AgentSession.subscribe()` exposes `tool_execution_start`, `tool_execution_end`, and `turn_end`.
- **Existing behavior**: Role sessions are persistent child `AgentSession`s. Usage is accumulated from `message_end`. Tool telemetry is not recorded. Driver has write tools; Navigator has read/search/bash only.
- **Required edits**:
  - Extend `RoleSession` with telemetry storage and a per-role/per-phase active context.
  - Subscribe to `tool_execution_start` and `tool_execution_end` inside `createRoleSession` and correlate by `toolCallId`.
  - Normalize telemetry into `skill_load`, `file_read`, `search`, `command`, `file_write`, and `artifact_inspection`.
  - Persist sanitized summaries. Keep raw `toolCallId` internally; expose IDs such as `driver-c1-t3`, `nav-r2-t1`, and `nav-final-t2` in prompts and proof maps.
  - Redact commands and store command previews plus exit code, not full command strings.
  - Treat failed telemetry as attempt evidence only.
- **Snippet(s)**:

```ts
// current code anchor. Existing subscription proves child sessions can gather telemetry.
created.session.subscribe((event) => {
  if (event.type === "message_end") {
    const message = event.message as Message;
    roleSession.usage = accumulateUsage(roleSession.usage, message);
  }
});
```

```ts
// current code anchor. Navigator already has no write tools. Preserve this boundary.
export const DRIVER_TOOLS: readonly string[] = ["read", "grep", "find", "ls", "bash", "edit", "write"];
export const NAVIGATOR_TOOLS: readonly string[] = ["read", "grep", "find", "ls", "bash"];
```

```ts
// decision artifact. Normative telemetry summary shape.
interface PairTelemetrySummary {
  id: string;
  rawToolCallId: string;
  role: "driver" | "navigator";
  phase: string;
  cycle?: number;
  toolName: string;
  kind: "skill_load" | "file_read" | "search" | "command" | "file_write" | "artifact_inspection";
  targetPreview?: string;
  commandPreview?: string;
  redacted: boolean;
  success: boolean;
  exitCode?: number;
  timestamp: string;
}
```

- **Tests to extend**:
  - Unit tests for telemetry event correlation, ID generation, command redaction, failed-call semantics, and role/phase assignment.
  - Regression test that Navigator write-like telemetry cannot satisfy review proof.
- **Wiring/build notes**:
  - Pi docs verify `AgentSession.subscribe()` event names. No SDK API gap remains.

### Area: Prompt Files and Renderer

- **Decision IDs**: `DEC-024`, `DEC-025`, `DEC-026`
- **Current code anchors**:
  - `extensions/lib/pair-protocol.ts` `buildNavigatorPreflightPrompt`
  - `extensions/lib/pair-protocol.ts` `buildDriverCyclePrompt`
  - `extensions/lib/pair-protocol.ts` `buildDriverCorrectionPrompt`
  - `extensions/lib/pair-protocol.ts` `buildNavigatorReviewPrompt`
  - `extensions/pair-program.ts` `buildRoleSystemPrompt`
  - Existing prompt directory: `extensions/prompts/` currently contains `lead-griller.md` and `scout-dispatch.md`.
- **Existing behavior**: Pair prompts are inline TypeScript template strings. There are no pair-specific markdown prompt files.
- **Required edits**:
  - Add prompt files such as `pair-shared.md`, `navigator-preflight.md`, `driver-first-turn.md`, `driver-cycle.md`, `driver-correction.md`, `navigator-review.md`, and `navigator-decision-repair.md`.
  - Use named markdown insertion markers such as `<!-- TASK -->`, `<!-- RUN_STATE -->`, `<!-- TELEMETRY_SUMMARY -->`, and phase-specific markers.
  - Rendering fails fast if a required marker is missing.
  - Inject phase-specific compact state blocks, not full run state every turn.
- **Snippet(s)**:

```md
<!-- decision artifact. Normative marker style for extracted prompt files. -->
# Navigator Review

<!-- TASK -->

<!-- RUN_STATE -->

<!-- DRIVER_REPORT -->

<!-- TELEMETRY_SUMMARY -->

<!-- DECISION_CONTRACT -->
```

- **Tests to extend**:
  - Unit tests for marker rendering, missing-marker failures, and per-phase payload selection.
  - Snapshot-style tests may be useful for rendered prompt shape, but keep them focused to avoid brittle prose diffs.
- **Wiring/build notes**:
  - Prompt loader should resolve files relative to the extension package, not the current user repo.

### Area: Markdown Output Parsing and Validation

- **Decision IDs**: `DEC-004`, `DEC-012`, `DEC-018`, `DEC-020`, `DEC-022`, `DEC-023`, `DEC-025`, `DEC-026`
- **Current code anchors**:
  - `extensions/lib/pair-protocol.ts` `parseNavigatorDecision`
  - `extensions/lib/pair-protocol.ts` `extractHeadingBody`
  - `extensions/lib/pair-protocol.ts` `buildNavigatorDecisionRepairPrompt`
- **Existing behavior**: The parser only enforces one `DECISION:` line and has a simple exact heading extractor. Malformed Navigator decisions get one repair pass. There is no structured validation for preflight, Driver startup, or final proof maps.
- **Required edits**:
  - Add a deterministic markdown section parser that normalizes headings by trimming, lowercasing, and removing trailing punctuation.
  - Add section-specific validators for each structured phase.
  - Validate recognized playbook and leaf slugs against the run-start MCP registry snapshot.
  - Validate final proof map telemetry references for existence, success, role/phase constraints, and proof-class compatibility.
  - Add one repair pass for invalid structured outputs, then block/fail.
- **Snippet(s)**:

```ts
// current code anchor. Existing extractor is too exact and should be replaced/generalized.
function extractHeadingBody(markdown: string, heading: string): string | null {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start < 0) return null;
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) break;
    body.push(lines[i]);
  }
  return body.join("\n").trim() || null;
}
```

```ts
// current code anchor. Preserve exact one-decision-line contract, but add stricter section validation around it.
export function parseNavigatorDecision(text: string): NavigatorDecision {
  const matches = [...text.matchAll(/^\s*DECISION:\s*(\S+)\s*$/gim)];
  if (matches.length === 0) return { kind: "malformed", reason: "Missing DECISION line." };
  if (matches.length > 1) return { kind: "malformed", reason: "Multiple DECISION lines." };
  // ...
}
```

- **Tests to extend**:
  - Heading normalization tests.
  - Section-specific validation tests.
  - One-repair-pass tests for preflight, Driver startup, review, and proof-map reference repair.
  - Final approval blocking tests for missing/unverified acceptance bullets.
- **Wiring/build notes**:
  - Keep validators pure. Runtime should call validators and decide whether to repair, block, or continue.

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

### Area: Pstack Registry and Skill-load Validation

- **Decision IDs**: `DEC-011`, `DEC-012`, `DEC-013`, `DEC-015`
- **Current code anchors**:
  - `extensions/lib/pair-program-helpers.ts` `verifySkillTddAvailable`
  - MCP tool metadata for `engineering_skills_skill-pstack` lists available Skills and Playbooks.
- **Existing behavior**: Helper verification looks for `skill-tdd` in registered tools or engineering-skills MCP config. There is no pstack registry snapshot.
- **Required edits**:
  - Replace TDD prerequisite verification with pstack registry resolution.
  - Parse allowed names from MCP `skill-pstack` metadata. Normalize full playbook names like `poteto-mode/playbooks/bug-fix` and short slugs like `bug-fix` for human-facing structured output.
  - Block run if registry cannot be resolved.
  - Cross-check Driver-declared loaded leaves and playbook names against both registry and telemetry.
- **Snippet(s)**:

```ts
// current code anchor. Existing helper shape can inspire registry verification, but TDD-specific names must go.
const SKILL_TDD_PATTERNS = [/skill[-_]tdd/i];

export function verifySkillTddAvailable(opts: SkillTddVerifierOptions): SkillTddVerificationResult {
  if (opts.getAllTools) {
    // registry lookup today
  }
  if (opts.isMcpConfigured) {
    // config fallback today
  }
  return { available: false, mechanism: "none" };
}
```

- **Tests to extend**:
  - Registry snapshot success and missing-registry block tests.
  - Slug normalization tests.
  - Driver loaded-leaf declaration cross-check tests.
- **Wiring/build notes**:
  - The MCP metadata is canonical. Local file scanning is not part of the accepted default behavior.

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

## Global Build & Wiring Notes

- The package check command is `npm run check`.
- Existing pure unit tests are run directly with `npx tsx`, for example `npx tsx extensions/__tests__/pair-program-params.test.ts`.
- Role child sessions are created through `createAgentSessionFromServices()` with `SessionManager.inMemory(cwd)` and `resourceLoaderOptions.noExtensions: true`.
- Prompt files should be loaded from the extension package path, not from the target repository being modified by the pair run.
- `engineering-skills` MCP is required for pstack registry and skill loading. A missing registry blocks the run.
- `CONTEXT.md` glossary now includes `End Goal To Prove`, `Pair Acceptance Checklist`, and `Pair Run State`.

## Testing Decisions

- Test coordinator logic as pure functions where possible.
- Do not test implementation details of prompt prose. Test rendered prompt markers, required section presence, and deterministic validation behavior.
- Test external contract behavior for the tool schema and early-return states.
- Telemetry tests should use synthetic `tool_execution_start` and `tool_execution_end` events rather than spawning live child agents.
- Final approval tests should cover the proof matrix and blocked gap reports because this is the main regression risk.
- Existing prior art:
  - `extensions/__tests__/pair-program-params.test.ts` tests pure helper behavior without child sessions.
  - `extensions/lib/pair-protocol.ts` already isolates protocol functions that can be extended with pure validators.

## Out of Scope

- Renaming `pair_program`.
- Preserving old TDD-only `mode` or top-level `testCommand` compatibility.
- Letting Navigator edit or write files.
- Local pstack filesystem scan as the primary registry source.
- Automatic multi-run splitting for broad tasks.
- Implementing the generated issues in this PRD.

## Unresolved Gaps

None.

## Further Notes

Quality pass applied:

- `principle-minimize-reader-load`: The PRD groups implementation by area and keeps decision artifacts near their owning area.
- `principle-boundary-discipline`: Runtime Pi integration stays in the tool/session shell; parsing, validation, registry normalization, and proof checks should be pure modules.
- `principle-type-system-discipline`: The plan calls for explicit state and proof types instead of freeform strings for the core protocol.
