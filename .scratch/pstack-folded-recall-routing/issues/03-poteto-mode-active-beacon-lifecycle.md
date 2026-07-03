---
status: closed
---

Status: ready-for-agent

# Poteto mode active beacon lifecycle

## Parent

PRD: `F:/MyWork/my-pi/.scratch/pstack-folded-recall-routing/PRD.md`

## What to build

Add Poteto mode lifecycle behavior to `my-customize-conductor`: after a real MCP `skill-pstack(name="poteto-mode")` result exists, the newest eligible folded poteto-mode block carries a compact active-mode beacon. The beacon keeps Poteto routing discipline visible without keeping the full `poteto-mode` skill unfolded.

Decision IDs: `DEC-009`, `DEC-010`, `DEC-011`, `DEC-012`, `DEC-013`, `DEC-014`, `DEC-017`, `DEC-018`, `DEC-020`.

User stories / required behaviors covered: 1, 2, 4, 8, 9, 13.

## Implementation map

### Area: my-customize-conductor planning and Poteto mode beacon

- **Decision IDs**: `DEC-009`, `DEC-010`, `DEC-011`, `DEC-012`, `DEC-013`, `DEC-014`, `DEC-017`, `DEC-018`, `DEC-020`.
- **Current code anchors**:
  - `vendor/accordion/conductors/my-customize-conductor/my-customize-conductor.ts`
  - Symbols: `MyCustomizeConductor.conduct`, `lastPlan`, `lastSavings`, candidate filtering, `callById`, MCP replace emission.
- **Existing behavior**: The conductor folds non-MCP candidates first, then MCP results last. Under pressure it emits `ReplaceCommand { recoverable: true }` for MCP results using `mcpSummary`. It skips held/protected/grouped/frozen blocks in the candidate set and preserves epoch stability with `lastPlan`.
- **Required edits**:
  - During each `conduct(view)` pass, build semantic state before sorting candidates:
    - `callById` as today.
    - pstack identities for original MCP result blocks from paired calls, consuming issue 01 helpers.
    - pstack identities for existing folded/replaced digest text by parsing current `ViewBlock.text`.
    - fold-code to identity map from current view text.
    - pstack identity for single-code recall results when the recalled code maps to an identity, consuming issue 02 behavior.
    - active Poteto state by scanning events in conversation order: user off phrases disable; original MCP `skill-pstack(name="poteto-mode")` result enables; last event wins.
  - Choose beacon carrier:
    - Find most recent `poteto-mode` block by highest `order` among all identifiable poteto-mode blocks.
    - If Poteto mode is active and that newest block is a replaceable candidate, give it the Poteto beacon.
    - If newest is protected, held, grouped, frozen, or otherwise not replaceable, do not put beacon on older blocks.
    - Older poteto blocks receive identity-only pstack summaries.
  - Preserve human steering: do not override held/protected/grouped blocks.
  - Keep epoch hold behavior correct. If summary content can change because active-mode/beacon carrier changes, ensure `lastPlan` does not freeze stale beacon text across a mode event or newer poteto result. The simplest safe approach is to include a deterministic semantic-state key in the hold check or clear `lastPlan` when mode/beacon state changes.

`current code anchor` — current candidate and replace seam, normative:

```ts
const candidates = view.blocks.filter(
	(b) =>
		!b.held &&
		!b.protected &&
		!b.grouped &&
		b.order >= view.frozenFromIndex &&
		b.foldedTokens < b.tokens &&
		FOLDABLE_KINDS.has(b.kind),
);

for (const b of sorted) {
	if (live <= cap) break;
	if (isMcpResult(b)) {
		const summary = mcpSummary(b, b.callId ? callById.get(b.callId) : undefined);
		const substTokens = estSummaryTokens(summary);
		if (substTokens < b.tokens) {
			replaces.push({ kind: "replace", id: b.id, content: summary, recoverable: true });
			live -= b.tokens - substTokens;
			continue;
		}
	}
	foldIds.push(b.id);
	live += b.foldedTokens - b.tokens;
}
```

`decision artifact` — active Poteto beacon body, normative:

```text
Poteto mode active.
- Apply pstack skills/principles/playbooks only with their full leaf visible in this prompt.
- For skill-pstack(name=...): full leaf visible → use; folded exact match → recall most recent; absent → call skill-pstack(name=...).
```

`decision artifact` — event ordering, normative:

```text
Scan blocks by increasing order.
- user text containing "exit poteto mode", "stop using poteto", or "disable pstack mode" => disabled
- original MCP result with identity skill-pstack(name="poteto-mode") => enabled
Recall results do not enable.
Last event wins.
```

