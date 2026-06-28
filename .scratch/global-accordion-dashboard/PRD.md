Status: ready-for-agent

# PRD: Global Accordion Browser Dashboard

## Problem Statement

Accordion currently works well for one Pi session at a time, but the user often runs Pi in multiple repositories or multiple Pi processes. Today that means opening separate Accordion links and managing each session independently. The user wants one plain browser dashboard that can watch multiple explicitly selected Pi sessions in parallel, without requiring the Tauri desktop app.

## Solution

Build a plain browser-served Global Accordion Dashboard backed by a singleton local Accordion Browser Broker. Each Pi session still owns its existing Accordion extension server and session registry entry. Running `/accordion` in a Pi session explicitly adds that session to the global dashboard and focuses it. The browser dashboard keeps all watched sessions connected in parallel through broker-proxied WebSockets, while preserving Accordion's existing model that the browser app owns stores, fold planning, conductors, and UI state.

## User Stories

1. As a Pi user, I want to run `/accordion` in repo A, so that repo A's Pi session appears in one global browser dashboard.
2. As a Pi user, I want to run `/accordion` in repo B, so that repo B appears beside repo A in the same dashboard.
3. As a Pi user, I want watched sessions to remain connected in parallel, so that folding continues while the browser dashboard is open.
4. As a Pi user, I want `/accordion` from an already watched session to focus that session, so that I do not create duplicate sidebar entries.
5. As a Pi user, I want a browser refresh to restore currently live watched sessions, so that accidental refresh does not lose the dashboard.
6. As a Pi user, I want quitting a Pi session to remove it from the dashboard, so that stale sessions do not accumulate.
7. As a Pi user, I want multiple Pi sessions in the same repo to be possible, so that session identity is not incorrectly collapsed by cwd.
8. As a Pi user, I want existing direct single-session Accordion links to keep working, so that old workflows remain available.
9. As a maintainer, I want the broker code isolated in `packages/accordion-broker/`, so that upstream Accordion updates remain easier to adopt.
10. As a maintainer, I want the vendored Accordion overlay to stay thin, so that local customizations are not fragile string patches across large UI changes.
11. As a maintainer, I want the same Accordion app build to support normal and broker modes, so that we do not maintain two separate frontend builds.
12. As an implementer, I want broker mode detection to be explicit through a meta endpoint, so that the app can select multi-session mode without URL flags.
13. As an implementer, I want the browser to talk only to the broker origin, so that CORS and ephemeral port exposure are avoided.
14. As an implementer, I want a manual broker command for debugging, so that broker lifecycle problems can be reproduced outside `/accordion`.

## Accepted Decision Register

- `DEC-001`: Use a plain browser-served Global Accordion Dashboard.
  - Lens: strategy
  - Rationale: the user does not want to rely on the Tauri desktop app.
  - Rejected alternatives: Tauri-only dashboard; hybrid Tauri-first path.
  - Downstream impact: browser discovery must be broker-backed because plain browser JavaScript cannot read `~/.accordion/sessions/` directly.

- `DEC-002`: Add a separate singleton local Accordion Browser Broker.
  - Lens: runtime
  - Rationale: one dashboard should not belong to whichever Pi session happened to start first.
  - Rejected alternatives: each Pi extension hosts the global dashboard; first Pi process becomes dashboard host.
  - Downstream impact: implement broker lifecycle, heartbeat, port file, and stale broker cleanup.

- `DEC-003`: Broker proxies all session WebSockets.
  - Lens: contract
  - Rationale: the browser should talk to one origin only.
  - Rejected alternatives: browser connects directly to each ephemeral session port.
  - Downstream impact: broker must expose proxied routes like `/ws/session/:sessionId` and forward frames to the session entry's real port.

