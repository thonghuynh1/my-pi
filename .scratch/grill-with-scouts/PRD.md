# PRD: Grill With Scouts Managed Planning Tool

Status: ready-for-agent

## Problem Statement

Planning a cross-layer feature through a normal `grill-with-docs` session can miss important backend, frontend, QA, or runtime constraints. A single Lead Griller may recommend an option that sounds reasonable, the user may accept it, and only later does implementation reveal that a layer-specific constraint makes the option expensive or invalid.

The user wants Pi to support a deterministic managed planning mode that keeps the focused single-question grilling experience, but adds selective scout subagents, visible planning status, token-aware checkpointing, and a stronger handoff into `to-prd`. The goal is not to create a noisy agent committee. The goal is to make scout use explicit, justified, auditable, and cheap enough to use before implementation.

## Solution

Build a deterministic **Grill With Scouts Tool** in `my-pi` as a hybrid managed session command. `/grill-with-scouts` starts a **Grill With Scouts Session** where the normal Pi conversation remains human-facing, but the extension owns session state, Scout Gates, scout routing, Scout Room display, checkpointing, respawn, transcript persistence, and Scout-Grounded Handoff packaging.

The Engineering Skills MCP remains the source of planning protocol contracts. It should define canonical Scout Profiles and the Scout-Grounded Handoff format. `my-pi` executes that protocol using its existing subagent runtime and persists all canonical artifacts in the target repository under `.scratch/grill-with-scouts/`.

At the end of the session, `to-prd` consumes the Scout-Grounded Handoff in **Delta Verification** mode. Areas with tool-verified inspected paths receive targeted anchor spot-checks; partial or unverified areas receive more discovery; contradictions stop PRD generation for repair. This prevents repeated broad code discovery after a code-grounded grill.

## User Stories

1. As a Pi user, I want to start a managed planning session with `/grill-with-scouts`, so that cross-layer feature design is checked before implementation.
2. As a Pi user, I want the Lead Griller to remain the only human-facing interviewer, so that planning stays focused instead of becoming a multi-agent debate.
3. As a Pi user, I want the tool to decide when scouts are needed through a deterministic Scout Gate, so that scout use is not skipped just because the feature sounds easy.
4. As a Pi user, I want scout calls to follow a token-aware budget policy, so that the session does not fan out agents for every small decision.
5. As a Pi user, I want high-risk decisions to trigger scouts immediately, so that contract, state, runtime, cost, and cross-layer mistakes are caught early.
6. As a Pi user, I want medium-risk scout checks to ask me before spending tokens, so that I can trade speed against confidence.
7. As a Pi user, I want low-risk decisions to be skippable with an explicit reason, so that the process does not block simple planning.
8. As a Pi user, I want backend, frontend, QA, and runtime scouts to use canonical profiles, so that their reports are consistent and reusable across projects.
9. As a Pi user, I want scout agents to be stateless probes, so that the session does not waste tokens keeping dormant agents alive.
10. As a Pi user, I want the Scout Room to show what is happening, so that I can see the current tier, decision, active scouts, verdicts, context pressure, and handoff readiness.
11. As a Pi user, I want detailed scout evidence to be expandable, so that transparency is available without crowding the conversation.
12. As a Pi user, I want context pressure to be managed automatically, so that long planning sessions do not degrade as the context window fills.
13. As a Pi user, I want automatic checkpointing around 65% context and automatic respawn around 80%, so that planning can continue from compact state.
14. As a Pi user, I want respawn to be visible as a status event, so that I know a fresh Lead Griller continued from the checkpoint.
15. As a Pi user, I want all planning artifacts stored in the active target repo, so that PRD and issue generation can continue from the same repository context.
16. As a Pi user, I want full scout outputs preserved outside active context, so that bad planning can be audited later without bloating the live session.
17. As a Pi user, I want active state to keep only durable scout findings, so that the Lead Griller does not repeatedly pay tokens for raw scout reasoning.
18. As a Pi user, I want failed required scouts recorded as Scout Gaps, so that unverified planning areas do not silently become trusted.
19. As a Pi user, I want `to-prd` to consume Scout-Grounded Handoffs, so that PRD generation does not rediscover code already checked during grilling.
20. As a Pi user, I want `to-prd` to spot-check verified anchors, so that the PRD remains correct without repeating broad discovery.
21. As a Pi maintainer, I want the Grill With Scouts runtime in `my-pi`, so that Pi owns display, session state, tool telemetry, and artifact persistence.
22. As a skills maintainer, I want the Engineering Skills MCP to own the protocol contract, so that other clients can reuse the same planning model.
23. As an implementation agent, I want exact accepted decisions, rejected alternatives, Scout Gates, verified paths, claimed anchors, and Scout Gaps in the PRD, so that I can implement without reading the original conversation.

