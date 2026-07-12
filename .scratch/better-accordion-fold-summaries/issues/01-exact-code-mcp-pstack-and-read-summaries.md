---
status: closed
---

Status: ready-for-agent

# Add exact-code recoverable summaries for MCP/pstack and `read`

## What to build

Implement the first vertical slice of rich folded summaries in `my-customize-conductor`: exact recall codes for existing MCP/pstack summaries, plus one non-MCP `read` summary path that emits recoverable structured replacements.

PRD decisions: `DEC-001`, `DEC-003`, `DEC-004`, `DEC-005`, `DEC-006`, `DEC-007`, `DEC-008`, `DEC-009`, `DEC-010`, `DEC-011`.

User stories covered: folded `read` results show path/signals; summaries include exact recall code; MCP/pstack remains special; both normal/broker paths consume the same conductor substitution; summaries stay concise; paths are compacted; focused tests prove behavior.

## Implementation map

### Area: Custom conductor summary selection

- **Current code anchors**:
  - `vendor/accordion/conductors/my-customize-conductor/my-customize-conductor.ts`
    - `MyCustomizeConductor.conduct()`
    - local `callById` map
    - local `applyCandidate()`
  - `vendor/accordion/conductors/my-customize-conductor/mcp-summary.ts`
    - `mcpSummary()`
    - `pstackRecallSummary()`
    - `genericRecallSummary()`
- **Existing behavior**: `applyCandidate()` generates recoverable replacements for MCP results and recall results only. Other `tool_result` blocks usually receive plain fold commands, which use the generic engine digest.
- **Required edits**:
  - Add a pure formatter for at least `read` tool results.
  - Call the new formatter after the existing `isMcpResult()` and `isRecallResult()` branches.
  - Preserve fold fallback if the summary is absent or not smaller than the original block.
  - Do not change candidate ordering, pstack identity tracking, poteto beacon semantics, or budget calculation except to use `estSummaryTokens(summary)` for new summaries.

```ts
// current code anchor — summary priority seam to extend
if (isMcpResult(b)) {
	summary = mcpSummary(b, b.callId ? callById.get(b.callId) : undefined, { potetoBeacon: b.id === beaconCarrierId });
} else if (isRecallResult(b)) {
	const codes = b.callId ? recallCodes(callById.get(b.callId)?.text) : undefined;
	const identity = pstackByBlockId.get(b.id) ?? (codes?.length === 1 ? pstackByFoldCode.get(codes[0]) : undefined);
	summary = identity ? pstackRecallSummary(identity, { potetoBeacon: b.id === beaconCarrierId }) : genericRecallSummary(codes);
}
```

### Area: Recoverable summary formatting helpers

- **Current code anchors**:
  - `vendor/accordion/conductors/my-customize-conductor/mcp-summary.ts`
    - `estSummaryTokens(summary: string)`
    - `foldCode(id: string)`
    - `primitiveArgsPreview()`
    - `parseOuterCall()` / nested-args parsing pattern
- **Required edits**:
  - Introduce or extend a pure helper with `toolResultSummary(result, call)` and `read` formatting.
  - Use exact recall code from `foldCode(result.id)`.
  - Return summary body only; do not include `{#code FOLDED}` tag.
  - Use structured 3–4 short lines:
    1. `tool_result:read path="<compacted>"`
    2. optional `Contains: ...`
    3. `Shape: <lines> lines · ~<tokens> tok`
    4. `Full result preserved. Use recall({"codes":["<actual>"]}) for this prior read snapshot; re-read if the file may have changed.`
  - Compact paths by normalizing slashes, abbreviating home-like prefixes as `~` when detectable, and middle-ellipsizing long paths.
  - Extract deterministic lightweight content signals from `read` output, e.g. headings, exported/class/function names, first meaningful comment/line, capped.

```txt
# normative summary shape
tool_result:<tool> <identity>
Contains|Findings: <deterministic capped signals>
Shape: <lines/items/matches> · ~<tokens> tok
Full result preserved. Use recall({"codes":["<actual-code>"]}) <tool-specific reason>.
```

### Area: Existing MCP/pstack exact-code recall hints

- **Current code anchors**:
  - `vendor/accordion/conductors/my-customize-conductor/mcp-summary.ts`
    - `RECALL_HINT`
    - `mcpSummary(result, call, opts)`
    - `pstackRecallSummary(identity, opts)`
    - `genericRecallSummary(codes)`
- **Required edits**:
  - Update result-specific MCP/pstack summaries to emit exact recall codes from `foldCode(result.id)`.
  - Keep pstack’s “not unfold” wording as a special case.
  - Generic MCP fallback should include exact code but not pstack “not unfold” wording.

```ts
// current code anchor — preserve pstack special wording, replacing placeholder with exact code
`Full result preserved. Use ${RECALL_HINT}, not unfold, before re-calling this exact MCP tool.`
```

### Area: Normal and broker Accordion wire path compatibility

- **Current code anchors**:
  - `vendor/accordion/app/src/lib/engine/store.svelte.ts`: `substOne()` prepends authoritative fold tag for recoverable replacements.
  - `vendor/accordion/app/src/lib/live/plan.ts`: `computeFoldOps(store)` emits `digestText = store.digestOf(b)`.
- **Required edits**:
  - Emit new summaries as `replace` commands with `recoverable: true`.
  - Do not add formatting logic to `plan.ts`, `liveClient.svelte.ts`, or `sessionSlots.svelte.ts`.

```ts
// current code anchor — host owns the fold tag for recoverable replacements
} else if (recoverable) {
	b.subst = `${foldTag(id)} ${content.replace(LEADING_FOLD_TAG, "")}`;
}
```

## Acceptance criteria

- [ ] `mcpSummary()` for pstack includes `recall({"codes":["<foldCode(result.id)>"]})` and still includes “not unfold”.
- [ ] Generic MCP fallback includes `recall({"codes":["<foldCode(result.id)>"]})` and does not use pstack-only “not unfold” wording.
- [ ] A folded `read` target emits a `replace` command with `recoverable: true`, not only a plain `fold` command.
- [ ] The `read` replacement includes compacted path identity, deterministic capped content signals, a `Shape:` line, and exact recall code.
- [ ] The `read` recall wording describes a prior snapshot and says to re-read if the file may have changed.
- [ ] Unknown/non-target tools still fall back to existing fold behavior.
- [ ] The projected token count after replacement remains within budget for the test fixture.
- [ ] Runtime evidence produced. Run:
  ```sh
  cd vendor/accordion/app && npx vitest run src/lib/engine/conductor.my-customize-conductor.test.ts
  ```
  Expected: Vitest reports `conductor.my-customize-conductor.test.ts` passed with zero failed tests, including tests named for exact-code MCP/pstack and `read` summaries.

## Blocked by

None - can start immediately
