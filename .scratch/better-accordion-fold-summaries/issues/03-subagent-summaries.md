---
status: closed
---

Status: ready-for-agent

# Add rich folded summaries for `subagent` results

## What to build

Extend the recoverable tool-result summary path from Slice 1 to `subagent` tool results. The summary should preserve the delegated task identity and deterministic top findings so agents can recall expensive investigations instead of rerunning them.

PRD decisions: `DEC-001`, `DEC-002`, `DEC-004`, `DEC-005`, `DEC-006`, `DEC-007`, `DEC-008`, `DEC-011`.

User stories covered: folded subagent results show task and findings; summaries include exact recall code; expensive delegated investigations are reusable; behavior is deterministic and testable; normal and broker paths consume the same conductor substitution.

## Implementation map

### Area: Custom conductor summary selection

- **Current code anchors**:
  - `vendor/accordion/conductors/my-customize-conductor/my-customize-conductor.ts`
    - `MyCustomizeConductor.conduct()`
    - local `callById` map
    - local `applyCandidate()`
  - Summary helper introduced/extended by issue 01.
- **Existing behavior after issue 01**: `applyCandidate()` should already try MCP summaries, recall summaries, and target non-MCP summaries before falling back to plain fold.
- **Required edits**:
  - Treat `toolName === "subagent"` as a target non-MCP summary.
  - Keep selection order: MCP first, recall second, target non-MCP summaries third.
  - Preserve fold fallback when summary is absent or not smaller than the source block.

### Area: Recoverable summary formatting helpers

- **Current code anchors**:
  - `vendor/accordion/conductors/my-customize-conductor/mcp-summary.ts` or helper module introduced by issue 01.
  - Existing parser/preview/path helpers from issue 01.
- **Required edits**:
  - Use exact recall code from `foldCode(result.id)`.
  - Format the subagent summary as 3–4 short lines:
    1. `tool_result:subagent type="<explore|shell|custom>" cwd="<compacted>"`
    2. `Task: <capped task>`
    3. `Findings: <2-3 bullet-preferred deterministic findings>`
    4. `Full result preserved. Use recall({"codes":["<actual>"]}) before rerunning this investigation.`
  - Include `customAgent` identity when useful for custom subagents.
  - Compact `cwd` with the same path display helper from issue 01.

```txt
# normative subagent summary shape
tool_result:subagent type="<explore|shell|custom>" cwd="<compacted>"
Task: <capped task>
Findings: <2-3 bullet-preferred deterministic findings>
Full result preserved. Use recall({"codes":["abc123"]}) before rerunning this investigation.
```

### Area: Subagent summary extraction

- **Current code anchors**:
  - `extensions/subagents.ts` defines the `subagent` tool and result behavior in Pi.
  - Accordion sees `subagent` only as a normal tool call/result pair through `ViewBlock`; the conductor must not import Pi extension internals.
- **Existing behavior**: A completed `subagent` result can be large and prose-heavy. If folded by generic engine digest, the delegated task and findings become hard to reuse.
- **Required edits**:
  - Parse identity from paired tool-call args: `type`, optional `customAgent`, optional `cwd`, and `task`.
  - Extract findings from result text deterministically:
    1. Prefer markdown bullet or numbered lines.
    2. Skip headings, separators, blank lines, and obvious preamble noise.
    3. Cap findings count to 2–3 and cap each finding length.
    4. Fallback to first useful prose lines if no bullets exist.
  - Do not import from `extensions/subagents.ts`; parse only serialized call/result text visible to the conductor.

```txt
# normative extraction rules
Findings extraction order:
1. Prefer markdown bullet/numbered lines from result text.
2. Skip headings, separators, blank lines, and preamble-like noise.
3. Cap findings count and line length.
4. Fallback to first useful prose lines.
```

### Area: Normal and broker Accordion wire path compatibility

- **Current code anchors**:
  - `vendor/accordion/app/src/lib/engine/store.svelte.ts`: `substOne()` owns fold-tag insertion for recoverable replacements.
  - `vendor/accordion/app/src/lib/live/plan.ts`: `computeFoldOps(store)` consumes `store.digestOf(b)`.
- **Required edits**:
  - Emit the subagent summary as a recoverable `replace` command.
  - Do not add UI, broker, `subagents.ts`, or `plan.ts` formatting logic.

## Acceptance criteria

- [ ] A `subagent` result emits a recoverable `replace` summary when it saves tokens.
- [ ] The summary includes subagent `type`, capped `task`, compacted `cwd` when supplied, and exact recall code.
- [ ] For markdown-heavy subagent output, `Findings:` prefers bullet or numbered finding lines over headings.
- [ ] For prose-only subagent output, `Findings:` falls back to first useful prose lines.
- [ ] Findings are capped in count and length so summaries remain concise.
- [ ] The summary uses recall-only wording and does not mention `unfold`.
- [ ] The implementation does not import from `extensions/subagents.ts`.
- [ ] Runtime evidence produced. Run:
  ```sh
  cd vendor/accordion/app && npx vitest run src/lib/engine/conductor.my-customize-conductor.test.ts
  ```
  Expected: Vitest reports `conductor.my-customize-conductor.test.ts` passed with zero failed tests, including tests named for subagent bullet-preferred and prose-fallback findings.

## Blocked by

- `.scratch/better-accordion-fold-summaries/issues/01-exact-code-mcp-pstack-and-read-summaries.md`
