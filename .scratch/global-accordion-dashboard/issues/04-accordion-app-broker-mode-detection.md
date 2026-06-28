Status: ready-for-agent

# Add Accordion app broker-mode detection

## Parent

.scratch/global-accordion-dashboard/PRD.md

## What to build

Teach the existing Accordion browser app to detect when it is served by the broker and enter broker dashboard mode, while preserving current direct single-session behavior when the broker meta endpoint is absent.

Implements PRD decisions: `DEC-001`, `DEC-012`, `DEC-013`, `DEC-014`.

Covers user stories: 8, 11, 12.

## Implementation map

### Areas cut through

- Accordion app broker mode and per-session slots
- WebSocket proxy and protocol compatibility

### Current code anchors

- `vendor/accordion/app/src/routes/+page.svelte`: top-level route that currently wires discovery, selected session, and live connection behavior.
- `vendor/accordion/app/src/lib/live/liveClient.svelte.ts`: current single-session WebSocket client behavior.
- `vendor/accordion/app/src/lib/live/protocol.ts`: `PROTOCOL_VERSION = 5`.
- Broker endpoint from issue 03: `GET /__accordion/broker-meta`.

### Existing behavior

The same Accordion app is served by direct session servers today. There is no broker-mode runtime detection. Direct session serving should remain the fallback behavior.

### Required edits

- Add app startup detection for `GET /__accordion/broker-meta`.
- If the endpoint returns broker metadata, set app mode to broker dashboard mode.
- If the endpoint returns 404 or is unavailable, keep existing single-session behavior.
- Do not require URL flags like `?broker=1`.
- Do not introduce a separate broker-only build.
- Keep the first broker-mode UI minimal if needed; multi-session slot refactor is completed in the next slice.

### Snippet(s)

`decision artifact` — normative detection behavior:

```text
GET /__accordion/broker-meta succeeds:
  app mode = broker dashboard

GET /__accordion/broker-meta returns 404/fails:
  app mode = normal single-session Accordion
```

`decision artifact` — normative broker meta response:

```json
{
  "mode": "broker",
  "protocolVersion": 5,
  "apiBase": "",
  "wsBase": ""
}
```

### Tests to extend

Add app tests under `vendor/accordion/app` for broker-mode detection:

- meta endpoint success enters broker mode
- meta endpoint 404 preserves normal mode
- protocol mismatch or malformed meta reports an error without breaking direct fallback behavior where appropriate

Suggested command using the existing app script:

```bash
npm run test --prefix vendor/accordion/app -- src/lib/live/brokerMode.test.ts
npm run check --prefix vendor/accordion/app
npm run check
```

### Wiring/build notes

- This should be a thin app patch, ideally via overlay if vendored files must change.
- Broker mode detection must not break direct session URLs served by individual Pi sessions.

## Acceptance criteria

- [ ] When `GET /__accordion/broker-meta` returns broker metadata, the app records broker dashboard mode.
- [ ] When `GET /__accordion/broker-meta` returns 404, the app uses the existing direct single-session path.
- [ ] Broker mode does not require a URL query flag.
- [ ] Broker mode does not require a separate app build.
- [ ] App broker-mode tests pass. Run: `npm run test --prefix vendor/accordion/app -- src/lib/live/brokerMode.test.ts`. Expected: broker meta success/fallback tests pass.
- [ ] App check passes. Run: `npm run check --prefix vendor/accordion/app`. Expected: `svelte-check` exits with code 0.
- [ ] Root typecheck passes. Run: `npm run check`. Expected: `tsc --noEmit` exits with code 0.

## Blocked by

- 03-broker-websocket-proxy-and-api-contract.md
