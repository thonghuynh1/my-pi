# Implement the dry-run Driver/Navigator TDD protocol loop

Status: ready-for-agent
Type: AFK
Source PRD: `F:/MyWork/my-pi/.scratch/pair-program-tool/PRD.md`

## What to build

Make `pair_program` run the first real autonomous pair flow in `dryRun: true`: Navigator preflight, Driver cycle report without edit/write tools, neutral handoff, Navigator review, decision parsing, one repair prompt for malformed decisions, and an `incomplete`/`blocked`/`success` result according to the current protocol. This slice should prove the two persistent child sessions can communicate through the deterministic coordinator.

Decision IDs: `MACRO-001`, `MACRO-002`, `MESO-002`, `MESO-004`, `MESO-005`, `MESO-006`, `MESO-007`, `MESO-008`, `MESO-009`, `MESO-016`, `MICRO-001`, `MICRO-002`, `MICRO-003`, `MICRO-006`.

## Implementation map

### Area: Pair Protocol, Memory, and Prompt Contracts

- **Decision IDs**: `MESO-004`, `MESO-005`, `MESO-006`, `MESO-007`, `MESO-008`, `MESO-009`, `MESO-016`, `MICRO-002`
- **Current code anchors**:
  - `extensions/subagents.ts`: one-shot prompt assembly and `session.prompt(prompt)` usage.
  - No existing Pair Run Memory or pair protocol code exists.
- **Existing behavior**: Parent sends one task prompt to a child and returns the final answer. There is no multi-turn child-child protocol.
- **Required edits**:
  - Implement a deterministic dry-run cycle loop:
    1. Confirm issue 01's `skill-tdd` verification passed.
    2. Prompt Navigator preflight to define acceptance checklist, risks, and first cycle objective.
    3. Prompt Driver for the current cycle with dry-run tools only.
    4. Prompt Navigator review with Driver report and compact memory.
    5. Apply decision: approve next, request one correction packet, block, or final approve.
  - Maintain Pair Run Memory as compact state, not as a full replay.
  - Parse only `DECISION:` from Navigator in MVP.
  - Repair malformed Navigator output once.
  - Driver required Markdown headings:
    - Cycle report: `## Summary`, `## Changed Files`, `## Tests Run`, `## Evidence`, `## Acceptance Checklist Progress`, `## Next Intent`.
    - Correction report: `## Correction Packet Addressed`, `## Changed Files`, `## Tests Run`, `## Evidence`, `## Remaining Risk`.
    - Clarification: `## Clarification Needed`.
  - Navigator required decisions:
    - `DECISION: approve_next`
    - `DECISION: request_revision`
    - `DECISION: blocked`
    - `DECISION: final_approve`
  - Navigator `request_revision` must include `## Correction Packet` and `## Required Evidence`.
  - Navigator clarification checklist changes must include `## Checklist Amendment`.
  - Driver prompt must instruct Driver to call/use `skill-tdd` before implementation.
  - Navigator prompt must embed the compact TDD review rubric, not the full skill.
- **Snippet(s)**:

```ts
// current code anchor - prompt and abort pattern, illustrative
const prompt = `Task: ${params.task}\n\nReturn only the useful findings for the parent agent.`;
const runPrompt = () =>
  Promise.race([
    session!.prompt(prompt),
    new Promise<never>((_, reject) => {
      ctx.signal?.addEventListener("abort", () => reject(new Error("Subagent was aborted.")), { once: true });
      timeoutController.signal.addEventListener(
        "abort",
        () => reject(new Error(`Subagent timed out after ${params.timeoutSeconds} seconds.`)),
        { once: true },
      );
    }),
  ]);
```

```ts
// decision artifact - Pair Run Memory, normative shape
interface PairRunMemory {
  task: string;
  acceptedConstraints: string[];
  unresolvedRisks: string[];
  currentCycle: number;
  currentObjective: string | null;
  acceptanceChecklistText: string | null;
  lastDriverReport: string | null;
  lastNavigatorReview: string | null;
  evidenceSummaries: string[];
}
```

```text
decision artifact - Navigator decision contract, normative
DECISION: approve_next
Meaning: Current cycle is acceptable. Coordinator may start the next Driver cycle.

DECISION: request_revision
Meaning: Current cycle is not acceptable, but likely fixable in one correction packet.
Must include: ## Correction Packet and ## Required Evidence.

DECISION: blocked
Meaning: Pair cannot safely continue without external input, missing dependency, repeated malformed output, or contradiction.

DECISION: final_approve
Meaning: Acceptance checklist is covered and final verification evidence is acceptable.
```

- **Tests to extend**:
  - Unit tests for `parseNavigatorDecision(text)`.
  - Unit tests for malformed decision repair flow control.
  - Unit tests for status mapping from Navigator decision and coordinator stop reason.
  - Unit tests for max-cycle behavior.
- **Wiring/build notes**:
  - Prompt construction should be pure functions where possible: structured state in, string out.
  - Navigator rubric is compact and hardcoded in MVP:
    - one behavior at a time
    - RED before GREEN
    - RED failed for intended reason
    - minimal implementation for current behavior
    - public behavior tests
    - no horizontal slicing
    - failing-before and passing-after evidence
    - edge cases and checklist coverage reviewed

### Area: Child Session Runtime and Role Permissions

- **Decision IDs**: `MACRO-001`, `MESO-001`, `MESO-002`, `MESO-003`, `MESO-005`, `MESO-015`, `MICRO-004`, `MICRO-006`
- **Current code anchors**:
  - `extensions/subagents.ts`: `runSubagent()` uses `createAgentSessionServices()` and `createAgentSessionFromServices()`.
  - `extensions/subagents.ts`: child sessions use `SessionManager.inMemory(cwd)`.
  - `extensions/subagents.ts`: child sessions pass a tool allowlist.
  - `extensions/subagents.ts`: child session events are subscribed for text, tool calls, usage, and final messages.
- **Existing behavior**: `subagent` creates one child session per tool call. Pair runs need two persistent sessions.
- **Required edits**:
  - Use issue 02's helper to create persistent Driver and Navigator sessions.
  - In this slice, force or default to dry-run Driver tools so no edit/write capability is present.
  - Preserve role usage for final result even if the final display is minimal.

## Acceptance criteria

- [ ] `pair_program({ task })` runs in dry-run mode by default.
- [ ] Navigator preflight runs before Driver.
- [ ] Driver receives rolling memory and latest Navigator handoff, not the full transcript.
- [ ] Navigator receives Driver report and can emit a valid `DECISION:`.
- [ ] Missing/invalid Navigator `DECISION:` triggers exactly one repair prompt.
- [ ] `DECISION: blocked` maps to runtime `blocked`.
- [ ] `DECISION: final_approve` maps to runtime `success`.
- [ ] Max cycles without final approval maps to runtime `incomplete`.
- [ ] Driver dry-run session has no `edit` or `write` tools.
- [ ] Runtime evidence captured: `npm run check`; plus a manual dry-run `pair_program` invocation showing live Driver/Navigator communication and no workspace edits.

## Blocked by

- 01-register-pair-program-shell-and-verify-tdd
- 02-create-driver-navigator-session-runtime
