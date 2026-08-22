# Context Map

The primary visualization: a tile grid showing every block in the Pi agent's
context window, color-coded by role (system, human, assistant, tool). Blocks
are grouped into message groups. Folded blocks show as compressed summaries.

## Sub-features

- **Tile grid view** — default view, blocks rendered on **HTML canvas** elements
  (not DOM nodes), arranged in regions (older → pre-group → protected tail).
  `[data-id]` attributes only appear in sliver/open-group-band mode, not the
  default compressed view.
- **Transcript view** — alternative linear text view of the same blocks
- **View toggle** — switch between map and transcript via segmented control
- **Region sections** — `[data-region="older"]`, `[data-region="pre-group"]`,
  `[data-region="protected-tail"]`
- **Fold clusters** — `.fold-cluster[data-cluster-ids]` groups of folded blocks
- **Keyboard navigation** — arrow keys move between blocks (role="toolbar")
- **Composition bar** — `[role="img"][aria-label="Context composition"]` shows
  token distribution by role

## How to get to it (user POV)

1. Open the Accordion dashboard (`http://localhost:1420` or broker URL)
2. Load a session (demo, file, or live Pi connection)
3. The context map fills the main canvas area automatically

## Driving it with Playwright

```js
// Load demo data first
await page.goto("http://localhost:1420");
await page.click('button:has-text("Load sample")');

// Tiles are CANVAS-rendered — wait for canvas + region sections
await page.waitForSelector("canvas", { timeout: 10000 });
await page.waitForSelector('[data-region="older"]', { timeout: 5000 });

// Verify header shows block count and model info
const header = await page.textContent('.topbar');
console.assert(header.includes('blocks'), "Header should show block count");

// Check composition bar
const comp = await page.$('[aria-label="Context composition"]');
console.assert(comp, "Composition bar should exist");

// Capture screenshot
await page.screenshot({ path: "evidence/context-map.png", fullPage: true });
```

## Gotchas

- The map uses `TileCanvas` Svelte components that render to `<canvas>` elements
  asynchronously. Wait for `canvas` + `[data-region]` selectors, not `[data-id]`.
- To click a specific tile, use coordinate-based clicking within the canvas
  bounding box.
- The demo session has 982 blocks — the header shows the count.
- Arrow-key navigation requires the map root to have focus first.
- Fold clusters are only visible if a conductor has run; in demo mode without
  steering, all blocks may be unfolded.
