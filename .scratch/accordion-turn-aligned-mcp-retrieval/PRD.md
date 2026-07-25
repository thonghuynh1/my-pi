Status: ready-for-agent

# Turn-Aligned Accordion Compaction with Named MCP Retrieval

## Problem Statement

`MyCustomizeConductor` derives its Pre-Group and Protected Tail boundaries per block, while the Accordion host expands group endpoints to whole provider messages. When a token-derived boundary lands inside a multi-part assistant message or a tool chain, the host can unexpectedly expand or reject the proposed group. User, MCP, recall, and pstack blocks also act as permanent conductor boundaries today, so otherwise eligible old conversation can leave the Pre-Group empty. After grouping, the digest exposes member codes without mapping named MCP results to codes that `recall` can resolve individually.

This makes chunked compaction appear intermittent and prevents an agent from reliably recognizing and recovering an exact prior MCP result without recalling an entire group or rewriting cached history.

## Solution

Make a **Complete Accordion Turn** the normal chunked-compaction unit: one user message plus its assistant parts and balanced tool activity up to the next user message. Keep the current partial turn raw in the Protected Tail, permit only structurally safe within-turn splits for pathological oversized turns, and preserve held, already-grouped, and proactively compressed content as hard barriers.

Preserve canonical wire chronology. End each deterministic chunked-compaction digest with an **MCP Retrieval Index** that maps each **Canonical MCP Identity** to the newest exact grouped-member recall code plus compact historical turn/code references. Extend grouped-member `recall` so it returns that member immediately without unfolding or mutating the immutable group; Pi's ordinary recall tool result supplies the single cache-safe tail append.

## User Stories

1. `US-001`: As an agent in a long Accordion-managed session, I want an aged complete turn containing an MCP result to compact into an immutable group with a named, individually recallable MCP entry, so that I can recover the exact result without breaking the group or cached prefix.
2. `US-002`: As an agent processing an unusually large turn, I want Accordion to compact only at structurally safe boundaries, so that context pressure is relieved without splitting provider messages or tool-call/tool-result pairs.

## Walking Skeleton

`US-001` — Given one eligible completed turn containing one MCP call/result and a newer protected turn, `MyCustomizeConductor` emits one real `GroupCommand`; the applied group digest ends with the MCP's readable Canonical MCP Identity and member code; calling `recall` with that code returns only the original MCP result while the group remains folded and unchanged.

## Required Behaviors

- `RB-001`: Normal Pre-Group selection operates on complete turns, not arbitrary block endpoints. A complete turn contains its user message, all assistant message parts, and balanced tool-call/tool-result activity up to the next user message.
- `RB-002`: The current incomplete turn remains raw in the Protected Tail. Normal rollover may exceed the tail token target only by the bounded complete unit required to preserve structure.
- `RB-003`: Human-held blocks, members of existing groups, and proactively compressed blocks are hard compaction barriers. User, MCP, recall, and pstack blocks are not permanent barriers when they belong to an otherwise eligible complete unit.
- `RB-004`: An oversized turn may split only at the newest boundary between provider messages for which no `messageKey` spans the cut and no `callId` has one half on each side. If one provider message is itself oversized, Accordion keeps it intact and tolerates the unavoidable tail overshoot.
- `RB-005`: Every emitted chunked-compaction `GroupCommand` remains contiguous, preserves canonical message order, contains balanced tool pairs, has at least two surviving IDs after safety trimming, and uses a non-empty deterministic digest.
- `RB-006`: The final emitted digest, including the MCP Retrieval Index, remains a byte-identical pure function of the same input corpus. The minimum-savings gate accounts for the final index-bearing digest cost.
- `RB-007`: The MCP Retrieval Index is the final digest section. Each full entry displays a safe recognizable label, server/tool identity, canonical-argument fingerprint, newest turn, newest member code, and exact `recall({"codes":["<code>"]})` instruction.
- `RB-008`: Canonical MCP Identity is derived from normalized server, tool, and a deterministic fingerprint of canonical arguments. JSON key ordering and equivalent formatting do not change the identity. Sensitive values are never displayed; existing sensitive-key redaction semantics apply.
- `RB-009`: For repeated occurrences of one Canonical MCP Identity, the newest occurrence receives the full entry and is the documented default for an unqualified name reference. Older retained occurrences appear as compact turn/code references.
- `RB-010`: If an MCP call cannot be parsed into a canonical identity, the index retains a generic MCP label, turn, and member code rather than silently removing its recovery route.
- `RB-011`: `recall(memberCode)` for a member of a folded chunked-compaction group returns only that member's original full content and IDs. It is read-only with respect to group and block fold state.
- `RB-012`: Grouped-member recall does not call `appendToTail`, `unfold`, or `unfoldGroup`. The registered Pi recall tool's ordinary call/result is the only new history appended to the Protected Tail.
- `RB-013`: Existing group-code recall continues returning the whole group's originals. Existing chunked-member `unfold` continues using its cache-safe tail-append behavior.
- `RB-014`: Recall, rollover, and replay never rewrite an existing immutable group digest. A same-corpus replay emits byte-identical digest text.
- `RB-015`: Chunked compaction remains inactive when `contextWindow` is null or below 128,000, and existing non-chunked folding behavior remains unchanged.
- `RB-016`: No new conductor command, move/reorder operation, protocol field, protocol version, persistence layer, nested grouping mode, or user-facing setting is introduced.

