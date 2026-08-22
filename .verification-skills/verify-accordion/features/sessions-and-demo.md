# Sessions & Demo

The session sidebar and demo session loading — the entry point for all
verification without a live Pi agent.

## Sub-features

- **Load sample button** — `button:has-text("Load sample")` on the empty state,
  loads a bundled 982-block demo session from `/sample-session.jsonl`.
- **Demo session sidebar button** — `[aria-label="Demo session"]` in the
  sidebar rail, same function.
- **Sessions sidebar** — left rail showing available sessions (live, file, demo).
  Collapsible via `[aria-label="Collapse sidebar"]` / `[aria-label="Expand sidebar"]`.
- **Sidebar toggle** — `Cmd+B` keyboard shortcut toggles the sidebar.
- **Port input** — `[aria-label="pi port"]` in browser mode, for manual
  connection to a Pi session's WebSocket port.
- **Connect button** — next to the port input, initiates WebSocket connection.

## How to get to it (user POV)

1. Open the dashboard — the empty state shows the "Load sample" button
2. Or expand the sidebar and click "Demo session" in the session list
3. The context map populates immediately

## Driving it with Playwright

```js
// Method 1: Load via main CTA
await page.goto("http://localhost:1420");
await page.click('button:has-text("Load sample")');
await page.waitForSelector("[data-id]", { timeout: 10000 });

// Method 2: Via sidebar demo button (if sidebar is visible)
await page.click('[aria-label="Demo session"]');
await page.waitForSelector("[data-id]", { timeout: 10000 });

// Toggle sidebar
await page.click('[aria-label="Collapse sidebar"]');
await page.waitForSelector('[aria-label="Expand sidebar"]');
await page.click('[aria-label="Expand sidebar"]');
await page.waitForSelector('[aria-label="Collapse sidebar"]');

// Capture evidence
await page.screenshot({ path: "evidence/session-loaded.png" });
```

## Gotchas

- The "Load sample" button only appears in the **empty state** (no session
  loaded). After loading demo, it's replaced by the context map.
- In broker mode, the session list comes from `GET /__accordion/sessions` and
  may be empty if no Pi sessions are running.
- The demo session is read-only: fold steering is available but changes are
  not persisted.
- Loading the demo fetches `/sample-session.jsonl` — if the dev server hasn't
  built/served this file, loading will fail.
