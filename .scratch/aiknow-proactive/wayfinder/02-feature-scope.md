# 02 — Feature scope and release boundary

Type: grilling
Status: resolved
Blocked by: 01

## Question

Given the 7 features in the scratch file and the benchmark data, which features belong in the MVP release vs. follow-up? The scratch file suggests a priority order (hook+ranking first, then map, then nudges, then cards) — but the PRD needs a firm cut line.

Specifically:
- Is the walking skeleton "hook + file ranking" alone (Feature 2+3)?
- Does the codebase map (Feature 1) ship in the same release or is it a fast-follow?
- Are escalation nudges (Feature 5) part of MVP or nice-to-have?
- Is "recently changed files" (Feature 7) trivial enough to always include?

The answer determines the PRD's user stories and what `to-issues` will slice.

## Answer

**All 7 features ship in one PRD.** Scope:

- **Walking skeleton**: F2 (file ranking) + F3 (hook wiring) + F7 (recently-changed files) — thinnest end-to-end proof that proactive injection works
- **Same release**: F1 (codebase map), F4 (token-saved estimates), F5 (escalation nudges), F6 (wiring cards)
- **Nothing deferred** — the full feature set is in scope

`to-issues` will slice vertically; the walking skeleton becomes the first tracer-bullet issue.
