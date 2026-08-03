# PRD — Adaptive aiKnow-to-Subagent Verification

Status: ready-for-agent

Source grill: `.scratch/grills/c4e8b1d7a2f9/ledger.md`  
Grounding: `.scratch/grills/c4e8b1d7a2f9/grounding.md`  
Supersedes for this behavior: `.scratch/aiknow-subagent-cooperation/PRD.md`

## Problem

Today aiKnow discovery is additive: after receiving useful pointers, parent and child agents still rediscover broad repository context. In the reference benchmark this made aiKnow + Subagents 48% slower and about 11.7% more token-heavy than grep + Subagents, including a runaway 34-turn/54-tool-call child. We need indexed evidence to shape and bound verification while preserving current behavior for every ordinary Subagent user.

## Solution

Add a versioned, optional, source-agnostic **Subagent Evidence Packet**. Broad/hybrid aiKnow searches emit a compact candidate containing routing anchors, unverified claims, graph/path-based groups, and objective shape metadata. The parent explicitly selects self-contained slices and chooses the smallest suitable verification mode: direct native reads, one cohesive child, or parallel children for independent groups.

Valid packet children receive only owned claims and relevant anchors, use hard turn/tool/time ceilings, and finish through a strict `report_verification` tool. Anchors are guidance, not file allowlists. Invalid packets visibly downgrade to existing prose-only behavior. aiKnow remains optional and is never loaded inside child sessions.

## User Stories

1. **US-001**: As a Pi user, I want aiKnow discovery to replace redundant exploration with focused verification.
2. **US-002**: As a parent agent, I want objective routing metadata so I can choose zero, one, or parallel children without arbitrary fan-out.
3. **US-003**: As a packet child, I want self-contained claims, anchors, limits, and structured completion so every owned claim has a clear outcome.
4. **US-004**: As a non-aiKnow Subagent user, I want prompts, tools, timeouts, and prose results to remain unchanged.
5. **US-005**: As a manual benchmarker, I want packet mode, route shape, limits, outcomes, usage, and downgrade details preserved in tool/session data.

## Walking Skeleton

A broad `aiknow_search` obtains structured matches and relationships through existing HTTP wiring and returns an `EvidencePacketV1` candidate in compact content plus full details. The parent selects one cohesive group and calls `subagent` with that valid slice. The isolated child starts from native-source anchors and submits every claim through `report_verification`. Deterministic fixture/adapter tests and a manual Pi smoke prove the path; no production orchestrator or live-model test is required.

## Required Behaviors

- **RB-001**: `evidencePacket` is optional. Omitting it preserves current Subagent configuration, prompts, tools, 600-second timeout normalization, and result behavior.
- **RB-002**: Subagents has no aiKnow dependency or producer-specific branch.
- **RB-003**: Broad/hybrid aiKnow searches automatically include a compact packet; narrow lookup inclusion requires an explicit override.
- **RB-004**: File/line/symbol pointers are trusted for routing; behavioral claims require native-source verification.
- **RB-005**: Each delegated claim has exactly one owner. Cross-group references do not duplicate ownership.
- **RB-006**: Files/anchors are soft guidance. Children may follow dependencies and report structured new leads.
- **RB-007**: Default direct verification requires no cross-file flow, at most 3 files, and at most 6 anchors. Larger cohesive groups use one child; parallel children require independent qualifying groups.
- **RB-008**: Child counts are not quotas. Zero, one, or two children is normal.
- **RB-009**: Packet children cap at 16 total turns, 30 total tool calls, and 300 seconds. Turn 16/call 30 are reserved for reporting; source investigation stops at 15 turns or 29 calls.
- **RB-010**: At an investigation ceiling, only `report_verification` remains active. A wall-clock timeout aborts immediately without grace.
- **RB-011**: Every owned claim is reported once as `confirmed`, `contradicted`, or `unresolved`. Resolved claims require native file/line/symbol evidence and explanation.
- **RB-012**: Missing/invalid structured completion marks unreported claims unresolved and the result incomplete.
- **RB-013**: The parent may run at most one targeted follow-up batch for material unresolved claims or leads, then discloses remaining gaps.
- **RB-014**: Invalid/unsupported packets discard all packet data and run ordinary prose fallback with `mode: "prose-fallback"`, `packetAccepted: false`, and an actionable warning.
- **RB-015**: Packet-supplied limits may lower but never exceed runtime caps. Existing project/global configuration layering may deliberately change caps and routing thresholds.
- **RB-016**: Full packets live in details; model-visible output contains only routing fields.
- **RB-017**: aiKnow internally obtains sufficient relationship detail and groups graph-first, with deterministic path-family fallback.
- **RB-018**: Packet details are attached after generic aiKnow detail adaptation so recursive `aiknow_read` rewriting cannot mutate them.
- **RB-019**: Automated tests are pure and deterministic: schemas, grouping, routing, reconciliation, fixtures, fallback, and no-packet boundaries only.
- **RB-020**: Details retain packet/group IDs, shape, effective limits, termination, outcomes, usage, and downgrade diagnostics.