## Accepted Decision Register

- `MACRO-001`: Build a deterministic Grill With Scouts Tool.
  - Decision: This is a Pi extension tool, not only a prompt wrapper.
  - Rationale: The core value is deterministic coordination: scout gates, context thresholds, display, transcript structure, and handoff packaging.
  - Rejected alternatives: A lightweight prompt-only workflow; a pure Engineering Skills MCP protocol with no Pi runtime.
  - Downstream impact: Implement session state and UI in `my-pi`.

- `MACRO-002`: Use a hybrid managed session command.
  - Decision: `/grill-with-scouts` starts managed mode while the normal Pi conversation remains human-facing.
  - Rationale: This gives deterministic structure without making the extension a complete chat runtime.
  - Rejected alternatives: Tool owns the full conversation loop; main agent coordinates everything informally.
  - Downstream impact: Add a command/mode and state manager, not a fully separate conversation engine.

- `MACRO-003`: Produce a Scout-Grounded Handoff for `to-prd`.
  - Decision: Session output includes accepted decisions, scout evidence, verified paths, partial/unverified areas, do-not-reopen decisions, Scout Gaps, and Delta Verification instructions.
  - Rationale: This directly solves duplicate discovery after a code-grounded grill.
  - Rejected alternatives: Human-only final handoff; automatically invoke `to-prd` at session end.
  - Downstream impact: Add a handoff schema and persist it in `.scratch/grill-with-scouts/`.

- `MACRO-004`: Engineering Skills MCP owns the planning protocol contract.
  - Decision: Canonical Scout Profiles and Scout-Grounded Handoff rules live in `hackathon-grill-me`.
  - Rationale: The MCP is already the source for `grill-with-docs` and `to-prd`; protocol ownership belongs beside the consumer.
  - Rejected alternatives: Define the schema only in `my-pi`; duplicate schema in both repos.
  - Downstream impact: Add/adjust skill content in `hackathon-grill-me`; Pi loads/follows that contract.

- `MACRO-005`: Scout Profiles use a hybrid ownership model.
  - Decision: Engineering Skills MCP owns canonical Scout Profiles; `my-pi` may wrap or cache them for subagent execution and display.
  - Rationale: Keeps role definitions portable while still using Pi's existing subagent runtime.
  - Rejected alternatives: Pi-only custom agents; MCP-only definitions with no Pi wrapping.
  - Downstream impact: Add profile content in `hackathon-grill-me`; add Pi adapter/wrapper logic.

- `MESO-001`: Every material decision goes through a deterministic Scout Gate.
  - Decision: Before accepting a Macro/Meso/Micro decision, the tool records risk fields and scout requirements.
  - Rationale: Prevents the failure mode where the griller assumes a decision is easy and skips a needed layer check.
  - Rejected alternatives: Lead Griller decides entirely by prompt; fully automatic routing.
  - Downstream impact: Add Scout Gate state and require override reasons when skipping scouts.

- `MESO-002`: Use a Scout Budget Policy.
  - Decision: High-risk triggers call scouts immediately; medium-risk triggers ask the human; low-risk decisions can proceed with skip reason.
  - Rationale: Controls token waste while preserving rigor for expensive mistakes.
  - Rejected alternatives: Always call scouts; always ask before scout calls.
  - Downstream impact: Gate evaluation must produce a risk level and routing action.

- `MESO-003`: Use threshold-based checkpointing.
  - Decision: Around 50% context, maintain a compact decision ledger; around 65%, create a formal checkpoint and send checkpoints to scouts; around 80%, automatically respawn from checkpoint.
  - Rationale: Keeps the Lead Griller alive as long as useful while preventing context degradation.
  - Rejected alternatives: Manual checkpoints only; checkpoint after every scout call.
  - Downstream impact: Track context pressure and persist checkpoints.

