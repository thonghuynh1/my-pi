---
status: closed
---

Status: ready-for-agent

# Add watch/focus request lifecycle from /accordion

## Parent

.scratch/global-accordion-dashboard/PRD.md

## What to build

Make `/accordion` add the current Pi session to the Global Accordion Dashboard and focus it. The broker should persist watched sessions as live state that survives browser refresh and is pruned when the Pi session exits or becomes stale.

Implements PRD decisions: `DEC-006`, `DEC-008`, `DEC-009`, `DEC-010`.

Covers user stories: 1, 2, 4, 5, 6.

## Implementation map

### Areas cut through

- `/accordion` extension command and session intent files
- Accordion Browser Broker package
- Documentation and package install/update flow

### Current code anchors

- `vendor/accordion/extension/accordion.ts`: default export `accordionLive(pi)`, existing `/accordion` command, session lifecycle hooks, and existing focus/session registry writing.
- `vendor/accordion/app/src/lib/live/registry.ts`: existing `SessionEntry`, `FocusRequest`, registry directory constants, heartbeat/stale behavior.
- `packages/accordion-broker/`: broker module from issue 01.
- `README.md`: Accordion usage docs.

### Existing behavior

`/accordion` currently targets the old one-session app/focus behavior. Live sessions advertise themselves under `~/.accordion/sessions/<sessionId>.json`, but there is no explicit watched-session list for the browser dashboard.

### Required edits

- Add watch-request coordination, e.g. `~/.accordion/watch-requests/<sessionId>.json`.
- Make `/accordion` ensure the broker is running, then write:
  - watch request for current `sessionId`
  - focus request for current `sessionId`
- Make `/accordion` open the broker URL from `~/.accordion/browser-broker.json`.
- Broker consumes watch requests into a live watched list, e.g. `~/.accordion/watched-sessions.json`.
- Broker dedupes by `sessionId` so repeated `/accordion` calls focus the existing watched session instead of creating duplicates.
- Broker removes watched sessions when the underlying `~/.accordion/sessions/<sessionId>.json` disappears or is stale.
- Direct single-session links remain independent; do not redirect them to the broker.

### Snippet(s)

`decision artifact` — normative command behavior:

```text
/accordion:
  ensure broker running
  write watch request for current sessionId
  write focus request for current sessionId
  open http://127.0.0.1:<brokerPort>
```

`decision artifact` — illustrative files:

```text
~/.accordion/browser-broker.json
~/.accordion/watch-requests/<sessionId>.json
~/.accordion/focus.json
~/.accordion/watched-sessions.json
~/.accordion/sessions/<sessionId>.json
```

`decision artifact` — illustrative watched-session record:

```ts
type WatchedSession = {
  sessionId: string;
  addedAt: number;
  lastSeenAt: number;
};
```

### Tests to extend

Add broker tests for:

- consuming a watch request
- idempotent add for the same `sessionId`
- recording focus for the same `sessionId`
- pruning watched sessions whose session entry is missing
- pruning watched sessions whose heartbeat is stale

Add extension helper tests if file-writing/startup helpers are extracted from `accordion.ts`.

Commands:

```bash
npm run test --prefix packages/accordion-broker
npm run check
```

### Wiring/build notes

- This slice may require a thin overlay patch to `vendor/accordion/extension/accordion.ts`.
- Keep watch/focus file formats small and local-only.
- The browser UI consuming this state is implemented in later slices; broker/package tests are the proof for this slice.

## Acceptance criteria

- [ ] Running `/accordion` in one Pi session results in a watch request for that exact `sessionId`.
- [ ] Running `/accordion` twice in the same Pi session does not create duplicate watched-session records.
- [ ] A focus request is written for the same `sessionId` when `/accordion` runs.
- [ ] Broker watched state survives a simulated browser refresh because it is stored by the broker, not only in browser memory.
- [ ] Broker removes a watched session when the matching session registry file is missing.
- [ ] Broker removes a watched session when the matching session heartbeat is stale.
- [ ] Broker tests pass. Run: `npm run test --prefix packages/accordion-broker`. Expected: watch/focus/prune tests pass.
- [ ] Root typecheck passes. Run: `npm run check`. Expected: `tsc --noEmit` exits with code 0.
- [ ] README explains `/accordion = watch + focus` and that Pi quit detaches/removes the session.

## Blocked by

- 01-bootstrap-accordion-browser-broker.md
