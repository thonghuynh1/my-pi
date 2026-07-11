Status: ready-for-agent

## Parent

`.scratch/accordion-authoritative-runtime/PRD.md`

## What to build

Prove that the transparent Accordion Browser Broker and observer-only dashboard remain responsive and isolated with 20 registered sessions. Cover `DEC-009`, `RB-017`, and the multi-session part of `US-004`.

## Implementation map

- Consume complete per-session registry snapshots from `01-file-backed-runtime-contracts.md`, observer protocol from `09-dashboard-observer-protocol.md`, and arbitration from `11-dashboard-conflict-rebase.md`.
- Keep `packages/accordion-broker/src/server.ts` → `proxySession()` frame-transparent and stateless with respect to folding plans/commands. Semantic handling remains in each session extension.
- Add a deterministic 20-session fixture under isolated `ACCORDION_HOME`, with distinct settings/status/revisions and watched entries. Dashboard polling/rendering must not create conductor workers or recalculate plans for background sessions.
- Prove a calculation/command in session A does not mutate, gate, reconnect, or delay session B. Prove two dashboard clients can traverse the broker to one session and receive extension-owned conflict outcomes.
- Preserve watch-request consumption, stale pruning, heartbeat, focus, and shutdown deletion behavior.
- Define responsiveness with bounded local test metrics and structural work counters: one session update must not trigger O(total-history) calculation in any other slot.
- Dependency proof: fixtures must use the real registry schema and broker/direct observer protocol; tests fail if session fields are mocked away or broker interprets commands.
- Grounding: `GROUND-009`–`GROUND-012`, `GROUND-016`.

## Acceptance criteria

- [ ] Twenty live registry entries are discovered and rendered as isolated observer slots without spawning browser conductors or fold calculations.
  - Run: `npx vitest run vendor/accordion/app/src/lib/live/sessionSlots.scale.test.ts`
  - Expected: 20 slots render distinct session/status/revision data; conductor/calculation spies remain zero.
- [ ] Updating/calculating session A leaves session B's revision, settings, socket, and readiness unchanged.
  - Run: `npx vitest run vendor/accordion/app/src/lib/live/sessionSlots.scale.test.ts`
  - Expected: cross-session isolation test passes with work counters only on A.
- [ ] Two clients through the broker receive extension-owned rebased/rejected outcomes while broker frames remain byte-equivalent.
  - Run: `npm test --prefix packages/accordion-broker -- --runInBand`
  - Expected: multi-client proxy/conflict integration passes and broker performs no semantic parsing.
- [ ] Watch requests, heartbeat liveness, stale pruning, focus, and shutdown deletion remain correct with 20 entries.
  - Run: `npm test --prefix packages/accordion-broker`
  - Expected: existing and new registry-scale suites pass.
- [ ] Dashboard scale test reports bounded poll/render latency and no work proportional to histories of inactive slots.
  - Run: `npx vitest run vendor/accordion/app/src/lib/live/sessionSlots.scale.test.ts --pool=forks --maxWorkers=1`
  - Expected: accepted local responsiveness threshold and structural counter assertions pass.

## Blocked by

- `01-file-backed-runtime-contracts.md`
- `09-dashboard-observer-protocol.md`
- `11-dashboard-conflict-rebase.md`