- `DEC-004`: Broker remains stateless for Accordion planning.
  - Lens: strategy
  - Rationale: preserve current Accordion architecture: GUI drives, extension is thin.
  - Rejected alternatives: broker owns stores, fold plans, and conductor attachments.
  - Downstream impact: browser app must own per-session stores, sockets, folding state, ghost state, and conductor state.

- `DEC-005`: Watched sessions stay connected in parallel.
  - Lens: runtime
  - Rationale: the whole point is one browser managing multiple active Pi sessions.
  - Rejected alternatives: connect only to selected session.
  - Downstream impact: refactor current app-side singletons into per-session slots.

- `DEC-006`: Only sessions that run `/accordion` appear in the dashboard.
  - Lens: scope
  - Rationale: `/accordion` is explicit consent to add a session.
  - Rejected alternatives: auto-watch every live session discovered in the registry.
  - Downstream impact: add watch-request coordination and live watched-session persistence.

- `DEC-007`: Watched Session identity is the Pi session ID, not repo/cwd.
  - Lens: contract
  - Rationale: multiple Pi sessions in one repo must be allowed without replacement or grouping logic.
  - Rejected alternatives: repo/workspace slots; repo grouping with duplicate handling.
  - Downstream impact: session labels may use cwd/title, but storage and routing key by `sessionId`.

- `DEC-008`: `/accordion` is idempotent per Pi session and means watch + focus.
  - Lens: contract
  - Rationale: first call adds the session; repeated calls focus the existing sidebar item.
  - Rejected alternatives: every `/accordion` creates a duplicate view; watch without focus.
  - Downstream impact: broker/browser must dedupe by `sessionId` and process focus requests.

- `DEC-009`: Watched list is broker-owned live state.
  - Lens: runtime
  - Rationale: browser refresh should restore live watched sessions, but Pi quit/stale should detach completely.
  - Rejected alternatives: browser memory only; permanent session history.
  - Downstream impact: broker persists watched session IDs, prunes missing/stale entries, and notifies browser.

- `DEC-010`: `/accordion` auto-starts broker, with a manual broker command for debugging.
  - Lens: ops
  - Rationale: normal UX should be one command, while development still needs direct broker startup.
  - Rejected alternatives: manual-only broker; auto-only broker.
  - Downstream impact: add package script such as `accordion:broker` and extension spawn/discovery logic.

- `DEC-011`: Implement broker as a separate `my-pi` package/module.
  - Lens: boundary
  - Rationale: this is a large custom feature; isolating it keeps vendored Accordion easier to refresh.
  - Rejected alternatives: large overlay scripts; direct vendored implementation only.
  - Downstream impact: create `packages/accordion-broker/`; keep `overlays/accordion/` thin.

- `DEC-012`: Reuse the existing Accordion app in broker mode for MVP.
  - Lens: scope
  - Rationale: fastest path while preserving current UX.
  - Rejected alternatives: new broker-owned frontend from day one.
  - Downstream impact: lightly patch/refactor vendored Accordion app; split frontend later only if patches become too large.

- `DEC-013`: Detect broker mode through a meta endpoint.
  - Lens: contract
  - Rationale: same app build can support broker dashboard and direct single-session links without URL flags.
  - Rejected alternatives: `?broker=1`; separate build-time mode.
  - Downstream impact: broker serves `GET /__accordion/broker-meta`; app falls back to normal mode on 404.

- `DEC-014`: Direct single-session links remain independent for MVP.
  - Lens: scope
  - Rationale: preserve current behavior exactly.
  - Rejected alternatives: redirect direct links to broker; conflict-aware redirect.
  - Downstream impact: known limitation remains: current extension supports one active GUI client per session, so direct link and broker dashboard can supersede each other.

## Implementation Plan

### Area: Accordion Browser Broker package

- **Decision IDs**: `DEC-001`, `DEC-002`, `DEC-003`, `DEC-009`, `DEC-010`, `DEC-011`, `DEC-013`
- **Current code anchors**:
  - `package.json` scripts and `pi.extensions` wiring.
  - Existing registry contract in `vendor/accordion/app/src/lib/live/registry.ts`.
  - Existing protocol contract in `vendor/accordion/app/src/lib/live/protocol.ts`.
