Status: ready-for-agent

# PRD: Rich Recoverable Summaries for Accordion Custom Conductor

## Problem Statement

When Accordion folds large tool results, the current generic digest often hides the information an agent needs to avoid repeating work. A folded file read can appear as only:

```txt
{#iao6l8 FOLDED} read → 294 lines, ~3535 tok · // IndexCoordinator: orchestrates sync scheduling...
```

This preserves recoverability, but it does not identify the path, the useful content signals, or the exact `recall` command. In code exploration sessions, especially while exploring external repos such as `~/.opensrc/repos/github.com/headroomlabs-ai/headroom/main`, this makes folded summaries less actionable and encourages repeated `read`, `grep`, `find`, `ls`, or `subagent` calls.

## Solution

Extend `my-customize-conductor` so that, when it folds selected non-MCP tool results, it emits recoverable structured summaries with tool identity, deterministic lightweight content signals, shape metadata, and exact recall codes.

The change must preserve the existing MCP/pstack special flow. It should apply automatically to both normal Accordion and the broker dashboard because both modes consume conductor substitutions through `store.digestOf()` and `computeFoldOps()`.

## User Stories

1. As an agent exploring code, I want folded `read` results to show the path and useful code signals, so that I can decide whether to recall instead of re-reading.
2. As an agent exploring a large repo, I want folded `grep` results to show the query identity and notable matches, so that I can avoid repeating the same search.
3. As an agent exploring directory structure, I want folded `find` results to show the glob/root and listing shape, so that I know what file set was already discovered.
4. As an agent inspecting directories, I want folded `ls` results to show the target path and listing shape, so that I know whether a directory listing is worth recalling.
5. As an agent using subagents, I want folded `subagent` results to show the delegated task and top deterministic findings, so that I do not rerun expensive investigations unnecessarily.
6. As an agent reading any recoverable conductor summary, I want the exact `recall({"codes":["..."]})` command, so that I do not have to manually copy the code from the fold tag.
7. As a user of pstack flows, I want existing MCP/pstack summary behavior to remain special-cased, so that skill/pstack recall guidance does not regress.
8. As a user of broker dashboard and normal Accordion, I want the same folded summary text in both modes, so that behavior is consistent across both UI paths.
9. As an implementer, I want the summary formatter to be deterministic and testable without the UI, so that automated tests can prove the behavior.
10. As a maintainer, I want concise summaries with strict caps, so that improved summaries do not erase the token savings from folding.
11. As a privacy-conscious user, I want absolute paths compacted, so that summaries avoid noisy full home-directory paths while preserving enough identity.
12. As an AFK implementation agent, I want focused tests describing expected behavior, so that implementation does not require re-reading the design conversation.

## Accepted Decision Register

- `DEC-001`
  - Decision: Implement rich summaries in `my-customize-conductor`, not in the engine default digest.
  - Lens: strategy
  - Rationale: The conductor has access to paired `tool_call` blocks and can recover call args by `callId`. The engine digest only sees the result block and cannot reliably identify paths, patterns, or subagent task args.
  - Rejected alternatives: Engine-wide digest change; new engine default for all conductors.
  - Downstream impact: Add summary generation after MCP/recall special handling inside `MyCustomizeConductor.conduct()`.

- `DEC-002`
  - Decision: Rich first-pass scope covers `read`, `grep`, `find`, `ls`, and `subagent` tool results.
  - Lens: scope
  - Rationale: These are the high-value repeat-avoidance cases for repo exploration. MCP/pstack already has special summaries.
  - Rejected alternatives: `read` only; all arbitrary tools.
  - Downstream impact: Formatter should recognize only these tools and let other tool results fall back to existing fold behavior.

- `DEC-003`
  - Decision: Preserve MCP/pstack and recall/pstack behavior as higher-priority special cases.
  - Lens: contract
  - Rationale: Existing pstack flow carries skill identity, labels, and poteto-mode beacon semantics that must not be replaced by generic tool summaries.
  - Rejected alternatives: Normalize all tool results through one generic formatter.
  - Downstream impact: Summary selection order must remain MCP first, recall second, target-tool summaries third.

