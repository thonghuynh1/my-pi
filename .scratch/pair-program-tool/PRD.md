# PRD: Pair Program Tool for Pi

Status: draft-ready-for-implementation-planning

## Problem Statement

The user wants Pi agents to work together like a pair-programming team without requiring human input at each step. A single agent can over-focus on implementation and miss edge cases, while a separate reviewer agent can protect quality. The user also cares about token and cost efficiency, so the design must avoid a third LLM orchestrator.

The system should let a human or future Ralph Loop task call one Pi tool with a task, watch important Driver/Navigator handoffs live, and receive a final result with evidence, transcript paths, and per-role usage.

## Solution

Add a deterministic Pi extension tool named `pair_program`. The tool is not an LLM agent. It creates two persistent child Pi sessions:

- Driver Agent: performs the implementation work in the current task worktree.
- Navigator Agent: reviews the Driver's plan, evidence, diffs, edge cases, and final checklist coverage without edit/write tools.

The Pair Program Tool owns turn order, permissions, transcript persistence, live status, neutral evidence collection, usage reporting, model override validation, and failure handling. It does not judge code quality itself. The Navigator Agent owns qualitative decisions through a small decision vocabulary.

The MVP is TDD-first. `mode` exists, but only `mode: "tdd"` is implemented. TDD mode requires the Engineering Skills MCP `skill-tdd` to be available. The coordinator verifies availability before starting. The Driver is instructed to call/use `skill-tdd`; the Navigator gets a compact TDD review rubric by default.

## User Stories

1. As a developer, I want to call one Pi tool with a task, so that two agents can work together without me manually coordinating them.
2. As a developer, I want the Driver Agent to own edits and test runs, so that implementation keeps momentum.
3. As a developer, I want the Navigator Agent to review evidence and diffs, so that edge cases and missed details are caught before completion.
4. As a developer, I want no third LLM orchestrator, so that pair runs use fewer model contexts and cost less.
5. As a developer, I want a deterministic coordinator, so that turn order and stop conditions are predictable.
6. As a developer, I want important handoffs streamed live, so that I can observe the pair without reading raw full logs.
7. As a developer, I want full Markdown and JSON transcripts saved, so that I can audit what happened after the run.
8. As a developer, I want Driver and Navigator usage reported separately, so that I can see token and cost impact by role.
9. As a developer, I want optional Driver and Navigator model overrides, so that I can tune cost and quality per role.
10. As a developer, I want model override failures to fail fast, so that an unavailable cheap model does not silently fall back to an expensive one.
11. As a developer, I want dry run to be the default, so that I can test the communication loop before allowing edits.
12. As a developer, I want `dryRun: false` to enable real work, so that the same tool can move from trial to implementation.
13. As a developer, I want TDD mode to require `skill-tdd`, so that the Driver follows the real project workflow rather than a generic approximation.
14. As a developer, I want the Navigator to use a compact TDD rubric, so that review stays cost-aware.
15. As a developer, I want one correction packet per cycle, so that review feedback is focused and the agents do not loop endlessly.
16. As a developer, I want the Driver to ask one clarification when blocked by ambiguity, so that it can avoid unsafe guesses without opening free-form chat.
17. As a developer, I want the coordinator to collect neutral git evidence, so that Navigator review is not based only on Driver self-report.
18. As a developer, I want final verification to run only at final review or when Navigator asks, so that per-cycle cost stays lower.
19. As a developer, I want initial dirty workspace state captured, so that agents know which changes pre-existed the pair run.
20. As a future Ralph Loop integrator, I want the tool result to include practical status, evidence, paths, and usage, so that Ralph Loop can later call the same tool without changing the pair protocol.

## Accepted Decision Register

- `MACRO-001`
  - Decision: Build a deterministic Pair Program Tool, not a third LLM orchestrator.
  - Rationale: The coordinator's duties are mechanical: turn order, permissions, state, transcript, evidence, usage, and stop conditions. A third LLM would add token cost and another source of drift.
  - Rejected alternatives: A three-agent design with an LLM orchestrator was rejected as less cost-efficient. Two visible Pi sessions were rejected for MVP because they add operational friction and can desync.
  - Downstream impact: Implement coordination in TypeScript extension code. Do not create an orchestration prompt or third child model session.