- `MESO-004`: Persist full scout output but keep only Durable Scout Findings in active state.
  - Decision: Full scout outputs go to the Grill Artifact Store; active session state keeps compact findings only.
  - Rationale: Preserves auditability without repeated context cost.
  - Rejected alternatives: Keep full scout outputs in live context; discard scout output after summarizing.
  - Downstream impact: Add artifact persistence and a durable finding extractor.

- `MESO-005`: Use a Scout Room display.
  - Decision: The Scout Room shows the Lead Griller, available scouts, active gates, scout status, verdicts, context pressure, and handoff readiness.
  - Rationale: The human should know what is happening during deterministic planning.
  - Rejected alternatives: Existing subagent display only; compact panels only.
  - Downstream impact: Add a Pi UI surface or widget for managed session status.

- `MESO-006`: Keep Scout Room details expandable.
  - Decision: Persistent summary shows current tier, current decision, active scouts, verdicts, context pressure, and handoff readiness; gate fields, evidence anchors, and full scout outputs are expandable.
  - Rationale: The human gets visibility without overwhelming the grill conversation.
  - Rejected alternatives: Persistently show all details; status-only display.
  - Downstream impact: Display state needs summary and detail views.

- `MESO-007`: `to-prd` uses Delta Verification.
  - Decision: Verified areas get anchor spot-checks; partial areas get targeted follow-up; unverified areas get normal discovery; contradictions stop PRD generation.
  - Rationale: Prevents duplicate broad discovery while retaining correctness.
  - Rejected alternatives: Advisory handoff only; trust handoff fully.
  - Downstream impact: Update `to-prd` instructions and implementation expectations.

- `MESO-008`: Use Anchor-Level Verification.
  - Decision: Tool telemetry verifies inspected paths. Scout-declared symbols/contracts are anchor claims. `to-prd` spot-checks anchor claims.
  - Rationale: The tool can reliably prove paths were inspected, but semantic understanding still needs targeted verification.
  - Rejected alternatives: Scout self-report only; semantic verification by the tool.
  - Downstream impact: Persist inspected paths from tool-call telemetry and claimed anchors from scout output separately.

- `MICRO-001`: Failed required scouts become Scout Gaps.
  - Decision: Failed, timed-out, skipped, or unusable required scouts mark the affected area unverified.
  - Rationale: Planning may continue only with an explicit gap; unverified areas must not be treated as checked.
  - Rejected alternatives: Hard block every failed scout; retry bad scout reasoning automatically.
  - Downstream impact: Add Scout Gap records to session state and handoff.

- `MICRO-002`: Automatic Grill Respawn happens at high context pressure.
  - Decision: At the respawn threshold, the tool continues from a Grill Checkpoint automatically.
  - Rationale: The user prefers continuity and context preservation over manual approval.
  - Rejected alternatives: Ask human before respawn; warn only.
  - Downstream impact: Add respawn status and state restoration behavior.

- `MICRO-003`: Show Respawn Status Events.
  - Decision: Respawn shows a compact status event: checkpoint created, fresh Lead Griller continued, tier preserved, next question unchanged, details expandable.
  - Rationale: Automatic respawn should be visible, not silent.
  - Rejected alternatives: Full checkpoint dump; silent respawn.
  - Downstream impact: Scout Room needs a respawn event row.

- `MICRO-004`: Use project-local Grill Artifact Store.
  - Decision: Canonical artifacts live under the active target repo's `.scratch/grill-with-scouts/`.
  - Rationale: The user opens the target repo in Pi, runs planning there, and expects PRD/issues to live there too.
  - Rejected alternatives: Pi global data directory; split global/repo storage.
  - Downstream impact: Write session artifacts to the active `ctx.cwd` repository.

## Implementation Plan

### Area: Pi managed session runtime

- **Decision IDs**: `MACRO-001`, `MACRO-002`, `MESO-001`, `MESO-002`, `MESO-003`, `MICRO-002`, `MICRO-003`
- **Current code anchors**:
  - `F:/MyWork/my-pi/extensions/subagents.ts`: registers the existing `subagent` tool, `/subagent`, `/subagents`, and model-selection commands.
  - `F:/MyWork/my-pi/extensions/subagents.ts`: `runSubagent()` creates isolated child `AgentSession`s and streams status through `onUpdate` and `statusSink`.
  - `F:/MyWork/my-pi/extensions/tool-panel.ts`: shows how a Pi extension observes tool lifecycle events and renders session-adjacent UI.
  - `F:/MyWork/my-pi/extensions/engineering-skills.ts`: configures and displays Engineering Skills MCP status.
  - `F:/MyWork/my-pi/package.json`: extension discovery uses `"./extensions"`.
