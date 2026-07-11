Status: ready-for-agent

## Parent

`.scratch/accordion-authoritative-runtime/PRD.md`

## What to build

Create the runes-free authoritative folding engine and execute bundled conductors in one lazy per-session worker. Cover `DEC-010` and `RB-006`.

The browser `AccordionStore` remains a presentation/read-replica wrapper; it must not become a second authoritative engine. Provider-safe shared types and pure helpers may be reused, but worker code must not import Svelte runes or browser APIs.

## Implementation map

- Consume `EffectiveFoldingSettings`, runtime revisions, and lifecycle activation from `01-file-backed-runtime-contracts.md`.
- Extract a dependency-free runtime core under `vendor/accordion/extension/runtime/` that owns authoritative blocks, boundaries, manual overrides, conductor instance state, complete desired commands, and plan materialization.
- Preserve the existing `ConductorView`, `Command`, clamp, protected-tail, frozen-prefix, tool-pair, durable-ID, recall, and unfold semantics. Reuse `mapping.ts` application rather than inventing a second provider representation.
- Add a worker entry and adapter with serializable `WorkerRequest`/`WorkerResult` messages. Cold initialize carries an immutable full snapshot; results carry revision, commands/plan, calculation kind, duration, and errors.
- Start one worker lazily on activation. Queue at most one active calculation and one newest pending revision. Discard stale results. `/accordion off` and session shutdown terminate the worker and reject/drain waiters.
- Host capabilities (`complete`, token count, digest, status, rerun) cross explicit worker messages; no closure or Svelte object crosses the boundary.
- Dependency connection: activation from issue 01 starts the worker with the exact effective conductor/settings; the returned revision updates issue 01's runtime snapshot. The integration test must fail if either edge is disconnected.
- Grounding: `GROUND-003`–`GROUND-007`.

## Acceptance criteria

- [ ] Activating a session starts at most one worker lazily and initializes `my-customize` with the effective settings from the session snapshot.
  - Run: `npx vitest run vendor/accordion/extension/runtime/worker-host.test.ts`
  - Expected: lazy-start, single-worker, and settings-consumption tests pass.
- [ ] Three rapidly queued revisions apply only the newest result and never regress `readyRevision`.
  - Run: `npx vitest run vendor/accordion/extension/runtime/worker-host.test.ts`
  - Expected: controllable-worker test records stale discards and commits only revision 3.
- [ ] Off/shutdown terminate the worker and settle every pending calculation without hanging.
  - Run: `npx vitest run vendor/accordion/extension/runtime/worker-host.test.ts`
  - Expected: lifecycle cleanup tests pass with zero live workers/waiters.
- [ ] Worker and runtime-core modules are runes-free and produce provider-safe plans equivalent to current store/mapping behavior for the same fixture.
  - Run: `npx vitest run vendor/accordion/extension/runtime/engine-equivalence.test.ts vendor/accordion/app/src/lib/live/mapping.test.ts vendor/accordion/app/src/lib/live/mapping.groups.test.ts`
  - Expected: equivalence, durable-ID, tool-pair, user/tool-call, fold/group, recall, and unfold assertions pass.
- [ ] Worker completion updates the persisted/shared runtime snapshot through the real host wiring.
  - Run: `npx vitest run vendor/accordion/extension/runtime/worker-host.test.ts`
  - Expected: integration test observes `readyRevision` and plan metadata in the session snapshot after a real worker message.

## Blocked by

- `01-file-backed-runtime-contracts.md`