- `MACRO-002`
  - Decision: The MVP is TDD-first with a reserved `mode` field.
  - Rationale: The user's immediate use case is TDD pair programming, but the tool interface should not block future modes.
  - Rejected alternatives: A TDD-only tool with no mode was too narrow. A fully general pair tool with review/plan/debug modes was too broad for MVP.
  - Downstream impact: `mode?: "tdd"` is accepted; other values are rejected or left unimplemented.

- `MACRO-003`
  - Decision: Ralph Loop integration is out of scope for this PRD.
  - Rationale: The user wants to try the Pi tool manually first. Ralph Loop can later call the same tool.
  - Rejected alternatives: Designing a Ralph Loop status schema now was deferred.
  - Downstream impact: Return practical runtime results only; do not design Ralph-specific contracts beyond compatibility-friendly result fields.

- `MESO-001`
  - Decision: Add `extensions/pair-program.ts` and `extensions/agent-session-utils.ts`.
  - Rationale: Pair programming is distinct from one-shot subagents, but should reuse child session patterns.
  - Rejected alternatives: Adding everything to `subagents.ts` was rejected because that file is already large and conceptually different.
  - Downstream impact: Extract shared child session helpers only where they reduce duplication.

- `MESO-002`
  - Decision: Use two persistent child Pi sessions for the whole pair run.
  - Rationale: This matches real pair programming better than rotating reviewers every turn.
  - Rejected alternatives: Fresh Navigator per review was rejected because the user wants continuity. Fresh sessions per turn were rejected as less natural and more repetitive.
  - Downstream impact: The coordinator should create Driver and Navigator sessions once, then call `prompt()` repeatedly. Context growth is accepted for MVP and bounded by `maxCycles`.

- `MESO-003`
  - Decision: Driver gets workspace-changing tools when `dryRun: false`; Navigator never gets edit/write tools.
  - Rationale: Driver owns implementation. Navigator owns review and may run focused verification, but should not modify files.
  - Rejected alternatives: Read-only Navigator was rejected because independent verification is valuable. Navigator edit access was rejected to preserve role separation.
  - Downstream impact: Driver tools in work mode include `read`, `grep`, `find`, `ls`, `bash`, `edit`, `write`. Driver tools in dry run omit `edit` and `write`. Navigator tools include `read`, `grep`, `find`, `ls`, `bash`.

- `MESO-004`
  - Decision: Use hybrid communication: human-readable Markdown plus machine-checkable Navigator `DECISION:` lines.
  - Rationale: JSON-only is token-heavy and brittle. Free Markdown is hard to control. A single required decision line gives the coordinator a stable control point.
  - Rejected alternatives: JSON-only and free-form Markdown were rejected.
  - Downstream impact: The coordinator parses only the Navigator decision line in MVP. Other sections remain human-readable.

- `MESO-005`
  - Decision: Use rolling Pair Run Memory plus latest handoff, not full transcript replay.
  - Rationale: Persistent sessions already carry context; repeated full transcript injection would waste tokens.
  - Rejected alternatives: Full transcript every turn was too expensive. Last message only was too lossy.
  - Downstream impact: Maintain compact state in coordinator and save full transcript separately.

- `MESO-006`
  - Decision: Completion requires Navigator `DECISION: final_approve`; checklist maintenance is Navigator text only for MVP.
  - Rationale: The Navigator owns judgment. The coordinator should not deeply parse checklist items yet.
  - Rejected alternatives: Machine-readable checklist state was deferred to avoid overbuilding.
  - Downstream impact: Runtime `success` maps only from `final_approve`. The final Navigator message must state checklist coverage.

- `MESO-007`
  - Decision: Navigator preflight defines the acceptance checklist before Driver starts.
  - Rationale: Navigator's value is catching missing details and edge cases early.
  - Rejected alternatives: Coordinator-only checklist extraction was considered weaker.
  - Downstream impact: The first child prompt goes to Navigator.

- `MESO-008`
  - Decision: One correction packet per cycle.
  - Rationale: Review feedback should be bundled and actionable without opening endless debate.
  - Rejected alternatives: Free back-and-forth was rejected as too expensive. Immediate block on any rejection was too brittle.
  - Downstream impact: `DECISION: request_revision` must include `## Correction Packet` and `## Required Evidence`. Driver gets one correction turn, then Navigator verifies once.