- **Existing behavior**: Pi has an opt-in subagent workflow mode and a reusable child-agent runtime, but no managed planning session, Scout Gate, Scout Room, checkpointing, or Grill Respawn.
- **Required edits**:
  - Add a new Grill With Scouts extension module under `extensions/` or a tightly scoped submodule if sharing subagent runtime requires local exports.
  - Register `/grill-with-scouts` to start or show a Grill With Scouts Session.
  - Maintain deterministic session state: session id, goal, current tier, current decision, accepted decisions, Scout Gates, active scouts, Durable Scout Findings, Scout Gaps, context pressure, checkpoints, handoff readiness.
  - Add Scout Gate evaluation fields: boundary crossing, contract/payload/schema/state/lifecycle change, runtime risk, unverified layer assumption, failure cost, selected profiles, budget action, skip reason.
  - Implement Scout Budget Policy: immediate for high-risk fields, prompt human for medium-risk fields, allow skip reason for low-risk fields.
  - Track context pressure from Pi context usage where available; enforce ledger/checkpoint/respawn thresholds.
  - Implement Respawn Status Event as a Scout Room event and preserve the current tier/next question across respawn.
- **Snippet(s)**:

```ts
// current code anchor -- subagent child runtime shape
async function runSubagent(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	toolCallId: string,
	params: SubagentParamsType,
	onUpdate: ((partial: { content: Array<{ type: "text"; text: string }>; details?: Partial<SubagentDetails> }) => void) | undefined,
	statusSink?: SubagentStatusSink,
): Promise<SubagentDetails> {
```

Normative: Grill With Scouts should reuse this child-agent execution model or extract a shared helper rather than spawning a second unrelated child-agent runner.

```ts
// decision artifact -- normative Scout Gate fields
interface ScoutGate {
	id: string;
	tier: "macro" | "meso" | "micro";
	decisionUnderReview: string;
	crossesBoundary: boolean;
	changesContractOrState: boolean;
	introducesLifecycle: boolean;
	hasRuntimeRisk: boolean;
	hasUnverifiedLayerAssumption: boolean;
	hasMeaningfulFailureCost: boolean;
	riskLevel: "low" | "medium" | "high";
	selectedScoutProfiles: string[];
	budgetAction: "call-now" | "ask-human" | "skip-with-reason";
	skipReason?: string;
}
```

Normative: every accepted material decision must have a Scout Gate record or be explicitly marked as non-material.

- **Tests to extend**:
  - Add pure helper tests if the repo adds a test harness; otherwise verify with `npm run check`.
  - Test Scout Gate classification helpers separately from Pi UI wiring where possible.
  - Manually verify `/grill-with-scouts` starts and shows session status in Pi.
- **Wiring/build notes**: `package.json` already loads `./extensions`; a new file under `extensions/` should be auto-loaded if Pi's extension loader imports directory entries consistently. Verify against existing extension discovery behavior before relying on it.

### Area: Scout Profile loading and scout execution

- **Decision IDs**: `MACRO-004`, `MACRO-005`, `MESO-001`, `MESO-002`, `MESO-008`, `MICRO-001`
- **Current code anchors**:
  - `F:/MyWork/my-pi/extensions/engineering-skills.ts`: configures the Engineering Skills MCP in global MCP config.
  - `F:/MyWork/my-pi/extensions/subagents.ts`: `type="custom"` currently loads markdown agents from package/user/project agent directories.
  - `F:/MyWork/PrecioHackathon/hackathon-grill-me/src/index.ts`: exposes skills and prompts as MCP tools.
  - `F:/MyWork/PrecioHackathon/hackathon-grill-me/src/loader.ts`: discovers skills/prompts/instructions/domain/pstack content.
