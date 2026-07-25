# Grill ledger

Status: consumed

Shared understanding confirmed by the user. All material decisions are accepted; no open gaps remain. Published to `.scratch/accordion-turn-aligned-mcp-retrieval/PRD.md`.

## D1 — Boundary unit for Pre-Group and Protected Tail

- **Status:** accepted
- **Decision:** Align compaction eligibility to complete turns: user message, assistant message parts, and balanced tool-call/tool-result activity remain together. Keep the current partial turn in the Protected Tail and build Pre-Group from older completed turns, allowing bounded tail-size overshoot.
- **Rationale:** Block-level token boundaries can split both provider messages and tool chains, producing group snap expansion, rejection, or trimming. Complete-turn alignment preserves semantic chains and makes rollover deterministic.
- **Evidence:** `extensions/accordion/conductors/my-customize-conductor/my-customize-conductor.ts` (`isGroupBoundary`, `groupRuns`, Pre-Group slice); `extensions/accordion/conductors/my-customize-conductor/chunked-compaction.ts` (`computePreGroupFromIndex`, `noOpenToolPairAcrossPreGroupTail`, `trimOpenToolPairs`); `extensions/accordion/app/src/lib/engine/store.svelte.ts` (`buildView`, `snappedRange`, `createGroup`).
- **Dependencies:** Determines conductor boundary logic, rollover behavior, accounting, and regression tests.

## D2 — MCP handling inside a compacted complete turn

- **Status:** accepted
- **Decision:** Preserve canonical wire chronology. Present named MCP context in a dedicated final section of the deterministic group digest rather than physically moving MCP messages.
- **Rationale:** Accordion has no move command and its block history is positionally immutable. Digest presentation gives the model recency/discoverability without changing provider-history semantics or tool-pair ordering.
- **Evidence:** `extensions/accordion/conductors/contract/conductor.ts` (content-substitution-only command contract); `extensions/accordion/app/src/lib/engine/store.svelte.ts` (append-only block order and contiguous grouping); `extensions/accordion/app/src/lib/live/mapping.ts` (`applyPlan`, tool-pair fixpoint); `extensions/accordion/extension/proactive-compress.ts` (position-sensitive paired tool-name fallback).
- **Dependencies:** Depends on D1; controls digest format and recovery contract.

## D3 — Retrieval contract for named MCP entries inside groups

- **Status:** accepted
- **Decision:** `recall(memberCode)` directly returns the individual grouped member as the current recall tool result. The ordinary Pi tool call/result is then naturally appended to conversation history in the Protected Tail; Accordion must not separately synthesize a second tail copy.
- **Rationale:** This provides both immediate access and normal short-term persistence without reopening the immutable group or duplicating content. It preserves recall's read-only relationship to historical fold state while allowing the new recall result to age normally like any other tool result.
- **Evidence:** `extensions/accordion/app/src/lib/live/plan.ts` (`resolveUnfold`, `resolveRecall`); `extensions/accordion/extension/accordion.ts` (recall tool echoes full content as its tool result); `extensions/accordion/conductors/my-customize-conductor/mcp-summary.ts` (recall-result identity carry-forward).
- **Dependencies:** Depends on D2; controls engine resolver behavior, digest syntax, and tests.

## D4 — Repeated MCP identity selection

- **Status:** accepted
- **Decision:** An unqualified MCP name reference selects the newest matching exact identity by default. Retained older occurrences remain recoverable by their explicit turn label and fold code.
- **Rationale:** Newest is normally authoritative and minimizes recall tokens without deleting historical access.
- **Dependencies:** Depends on D3; controls MCP index grouping, labels, and recall guidance.

## D5 — Canonical MCP identity key

- **Status:** accepted
- **Decision:** Define exact MCP identity from server + tool + a deterministic fingerprint of canonical arguments. Display safe identifying arguments (for example pstack `name`) and redact sensitive values.
- **Rationale:** This distinguishes calls with different arguments without exposing raw secrets or depending on JSON formatting.
- **Dependencies:** Depends on D4; controls deterministic digest format, redaction, matching, and tests.

## D6 — Oversized complete-turn fallback

- **Status:** accepted
- **Decision:** Preserve complete turns normally. If one turn exceeds bounded Protected Tail overflow, split only at the newest safe provider-message boundary with no shared `messageKey` or `callId` crossing. If one provider message is itself oversized, keep it intact and tolerate the unavoidable overshoot.
- **Rationale:** This prevents pathological turns from disabling compaction while preserving provider structure and tool-pair correctness.
- **Dependencies:** Depends on D1; controls boundary fallback and hard-pressure behavior.

## D7 — MCP Retrieval Index occurrence density

- **Status:** accepted
- **Decision:** Emit one full entry per Canonical MCP Identity for its newest occurrence, followed by compact turn-and-code references for older occurrences.
- **Rationale:** This preserves name-based newest lookup and explicit historical recovery without repeating verbose identity and instruction text.
- **Dependencies:** Depends on D4 and D5; controls digest size and historical lookup.

## Established constraints

- **Accepted:** Protected Tail must remain raw and must never be rewritten (ADR-0004).
- **Accepted:** A group never splits an assistant message; engine grouping snaps outward by provider-message key (`store.svelte.ts::snappedRange`).
- **Accepted:** Pre-Group is currently specified as a block-index slice ending immediately before `protectedFromIndex` (ADR-0004), but that statement does not account for a boundary inside a multi-part provider message.