- `MESO-009`
  - Decision: Driver may ask one clarification mid-cycle when blocked by ambiguity.
  - Rationale: This prevents unsafe guesses while keeping conversation bounded.
  - Rejected alternatives: No clarification was too rigid. Free back-and-forth was too expensive.
  - Downstream impact: Driver report may include `## Clarification Needed`; Navigator may answer once. Checklist amendments must be explicit.

- `MESO-010`
  - Decision: Stream important handoffs live; save full Markdown and JSON transcripts.
  - Rationale: The human should see the pair working without drowning in every raw message.
  - Rejected alternatives: Compact status only was too opaque. Full live raw messages were too noisy.
  - Downstream impact: `onUpdate` should show preflight summary, Driver evidence summary, Navigator decisions, correction packets, blockers, final result, and transcript paths.

- `MESO-011`
  - Decision: Coordinator collects neutral git evidence before Navigator reviews.
  - Rationale: Navigator should not trust Driver reports alone.
  - Rejected alternatives: Driver-only evidence was rejected. Navigator-only evidence via bash would cost extra turns.
  - Downstream impact: Run deterministic git commands such as `git status --short`, `git diff --stat`, and `git diff`, with truncation.

- `MESO-012`
  - Decision: Driver owns per-cycle tests; coordinator reruns tests only for final review or when Navigator requests verification.
  - Rationale: TDD speed matters, and repeated deterministic test reruns after every cycle can be expensive.
  - Rejected alternatives: Coordinator reruns tests every cycle was rejected. Never rerunning tests was too weak.
  - Downstream impact: Support optional `testCommand`; final verification uses it or a detected default.

- `MESO-013`
  - Decision: Return practical runtime result fields.
  - Rationale: The tool output should be readable; full audit data lives in transcript files.
  - Rejected alternatives: Minimal result was too sparse. Full audit result in tool output was too noisy.
  - Downstream impact: Return status, summary, final Navigator decision, changed files, final verification result, transcript paths, usage by role, and total usage.

- `MESO-014`
  - Decision: Expose practical MVP parameters plus role model overrides and usage reporting.
  - Rationale: Manual trials need task, mode, dry-run control, cycle cap, tests, and cost visibility.
  - Rejected alternatives: Very small parameters lacked model/cost control. Highly configurable parameters were too much for MVP.
  - Downstream impact: Implement `task`, `mode`, `maxCycles`, `testCommand`, `dryRun`, `driverModel`, and `navigatorModel`.

- `MESO-015`
  - Decision: Model override failures fail fast.
  - Rationale: Silent fallback can accidentally use a more expensive model.
  - Rejected alternatives: Silent fallback to inherited model was rejected.
  - Downstream impact: Reuse or adapt `selectSubagentModel`, but change override behavior for pair runs: no fallback when an override is explicitly requested and unavailable.

- `MESO-016`
  - Decision: TDD mode requires Engineering Skills MCP `skill-tdd`.
  - Rationale: The user wants the real MCP skill as the workflow source.
  - Rejected alternatives: Hardcoded local path and embedded full skill text were rejected. The Navigator does not need full `skill-tdd` by default.
  - Downstream impact: Verify `skill-tdd` availability before starting. Driver prompt instructs Driver to call/use `skill-tdd`; Navigator prompt embeds a compact TDD review rubric.

- `MESO-017`
  - Decision: Only one active pair run per Pi session in MVP.
  - Rationale: Concurrent pair runs complicate status widgets, global state, transcript routing, and usage tracking.
  - Rejected alternatives: Multiple concurrent pair runs were deferred.
  - Downstream impact: Guard `pair_program` execution with an active-run flag.

- `MICRO-001`
  - Decision: Defaults are `mode: "tdd"`, `maxCycles: 4`, `dryRun: true`.
  - Rationale: Safe by default while still useful for trials.
  - Rejected alternatives: `dryRun: false` default was rejected as too risky.
  - Downstream impact: Driver receives edit/write tools only when caller explicitly passes `dryRun: false`.

- `MICRO-002`
  - Decision: Malformed required output gets one repair prompt.
  - Rationale: Avoid silent guessing and avoid endless format repair loops.
  - Rejected alternatives: Inferring intent from messy text was too risky. Immediate failure was too brittle.
  - Downstream impact: If Navigator omits a valid `DECISION:`, ask once to restate with a valid decision. If still malformed, end `error`.

