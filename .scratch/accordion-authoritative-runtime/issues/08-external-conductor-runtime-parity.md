Status: ready-for-agent

## Parent

`.scratch/accordion-authoritative-runtime/PRD.md`

## What to build

Move external WebSocket conductor ownership from the browser into the authoritative session runtime and provide full contract parity with bundled conductors. Cover `DEC-006`, `US-006`, and `RB-010`.

## Implementation map

- Consume authoritative engine/host capabilities from `03-worker-isolated-folding-engine.md` and revision/deadline gate from `04-provider-revision-gate.md`.
- Adapt `vendor/accordion/app/src/lib/live/conductorClient.svelte.ts` → `RemoteRunner` into a runes-free session-runtime client. The runtime owns discovery/selection, handshake, revisions, status, retry/error, consent, locks, capabilities, and advertised deadline.
- Extend `vendor/accordion/conductors/contract/protocol.ts`:
  - `ContextUpdateMessage` carries `harnessOverhead?`, `outputReserve?`, and `calibration?`.
  - `ConductorHelloMessage` carries validated `tailTokens?` and optional deadline metadata capped by the host.
  - Replies echo the authoritative revision; stale replies never release the provider gate.
- Preserve ADR 0011: budget, observation, recall, and detach remain sacred; unknown locks are filtered; exclusive conductors require consent; `agent-unfold` may block unfold but never recall.
- Bump `CONDUCTOR_PROTOCOL_VERSION` and update every bundled external conductor/smoke fixture in the same issue. Create/update `vendor/accordion/docs/conductor-protocol.md` with actual capabilities (`getDigest`, not nonexistent `summarize`), `recoverable`, calibration fields, tailTokens, revisions, and deadlines.
- Dependency proof: a FakeWebSocket external plan must pass through the runtime's exact revision gate and provider-safe application; no browser store may own the connection.
- Grounding: `GROUND-005`, `GROUND-007`, `GROUND-008`, `GROUND-015`.

## Acceptance criteria

- [ ] External hello/update carries all in-process budgeting, tail, revision, lock, and deadline fields and rejects incompatible protocol versions clearly.
  - Run: `npx vitest run vendor/accordion/app/src/lib/live/conductorClient.test.ts vendor/accordion/extension/runtime/external-conductor.test.ts`
  - Expected: parity-field, version-mismatch, validation, and deadline-cap tests pass.
- [ ] A stale external reply is discarded and cannot release or alter the provider request for a newer revision.
  - Run: `npx vitest run vendor/accordion/extension/runtime/external-conductor.test.ts`
  - Expected: provider spy stays at zero until the matching external revision arrives.
- [ ] Disconnect/error/timeout enter actionable runtime error state, never send raw/stale context, and support retry or `/accordion off` cancellation.
  - Run: `npx vitest run vendor/accordion/extension/runtime/external-conductor.test.ts`
  - Expected: lifecycle matrix passes with zero provider contacts on failure.
- [ ] Consent, lock filtering, tail-size, human steering, agent-unfold, and unblockable recall remain enforced by the session runtime.
  - Run: `npx vitest run vendor/accordion/app/src/lib/engine/store.locks.test.ts vendor/accordion/extension/runtime/external-conductor.test.ts`
  - Expected: ADR 0011 regression suite passes.
- [ ] Reference external conductors complete the bumped handshake and command round trip.
  - Run: `npx vitest run vendor/accordion/conductors/the-conductor/smoke.test.ts vendor/accordion/conductors/the-conductor-v2/smoke.test.ts`
  - Expected: both smoke suites receive hello, context revision, and valid commands.

## Blocked by

- `03-worker-isolated-folding-engine.md`
- `04-provider-revision-gate.md`