## Accepted Decision Register

| ID | Decision | Key constraint / rejected alternative |
|---|---|---|
| DEC-001 | Add optional generic packet to existing `subagent`. | No dedicated aiKnow orchestrator; prose use stays valid. |
| DEC-002 | Hard time/turn/tool ceilings; soft anchor guidance. | No hard file allowlist or soft-only safety. |
| DEC-003 | Trust pointers for routing, not behavioral truth. | No unverified indexed-summary confirmation. |
| DEC-004 | aiKnow emits candidate; parent selects/partitions it. | No implicit shared state or automatic dispatch. |
| DEC-005 | One owner per claim; children may return leads. | No overlapping primary tasks. |
| DEC-006 | At most one material follow-up batch. | No recursive retries. |
| DEC-007 | Default per-child caps: 16 turns, 30 calls, 300s. | Safety rails, not routing targets. |
| DEC-008 | Adaptively choose direct/one/parallel. | No batch filling or one-child-per-claim rule. |
| DEC-009 | aiKnow emits objective group/claim/shape facts. | Producer does not mandate execution strategy. |
| DEC-010 | Graph-first grouping, path-family fallback. | Neither directory-only nor graph-only. |
| DEC-011 | Direct defaults: ≤3 files, ≤6 anchors, no flow. | Configurable via existing layering. |
| DEC-012 | Auto packet for broad/hybrid; override for narrow. | Not packet-on-every-search or details-only. |
| DEC-013 | Child gets a selected self-contained slice. | Not IDs-only or entire packet. |
| DEC-014 | Packet child must use `report_verification`. | No prose parsing for claim reconciliation. |
| DEC-015 | Subagents owns canonical `EvidencePacketV1`. | aiKnow conforms by duplicated fixture; no runtime/shared-package coupling. |
| DEC-016 | Invalid packet visibly falls back to prose. | No fail-closed, partial, or silent fallback. |
| DEC-017 | User owns manual A/B benchmarking. | No automated performance gate. |
| DEC-018 | Only pure deterministic automated tests. | No mocked AgentSession or model-backed automation. |
| DEC-019 | Valid packets bypass ordinary 600s minimum for 300s cap. | Ordinary/fallback timeout behavior unchanged. |
| DEC-020 | Reserve final turn/call for report-only finish. | Total remains 16/30; timeout gets no grace. |
| DEC-021 | Inject completion via SDK `customTools`; switch with `setActiveToolsByName`. | Keep `noExtensions: true`; do not parse prose. |
| DEC-022 | Throwaway prototype remains removed. | No duplicate simulator/production dependency. |

Full rationale, rejected alternatives, dependencies, and ledger statuses remain normative in the source grill.

## Implementation Plan

### 1. Generic contract, routing, and reconciliation (`C:/my-pi`)

**Coverage:** DEC-001–003, 005–008, 010–011, 013, 015–018, 022; US-002/004; RB-001/002/004–008/013–016/019.