- `MICRO-003`
  - Decision: Runtime statuses are `success`, `blocked`, `incomplete`, and `error`.
  - Rationale: These are enough for manual trials and future automation.
  - Rejected alternatives: Mirroring Navigator vocabulary directly was less user-friendly.
  - Downstream impact: Map `final_approve` to `success`; `blocked` only when Navigator says blocked; caps/abort are `incomplete`; runtime failures are `error`.

- `MICRO-004`
  - Decision: Respect abort and save partial transcripts.
  - Rationale: Human abort should not lose audit state.
  - Rejected alternatives: Interactive pause/inject/continue was deferred.
  - Downstream impact: Listen to `ctx.signal`, abort child sessions, write partial Markdown/JSON, and return `incomplete` or `error`.

- `MICRO-005`
  - Decision: Snapshot initial dirty workspace state but do not precisely attribute pair-created changes in MVP.
  - Rationale: Agents need to know pre-existing changes exist, but exact patch attribution is complex.
  - Rejected alternatives: Requiring clean worktree was rejected. Best-effort initial/current diff comparison was deferred.
  - Downstream impact: Capture initial `git status --short` and diff summary; include it in prompts.

- `MICRO-006`
  - Decision: Persistent child session context growth is accepted for MVP.
  - Rationale: `maxCycles: 4` and usage reporting provide a bounded experiment.
  - Rejected alternatives: Summarization checkpoints were deferred.
  - Downstream impact: Do not reset or compact child sessions specially in MVP.

## Implementation Plan

### Area: Pair Program Tool Extension

- **Decision IDs**: `MACRO-001`, `MACRO-002`, `MACRO-003`, `MESO-001`, `MESO-014`, `MESO-017`, `MICRO-001`, `MICRO-003`
- **Current code anchors**:
  - `package.json`: Pi loads `./extensions`.
  - `extensions/subagents.ts`: `buildSubagentToolDef()` registers a custom tool and renders calls/results.
  - `extensions/subagents.ts`: `SubagentParams` shows TypeBox parameter schema style.
- **Existing behavior**: The project registers extension tools from the `extensions` directory. `subagent` is a one-shot child-agent tool.
- **Required edits**:
  - Add `extensions/pair-program.ts` and register a `pair_program` tool.
  - Add `extensions/agent-session-utils.ts` for shared child session creation, model resolution, usage extraction, and final assistant text extraction where useful.
  - Ensure only one active pair run per Pi session.
  - Implement parameter defaults: `mode: "tdd"`, `maxCycles: 4`, `dryRun: true`.
  - Reject non-`tdd` modes in MVP with a clear error.
  - Return runtime statuses `success | blocked | incomplete | error`.
- **Snippet(s)**:

```ts
// current code anchor - package extension discovery, normative
"pi": {
  "extensions": [
    "./node_modules/pi-mcp-adapter/index.ts",
    "./extensions"
  ],
  "prompts": [
    "./prompts"
  ]
}
```

```ts
// current code anchor - TypeBox tool parameter pattern, illustrative
const SubagentParams = Type.Object({
  type: StringEnum(["explore", "shell", "custom"] as const, {
    description: "Subagent type. explore=read-only investigation, shell=command-oriented investigation, custom=markdown-defined agent.",
  }),
  task: Type.String({ description: "Task to delegate to the subagent." }),
  cwd: Type.Optional(Type.String({ description: "Working directory for the subagent. Defaults to the current cwd." })),
  model: Type.Optional(Type.String({
    description: "Optional model override. Use provider/model or a model id in the active provider.",
  })),
});
```

```ts
// decision artifact - Pair Program Tool parameters, normative
const PairProgramParams = Type.Object({
  task: Type.String({ description: "Task for the Driver/Navigator pair." }),
  mode: Type.Optional(StringEnum(["tdd"] as const, {
    description: "Pair workflow mode. MVP supports only tdd.",
  })),
  maxCycles: Type.Optional(Type.Number({ minimum: 1 })),
  testCommand: Type.Optional(Type.String()),
  dryRun: Type.Optional(Type.Boolean()),
  driverModel: Type.Optional(Type.String()),
  navigatorModel: Type.Optional(Type.String()),
});
```

- **Tests to extend**:
  - Add unit tests for parameter normalization and status mapping if helpers are pure.
  - Add extension-level tests if the project has an existing extension test harness; none was found in this repo.
- **Wiring/build notes**:
  - `npm run check` runs `tsc --noEmit`.
  - New files under `extensions/` are discovered by existing package configuration.

### Area: Child Session Runtime and Role Permissions

