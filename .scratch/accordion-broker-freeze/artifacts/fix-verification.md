# Accordion structural rerun fix verification

## Red tests

Before the store change:

```text
conductor.test.ts
Tests 2 failed | 50 passed

expected conductCalls 1, received 2
expected conductCalls 2, received 3
```

The async-upgrade regression also failed before its implementation:

```text
Tests 1 failed | 52 passed
expected conductCalls 3, received 2
```

## Green tests

```text
npx vitest run src/lib/engine/conductor.test.ts
Tests 53 passed

npx vitest run src/lib/engine/store.host.test.ts src/lib/engine/conductor.test.ts
Tests 88 passed
```

Root TypeScript check passed.

Accordion app `npm run check` passed with existing Svelte accessibility warnings.

Accordion app `npm run build` passed and wrote the static site to `extensions/accordion/app/build`.

## Full suite

Before the fix, the unfiltered Vitest run did not terminate within 900 seconds because it reached the rerun loop.

After the fix, the suite terminates in about 38 seconds:

```text
1009 passed
8 failed
1017 total
```

All eight failures reproduce when their files run against the unmodified store. They are existing branch failures in chunked-compaction diagnostics, conductor status expectations, a protected pair-boundary expectation, and the authoritative Pre-Group rollover expectation. The JSON report is `full-suite-after-fix.json`.

## Live browser

A fresh Playwright Chromium process loaded the rebuilt broker dashboard against the same live session:

```json
{
  "ok": true,
  "url": "http://127.0.0.1:62534/",
  "elapsedMs": 6410,
  "before": {
    "title": "Accordion",
    "readyState": "complete",
    "bodyLength": 633,
    "scrollY": 0
  },
  "after": {
    "title": "Accordion",
    "readyState": "complete",
    "bodyLength": 633,
    "scrollY": 0,
    "hasSession": true
  }
}
```

The broker reported the tested session at 230,995 tokens with a 272,000-token model context window. The page remained responsive through navigation, a three-second settle, DOM evaluation, wheel input, and a second DOM evaluation.

Artifacts:

- `live-browser-verification.json`
- `live-browser-verification.png`
- `verify-live-browser.mjs`
- `check-build.log`
- `root-check.log`