- **Existing behavior**: Pi can run custom subagents from markdown files, and Engineering Skills MCP can expose skills/prompts. There is no canonical Scout Profile contract or Pi bridge from MCP profile content into subagent execution.
- **Required edits**:
  - Add canonical Scout Profiles in Engineering Skills MCP. Backend, frontend, QA, and runtime are required initial profiles.
  - Expose Scout Profiles through the existing MCP mechanism or a new MCP tool/resource if profiles need parameters.
  - In `my-pi`, load/cached Scout Profiles through the configured Engineering Skills MCP before or during a Grill With Scouts Session.
  - Convert a Scout Profile plus bounded Scout Gate brief into a subagent prompt.
  - Keep scouts stateless: each scout receives the current Grill Checkpoint, the decision under review, the selected profile scope, known anchors, and the required verdict format.
  - Record full scout output in the Grill Artifact Store and extract Durable Scout Findings into active state.
  - If a required scout fails, times out, is skipped by acknowledged budget choice, or returns unusable output, record a Scout Gap.
- **Snippet(s)**:

```ts
// current code anchor -- engineering-skills server identity
const SERVER_NAME = "engineering-skills";
const STATUS_KEY = "engineering-skills";
const GLOBAL_MCP_CONFIG = join(homedir(), ".config", "mcp", "mcp.json");
```

Normative: Grill With Scouts must use the existing Engineering Skills MCP configuration rather than inventing a separate profile source.

```ts
// current code anchor -- custom subagent detail includes tool calls today
interface SubagentDetails {
	type: SubagentType;
	name: string;
	task: string;
	cwd: string;
	tools: string[];
	status: "completed" | "error";
	output: string;
	turns: number;
	toolCalls: Array<{ name: string; args: unknown; isError?: boolean }>;
}
```

Normative: existing `toolCalls` are enough to start recording which tools ran, but Anchor-Level Verification needs inspected paths derived from read/grep/find/ls args and, where available, tool result metadata.

```text
// decision artifact -- scout verdict format, normative
Verdict: viable | risky | blocked | needs-decision
Evidence: <specific files/docs/patterns, or "not found">
Concern: <one concrete issue, or "none">
Required decision: <one question for the Lead Griller to ask, or "none">
Claimed anchors: <symbols/contracts/events/state names, or "none">
Confidence: verified | partial | unverified
```

Normative: confidence in the scout text is not sufficient for handoff verification status; the tool computes inspected paths from telemetry.

- **Tests to extend**:
  - Engineering Skills MCP loader tests should assert Scout Profiles are discoverable through the chosen mechanism.
  - Pi-side tests or manual checks should verify Scout Profile loading failure creates a Scout Gap or blocks scout execution with a clear status.
  - Verify failed scout execution records a Scout Gap in session state and handoff.
- **Wiring/build notes**: If Scout Profiles are implemented as a new content type, `hackathon-grill-me/src/loader.ts`, `src/index.ts`, and `test/loader.test.ts` will need updates. If implemented as a skill or prompt directory, use the existing discovery path.

### Area: Scout Room display and status

- **Decision IDs**: `MESO-005`, `MESO-006`, `MICRO-003`
- **Current code anchors**:
  - `F:/MyWork/my-pi/extensions/tool-panel.ts`: registers a panel-like extension and tracks tool lifecycle records.
  - `F:/MyWork/my-pi/extensions/usage-footer.ts`: shows model/context usage and subagent totals in footer status.
  - `F:/MyWork/my-pi/extensions/subagents.ts`: `renderCall()` and `renderResult()` customize subagent tool display.
  - `F:/MyWork/my-pi/extensions/frontend-coach/index.ts`: uses `ctx.ui.setStatus`, `ctx.ui.notify`, and `ctx.ui.custom` for richer UI flows.
- **Existing behavior**: Pi displays subagent calls and can show tool-panel/footer/status widgets. No Scout Room exists.
- **Required edits**:
  - Add a Scout Room display surface for managed sessions.
  - Persistent Scout Room Summary must show current tier, current decision, active scouts, latest scout verdicts, context pressure, and handoff readiness.
  - Expandable details must include Scout Gate trigger fields, budget action, inspected paths, claimed anchors, Scout Gaps, checkpoint list, respawn events, and links/paths to persisted artifacts.
  - Show Respawn Status Events compactly: checkpoint created, fresh Lead Griller continued, current tier preserved, next question unchanged.
  - Do not dump full scout outputs into the persistent summary; link to the Grill Artifact Store path instead.
- **Snippet(s)**:

```ts
// current code anchor -- subagent result rendering pattern
renderResult(result, { expanded }, theme) {
	const details = result.details as SubagentDetails | undefined;
	if (!details) {
		const text = result.content[0];
		return new Text(text?.type === "text" ? text.text : "", 0, 0);
	}
```

Illustrative: Scout Room can follow the same compact/expanded rendering pattern.

```text
// decision artifact -- persistent summary contents, normative
Scout Room Summary:
- Tier: Macro | Meso | Micro
- Current decision
- Active Scout Gate id
- Active scouts and latest verdicts
- Context pressure
- Handoff readiness
```

- **Tests to extend**:
  - Manual TUI verification for compact and expanded Scout Room states.
  - `npm run check` after TypeScript changes.
  - Verify Scout Room remains readable when no scouts have been called.
- **Wiring/build notes**: Prefer existing Pi UI primitives already used in `tool-panel.ts` and `frontend-coach/index.ts`.

### Area: Grill Artifact Store and handoff persistence

- **Decision IDs**: `MACRO-003`, `MESO-003`, `MESO-004`, `MICRO-001`, `MICRO-004`
- **Current code anchors**:
  - `F:/MyWork/my-pi/.scratch/subagent-batch-coach/PRD.md`: existing local planning artifact pattern.
  - `F:/MyWork/my-pi/extensions/frontend-coach/records.ts`: writes structured JSON and Markdown records to disk.
  - `F:/MyWork/my-pi/extensions/subagents.ts`: already accumulates subagent details, usage, and tool calls in memory.
- **Existing behavior**: The repo uses `.scratch/<feature>/PRD.md` and issue files. Some extensions persist records, but Grill With Scouts has no artifact store.
- **Required edits**:
  - Create `.scratch/grill-with-scouts/` in the active target repo when the first session artifact is written.
  - Persist `session.json`, `transcript.md`, `handoff.md`, checkpoints, and scout outputs under a session id.
  - Maintain `.scratch/grill-with-scouts/latest-handoff.md` as a pointer or copy for `to-prd`.
  - Store full scout outputs under `scouts/`; store Durable Scout Findings in `session.json` and `handoff.md`.
  - Store Scout Gaps in both session state and handoff.
  - Ensure artifact writes are idempotent and safe to retry.
- **Snippet(s)**:

```text
// decision artifact -- normative artifact layout
.scratch/grill-with-scouts/
  latest-handoff.md
  sessions/
    <session-id>/
      session.json
      transcript.md
      handoff.md
      checkpoints/
        001.md
        latest.md
      scouts/
        <gate-id>-backend.md
        <gate-id>-frontend.md
        <gate-id>-qa.md
        <gate-id>-runtime.md
```

Normative: canonical planning artifacts live in the active target repo, not a Pi global data directory.

```ts
// current code anchor -- record persistence precedent
writeFileSync(paths.json, JSON.stringify(report, null, 2), "utf8");
writeFileSync(paths.md, renderMarkdown(report), "utf8");
```

Illustrative: the Grill Artifact Store should write both machine-readable JSON and human-readable Markdown artifacts.

- **Tests to extend**:
  - Add filesystem helper tests if test harness exists; otherwise verify by running a sample session and inspecting `.scratch/grill-with-scouts/`.
  - Verify repeated checkpoint writes update `latest.md` without deleting prior numbered checkpoints.
- **Wiring/build notes**: Use the active `ctx.cwd` as the target repo root. Do not write canonical planning artifacts to Pi global storage.

### Area: Anchor-Level Verification telemetry

- **Decision IDs**: `MESO-008`
- **Current code anchors**:
  - `F:/MyWork/my-pi/extensions/subagents.ts`: child session subscription records `tool_execution_start` and `tool_execution_end`.
  - `F:/MyWork/my-pi/extensions/tool-panel.ts`: parent-level tool lifecycle recording includes args, result text, status, and summaries.
- **Existing behavior**: `SubagentDetails.toolCalls` records tool names and args, but does not derive inspected paths or persist tool result evidence for verification.
- **Required edits**:
  - Extend scout execution details with inspected paths derived from read/grep/find/ls tool calls.
  - Preserve enough tool result metadata to distinguish a path searched from a path actually read, where available.
  - Record tool-verified inspected paths separately from scout-claimed anchors.
  - In the handoff, mark areas as:
    - `path-verified, anchor-claimed`
    - `partial`
    - `unverified`
  - Do not mark a claimed symbol/contract as verified solely because the scout named it.
