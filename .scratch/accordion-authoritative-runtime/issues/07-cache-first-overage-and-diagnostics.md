Status: ready-for-agent

## Parent

`.scratch/accordion-authoritative-runtime/PRD.md`

## What to build

Distinguish completed cache-first calculations from attainable budget satisfaction, and persist rich diagnostics asynchronously. Cover `DEC-012`, `RB-014`, and `RB-019`.

## Implementation map

- Consume revision/readiness state from `04-provider-revision-gate.md` and warm/cold metrics from `05-incremental-warm-calculation.md`.
- Compute frozen-prefix tokens and irreducible selected-budget overage in the authoritative runtime. If the frozen prefix prevents the chosen budget, commit the valid plan as `ready-frozen-over-budget`; do not remain `calculating` and do not emit `breakFrozen` for selected-budget pressure.
- Preserve existing hard provider-window behavior: only real context-window pressure may authorize the already-clamped `breakFrozen` path.
- Broadcast/persist frozen tokens and overage in runtime snapshots; Usage Footer and dashboard display the state without changing authority.
- Replace synchronous diagnostic writes on the context/provider critical path with an in-memory queue and asynchronous/batched flush. Record revision, calculation kind, queue/coalescing outcome, duration, deadline, stale discard, provider wait, plan sizes, frozen overage, and errors.
- Reconstruct a deterministic 70k-budget scenario in the repo tests; do not depend on the temporary handoff file at runtime.
- Dependency proof: the overage state must flow from engine result through the runtime snapshot into session registry and footer; a test must fail if any edge is stubbed.
- Grounding: `GROUND-006`, `GROUND-014`, `GROUND-015` and the accepted cache-first handoff summarized in the PRD.

## Acceptance criteria

- [ ] A frozen prefix exceeding a 70k selected budget reaches `ready-frozen-over-budget`, reports frozen tokens/overage, and emits no cache-breaking command.
  - Run: `npx vitest run vendor/accordion/extension/runtime/cache-first-overage.test.ts`
  - Expected: deterministic 70k scenario passes and provider plan preserves every frozen block.
- [ ] Real context-window pressure still permits only the existing host-clamped breakFrozen path.
  - Run: `npx vitest run vendor/accordion/app/src/lib/engine/store.foldgate.test.ts vendor/accordion/extension/runtime/cache-first-overage.test.ts`
  - Expected: selected-budget and hard-window cases are discriminated correctly.
- [ ] Frozen-overage fields reach the session registry and `globalThis.__accordion`/Usage Footer through real wiring.
  - Run: `npx vitest run vendor/accordion/extension/runtime/cache-first-overage.test.ts && node --experimental-strip-types --test extensions/__tests__/usage-footer-accordion.test.ts`
  - Expected: integration snapshot and footer overage assertions pass.
- [ ] Invoking the context hook performs zero synchronous diagnostic filesystem writes.
  - Run: `npx vitest run vendor/accordion/extension/runtime/diagnostics.test.ts`
  - Expected: `appendFileSync`/`writeFileSync` spies remain at zero during the hook; queued records flush afterward.
- [ ] Timeout, stale discard, coalescing, provider wait, applied plan, and frozen overage records contain their required revision and timing fields.
  - Run: `npx vitest run vendor/accordion/extension/runtime/diagnostics.test.ts`
  - Expected: schema/event matrix passes using isolated `ACCORDION_HOME`.

## Blocked by

- `04-provider-revision-gate.md`
- `05-incremental-warm-calculation.md`
