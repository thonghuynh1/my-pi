---
name: verify-accordion
description: >
  Drive the Accordion context-window dashboard (SvelteKit SPA) end-to-end:
  launch the dev server or broker, load a demo session, exercise tile grid /
  inspector / conductor / settings UI, and capture evidence. Use this skill
  whenever you need to prove a change to the Accordion app or extension works
  visually and functionally.
---

# verify-accordion

Accordion is a live context-window visualizer for the Pi coding agent. It runs
as a SvelteKit SPA (dev on port 1420, production via broker on an ephemeral
port). The dashboard shows a tile grid of context blocks, supports fold/unfold
steering, and connects to live Pi sessions via WebSocket.

## Surfaces

| Surface | When to use |
|---|---|
| **Dev server** (port 1420) | UI changes, new features, visual verification |
| **Broker** (ephemeral port) | Multi-session, broker proxy, production-like |
| **Unit tests** (Vitest + node:test) | Engine/logic changes |

This skill covers the **browser dashboard** surface. For unit tests, see the
test commands at the end.

---

## Launch

### Dev server (preferred for UI verification)

```bash
cd extensions/accordion/app
npm run dev
# Ready when terminal prints: "VITE vX.X.X ready in Xms" + "Local: http://localhost:1420/"
```

The dev server binds to `http://localhost:1420` with `strictPort: true`.

### Broker (production-like)

```bash
npm run accordion:broker
# Ready when terminal prints: "Accordion Browser Broker running at http://127.0.0.1:<port>"
# Port is written to ~/.accordion/browser-broker.json
```

Read the port:
```bash
cat ~/.accordion/browser-broker.json
# { "port": <N>, "pid": <N>, "startedAt": <epoch>, "heartbeatAt": <epoch> }
```

### Teardown

Kill only the process you started. Dev server: Ctrl+C in the terminal, or kill
the PID. Broker: kill the PID from `browser-broker.json`.

```bash
# Dev server — just Ctrl+C in the terminal where it runs
# Broker — kill the recorded PID
node -e "const f=require('fs').readFileSync(require('os').homedir()+'/.accordion/browser-broker.json','utf8'); const d=JSON.parse(f); process.kill(d.pid);"
```

Never kill by process name (`node`, `vite`). Kill what you started.

---

## Doctor

Run this check before driving to confirm the instance is healthy:

```bash
# For dev server:
curl -sf http://localhost:1420/ > /dev/null && echo "OK: dev server up" || echo "FAIL: dev server not responding"

# For broker:
PORT=$(node -e "console.log(JSON.parse(require('fs').readFileSync(require('os').homedir()+'/.accordion/browser-broker.json','utf8')).port)")
curl -sf "http://127.0.0.1:$PORT/__accordion/broker-meta" && echo " OK: broker up" || echo "FAIL: broker not responding"
```

A healthy dev server returns the SPA HTML on `/`. A healthy broker returns
`{"mode":"broker","protocolVersion":5,...}` on `/__accordion/broker-meta`.

---

## Drive

### Harness: Playwright (via `playwright-core`)

`playwright-core` is already a dependency. Launch a Chromium instance and
navigate to the app.

### Loading data without a live Pi session

The app ships a bundled demo session (982 blocks). This is the **recommended
way** to verify UI behavior without needing a running Pi agent:

1. Navigate to `http://localhost:1420`
2. Click the **"Load sample"** button (selector: `button:has-text("Load sample")`)
   — OR in broker/sidebar mode, click the **"Demo session"** button
   (`[aria-label="Demo session"]`)
3. Wait for the context map to render (canvas elements appear + `[data-region]` sections)

> **Important:** Tiles in the default map view are **canvas-rendered**, not DOM
> elements. The `[data-id]` attribute only appears on interactive DOM elements
> in open-group bands and sliver mode — not on the default compressed tile grid.
> Verify tile rendering via `canvas` pixel presence and `[data-region]` sections.

### Stable selectors

Use these selectors in order of preference. They are maintained in the
codebase and unlikely to change:

