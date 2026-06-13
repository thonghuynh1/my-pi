# Add Scout Gate, budget policy, and Scout Room summary

Status: ready-for-agent

## What to build

Extend the managed session scaffold with deterministic Scout Gate records, Scout Budget Policy routing, and a persistent Scout Room Summary. This slice makes the planning process visible and auditable before scout execution exists.

Decision IDs: `MESO-001`, `MESO-002`, `MESO-005`, `MESO-006`

## Implementation map

### Area: Pi managed session runtime

- **Decision IDs**: `MESO-001`, `MESO-002`
- **Current code anchors**:
  - `F:/MyWork/my-pi/extensions/subagents.ts`: existing extension state patterns for `subagentModeEnabled`, active subagents, and status updates.
  - `F:/MyWork/my-pi/extensions/tool-panel.ts`: shows how a Pi extension observes session/tool state and refreshes UI.
- **Existing behavior**: No Scout Gate exists. The Lead Griller can currently skip scout-style review by prompt behavior alone.
- **Required edits**:
  - Add Scout Gate state records to the Grill With Scouts Session.
  - Add Scout Gate evaluation fields: boundary crossing, contract/payload/schema/state/lifecycle change, runtime risk, unverified layer assumption, failure cost, selected profiles, budget action, skip reason.
  - Implement Scout Budget Policy:
    - high risk -> `call-now`
    - medium risk -> `ask-human`
    - low risk -> `skip-with-reason`
  - Persist Scout Gate records into `session.json` and `transcript.md`.
- **Snippet(s)**:

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

### Area: Scout Room display and status

- **Decision IDs**: `MESO-005`, `MESO-006`
- **Current code anchors**:
  - `F:/MyWork/my-pi/extensions/tool-panel.ts`: registers a panel-like extension and tracks tool lifecycle records.
  - `F:/MyWork/my-pi/extensions/usage-footer.ts`: shows model/context usage and subagent totals in footer status.
  - `F:/MyWork/my-pi/extensions/subagents.ts`: `renderCall()` and `renderResult()` customize subagent tool display.
  - `F:/MyWork/my-pi/extensions/frontend-coach/index.ts`: uses `ctx.ui.setStatus`, `ctx.ui.notify`, and `ctx.ui.custom` for richer UI flows.
- **Existing behavior**: Pi displays subagent calls and can show tool-panel/footer/status widgets. No Scout Room exists.
- **Required edits**:
  - Add a Scout Room Summary display for managed sessions.
  - Persistent summary must show current tier, current decision, active Scout Gate id, selected scouts, latest verdict placeholders, context pressure, and handoff readiness.
  - Expanded details must include Scout Gate trigger fields and budget action.
  - Keep the summary readable when no scouts have been called yet.
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

### Global build and wiring notes

- This slice depends on the session scaffold and artifact store.
- `my-pi` verification command: `npm run check`.

## Acceptance criteria

- [ ] A managed session can record a Scout Gate for a material decision.
- [ ] Scout Gate records include all normative trigger fields and the budget action.
- [ ] High/medium/low risk decisions map to the accepted Scout Budget Policy.
- [ ] Scout Gate records are persisted into `session.json` and `transcript.md`.
- [ ] Scout Room Summary shows tier, current decision, active gate, scout status, context pressure, and handoff readiness.
- [ ] Expanded Scout Room details show trigger fields and budget action.
- [ ] Runtime evidence captured: manual Pi session or transcript showing a Scout Gate and Scout Room Summary, plus `npm run check`.

## Blocked by

- `02-add-grill-with-scouts-session-scaffold-and-artifact-store.md`