- **Existing behavior**: Accordion has per-session extension servers and filesystem session registry entries, but no singleton browser broker.
- **Required edits**:
  - Create `packages/accordion-broker/` as the owner of broker lifecycle, HTTP dashboard serving, registry reading, watched-session live list, and WebSocket proxying.
  - Add a manual script, e.g. `accordion:broker`, in root `package.json`.
  - Broker reads existing `~/.accordion/sessions/<sessionId>.json` entries and prunes watched sessions when entries disappear or become stale.
  - Broker writes a live broker registry file, e.g. `~/.accordion/browser-broker.json`, containing port, pid, and heartbeat.
  - Broker exposes `GET /__accordion/broker-meta`.
  - Broker exposes browser APIs for watched sessions and focus updates, and WS proxy routes for selected session IDs.
- **Snippet(s)**:
  - `decision artifact` — normative broker meta response:

    ```json
    {
      "mode": "broker",
      "protocolVersion": 5,
      "apiBase": "",
      "wsBase": ""
    }
    ```

  - `decision artifact` — illustrative watched-session record:

    ```ts
    type WatchedSession = {
      sessionId: string;
      addedAt: number;
      lastSeenAt: number;
    };
    ```

- **Tests to extend**:
  - Add isolated Node tests for broker registry/watch-list behavior under `packages/accordion-broker/`.
  - Cover: adding a watch request, idempotent add, pruning stale/missing session entries, broker meta response, and proxy route rejects unknown session IDs.
  - Run command should be added with the package, likely `npm run check` plus package-specific tests if a test runner is introduced.
- **Wiring/build notes**:
  - Broker should be started automatically by `/accordion`, but must also be runnable manually for development.
  - Keep broker implementation independent from Svelte UI internals.

### Area: `/accordion` extension command and session intent files

- **Decision IDs**: `DEC-006`, `DEC-008`, `DEC-010`, `DEC-014`
- **Current code anchors**:
  - `vendor/accordion/extension/accordion.ts` default export `accordionLive(pi)`.
  - Existing `/accordion` command registration in `vendor/accordion/extension/accordion.ts`.
  - Existing focus/session registry behavior described by `vendor/accordion/app/src/lib/live/registry.ts`.
- **Existing behavior**: `/accordion` writes a focus request and optionally launches/focuses the desktop app. Each Pi session advertises itself under `~/.accordion/sessions/`.
- **Required edits**:
  - Change `/accordion` behavior in browser-dashboard mode to ensure the singleton broker is alive, write a watch request for the current `sessionId`, write a focus request for the same `sessionId`, and open the broker URL.
  - Keep direct single-session links independent; do not redirect direct session URLs to broker for MVP.
  - Make repeated `/accordion` calls idempotent by preserving the same `sessionId` watch identity.
- **Snippet(s)**:
  - `decision artifact` — normative command behavior:

    ```text
    /accordion:
      ensure broker running
      write watch request for current sessionId
      write focus request for current sessionId
      open http://127.0.0.1:<brokerPort>
    ```

  - `decision artifact` — illustrative files:

    ```text
    ~/.accordion/browser-broker.json
    ~/.accordion/watch-requests/<sessionId>.json
    ~/.accordion/focus.json
    ~/.accordion/watched-sessions.json
    ~/.accordion/sessions/<sessionId>.json
    ```

- **Tests to extend**:
  - Add focused tests around any extracted file-writing/startup helpers rather than testing Pi command registration through a full Pi runtime.
  - Manual verification should include running `/accordion` twice in one session and confirming one sidebar entry is focused.
- **Wiring/build notes**:
  - Prefer thin overlay integration if editing vendored `accordion.ts` remains necessary.
  - Ensure broker startup works after `npm install` / package install without requiring global binaries.