- `DEC-004`
  - Decision: Use deterministic lightweight content signals, not LLM-generated summaries.
  - Lens: runtime
  - Rationale: Conductor behavior should be deterministic, cheap, and testable. Useful signals can be extracted from headings, exported symbols, bullets, matches, and first meaningful lines.
  - Rejected alternatives: LLM summaries; identity-only summaries.
  - Downstream impact: Implement pure helper functions with caps and no external state.

- `DEC-005`
  - Decision: Use a structured 3–4 short-line summary format.
  - Lens: contract
  - Rationale: It balances readability with token cost.
  - Rejected alternatives: One-line compressed summaries; adaptive verbose summaries.
  - Downstream impact: Format should generally be identity line, optional `Contains:`/`Findings:` line, `Shape:` line, and recall hint line.

- `DEC-006`
  - Decision: Include the actual recall code in conductor summaries.
  - Lens: contract
  - Rationale: `recall({"codes":["abc123"]})` is directly actionable; `recall({"codes":["<code>"]})` requires manual substitution.
  - Rejected alternatives: Keep placeholder; exact code only for new summaries.
  - Downstream impact: Existing MCP/pstack helper APIs need access to the result id or code.

- `DEC-007`
  - Decision: Use tool-specific recall wording.
  - Lens: runtime
  - Rationale: A `read` result is a prior snapshot that may be stale after edits; searches/listings/subagent outputs have different repeat semantics.
  - Rejected alternatives: Strong generic anti-repeat wording for all tools; weak generic wording only.
  - Downstream impact: Recall hint text should be selected by tool kind.

- `DEC-008`
  - Decision: Prefer `recall` only in new filesystem/subagent summaries.
  - Lens: contract
  - Rationale: Recall is the compact way to inspect preserved content without permanently expanding context.
  - Rejected alternatives: Mention both recall and unfold; mention unfold everywhere.
  - Downstream impact: New summaries should not mention `unfold`.

- `DEC-009`
  - Decision: Hybrid MCP wording: exact code everywhere, but keep pstack’s established “not unfold” special wording.
  - Lens: contract
  - Rationale: The user prefers recall, but existing pstack flow intentionally distinguishes recall from unfold.
  - Rejected alternatives: Remove “not unfold” from pstack; keep `<code>` placeholder.
  - Downstream impact: Update existing tests that assert placeholder wording while preserving pstack special meaning.

- `DEC-010`
  - Decision: Compact displayed paths by normalizing slashes, abbreviating the home directory as `~`, and middle-ellipsizing long paths.
  - Lens: contract
  - Rationale: Absolute paths are precise but noisy and may expose user-home details. Compaction preserves identity with less token cost.
  - Rejected alternatives: Full raw paths; basename-only paths.
  - Downstream impact: Add deterministic path-display helper used by filesystem and subagent `cwd` summaries.

- `DEC-011`
  - Decision: Required verification is focused automated tests only; live Accordion broker/normal smoke is optional follow-up.
  - Lens: testing
  - Rationale: Both modes already share the same `store.digestOf()`/`computeFoldOps()` path. Conductor substitution tests plus existing plan-path tests cover the required behavior.
  - Rejected alternatives: Require live broker and normal UI smoke for this PRD.
  - Downstream impact: Issues should require focused Vitest tests, not manual UI testing.

## Implementation Plan

### Area: Custom conductor summary selection

- **Decision IDs**: `DEC-001`, `DEC-002`, `DEC-003`, `DEC-011`
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
  - Add a pure formatter for target non-MCP tool results: `read`, `grep`, `find`, `ls`, and `subagent`.
  - Call the new formatter after the existing `isMcpResult()` and `isRecallResult()` branches.
  - Preserve existing fold fallback if the generated summary is absent or not smaller than the original block.
  - Do not change candidate ordering, pstack identity tracking, poteto beacon semantics, or budget calculation except to use `estSummaryTokens(summary)` for the new summaries.
- **Snippet(s)**:

