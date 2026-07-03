Status: ready-for-agent

# PRD: Pstack Folded Recall Routing in my-customize-conductor

## Problem Statement

In long Accordion sessions, `skill-pstack(name=...)` MCP results can be folded. The folded marker preserves the full content, but the model may not recognize that a folded block already contains the exact pstack skill, playbook, or principle it is about to load again. Re-calling MCP wastes an external tool call and can lose cache stability benefits. Keeping the full `poteto-mode` skill unfolded is also too expensive: it burns tokens every turn and competes with task context.

The user wants Poteto mode to remain behaviorally active across long sessions without keeping the full router skill visible forever. The model should discover and load new pstack leaves as needed, while reusing folded exact prior loads when they already exist.

## Solution

Enhance `my-customize-conductor` so folded MCP results become semantic, recoverable indexes. Pstack MCP results receive canonical `skill-pstack(name="...")` identities, labels, and recall-oriented hints. Folded `poteto-mode` results additionally carry a compact active-mode beacon while Poteto mode is active.

The model-facing behavior becomes:

- If the full pstack leaf is visible in the prompt, use it.
- If a folded exact `skill-pstack(name=...)` match exists, recall the most recent matching folded block.
- If no folded match exists, call `skill-pstack(name=...)` normally.
- Use `recall`, not `unfold`, for re-reading folded pstack leaves.

The implementation is local to `vendor/accordion/conductors/my-customize-conductor/` for MVP. No Accordion core digest, skill-policy, or synthetic-block contract changes are in scope.

## User Stories

1. As a user who enables Poteto mode, I want the mode to keep guiding the model after the full skill folds, so that long sessions keep the same workflow discipline.
2. As a user, I want folded `poteto-mode` results to remain recallable by identity, so that the model can rehydrate the exact full router when needed.
3. As a user, I want the model to recall an already-loaded pstack principle instead of re-calling MCP, so that repeated principle use avoids unnecessary MCP calls.
4. As a user, I want the model to still call MCP for new pstack principles or playbooks, so that Poteto mode remains dynamic.
5. As a user, I want exact prior skill content rather than summaries, so that model behavior does not drift from the full skill text.
6. As a user, I want folded recall results to remain self-identifying, so that repeated recall cycles still work later in the session.
7. As a user, I want the newest matching folded pstack block recalled, so that the model follows the most recent session flow.
8. As a user, I want a compact Poteto beacon instead of full `poteto-mode` staying unfolded, so that context is conserved.
9. As a user, I want explicit off phrases to disable Poteto mode, so that the conductor stops preserving Poteto behavior when asked.
10. As a user, I want generic MCP results to have useful identities without strong stale-result guidance, so that dynamic MCP tools are not over-reused.
11. As an implementer, I want this behavior isolated to `my-customize-conductor`, so that Accordion core remains stable.
12. As an implementer, I want pure helper functions for parsing and formatting, so that pstack identity behavior is easy to test.
13. As an implementer, I want direct conductor tests, so that the command output can be verified without browser or store setup.
14. As an AFK implementation agent, I want exact digest formats and matching rules in the PRD, so that I do not need to re-read the grill conversation.

## Accepted Decision Register

