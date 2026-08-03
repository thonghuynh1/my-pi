# Grill Ledger — aiKnow × Subagents Efficiency Improvement

Status: active

## Context

The prior cooperation PRD (`.scratch/aiknow-subagent-cooperation/PRD.md`) deliberately limited integration to generic prompt guidance and excluded an orchestrator, structured handoff, changes to `subagents.ts`, and aiKnow inside child sessions. The completed benchmark shows that this guidance-only contract improves answer quality slightly but does not improve token use or latency.

## Decisions

### DEC-001 — Ownership of the discovery-to-verification handoff

- Status: accepted
- Decision: Extend the generic `subagent` interface with an optional structured Evidence Packet. When aiKnow is used, the parent can translate indexed findings into bounded verification evidence. When aiKnow is absent or unused, callers continue using the existing prose-only subagent interface unchanged.
- Rationale: This addresses broad rediscovery without making aiKnow mandatory, teaching Subagents about aiKnow, or introducing a dedicated cross-extension orchestrator.
- Evidence: GROUND-001 through GROUND-006.
- Dependencies: none.
- Decided: the cooperation seam is a generic, optional Subagent input contract.
- Left to the implementer: local type names, helper extraction, and equivalent internal organization.

### DEC-002 — Evidence Packet enforcement semantics

- Status: accepted
- Decision: Use hybrid enforcement for packet-based runs. `maxTurns`, `maxToolCalls`, and timeout are hard ceilings; anchors and preferred files are strong scope guidance rather than an absolute allowlist. Reaching a ceiling returns partial findings with an explicit incomplete status. Runs without an Evidence Packet retain current unlimited behavior.
- Rationale: Hard cost ceilings prevent the benchmark's runaway exploration, while soft file boundaries allow a verifier to follow a necessary referenced symbol outside imperfect discovery results.
- Evidence: GROUND-002, GROUND-003, GROUND-005.
- Dependencies: DEC-001.
- Decided: bounded packet runs terminate predictably and report incompleteness rather than pretending verification succeeded.
- Left to the implementer: local counter/helper organization and UI wording consistent with the status contract.

### DEC-003 — Trust level of indexed evidence

- Status: accepted
- Decision: Use split trust. aiKnow file/line/symbol pointers are trusted as routing evidence, while behavioral summaries and inferred relationships remain claims requiring targeted native-source verification.
- Rationale: This removes broad location rediscovery without pretending the current adapter proves index freshness or that indexed summaries are source-level proof.
- Evidence: GROUND-001, GROUND-005, GROUND-007, GROUND-008.
- Dependencies: DEC-001.
- Decided: packet consumers start at supplied anchors and verify only material behavioral claims.
- Left to the implementer: local result-label naming as long as confirmed, contradicted, and unresolved remain distinguishable.

### DEC-004 — Evidence Packet construction

- Status: accepted
- Decision: aiKnow emits a ready, source-agnostic Evidence Packet candidate from its existing structured pointer extraction. The parent explicitly selects and partitions entries for Subagent calls; no automatic dispatch or implicit latest-result state is introduced.
- Rationale: This removes lossy prompt-to-packet synthesis while keeping delegation visible, optional, and free of hidden cross-extension lifecycle coupling.
- Evidence: GROUND-001, GROUND-003, GROUND-005, GROUND-007.
- Dependencies: DEC-001, DEC-003.
- Decided: aiKnow is a packet producer; the parent remains the delegation coordinator.
- Left to the implementer: compact serialization details and equivalent field naming consistent with the generic Subagent schema.

### DEC-005 — Packet partitioning and overlap

- Status: accepted
- Decision: Every original claim has exactly one owning Subagent. Preferred files are not a hard allowlist, so children may follow necessary references within their hard budgets. Cross-task anchors must be explicit. Out-of-scope discoveries are returned as structured new leads, and the parent reconciles every original claim and new lead.
- Rationale: Claim ownership prevents duplicate primary verification, while the bounded discovery escape lane preserves the freedom to follow real code dependencies and avoids silently dropping newly discovered behavior.
- Evidence: GROUND-004, GROUND-005, GROUND-006.
- Dependencies: DEC-004.
- Decided: every original claim ends as confirmed, contradicted, or unresolved; every new lead ends as covered, irrelevant, or assigned once.
- Left to the implementer: grouping heuristic and reversible task labels.

### DEC-006 — Follow-up policy for unresolved claims and new leads

