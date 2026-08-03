# Issue Coverage Ledger — Adaptive aiKnow-to-Subagent Verification

Status: complete after issue publication

Issues:
- `issues/01-walking-skeleton-evidence-packet.md` — AFK, no blockers
- `issues/02-graph-grouped-aiknow-packets.md` — AFK, blocked by 01
- `issues/03-adaptive-routing-and-reconciliation.md` — AFK, blocked by 01
- `issues/04-packet-runtime-safety-and-fallback.md` — AFK, blocked by 01
- `issues/05-integration-guidance-telemetry-and-contract-audit.md` — AFK, blocked by 02/03/04
- `issues/06-runtime-smoke-and-benchmark-handoff.md` — HITL, blocked by 02/03/04/05

## User-story coverage

| Obligation | Owner/proof |
|---|---|
| US-001 indexed discovery replaces rediscovery | 01 broad registered adapter packet criterion; runtime proof 06 valid-packet smoke |
| US-002 objective adaptive selection | 02 grouping/shape criteria + 03 route matrix |
| US-003 self-contained structured child | 01 report completeness/tool gating + 04 ceiling/incompleteness |
| US-004 ordinary users unchanged | 04 legacy snapshot + 06 ordinary smoke |
| US-005 benchmark-readable details | 05 detail projections + 06 JSONL inspection |

## Decision coverage and falsifying criteria

| Decision | State / issue criterion that fails on violation |
|---|---|
| DEC-001 optional existing-tool packet | covered 01 `no-packet boundary and packet tool gating`; fails if a second tool or mandatory packet appears |
| DEC-002 hard ceilings, soft anchors | covered 04 `15/29 transition...`; 06 valid child may follow references; fails if ceilings are soft or paths are allowlisted |
| DEC-003 split trust | covered 01 `verification report completeness...`; fails if resolved claims lack native evidence |
| DEC-004 producer candidate, parent selection | covered 01 broad packet criterion; fails if automatic dispatch/shared state/second call is required |
| DEC-005 unique ownership and leads | covered 02 graph partition + 03 ownership reconciliation; fails on duplicate/lost claim or lead |
| DEC-006 one material follow-up | covered 03 `single material follow-up`; fails if second batch is possible or material first batch is impossible |
| DEC-007 16/30/300 defaults/caps | covered 03 clamping + 04 transition/timeout; fails if packet raises cap or totals exceed caps |
| DEC-008 adaptive zero/one/parallel | covered 03 route matrix + 05 guidance; fails on quota filling or related fan-out |
| DEC-009 objective shape not strategy | covered 02 registered relationship wiring; fails if fields are absent or producer emits dispatch strategy |
| DEC-010 graph-first/path fallback | covered 02 connectivity and incomplete-graph criteria; each algorithm branch has a discriminating fixture |
| DEC-011 exact initial thresholds/config/telemetry | covered 03 route matrix/config + 05 details; fails on boundary/config/telemetry drift |
| DEC-012 broad auto/narrow override | covered 02 three-branch inclusion criterion; fails independently for omitted/true/false semantics |
| DEC-013 selected self-contained slice | covered 01 canonical fixture/tool gating; fails for IDs-only or unrelated whole-packet injection |
| DEC-014 strict structured completion | covered 01 report completeness + 04 synthesis; fails for duplicates/omissions/prose parsing |
| DEC-015 consumer-owned v1/fixture/no coupling | covered 01 consumer fixture + 05 dual conformance; fails on producer ownership/runtime coupling/drift |
| DEC-016 explicit wholesale fallback | covered 04 actionable fallback; fails on silent/partial/fail-closed behavior or structured confirmation |
| DEC-017 manual benchmark ownership | covered 05 no benchmark infrastructure + 06 telemetry handoff; fails if automated thresholds are introduced |
| DEC-018 pure tests/manual lifecycle | covered all AFK pure seams + 06 HITL; fails if mocked AgentSession/live model enters automated suite |
| DEC-019 packet timeout separate from prose | covered 04 timeout-mode criterion + 06 timeout smoke; fails if either valid/fallback/ordinary branch uses wrong normalization |
| DEC-020 reserved report-only finish | covered 04 exact transition + 06 lowered-limit smoke; fails if source remains active or totals exceed 16/30 |
| DEC-021 SDK custom tool and active-tool switch | covered 01 custom-tool gating + 04 transition + 06 runtime; fails if extension loading/prose parsing replaces SDK seam |
| DEC-022 prototype removed | covered 05 absence criterion; fails if files/script/imports return |

## Required-behavior coverage and falsifying criteria