- **Snippet(s)**:

```ts
// current code anchor -- child tool lifecycle recording
case "tool_execution_start": {
	toolCalls.push({ name: event.toolName, args: event.args });
	liveStatus.currentTool = event.toolName;
	liveStatus.preview = `running ${event.toolName}`;
	publishStatus();
	break;
}
```

Normative: extend or post-process this event stream to derive inspected paths for Scout-Grounded Handoffs.

```text
// decision artifact -- handoff verification record, normative
Area: Backend API
Verification status: path-verified, anchor-claimed
Tool-verified paths:
- src/core/runs/agent-client.ts
- src/core/runs/controlled-runner.ts
Scout-claimed anchors:
- AgentClient.execute result type
- ControlledRunner.run final result object
Delta verification instruction:
- Spot-check claimed anchors only. Do not redo broad backend discovery unless anchors are missing or contradictory.
```

- **Tests to extend**:
  - Unit-test path extraction from representative tool args for read, grep, find, and ls.
  - Verify a scout that only claims anchors without inspected paths produces `partial` or `unverified`, not `verified`.
- **Wiring/build notes**: Tool result content may be large; persist raw result details only in the audit transcript, not active state.

### Area: Engineering Skills MCP Scout Profiles

- **Decision IDs**: `MACRO-004`, `MACRO-005`
- **Current code anchors**:
  - `F:/MyWork/PrecioHackathon/hackathon-grill-me/skills/grill-with-docs/SKILL.md`: current planning skill extension over `grill-me`.
  - `F:/MyWork/PrecioHackathon/hackathon-grill-me/prompts/grill-me.md`: base single-question interrogation protocol.
  - `F:/MyWork/PrecioHackathon/hackathon-grill-me/src/loader.ts`: content discovery for skills, prompts, instructions, domain skills, and pstack skills.
  - `F:/MyWork/PrecioHackathon/hackathon-grill-me/src/index.ts`: MCP tool registration.
  - `F:/MyWork/PrecioHackathon/hackathon-grill-me/test/loader.test.ts`: loader test coverage.
- **Existing behavior**: Engineering Skills MCP exposes skills and prompts, but does not expose Scout Profiles or the Scout-Grounded Handoff contract.
- **Required edits**:
  - Add canonical Scout Profiles for backend, frontend, QA, and runtime.
  - Define each profile's scope, trigger fit, evidence requirements, and verdict format.
  - Expose profiles through MCP in a way Pi can load deterministically.
  - Update README/tool listing if a new MCP tool or resource category is added.
  - Keep profile bodies small enough for repeated scout calls; the current Grill Checkpoint supplies project-specific context.
- **Snippet(s)**:

```ts
// current code anchor -- skills/prompts exposed as MCP tools
for (const tool of tools) {
  server.tool(tool.name, tool.description, async () => {
    if (tool.name.startsWith("skill-")) {
      const skillName = tool.name.replace(/^skill-/, "");
      const skill = getSkill(skillName);
```

Illustrative: Scout Profiles can be exposed with a similar loader/registration pattern or as instruction resources.

```text
// decision artifact -- Scout Profile fields, normative
Scout Profile:
- name
- description
- trigger fit
- scope
- evidence requirements
- verdict format
- forbidden behaviors
```

- **Tests to extend**:
  - Add loader tests proving all default Scout Profiles are discoverable.
  - Add MCP/tool description tests if a new tool is introduced.
- **Wiring/build notes**: If profiles are new top-level content, update `ContentRegistry` and default exports. If profiles are modeled as a skill, use `skill-grill-with-scouts-profiles` or similar and avoid new loader plumbing.

### Area: `to-prd` Delta Verification support

- **Decision IDs**: `MACRO-003`, `MESO-007`, `MESO-008`, `MICRO-001`
- **Current code anchors**:
  - `F:/MyWork/PrecioHackathon/hackathon-grill-me/skills/to-prd/SKILL.md`: current PRD workflow and code-grounding pass.
  - `F:/MyWork/PrecioHackathon/hackathon-grill-me/skills/review-implementation-readiness/SKILL.md`: readiness review checks for AFK implementability.