- Status: accepted
- Decision: Reconciliation may launch at most one bounded automatic follow-up batch containing only unresolved high-priority claims or relevant new leads. After that batch, all remaining gaps must be reported as unresolved; no further automatic retry is allowed.
- Rationale: One follow-up preserves a controlled completeness escape lane without recreating unbounded work through repeated replacement children.
- Evidence: GROUND-004, GROUND-005.
- Dependencies: DEC-002, DEC-005.
- Decided: the follow-up batch is subject to the same hard runtime limits and ownership/reconciliation contract as the initial batch.
- Left to the implementer: exact materiality scoring, provided it is deterministic and tested.

### DEC-007 — Default child safety ceilings

- Status: accepted, amended
- Decision: Packet-driven children default to and are capped at 16 turns, 30 tool calls, and 300 seconds. These are emergency per-child safety rails, not a delegation strategy or target. Fixed initial/follow-up child-count quotas are rejected in favor of adaptive selection.
- Rationale: The benchmark's useful backend child completed at 16 turns and 26 tool calls, while the runaway read-state child reached 34 turns and 54 calls. Per-child ceilings cut demonstrated runaway work without encouraging the parent to fill a batch quota.
- Evidence: GROUND-004, GROUND-005.
- Dependencies: DEC-002, DEC-006.
- Decided: Subagents owns these defaults and absolute caps. A packet may request lower limits but may not raise them. Global or project configuration may deliberately change the runtime caps. Prose-only runs remain unaffected.
- Left to the implementer: configuration file placement and field naming consistent with existing Subagent configuration layering.

### DEC-008 — Adaptive delegation selection

- Status: accepted
- Decision: Evidence Packet cooperation optimizes whether and how to delegate rather than maximizing or filling a Subagent batch. Exact anchors involving at most roughly three files should normally be verified directly by the parent; one cohesive multi-file flow should normally use one child; multiple children are reserved for genuinely independent subsystems. Related claims are grouped into one coherent child task, and already verified claims are not re-read by the parent.
- Rationale: Runtime run tracking and fixed fan-out limits bound calls but do not make delegation intelligent. The benchmark waste came from broad task selection and repeated parent verification, so routing, grouping, and duplicate suppression are the primary controls.
- Evidence: GROUND-004 through GROUND-007.
- Dependencies: DEC-004, DEC-005, DEC-007.
- Decided: zero, one, or two children is the normal outcome; this is guidance rather than a quota. Per-child turn/tool/time ceilings remain emergency backstops. One targeted follow-up remains available only for material unresolved behavior.
- Left to the implementer: exact grouping thresholds and wording, provided deterministic tests cover direct, single-child, parallel-child, and no-follow-up cases.

### DEC-009 — Source of adaptive routing recommendations

- Status: accepted
- Decision: aiKnow emits objective compact verification-shape metadata with its source-agnostic Evidence Packet candidate, including claim groups, claim IDs, distinct file and anchor counts, subsystem labels, and whether the group represents a cross-file flow. The parent applies the generic adaptive policy and remains responsible for choosing direct reads, one child, or parallel children. Subagents does not route internally.
- Rationale: Objective shape data makes routing more deterministic without coupling aiKnow to runtime tool availability or coupling Subagents to aiKnow.
- Evidence: GROUND-001, GROUND-003, GROUND-007.
- Dependencies: DEC-004, DEC-008.
- Decided: aiKnow describes verification breadth; the parent chooses execution strategy.
- Left to the implementer: compact field names and serialization format consistent with the generic packet contract.

### DEC-010 — Claim grouping algorithm

- Status: accepted
- Decision: Use graph-first grouping with path fallback. Anchors connected by callers, callees, shared symbols, or the same claim form a cohesive group. Small disconnected groups may merge when they share a repository-defined or top-level subsystem. Groups remain independent when neither graph connections nor path families overlap. Cross-group anchors are references and do not duplicate primary claim ownership.
- Rationale: Graph relationships preserve behavioral cohesion, while path fallback handles incomplete graphs without automatically creating one child per claim.
- Evidence: GROUND-004, GROUND-005, GROUND-007.
- Dependencies: DEC-008, DEC-009.
- Decided: the parent may merge packet groups when direct verification is cheaper, but it must preserve claim ownership and coverage accounting.
- Left to the implementer: deterministic tie-breaking and generic path-family extraction, covered by tests.

### DEC-011 — Adaptive routing thresholds

- Status: accepted
- Decision: Use configurable initial thresholds with telemetry. Exact local groups with at most three distinct files and six anchors, and no cross-file flow, default to direct parent verification. Cohesive groups exceeding either threshold or requiring a cross-file flow default to one child. Two or more independent child-qualified groups may run in parallel. Confirmed groups are skipped, and only material unresolved behavior qualifies for the single targeted follow-up.
- Rationale: The deterministic policy makes delegation smarter and explainable without treating child counts as quotas; telemetry permits later calibration from real A/B runs.
- Evidence: GROUND-004 through GROUND-006, GROUND-009.
- Dependencies: DEC-008, DEC-009, DEC-010.
- Decided: record strategy, shape counts, children, turns, tools, tokens, cost, outcomes, and redundant parent reads. Global/project configuration may tune thresholds.
- Left to the implementer: telemetry storage/renderer details consistent with existing usage accounting.

