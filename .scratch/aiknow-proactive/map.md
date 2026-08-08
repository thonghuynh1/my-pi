# aiKnow Proactive Context Injection — Wayfinder Map

Status: ready-for-agent

## Destination

A decision-complete handoff (`READY_FOR_PRD`) that `to-prd` can consume to produce an implementation-ready PRD for aiKnow Proactive Context Injection — the feature set that closes the 6% token/quality gap against Graft by injecting a codebase map, query-aware file ranking, and escalation nudges before/during agent sessions.

## Notes

- Domain: Pi coding-agent extensions, aiKnow indexing engine
- Source material: `.scratch/aiknow-proactive-context-handoff.md` (benchmark data + feature sketches)
- Target codebase: `F:/MyWork/aiKnow/integrations/pi/aiknow/index.ts` + `F:/MyWork/aiKnow/src/core/`
- Skills to consult: `/grill-with-docs`, `/domain-modeling`
- The PRD must be compatible with `to-prd` template and feed into `to-issues` for vertical slicing
- Standing preference: features should be independently shippable; the PRD should support incremental delivery

## Decisions so far

- [Does Pi's `before_agent_start` hook exist today?](wayfinder/01-pi-hook-exists.md) — Yes, fully typed and available. Returns `{ systemPrompt }` (chainable) or `{ message }` (persistent). Event exposes `prompt`, `systemPrompt`, and `cwd` via `systemPromptOptions`. Zero hooks used by aiKnow today; implementation is straightforward.
- [Feature scope and release boundary](wayfinder/02-feature-scope.md) — All 7 features in one PRD. Walking skeleton = F2+F3+F7 (hook + file ranking + recent changes). F1, F4, F5, F6 ship same release.
- [Timeout, failure, and unindexed repo behavior](wayfinder/03-timeout-failure-behavior.md) — Unindexed repos: silently skip. Stale index: detect → sync → inject fresh (sequential). Partial timeout: all-or-nothing (add telemetry). Large repos: cache `buildCodebaseMap` to disk at index/sync time.
- [Codebase map format and token budget](wayfinder/04-map-format-token-budget.md) — Graft-style one-liner-per-dir format. No hard token cap (format is the constraint, scales with repo). Pure in-degree for hub selection (recency separate via Feature 7). 2-level depth, subdirs shown when hubs ≥ 5 in-degree.
- [File ranking confidence and presentation](wayfinder/05-file-ranking-decisions.md) — Keep spread formula, always show 8 results with confidence label (never suppress). Format: `file:line — Symbol (kind)`. Always attempt ranking on any query (confidence label handles vague inputs). No reactive search coupling in v1; rely on prompt visibility.
- [Escalation nudge triggers and wording](wayfinder/06-escalation-nudge-decisions.md) — Trigger on ≤2 results only (no confidence-based path). Prescriptive wording. Zero-result nudge mentions unindexed possibility and interpolates the search term. No cross-referencing with proactive map; nudges are self-contained.
- [Acceptance criteria and benchmark targets](wayfinder/07-acceptance-criteria.md) — AC covers code correctness only (features work, env var gating works, silent skip on unindexed). Benchmark targets (≥−30%, ≥7.5/8, ≤15 calls) are reference context for the human reviewer who runs and judges the benchmark.
- [Token-saved estimates placement and format](wayfinder/09-token-estimates-decisions.md) — Calculation in aiKnow core engine (structured fields: `tokensSaved`, `tokensSavedPercent`, `filesAvoided`). Always returned. 4 chars/tok approximation. Consumers format their own display.

## Not yet specified

(empty)

## Out of scope

- Changes to Pi's core extension API (we consume what exists)
- Graft itself (competitor, not a dependency)
- Prepass tool (competitor, not a dependency)
- Benchmark framework changes (we add a profile, not rewrite the harness)
- [Wiring cards storage and generation strategy](wayfinder/08-wiring-cards-strategy.md) — Feature 6 (per-file cards) subsumed by Features 2 (codebase map) + 3 (aiknow_search); defer to post-launch benchmark evidence
- Benchmark integration — out of scope for this effort; will be done separately against benchmark repos post-implementation
