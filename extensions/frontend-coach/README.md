# frontend-coach

Two workflows in one extension:

1. **Click-to-edit** — open your app in any browser, press `Alt+P`, click an element, type an instruction, watch pi edit your source.
2. **Autonomous recorded tests** — after pi finishes a frontend change, it drives a controlled Edge tab via CDP (no permission prompts), records a `.webm` of the interaction, and writes a structured report you can replay later. Failures come back as a tool error so the agent fixes the code and re-records on its own.

```
# Workflow 1 (manual click → edit)
your browser ─── ws://localhost:7777 ───► pi

# Workflow 2 (autonomous test + video)
pi ── playwright/CDP ──► Edge (--remote-debugging-port=9222)
                  │
                  └── Page.startScreencast ── ffmpeg ──► .frontend-coach/records/*.webm
```

## Install

This extension lives in your `my-pi` package at `extensions/frontend-coach/`.
After cloning/pulling, install its deps (downloads `playwright-core` and a static `ffmpeg.exe`, ~90 MB total):

```bash
cd F:/MyWork/my-pi/extensions/frontend-coach
npm install
```

Restart pi (or `/reload`). The WS bridge is off by default so it does not reserve a port in normal Pi sessions. Start it only when needed with:

```text
/coach-on
```

You can opt back into startup binding with `FRONTEND_COACH_AUTO_START=1 pi`.

---

## Workflow 1 — click-to-edit

1. **Start the bridge** in pi:
   ```text
   /coach-on
   ```
2. **Open your app** in Chrome/Edge — e.g.
   `https://localhost:5050/user/<uuid>/aggregatedmessages`
3. **Inject the picker.** Easiest = bookmarklet. In pi:
   ```
   /coach-bookmarklet
   ```
   Copy the printed `javascript:…` URL, create a new bookmark with that as the URL, drag it to your bookmarks bar. Click the bookmark once per tab.
   (Alternative: in your dev build, add
   `if (import.meta.env.DEV) { const s=document.createElement('script'); s.src='http://localhost:7777/picker.js'; document.body.appendChild(s); }`
   to your entrypoint, and it auto-injects on every reload.)
4. **Pick + ask.** In the page:
   - Press `Alt+P` — the banner turns orange ("PICKING").
   - Hover to highlight, click an element.
   - Type your instruction in the prompt (e.g. *"make this heading larger and centered"*).
5. **pi receives a user message** with selector, outerHTML, computed styles, bounding rect and your instruction, and starts editing.

### Tools pi can call back into the page (workflow 1)

| Tool | Purpose |
|---|---|
| `browser_highlight(selector, color?)` | Briefly outline an element. Useful as "I'm about to change this — confirm?" |
| `browser_inspect(selector)` | Get outerHTML + computed styles + rect for any selector. |
| `browser_eval(expression)` | Evaluate a JS expression in the page (e.g. `document.title`). |

---

## Workflow 2 — autonomous recorded tests

Use this when you tell the agent something like:

> *"Implement a loading spinner on the Send button. After the change, run a `browser_record_test` to verify it works and record the video."*

### One-time setup per project

Launch a controlled Edge window. This is a separate profile under `./.frontend-coach/edge-profile/`, isolated from your normal Edge so the agent can't see your real cookies/extensions:

```text
/coach-launch-edge https://localhost:5050/user/<uuid>/aggregatedmessages
```

- The Edge window stays open across pi sessions (`/new`, `/resume`). Kill it explicitly with `/coach-stop-edge`.
- `/coach-edge-status` shows whether it's reachable.
- You can also set `FRONTEND_COACH_URL=https://...` and just run `/coach-launch-edge` with no args.
- Override the CDP port with `FRONTEND_COACH_CDP_PORT=9333` (default `9222`).
- Log into your app once in that Edge window — the session cookie sticks for next runs.

### The agent calls `browser_record_test`

New tool the LLM can invoke:

```jsonc
browser_record_test({
  "name": "Send button shows spinner while submitting",
  "url": "https://localhost:5050/chat",         // optional, defaults to current tab
  "relatedChange": "Web/src/Chat/SendButton.tsx — add <Spinner/> while isPending",
  "steps": [
    { "action": "fill",  "selector": "textarea[name=message]", "value": "hello" },
    { "action": "click", "selector": "button#send" },
    { "action": "wait",  "ms": 200 }
  ],
  "assertions": [
    { "description": "button shows spinner",     "expression": "document.querySelector('button#send .spinner') !== null" },
    { "description": "button is disabled",       "expression": "document.querySelector('button#send').disabled === true" }
  ]
})
```

Supported step actions: `click`, `dblclick`, `type`/`fill`, `press`, `hover`, `wait` (`ms`), `waitFor` (selector + optional `ms` timeout), `navigate` (`url`), `scroll` (selector, scrolls into view), `eval` (`expression`).

Each run writes three files to `./.frontend-coach/records/`:

```
2026-06-09_143022_send-button.webm   ← the actual screen recording
2026-06-09_143022_send-button.json   ← structured transcript (steps, console, network, assertions)
2026-06-09_143022_send-button.md     ← human-readable report
```

### How failures auto-fix

If any step or assertion fails, the tool returns `isError: true` with a compact failure summary (failed steps, failed assertions, console errors). The agent sees this in its tool result and will normally iterate — inspect the code, fix the bug, and call `browser_record_test` again — until it passes.

### Reviewing recordings

| Command | Purpose |
|---|---|
| `/coach-records` | List the latest recordings with pass/fail + paths |
| `/coach-record <id>` | Print the markdown report (paste the id from the list above) |
| `/coach-records-open` | Open `./.frontend-coach/records/` in your file explorer |

The `.webm` files play in any modern browser — just drag one onto an Edge/Chrome tab.

---

## Notes / gotchas

- **Workflow 1's `Alt+P` picker** uses your own browser; **workflow 2's recordings** use the dedicated Edge launched by `/coach-launch-edge`. They don't share state.
- **Mixed content** (workflow 1): `ws://localhost` is allowed from `https://localhost` in Chromium-based browsers (localhost is a secure context). Firefox is stricter — use Chrome/Edge, or upgrade the bridge to `wss://` with a self-signed cert.
- **Port** for the WS bridge defaults to `7777`. Override with `FRONTEND_COACH_PORT=17321 pi`.
- **CDP port** for workflow 2 defaults to `9222`. Override with `FRONTEND_COACH_CDP_PORT=9333`.
- **Edge path** auto-detected on Windows (Program Files / Program Files (x86) / LocalAppData) and macOS. Override with `FRONTEND_COACH_EDGE_PATH=C:\path\to\msedge.exe`.
- **ffmpeg** is bundled via `ffmpeg-static`. Override with `FRONTEND_COACH_FFMPEG=C:\path\to\ffmpeg.exe` if you prefer a system ffmpeg.
- **No "share this tab" prompt**: workflow 2 uses CDP, not `getDisplayMedia`, so it's silent.
- **Bound to `127.0.0.1`** — nothing exposed to your LAN.
- **Source-map hints** (workflow 1): if your build adds `data-source="file:line"` (e.g. via `@locator/runtime` or `vite-plugin-react-click-to-component`), the picker forwards it as `sourceFile` so pi jumps straight to the right file.

## Files

```
frontend-coach/
├── package.json
├── README.md
├── index.ts     ← pi extension entry (HTTP+WS server, tool/command wiring)
├── edge.ts      ← locate, launch, attach to Microsoft Edge via CDP
├── recorder.ts  ← drive page + pipe Page.screencastFrame into ffmpeg → webm
├── records.ts   ← on-disk record format (id, paths, markdown rendering)
└── picker.js    ← injected into your page (workflow 1 only)
```