### DEC-012 — Model-visible packet delivery

- Status: accepted
- Decision: aiKnow automatically appends a compact model-visible Evidence Packet candidate for broad inferred exploration/flow searches. Narrow lookups omit it unless explicitly requested. The complete structured packet also remains in tool-result details for persistence, rendering, and telemetry. No second packet tool call or implicit latest-result state is introduced.
- Rationale: The parent receives routing-ready evidence exactly when adaptive delegation is relevant without paying packet overhead on every lookup.
- Evidence: GROUND-001, GROUND-007, GROUND-009.
- Dependencies: DEC-004, DEC-009, DEC-011.
- Decided: compact content includes group IDs, claim IDs/summaries, file and anchor counts, subsystem/cross-file shape, and concrete file/line/symbol anchors.
- Left to the implementer: deterministic compact formatting and explicit override parameter naming.

### DEC-013 — Child packet slicing

- Status: accepted
- Decision: Each packet-driven child receives a versioned, self-contained selected slice containing only its owned claims, concrete anchors, explicit cross-group references, and effective per-child safety limits. It does not receive unrelated packet groups, and IDs are never passed without the data needed to resolve them in the isolated child session.
- Rationale: Selected slices preserve child isolation and verification freedom while avoiding whole-packet duplication and unusable parent-local references.
- Evidence: GROUND-002, GROUND-003, GROUND-005.
- Dependencies: DEC-004, DEC-005, DEC-012.
- Decided: cross-group references provide context/escape lanes but do not transfer primary claim ownership.
- Left to the implementer: compact field naming and schema validation diagnostics.

### DEC-014 — Structured child verification output

- Status: accepted
- Decision: Packet-driven child sessions receive a strict terminating `report_verification`-style tool. It requires every owned claim exactly once with confirmed, contradicted, or unresolved status; explanations and native source evidence for resolved claims; and structured materiality/anchors for new leads. The completion call counts toward the 30-tool ceiling. If the child terminates or reaches a ceiling without valid completion, every unreported claim becomes unresolved and the result is marked incomplete.
- Rationale: A structured completion seam makes reconciliation, duplicate suppression, follow-up selection, and telemetry deterministic without parsing or asking the parent to reinterpret prose.
- Evidence: GROUND-002 through GROUND-006.
- Dependencies: DEC-005, DEC-006, DEC-013.
- Decided: ordinary prose-only children retain current output behavior.
- Left to the implementer: tool name and user-facing formatting while preserving the strict result contract.
- Compatibility constraint: Regression tests must prove that omitting `evidencePacket` preserves existing resolved configuration, child tools/prompts, timeout behavior, and prose result shape exactly.

### DEC-015 — Canonical packet contract ownership

- Status: accepted
- Decision: Subagents owns the canonical versioned `EvidencePacketV1` consumer contract and validation. aiKnow maintains a producer-side representation and fixture conforming to that public contract. Cross-repository compatibility is proven through a shared canonical fixture exercised by producer and consumer tests; no runtime package dependency is introduced.
- Rationale: The generic consumer owns what it accepts, avoiding an aiKnow dependency and shared-package publishing overhead.
- Evidence: GROUND-001 through GROUND-003, GROUND-007.
- Dependencies: DEC-001, DEC-004, DEC-013, DEC-014.
- Decided: the existing `subagent` schema gains one compact optional `evidencePacket` field. This small parent-schema cost is accepted to avoid a duplicate delegation tool; packet-only child behavior remains fully gated after validation.
- Left to the implementer: fixture transport/update workflow that runs in each repository's CI without filesystem coupling.

### DEC-016 — Invalid or unsupported packet behavior

- Status: accepted
- Decision: Invalid, incomplete, or unsupported-version packets explicitly downgrade to an ordinary prose-only Subagent run. The entire packet is discarded rather than partially injected. Parent-visible output and tool-result details report `mode: prose-fallback`, `packetAccepted: false`, and an actionable packet error. The prose result is not treated as structured claim confirmation.
- Rationale: Graceful fallback preserves delegation usability and existing behavior, while explicit downgrade metadata prevents callers from believing packet ceilings or claim coverage were enforced.
- Evidence: GROUND-003, GROUND-005.
- Dependencies: DEC-002, DEC-013, DEC-015.
- Decided: fallback uses ordinary prompts, tools, limits, and prose output; schema-drift telemetry is recorded.
- Left to the implementer: warning presentation and diagnostic codes.

