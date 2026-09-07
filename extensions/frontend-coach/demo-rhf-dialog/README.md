# Coach RHF + Radix Dialog demo

Small Vite + React app that reproduces the frontend-coach **create-with-document** failure mode:

- React Hook Form: required title + required file; **Create** stays disabled until both are valid
- Radix Dialog portal whose overlay sits *above* the dialog (`z-index` + `pointer-events: auto`) and intercepts clicks
- Hidden `input[type=file]`
- Activities list starts at **1**; a successful create appends a row and bumps the count to **2**
- Success row text: `Coach create (note.txt)`

This is a fixture, not a product shell.

## Run the app

From this directory:

```bash
npm install
npm run dev
```

Opens at **http://127.0.0.1:5173**.

**Broken: native setter** (on the main page — the overlay would intercept a button inside the dialog) opens the dialog and runs the eval-style `HTMLInputElement.prototype.value` setter. The title *looks* filled; Create stays disabled.

Blind eval snippet (same failure):

```js
const el = document.querySelector("#title");
Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "from-eval");
el.dispatchEvent(new Event("input", { bubbles: true }));
```

Do not fake files with `DataTransfer` + `dispatchEvent("change")`. Use Playwright / `browser_coach_act` `setInputFiles` on `#file`.

## Automated prove

Needs Chromium at `/usr/bin/google-chrome` (or `FRONTEND_COACH_EDGE_PATH`) and deps in **both** this folder and `extensions/frontend-coach` (`peek.ts` / `playwright-core`).

```bash
# from this folder
npm install
npm install --prefix ..
npm test
```

Or from `extensions/frontend-coach`:

```bash
npm install
npm install --prefix demo-rhf-dialog
npm test
```

The prove launches Vite + Chromium (playwright-core, no live Pi Edge) and checks:

1. Native prototype setter fills the DOM but does **not** enable Create (even after a real file attach).
2. A naive Playwright click on Create is intercepted by the Radix overlay.
3. Peek-style flow: aria snapshot → click **New activity** → `fill` title → `setInputFiles` → submit → count **1→2** and row `Coach create (note.txt)`.
4. The happy path steps do **not** include `eval`.

## Coach manual verify (peek tools)

Peek tools (`browser_coach_snapshot` / `browser_coach_act`) ship with frontend-coach on main after PR #5; until then they live on `cursor/frontend-coach-peek-tools-3b7b`.

With the demo running on 5173:

```text
/coach-launch-edge http://localhost:5173
```

Then, in order:

1. `browser_coach_snapshot` — copy refs such as `e12` from the a11y tree.
2. `browser_coach_act` — open the dialog, fill, attach, submit (max 12 steps):

```jsonc
{
  "steps": [
    { "action": "click", "selector": "#new" },
    { "action": "waitFor", "selector": "[role=dialog]", "ms": 4000 },
    { "action": "fill", "selector": "#title", "value": "Coach create" },
    { "action": "setInputFiles", "selector": "#file", "fileName": "note.txt", "fileContent": "hello coach", "mimeType": "text/plain" },
    { "action": "click", "selector": "#submit" }
  ]
}
```

3. `browser_record_test` — **omit `url`** so peek refs stay valid; assert count `2` and `Coach create (note.txt)`.

Passing `url` on record navigates and invalidates refs.

## A/B: blind record vs peek-first

| | Blind record | Peek-first |
|---|---|---|
| How | Guess selectors from JSX; on overlay timeout, `eval` a native value setter / `DataTransfer` | `browser_coach_snapshot` → `browser_coach_act` (`fill` + `setInputFiles`) → `browser_record_test` (omit `url`) |
| Overlay | Click hits the backdrop; agent “fixes” it with eval | Portal-actions pierce the overlay and force-fill |
| RHF | DOM looks filled; Create stays disabled | Playwright InputEvents commit the Controller; Create enables |
| File | Fake `input.files` does not update RHF | `setInputFiles` on the hidden input |
| Result | Count stays **1** | Count **2**, row `Coach create (note.txt)` |