- **Decision IDs**: `MACRO-001`, `MESO-001`, `MESO-002`, `MESO-003`, `MESO-005`, `MESO-015`, `MICRO-004`, `MICRO-006`
- **Current code anchors**:
  - `extensions/subagents.ts`: `runSubagent()` uses `createAgentSessionServices()` and `createAgentSessionFromServices()`.
  - `extensions/subagents.ts`: child sessions use `SessionManager.inMemory(cwd)`.
  - `extensions/subagents.ts`: child sessions pass a tool allowlist.
  - `extensions/subagents.ts`: child session events are subscribed for text, tool calls, usage, and final messages.
  - `extensions/subagents.ts`: `selectSubagentModel()` resolves model overrides with fallback behavior.
- **Existing behavior**: `subagent` creates one child session per tool call, sends one prompt, and disposes it. It currently allows fallback from unavailable explicit model override to inherited model in some paths.
- **Required edits**:
  - Extract or duplicate a helper that creates a child session with `cwd`, model, tools, `appendSystemPrompt`, and `SessionManager.inMemory(cwd)`.
  - For pair runs, create two persistent child sessions once: Driver and Navigator.
  - Driver tools:
    - Dry run: `read`, `grep`, `find`, `ls`, `bash`.
    - Work mode: `read`, `grep`, `find`, `ls`, `bash`, `edit`, `write`.
  - Navigator tools: `read`, `grep`, `find`, `ls`, `bash`; never `edit` or `write`.
  - For explicit `driverModel` or `navigatorModel`, fail before starting if unavailable or unauthenticated. Do not silently fallback.
  - If no role model is provided, use inherited/current Pi model.
  - On abort, abort and dispose both child sessions, then save partial transcript.
- **Snippet(s)**:

```ts
// current code anchor - child session creation seam, normative pattern
const services = await createAgentSessionServices({
  cwd,
  modelRegistry: ctx.modelRegistry,
  resourceLoaderOptions: {
    noExtensions: true,
    appendSystemPrompt: [config.prompt],
  },
});

const createChildSession = (model: ActiveModel) =>
  createAgentSessionFromServices({
    services,
    sessionManager: SessionManager.inMemory(cwd),
    model,
    tools: config.tools,
    thinkingLevel: pi.getThinkingLevel(),
  });
```

```ts
// current code anchor - event subscription seam, illustrative
nextSession.subscribe((event) => {
  switch (event.type) {
  case "tool_execution_start": {
    toolCalls.push({ name: event.toolName, args: event.args });
    liveStatus.currentTool = event.toolName;
    publishStatus();
    break;
  }
  case "message_end": {
    const message = event.message as Message;
    applyAssistantUsage(liveStatus, message);
    publishStatus();
    break;
  }
  case "agent_end": {
    finalMessages = event.messages as Message[];
    publishStatus();
    break;
  }
  }
});
```

```ts
// decision artifact - role tools, normative
const DRIVER_DRY_RUN_TOOLS = ["read", "grep", "find", "ls", "bash"];
const DRIVER_WORK_TOOLS = ["read", "grep", "find", "ls", "bash", "edit", "write"];
const NAVIGATOR_TOOLS = ["read", "grep", "find", "ls", "bash"];
```

- **Tests to extend**:
  - Pure tests for model override resolution behavior: explicit unavailable override fails fast; missing override uses inherited model.
  - Pure tests for tool allowlist selection by role and `dryRun`.
- **Wiring/build notes**:
  - Existing `subagents.ts` uses `noExtensions: true` to avoid recursive extension loading. Pair tool needs Engineering Skills MCP availability for Driver. Implementation must decide whether child sessions should load MCP-related extension tools or whether `skill-tdd` access is delegated through the parent/coordinator. See Unresolved Gaps.

### Area: Pair Protocol, Memory, and Prompt Contracts

- **Decision IDs**: `MESO-004`, `MESO-005`, `MESO-006`, `MESO-007`, `MESO-008`, `MESO-009`, `MESO-016`, `MICRO-002`
- **Current code anchors**:
  - `extensions/subagents.ts`: one-shot prompt assembly and `session.prompt(prompt)` usage.
  - No existing Pair Run Memory or pair protocol code exists.
