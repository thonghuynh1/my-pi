Status: ready-for-human

# Verify packet runtime in Pi and hand off manual benchmarking

## What to verify

Perform the accepted human-only runtime smoke after all implementation slices land. Confirm SDK custom-tool injection, report-only ceiling behavior, timeout, visible fallback, legacy prose behavior, and benchmark-readable details in a real Pi session. Comparative benchmark execution/scoring remains the user's separate responsibility.

Covers US-004, US-005 runtime proof; DEC-017, DEC-018, DEC-019, DEC-020, DEC-021; RB-001, RB-009, RB-010, RB-014, RB-020.

## Implementation map

- Reload/restart Pi after schema/prompt changes.
- Use `C:/my-pi` extension and configured external aiKnow adapter at `C:/Hackathon/aiKnow/aiKnow`.
- Do not modify code in this issue. Record observed session/tool details under `## Comments`.
- Producer outputs from issue 02 and policy/runtime outputs from issues 03–05 must be present through real registration; this smoke is the accepted lifecycle proof excluded from automation by DEC-018.

## Acceptance criteria

- [ ] Ordinary prose-only Subagent behavior is unchanged.
  - Steps: call `subagent` without `evidencePacket` using an explore task; inspect child tool list, timeout behavior, prose result, and usage details.
  - Expected: native read-only tools only, no `report_verification`, ordinary timeout normalization, and existing prose/usage presentation.
- [ ] A valid broad aiKnow packet reaches an isolated packet child through real tool wiring.
  - Steps: run a broad/hybrid `aiknow_search`; select one cohesive group; call `subagent` with its self-contained slice; inspect child tools and final details.
  - Expected: child starts from supplied anchors, cannot access aiKnow/extensions, has `report_verification`, and every claim has one structured status with native evidence for resolved claims.
- [ ] Lowered ceilings transition to report-only and remain within totals.
  - Steps: submit a valid packet with deliberately low turn/tool limits sufficient for one investigation action and one report; inspect event/detail counts.
  - Expected: source tools disappear at the investigation threshold, only report remains, and totals do not exceed effective limits.
- [ ] Packet wall-clock timeout has no grace turn.
  - Steps: run a valid packet with a deliberately low allowed timeout against a slow task.
  - Expected: immediate timeout termination, no post-timeout report turn, omitted claims synthesized unresolved, and `incomplete: true`.
- [ ] Invalid packet visibly falls back without packet leakage.
  - Steps: call `subagent` once with malformed v1 and once with unsupported version.
  - Expected: both execute ordinary prose mode; parent output/details show `mode: prose-fallback`, `packetAccepted: false`, actionable errors; no packet tool/limits/anchors are active.
- [ ] Telemetry is sufficient for the user's later A/B benchmark.
  - Steps: inspect tool details/session JSONL from packet and fallback runs.
  - Expected: packet/group IDs, shape, strategy context, effective limits, turns, calls, tokens/cost, termination, outcomes, and downgrade diagnostics are readable. Record location and sample IDs in Comments; do not enforce performance thresholds.

## Blocked by

- Local: `02-graph-grouped-aiknow-packets.md` — broad/hybrid packet through registered aiKnow tool.
- Local: `03-adaptive-routing-and-reconciliation.md` — accepted route/limit/follow-up policy.
- Local: `04-packet-runtime-safety-and-fallback.md` — runtime ceilings, timeout, fallback, and incomplete outcomes.
- Local: `05-integration-guidance-telemetry-and-contract-audit.md` — final details/guidance/fixture wiring.
