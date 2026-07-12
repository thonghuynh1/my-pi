Status: ready-for-agent

## Parent

`.scratch/accordion-authoritative-runtime/PRD.md`

## What to build

Gate every active Accordion provider call on a plan for the exact newest context revision, with phase-specific deadlines and fail-closed behavior. Cover `DEC-004`, `DEC-013`, `US-002`, `RB-004`, and `RB-005`.

## Implementation map

- Consume lifecycle/context revision state from `02-headless-activation-and-footer.md` and `WorkerResult.readyRevision` from `03-worker-isolated-folding-engine.md`.
- Replace `accordion.ts` → `requestPlan()`/GUI-attachment gating in `pi.on("context")` with `waitForRevision(contextRevision, deadline)` against the authoritative runtime.
- Context changes create an immutable revision and submit it to the runtime. Provider-safe `applyPlan()` runs only after `readyRevision === contextRevision`.
- Deadlines: bundled warm 1,000 ms; bundled cold/structural 5,000 ms; external 10,000 ms by default with a validated advertised value capped at 120,000 ms.
- On calculation error or deadline: notify with conductor, revision, elapsed/deadline, and retry/cancel guidance; throw a typed Accordion gate error from the context hook so Pi never contacts the provider. Resubmitting retries; `/accordion off` cancels/disables the gate and returns future requests to raw pass-through.
- Respect turn abort signals where available and drain waits on off/shutdown.
- Record provider wait/deadline outcome in the in-memory diagnostic queue; issue 07 owns asynchronous persistence.
- Dependency proof: the context hook must consume the worker's actual revisioned plan, not a stub or last-ready plan. Use a provider transport spy that fails if contacted early.
- Grounding: `GROUND-001`, `GROUND-003`, `GROUND-015`; Pi extension `context` events may await and modify messages, and throwing before completion aborts request construction.

## Acceptance criteria

- [ ] While revision 3 calculates, the provider spy remains at zero; after worker revision 3 becomes ready, exactly one provider call receives plan 3.
  - Run: `npx vitest run vendor/accordion/extension/runtime/provider-gate.test.ts`
  - Expected: exact-revision integration test passes and fails if last-ready/stub data is wired.
- [ ] Warm, cold/structural, and external deadlines select 1s, 5s, and 10s defaults, while advertised external deadlines clamp at 120s.
  - Run: `npx vitest run vendor/accordion/extension/runtime/provider-gate.test.ts`
  - Expected: fake-timer deadline table passes.
- [ ] Timeout, worker error, and turn abort produce zero provider contacts and settle the wait with actionable status/notification data.
  - Run: `npx vitest run vendor/accordion/extension/runtime/provider-gate.test.ts`
  - Expected: all fail-closed provider-spy tests pass.
- [ ] Inactive `/accordion off` mode bypasses the gate and preserves raw pass-through.
  - Run: `npx vitest run vendor/accordion/extension/runtime/provider-gate.test.ts`
  - Expected: inactive-path test contacts the provider once with unchanged messages.
- [ ] Existing provider-validity mapping regressions remain green after replacing GUI plan requests.
  - Run: `npx vitest run vendor/accordion/app/src/lib/live/mapping.test.ts vendor/accordion/app/src/lib/live/mapping.groups.test.ts vendor/accordion/app/src/lib/engine/foldconsistency.property.test.ts`
  - Expected: all mapping and fold-consistency tests pass.

## Blocked by

- `02-headless-activation-and-footer.md`
- `03-worker-isolated-folding-engine.md`