## Accepted Decision Register

### `DEC-001` — Complete-turn compaction boundaries

- **Decision**: Use complete turns as normal Pre-Group units; keep the current partial turn in the Protected Tail.
- **Rationale**: Block endpoints can split provider messages and tool chains, causing snap expansion, rejection, and inconsistent grouping.
- **Rejected alternatives**: Block-exact grouping; message-only alignment without tool-chain alignment.
- **Downstream impact**: Boundary planning and tests must use `turn`, `messageKey`, and `callId` together.
- **Depends on**: None.
- **Decided implementation**: `chunked-compaction.ts` owns pure unit derivation and boundary selection; `MyCustomizeConductor.conduct` consumes the selected contiguous IDs.
- **Left to the implementer**: Helper names and equivalent local data structures for turn units.

### `DEC-002` — Preserve chronology; present MCP identities in the digest

- **Decision**: Never move MCP messages. Put named MCP context in a final deterministic digest section.
- **Rationale**: Accordion is content-substitution-only; reordering would alter provider history and require a new protocol/state model.
- **Rejected alternatives**: Moving an MCP result; moving a call/result pair; splitting unrelated content into order-changing output.
- **Downstream impact**: Digest composition gains an MCP Retrieval Index while `applyPlan` ordering remains unchanged.
- **Depends on**: `DEC-001`.
- **Decided implementation**: Existing `GroupCommand` and contiguous message order are retained.
- **Left to the implementer**: Whitespace and local formatter decomposition, provided output remains deterministic and contract fields remain recognizable.

### `DEC-003` — Read-only individual grouped-member recall

- **Decision**: Resolve a grouped member code directly and return its original as the current recall result; do not synthesize a second tail append.
- **Rationale**: Immediate access plus Pi's normal tool history gives one cache-safe append while leaving the group immutable.
- **Rejected alternatives**: Recalling the entire group; routing through `unfold`; invoking `appendToTail` during recall.
- **Downstream impact**: `resolveRecall` must distinguish group-code and member-code matches without mutating store state.
- **Depends on**: `DEC-002`.
- **Decided implementation**: `plan.ts::resolveRecall` owns member resolution; `accordion.ts` keeps its existing recall echo/wiring.
- **Left to the implementer**: Local match helper organization and returned label wording consistent with existing labels.

### `DEC-004` — Newest exact MCP occurrence is the default

- **Decision**: An unqualified name reference selects the newest matching Canonical MCP Identity; older occurrences remain explicit by turn/code.
- **Rationale**: Newest is normally authoritative and minimizes token use without deleting history.
- **Rejected alternatives**: Always ask which occurrence; recall all occurrences.
- **Downstream impact**: Occurrences must be ordered deterministically by conversation order/turn.
- **Depends on**: `DEC-003`.
- **Decided implementation**: The index formatter marks the newest occurrence as primary and retains older references.
- **Left to the implementer**: Compact punctuation and line wrapping.

### `DEC-005` — Canonical MCP Identity

- **Decision**: Identity is server + tool + a deterministic fingerprint of canonical arguments, with safe identifying arguments displayed and sensitive values redacted.
- **Rationale**: Tool name alone conflates calls; raw arguments are verbose and may expose secrets.
- **Rejected alternatives**: Server/tool only; full raw argument display.
- **Downstream impact**: Identity canonicalization and display redaction require deterministic unit tests.
- **Depends on**: `DEC-004`.
- **Decided implementation**: Extend/reuse `mcp-summary.ts` parsing, normalization, redaction, and stable hashing conventions; pair call and result through `callId`.
- **Left to the implementer**: Internal canonical JSON representation and fingerprint length, provided collision risk is no weaker than existing six-character recovery handles and output remains deterministic.

