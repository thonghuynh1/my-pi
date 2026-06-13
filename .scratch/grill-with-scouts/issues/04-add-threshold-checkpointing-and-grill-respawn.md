# Add threshold checkpointing and Grill Respawn

Status: ready-for-agent

## What to build

Add context-pressure handling to Grill With Scouts sessions: compact ledger behavior around 50%, formal Grill Checkpoints around 65%, and automatic Grill Respawn around 80% with a visible Respawn Status Event.

Decision IDs: `MESO-003`, `MESO-004`, `MICRO-002`, `MICRO-003`

## Implementation map

### Area: Pi managed session runtime

- **Decision IDs**: `MESO-003`, `MICRO-002`, `MICRO-003`
- **Current code anchors**:
  - `F:/MyWork/my-pi/extensions/subagents.ts`: `publishStatus()` reads child context usage when available.
  - `F:/MyWork/my-pi/extensions/usage-footer.ts`: shows parent model/context usage and subagent totals.
  - `F:/MyWork/my-pi/extensions/tool-panel.ts`: refreshes UI from session lifecycle events.
- **Existing behavior**: Pi can display usage/context data, but Grill With Scouts has no checkpoint or respawn policy.
- **Required edits**:
  - Track context pressure for the managed session using available Pi context usage APIs.
  - Around 50%, enforce maintaining a compact decision ledger in session state.
  - Around 65%, create a formal Grill Checkpoint and use checkpoint summaries in later scout prompts.
  - Around 80%, automatically perform Grill Respawn from the latest checkpoint.
  - Preserve current tier and next question across respawn.
  - Emit a Respawn Status Event in the Scout Room.
- **Snippet(s)**:

```ts
// current code anchor -- context usage precedent in subagent status
const usage = (session as { getContextUsage?: () => { tokens: number | null; contextWindow: number; percent: number | null } | undefined }).getContextUsage?.();
if (usage) {
	liveStatus.contextTokens = usage.tokens;
	liveStatus.contextWindow = usage.contextWindow;
	liveStatus.contextPercent = usage.percent;
}
```

Illustrative: use the parent session's equivalent context usage source for Grill With Scouts thresholds.

### Area: Grill Artifact Store and handoff persistence

- **Decision IDs**: `MESO-003`, `MESO-004`
- **Current code anchors**:
  - `F:/MyWork/my-pi/.scratch/subagent-batch-coach/PRD.md`: existing local planning artifact pattern.
  - `F:/MyWork/my-pi/extensions/frontend-coach/records.ts`: writes structured JSON and Markdown records to disk.
- **Existing behavior**: Grill With Scouts artifacts do not yet include checkpoints.
- **Required edits**:
  - Persist numbered checkpoints under `sessions/<session-id>/checkpoints/`.
  - Maintain `checkpoints/latest.md`.
  - Checkpoint content must include goal, current tier, accepted decisions, user-accepted assumptions, unresolved questions, Durable Scout Findings, glossary deltas, ADR candidates, contract artifacts, and next question.
  - Full scout outputs stay out of checkpoint body; include references to artifact paths.
- **Snippet(s)**:

```text
// decision artifact -- checkpoint contents, normative
Grill Checkpoint:
- goal
- current tier
- accepted decisions
- user-accepted assumptions
- unresolved material questions
- Durable Scout Findings
- Scout Gaps
- glossary deltas
- ADR candidates
- contract artifacts
- next question
```

### Area: Scout Room display and status

- **Decision IDs**: `MICRO-003`
- **Current code anchors**:
  - `F:/MyWork/my-pi/extensions/tool-panel.ts`: display refresh patterns.
  - `F:/MyWork/my-pi/extensions/subagents.ts`: compact/expanded render patterns.
- **Required edits**:
  - Show Respawn Status Event compactly: checkpoint created, fresh Lead Griller continued, current tier preserved, next question unchanged.
  - Make checkpoint details expandable, not dumped into the main conversation.

## Acceptance criteria

- [ ] Session state tracks context pressure.
- [ ] At checkpoint threshold, a formal checkpoint is written to `checkpoints/<n>.md` and `checkpoints/latest.md`.
- [ ] Later scout prompts can use the latest checkpoint instead of raw transcript.
- [ ] At respawn threshold, the session automatically continues from the latest checkpoint.
- [ ] Respawn Status Event is visible in the Scout Room.
- [ ] Checkpoint details are expandable or linked, not dumped into the persistent Scout Room Summary.
- [ ] Runtime evidence captured: manual Pi session or test harness demonstrating checkpoint creation and respawn status, plus `npm run check`.

## Blocked by

- `02-add-grill-with-scouts-session-scaffold-and-artifact-store.md`
- `03-add-scout-gate-budget-policy-and-scout-room-summary.md`