- **Existing behavior**: Parent sends one task prompt to a child and returns the final answer. There is no multi-turn child-child protocol.
- **Required edits**:
  - Implement a deterministic cycle loop:
    1. Verify `skill-tdd`.
    2. Prompt Navigator preflight to define acceptance checklist, risks, and first cycle objective.
    3. Prompt Driver for the current cycle.
    4. Collect neutral evidence.
    5. Prompt Navigator review.
    6. Apply decision: approve next, request one correction packet, block, or final approve.
    7. Run final verification before final Navigator approval when configured.
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

### Area: Engineering Skills MCP and TDD Verification

- **Decision IDs**: `MESO-016`, `MICRO-002`
- **Current code anchors**:
  - `extensions/engineering-skills.ts`: finds and configures an MCP server named `engineering-skills`.
  - `package.json`: includes `pi-mcp-adapter` extension before local extensions.
  - `PrecioHackathon/hackathon-grill-me/README.md`: documents `skill-tdd`.
  - `node_modules/pi-mcp-adapter/README.md`: documents MCP direct tools and proxy behavior.
- **Existing behavior**: `engineering-skills.ts` can write MCP config and reload Pi. The adapter can expose MCP tools, but the exact public API for an extension to directly invoke `skill-tdd` without a model turn was not verified.
- **Required edits**:
  - Before any TDD pair run starts, verify `skill-tdd` availability.
  - Preferred behavior: coordinator calls `skill-tdd` once directly through the registered MCP/direct tool mechanism and fails if it cannot.
  - If direct invocation is not available through Pi extension APIs, implementation must choose one explicit fallback and document it:
    - require `skill-tdd` to be exposed as a direct MCP tool and detect it with `pi.getAllTools()`;
    - or run a cheap verification child prompt that calls `skill-tdd`;
    - or expose a small helper in the MCP adapter integration.
  - Do not hardcode `F:/MyWork/PrecioHackathon/hackathon-grill-me/skills/tdd/SKILL.md` as the contract.
  - Driver prompt must instruct Driver to call/use `skill-tdd` before implementation.
  - The coordinator does not enforce Driver's actual `skill-tdd` call in MVP.
- **Snippet(s)**:

```ts
// current code anchor - engineering-skills MCP config discovery, normative
function findEngineeringSkillsConfig(): { path: string; configured: boolean } {
  const candidates = [
    GLOBAL_MCP_CONFIG,
    join(homedir(), ".pi", "agent", "mcp.json"),
    resolve(process.cwd(), ".mcp.json"),
    resolve(process.cwd(), ".pi", "mcp.json"),
  ];

  for (const path of candidates) {
    const config = readJsonFile(path);
    if (config.mcpServers && Object.prototype.hasOwnProperty.call(config.mcpServers, SERVER_NAME)) {
      return { path, configured: true };
    }
  }

  return { path: GLOBAL_MCP_CONFIG, configured: false };
}
```

```ts
// current code anchor - MCP server registration shape, illustrative
mcpServers[SERVER_NAME] = {
  command: "node",
  args: [distIndex.replace(/\\/g, "/")],
  lifecycle: "lazy",
};
```

- **Tests to extend**:
  - Unit tests for MCP config discovery helper if extracted/exported.
  - Integration or manual verification for `skill-tdd` availability check once implementation chooses the exact call mechanism.
- **Wiring/build notes**:
  - This area has an unresolved implementation gap: exact programmatic invocation of `skill-tdd` from a Pi extension was not verified in the installed API. The PRD requires `skill-tdd` verification, but implementation must ground the API before marking this area complete.

### Area: Workspace Evidence, Final Verification, and Transcripts

- **Decision IDs**: `MESO-010`, `MESO-011`, `MESO-012`, `MESO-013`, `MICRO-004`, `MICRO-005`
- **Current code anchors**:
  - `extensions/subagents.ts`: uses `onUpdate` to stream child-agent progress.
  - `extensions/subagents.ts`: returns `content` and `details` from a tool.
  - `extensions/subagents.ts`: listens to `ctx.signal`.
  - `extensions/tool-panel.ts`: shows compact usage/status patterns for tool UI.
  - `.scratch/` exists and is already used by project workflows.