### DEC-017 — Benchmark ownership

- Status: accepted
- Decision: Automated A/B benchmarking is out of scope for this implementation. The user will run and judge comparative benchmarks separately. The implementation exposes sufficient packet-mode telemetry and usage data to support that manual evaluation but does not encode token, cost, latency, or quality thresholds as delivery gates.
- Rationale: The feature should provide observable behavior without coupling implementation completion to a potentially expensive and variable model benchmark suite.
- Evidence: GROUND-004 through GROUND-006, GROUND-009.
- Dependencies: DEC-007, DEC-008, DEC-011, DEC-014.
- Decided: deterministic correctness and compatibility tests remain required; benchmark execution and scoring do not.

### DEC-018 — Automated proof depth

- Status: accepted
- Decision: Automated proof is limited to pure deterministic tests for packet schemas, grouping, routing, reconciliation, compatibility fixtures, and legacy no-packet behavior at pure configuration boundaries. Mocked AgentSession lifecycle tests and real model-backed automation are out of scope.
- Rationale: The user prefers a small deterministic test surface and will perform runtime model evaluation manually.
- Evidence: GROUND-002, GROUND-003, GROUND-009.
- Dependencies: DEC-014 through DEC-017.
- Decided: manual smoke testing must cover runtime completion-tool injection, ceiling termination, explicit fallback, and output rendering because automated lifecycle coverage is intentionally omitted.
- Left to the implementer: pure module boundaries that make all accepted policy decisions independently testable.

### DEC-019 — Timeout compatibility

- Status: accepted
- Decision: Valid packet-driven runs use a separate internal 300-second timeout path that bypasses the ordinary top-level minimum normalization. Ordinary calls retain the existing 600-second minimum behavior, and invalid packets that explicitly downgrade to prose fallback use ordinary timeout behavior.
- Rationale: Targeted packet work needs an effective wall-clock safety rail without altering legacy Subagent semantics. Turn/tool ceilings should normally stop work first; the timer covers slow or hung operations.
- Evidence: GROUND-010.
- Dependencies: DEC-007, DEC-018.
- Decided: packet input may request a lower timeout but may not exceed 300 seconds.
- Left to the implementer: internal timer composition with parent cancellation while preserving clear termination reasons.

### DEC-020 — Ceiling termination semantics

- Status: accepted
- Decision: Reserve capacity inside the hard ceilings for a report-only finish: up to 15 investigation turns and 29 source-tool calls, followed by at most one final turn/call to `report_verification`. At an investigation ceiling, source tools are unavailable and the child may only submit structured results. Total remains at most 16 turns and 30 tool calls. If no valid report arrives, unresolved/incomplete outcomes are synthesized. The 300-second wall-clock timeout aborts immediately with no grace turn.
- Rationale: This preserves already discovered evidence without turning a safety ceiling into an unbounded grace period.
- Evidence: GROUND-002, GROUND-010 and runtime event handling in `runSubagent`.
- Dependencies: DEC-007, DEC-014, DEC-019.
- Decided: the completion-tool call is included in accounting; current source operations may complete only when they began below the source-tool threshold.
- Left to the implementer: exact report-only transition mechanism supported by the Pi session API.

### DEC-021 — Completion-tool integration mechanism

- Status: accepted
- Decision: Define `report_verification` as an SDK custom tool and pass it through `customTools` only when creating a valid packet-driven child. Include its name in the child tool allowlist. At the reserved final-report transition, call `AgentSession.setActiveToolsByName(["report_verification"])`; the supported API rebuilds the prompt and applies the restricted tool set on the next turn.
- Rationale: This uses documented Pi SDK seams, preserves extension isolation (`noExtensions: true`), and avoids inventing runtime mutation behavior.
- Evidence: GROUND-011.
- Dependencies: DEC-014, DEC-020.
- Decided: ordinary child sessions receive no completion tool; report-only transition uses a follow-up turn inside the reserved ceiling.
- Left to the implementer: tool closure/state capture and disposal details.

### DEC-022 — Prototype disposition

- Status: accepted
- Decision: Remove the throwaway routing prototype and its package script immediately. Preserve the validated adaptive-routing decision in this ledger and implement it once in production policy code with deterministic tests.
- Rationale: The prototype has answered its design question; retaining it would create a second implementation that can drift.
- Evidence: GROUND-009.
- Dependencies: DEC-011, DEC-018.
- Decided: removal occurs before production implementation, not afterward.

## Prior decisions under reconsideration

- Prior `DEC-004` kept Subagents entirely unaware of structured upstream discovery and prohibited a cooperation layer.
- Prior implementation used generic wording only. Benchmark evidence now contradicts the assumption that guidance alone creates an efficient handoff.