### `DEC-006` — Safe oversized-turn fallback

- **Decision**: Split an oversized turn only at a provider-message boundary with no `messageKey` or `callId` crossing; never split one provider message.
- **Rationale**: Absolute turn indivisibility can defeat compaction, while arbitrary splitting breaks provider structure.
- **Rejected alternatives**: Unlimited complete-turn overshoot; refusing compaction until another user turn.
- **Downstream impact**: Boundary selection needs a safe-cut search and an indivisible-message fallback.
- **Depends on**: `DEC-001`.
- **Decided implementation**: `chunked-compaction.ts` owns the pure safe-cut computation.
- **Left to the implementer**: Iteration direction and local representation, subject to selecting the newest valid cut that satisfies the bounded-tail goal.

### `DEC-007` — Compact repeated-occurrence representation

- **Decision**: Emit one full entry for the newest occurrence per identity and compact turn/code references for older occurrences.
- **Rationale**: It preserves historical lookup without repeating verbose identity/instruction text in an immutable prefix.
- **Rejected alternatives**: Full entry per occurrence; newest occurrence only.
- **Downstream impact**: Digest-cost estimation must include all compact historical references.
- **Depends on**: `DEC-004`, `DEC-005`.
- **Decided implementation**: MCP Retrieval Index grouping and sorting live with deterministic digest composition.
- **Left to the implementer**: Equivalent stable grouping/sorting helpers.

## Implementation Plan

### Area: Turn and Safe-Boundary Planning

- **Coverage**: `DEC-001`, `DEC-006`, `US-001`, `US-002`, `RB-001`–`RB-005`, `RB-015`.
- **Contract**: Produce one contiguous eligible range made of complete turns under normal conditions. For one oversized turn, produce the newest safe cut whose boundary separates complete provider messages and balanced call pairs. Hard barriers stop selection rather than being grouped around.
- **Decision constraints**: Complete turns are normal; message and call-pair integrity outrank token targets; one indivisible oversized message may overshoot.
- **Code anchors**: Existing `extensions/accordion/conductors/my-customize-conductor/chunked-compaction.ts` → `computePreGroupFromIndex`, `noOpenToolPairAcrossPreGroupTail`, `trimOpenToolPairs`, `effectivePreGroupTokens`; existing `my-customize-conductor.ts` → `isGroupBoundary`, `isChunkedPreGroupBoundary`, `MyCustomizeConductor.conduct`; existing `store.svelte.ts` → `buildView`, `snappedRange`, `createGroup`.
- **Existing behavior**: Walk-back is block-based; user/MCP/recall/pstack content stops selection; host snapping can expand an endpoint after conductor selection.
- **Required edits**: Introduce pure complete-turn/unit selection; remove user/MCP/recall/pstack from chunked-compaction hard barriers while retaining them for unrelated pressure-fold policy where required; add safe oversized-turn cut selection; feed exact selected IDs into existing trigger and pair-balance gates.
- **Normative snippet**:
  ```ts
  type SafeCompactionRange = {
    fromIndex: number;
    toIndexExclusive: number;
    oversizedTurnSplit: boolean;
  };
  ```
  This shape is normative in meaning, not required in exact TypeScript naming.
- **Test seam**: Extend `conductor.compaction-naive.test.ts` around `walking skeleton emits one chunked-compaction group`, open-pair tests, and the balanced-pair property; extend `store.groups.test.ts` for message-key endpoints. Run `cd extensions/accordion/app && npx vitest run src/lib/engine/conductor.compaction-naive.test.ts src/lib/engine/store.groups.test.ts`; success is zero failed tests and emitted ranges satisfying message/call-pair assertions.
- **Wiring**: No registration change; `MyCustomizeConductor` continues calling helpers in-process and emitting existing `GroupCommand` values.
- **Grounding evidence**: `GROUND-001`, `GROUND-002`, `GROUND-005`.

### Area: Deterministic MCP Retrieval Index