### Area: Recall provenance and folded digest identity parsing

- **Decision IDs**: `DEC-011`, `DEC-015`, `DEC-017`.
- **Current code anchors**:
  - `vendor/accordion/conductors/my-customize-conductor/my-customize-conductor.ts`
  - `vendor/accordion/conductors/my-customize-conductor/mcp-summary.ts`
- **Existing behavior after issue 02**: Single-code recall results can inherit pstack identity from folded digest provenance.
- **Required edits**:
  - Use inherited recall identity to recognize poteto-mode blocks for beacon-carrier selection.
  - Do not treat recall of poteto-mode as an enable event after explicit disable.

### Area: Direct conductor tests

- **Decision IDs**: `DEC-020`.
- **Current code anchors**:
  - `vendor/accordion/app/src/lib/engine/conductor.my-customize-conductor.test.ts`
  - Helpers: `vb`, `makeView`, `foldIdsOf`, `replaceOf`, `projected`
- **Existing behavior**: Direct tests assert emitted `Command[]` from synthetic `ConductorView` instances.
- **Required edits**:
  - Add synthetic tests for beacon lifecycle, off-switch behavior, newest-block behavior, and protected/held/grouped/frozen behavior.

### Global build / wiring notes

- This slice is blocked by issues 01 and 02 because it consumes canonical pstack identity and recall provenance.
- No synthetic blocks are available in the conductor contract. The beacon must live inside the recoverable replacement body.
- `ReplaceCommand.recoverable: true` is required; do not manually construct fold tags.

## Acceptance criteria

- [ ] A real MCP poteto-mode result enables the beacon. Run: `cd vendor/accordion/app && npm test -- conductor.my-customize-conductor.test.ts`. Expected: a test named like `adds Poteto mode beacon to newest eligible poteto-mode result` passes and asserts replacement content contains `tool_result:mcp skill-pstack(name="poteto-mode")`, `Label: Poteto Mode skill`, and the two-line `Poteto mode active` beacon.
- [ ] User off phrase disables special Poteto behavior. Run: `cd vendor/accordion/app && npm test -- conductor.my-customize-conductor.test.ts`. Expected: a test named like `disables Poteto beacon after explicit user off phrase` passes and asserts no replacement content contains `Poteto mode active` after a later user block says `exit poteto mode`.
- [ ] Last event in conversation order wins. Run: `cd vendor/accordion/app && npm test -- conductor.my-customize-conductor.test.ts`. Expected: a test named like `uses last Poteto mode event in conversation order` passes and covers off-then-load enabling and load-then-off disabling.
- [ ] Recall of poteto-mode does not re-enable after disable. Run: `cd vendor/accordion/app && npm test -- conductor.my-customize-conductor.test.ts`. Expected: a test named like `does not re-enable Poteto mode from recall result` passes and asserts a pstack recall result for poteto-mode after disable has identity but no `Poteto mode active` beacon.
- [ ] Only newest eligible poteto-mode block carries beacon. Run: `cd vendor/accordion/app && npm test -- conductor.my-customize-conductor.test.ts`. Expected: a test named like `puts beacon only on newest poteto-mode copy` passes and asserts the older poteto replacement contains identity-only text while the newest contains `Poteto mode active`.
- [ ] If newest poteto-mode block is not replaceable, no older beacon appears. Run: `cd vendor/accordion/app && npm test -- conductor.my-customize-conductor.test.ts`. Expected: a test named like `does not move beacon to older block when newest is protected` passes for protected, held, grouped, or frozen newest block and asserts no replacement content contains `Poteto mode active`.
- [ ] Epoch hold does not preserve stale beacon state. Run: `cd vendor/accordion/app && npm test -- conductor.my-customize-conductor.test.ts`. Expected: a test named like `recomputes plan when Poteto beacon state changes` passes and asserts a second conduct pass after an off phrase does not return a stale plan containing `Poteto mode active`.
- [ ] This slice consumes issue 01 and issue 02 through real wiring. Run: `cd vendor/accordion/app && npm test -- conductor.my-customize-conductor.test.ts`. Expected: beacon tests derive poteto identity from canonical `skill-pstack(name="poteto-mode")` parsing and from a pstack recall result produced through single-code recall provenance, not from full skill content parsing.

## Blocked by

- `01-pstack-aware-mcp-folded-summaries.md`
- `02-recall-provenance-for-folded-pstack-leaves.md`
