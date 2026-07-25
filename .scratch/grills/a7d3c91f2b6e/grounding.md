# Grounding

## Current data flow

1. `store.svelte.ts::buildView` exposes `messageKey: messageKey(b.id)` and marks blocks at/after `protectedFromIndex` as protected.
2. `MyCustomizeConductor.conduct` calls `computePreGroupFromIndex`, then defines raw Pre-Group as `view.blocks.slice(preGroupFromIndex, view.protectedFromIndex)`.
3. `isGroupBoundary` and `groupRuns` operate per block and never inspect `ViewBlock.messageKey`.
4. The conductor emits a `GroupCommand` using the selected block IDs.
5. `store.svelte.ts::groupCmd` calls `snappedRange`, which expands both endpoints outward to every block sharing the endpoint provider-message key.
6. `createGroup` rejects the expanded group if its final member reaches `protectedFromIndex`; otherwise expanded siblings outside the conductor's intended block range are grouped.

## Reproduced code-level failure shape

Given siblings `a:r1:p0`, `a:r1:p1`, `a:r1:p2` with the same `messageKey = a:r1`:

- If a conductor boundary falls between siblings, its IDs describe only one side.
- Host snapping expands to all siblings.
- At the start boundary, an older sibling outside the intended Pre-Group/group run can be unexpectedly grouped.
- At the Protected Tail boundary, a protected sibling is swept into the candidate range and `createGroup` rejects the entire group as `invalid-group`.

This explains the intermittent symptom: it occurs only when a token-derived boundary lands inside a multi-part assistant message. Token growth and message shape determine whether that alignment happens.

## Relevant tests / seams

- `extensions/accordion/app/src/lib/engine/conductor.my-customize-conductor.test.ts` tests excluded protected blocks, but does not cover an unprotected endpoint sharing `messageKey` with a protected sibling.
- Engine group snapping tests live in `extensions/accordion/app/src/lib/engine/store.groups.test.ts`.
- Wire group tests live in `extensions/accordion/app/src/lib/live/mapping.groups.test.ts` and `plan.groups.test.ts`.

## Domain/docs tension

- ADR-0004 defines Pre-Group as a block-index slice and says overlap with Protected Tail is impossible by construction.
- The engine's stronger whole-message grouping invariant means block-level non-overlap is insufficient when either slice boundary bisects a provider message.

## Named MCP recovery gap

- `mcp-summary.ts::mcpSummary` already establishes the model-facing convention: structured MCP/pstack identity plus an imperative `recall({"codes":["<code>"]})`, explicitly preferring recall over re-calling MCP.
- `chunked-compaction.ts::digestMembersFooter` emits per-member codes, but does not map those codes to meaningful MCP identities.
- `plan.ts::resolveUnfold` recognizes a chunked-compaction member code and appends that member's original content to the Protected Tail.
- `plan.ts::resolveRecall` finds per-block codes but explicitly skips members of a folded group. Therefore an MCP member code shown inside a chunked group cannot currently return that individual result through `recall`.
- Group-code recall works but returns the full original text of every member, which is unnecessarily large when the agent asks for one named MCP result.

## Accepted implementation direction

- Select normal Pre-Group units as Complete Accordion Turns; use a structurally safe within-turn split only for an oversized turn.
- Include MCP/recall/pstack blocks in eligible complete units; keep held, grouped, and proactively compressed blocks as hard barriers.
- Preserve canonical block order and append an MCP Retrieval Index to each deterministic group digest.
- Resolve grouped-member codes through read-only `recall`; the ordinary recall tool result is the only Protected Tail append.
- Identify calls by server + tool + canonical-argument fingerprint, with safe display arguments and redaction.
- Show the newest occurrence fully and older occurrences as compact turn/code references.