- **Coverage**: `DEC-002`, `DEC-004`, `DEC-005`, `DEC-007`, `US-001`, `RB-006`–`RB-010`, `RB-014`, `RB-016`.
- **Contract**: Pair MCP results with tool calls by `callId`; build Canonical MCP Identities; group occurrences by identity; order identities and occurrences deterministically by their conversation positions; append newest/full and older/compact references as the final digest section. Do not expose sensitive argument values.
- **Decision constraints**: Canonical order is unchanged; same corpus means byte-identical digest; the final digest cost participates in the existing minimum-savings check.
- **Code anchors**: Existing `mcp-summary.ts` → `mcpSummary`, `pstackIdentityFromMcpCall`, `pstackRecallSummary`, `foldCode`, argument parsing/redaction helpers; existing `chunked-compaction.ts` → `digestBody`, `digestMembersFooter`, `composeDigest`, `corpusContentHash`; existing `my-customize-conductor.ts` → `callById`, `pstackByBlockId`, rollover digest assembly.
- **Existing behavior**: Per-block MCP replacement summaries already expose names, labels, redacted previews, fold codes, and imperative recall syntax; chunked digests currently emit excerpts and an unlabeled member-code footer only.
- **Required edits**: Add canonical argument normalization/fingerprinting; add identity/occurrence types and deterministic index formatter; include generic fallback entries; compose the index last; calculate savings from the completed digest rather than a default digest approximation that omits index cost.
- **Normative snippet**:
  ```text
  MCP context retained:
  - <safe label>
    Identity: <server>/<tool> · <fingerprint>
    Latest: turn <n> · {#<code>}
    Recall: recall({"codes":["<code>"]})
    Earlier: turn <n> · {#<code>}; ...
  ```
- **Test seam**: Extend `conductor.my-customize-conductor.test.ts` for canonicalization, argument-order equivalence, redaction, generic fallback, repeated calls, and exact recall instructions; extend deterministic replay and minimum-saving tests in `conductor.compaction-naive.test.ts`. Success includes byte-identical digests for equivalent canonical input and no sensitive fixture values in output.
- **Wiring**: No protocol or persistence wiring; formatter output remains `GroupCommand.digest`.
- **Grounding evidence**: `GROUND-002`, `GROUND-003`, `GROUND-005`.

### Area: Grouped-Member Recall

- **Coverage**: `DEC-003`, `US-001`, `RB-011`–`RB-014`, `RB-016`.
- **Contract**: A per-member code belonging to a folded chunked-compaction group resolves to exactly that member's original content. Resolution does not change group state, block override state, or historical plan. Group-code recall and chunked-member unfold preserve existing behavior.
- **Decision constraints**: Do not call `appendToTail` from recall; do not unfold any group; do not duplicate the normal Pi recall result.
- **Code anchors**: Existing `extensions/accordion/app/src/lib/live/plan.ts` → `resolveRecall`, `resolveUnfold`, `isChunkedCompactionGroupMember`; existing `extensions/accordion/extension/accordion.ts` → `requestRecall`, registered `recall` tool; existing `live/protocol.ts` → `RecallContent` and recall request/result messages.
- **Existing behavior**: Group-code recall returns all originals read-only; the per-block branch skips folded group members; unfold already recognizes a chunked member and calls `appendToTail`; the extension returns recall content as an ordinary Pi tool result.
- **Required edits**: In `resolveRecall`, recognize per-member codes inside chunked-compaction groups and return one `RecallContent` using original block text and one member ID before the generic folded-group skip; retain collision behavior consistent with existing code matching; leave extension tool registration unchanged except comments/tests if clarification is needed.
- **Normative snippet**:
  ```ts
  // For a chunked group member code:
  { code, label, text: originalMemberText, ids: [memberId] }
  // No store mutation.
  ```
- **Test seam**: Add `plan.test.ts`/`plan.groups.test.ts` cases proving member-only content, group remains folded, overrides unchanged, no `appendToTail`, group-code recall unchanged, and unknown code remains missing. Run `cd extensions/accordion/app && npx vitest run src/lib/live/plan.test.ts src/lib/live/plan.groups.test.ts`; success is zero failed tests.
- **Wiring**: Existing GUI recall protocol returns `RecallContent`; existing extension tool echoes it and Pi records the normal tool call/result. No new wire field or tool registration.
- **Grounding evidence**: `GROUND-004`, `GROUND-005`.

### Area: Engine, Wire, and Cache Invariants

