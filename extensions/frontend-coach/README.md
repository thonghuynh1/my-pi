# frontend-coach

Click any element in your browser, tell pi what to change, watch pi edit your source files.

```
browser tab ─── ws://localhost:7777 ───► pi (this extension)
                                              │
                                              └── pi.sendUserMessage(...)
                                                  pi edits files, etc.
```

## Install

This extension lives in your `my-pi` package at `extensions/frontend-coach/`.
After cloning/pulling, install its deps:

```bash
cd C:/my-pi/extensions/frontend-coach
npm install
```

Restart pi (or `/reload`). On startup you should see the status `waiting for browser…`.

## Use

1. **Open your app** in Chrome/Edge — e.g.
   `https://localhost:5050/user/<uuid>/aggregatedmessages`
2. **Inject the picker.** Easiest = bookmarklet. In pi:
   ```
   /coach-bookmarklet
   ```
   Copy the printed `javascript:…` URL, create a new bookmark with that as the URL, drag it to your bookmarks bar. Click the bookmark once per tab.
   (Alternative: in your dev build, add
   `if (import.meta.env.DEV) { const s=document.createElement('script'); s.src='http://localhost:7777/picker.js'; document.body.appendChild(s); }`
   to your entrypoint, and it auto-injects on every reload.)
3. **Pick + ask.** In the page:
   - Press `Alt+P` — the banner turns orange ("PICKING").
   - Hover to highlight, click an element.
   - Type your instruction in the prompt (e.g. *"make this heading larger and centered"*).
4. **pi receives a user message** with selector, outerHTML, computed styles, bounding rect and your instruction, and starts editing.

## Tools pi can call back into the page

| Tool | Purpose |
|---|---|
| `browser_highlight(selector, color?)` | Briefly outline an element. Useful as "I'm about to change this — confirm?" |
| `browser_inspect(selector)` | Get outerHTML + computed styles + rect for any selector. |
| `browser_eval(expression)` | Evaluate a JS expression in the page (e.g. `document.title`). |

## Notes / gotchas

- **Mixed content**: `ws://localhost` is allowed from `https://localhost` in Chromium-based browsers (localhost is a secure context). Firefox is stricter — use Chrome/Edge, or upgrade the bridge to `wss://` with a self-signed cert.
- **Port** defaults to `7777`. Override with env: `FRONTEND_COACH_PORT=17321 pi`.
- **Bound to `127.0.0.1`** — not exposed to your LAN.
- **Source-map hints**: if your build adds `data-source="file:line"` (e.g. via `@locator/runtime` or `vite-plugin-react-click-to-component`), the picker forwards it as `sourceFile` so pi jumps straight to the right file.
- **Multiple tabs** all connect at once; `browser_highlight` broadcasts to all of them.
- **Bookmarklet not running?** Open DevTools console, look for `[frontend-coach]` logs and any CSP errors (some apps block inline scripts; in that case use the dev-build injection method).

## Files

```
frontend-coach/
├── package.json
├── README.md
├── index.ts    ← pi extension (HTTP + WS server, tools, command)
└── picker.js   ← injected into your page
```