- `DEC-001` — Decision: For repeated stable `skill-pstack(name=...)` loads, prefer `recall` of the most recent matching folded block. Lens: runtime. Rationale: recall preserves the old folded prefix and avoids unnecessary MCP calls while returning exact prior content. Rejected alternatives: re-call MCP by default; use `unfold` for re-reading. Downstream impact: pstack digests and beacons must instruct recall, not unfold.
- `DEC-002` — Decision: Skills are assumed stable during the session; exact prior content is preferred over latest-on-disk. Lens: scope. Rationale: the user said the skills are always the same. Rejected alternatives: refresh from MCP for freshness. Downstream impact: no freshness checks or file mtime checks.
- `DEC-003` — Decision: Match pstack identity by MCP tool name ending with `skill-pstack` and normalized `args.name`. Lens: contract. Rationale: MCP server prefixes may vary; semantic identity is the pstack tool plus name. Rejected alternatives: exact full tool name; args-name only. Downstream impact: parser must accept prefixed tool names but require `name` string.
- `DEC-004` — Decision: Normalize pstack names with trim + lowercase only. Lens: contract. Rationale: pstack names are slug-like; broader path normalization may invent aliases. Downstream impact: identity strings use normalized name.
- `DEC-005` — Decision: Pstack digests include canonical signature, derived label, and strong recall/not-unfold hint. Lens: contract. Rationale: canonical text supports model matching; label helps scanning without summarizing behavior. Rejected alternatives: summary of principle triggers; canonical-only. Downstream impact: digest builder owns exact text format.
- `DEC-006` — Decision: Pstack labels derive from name slug: `principle-*` → principle, `*/playbooks/*` → playbook, otherwise skill. Lens: contract. Rationale: avoids parsing full skill content and summary drift. Downstream impact: pure label helper needed.
- `DEC-007` — Decision: Generic MCP fallback shows tool name plus at most 3 primitive args, capped to 40 chars/string, with sensitive keys redacted. Lens: contract. Rationale: useful identity without leaking or bloating args. Rejected alternatives: tool-only; full args. Downstream impact: generic MCP formatter needs capped/redacted arg preview.
- `DEC-008` — Decision: Generic MCP fallback uses weak exact-result wording. Lens: runtime. Rationale: generic MCP outputs may be dynamic; strong recall-before-recall guidance is only for stable pstack. Downstream impact: fallback text says recall only if exact prior result is needed.
- `DEC-009` — Decision: Poteto mode becomes session-sticky only after a real MCP `skill-pstack(name="poteto-mode")` result exists. Lens: runtime. Rationale: beacon must reference real loaded content; user phrase alone is not enough. Rejected alternatives: enable immediately on user phrase. Downstream impact: active-mode state derives from conversation events.
- `DEC-010` — Decision: Explicit user off phrases disable special Poteto behavior; last mode event in conversation order wins. Lens: runtime. Rationale: user needs an escape hatch; deterministic phrase scan is enough. Downstream impact: scan user blocks for `exit poteto mode`, `stop using poteto`, `disable pstack mode`; later MCP poteto load re-enables.
- `DEC-011` — Decision: Recall of `poteto-mode` does not re-enable after explicit disable. Lens: runtime. Rationale: reference reads should not override user off-switch semantics. Downstream impact: only original MCP poteto result is an enable event.
- `DEC-012` — Decision: Do not force-fold protected-tail pstack results. Lens: ops. Rationale: Accordion protected-tail invariants and cache safety win. Downstream impact: if newest poteto result is live/protected, no folded beacon is emitted from older blocks.
- `DEC-013` — Decision: Only the most recent folded/foldable `poteto-mode` block carries the active Poteto beacon; older copies keep identity only. Lens: runtime. Rationale: one beacon is enough and avoids duplicate reminders. Downstream impact: beacon carrier chosen by highest `order` among all poteto blocks; if newest cannot be replaced, no older beacon.
- `DEC-014` — Decision: Human overrides always win. Lens: ops. Rationale: Accordion conductor behavior should not fight human steering. Downstream impact: do not override held/protected/grouped blocks.
- `DEC-015` — Decision: Folded recall results inherit pstack identity from single-code recall args by mapping recalled fold code to known identity. Lens: contract. Rationale: preserves long-session repeated recall without parsing full skill content. Rejected alternatives: parse content; no recall enrichment. Downstream impact: build `fold code -> pstack identity` from current view/digests.
- `DEC-016` — Decision: Multi-code recall gets generic recall digest for MVP. Lens: scope. Rationale: pstack policy is one semantic item per recall; multi-code enrichment risks mislabeling. Downstream impact: only single-code recall can inherit pstack identity.
- `DEC-017` — Decision: Most recent matching folded block means highest conversation `order`. Lens: runtime. Rationale: latest copy best reflects current session flow. Downstream impact: beacon and matching rules use `ViewBlock.order`.
- `DEC-018` — Decision: Prevent conductor-created groups/drops from hiding pstack identity/beacon blocks while Poteto mode is active. Lens: ops. Rationale: hidden markers cannot route recall. Rejected alternatives: parse group summaries; synthetic beacon blocks. Downstream impact: conductor should exclude such ranges from grouping/dropping. Current conductor emits no groups, but tests should protect this invariant.
- `DEC-019` — Decision: Do not add pstack-specific global Accordion skill policy for MVP. Lens: scope. Rationale: keep behavior local to `my-customize-conductor`. Downstream impact: no edits to Accordion skill docs or system instructions.
- `DEC-020` — Decision: Test with direct conductor tests only. Lens: testing. Rationale: fast, focused, sufficient for MVP command output. Rejected alternatives: E2E AccordionStore tests now. Downstream impact: extend `conductor.my-customize-conductor.test.ts`; no store/browser tests required.

