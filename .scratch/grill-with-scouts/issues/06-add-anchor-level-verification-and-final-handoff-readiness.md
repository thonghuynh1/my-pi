# Add Anchor-Level Verification and final handoff readiness

Status: ready-for-agent

## What to build

Complete the end-to-end Grill With Scouts handoff path: derive tool-verified inspected paths from scout telemetry, keep scout-claimed anchors separate, compute verification statuses, write the final Scout-Grounded Handoff, and make it ready for `to-prd` Delta Verification.

Decision IDs: `MACRO-003`, `MESO-007`, `MESO-008`, `MICRO-001`, `MICRO-004`

## Implementation map

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

### Area: Grill Artifact Store and handoff persistence

- **Decision IDs**: `MACRO-003`, `MICRO-001`, `MICRO-004`
- **Current code anchors**:
  - `F:/MyWork/my-pi/.scratch/subagent-batch-coach/PRD.md`: existing local planning artifact pattern.
  - `F:/MyWork/my-pi/extensions/frontend-coach/records.ts`: writes structured JSON and Markdown records to disk.
- **Existing behavior**: Session artifacts can exist, but final Scout-Grounded Handoff readiness and verification statuses do not.
- **Required edits**:
  - Write final `handoff.md` with accepted decisions, Scout Gates, Durable Scout Findings, Scout Gaps, tool-verified paths, scout-claimed anchors, verification statuses, and Delta Verification instructions.
  - Update `.scratch/grill-with-scouts/latest-handoff.md`.
  - Include do-not-reopen decisions unless verification contradicts them.
  - Mark handoff readiness in session state and Scout Room.
- **Snippet(s)**:

```text
// decision artifact -- final handoff sections, normative
Scout-Grounded Handoff:
- accepted decisions
- user-accepted assumptions
- Scout Gates
- Durable Scout Findings
- Scout Gaps
- tool-verified inspected paths
- scout-claimed anchors
- verification status by area
- Delta Verification instructions for to-prd
- do-not-reopen decisions
```

### Area: `to-prd` Delta Verification support

- **Decision IDs**: `MESO-007`, `MESO-008`, `MICRO-001`
- **Current code anchors**:
  - `F:/MyWork/PrecioHackathon/hackathon-grill-me/skills/to-prd/SKILL.md`: current PRD workflow and code-grounding pass.
- **Existing behavior**: After issue 01, `to-prd` should understand Delta Verification. This issue verifies Pi emits the expected handoff fields.
- **Required edits**:
  - Ensure the Pi handoff uses the exact contract accepted in Engineering Skills MCP.
  - Include Delta Verification instructions per area:
    - verified area -> spot-check claimed anchors
    - partial area -> targeted follow-up
    - unverified area -> normal discovery
    - contradiction -> stop PRD generation and report repair needed
- **Snippet(s)**:

```text
// decision artifact -- Delta Verification rules, normative
verified area -> spot-check claimed anchors
partial area -> targeted follow-up
unverified area -> normal discovery
contradiction -> stop PRD generation and report repair needed
```

### Global build and wiring notes

- This is the final handoff-readiness slice and depends on scout execution.
- `my-pi` verification command: `npm run check`.

## Acceptance criteria

- [ ] Scout telemetry derives inspected paths from read/grep/find/ls tool calls.
- [ ] Tool-verified inspected paths and scout-claimed anchors are stored separately.
- [ ] Handoff marks each area as `path-verified, anchor-claimed`, `partial`, or `unverified`.
- [ ] Scout Gaps prevent affected areas from being marked verified.
- [ ] `handoff.md` and `latest-handoff.md` include all required Scout-Grounded Handoff sections.
- [ ] Scout Room marks handoff readiness when the final handoff is complete.
- [ ] A sample handoff can be consumed by `to-prd` without broad rediscovery for verified areas.
- [ ] Runtime evidence captured: generated sample `latest-handoff.md`, a `to-prd` dry/manual run summary showing Delta Verification behavior, and `npm run check`.

## Blocked by

- `01-add-scout-profiles-and-handoff-contract.md`
- `04-add-threshold-checkpointing-and-grill-respawn.md`
- `05-wire-scout-profile-loading-and-stateless-scout-execution.md`
