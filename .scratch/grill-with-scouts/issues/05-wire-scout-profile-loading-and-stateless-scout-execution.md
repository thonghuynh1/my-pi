# Wire Scout Profile loading and stateless scout execution

Status: ready-for-agent

## What to build

Connect Grill With Scouts sessions to canonical Scout Profiles from Engineering Skills MCP, execute required scouts as stateless subagent probes, persist full scout output, extract Durable Scout Findings, and record Scout Gaps on failure.

Decision IDs: `MACRO-004`, `MACRO-005`, `MESO-001`, `MESO-002`, `MESO-004`, `MICRO-001`

## Implementation map

### Area: Scout Profile loading and scout execution

- **Decision IDs**: `MACRO-004`, `MACRO-005`, `MESO-001`, `MESO-002`, `MICRO-001`
- **Current code anchors**:
  - `F:/MyWork/my-pi/extensions/engineering-skills.ts`: configures the Engineering Skills MCP in global MCP config.
  - `F:/MyWork/my-pi/extensions/subagents.ts`: `type="custom"` currently loads markdown agents from package/user/project agent directories.
  - `F:/MyWork/my-pi/extensions/subagents.ts`: `runSubagent()` creates isolated child `AgentSession`s and records output, turns, tool calls, and usage.
  - `F:/MyWork/PrecioHackathon/hackathon-grill-me/src/index.ts`: exposes skills and prompts as MCP tools.
- **Existing behavior**: Pi can run custom subagents from markdown files, and Engineering Skills MCP can expose skills/prompts. There is no Pi bridge from MCP Scout Profile content into subagent execution.
- **Required edits**:
  - Load/cached Scout Profiles through the configured Engineering Skills MCP before or during a Grill With Scouts Session.
  - Convert a Scout Profile plus bounded Scout Gate brief into a subagent prompt.
  - Keep scouts stateless: each scout receives the current Grill Checkpoint, the decision under review, selected profile scope, known anchors, and required verdict format.
  - Execute selected scouts using the existing child-agent runtime or a shared extracted helper.
  - Persist full scout output under `sessions/<session-id>/scouts/`.
  - Extract Durable Scout Findings into active session state.
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

```text
// decision artifact -- scout verdict format, normative
Verdict: viable | risky | blocked | needs-decision
Evidence: <specific files/docs/patterns, or "not found">
Concern: <one concrete issue, or "none">
Required decision: <one question for the Lead Griller to ask, or "none">
Claimed anchors: <symbols/contracts/events/state names, or "none">
Confidence: verified | partial | unverified
```

Normative: confidence in the scout text is not sufficient for handoff verification status; telemetry-derived inspected paths are handled in the follow-up verification slice.

### Area: Grill Artifact Store and handoff persistence

- **Decision IDs**: `MESO-004`, `MICRO-001`
- **Current code anchors**:
  - `F:/MyWork/my-pi/extensions/frontend-coach/records.ts`: writes structured JSON and Markdown records to disk.
  - `F:/MyWork/my-pi/extensions/subagents.ts`: accumulates subagent details, usage, and tool calls in memory.
- **Existing behavior**: Full scout output is not persisted because scouts do not exist yet.
- **Required edits**:
  - Store full scout outputs under `scouts/`.
  - Store Durable Scout Findings in `session.json` and `handoff.md`.
  - Store Scout Gaps in both session state and handoff.
  - Do not keep full scout output in active state.
- **Snippet(s)**:

```text
// decision artifact -- scout artifact naming, normative
sessions/<session-id>/scouts/<gate-id>-backend.md
sessions/<session-id>/scouts/<gate-id>-frontend.md
sessions/<session-id>/scouts/<gate-id>-qa.md
sessions/<session-id>/scouts/<gate-id>-runtime.md
```

### Area: Scout Room display and status

- **Decision IDs**: `MESO-005`, `MESO-006`
- **Required edits**:
  - Show active scouts while running.
  - Show latest scout verdicts after completion.
  - Link or display paths to full scout output artifacts in expanded details.
  - Show Scout Gaps clearly.

## Acceptance criteria

- [ ] Grill With Scouts can load backend, frontend, QA, and runtime Scout Profiles from Engineering Skills MCP.
- [ ] A required Scout Gate can launch the selected scouts as stateless subagent probes.
- [ ] Each scout receives a compact prompt containing the current checkpoint, decision under review, profile scope, known anchors, and verdict format.
- [ ] Full scout output is written to `sessions/<session-id>/scouts/`.
- [ ] Durable Scout Findings are stored in active session state and handoff.
- [ ] Failed, timed-out, skipped, or unusable required scouts create Scout Gaps.
- [ ] Scout Room shows running scouts, verdicts, and Scout Gaps.
- [ ] Runtime evidence captured: manual Pi session showing at least one scout run and persisted scout artifact, plus `npm run check`.

## Blocked by

- `01-add-scout-profiles-and-handoff-contract.md`
- `02-add-grill-with-scouts-session-scaffold-and-artifact-store.md`
- `03-add-scout-gate-budget-policy-and-scout-room-summary.md`