## Implementation Plan

### Area: MCP and pstack summary helpers

- **Decision IDs**: `DEC-001`, `DEC-002`, `DEC-003`, `DEC-004`, `DEC-005`, `DEC-006`, `DEC-007`, `DEC-008`, `DEC-015`, `DEC-016`
- **Current code anchors**:
  - `vendor/accordion/conductors/my-customize-conductor/mcp-summary.ts`
  - Symbols: `isMcpResult`, `estSummaryTokens`, `mcpSummary`, `mcpLabel`, `argsPeek`, `parseArgs`, `clip`
- **Existing behavior**: MCP results are summarized as one-line recoverable replacements like `mcp · server/tool · N lines · args ... · unfold to reuse instead of re-calling`. The summary already parses the paired MCP `tool_call.text` outer JSON and peeks at nested `args` as a string.
- **Required edits**:
  - Replace the generic `mcpSummary(result, call)` formatter with a formatter that can return one of:
    - pstack MCP summary for original `mcp` results whose paired call resolves to `skill-pstack(name=...)`.
    - pstack recall summary for `recall` results whose single recalled code maps to a pstack identity.
    - generic MCP fallback summary.
    - generic recall fallback summary.
  - Keep helpers pure and deterministic. Do not use Date, randomness, module-level session state, or app imports.
  - Add helpers for:
    - `parseMcpCall(callText)` — parse outer JSON from first `{`.
    - `parseNestedArgs(args)` — parse string/object nested args defensively.
    - `pstackIdentityFromMcpCall(call)` — return identity only when tool ends with `skill-pstack` and nested `name` is string.
    - `normalizePstackName(name)` — trim + lowercase.
    - `labelForPstackName(name)` — slug-derived label.
    - `formatPstackMcpSummary(identity, result, options)`.
    - `formatPstackRecallSummary(identity, result, options)`.
    - `formatGenericMcpSummary(result, call)` with capped/redacted primitive args.
    - `formatGenericRecallSummary(result, call)`.
    - `extractPstackIdentityFromDigest(text)` and fold-code extraction for current-view recomputation.
- **Snippet(s)**:

`current code anchor` — existing MCP parsing seam, normative for where current behavior lives:

```ts
export function mcpSummary(result: ViewBlock, call: ViewBlock | undefined): string {
	const parts = [`mcp · ${mcpLabel(call)}`, resultSize(result)];
	const peek = argsPeek(call);
	if (peek) parts.push(peek);
	parts.push("unfold to reuse instead of re-calling");
	return parts.join(" · ");
}

function argsPeek(call: ViewBlock | undefined): string | undefined {
	const a = parseArgs(call?.text);
	const inner = str(a.args);
	if (!inner) return undefined;
	return `args ${clip(inner, 50)}`;
}
```

`decision artifact` — target digest formats, normative:

```text
Original pstack MCP:
tool_result:mcp skill-pstack(name="principle-prove-it-works")
Label: Prove It Works principle
Full result preserved. Use recall({"codes":["<code>"]}), not unfold, before re-calling this exact MCP tool.

Folded pstack recall:
tool_result:recall
Contains: skill-pstack(name="principle-prove-it-works")
Label: Prove It Works principle
Full result preserved. Use recall({"codes":["<code>"]}), not unfold, to re-read this exact pstack leaf.

Generic MCP:
tool_result:mcp some_lookup(project="my-pi", id="ADR-0016", mode="summary")
Full result preserved. Use recall({"codes":["<code>"]}) if you need this exact prior result.
```

Note: the actual conductor `ReplaceCommand.content` must not include `{#<code> FOLDED}` itself. Accordion adds the tag when `recoverable: true`. The examples show final model-facing text after host tagging; helper content should include the body after the tag.

- **Tests to extend**:
  - `vendor/accordion/app/src/lib/engine/conductor.my-customize-conductor.test.ts`
  - Add direct helper/conductor cases for:
    - original pstack MCP result formats canonical signature + label + strong recall/not-unfold hint.
    - generic MCP fallback includes max 3 primitive args, caps long strings, redacts sensitive keys.
    - multi-code recall does not pstack-enrich and uses generic recall digest.
  - Run command: `npm test -- conductor.my-customize-conductor.test.ts` or project-equivalent Vitest focused command. If `run_tests` auto-detects, use it instead of direct shell. Passing output should report the conductor test file with all tests passing.
- **Wiring/build notes**: `mcp-summary.ts` is imported by `my-customize-conductor.ts`; keep exports stable or update that import. No conductor registry change is needed for helper-only edits.

### Area: my-customize-conductor planning and Poteto mode beacon

- **Decision IDs**: `DEC-009`, `DEC-010`, `DEC-011`, `DEC-012`, `DEC-013`, `DEC-014`, `DEC-017`, `DEC-018`, `DEC-020`
- **Current code anchors**:
  - `vendor/accordion/conductors/my-customize-conductor/my-customize-conductor.ts`
  - Symbols: `MyCustomizeConductor.conduct`, `lastPlan`, `lastSavings`, candidate filtering, `callById`, MCP replace emission.
- **Existing behavior**: The conductor folds non-MCP candidates first, then MCP results last. Under pressure it emits `ReplaceCommand { recoverable: true }` for MCP results using `mcpSummary`. It already skips held/protected/grouped/frozen blocks in the candidate set and preserves epoch stability with `lastPlan`.
- **Required edits**:
  - During each `conduct(view)` pass, build semantic state before sorting candidates:
    - `callById` as today.
    - pstack identities for original MCP result blocks from paired calls.
    - pstack identities for existing folded/replaced digest text by parsing current `ViewBlock.text`.
    - fold-code to identity map from current view text.
    - pstack identity for single-code recall results when the recalled code maps to an identity.
    - active Poteto state by scanning events in conversation order: user off phrases disable; original MCP `skill-pstack(name="poteto-mode")` result enables; last event wins.
  - Choose beacon carrier:
    - Find most recent `poteto-mode` block by highest `order` among all identifiable poteto-mode blocks.
    - If active and that newest block is a replaceable candidate, give it the Poteto beacon.
    - If newest is protected, held, grouped, frozen, or otherwise not replaceable, do not put beacon on older blocks.
    - Older poteto blocks receive identity-only pstack summaries.
  - Preserve human steering: do not override held/protected/grouped blocks.
  - Keep group/drop protection invariant: while Poteto mode is active, conductor-created groups/drops must not hide pstack identity/beacon blocks. Current conductor does not emit groups; add tests ensuring this remains true.
  - Keep epoch hold behavior correct. If summary content can change because active-mode/beacon carrier changes, ensure `lastPlan` does not freeze stale beacon text across a mode event or newer poteto result. The simplest safe approach is to include a deterministic semantic-state key in the hold check or clear `lastPlan` when mode/beacon state changes.
