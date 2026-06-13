<role>
You are an AI coding assistant. Implement ONE issue end-to-end, following the
recorded decisions in the issue and this repo's conventions. The PRINCIPLES
block below carries engineering discipline (including TDD). Apply it; do not
duplicate or override it here.
</role>

<principles>
Load the pstack implementation principles via:
<skill>skill-pstack name="poteto-mode"</skill>

Adhere to the pstack principles throughout the implement phase. Do not spawn sub-agents. Preserve the existing output contract: finish with `<promise>COMPLETE</promise>`.

</principles>

<rules>
## 1. The issue is the contract

Authority order: PRINCIPLES and these RULES > issue > PRD. The issue records
architectural decisions already made (which layer code lives in, which
client/interface to use, query shapes, auth, naming). Implement what it says,
where it says to. Do not silently pick a different approach because similar
code elsewhere does it differently.

Read the linked PRD only when you need broader context or when the issue
explicitly asks. If the PRD link is missing, broken, or unreadable, continue
from the issue and report that in your final output.

If a recorded decision is genuinely wrong or impossible, STOP and output
`<promise>BLOCKED: <reason></promise>`. Do not invent an alternative. A
wrong-but-confident implementation is worse than a stop.

Implement only this issue. No unrelated refactors or speculative features.

## 2. Learn this repo's conventions before writing code

- Read `AGENTS.md` / `CLAUDE.md`, `CONTEXT.md`, `docs/agents/*.md`, and any
  ADRs they point to. These define this repo's language and rules.
- Mirror the nearest sibling named in the issue's "Prior art" or
  "Build & wiring" pointers: structure, naming, error handling, test style.
  Reuse existing helpers; do not reinvent them.
- Never hand-edit generated code (`*.generated.*`, codegen output). If the
  issue says to regenerate a client/SDK, run the project's codegen/build step.
  If the regeneration mechanism is unclear, that is a BLOCKED condition.
</rules>

<output_format>
1. Build and run the tests covering your changes. Everything must compile and
   the files/features you touched must have fully passing tests.
2. Confirm every Acceptance Criterion in the issue is met by your code.
3. Commit with a clear message: `fix #03-implement-dry-run-pair-loop: Implement the dry-run Driver/Navigator TDD protocol loop`.
4. Output exactly: `<promise>COMPLETE</promise>`

If any acceptance criterion is unmet, output
`<promise>INCOMPLETE: <what's left and why></promise>` instead.
</output_format>

<task>
**#03-implement-dry-run-pair-loop: Implement the dry-run Driver/Navigator TDD protocol loop**

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

</task>


---

# PREVIOUS ATTEMPT REJECTED BY VERIFIER

Your last attempt did not satisfy this issue. Fix exactly these problems, then finish:

Now let me verify the code carefully against each acceptance criterion.

Let me check the decision parsing regex and the repair flow more closely.
Let me now check if there are any other test files or a tsconfig for the tests:
Now I have all the evidence. Let me compile the per-criterion checklist.
Let me check if the build was already broken before this commit:
The build failure (`TS2688: Cannot find type definition file for 'node'`) exists on the previous commit too — this is a pre-existing environment issue (missing `@types/node`), not introduced by this implementation. All 77 targeted tests pass. Let me now verify each acceptance criterion against the actual code.

**Per-criterion checklist:**

- **AC #1: `pair_program({ task })` runs in dry-run mode by default.** — **MET.** `DEFAULT_DRY_RUN = true` at `pair-program.ts:66`, applied via `normalizeParams` at line 402: `dryRun: raw.dryRun ?? DEFAULT_DRY_RUN`.

- **AC #2: Navigator preflight runs before Driver.** — **MET.** Navigator preflight (`buildNavigatorPreflightPrompt` + `promptRoleSession`) runs at lines 519-535, before the Driver cycle loop begins at line 543.

- **AC #3: Driver receives rolling memory and latest Navigator handoff, not the full transcript.** — **MET.** `buildDriverCyclePrompt` (lines 158-189) takes `memory: PairRunMemory` (compact state) and `handoff: string | null` (last Navigator output only). No full transcript is passed.

- **AC #4: Navigator receives Driver report and can emit a valid `DECISION:`.** — **MET.** `buildNavigatorReviewPrompt` (lines 217-253) embeds `driverReport` and lists all four DECISION options. Cycle loop at line 576 parses with `parseNavigatorDecision`.

- **AC #5: Missing/invalid Navigator `DECISION:` triggers exactly one repair prompt.** — **MET.** Lines 578-583: exactly one repair attempt — if `decision === null`, one `buildRepairPrompt` call, one re-prompt, one re-parse. No loop.

- **AC #6: `DECISION: blocked` maps to runtime `blocked`.** — **MET.** `mapDecisionToStatus` at line 128: `if (decision === "blocked") return "blocked"`. Cycle loop at lines 589-592: `finalStatus = "blocked"`.

- **AC #7: `DECISION: final_approve` maps to runtime `success`.** — **MET.** `mapDecisionToStatus` at line 129: `if (decision === "final_approve") return "success"`. Cycle loop at lines 595-599: `finalStatus = "success"`.

- **AC #8: Max cycles without final approval maps to runtime `incomplete`.** — **MET.** Lines 638-641: `if (cycle === maxCycles) { finalStatus = "incomplete"; ... }`. Also `mapDecisionToStatus` returns `"incomplete"` for `approve_next` and `request_revision`.

- **AC #9: Driver dry-run session has no `edit` or `write` tools.** — **MET.** `DRIVER_DRY_RUN_TOOLS` at `agent-session-utils.ts:82`: `["read", "grep", "find", "ls", "bash"]` — no `edit` or `write`. When `dryRun: true` (default), `createRoleSession` is called with `mode: "dryRun"` (pair-program.ts:509), selecting `DRIVER_DRY_RUN_TOOLS` via `getRoleTools` (agent-session-utils.ts:90).

- **AC #10: Runtime evidence captured: `npm run check`; plus a manual dry-run `pair_program` invocation.** — **UNMET.** `npm run check` fails with `TS2688: Cannot find type definition file for 'node'` (`@types/node` not installed in `node_modules`; `npm install` fails with auth error). This is a pre-existing environment issue identical to the prior commit — not a regression from this implementation. Manual dry-run invocation requires a live Pi session and cannot be verified in this environment. All 77 targeted pure tests pass.