### Area: Accordion app broker mode and per-session slots

- **Decision IDs**: `DEC-001`, `DEC-004`, `DEC-005`, `DEC-006`, `DEC-007`, `DEC-008`, `DEC-012`, `DEC-013`
- **Current code anchors**:
  - `vendor/accordion/app/src/lib/session.svelte.ts` currently holds one global `session.store`.
  - `vendor/accordion/app/src/lib/live/liveClient.svelte.ts` currently holds module-level `socket`, `live`, and pending completion state.
  - `vendor/accordion/app/src/lib/live/folding.svelte.ts` currently holds singleton folding enabled state.
  - `vendor/accordion/app/src/lib/live/ghostState.svelte.ts` currently holds singleton streaming ghost state.
  - `vendor/accordion/app/src/lib/live/conductorClient.svelte.ts` currently holds singleton conductor attachment state.
  - `vendor/accordion/app/src/routes/+page.svelte` currently selects/connects one session view.
- **Existing behavior**: the browser app can discover multiple sessions in desktop/Tauri mode, but it connects to and renders one live session at a time. Switching sessions replaces/destructively disposes the global store.
- **Required edits**:
  - Add startup broker-mode detection through `GET /__accordion/broker-meta`; if 404, keep existing single-session behavior.
  - Introduce a per-session slot model for broker mode. Each watched session owns its own socket, store, folding state, ghost state, pending completions, and conductor attachment.
  - Sidebar should show only watched sessions returned by broker, not every live registry session.
  - All watched sessions should remain connected while the browser dashboard is open.
  - Active/focused session controls the main visible context map.
  - Session identity must be `sessionId`; cwd/title are labels only.
- **Snippet(s)**:
  - `decision artifact` — illustrative browser slot shape:

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

- **Tests to extend**:
  - Add or extend app tests around slot management if an existing Svelte/Vitest pattern is available.
  - Add tests for broker-mode detection fallback: meta endpoint success enters broker mode; 404 remains normal mode.
  - Existing app test command is under `vendor/accordion/app`, likely `npm test`/Vitest via that package; implementer should verify exact script in `vendor/accordion/app/package.json` before adding test commands to issues.
- **Wiring/build notes**:
  - Broker mode must not break direct session URL behavior.
  - Avoid large UI forks. If patches become large, create a follow-up to extract a broker-owned frontend.

### Area: WebSocket proxy and protocol compatibility

- **Decision IDs**: `DEC-003`, `DEC-004`, `DEC-005`, `DEC-014`
- **Current code anchors**:
  - `vendor/accordion/app/src/lib/live/protocol.ts` defines `PROTOCOL_VERSION = 5` and the extension/app messages.
  - `vendor/accordion/extension/accordion.ts` accepts one active GUI WebSocket client per Pi session.
  - Current protocol includes `hello`, `sync`, `stream`, `plan`, `unfoldRequest`, `recallRequest`, `completeRequest`, and related result messages.
- **Existing behavior**: browser connects directly to a per-session ephemeral port. Extension supersedes an old GUI client when a new one connects.
- **Required edits**:
  - Broker proxy must forward WebSocket text/binary frames transparently and preserve close/error behavior.
  - Browser connects to broker route keyed by `sessionId`; broker resolves the current live session entry and opens the real upstream WS to `127.0.0.1:<entry.port>`.
  - Broker should reject unknown, unwatched, missing, stale, or protocol-incompatible session IDs with clear close/error behavior.
  - Do not change direct single-session behavior for MVP.
- **Snippet(s)**:
  - `decision artifact` — illustrative route contract:

    ```text
    Browser: ws://127.0.0.1:<brokerPort>/ws/session/<sessionId>
    Broker:  ws://127.0.0.1:<sessionEntry.port>
    ```

- **Tests to extend**:
  - Broker proxy tests with a fake upstream WS server: forwards client→upstream and upstream→client frames, closes both sides on disconnect, rejects missing sessions.
  - Add a manual smoke test with two Pi sessions watched at once.