- **Existing behavior**: `to-prd` always performs a code-grounding pass if repo access exists. It does not distinguish areas already verified by a Scout-Grounded Handoff from areas needing normal discovery.
- **Required edits**:
  - Update `to-prd` to detect or accept a Scout-Grounded Handoff.
  - Add Delta Verification rules:
    - `path-verified, anchor-claimed`: spot-check named anchors only.
    - `partial`: targeted follow-up only in the named area.
    - `unverified` or Scout Gap: normal discovery or explicit unresolved gap.
    - contradiction: stop and report repair needed.
  - Preserve do-not-reopen decisions unless verification contradicts the handoff.
  - Add a PRD section or area-block fields for scout evidence and verification status.
  - Avoid broad rediscovery for verified areas.
- **Snippet(s)**:

```md
<!-- current code anchor -- to-prd requires code grounding today -->
Before writing the PRD, perform a code-grounding pass. Inspect the files, tests, and wiring that are likely to change. Capture verified implementation anchors, not guesses:

- Target files and symbols that probably need edits.
- Existing call paths, state machines, interfaces, commands, handlers, components, or services the feature must connect to.
```

Normative change: this remains true only for areas without Scout-Grounded Handoff verification. Verified areas get Delta Verification.

```text
// decision artifact -- Delta Verification rules, normative
verified area -> spot-check claimed anchors
partial area -> targeted follow-up
unverified area -> normal discovery
contradiction -> stop PRD generation and report repair needed
```

- **Tests to extend**:
  - No executable tests likely exist for markdown skills. Add fixture/eval or documentation examples if the repo has a skill evaluation path.
  - Manually run `to-prd` on a sample Scout-Grounded Handoff and verify it does not redo broad discovery for verified areas.
- **Wiring/build notes**: This is a skill/protocol change unless `to-prd` is backed by executable tooling elsewhere.

## Global Build & Wiring Notes

- `my-pi` verification command: `npm run check`.
- `hackathon-grill-me` likely uses Vitest for loader tests; existing loader tests live in `test/loader.test.ts`.
- Engineering Skills MCP must remain configured through the existing `/engineering-skills-mcp-setup` flow.
- The active target repo owns Grill With Scouts artifacts under `.scratch/grill-with-scouts/`.
- Avoid adding a parallel child-agent runner if the existing subagent runtime can be extracted or reused.
- Do not keep scout agents alive across the session. Scouts are stateless probes; continuity lives in Grill Checkpoints and Durable Scout Findings.

## Testing Decisions

- Test deterministic logic as pure helpers where possible:
  - Scout Gate risk classification
  - Scout Budget Policy routing
  - context threshold decisions
  - inspected path extraction
  - handoff verification-status derivation
- Test Pi wiring with focused manual checks because much of the surface is TUI/session behavior:
  - `/grill-with-scouts` starts a managed session.
  - Scout Room Summary displays current tier, decision, scout status, context pressure, and handoff readiness.
  - Expanded Scout Room shows gate fields, evidence anchors, and artifact paths.
  - Failed scout creates a Scout Gap.
  - Handoff is written to `.scratch/grill-with-scouts/latest-handoff.md`.
- Test Engineering Skills MCP content discovery if new Scout Profile content type is added.
- Test `to-prd` behavior through a sample Scout-Grounded Handoff:
  - verified area triggers anchor spot-check only
  - partial area triggers targeted follow-up
  - unverified area triggers normal discovery
  - contradiction stops PRD generation

## Out of Scope

- Implementing the tool in this PRD step.
- Automatically invoking `to-prd` at the end of a Grill With Scouts Session.
- Keeping backend/frontend/QA/runtime scouts alive for the whole session.
- Building semantic verification that proves a scout understood a symbol or contract.
- Replacing `grill-with-docs`; the new tool composes with the Engineering Skills MCP protocol.
- Moving canonical planning artifacts into Pi global storage.

## Unresolved Gaps

- None for product direction.

Implementation agents should still verify exact Pi extension APIs for custom widgets/status rendering before coding the Scout Room. The accepted contract is the Scout Room behavior, not a specific UI primitive.

## Further Notes

The existing `CONTEXT.md` glossary has already been updated with the resolved Grill With Scouts terms. Future implementation should preserve those terms rather than introducing competing labels like "design review tool", "scout session manager", or "planning room".