```ts
// current code anchor — summary priority seam in applyCandidate(); normative seam to extend
if (isMcpResult(b)) {
	summary = mcpSummary(b, b.callId ? callById.get(b.callId) : undefined, { potetoBeacon: b.id === beaconCarrierId });
} else if (isRecallResult(b)) {
	const codes = b.callId ? recallCodes(callById.get(b.callId)?.text) : undefined;
	const identity = pstackByBlockId.get(b.id) ?? (codes?.length === 1 ? pstackByFoldCode.get(codes[0]) : undefined);
	summary = identity ? pstackRecallSummary(identity, { potetoBeacon: b.id === beaconCarrierId }) : genericRecallSummary(codes);
}
```

```ts
// decision artifact — illustrative selection order; exact function names may vary
if (isMcpResult(b)) {
	summary = mcpSummary(b, pairedCall, { potetoBeacon: b.id === beaconCarrierId });
} else if (isRecallResult(b)) {
	summary = recallSummary(...);
} else {
	summary = toolResultSummary(b, pairedCall);
}
```

- **Tests to extend**:
  - `vendor/accordion/app/src/lib/engine/conductor.my-customize-conductor.test.ts`
  - Add tests proving targeted tool results emit `replace` commands with `recoverable: true`.
  - Add tests proving unknown tools still fall back to plain fold behavior.
  - Run command:
    ```sh
    cd vendor/accordion/app && npx vitest run src/lib/engine/conductor.my-customize-conductor.test.ts
    ```
  - Passing output should include a successful Vitest run for `conductor.my-customize-conductor.test.ts` with zero failed tests.
- **Wiring/build notes**: The conductor is already registered through `vendor/accordion/conductors/index.ts` as `my-customize-conductor`; no new conductor registration is required.

### Area: Recoverable summary formatting helpers

- **Decision IDs**: `DEC-004`, `DEC-005`, `DEC-006`, `DEC-007`, `DEC-008`, `DEC-010`
- **Current code anchors**:
  - `vendor/accordion/conductors/my-customize-conductor/mcp-summary.ts`
    - `estSummaryTokens(summary: string)`
    - `foldCode(id: string)`
    - `primitiveArgsPreview()`
    - `parseOuterCall()`
    - `parseNestedArgs()`
- **Existing behavior**: MCP summaries parse paired tool calls defensively, redact sensitive primitive args, cap previews, and return deterministic strings. Existing recall hints mostly use the `<code>` placeholder.
- **Required edits**:
  - Introduce a pure helper module or extend `mcp-summary.ts` with `toolResultSummary(result, call)` and small tool-specific formatters.
  - Use exact recall code derived from `foldCode(result.id)`.
  - Keep summaries to 3–4 short lines:
    1. `tool_result:<tool> <identity>`
    2. optional `Contains:` or `Findings:`
    3. `Shape:`
    4. `Full result preserved. Use recall({"codes":["<actual>"]}) ...`
  - Parse call args defensively from paired `tool_call.text` using the existing `parseOuterCall`/nested-args pattern or an equivalent pure parser.
  - Keep all extraction deterministic and capped.
  - Compact paths with slash normalization, `~` home abbreviation when detectable, and middle ellipsis for long paths.
- **Snippet(s)**:

```ts
// current code anchor — exact-code change should replace the placeholder for result-specific summaries
const RECALL_HINT = 'recall({"codes":["<code>"]})';
```

```txt
# decision artifact — normative summary shape
tool_result:<tool> <identity>
Contains|Findings: <deterministic capped signals>
Shape: <lines/items/matches> · ~<tokens> tok
Full result preserved. Use recall({"codes":["<actual-code>"]}) <tool-specific reason>.
```

```txt
# decision artifact — normative subagent shape
tool_result:subagent type="<explore|shell|custom>" cwd="<compacted>"
Task: <capped task>
Findings: <2-3 bullet-preferred deterministic findings>
Full result preserved. Use recall({"codes":["abc123"]}) before rerunning this investigation.
```

- **Tests to extend**:
  - Direct helper tests in `conductor.my-customize-conductor.test.ts` or a new adjacent test if the helper is split.
  - Required cases:
    - `read` includes compacted path, deterministic content signals, `Shape:`, and exact recall code.
    - `grep` includes pattern/path identity and capped match signals.
    - `find` includes root/glob identity and listing shape.
    - `ls` includes target path and listing shape.
    - path compaction normalizes slashes and abbreviates a home-like prefix when possible.
    - summary is omitted or falls back when it would not save tokens.
  - Run command:
    ```sh
    cd vendor/accordion/app && npx vitest run src/lib/engine/conductor.my-customize-conductor.test.ts
    ```
