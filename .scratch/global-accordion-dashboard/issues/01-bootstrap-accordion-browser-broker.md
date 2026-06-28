Status: ready-for-agent

# Bootstrap singleton Accordion Browser Broker

## Parent

.scratch/global-accordion-dashboard/PRD.md

## What to build

Create the `packages/accordion-broker/` module and root wiring for a singleton local broker that can serve HTTP, publish its own heartbeat/port file, and be started manually for debugging.

Implements PRD decisions: `DEC-001`, `DEC-002`, `DEC-010`, `DEC-011`.

Covers user stories: 9, 14.

## Implementation map

### Areas cut through

- Accordion Browser Broker package
- Documentation and package install/update flow

### Current code anchors

- `package.json`: root scripts and dependency wiring.
- `scripts/postinstall.mjs`: current install/build automation.
- `vendor/accordion/app/src/lib/live/registry.ts`: existing Accordion registry concepts and stale heartbeat constants to mirror where useful.
- `README.md`: current Accordion usage/update documentation.

### Existing behavior

There is no singleton broker. Accordion currently relies on per-session extension servers and existing session registry entries. The root package has Accordion setup scripts but no broker command.

### Required edits

- Create `packages/accordion-broker/` as a separate `my-pi` owned module.
- Implement a local HTTP server entry point that binds to `127.0.0.1` on an available port.
- Write and refresh a broker registry file at `~/.accordion/browser-broker.json` containing at least `port`, `pid`, `startedAt`, and `heartbeatAt`.
- Add stale broker detection/overwrite behavior so a dead broker file does not block startup.
- Add root script `accordion:broker` that starts the broker manually.
- Keep this module independent from Svelte UI internals.
- Document the manual command in `README.md` as a debugging/development command.

### Snippet(s)

`decision artifact` — normative broker meta response shape to reserve in this package, even if later slices expand it:

```json
{
  "mode": "broker",
  "protocolVersion": 5,
  "apiBase": "",
  "wsBase": ""
}
```

`decision artifact` — illustrative broker file:

```json
{
  "port": 49123,
  "pid": 12345,
  "startedAt": 1710000000000,
  "heartbeatAt": 1710000005000
}
```

### Tests to extend

Add broker package tests covering:

- broker registry file write
- heartbeat refresh
- stale broker file replacement
- HTTP server startup on loopback

Suggested package test command to wire and make pass:

```bash
npm run test --prefix packages/accordion-broker
```

Also keep root typecheck passing:

```bash
npm run check
```

### Wiring/build notes

- Add package dependencies explicitly if needed; do not rely on global binaries.
- If the broker is TypeScript, add a package-local build/test script and wire root scripts only as needed.
- Do not modify vendored Accordion app behavior in this slice.

## Acceptance criteria

- [ ] `packages/accordion-broker/` exists and contains a runnable broker entry point.
- [ ] Running `npm run accordion:broker` starts a loopback HTTP server and prints the dashboard URL.
- [ ] Running `npm run accordion:broker` writes `~/.accordion/browser-broker.json` with the actual port and pid.
- [ ] A stale `~/.accordion/browser-broker.json` for a dead pid/port is replaced by a new broker start.
- [ ] Broker tests pass. Run: `npm run test --prefix packages/accordion-broker`. Expected: test output reports all broker startup/registry tests passing.
- [ ] Root typecheck passes. Run: `npm run check`. Expected: `tsc --noEmit` exits with code 0.
- [ ] README documents `npm run accordion:broker` as a manual debug command.

## Blocked by

None - can start immediately.