**Existing anchors:**
- `extensions/subagents.ts`: `SubagentParams`, `normalizeTimeoutSeconds`, `resolveRunConfig`, `SubagentDetails`, `buildSubagentToolDef`.
- `extensions/__tests__/subagents-defaults.test.ts`: current pure `node:test` pattern.

**Planned files:**
- `extensions/lib/evidence-packet.ts`
- `extensions/lib/routing-policy.ts`
- `extensions/lib/reconciliation.ts`
- corresponding tests and `extensions/__tests__/fixtures/evidence-packet-v1.json`

**Required work:**
- Add permissive optional `evidencePacket` to the outer TypeBox schema, then strictly validate internally so malformed input can fall back.
- Define consumer-owned v1 selected-slice types and validation.
- Implement deterministic route classification and claim/lead reconciliation as pure functions.
- Add configurable caps/thresholds through existing package → user → project configuration resolution.
- Ensure generic code and names contain no aiKnow dependency.

```ts
type EvidencePacketV1 = {
  version: 1;
  packetId: string;
  groupId: string;
  claims: Array<{ id: string; summary: string; priority: "material" | "normal" }>;
  anchors: Array<{ path: string; line: number; endLine?: number; symbol: string; kind?: string }>;
  shape: { fileCount: number; anchorCount: number; subsystem: string; crossFileFlow: boolean };
  crossGroupReferences?: Array<{
    groupId: string; path: string; line?: number; symbol?: string; reason: string;
  }>;
  limits?: { maxTurns?: number; maxToolCalls?: number; timeoutSeconds?: number };
};
```

**Tests:** packet valid/invalid/version cases; routing boundaries at 3 files/6 anchors; graph-independent parallel eligibility; exactly-one ownership; lead/follow-up reconciliation; fallback classification; no-packet config/result compatibility; canonical fixture acceptance.

### 2. aiKnow packet producer (`C:/Hackathon/aiKnow/aiKnow`)

**Coverage:** DEC-003/004/009–012/015/017; US-001/002/005; RB-003/004/007/008/016–020.

**Existing anchors:**
- `integrations/pi/aiknow/index.ts`: `SearchParams`, `forwardSearch`, `adaptSearchDetailsForPi`, `HYBRID_GUIDELINES`.
- `integrations/pi/aiknow/response-compressor.ts`: `FilePointer`, `extractPointers`, `compressToPointers`.
- `src/interfaces/http/http-tools.ts`: `isBroad`, structured `matches`, and `context.relationships`.

**Planned files:**
- `integrations/pi/aiknow/evidence-packet.ts`
- `integrations/pi/aiknow/claim-grouper.ts`
- focused tests plus duplicate canonical fixture.

**Required work:**
- Add `verificationPacket?: boolean`: omitted means auto for broad/hybrid, true forces, false suppresses.
- Internally request structured details when generating packets without making verbose details model-visible.
- Enrich relationship endpoints/candidate identity enough for deterministic connectivity.
- Generate stable packet/group/claim IDs, graph components, path-family subsystem labels, counts, and cross-file-flow flags.
- Use caller/callee/shared-symbol/same-claim connectivity first; path-family fallback when edges are absent/incomplete.
- Append compact routing content and attach full untouched packet after generic detail adaptation.
- Update guidance to favor direct reads for small groups, cohesive children, parallelism only for independent groups, and no parent re-read absent contradiction.

**Tests:** producer fixture compatibility; stable grouping; missing/capped-edge fallback; broad/hybrid automatic inclusion; lookup override; suppression; post-adaptation packet integrity; existing hybrid-guidance tests.

### 3. Packet child runtime (`C:/my-pi/extensions/subagents.ts`)

**Coverage:** DEC-001–003/005–007/013/014/016/019–021; US-003/004; RB-001/002/005/006/009–015/019/020.

**Existing anchors:** `runSubagent`, inner `createChildSession`, session handlers for `tool_execution_start`, `turn_end`, `message_end`, `agent_end`, current abort/timeout handling, `renderResult`. Pi SDK supports `customTools` and `AgentSession.setActiveToolsByName()`.

