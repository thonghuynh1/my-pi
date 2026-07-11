Status: ready-for-agent

## Parent

`.scratch/accordion-authoritative-runtime/PRD.md`

## What to build

Deliver the first visible headless tracer bullet: `/accordion` activates a per-session runtime lifecycle without a dashboard, `/accordion off` disables it, and Usage Footer displays the session state. Cover `DEC-001`, `DEC-002`, `DEC-003`, `DEC-007`, `DEC-008`, `DEC-015`, `US-001`, `US-003`, `RB-001`, `RB-002`, `RB-003`, `RB-015`, and `RB-018`.

This issue establishes lifecycle/status only; real conductor work and provider gating are produced by later issues.

## Implementation map

- Consume `FoldingRuntimeSnapshot`, `EffectiveFoldingSettings`, and the session-entry fields from `01-file-backed-runtime-contracts.md`.
- In `vendor/accordion/extension/accordion.ts`, implement idempotent `/accordion`, `/accordion on`, and `/accordion off`. Activation snapshots defaults and enters `starting`; deactivation enters `inactive` and restores raw pass-through. Dashboard disconnect must not deactivate the runtime.
- Change `session_before_compact` to suppress native compaction when authoritative folding is active, not only when `attached()` is true.
- Publish a typed, null-safe `globalThis.__accordion` snapshot on every transition. Clear it at shutdown. Accordion must not import Usage Footer.
- In `extensions/usage-footer.ts`, add an Accordion segment following the existing `__frontendCoach`/`__subagent` pattern. Render conductor, status, and revision compactly. Absence of the snapshot renders no segment.
- Normal transitions do not notify. Notify only when a submitted request waits, fails, or times out; later issues enrich those paths.
- Update `/accordion` output to describe runtime activation/status separately from optional dashboard/broker connectivity.
- Dependency connection: this issue owns reading issue 01's effective settings in the `/accordion` handler and writing issue 01's runtime snapshot into `SessionEntry`. A focused activation test must fail if that wiring is stubbed.
- Grounding: `GROUND-002`, `GROUND-012`, `GROUND-014`.

## Acceptance criteria

- [ ] `/accordion on` is idempotent, defaults to `my-customize-conductor`, and remains active after all dashboards disconnect.
  - Run: `npx vitest run vendor/accordion/extension/runtime/activation.test.ts`
  - Expected: activation-count and dashboard-disconnect tests pass with one runtime lifecycle.
- [ ] `/accordion off` sets `inactive`, leaves subsequent contexts as raw pass-through, and shutdown clears shared/footer state.
  - Run: `npx vitest run vendor/accordion/extension/runtime/activation.test.ts`
  - Expected: off/pass-through/shutdown tests pass.
- [ ] Headless active folding suppresses native compaction while inactive folding does not.
  - Run: `npx vitest run vendor/accordion/extension/runtime/activation.test.ts`
  - Expected: `active=true, attached=false` returns `{ cancel: true }`; inactive returns no cancellation.
- [ ] Usage Footer renders calculating/ready/frozen-over-budget/error snapshots and tolerates absent state without affecting Accordion.
  - Run: `node --experimental-strip-types --test extensions/__tests__/usage-footer-accordion.test.ts`
  - Expected: all status-format and optional-dependency tests pass.
- [ ] The activation path consumes file-backed defaults and persists the same effective settings in the current session entry.
  - Run: `npx vitest run vendor/accordion/extension/runtime/activation.test.ts`
  - Expected: integration test reads a non-default test file, activates, and observes matching conductor/budget in the session JSON.

## Blocked by

- `01-file-backed-runtime-contracts.md`
