Status: ready-for-agent

# Wire adaptive guidance, telemetry, and cross-repository contract audit

## What to build

Complete the cooperation surface by teaching model-visible aiKnow guidance how to apply generic shape, exposing benchmark-readable telemetry across producer/consumer details, and proving both repositories conform to the same canonical fixture without runtime coupling.

Covers US-005; DEC-008, DEC-011, DEC-015, DEC-017, DEC-018, DEC-022; RB-002, RB-008, RB-016, RB-019, RB-020.

## Implementation map

- In aiKnow `HYBRID_GUIDELINES`/search description, state: direct native verification for small exact groups; one child for cohesive flows; parallel only for independent groups; skip confirmed evidence; no parent re-read absent contradiction; at most one material follow-up. Keep wording delegation-provider-generic.
- aiKnow details retain packet/group IDs, file/anchor counts, subsystem, crossFileFlow, and full packet. Compact content remains routing-only.
- `SubagentDetails`/rendering retain mode, packet acceptance/error, packet/group IDs, effective limits, termination, complete/incomplete outcomes, leads, turns/tools/tokens/cost. Session JSONL remains the durable source; no dashboard/database.
- Compare fixture copies byte-for-byte within test fixtures or assert deep equality to each repository-local canonical object; do not read the other repository at runtime or add a shared package.
- Confirm removed `extensions/prototypes/aiknow-subagent-routing` and its package script are not restored.
- Consumes grouped producer output from issue 02, policy terminology from issue 03, and runtime details from issue 04. This issue owns final wiring and contract audit, not those contracts.

## Acceptance criteria

- [ ] Guidance expresses all adaptive branches without naming Subagents or prescribing quotas.
  - Run: `npx vitest run src/test/pi-aiknow-hybrid-guidelines.test.ts` (cwd `C:/Hackathon/aiKnow/aiKnow`)
  - Test: planned/updated `adaptive generic verification guidance`
  - Expected: direct/cohesive/independent/skip/single-follow-up and duplicate-suppression statements are present; producer-specific child/tool names and fixed counts are absent.
  - Fails when: guidance encourages broad rediscovery, fan-out filling, or parent re-reading.
- [ ] Both local fixture suites conform to canonical v1 while remaining runtime-independent.
  - Run: `npx tsx extensions/__tests__/evidence-packet.test.ts` (cwd `C:/my-pi`), then `npx vitest run src/test/pi-evidence-packet.test.ts` (cwd `C:/Hackathon/aiKnow/aiKnow`)
  - Test: planned `canonical EvidencePacketV1 fixture`
  - Expected: both pass the same field/value contract; production imports/package manifests contain no cross-repository/shared-contract dependency.
  - Fails when: producer drifts or runtime filesystem/package coupling is introduced.
- [ ] Tool details expose the accepted telemetry fields for packet, fallback, and ordinary modes.
  - Run: `npx tsx extensions/__tests__/subagents-compat.test.ts` (cwd `C:/my-pi`)
  - Test: planned `telemetry detail projections by mode`
  - Expected: packet details include IDs/limits/termination/outcomes/usage; fallback includes rejection/error/usage; ordinary retains existing usage shape without packet claims.
  - Fails when: manual benchmark inputs are missing or prose fallback masquerades as structured verification.
- [ ] Prototype and automated benchmark infrastructure remain absent.
  - Run: `npm run check` (cwd `C:/my-pi`)
  - Test: production type-check plus planned compatibility assertion
  - Expected: check exits 0; no prototype import/script, mocked AgentSession suite, live-model test, or benchmark gate is introduced.
  - Fails when: the removed simulator becomes a production dependency or model-backed automation is added.

## Blocked by

- Local: `02-graph-grouped-aiknow-packets.md` — provides full producer shape/details consumed by guidance and telemetry tests.
- Local: `03-adaptive-routing-and-reconciliation.md` — provides canonical strategy/materiality terms consumed by guidance.
- Local: `04-packet-runtime-safety-and-fallback.md` — provides runtime detail projection and termination modes consumed by telemetry audit.
