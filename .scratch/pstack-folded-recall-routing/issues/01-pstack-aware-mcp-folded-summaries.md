---
status: closed
---

Status: ready-for-agent

# Pstack-aware MCP folded summaries

## Parent

PRD: `F:/MyWork/my-pi/.scratch/pstack-folded-recall-routing/PRD.md`

## What to build

Implement the first vertical slice of pstack folded recall routing: when `my-customize-conductor` folds an MCP `skill-pstack(name=...)` result, the recoverable replacement must expose a canonical pstack identity, derived label, and strong recall/not-unfold hint. Non-pstack MCP results must still get a useful generic identity with a small capped/redacted primitive args preview and weaker exact-prior-result wording.

Decision IDs: `DEC-001`, `DEC-002`, `DEC-003`, `DEC-004`, `DEC-005`, `DEC-006`, `DEC-007`, `DEC-008`, `DEC-020`.

User stories / required behaviors covered: 3, 4, 5, 10, 12, 13.

## Implementation map

### Area: MCP and pstack summary helpers

- **Decision IDs**: `DEC-001`, `DEC-002`, `DEC-003`, `DEC-004`, `DEC-005`, `DEC-006`, `DEC-007`, `DEC-008`, `DEC-020`.
- **Current code anchors**:
  - `vendor/accordion/conductors/my-customize-conductor/mcp-summary.ts`
  - Symbols: `isMcpResult`, `estSummaryTokens`, `mcpSummary`, `mcpLabel`, `argsPeek`, `parseArgs`, `clip`
- **Existing behavior**: MCP results are summarized as one-line recoverable replacements like `mcp · server/tool · N lines · args ... · unfold to reuse instead of re-calling`. The summary already parses the paired MCP `tool_call.text` outer JSON and peeks at nested `args` as a string.
- **Required edits**:
  - Keep helpers pure and deterministic. Do not use Date, randomness, module-level session state, or app imports.
  - Add pstack parsing helpers:
    - Parse outer MCP call JSON from `tool_call.text` starting at first `{`.
    - Parse nested `args` when it is a JSON string or object.
    - Return pstack identity only when the MCP tool name ends with `skill-pstack` and nested `name` is a string.
    - Normalize pstack name with trim + lowercase.
    - Derive labels from normalized slug: `principle-*` → `<Title> principle`; `*/playbooks/*` → `<Title> playbook`; otherwise `<Title> skill`.
  - Update `mcpSummary(result, call)` so original pstack MCP calls produce the canonical digest body below.
  - Update generic MCP fallback to show tool name plus at most 3 primitive args, max 40 chars per string, redacting sensitive keys such as `token`, `key`, `password`, `secret`, `auth`.
  - Generic MCP fallback must use weak wording: recall only if the exact prior result is needed.

`current code anchor` — existing formatter seam, normative:

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

`decision artifact` — target digest bodies, normative. Do not include `{#<code> FOLDED}` manually; `recoverable: true` makes the host add the official fold tag.

```text
Original pstack MCP:
tool_result:mcp skill-pstack(name="principle-prove-it-works")
Label: Prove It Works principle
Full result preserved. Use recall({"codes":["<code>"]}), not unfold, before re-calling this exact MCP tool.

Generic MCP:
tool_result:mcp some_lookup(project="my-pi", id="ADR-0016", mode="summary")
Full result preserved. Use recall({"codes":["<code>"]}) if you need this exact prior result.
```

### Area: Direct conductor tests

- **Decision IDs**: `DEC-020`.
- **Current code anchors**:
  - `vendor/accordion/app/src/lib/engine/conductor.my-customize-conductor.test.ts`
  - Helpers: `vb`, `makeView`, `foldIdsOf`, `replaceOf`, `projected`
- **Existing behavior**: The test file directly constructs synthetic `ConductorView` instances and asserts emitted `Command[]`. It already tests MCP recoverable summary behavior.
- **Required edits**:
  - Extend the existing test file.
  - Update the existing MCP summary expectation that currently looks for `engineering-skills/skill-pstack`, `args {"name":"poteto-mode"}`, and `unfold to reuse` to the new canonical pstack digest format.
  - Add tests for pstack summary, pstack label derivation, generic fallback arg cap/redaction, and weak generic wording.

`test pattern` — existing direct conductor style, normative:

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

### Global build / wiring notes

- `my-customize-conductor` is already exported and registered in `vendor/accordion/conductors/index.ts`; do not add a new conductor.
- `ReplaceCommand.recoverable: true` is the mechanism that lets the host prepend the official `{#code FOLDED}` tag. Conductors must not manually construct fold tags.
- The conductor contract has no synthetic insertion; this slice only changes replacement body text and tests.

## Acceptance criteria

- [ ] Pstack MCP summary is canonical. Run: `cd vendor/accordion/app && npm test -- conductor.my-customize-conductor.test.ts`. Expected: a test named like `formats pstack MCP results with canonical skill-pstack identity` passes and asserts the replacement content contains `tool_result:mcp skill-pstack(name="principle-prove-it-works")`, `Label: Prove It Works principle`, and `not unfold, before re-calling this exact MCP tool`.
- [ ] Pstack names are normalized. Run: `cd vendor/accordion/app && npm test -- conductor.my-customize-conductor.test.ts`. Expected: a test named like `normalizes pstack names with trim and lowercase` passes and asserts input name ` Poteto-Mode ` produces `skill-pstack(name="poteto-mode")`.
- [ ] Pstack labels are derived from slug patterns. Run: `cd vendor/accordion/app && npm test -- conductor.my-customize-conductor.test.ts`. Expected: a test named like `derives pstack labels from slug patterns` passes and asserts `principle-prove-it-works` → `Prove It Works principle`, `poteto-mode/playbooks/bug-fix` → `Bug Fix playbook`, and `architect` → `Architect skill`.
- [ ] Generic MCP fallback includes only capped/redacted primitive args. Run: `cd vendor/accordion/app && npm test -- conductor.my-customize-conductor.test.ts`. Expected: a test named like `formats generic MCP fallback with capped redacted primitive args` passes and asserts at most 3 args appear, long strings are clipped to 40 chars, and sensitive keys render as `[redacted]`.
- [ ] Generic MCP fallback does not use strong pstack wording. Run: `cd vendor/accordion/app && npm test -- conductor.my-customize-conductor.test.ts`. Expected: a test named like `uses weak exact-result wording for generic MCP` passes and asserts generic content contains `if you need this exact prior result` and does not contain `before re-calling this exact MCP tool`.
- [ ] Existing conductor behavior still folds MCP through recoverable replace. Run: `cd vendor/accordion/app && npm test -- conductor.my-customize-conductor.test.ts`. Expected: the test output includes `conductor.my-customize-conductor.test.ts` and all tests in the file pass.

## Blocked by

None - can start immediately
