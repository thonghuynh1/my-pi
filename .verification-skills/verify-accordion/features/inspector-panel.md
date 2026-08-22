# Inspector Panel

A slide-in detail panel on the right side of the canvas that shows metadata
and content for a selected block or group.

## Sub-features

- **Block inspector** — shows block ID, role, token count, content preview,
  fold status. Opened by clicking a tile in the canvas (coordinate-based click
  since tiles are canvas-rendered, not DOM nodes).
- **Group inspector** — shows group members (`[data-testid="group-member-list"]`),
  combined token count. Opened by clicking `[data-group]` tiles.
- **PCC pill** — `[data-testid="pcc-pill"]` badge shown for proactively
  compressed blocks.
- **Close button** — `[aria-label="Close inspector"]` dismisses the panel.
- **Double-click fold/unfold** — double-clicking a tile toggles its fold state
  (live sessions only).

## How to get to it (user POV)

1. Have a session loaded (demo or live)
2. Click any colored tile in the context map
3. The inspector slides in from the right

## Driving it with Playwright

```js
// Prerequisite: demo loaded, canvas visible
// Tiles are canvas-rendered — click at coordinates within the canvas
const canvas = await page.$('canvas');
const box = await canvas.boundingBox();
await page.mouse.click(box.x + 50, box.y + 20);

// Wait for inspector to open
await page.waitForSelector('[aria-label="Close inspector"]', { timeout: 5000 });

// Verify content is shown (inspector has text)
const inspectorText = await page.$eval(".inspector", el => el.textContent);
console.assert(inspectorText.length > 0, "Inspector should show content");

// Check for group member list if a group tile was clicked
// const members = await page.$('[data-testid="group-member-list"]');

// Close inspector
await page.click('[aria-label="Close inspector"]');
await page.waitForSelector('[aria-label="Close inspector"]', { state: 'hidden', timeout: 3000 });

// Capture evidence
await page.screenshot({ path: "evidence/inspector-open.png" });
```

## Gotchas

- The inspector animates in (CSS transition). Wait for the close button to be
  visible before asserting content.
- Double-click fold/unfold only works with live sessions, not demo mode.
- Clicking a different tile while the inspector is open switches the detail
  view without closing/reopening — no need to close first.