| Element | Selector |
|---|---|
| Context map root | `[aria-label="Context map — arrow keys move between blocks"]` |
| **Canvas tiles** | `canvas` elements inside the map (tiles are **canvas-rendered**, not DOM) |
| Block tile (sliver/band mode only) | `[data-id]` (value = block ID) — only present in open groups/slivers |
| Group tile | `[data-group]` (value = group ID) |
| Folded summary | `[data-summary]` |
| Fold cluster | `.fold-cluster[data-cluster-ids]` |
| Older region | `[data-region="older"]` |
| Protected tail region | `[data-region="protected-tail"]` |
| Inspector close | `[aria-label="Close inspector"]` |
| Sidebar toggle | `[aria-label="Expand sidebar"]` / `[aria-label="Collapse sidebar"]` |
| Settings panel | `[aria-label="Settings"]` |
| Conductor menu | `[aria-label="Switch conductor"]` |
| Conductor list | `[role="menu"][aria-label="Conductors"]` |
| Steering toggle | `[aria-label="Apply folds to the live agent"]` |
| Budget control | `[aria-label="Context budget"]` |
| Composition bar | `[role="img"][aria-label="Context composition"]` |
| Port input (browser mode) | `[aria-label="pi port"]` |
| Demo session button | `[aria-label="Demo session"]` |
| PCC pill (inspector) | `[data-testid="pcc-pill"]` |
| Group member list | `[data-testid="group-member-list"]` |
| View toggle (map/transcript) | `.view-seg` or `SegControl` with map/transcript options |

### Driving recipes

**Load demo + verify map renders:**
```js
await page.goto("http://localhost:1420");
await page.click('button:has-text("Load sample")');
// Tiles are CANVAS-rendered — wait for canvas + region sections
await page.waitForSelector("canvas", { timeout: 10000 });
await page.waitForSelector('[data-region="older"]', { timeout: 5000 });
// Verify header shows block count
const header = await page.textContent('.topbar');
console.assert(header.includes('blocks'), "Header should show block count");
```

**Open inspector (canvas tiles need coordinate clicking):**
```js
// Canvas tiles require clicking at coordinates within the canvas
const canvas = await page.$('canvas');
const box = await canvas.boundingBox();
await page.mouse.click(box.x + 50, box.y + 20);
await page.waitForSelector('[aria-label="Close inspector"]', { timeout: 5000 });
```

**Toggle sidebar:**
```js
await page.click('[aria-label="Collapse sidebar"]');
await page.waitForSelector('[aria-label="Expand sidebar"]');
```

**Open conductor menu:**
```js
await page.click('[aria-label="Switch conductor"]');
await page.waitForSelector('[role="menu"][aria-label="Conductors"]');
```

---

## Evidence

Evidence goes to `.verification-skills/verify-accordion/evidence/` (create on
first run). Capture:

| What | How | Why |
|---|---|---|
| Screenshot after demo load | `page.screenshot({path: '...', fullPage: true})` | Proves the map rendered with real data |
| Screenshot of inspector | Screenshot after clicking a tile | Proves inspector shows block details |
| Tile count | `page.$$eval('[data-id]', els => els.length)` | Numeric proof the map populated |
| Console errors | Collect via `page.on('console', ...)` | Proves no runtime errors |
| Network log | Collect fetch of `/sample-session.jsonl` | Proves data loaded |

### Proof standards

- Exercise the real user path: navigate → load demo → interact with tiles.
  Do not inject state via JS or bypass the UI.
- Capture both the action (click) and the resulting state (screenshot +
  element presence), not just the final screen.
- Mocks: none needed for demo mode. The demo data is bundled. For live-session
  verification, a mock WebSocket server may be used since that's a production
  boundary.

---

## Cleanup

```bash
# Kill the dev server or broker you started (by PID, not by name)
# Remove evidence ONLY if explicitly requested — evidence survives cleanup by default
# The demo session leaves no side effects on disk
```

Cleanup removes only the instances started for this verification run. Evidence
in `.verification-skills/verify-accordion/evidence/` is **never deleted** by
cleanup.

---

## Helpers

### `run-all-tests.sh`

Run the full test suite (all three test runners):

```bash
#!/bin/bash
set -e
echo "=== Vitest (accordion engine + extension) ==="
cd extensions/accordion/app && npx vitest run && cd ../../..

echo "=== Node.js built-in tests (extensions/__tests__) ==="
node --import tsx/esm --test extensions/__tests__/*.test.ts

echo "=== TypeScript check ==="
npm run check
```

Invocation: `bash .verification-skills/verify-accordion/run-all-tests.sh`

### Quick unit test commands

```bash
# Accordion engine + extension tests (Vitest)
cd extensions/accordion/app && npx vitest run

# Extension lib tests (Node.js test runner)
node --import tsx/esm --test extensions/__tests__/*.test.ts

# TypeScript type check
npm run check
```

---

## Maintenance

Use `/maintain-verification-skill` to keep the feature map current as the app
evolves. Suggested cadence: after any PR that adds or changes a user-facing
feature.