- **Existing behavior**: `subagent` streams progress but does not save pair transcripts. Tool panel and usage footer already display tool/session usage patterns.
- **Required edits**:
  - At run start, snapshot initial workspace state:
    - `git status --short`
    - `git diff --stat`
    - optionally truncated `git diff` if small enough.
  - Before Navigator review, collect current neutral evidence:
    - `git status --short`
    - `git diff --stat`
    - truncated `git diff`.
  - Do not attempt exact attribution of pair-created vs pre-existing changes in MVP.
  - Driver owns per-cycle test runs. Coordinator runs `testCommand` only for final verification or when Navigator requests verification.
  - Choose final verification command by priority:
    1. `pair_program({ testCommand })`
    2. task metadata if later provided
    3. Navigator preflight recommendation
    4. repo default detection, such as `package.json` scripts.
  - Persist full transcript to:
    - `.scratch/pair-runs/<task-id-or-timestamp>.md`
    - `.scratch/pair-runs/<task-id-or-timestamp>.json`
  - Tool result returns practical summary only, not full cycle audit.
- **Snippet(s)**:

```ts
// current code anchor - live update and tool result pattern, illustrative
execute: async (toolCallId, params, _signal, onUpdate, ctx) => {
  const result = await runSubagent(pi, ctx, toolCallId, params, onUpdate as any, (status) => {
    if (status) activeSubagents.set(toolCallId, status);
    else activeSubagents.delete(toolCallId);
    refreshSubagentStatusWidget(ctx);
  });

  if (result.status === "error") {
    return {
      content: [{ type: "text", text: `Subagent ${result.type}:${result.name} failed: ${result.error}` }],
      details: { ...result },
    };
  }

  return {
    content: [{ type: "text", text: truncateForToolResult(result.output) }],
    details: { ...result },
  };
}
```

```ts
// decision artifact - transcript result, normative shape
interface PairProgramResult {
  status: "success" | "blocked" | "incomplete" | "error";
  summary: string;
  finalNavigatorDecision?: string;
  changedFiles: string[];
  finalVerification?: {
    command: string;
    exitCode: number;
    summary: string;
  };
  transcriptMarkdownPath: string;
  transcriptJsonPath: string;
  usage: PairUsageSummary;
}
```

```ts
// decision artifact - transcript JSON, illustrative shape
interface PairTranscript {
  task: string;
  mode: "tdd";
  status: "success" | "blocked" | "incomplete" | "error";
  startedAt: string;
  endedAt?: string;
  cycles: PairCycleRecord[];
  initialWorkspace: WorkspaceSnapshot;
  finalWorkspace?: WorkspaceSnapshot;
  finalVerification?: FinalVerificationRecord;
  usage: PairUsageSummary;
}
```

- **Tests to extend**:
  - Unit tests for transcript path generation and JSON shape.
  - Unit tests for git evidence truncation helpers.
  - Manual verification that abort writes partial transcript.
- **Wiring/build notes**:
  - Use native Node filesystem APIs for transcript writes. Create `.scratch/pair-runs` lazily.
  - Use safe command execution for git/test evidence; avoid destructive commands.

### Area: Usage Tracking and Live Display

- **Decision IDs**: `MESO-010`, `MESO-013`, `MESO-014`
- **Current code anchors**:
  - `extensions/subagents.ts`: `applyAssistantUsage()` aggregates assistant message usage into child status.
  - `extensions/subagents.ts`: `SubagentUsage` shape includes tokens, cost, and model id.
  - `extensions/subagents.ts`: global `__subagent` state contributes child usage to footer totals.
  - `extensions/tool-panel.ts`: records subagent usage from tool result details.
- **Existing behavior**: The existing subagent tool reports usage per child run and contributes totals to the footer/tool panel.
- **Required edits**:
  - Track Driver and Navigator usage separately across their persistent sessions.
  - Report usage by role and total in final result:
    - input tokens
    - output tokens
    - cache tokens
    - total tokens
    - cost USD
    - model id
  - Consider adding global `__pairProgram` state or extending existing usage footer integration only if needed for live totals.
  - Live UI should show compact phase/cycle/role status and important handoffs, not raw full transcripts.
- **Snippet(s)**:

```ts
// current code anchor - subagent usage shape, illustrative
interface SubagentUsage {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  costUsd: number;
  modelId?: string;
}
```

```ts
// current code anchor - subagent total accumulation, illustrative
if (u) {
  subagentState.totalCostUsd += u.costUsd ?? 0;
  subagentState.totalInputTokens += u.inputTokens ?? 0;
  subagentState.totalOutputTokens += u.outputTokens ?? 0;
  subagentState.totalCacheTokens += u.cacheTokens ?? 0;
  subagentState.totalTokens +=
    u.totalTokens ??
    (u.inputTokens ?? 0) + (u.outputTokens ?? 0) + (u.cacheTokens ?? 0);
}
```

