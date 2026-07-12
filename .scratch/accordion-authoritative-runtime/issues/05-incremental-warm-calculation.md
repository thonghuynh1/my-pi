Status: ready-for-agent

## Parent

`.scratch/accordion-authoritative-runtime/PRD.md`

## What to build

Implement revisioned, coalesced Warm Folding Calculation so ordinary tool-loop continuations update only changed state rather than serializing and recomputing the full history. Cover `DEC-011`.

## Implementation map

- Consume the persistent worker engine/instance from `03-worker-isolated-folding-engine.md` and exact revision gate from `04-provider-revision-gate.md`.
- Extend the worker protocol with append-only `delta { revision, baseRevision, blocks, boundaries/settings deltas }`, structural `initialize`, and `reconfigure` requests.
- Ignore streaming/ghost token deltas. Coalesce committed plan-relevant changes and retain only the newest pending revision.
- Keep indexes, conductor state, prior plan, token totals, protected boundary, and frozen boundary resident in the worker.
- Protected-tail fast path: append new protected blocks, update totals/boundary, validate prior folds, and reuse the plan when legal. If pressure grows, consider newly eligible blocks before broadening work.
- Replace `MyCustomizeConductor.conduct()`'s full `JSON.stringify([...view.blocks.map(...)])` warm key and other avoidable all-block warm scans with incremental epochs/indexes. Full work remains allowed for cold start, conductor/model/window change, base mismatch, or structural reset.
- Dependency proof: `WorkerRequest.delta` must advance the same `readyRevision` awaited by the provider gate; a test must fail if the host silently sends full initialize instead.
- Grounding: `GROUND-004`–`GROUND-007`.

## Acceptance criteria

- [ ] Appending up to 20 committed blocks/20k tokens to a ready 5,000-block session sends a delta, not a full snapshot, and advances the matching ready revision.
  - Run: `npx vitest run vendor/accordion/extension/runtime/warm-calculation.test.ts`
  - Expected: protocol-spy test records `delta`, correct `baseRevision`, and provider-gate release for the same revision.
- [ ] Rapid revisions skip obsolete intermediate work and apply only the newest delta result.
  - Run: `npx vitest run vendor/accordion/extension/runtime/warm-calculation.test.ts`
  - Expected: controllable-worker test records coalescing/stale discard without parallel conductor passes.
- [ ] Protected-tail-only appends reuse the prior legal plan without full block-array serialization or graph rebuild.
  - Run: `npx vitest run vendor/accordion/extension/runtime/warm-calculation.test.ts`
  - Expected: operation counters report no full serialize/buildGraph path and unchanged existing fold decisions.
- [ ] Frozen/protected boundary changes, budget/conductor/model changes, base mismatch, and structural resets choose the documented full/reconfigure path.
  - Run: `npx vitest run vendor/accordion/extension/runtime/warm-calculation.test.ts`
  - Expected: trigger matrix passes with no delta accepted against an invalid base.
- [ ] Streaming ghost updates create no runtime revisions or worker messages.
  - Run: `npx vitest run vendor/accordion/extension/runtime/warm-calculation.test.ts`
  - Expected: ghost-only test records zero revision and zero worker traffic.

## Blocked by

- `03-worker-isolated-folding-engine.md`
- `04-provider-revision-gate.md`
