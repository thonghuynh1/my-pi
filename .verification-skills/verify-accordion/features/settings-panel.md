# Settings Panel

Application settings dialog for configuring display and behavior preferences.

## Sub-features

- **Settings button** — gear icon in the sidebar, opens the settings panel
  (`[aria-label="Settings"]`).
- **Display preferences** — theme, font size, tile density, and other visual
  settings.
- **Conductor defaults** — default conductor selection and budget.
- **Connection settings** — default port, auto-connect behavior.

## How to get to it (user POV)

1. Click the gear icon in the sidebar (bottom of the session rail)
2. The Settings panel opens as a dialog/overlay

## Driving it with Playwright

```js
// Open settings
await page.click('[aria-label="Settings"]');

// Verify settings panel opened — look for settings-specific content
// (The exact content depends on current implementation)
await page.waitForTimeout(500); // allow animation

// Capture evidence
await page.screenshot({ path: "evidence/settings-panel.png" });

// Close by clicking outside or pressing Escape
await page.keyboard.press("Escape");
```

## Gotchas

- The settings panel may be implemented as a modal or slide-in panel — check
  for visibility rather than DOM presence.
- Settings are persisted in localStorage; clearing storage resets to defaults.
- Some settings only take effect on the next session load.
