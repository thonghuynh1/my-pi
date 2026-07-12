Status: ready-for-agent

## Parent

`.scratch/accordion-authoritative-runtime/PRD.md`

## What to build

Turn direct and broker dashboards into multi-observer replicas of the session runtime and introduce revisioned command/acknowledgement contracts. Cover `DEC-016`, `US-004`, and `RB-011`.

## Implementation map

- Consume runtime snapshots from `02-headless-activation-and-footer.md` and provider-ready revisions from `04-provider-revision-gate.md`.
- In `vendor/accordion/app/src/lib/live/protocol.ts`, add versioned runtime snapshot/status, `DashboardTarget`, `DashboardCommand`, and `DashboardAck` messages. Commands include command ID, session ID, expected revision, typed target, and desired action.
- Bump Pi browser `PROTOCOL_VERSION` and update extension, direct client, broker slot client, and mirrored broker metadata together. Old peers fail with an actionable reload/restart message; no legacy migration is required.
- Replace extension singleton `client` authority with a set of observer sockets. Connection lifecycle never resets runtime revisions or active folding. Broadcast authoritative snapshots/acks to every observer.
- In `liveClient.svelte.ts` and `sessionSlots.svelte.ts`, remove plan production from protocol-v6 paths. Browser stores become read replicas populated from runtime snapshots. Background slots do not attach/run conductors.
- Keep the Accordion Browser Broker byte-transparent; the session extension owns command validation and arbitration.
- This issue establishes command transport and acknowledgement but not optimistic UI or stale conflict semantics, which issues 10 and 11 consume.
- Dependency proof: both direct and broker clients must render a plan produced by the real runtime and send a typed command to the extension; tests fail if browser `computeFoldOps` remains authoritative.
- Grounding: `GROUND-009`–`GROUND-012`.

## Acceptance criteria

- [ ] Direct and broker clients negotiate the bumped protocol and reject stale builds with a reload/restart message.
  - Run: `npx vitest run vendor/accordion/app/src/lib/live/liveClient.protocol.test.ts vendor/accordion/app/src/lib/live/sessionSlots.test.ts packages/accordion-broker/__tests__/broker.test.ts`
  - Expected: version negotiation passes in both modes; mismatch assertion contains actionable text.
- [ ] Two dashboards simultaneously receive the same session-owned runtime revision without either connection superseding the other.
  - Run: `npx vitest run vendor/accordion/extension/runtime/dashboard-observers.test.ts`
  - Expected: two-client broadcast test observes identical snapshot revision on both sockets.
- [ ] Protocol-v6 browser sync performs zero conductor attachment, `computeFoldOps`, or `computeGroupOps` calls.
  - Run: `npx vitest run vendor/accordion/app/src/lib/live/liveClient.protocol.test.ts vendor/accordion/app/src/lib/live/sessionSlots.test.ts`
  - Expected: observer-only spies remain at zero while authoritative folds render.
- [ ] A typed dashboard command crosses direct and broker paths and receives a correlated acknowledgement from the session runtime.
  - Run: `npx vitest run vendor/accordion/extension/runtime/dashboard-observers.test.ts packages/accordion-broker/__tests__/broker.test.ts`
  - Expected: command ID/session/revision/target are preserved end-to-end; broker payload is unchanged.
- [ ] Closing every dashboard leaves runtime activation, conductor, and ready revision unchanged.
  - Run: `npx vitest run vendor/accordion/extension/runtime/dashboard-observers.test.ts`
  - Expected: observer-disconnect lifecycle test passes.

## Blocked by

- `02-headless-activation-and-footer.md`
- `04-provider-revision-gate.md`