```ts
// decision artifact - pair usage summary, normative shape
interface PairUsageSummary {
  driverUsage: RoleUsage;
  navigatorUsage: RoleUsage;
  totalUsage: {
    totalTokens: number;
    costUsd: number;
  };
}

interface RoleUsage {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  costUsd: number;
  modelId: string;
}
```

- **Tests to extend**:
  - Unit tests for usage aggregation from multiple assistant messages per role.
  - Unit tests for total usage calculation.
- **Wiring/build notes**:
  - Avoid double-counting pair child usage with existing `__subagent` totals. Pair usage should have its own accounting path unless deliberately integrated into the footer.

## Global Build & Wiring Notes

- `npm run check` runs `tsc --noEmit`.
- `pi-mcp-adapter` is already loaded before local extensions via `package.json`.
- Engineering Skills MCP configuration is handled by `extensions/engineering-skills.ts`, with config candidates including `~/.config/mcp/mcp.json`, `~/.pi/agent/mcp.json`, `.mcp.json`, and `.pi/mcp.json`.
- Existing `subagents.ts` has useful code to extract into `agent-session-utils.ts`, but avoid turning the helper into a generic framework. Keep a small interface for pair needs.
- The `subagent` extension uses `noExtensions: true` for child sessions. Pair Program Tool must revisit this because Driver needs `skill-tdd` access in TDD mode.
- No issue tracker publishing is included in this PRD. Runtime integration with Ralph Loop is out of scope.

## Testing Decisions

- Tests should prefer pure helper coverage for deterministic coordinator behavior:
  - parameter normalization
  - status mapping
  - Navigator decision parsing
  - one repair attempt behavior
  - tool allowlist selection
  - model override fail-fast behavior
  - transcript path and JSON shape
  - usage aggregation
  - git evidence truncation
- Integration/manual verification should cover:
  - `dryRun: true` pair run with no edits allowed
  - `dryRun: false` tiny real task
  - Navigator `request_revision` correction packet flow
  - malformed Navigator decision repair
  - abort saves partial transcripts
  - final result includes transcript paths and role usage
- Good tests should target public behavior of the `pair_program` coordinator and pure helpers, not private prompt wording. Prompt snapshots should be avoided unless they assert a stable protocol contract.
- Existing prior art:
  - `extensions/subagents.ts` for child session creation, event subscription, onUpdate streaming, tool result details, model selection, and usage extraction.
  - `extensions/engineering-skills.ts` for MCP configuration discovery.
  - `extensions/tool-panel.ts` for compact usage/status display patterns.

## Out of Scope

- Ralph Loop status schema or direct Ralph Loop integration.
- Multiple concurrent pair runs in one Pi session.
- Non-TDD modes such as `review`, `plan`, or `debug`.
- Strict machine-readable acceptance checklist state.
- Exact attribution of pair-created changes versus pre-existing dirty changes.
- Summarization checkpoints or child session respawn for long pair runs.
- Interactive pause/inject/continue controls.
- Enforcing that Driver actually called `skill-tdd` by watching child tool calls.
- A third LLM orchestrator agent.

## Unresolved Gaps

- The exact public API for coordinator code to directly invoke `skill-tdd` through `pi-mcp-adapter` was not verified. Implementation must ground this before completing TDD verification. If direct invocation is unavailable, choose and document a fallback that still fails fast before the real pair run starts.
- The exact test harness for Pi extension tools in this repo was not found. Implementation should start with pure helper tests and add integration/manual verification if no harness exists.
- The final default test-command detection rules are not fully specified beyond `testCommand`, Navigator recommendation, and repo default detection. Implementation should keep detection conservative.

## Further Notes

- ADR: `docs/adr/0001-deterministic-pair-program-coordinator.md`.
- Glossary terms are recorded in `CONTEXT.md`.
- Quality pass applied:
  - `principle-minimize-reader-load`: area blocks are split by ownership boundary and avoid hiding runtime behavior in prose-only sections.
  - `principle-boundary-discipline`: parsing/validation belongs at tool params, MCP verification, decision parsing, and transcript/evidence boundaries; prompt construction should stay pure.
  - `principle-type-system-discipline`: decision artifacts use discriminated status/decision vocabularies instead of loose optional bags.