- **Snippet(s)**:

`current code anchor` — current candidate and MCP replace seam, normative integration point:

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

- **Tests to extend**:
  - `vendor/accordion/app/src/lib/engine/conductor.my-customize-conductor.test.ts`
  - Add synthetic `ConductorView` tests for:
    1. `poteto-mode` MCP result gets beacon when active and replaceable.
    2. Explicit off phrase before/after poteto load follows last-event-wins.
    3. Recall of poteto-mode does not re-enable after disable.
    4. Multiple poteto copies: only newest replaceable poteto block gets beacon; older gets identity-only.
    5. Newest poteto protected/held/grouped/frozen: no older folded block gets beacon.
    6. Conductor emits no group/drop command covering pstack identity/beacon blocks.
  - Run command: `npm test -- conductor.my-customize-conductor.test.ts` or focused Vitest equivalent via `run_tests`.
- **Wiring/build notes**: The conductor is already registered in `vendor/accordion/conductors/index.ts` as `my-customize-conductor`; no registry edits are required unless public helper exports change.

### Area: Recall provenance and folded digest identity parsing

- **Decision IDs**: `DEC-015`, `DEC-016`, `DEC-017`
- **Current code anchors**:
  - `vendor/accordion/conductors/my-customize-conductor/mcp-summary.ts` — current defensive parsing style.
  - `vendor/accordion/conductors/my-customize-conductor/my-customize-conductor.ts` — access to all `ViewBlock`s and paired calls.
  - `vendor/accordion/conductors/contract/conductor.ts` — `ViewBlock` is the conductor input type; conductors operate on view text and metadata.
- **Existing behavior**: Recall results are not currently pstack-aware. The conductor has no persistent semantic metadata store and should remain stateless for MVP.
- **Required edits**:
  - Implement stateless recomputation from current view:
    1. Derive identities for original MCP result blocks from paired calls.
    2. Parse current digest text lines containing `skill-pstack(name="...")` or `Contains: skill-pstack(name="...")`.
    3. Extract fold code from `{#<code> FOLDED}` in digest text and map it to the identity.
    4. For recall result blocks, parse the paired local `recall` tool call exactly when `toolName === "recall"` and args shape is `{"codes":["abc123"]}`.
    5. If exactly one code maps to a known pstack identity, enrich the recall result with that identity.
    6. If multiple codes or no known identity, use generic recall digest.
  - Do not parse full recalled skill content for MVP.
- **Snippet(s)**:

`decision artifact` — provenance precedence, normative:

```text
Identity derivation precedence:
1. Original MCP result → paired tool_call args.
2. Existing folded/replaced block → parse current digest text.
3. Recall result → paired recall args single code → fold-code identity map.
```

`decision artifact` — recall matching, normative:

```text
Only exact local recall shape participates:
toolName === "recall"
args: { "codes": ["abc123"] }

Multiple codes => generic recall digest.
Unknown code => generic recall digest.
```

- **Tests to extend**:
  - `vendor/accordion/app/src/lib/engine/conductor.my-customize-conductor.test.ts`
  - Add synthetic tests for:
    - folded original pstack digest with code plus single-code recall result -> recall replacement contains `Contains: skill-pstack(name="...")`.
    - pstack recall digest omits source recalled code.
    - generic single-code recall includes `code="abc123"`.
    - multi-code recall and unknown-code recall are generic.
  - Run command: `npm test -- conductor.my-customize-conductor.test.ts` or focused Vitest equivalent via `run_tests`.
- **Wiring/build notes**: This area should not add persistent conductor state. It should be pure recomputation from `ConductorView` each pass so attach/detach/session reload behavior remains simple.

### Area: Direct conductor tests

