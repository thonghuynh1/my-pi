Status: ready-for-agent

# Refactor browser app into per-session slots

## Parent

.scratch/global-accordion-dashboard/PRD.md

## What to build

In broker mode, make the Accordion browser app manage multiple watched Pi sessions in parallel. Each watched session gets its own socket/store/folding state while one active session is displayed in the main view.

Implements PRD decisions: `DEC-004`, `DEC-005`, `DEC-006`, `DEC-007`, `DEC-008`, `DEC-012`.

Covers user stories: 1, 2, 3, 4, 5, 7.

## Implementation map

### Areas cut through

- Accordion app broker mode and per-session slots
- WebSocket proxy and protocol compatibility

### Current code anchors

- `vendor/accordion/app/src/lib/session.svelte.ts`: currently holds one global `session.store`.
- `vendor/accordion/app/src/lib/live/liveClient.svelte.ts`: currently holds module-level `socket`, `live`, and pending completion state.
- `vendor/accordion/app/src/lib/live/folding.svelte.ts`: currently holds singleton folding enabled state.
- `vendor/accordion/app/src/lib/live/ghostState.svelte.ts`: currently holds singleton streaming ghost state.
- `vendor/accordion/app/src/lib/live/conductorClient.svelte.ts`: currently holds singleton conductor attachment state.
- `vendor/accordion/app/src/routes/+page.svelte`: currently selects/connects one session view.
- Broker APIs/proxy from issues 03 and 04.

### Existing behavior

The app can display one connected session at a time. Switching sessions replaces/disposes global state. Hidden sessions are not kept actively connected/folding.

### Required edits

- Introduce broker-mode `SessionSlot` state keyed by `sessionId`.
- Each watched session owns its own:
  - proxied WebSocket
  - `AccordionStore`
  - live status
  - folding enabled state
  - ghost/streaming state
  - pending completion map
  - conductor attachment state, or a scoped equivalent
- Sidebar shows only watched sessions returned by the broker.
- All watched sessions remain connected while the browser dashboard is open.
- Active/focused session controls the main visible context map.
- Focus events from `/accordion` select the existing slot if present.
- Session identity is `sessionId`; cwd/title are labels only.
- Normal single-session mode must keep working.

### Snippet(s)

`decision artifact` — illustrative slot shape:

```ts
type SessionSlot = {
  sessionId: string;
  entry: SessionEntry;
  store: AccordionStore;
  socket: WebSocket | null;
  status: "connecting" | "live" | "stale" | "disconnected" | "error";
  folding: { enabled: boolean };
};
```

`decision artifact` — normative session identity rule:

```text
Watched Session identity = SessionEntry.sessionId
Display label may use title/cwd/model, but never dedupe by cwd.
```

### Tests to extend

Add app tests for broker-mode slot management:

- adding two watched sessions creates two slots keyed by distinct session IDs
- repeated focus for the same session selects existing slot and does not duplicate
- removing a watched session disposes its slot/store/socket
- two sessions with the same cwd/title remain separate if session IDs differ
- normal single-session fallback still works when broker meta is absent

Commands:

```bash
npm run test --prefix vendor/accordion/app -- src/lib/live/sessionSlots.test.ts
npm run check --prefix vendor/accordion/app
npm run check
```

### Wiring/build notes

- Keep direct single-session mode behavior intact.
- Keep the broker stateless for planning; do not move fold-plan computation into the broker.
- Avoid large UI forks. If extraction becomes necessary, document it as follow-up rather than hiding it in this slice.

## Acceptance criteria

- [ ] In broker mode, two watched sessions create two independent slots keyed by different `sessionId` values.
- [ ] In broker mode, two watched sessions with the same cwd/title are not merged.
- [ ] Repeated focus for the same `sessionId` selects the existing slot and does not duplicate it.
- [ ] Removing a watched session disposes that session's socket/store resources.
- [ ] All watched sessions remain connected while the dashboard is open, not only the visible session.
- [ ] The visible main view follows the active/focused slot.
- [ ] Direct single-session mode still works when broker meta is absent.
- [ ] Slot tests pass. Run: `npm run test --prefix vendor/accordion/app -- src/lib/live/sessionSlots.test.ts`. Expected: all slot lifecycle tests pass.
- [ ] App check passes. Run: `npm run check --prefix vendor/accordion/app`. Expected: `svelte-check` exits with code 0.
- [ ] Root typecheck passes. Run: `npm run check`. Expected: `tsc --noEmit` exits with code 0.

## Blocked by

- 04-accordion-app-broker-mode-detection.md