- **Wiring/build notes**: Keep helper functions free of Svelte/app imports so conductor code remains deterministic and testable like existing MCP summary helpers.

### Area: Subagent summary extraction

- **Decision IDs**: `DEC-002`, `DEC-004`, `DEC-005`, `DEC-007`, `DEC-008`
- **Current code anchors**:
  - `extensions/subagents.ts` defines the `subagent` tool and result behavior in Pi.
  - Accordion sees `subagent` only as a normal tool call/result pair through `ViewBlock`; the conductor should not depend on Pi extension internals.
- **Existing behavior**: A completed `subagent` result can be large and prose-heavy. If folded by generic engine digest, the agent may lose the delegated task and findings needed to avoid rerunning the investigation.
- **Required edits**:
  - Treat `toolName === "subagent"` as a special target tool result in the conductor formatter.
  - Extract identity from call args: `type`, optional `customAgent`, optional `cwd`, and `task`.
  - Extract findings from result text deterministically:
    - skip blank lines, headings, and separator lines;
    - prefer markdown bullets or numbered lines;
    - cap to 2–3 findings and cap each finding length;
    - fallback to first useful prose lines if no bullets exist.
  - Do not import from `extensions/subagents.ts`; parse only the paired tool call text visible to the conductor.
- **Snippet(s)**:

```txt
# decision artifact — normative extraction rules
Findings extraction order:
1. Prefer markdown bullet/numbered lines from result text.
2. Skip headings, separators, blank lines, and preamble-like noise.
3. Cap findings count and line length.
4. Fallback to first useful prose lines.
```

- **Tests to extend**:
  - `subagent` summary includes type, task, compacted cwd, bullet-preferred findings, and exact recall code.
  - A subagent output with only prose falls back to useful prose lines.
  - A subagent output with headings before bullets skips the headings.
  - Run command:
    ```sh
    cd vendor/accordion/app && npx vitest run src/lib/engine/conductor.my-customize-conductor.test.ts
    ```
- **Wiring/build notes**: This is a contract across the Pi tool boundary; keep it best-effort and defensive because the conductor receives only serialized call/result text.

### Area: Existing MCP/pstack exact-code recall hints

- **Decision IDs**: `DEC-003`, `DEC-006`, `DEC-009`
- **Current code anchors**:
  - `vendor/accordion/conductors/my-customize-conductor/mcp-summary.ts`
    - `RECALL_HINT`
    - `mcpSummary(result, call, opts)`
    - `pstackRecallSummary(identity, opts)`
    - `genericRecallSummary(codes)`
  - `vendor/accordion/app/src/lib/engine/conductor.my-customize-conductor.test.ts`
    - tests currently assert pstack wording and placeholder behavior.
- **Existing behavior**: MCP/pstack summaries use identity-bearing recoverable replacements, but pstack summaries currently use the placeholder `recall({"codes":["<code>"]})`.
- **Required edits**:
  - Update result-specific MCP/pstack summary helpers to emit exact recall codes from `foldCode(result.id)`.
  - Keep pstack’s “not unfold” wording as a special case.
  - Preserve existing generic recall behavior for unknown single-code recall results, which already includes the exact code supplied by the recall call.
  - If needed, adjust helper signatures so `pstackRecallSummary` receives either the result block id or exact code.
- **Snippet(s)**:

```ts
// current code anchor — pstack special wording to preserve, replacing only the placeholder with exact code
`Full result preserved. Use ${RECALL_HINT}, not unfold, before re-calling this exact MCP tool.`
```

- **Tests to extend**:
  - MCP pstack summary includes `recall({"codes":["<foldCode(result.id)>"]})`.
  - MCP pstack summary still includes “not unfold”.
  - pstack recall summary includes exact code and still says “not unfold”.
  - generic MCP fallback includes exact code and does not use pstack “not unfold” wording.
  - Run command:
    ```sh
    cd vendor/accordion/app && npx vitest run src/lib/engine/conductor.my-customize-conductor.test.ts
    ```
- **Wiring/build notes**: Update tests that currently hardcode `<code>` in expected summary strings.