**Required work:**
- Validate packet before selecting timeout mode; valid packet requests use effective ≤300s, ordinary/fallback requests retain existing ≥600s normalization.
- Build packet prompt from owned claims, anchors, references, and limits.
- Define strict packet-only `report_verification` via SDK custom tools while retaining `resourceLoaderOptions: { noExtensions: true }`.
- Count investigation turns/source calls. At 15 turns or 29 calls, deactivate source tools and queue one final report-only turn. At 300s, abort immediately.
- Require every claim exactly once; synthesize unresolved/incomplete for missing reports.
- Preserve ordinary retry/model-fallback behavior only where it does not erase packet accounting.
- Extend details/rendering with mode, validation diagnostics, IDs, limits, termination, outcomes, leads, incomplete flag, and existing usage.

```ts
type VerificationReportV1 = {
  claims: Array<{
    claimId: string;
    status: "confirmed" | "contradicted" | "unresolved";
    explanation: string;
    evidence: Array<{ path: string; line: number; endLine?: number; symbol: string }>;
  }>;
  newLeads: Array<{
    id: string; summary: string; material: boolean;
    anchors: EvidencePacketV1["anchors"];
  }>;
};
```

**Tests:** runtime lifecycle remains manual by accepted decision. Production type-check plus pure validator/reconciler/compatibility tests are required.

### 4. Fixtures, telemetry, and smoke documentation

**Coverage:** DEC-008/011/014–018/022; US-004/005; RB-001/002/014/016/019/020.

- Keep identical canonical fixture copies in both repositories; tests are locally self-contained.
- aiKnow details expose packet/group IDs and shape. Subagent details expose accepted/fallback mode, limits, outcomes, termination, and usage.
- Session JSONL remains durable telemetry; no dashboard/database/migration.
- Do not restore prototype files or package script.

## Build and Test Commands

### `C:/my-pi`

```sh
npx tsx extensions/__tests__/evidence-packet.test.ts
npx tsx extensions/__tests__/routing-policy.test.ts
npx tsx extensions/__tests__/reconciliation.test.ts
npx tsx extensions/__tests__/subagents-compat.test.ts
npm run check
```

### `C:/Hackathon/aiKnow/aiKnow`

```sh
npx vitest run src/test/pi-evidence-packet.test.ts src/test/pi-claim-grouper.test.ts src/test/pi-aiknow-broad-packet.test.ts src/test/pi-aiknow-hybrid-guidelines.test.ts
npm run check:pi
```

Success means all deterministic tests pass and both checks exit 0.

## Manual Smoke

After reloading Pi:

1. Run an ordinary prose child and confirm current tools, timeout normalization, result rendering, and usage behavior.
2. Run a valid packet child and confirm the selected anchors are visible, aiKnow is unavailable inside the child, and `report_verification` produces structured outcomes.
3. Run malformed and unsupported-version packets; confirm ordinary prose execution plus visible `prose-fallback` diagnostics.
4. Supply lowered limits and confirm transition to report-only without exceeding totals.
5. Confirm wall-clock timeout aborts without a grace turn and reports unresolved/incomplete claims.
6. Inspect tool details/session JSONL for shape, limits, termination, outcomes, and usage.
7. The user separately runs/scorers comparative runtime benchmarks; no benchmark number gates delivery.

## Out of Scope

- Automatic Subagent dispatch or a new orchestrator tool.
- aiKnow/extensions inside child sessions.
- Hard file allowlists.
- Fixed child quotas or one child per claim.
- Index freshness attestation or automatic synchronization.
- Shared npm contract package or runtime cross-repository fixture access.
- Mocked AgentSession tests, live-model tests, or automated performance gates.
- Changes to ordinary mode-off semantics, capability visibility, or prose-only behavior.
- Restoring the removed routing prototype.

## Unresolved Gaps

None.

## Grounding

Implementation claims and anchor status are recorded in `.scratch/grills/c4e8b1d7a2f9/grounding.md`, especially GROUND-001–014. Planned files/symbols above are explicitly labeled planned and must not be mistaken for existing code.