- **Decision IDs**: `DEC-020`
- **Current code anchors**:
  - `vendor/accordion/app/src/lib/engine/conductor.my-customize-conductor.test.ts`
  - Helpers: `vb`, `makeView`, `foldIdsOf`, `replaceOf`, `projected`
- **Existing behavior**: The test file directly constructs synthetic `ConductorView` instances and asserts emitted `Command[]`. It already tests registration, risk ordering, frozen prefix skipping, MCP folding last, and MCP recoverable summary behavior.
- **Required edits**:
  - Extend the existing test file rather than adding browser/E2E tests.
  - Keep tests focused on command output:
    - `replace` command body contains expected identity/beacon/hint.
    - `recoverable: true` on pstack/MCP replacements.
    - no pstack block appears inside plain `fold` or group/drop commands when it needs special replacement.
  - Update existing MCP summary expectation that currently looks for `engineering-skills/skill-pstack`, `args {"name":"poteto-mode"}`, and `unfold to reuse` to the new canonical pstack digest format.
- **Snippet(s)**:

`test pattern` — existing direct conductor test style, normative for MVP tests:

```ts
const view = makeView(blocks, 300, 1_750);
const result = new MyCustomizeConductor().conduct(view);

const rep = replaceOf(result, "r:mcp");
expect(rep, "MCP result is folded via a replace, not a plain fold").toBeDefined();
expect(rep!.recoverable, "the summary is unfoldable").toBe(true);
expect(rep!.content).toContain("engineering-skills/skill-pstack");
expect(foldIdsOf(result).has("r:mcp")).toBe(false);
expect(projected(view, result)).toBeLessThanOrEqual(view.budget);
```

- **Tests to extend**: Same file. Use existing helpers unless helper shape blocks a case; then minimally extend `vb` opts for any needed metadata.
- **Wiring/build notes**: No E2E AccordionStore test is required for MVP. The engine-owned `{#code FOLDED}` tag behavior is already covered elsewhere; these tests assert conductor content and `recoverable: true`.

## Global Build & Wiring Notes

- `my-customize-conductor` is already exported and registered in `vendor/accordion/conductors/index.ts` as an in-process conductor. Do not add a new conductor.
- `ReplaceCommand.recoverable: true` is the mechanism that lets the host prepend the official `{#code FOLDED}` tag. Conductors must not manually construct fold tags.
- The conductor contract currently supports `fold`, `replace`, `group`, `restore`, and `pin`; it does not support synthetic insertion. The beacon must live inside a recoverable replacement body for MVP.
- Use direct Vitest conductor tests for MVP. Run through `run_tests` when executing tests in the agent harness.

## Testing Decisions

- Test external conductor behavior: given a `ConductorView`, emitted commands must have the correct kind, id, content, and `recoverable` flag.
- Do not test private implementation details like exact helper call order.
- Required modules under test:
  - pstack/MCP parsing and formatting helpers.
  - `MyCustomizeConductor.conduct` planning behavior for pstack summaries, recall provenance, Poteto beacon lifecycle, and group/drop protection invariant.
- Prior art: `vendor/accordion/app/src/lib/engine/conductor.my-customize-conductor.test.ts` already uses synthetic `ConductorView` fixtures and direct command assertions.
- No E2E AccordionStore test is required for MVP.

## Out of Scope

- Accordion core digest changes.
- Synthetic conductor-inserted beacon blocks.
- Pstack-specific global Accordion skill or system instruction changes.
- Parsing full pstack skill content/frontmatter to infer identity.
- Refresh/latest-on-disk checks for skills.
- E2E browser or AccordionStore tests for this MVP.
- General recall-before-tool policy for all tools.
- Changing provider cache tracker, protected-tail logic, or `recall`/`unfold` tool behavior.

## Unresolved Gaps

None.

## Further Notes

Headroom's CCR flow informed this design: old compressed content stays in place, retrieval appears as new tail context, and model-facing markers route retrieval. This PRD applies that pattern locally to Accordion's pstack/MCP workflow without changing Accordion's core folding model.
