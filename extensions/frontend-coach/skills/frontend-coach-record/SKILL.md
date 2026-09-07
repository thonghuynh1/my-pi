---
name: frontend-coach-record
description: "Use when recording a frontend-coach browser test, targeting page elements, or choosing between a11y refs and CSS selectors. Covers browser_record_test refs (e12 style), CSS fallback, Radix Dialog + React Hook Form fills, setInputFiles, /coach-launch-edge, and the trace.zip next to the ffmpeg webm."
---

Drive the Edge tab already launched by `/coach-launch-edge`. Do not start a Playwright browser server. Do not add Playwright MCP `browser_*` tools. The existing coach tools are the whole agent API. Playwright CLI remains the preferred way to *navigate* a headed session; `browser_record_test` is the widget recorder (Edge CDP, webm+json+md).

## Target by snapshot ref, CSS as fallback

`browser_record_test` stamps a Playwright AI aria snapshot before it runs steps. Interactive nodes look like `[ref=e12]`. Pass that ref on the step:

```
{ "action": "click", "ref": "e12" }
{ "action": "fill", "ref": "e5", "value": "hello" }
```

CSS `selector` still works when you already have a stable locator (widget `mountSelector`, `data-testid`). If both are set, `ref` wins. `coach_resolve_widget` / `browser_record_for_widget` auto-steps keep using CSS. Locators prefer the match inside an open `role=dialog` (Radix portal).

Refs are for this page load. Passing `url` navigates and invalidates them. After you have a snapshot, call `browser_record_test` again with those refs and omit `url` so you keep the current tab. Refs look like `e12` on the top-level page and `f1e2` inside an iframe.

## React Hook Form + Radix Dialog (create / create-with-document)

`page.fill` / `locator.fill` update React Hook Form. `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set` + `dispatchEvent` does **not** — the DOM can look filled while RHF stays invalid and submit stays disabled.

Do not use `eval` to fill fields or to fake a file with `DataTransfer`. The recorder already:

1. Fills through Playwright (force-fill when the Radix backdrop intercepts pointer events).
2. Clicks by disabling overlay `pointer-events` at the hit point, then clicking for real.
3. Attaches files with `locator.setInputFiles` on the real `input[type=file]`, even if it is visually hidden.

Create-with-document script:

```
{ "action": "click", "selector": "<New / Create trigger>" }
{ "action": "waitFor", "selector": "[role=dialog]", "ms": 8000 }
{ "action": "fill", "selector": "[role=dialog] input[name=title]", "value": "coach create" }
{ "action": "setInputFiles", "selector": "[role=dialog] input[type=file]", "fileName": "note.txt", "fileContent": "hello", "mimeType": "text/plain" }
{ "action": "click", "selector": "[role=dialog] button[type=submit]" }
```

Then assert the documented success signal (new row, count bump, toast). Prefer `fill` over `type`; both go through Playwright `locator.fill`.

Optional `force: true` on a step skips the first unforced attempt when you already know the overlay will intercept.

## What a run writes

Same id, under `./.frontend-coach/records/`:

- `{id}.webm` ffmpeg screencast via CDP (unchanged)
- `{id}.trace.zip` Playwright trace of the same session
- `{id}.json` / `{id}.md` report, including the a11y snapshot

On failure the tool returns `isError: true`. Fix the app, record again.

## Keep using

- Alt+P picker in the controlled Edge
- Isolated profile under `.frontend-coach/edge-profile/`
- playwright-core over CDP 9222
- `/coach-launch-edge` as the daemon