- **Wiring/build notes**:
  - The 250ms plan-reply timeout remains important. Broker proxy must avoid expensive synchronous work on the frame path.

### Area: Documentation and package install/update flow

- **Decision IDs**: `DEC-001` through `DEC-014`
- **Current code anchors**:
  - `README.md` Accordion section.
  - `package.json` scripts: `accordion:install`, `accordion:build`, `accordion:overlay`, `setup:accordion`, `accordion:update`.
  - `scripts/postinstall.mjs` applies overlay and builds Accordion.
  - `CONTEXT.md` already defines `Global Accordion Dashboard` and `Accordion Browser Broker`.
- **Existing behavior**: README documents vendored Accordion, overlay, and current `/accordion` usage.
- **Required edits**:
  - Document global dashboard behavior: `/accordion` adds/focuses current Pi session; browser refresh restores live watched sessions; Pi quit removes session.
  - Document known MVP limitation: direct single-session links are independent and may conflict with broker dashboard for the same session.
  - Add manual broker command documentation for development/debugging.
  - Keep vendored Accordion update guidance clear: broker package is owned by `my-pi`; overlay should remain thin.
- **Snippet(s)**: None required.
- **Tests to extend**:
  - Documentation changes do not require tests beyond the broker/app checks above.
- **Wiring/build notes**:
  - `postinstall` should continue to install/build Accordion and apply overlays.
  - If broker package needs its own dependencies/build, wire them into root install/check scripts explicitly.

## Global Build & Wiring Notes

- Accordion is vendored under `vendor/accordion/`; avoid direct one-off vendor edits when the change can live in `packages/accordion-broker/` or a thin overlay.
- Root `package.json` registers Accordion extension at `./vendor/accordion/extension/accordion.ts` and existing custom extensions via `./extensions`.
- Existing overlay command is `npm run accordion:overlay`; it currently copies the MCP-preserving GC conductor and patches defaults.
- Existing root validation command is `npm run check` (`tsc --noEmit`).
- Broker package should have a clear manual command, expected as `npm run accordion:broker` or equivalent.
- Browser dashboard mode should be selected at runtime through `GET /__accordion/broker-meta`; direct session serving should return 404 and stay in single-session mode.

## Testing Decisions

- Test broker behavior as a deep module: registry parsing, watch-request processing, live watch-list pruning, broker heartbeat, meta endpoint, and WS proxying should be isolated from the Svelte app where possible.
- Test browser behavior through external state transitions: broker meta success/failure, watched session list changes, focus changes, and slot connect/disconnect behavior. Avoid testing private implementation details of Svelte stores when public UI/state behavior can be asserted.
- Preserve current Accordion safety behavior: if no plan reaches the extension within the timeout, messages pass through unchanged. Broker tests should avoid adding latency to frame forwarding.
- Manual acceptance should include at least two simultaneous Pi sessions from different repos, plus two sessions from the same repo if practical.
- Required proof commands before marking complete:
  - `npm run check`
  - broker package test command once introduced
  - Accordion app test command once exact existing script is confirmed from `vendor/accordion/app/package.json`

## Out of Scope

- Tauri/Desktop-only dashboard as the primary solution.
- Cross-machine or remote dashboard support.
- Browser authentication beyond localhost-only assumptions.
- Making direct single-session links redirect into the broker dashboard.
- Supporting multiple GUI clients for the same Pi session in the extension.
- Moving Accordion folding/planning state into the broker.
- Fully extracting a separate broker-owned frontend in the MVP.
- Repo/workspace grouping as the identity model.

## Unresolved Gaps

None.

## Further Notes

The accepted design intentionally preserves Accordion's existing architecture: the browser computes plans; the extension stays thin; no browser means no active folding. This matches the user's expectation that the global browser dashboard remains open while managing multiple sessions.