### GROUND-001 — Conductor view and host group snapping
- Source: `extensions/accordion/app/src/lib/engine/store.svelte.ts` → `buildView`, `groupCmd`, `snappedRange`, `createGroup`
- Existing behavior: `buildView` exposes `messageKey` and block-level `protected`; `snappedRange` expands conductor group endpoints to whole provider messages; `createGroup` rejects a snapped range that reaches the Protected Tail.
- Current excerpt: `messageKey: messageKey(b.id)`; `while (... messageKey(this.blocks[hi + 1].id) === keyHi) hi++`; `if (... >= this.protectedFromIndex) return null`.
- Test prior art: `extensions/accordion/app/src/lib/engine/store.groups.test.ts`; `store.svelte.test.ts` → `groupCmd bypasses frozen clamp when digest is non-empty`.

### GROUND-002 — Current block-level Pre-Group and digest pipeline
- Source: `extensions/accordion/conductors/my-customize-conductor/my-customize-conductor.ts` → `MyCustomizeConductor.conduct`, `isGroupBoundary`, `isChunkedPreGroupBoundary`; `chunked-compaction.ts` → `computePreGroupFromIndex`, `composeDigest`
- Existing behavior: the conductor slices blocks directly from `preGroupFromIndex` to `protectedFromIndex`, treats user/MCP/recall/pstack content as boundaries, trims open tool pairs, and emits one deterministic `GroupCommand` with header/body/member footer.
- Current excerpt: `const preGroupBlocks = view.blocks.slice(preGroupFromIndex, view.protectedFromIndex)` and `return ... [{ kind: "group", ids, digest }]`.
- Test prior art: `conductor.compaction-naive.test.ts` → `walking skeleton emits one chunked-compaction group`, `chunked-compaction digest is byte-identical on replay`, `chunked-compaction group.ids has balanced tool pairs (property)`.

### GROUND-003 — Existing MCP identity and recovery summaries
- Source: `extensions/accordion/conductors/my-customize-conductor/mcp-summary.ts` → `mcpSummary`, `pstackIdentityFromMcpCall`, `pstackRecallSummary`, `foldCode`
- Existing behavior: MCP tool-call JSON is paired by `callId`; pstack calls expose normalized `name` and label; generic summaries expose bounded/redacted identity previews; summaries teach the exact `recall({"codes":[...]})` syntax.
- Current excerpt: `Full result preserved. Use recall({"codes":["${code}"]}) ... before re-calling this exact MCP tool.`
- Test prior art: `conductor.my-customize-conductor.test.ts` pstack normalization, generic MCP redaction/preview, and recall-identity carry-forward cases.

### GROUND-004 — Group and member recall seam
- Source: `extensions/accordion/app/src/lib/live/plan.ts` → `resolveRecall`, `resolveUnfold`; `extensions/accordion/extension/accordion.ts` → registered `recall` tool and `requestRecall`
- Existing behavior: group-code recall returns all member originals read-only; per-block recall explicitly skips members of folded groups; chunked-member unfold uses `appendToTail`; the extension echoes recalled content as an ordinary tool result, which Pi naturally records in history.
- Current excerpt: `if (store.groupOf(b)?.folded) continue`; recall tool output is `[recalled <label> (#<code>)]\n<original text>`.
- Test prior art: `plan.test.ts` → `returns the ORIGINAL full text (not the digest) for a folded block and never mutates`, `recalls a folded GROUP's members' full content joined (by the group code)`; `plan.groups.test.ts` group recovery cases.

### GROUND-005 — Build and invariant seams
- Source: `extensions/accordion/app/package.json` → `test`, `check`; `extensions/accordion/app/vitest.config.ts`
- Existing behavior: app-level Vitest includes `src/lib/**/*.test.ts` and `../extension/**/*.test.ts`; Svelte check is separately available.
- Current excerpt: `"test": "vitest run"`, `"check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json"`.
- Test prior art: `chunked-compaction-invariant.test.ts` cache-break accounting; `accordion.chunkedCompactionJsonl.test.ts` rollover diagnostics; `foldconsistency.property.test.ts` engine/wire live-set invariants.
