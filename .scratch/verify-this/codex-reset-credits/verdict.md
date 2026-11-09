# Verdict: Codex reset credits

## C1 — VERIFIED

- **Metric:** exact detail content and compact Codex-row count, compared to the two `rate_limit_reset_credits` fields of the live usage response.
- **Baseline value:** detail string absent; `resets 0` absent from all six captured renders. Live usage GET returned 200, with `available_count=0` and `applicable_available_count=0`.
- **Treatment value:** detail content `  Reset credits: 0 available · 0 applicable` and Codex compact row `resets 0` present; live usage GET returned 200 and independently captured the same two counts, 0 and 0. `codex.ts` maps those response fields into the parser; the real monitor and renderer consumed the result.
- **Threshold:** both strings absent at baseline and present with values matching the live fields at treatment.
- **Evidence:** `baseline/02-detail.json`, `baseline/01-summary.json`, `treatment/02-detail.json`, `treatment/01-summary.json`, both `usage-counts.json` and `requests.json`.

## C2 — VERIFIED

- **Metric:** reset inventory GET count after `x`/Enter, rendered state, and baseline visual equality.
- **Baseline value:** 0 inventory GETs; `03-summary-before-x.json`, `04-after-x.json`, and `06-after-enter-settled.json` are identical; no reset flow.
- **Treatment value:** `x` displayed `Choose a Codex account`; Enter issued exactly 1 inventory GET, HTTP 200; immediate render showed loading and settled render showed `No reset credits available.`
- **Threshold:** baseline unchanged with 0 inventory requests; treatment exactly 1 inventory GET and the stated settled message.
- **Evidence:** `baseline/requests.json`, `baseline/03-summary-before-x.json`, `baseline/04-after-x.json`, `baseline/06-after-enter-settled.json`, `treatment/requests.json`, `treatment/04-after-x.json`, `treatment/05-after-enter-immediate.json`, `treatment/06-after-enter-settled.json`.

## C3 — VERIFIED

- **Metric:** POST and other non-GET calls observed by the global fetch recorder during these in-process runs.
- **Baseline value:** 0 POST, 0 non-GET; 1 GET to usage.
- **Treatment value:** 0 POST, 0 non-GET; 1 GET to usage and 1 GET to reset inventory.
- **Threshold:** 0 POST in both runs; any non-GET would be blocked before network transmission and abort the run.
- **Evidence:** both `requests.json`; the harness additionally restricts requests to the two expected URLs. No `y` was sent.

## Confounds and limits

- Real objects and real network were exercised **in-process, not in a real terminal**. Actual Pi command registration, live overlay placement, terminal key delivery/encoding, painting/scrolling at other terminal dimensions, and terminal-specific behaviour remain unproven.
- Only one built-in Codex account/reader was included; other providers, multiple Codex slots, and live OAuth refresh through the model registry were not exercised. The harness directly read the current unexpired token as requested.
- Baseline and treatment are sequential live observations, not the same response replayed; account state or time could change between them. The two count fields happened to be zero in both responses. The code path and independent same-run count capture support the mapping.
- With zero inventory and no `y`, this proves the safe discovery/no-credit path, **not** credit selection, confirmation, POST execution, actual reset, or credit consumption. No credit was consumed in these runs.
- The recorder observes `globalThis.fetch`, not arbitrary external process or OS network traffic; the tested Codex-only path uses fetch and does not launch provider CLIs. No unrelated provider reads were attempted.