| Behavior | State / issue criterion that fails on violation |
|---|---|
| RB-001 optional/legacy unchanged | covered 01/04/06 no-packet criteria |
| RB-002 generic consumer/no aiKnow | covered 01 tool gating + 05 fixture independence |
| RB-003 automatic broad/hybrid and narrow override | covered 02 inclusion matrix |
| RB-004 routing trust vs behavioral proof | covered 01 evidence validation |
| RB-005 exactly one owner | covered 02 grouping + 03 reconciliation |
| RB-006 soft references/new leads | covered 01 report schema and 06 real child reference-following observation |
| RB-007 direct/single/parallel thresholds | covered 03 route matrix, one criterion per strategy branch |
| RB-008 no quotas | covered 03 route matrix + 05 prohibited fixed-count guidance absence |
| RB-009 16/30/300 with reserved capacity | covered 04 transition/timeout criteria |
| RB-010 report-only ceiling; immediate timeout | covered 04 two pure criteria + 06 two runtime criteria |
| RB-011 every claim status/evidence | covered 01 report completeness |
| RB-012 missing completion unresolved/incomplete | covered 04 synthesis criterion |
| RB-013 one targeted material follow-up | covered 03 follow-up criterion |
| RB-014 visible whole-packet fallback | covered 04 fallback + 06 malformed/unsupported smoke |
| RB-015 packet lowers caps/config can change caps | covered 03 config/clamping + 04 timeout branches |
| RB-016 full details/compact content | covered 01 broad packet + 05 details projection |
| RB-017 internal detail hydration/graph fallback | covered 02 hydration + incomplete-edge criteria |
| RB-018 post-adaptation attachment | covered 01 `aiknow_read`-shaped integrity criterion |
| RB-019 pure deterministic tests only | covered issue commands + 05 prohibited automation absence |
| RB-020 identifiers/shape/limits/outcomes/usage/diagnostics | covered 05 projections + 06 JSONL inspection |

## Area edits, test seams, wiring, and choices

- Canonical schema/validator/fixture: single owner 01. Consumer location is `extensions/lib/evidence-packet.ts`; producer copy is test-only.
- aiKnow producer base: owner 01; graph/enriched HTTP/inclusion behavior: owner 02. No overlapping redefinition.
- Routing/reconciliation/config policy: owner 03. Materiality is deterministic and tested there.
- Runtime counters/timeout/fallback/result synthesis: owner 04. Warning codes/wording may vary only while actionable fields remain.
- Guidance/detail telemetry/final fixture audit: owner 05. Session JSONL is retained; no new storage.
- SDK/runtime human proof: owner 06. It implements no code.
- Compact field formatting and stable tie-breaking are locally reversible; owners 01/02 must make them deterministic.
- Tool closure/disposal and internal counter organization are locally reversible; owner 04 must preserve the specified state transitions.
- Every planned file has one creation owner; later issues consume or extend named seams rather than redefine contracts.

## Blocking-edge closure

- 01 → 02: canonical fixture and `buildEvidencePacket` consumed by enriched HTTP grouping; 02 registered-adapter AC fails if disconnected.
- 01 → 03: real `EvidencePacketV1` shape/outcomes imported by policy tests; route/reconciliation ACs fail if duplicated/stubbed.
- 01 → 04: validator/report tool/session seam consumed by runtime events; fallback and transition ACs fail if disconnected.
- 02 → 05: full grouped producer shape consumed by guidance/details tests.
- 03 → 05: strategy/materiality vocabulary consumed by guidance; adaptive-guidance AC fails on drift.
- 04 → 05: runtime detail projections consumed by telemetry tests.
- 02/03/04/05 → 06: real registered tools/runtime/details are exercised in human steps; no stub satisfies smoke expectations.

## Command feasibility validation (pre-publication)

| cwd | Command | Result |
|---|---|---|
| `C:/my-pi` | `npx tsx extensions/__tests__/subagents-defaults.test.ts` | PASS, existing runner works |
| `C:/Hackathon/aiKnow/aiKnow` | `npm run build && npm run check:pi` | PASS after building required `dist` dependency |
| `C:/Hackathon/aiKnow/aiKnow` | `npx vitest run src/test/pi-aiknow-hybrid-guidelines.test.ts` | PASS, 3 tests |
| `C:/my-pi` | `npm run check` | BASELINE FAIL: `extensions/subagents.ts:1193` passes `modelRegistry` not accepted by installed `CreateAgentSessionServicesOptions`; implementation must leave the tree with this required check passing, but the failure predates these issue files |
| both repos | planned new focused test commands | Runner/seams validated above; files are owned by explicit issues and do not exist yet |

The initial aiKnow focused test failed before `npm run build` because `dist/interfaces/http/search-budget.js` was absent; the documented prerequisite is therefore build before focused adapter tests/checks in a clean checkout.

## Deferred / HITL / out of scope

- HITL: issue 06 owns real AgentSession/model lifecycle smoke because DEC-018 prohibits automated lifecycle tests.
- HITL/user-owned: comparative benchmark execution/scoring; telemetry only is delivered.
- Deferred/out of scope: automatic orchestration, child-loaded extensions, hard path allowlists, fixed quotas, index freshness, shared package, model-backed automation, dashboard/database, mode-off/capability changes, and prototype restoration.
- Blocked obligations: none beyond the explicit issue DAG.

## Audit findings

1. **Baseline aiKnow test prerequisite** — incorporated: ledger records `npm run build` prerequisite.
2. **Baseline my-pi type-check failure** — incorporated: final integration criterion still requires a clean check and records the exact pre-existing error for implementer awareness.
3. **Walking-skeleton runtime cannot be proven headlessly under accepted DEC-018** — incorporated: 01 owns AFK implementation with strongest pure/registered adapter proof; 06 owns human runtime proof.
4. **Cross-repository shared contract risk** — incorporated: 01 owns canonical consumer contract; 05 proves duplicate fixture conformance and absence of runtime coupling.

Coverage gaps: None.