### Area: Normal and broker Accordion wire path compatibility

- **Decision IDs**: `DEC-001`, `DEC-011`
- **Current code anchors**:
  - `vendor/accordion/app/src/lib/engine/store.svelte.ts`
    - `substOne()` prepends the authoritative fold tag for `recoverable` replacements.
    - `digestOf(b)` returns `b.subst ?? digest(b)`.
  - `vendor/accordion/app/src/lib/live/plan.ts`
    - `computeFoldOps(store)` emits `digestText = store.digestOf(b)` for folded blocks.
  - `vendor/accordion/app/src/lib/live/liveClient.svelte.ts`
    - normal direct mode computes fold/group ops from the singleton store.
  - `vendor/accordion/app/src/lib/live/sessionSlots.svelte.ts`
    - broker dashboard mode computes fold/group ops from each slot store.
- **Existing behavior**: Recoverable conductor replacements are made wire-recoverable by `store.substOne()` and then sent through `computeFoldOps()` in both direct and broker paths.
- **Required edits**:
  - No separate broker-specific formatter is required.
  - Ensure new summaries are emitted as `replace` commands with `recoverable: true`, not as pre-tagged strings.
  - Do not add formatting logic to `plan.ts`, `liveClient.svelte.ts`, or `sessionSlots.svelte.ts`.
- **Snippet(s)**:

```ts
// current code anchor — host owns the fold tag for recoverable replacements; normative boundary
} else if (recoverable) {
	b.subst = `${foldTag(id)} ${content.replace(LEADING_FOLD_TAG, "")}`;
}
```

```ts
// current code anchor — both normal and broker paths consume the same digest text
const digestText = store.digestOf(b);
ops.push({ id: b.id, digestText });
```

- **Tests to extend**:
  - Existing conductor tests should assert `recoverable: true`; `store.substOne()`/`computeFoldOps()` behavior is already covered by existing plan/store tests.
  - Optional manual follow-up only: live broker/normal smoke to visually inspect summaries.
- **Wiring/build notes**: This PRD intentionally avoids UI or broker-specific code changes.

## Global Build & Wiring Notes

- Primary test command:
  ```sh
  cd vendor/accordion/app && npx vitest run src/lib/engine/conductor.my-customize-conductor.test.ts
  ```
- The app package scripts live at `vendor/accordion/app/package.json`; `npm test` runs `vitest run` for the whole app test suite.
- `my-customize-conductor` is already exported/registered in `vendor/accordion/conductors/index.ts`.
- `store.substOne()` owns fold-tag insertion for recoverable summaries. Conductor helper functions should return body text only, not `{#code FOLDED}` tags.
- The broker dashboard path and normal Accordion path both use `computeFoldOps(store)`, so summary changes belong in the conductor, not in broker/session UI code.

## Testing Decisions

- Required tests are focused automated Vitest tests.
- Tests should verify external conductor behavior: emitted `Command[]`, replacement content, `recoverable: true`, and projected token budget behavior.
- Helper tests may test pure formatting functions directly where that reduces reader load.
- Tests should not assert private implementation details such as exact parser internals beyond the public summary strings.
- Prior art: `vendor/accordion/app/src/lib/engine/conductor.my-customize-conductor.test.ts` already tests MCP summary formatting, pstack labels, poteto beacon behavior, fold-vs-replace decisions, and projected token savings.

## Out of Scope

- Engine-wide default digest changes in `vendor/accordion/app/src/lib/engine/digest.ts`.
- LLM-generated summaries.
- Rich summaries for arbitrary tools beyond `read`, `grep`, `find`, `ls`, and `subagent`.
- UI-specific broker dashboard rendering changes.
- Required live smoke tests for broker dashboard or normal Accordion.
- Staleness tracking for file reads after edits. `read` wording should acknowledge that the folded result is a prior snapshot.
- ADR creation; this is a conductor behavior refinement, not a hard-to-reverse architecture decision.

## Unresolved Gaps

None.

## Further Notes

Headroom-inspired patterns used in this PRD: self-describing recoverable markers, exact retrieval handles, categorical summaries, and concise shape metadata. The implementation should keep those benefits without importing Headroom code or adding nondeterministic summarization.
