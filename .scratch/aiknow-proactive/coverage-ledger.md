# Coverage Ledger — aiKnow Proactive Context Injection

## User Stories

| ID | Description | State | Owner | Proving Criterion |
|----|-------------|-------|-------|-------------------|
| US-001 | Codebase map visible to agent | covered by issue | `02-codebase-map-with-cache.md` | "Map appears in proactive injection block" |
| US-002 | Query-aware file ranking | covered by issue | `01-walking-skeleton-hook-ranking-recent.md` | "Hook registered and injects ranked files" |
| US-003 | Recently-changed files | covered by issue | `01-walking-skeleton-hook-ranking-recent.md` | "Recently-changed files returned from git diff" |
| US-004 | Token-saved estimates | covered by issue | `03-token-save-v2.md` | "Token estimates returned on every search response" |
| US-005 | Escalation nudges | covered by issue | `04-escalation-nudges.md` | "Zero-result searches get interpolated nudge" |
| US-006 | Env var disable | covered by issue | `01-walking-skeleton-hook-ranking-recent.md` | "Env var AIKNOW_PROACTIVE=0 disables all injection" |

## Required Behaviors

| ID | Description | State | Owner | Proving Criterion |
|----|-------------|-------|-------|-------------------|
| RB-001 | AIKNOW_PROACTIVE=0 short-circuits | covered by issue | `01-walking-skeleton-hook-ranking-recent.md` | "Env var AIKNOW_PROACTIVE=0 disables all injection" — getServer never called |
| RB-002 | Unindexed repo → silent {} | covered by issue | `01-walking-skeleton-hook-ranking-recent.md` | "Unindexed repo returns empty silently" — no error, no log |
| RB-003 | Stale index → ensureFresh | covered by issue | `01-walking-skeleton-hook-ranking-recent.md` | "Stale index triggers ensureFresh before ranking" — ensureFresh called before runSearch |
| RB-004 | Failure → all-or-nothing {} | covered by issue | `01-walking-skeleton-hook-ranking-recent.md` | "All-or-nothing: failure in any branch returns empty" — error → {} |
| RB-005 | Codebase map cached to disk | covered by issue | `02-codebase-map-with-cache.md` | "Cache written to disk" + "Cache invalidated after sync" |
| RB-006 | Token estimates on every response | covered by issue | `03-token-save-v2.md` | "Token estimates returned on every search response" — present even when 0 |
| RB-007 | Escalation nudge on ≤2 results | covered by issue | `04-escalation-nudges.md` | "Zero-result searches get nudge" + "1–2 results get nudge" + "3+ no nudge" |

## Accepted Decisions

| ID | Description | State | Owner | Proving Criterion |
|----|-------------|-------|-------|-------------------|
| DEC-001 | before_agent_start hook mechanism | covered by issue | `01-walking-skeleton-hook-ranking-recent.md` | Hook registered and produces systemPrompt |
| DEC-002 | All features in one PRD, skeleton F2+F3+F7 | covered by issue | `01-walking-skeleton-hook-ranking-recent.md` | Walking skeleton exercises full pipeline |
| DEC-003 | Unindexed/stale/failure/cache behavior | covered by issue | `01-*` (skip/stale/failure) + `02-*` (cache) | RB-001/002/003/004 criteria + cache write/invalidate criteria |
| DEC-004 | Codebase map format | covered by issue | `02-codebase-map-with-cache.md` | "one-liner-per-dir format with hub annotations" + "2-level depth" |
| DEC-005 | File ranking confidence/presentation | covered by issue | `01-walking-skeleton-hook-ranking-recent.md` | "Confidence classification is correct per spread formula" |
| DEC-006 | Escalation nudge triggers/wording | covered by issue | `04-escalation-nudges.md` | Zero-result template with interpolation + ≤2 trigger |
| DEC-007 | AC scope (code correctness only) | covered by issue | All issues | All AC test code behavior, none test benchmark performance |
| DEC-008 | Token estimates in core engine | covered by issue | `03-token-save-v2.md` | "Calculates using 4 chars/tok" + "present even when 0" |
| DEC-009 | Wiring cards out of scope | deferred/out of scope | N/A | Explicitly excluded per PRD |

## Area Edits

| Area | State | Owner |
|------|-------|-------|
| Hook Wiring & Orchestration | covered by issue | `01-walking-skeleton-hook-ranking-recent.md` |
| Codebase Map | covered by issue | `02-codebase-map-with-cache.md` |
| File Ranking | covered by issue | `01-walking-skeleton-hook-ranking-recent.md` |
| Recently-Changed Files | covered by issue | `01-walking-skeleton-hook-ranking-recent.md` |
| Token-Saved Estimates | covered by issue | `03-token-save-v2.md` |
| Escalation Nudges | covered by issue | `04-escalation-nudges.md` |
| Proactive Block Formatter | covered by issue | `01-walking-skeleton-hook-ranking-recent.md` (created) + `02-*` (extended with map section) |

## Test Seams

| Test File | State | Owner |
|-----------|-------|-------|
| `src/test/pi-proactive-injection.test.ts` | covered by issue | `01-*` (created) + `02-*` (extended) |
| `src/test/proactive-file-ranking.test.ts` | covered by issue | `01-walking-skeleton-hook-ranking-recent.md` |
| `src/test/proactive-recent-changes.test.ts` | covered by issue | `01-walking-skeleton-hook-ranking-recent.md` |
| `src/test/proactive-codemap.test.ts` | covered by issue | `02-codebase-map-with-cache.md` |
| `src/test/proactive-token-estimates.test.ts` | covered by issue | `03-token-save-v2.md` |
| `src/test/proactive-escalation-nudge.test.ts` | covered by issue | `04-escalation-nudges.md` |
| `src/test/proactive-formatter.test.ts` | covered by issue | `01-*` (basic) — formatter tested via integration test |

## Blocking Edges

| Edge | Producer | Consumer | Contract | Proven By |
|------|----------|----------|----------|-----------|
| Hook + formatter infrastructure | `01-*` | `02-*` | `formatProactiveBlock(map, ...)` accepts non-null map; Promise.all slot available | `02-*` AC: "Map appears in proactive injection block" |

## Wiring Notes

| Mechanism | State | Owner |
|-----------|-------|-------|
| `src/core/proactive/index.ts` barrel | covered by issue | `01-walking-skeleton-hook-ranking-recent.md` |
| `.aiknow/cache/` directory creation | covered by issue | `02-codebase-map-with-cache.md` |
| Cache invalidation after sync | covered by issue | `02-codebase-map-with-cache.md` |
| `AIKNOW_PROACTIVE` env var | covered by issue | `01-walking-skeleton-hook-ranking-recent.md` |

## Out of Scope (intentional deferrals)

- DEC-009: Wiring cards (Feature 6) — subsumed by map + ranking
- Benchmark integration — human-run, not in CI
- Reactive search coupling — deferred to post-benchmark
- Automated performance gates — DEC-007 excludes

## Coverage gaps

None.
