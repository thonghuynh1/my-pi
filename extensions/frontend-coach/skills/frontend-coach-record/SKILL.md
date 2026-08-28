---
name: frontend-coach-record
description: "Use when recording a frontend-coach browser test, targeting page elements, or choosing between a11y refs and CSS selectors. Covers browser_record_test refs (e12 style), CSS fallback, /coach-launch-edge, and the trace.zip next to the ffmpeg webm."
---

Drive the Edge tab already launched by `/coach-launch-edge`. Do not start a Playwright browser server. Do not add Playwright MCP `browser_*` tools. The existing coach tools are the whole agent API.

## Target by snapshot ref, CSS as fallback

`browser_record_test` stamps a Playwright AI aria snapshot before it runs steps. Interactive nodes look like `[ref=e12]`. Pass that ref on the step:

```
{ "action": "click", "ref": "e12" }
{ "action": "fill", "ref": "e5", "value": "hello" }
```

CSS `selector` still works when you already have a stable locator (widget `mountSelector`, `data-testid`). If both are set, `ref` wins. `coach_resolve_widget` / `browser_record_for_widget` auto-steps keep using CSS.

Refs are for this page load. After navigation or a DOM rewrite, read the snapshot from that run's tool result and use the new refs on the next call.

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
