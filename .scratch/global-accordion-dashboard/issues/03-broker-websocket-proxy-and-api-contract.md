---
status: closed
---

Status: ready-for-agent

# Add broker WebSocket proxy and browser API contract

## Parent

.scratch/global-accordion-dashboard/PRD.md

## What to build

Expose the broker HTTP/WebSocket contract that the browser dashboard will use: broker meta, watched-session listing, focus updates, and proxied per-session Accordion WebSockets.

Implements PRD decisions: `DEC-003`, `DEC-004`, `DEC-009`, `DEC-014`.

Covers user stories: 3, 5, 6, 13.

## Implementation map

### Areas cut through

- Accordion Browser Broker package
- WebSocket proxy and protocol compatibility

### Current code anchors

- `vendor/accordion/app/src/lib/live/protocol.ts`: `PROTOCOL_VERSION = 5` and existing extension/app wire messages.
- `vendor/accordion/app/src/lib/live/registry.ts`: `SessionEntry` and stale-heartbeat concepts.
- `vendor/accordion/extension/accordion.ts`: current per-session server accepts one active GUI WebSocket client.
- `packages/accordion-broker/`: broker package from earlier slices.

### Existing behavior

Browser clients currently connect directly to a Pi session's ephemeral Accordion server. There is no broker endpoint for listing watched sessions or proxying WebSocket frames.

### Required edits

- Add broker meta endpoint:
  - `GET /__accordion/broker-meta`
- Add watched-session API returning only live watched sessions, not every discovered session.
- Add focus/current-active API or event stream sufficient for browser mode to receive focus requests.
- Add proxied WebSocket route keyed by session ID, e.g. `/ws/session/<sessionId>`.
- Broker resolves `<sessionId>` through the live watched list and current `~/.accordion/sessions/<sessionId>.json` entry.
- Broker opens upstream WebSocket to `127.0.0.1:<sessionEntry.port>` and transparently forwards frames both directions.
- Broker rejects unknown, unwatched, missing, stale, or incompatible sessions with clear status/close behavior.
- Do not alter direct single-session links in this slice.

### Snippet(s)

`decision artifact` — normative broker meta response:

```json
{
  "mode": "broker",
  "protocolVersion": 5,
  "apiBase": "",
  "wsBase": ""
}
```

`decision artifact` — illustrative route contract:

```text
Browser: ws://127.0.0.1:<brokerPort>/ws/session/<sessionId>
Broker:  ws://127.0.0.1:<sessionEntry.port>
```

### Tests to extend

Add broker tests using a fake upstream WebSocket server:

- `GET /__accordion/broker-meta` returns mode `broker` and protocol version 5.
- watched-session API returns only watched live sessions.
- client-to-upstream frames are forwarded unchanged.
- upstream-to-client frames are forwarded unchanged.
- closing either side closes/cleans up the other side.
- unknown/unwatched/stale session IDs are rejected.

Commands:

```bash
npm run test --prefix packages/accordion-broker
npm run check
```

### Wiring/build notes

- Keep frame forwarding fast. The Accordion extension has a 250ms plan-reply deadline.
- Browser must talk only to the broker origin for this global dashboard path.
- The broker is not allowed to own or mutate Accordion fold plans.

## Acceptance criteria

- [ ] `GET /__accordion/broker-meta` returns JSON with `mode: "broker"` and `protocolVersion: 5`.
- [ ] Watched-session API excludes sessions that never ran `/accordion`.
- [ ] Watched-session API excludes stale/exited sessions.
- [ ] `WS /ws/session/<sessionId>` forwards browser frames to a fake upstream session unchanged.
- [ ] `WS /ws/session/<sessionId>` forwards fake upstream frames to the browser unchanged.
- [ ] Unknown/unwatched/stale session IDs are rejected rather than proxied.
- [ ] Broker proxy tests pass. Run: `npm run test --prefix packages/accordion-broker`. Expected: meta/API/proxy tests pass.
- [ ] Root typecheck passes. Run: `npm run check`. Expected: `tsc --noEmit` exits with code 0.

## Blocked by

- 01-bootstrap-accordion-browser-broker.md
