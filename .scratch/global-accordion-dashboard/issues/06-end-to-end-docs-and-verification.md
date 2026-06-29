---
status: closed
---

Status: ready-for-agent

# End-to-end docs and verification polish

## Parent

.scratch/global-accordion-dashboard/PRD.md

## What to build

Finalize user-facing documentation and end-to-end verification for the Global Accordion Dashboard after the broker, watch/focus lifecycle, proxy, broker-mode detection, and per-session slot work are complete.

Implements PRD decisions: `DEC-001` through `DEC-014`.

Covers user stories: all PRD user stories.

## Implementation map

### Areas cut through

- Documentation and package install/update flow
- Accordion Browser Broker package
- `/accordion` extension command and session intent files
- Accordion app broker mode and per-session slots
- WebSocket proxy and protocol compatibility

### Current code anchors

- `README.md`: current Accordion section and install/update docs.
- `package.json`: root scripts including Accordion setup and broker command.
- `scripts/postinstall.mjs`: install/build automation.
- `packages/accordion-broker/`: broker implementation from earlier slices.
- `vendor/accordion/extension/accordion.ts`: `/accordion` behavior.
- `vendor/accordion/app/src/routes/+page.svelte` and live client modules: browser dashboard behavior.
- `.scratch/global-accordion-dashboard/PRD.md`: accepted decisions and out-of-scope list.

### Existing behavior

Documentation currently describes vendored Accordion and overlay behavior, but not the new global broker dashboard lifecycle.

### Required edits

- Update `README.md` to explain:
  - Global Accordion Dashboard purpose.
  - `/accordion` adds and focuses the current Pi session.
  - Running `/accordion` in multiple Pi sessions adds each one to the same browser dashboard.
  - Browser refresh restores currently live watched sessions.
  - Quitting a Pi session removes it from the dashboard.
  - Multiple Pi sessions in the same repo are separate watched sessions.
  - Direct single-session links remain independent for MVP and may conflict with broker dashboard for the same session.
  - Manual debug command `npm run accordion:broker`.
- Add or update any package scripts needed for end-to-end verification.
- Ensure postinstall/setup docs remain correct for vendored Accordion and overlay.
- Do not document out-of-scope features as supported.

### Snippet(s)

`decision artifact` — normative UX summary:

```text
/accordion = watch + focus current Pi session in the global browser dashboard.
Browser refresh restores live watched sessions.
Pi session exit removes that watched session.
Direct single-session links remain independent for MVP.
```

### Tests to extend

This slice primarily verifies integration. It should run the accumulated test/check commands from prior slices:

```bash
npm run test --prefix packages/accordion-broker
npm run test --prefix vendor/accordion/app -- src/lib/live/brokerMode.test.ts
npm run test --prefix vendor/accordion/app -- src/lib/live/sessionSlots.test.ts
npm run check --prefix vendor/accordion/app
npm run check
```

If a script-based smoke test is added, it should simulate two watched sessions with fake upstream WS servers and prove both appear/connect through the broker.

### Wiring/build notes

- Keep docs clear that browser dashboard is local/plain-browser and broker-backed.
- Keep docs clear that cross-machine dashboard support, multi-GUI clients per Pi session, and broker-owned folding/planning are out of scope.

## Acceptance criteria

- [ ] README explains the Global Accordion Dashboard in user-facing language.
- [ ] README documents `/accordion = watch + focus`.
- [ ] README documents that multiple Pi sessions, including sessions from the same repo, appear as separate watched sessions.
- [ ] README documents browser refresh and Pi quit lifecycle behavior.
- [ ] README documents `npm run accordion:broker` for debugging.
- [ ] README documents the MVP limitation that direct single-session links remain independent and can conflict with broker dashboard for the same Pi session.
- [ ] Broker tests pass. Run: `npm run test --prefix packages/accordion-broker`. Expected: all broker tests pass.
- [ ] Broker-mode app tests pass. Run: `npm run test --prefix vendor/accordion/app -- src/lib/live/brokerMode.test.ts`. Expected: broker mode detection tests pass.
- [ ] Slot app tests pass. Run: `npm run test --prefix vendor/accordion/app -- src/lib/live/sessionSlots.test.ts`. Expected: session slot lifecycle tests pass.
- [ ] App check passes. Run: `npm run check --prefix vendor/accordion/app`. Expected: `svelte-check` exits with code 0.
- [ ] Root typecheck passes. Run: `npm run check`. Expected: `tsc --noEmit` exits with code 0.

## Blocked by

- 01-bootstrap-accordion-browser-broker.md
- 02-watch-focus-lifecycle-from-accordion.md
- 03-broker-websocket-proxy-and-api-contract.md
- 04-accordion-app-broker-mode-detection.md
- 05-browser-per-session-slots.md