- **Coverage**: `DEC-001`, `DEC-002`, `DEC-003`, `DEC-006`, `US-001`, `US-002`, `RB-005`, `RB-012`–`RB-016`.
- **Contract**: Existing group snapping, frozen-prefix bypass for non-empty deterministic group digests, balanced-pair wire fixpoint, immutable groups, and one-break-per-rollover accounting remain valid with the new selected range and digest.
- **Decision constraints**: No move/reorder command, no protocol version change, and no second recall append.
- **Code anchors**: Existing `store.svelte.ts` → `groupCmd`, `createGroup`, `snappedRange`, `appendToTail`; existing `live/mapping.ts` → `applyPlan` group/tool-pair fixpoint; existing `chunked-compaction-invariant.test.ts`; existing `extension/accordion.chunkedCompactionJsonl.test.ts`.
- **Existing behavior**: Host rejects protected overlap and malformed groups, wire mapping retains unbalanced stragglers, non-empty group digests may deliberately break frozen prefix once, and diagnostics count rollover/cache breaks.
- **Required edits**: No production edit is expected in engine/wire mapping beyond any local type/helper import required by the owning areas. Add integration assertions that the new ranges apply without clamps, recall does not change existing group ops/digests, and diagnostics still satisfy the rollover/cache-break invariant.
- **Test seam**: Run the full suite and property/invariant tests. Success means all tests pass, emitted group IDs are balanced/contiguous, replay digest is byte-identical, and `count(rollover) == cacheBreaks - coldStarts` remains true in its stable-provider fixture.
- **Wiring**: Existing in-process conductor, store command application, `applyPlan`, WebSocket recall request/result, and JSONL diagnostics remain the complete path.
- **Grounding evidence**: `GROUND-001`, `GROUND-004`, `GROUND-005`.

### Area: Domain and Architecture Documentation

- **Coverage**: `DEC-001`–`DEC-007`, `US-001`, `US-002`, `RB-001`–`RB-016`.
- **Contract**: Documentation uses **Complete Accordion Turn**, **MCP Retrieval Index**, and **Canonical MCP Identity** consistently and records that ADR-0005 supersedes block-level ADR-0004 behavior.
- **Code anchors**: Existing `CONTEXT.md`; `docs/adr/0004-accordion-chunked-compaction.md`; `docs/adr/0005-turn-aligned-chunked-compaction-and-mcp-retrieval.md`.
- **Existing behavior**: Glossary and superseding ADR already contain the accepted terms and architectural decision.
- **Required edits**: Keep docs synchronized if implementation names or examples change; do not revert ADR-0005's accepted constraints.
- **Test seam**: Review links/status frontmatter and ensure code/test terminology matches the glossary.
- **Wiring**: None.
- **Grounding evidence**: Grill ledger and accepted ADR-0005.

## Global Build & Wiring Notes

- The change remains inside the existing in-process `MyCustomizeConductor`, Accordion store/live plan, and registered `recall` tool path.
- No migration, generated code, dependency injection, persistence, or protocol-version work is required.
- App-level Vitest is the authoritative command because its config includes both app library and extension tests.
- Required final commands:
  ```sh
  cd extensions/accordion/app
  npm test
  npm run check
  ```
- Recognizable success is Vitest reporting zero failed tests and `svelte-check` reporting zero errors.

## Testing Decisions

- Test observable range membership and applied group behavior rather than private helper layout.
- Pin the walking skeleton end to end: completed MCP-bearing turn → emitted/applied immutable group → named index entry → member recall → unchanged folded group.
- Add table-driven boundary cases for multi-part messages, multiple tool calls, open pairs, hard barriers, normal turns, oversized turns, and one indivisible oversized message.
- Extend the existing balanced-tool-pair property test to assert no emitted boundary splits a `messageKey` and no hard barrier is included.
- Test canonical identity with reordered JSON keys, nested argument normalization, different arguments, missing call metadata, and sensitive keys.
- Test repeated identity formatting and newest-default guidance without requiring a new name-based runtime API; the agent uses the displayed code.
- Test grouped-member recall as read-only and single-member, while retaining existing group-code recall and member-unfold behavior.
- Preserve deterministic replay, no-repeat rollover, context-window gate, fold consistency, JSONL rollover, and cache-break invariant suites.

## Out of Scope

- Physically moving or reordering MCP tool calls/results.
- A name-based recall API; names guide the agent to an explicit code.
- Recalling every repeated occurrence automatically.
- Nested groups or summary-of-summaries compaction.
- New conductor commands, protocol fields, protocol versions, UI settings, persistence, or LLM-generated summaries.
- Splitting one provider message or breaking a tool-call/tool-result pair.
- Changing Proactive Content Compression or its A1 exemption policy.

## Unresolved Gaps

None.

## Further Notes

- Grill ledger: `.scratch/grills/a7d3c91f2b6e/ledger.md`
- Grounding evidence: `.scratch/grills/a7d3c91f2b6e/grounding.md`
- Governing ADR: `docs/adr/0005-turn-aligned-chunked-compaction-and-mcp-retrieval.md`
