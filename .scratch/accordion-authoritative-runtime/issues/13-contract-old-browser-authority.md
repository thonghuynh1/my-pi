Status: ready-for-agent

## Parent

`.scratch/accordion-authoritative-runtime/PRD.md`

## What to build

Complete the expand-migrate-contract sequence: delete old browser/GUI folding authority after every runtime, conductor, dashboard, and broker consumer has migrated; preserve provider-validity invariants; finalize protocol/docs/build wiring. Cover `RB-016` and `RB-020`.

## Implementation map

- Consume the completed outputs of issues 06–12: proven worker/delta engine, cache diagnostics, external runtime, observer protocol, dashboard controls/conflicts, and broker scale.
- Remove extension GUI-plan critical-path machinery that is no longer consumed: `requestPlan()`, plan pending/late reply handling, attachment grace as a provider prerequisite, single-client/epoch authority, and hold-last-GUI-plan fallback. Retain observer, unfold/recall, completion capability, static serving, and broker focus/watch paths.
- Remove protocol-v6 browser authority paths: `liveClient.computePlan()`, broker-slot `computeFoldOps`/`computeGroupOps`, browser conductor ownership for live sessions, and runtime conductor/external-URL `localStorage` reads. Preserve read-replica rendering and display-only settings.
- Verify final browser/session and conductor protocol versions across extension, app, broker mirrors, reference conductors, and docs. Ensure mismatch errors instruct users to update/reload/restart.
- Finalize `vendor/accordion/docs/conductor-protocol.md`, registry comments, skills, and architectural comments so none claim “GUI drives, thin extension.” Reference `docs/adr/0002-authoritative-accordion-folding-runtime.md` and preserve ADR 0011 sacred/lock rules.
- Preserve provider-validity: durable IDs only; user/tool-call never folded; tool pairs valid; FoldOp substitution versus GroupOp structural behavior; recall read-only/unblockable; unfold lock-aware.
- Ensure all diagnostics are off the provider critical path and static app builds resolve in published/development layouts.
- Dependency proof: final tests must instantiate the actual session runtime and dashboard; deleting/stubbing any producer output must fail protocol, provider, or UI integration tests.
- Grounding: `GROUND-001`–`GROUND-016`.

## Acceptance criteria

- [ ] No active provider path references GUI attachment, `requestPlan()`, late GUI plans, or hold-last-GUI-plan behavior.
  - Run: `npx vitest run vendor/accordion/extension/runtime/provider-gate.test.ts && npm run check`
  - Expected: exact-revision runtime gate passes and deleted legacy symbols have no references.
- [ ] Direct and broker dashboards contain no live-session conductor/plan calculation authority.
  - Run: `npx vitest run vendor/accordion/app/src/lib/live/liveClient.protocol.test.ts vendor/accordion/app/src/lib/live/sessionSlots.test.ts vendor/accordion/app/src/lib/live/dashboard-controls.test.ts`
  - Expected: observer/control suites pass with conductor/compute spies at zero.
- [ ] Provider-validity, groups, recall, unfold, frozen clamp, and lock regressions all remain green.
  - Run: `npx vitest run vendor/accordion/app/src/lib/live/mapping.test.ts vendor/accordion/app/src/lib/live/mapping.groups.test.ts vendor/accordion/app/src/lib/live/plan.test.ts vendor/accordion/app/src/lib/engine/foldconsistency.property.test.ts vendor/accordion/app/src/lib/engine/store.foldgate.test.ts vendor/accordion/app/src/lib/engine/store.locks.test.ts`
  - Expected: all provider-safety and ADR 0011 suites pass.
- [ ] Browser/session and conductor versions, broker mirrors, reference conductors, and protocol documentation agree and incompatible peers fail clearly.
  - Run: `npx vitest run vendor/accordion/app/src/lib/live/liveClient.protocol.test.ts vendor/accordion/app/src/lib/live/conductorClient.test.ts && npm test --prefix packages/accordion-broker`
  - Expected: version agreement/mismatch and broker suites pass.
- [ ] Full type, Svelte, test, and static-build verification succeeds.
  - Run: `npm run check && npx vitest run && npm test --prefix packages/accordion-broker && npm run check --prefix vendor/accordion/app && npm run accordion:build`
  - Expected: every command exits 0 and the Accordion static build is produced.

## Blocked by

- `06-cold-and-warm-performance-proof.md`
- `07-cache-first-overage-and-diagnostics.md`
- `08-external-conductor-runtime-parity.md`
- `09-dashboard-observer-protocol.md`
- `10-optimistic-dashboard-controls.md`
- `11-dashboard-conflict-rebase.md`
- `12-multi-session-dashboard-scale.md`
