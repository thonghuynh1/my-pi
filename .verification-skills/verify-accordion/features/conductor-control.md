# Conductor Control

Switch between fold-planning algorithms (conductors) and adjust the context
budget. The conductor determines which blocks get folded to stay within budget.

## Sub-features

- **Conductor menu** — `[aria-label="Switch conductor"]` button opens a popover
  menu (`[role="menu"][aria-label="Conductors"]`) listing available conductors.
- **Budget slider** — `[aria-label="Context budget"]` lets the user set the
  target context-window size.
- **Steering toggle** — `[aria-label="Apply folds to the live agent"]` enables/
  disables live fold application to the Pi session.
- **MapHeader** — the header bar above the context map containing the budget
  visualization, conductor name, and steering controls.
- **Conductor activity panel** — shows real-time conductor decision log when
  expanded (via nav button in topbar).

## How to get to it (user POV)

1. Load a session (demo or live)
2. The MapHeader appears above the context map with the current conductor name
3. Click the conductor name to open the menu
4. Click a different conductor to switch
5. Adjust the budget slider to change target size

## Driving it with Playwright

```js
// Prerequisite: demo loaded, map visible

// Open conductor menu
await page.click('[aria-label="Switch conductor"]');
await page.waitForSelector('[role="menu"][aria-label="Conductors"]', { timeout: 5000 });

// List available conductors
const conductors = await page.$$eval('[role="menu"][aria-label="Conductors"] [role="menuitem"]',
  items => items.map(el => el.textContent.trim()));
console.log("Available conductors:", conductors);
console.assert(conductors.length > 0, "Should have at least one conductor");

// Click first conductor to select it (or click away to close)
await page.keyboard.press("Escape");

// Check budget control exists
const budget = await page.$('[aria-label="Context budget"]');
console.assert(budget, "Budget control should be present");

// Capture evidence
await page.screenshot({ path: "evidence/conductor-menu.png" });
```

## Gotchas

- The conductor menu uses `role="menuitem"` for each option — use that selector
  to enumerate choices.
- Switching conductors triggers a re-fold of the entire session, which may take
  a moment for large sessions. Wait for tile re-render.
- The steering toggle is only meaningful in live sessions — in demo mode it's
  visible but has no external effect.
- Budget slider behavior depends on the active conductor.
