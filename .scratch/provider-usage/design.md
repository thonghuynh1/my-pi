# Provider usage — proposed implementation walkthrough

Planning artifact. User decisions D1–D13 accepted; operational defaults and implementation shape D14–D15 awaiting final walkthrough confirmation in ledger.md. No implementation authorization in this planning session.

## Goal and scope
Account usage for existing Codex, Antigravity and GitHub CLI logins; persistent right-column footer under model plus on-demand details. Direct Claude.ai and Muse excluded. Account usage is separate from local-session estimated cost/tokens; no combined provider balance.

## End-to-end flow
TUI session_start -> monitor refresh -> independent provider processes -> normalize snapshots -> cached state -> requestRender -> existing usage-footer.
5-minute timer or detail-panel Refresh -> same coalesced refresh path.
session_shutdown/reload/footer off -> cancel timer, abort readers, close/kill owned child processes. No reads from render and no new work from repeated footer installation.

## Existing owner and new seam
- `extensions/usage-footer.ts::usageFooter` owns registrations and monitor lifetime.
- Existing `installUsageFooter` consumes monitor snapshots; creates the renderer and captures `tui.requestRender`. Reinstallation replaces subscription/render callback without spawning another monitor/timer. Renderer dispose must not accidentally stop a session monitor that a new renderer will reuse.
- Existing `getTokenTotals` retains session + subagent cost accounting; remove `getSubagentLine` status display only.
- Existing managed `registerCommand` mechanism registers `/provider-usage`, preserving capabilityVisibility behavior under extension id usage-footer; `/usage-footer on|off` remains supported.
- Proposed helper `extensions/lib/provider-usage/` exports small monitor interface: refresh (coalesced per provider), current snapshots/subscription, stop (idempotent). Constructor accepts process runner and clock/timer dependencies; tests and production use same interface.
- Footer and details consume the same cached snapshot shape, not separate API calls/parsers. Internal helpers and file splitting are implementer choices.

## Readers
- Codex: start installed `codex app-server`, initialize with truthful extension clientInfo, send initialized, request account/rateLimits/read; use Codex-owned login. Default Codex quota bucket, windowDurationMins 300 -> 5h, 10080 -> week; optional map by limit id if available. Other/unavailable windows must not be mislabeled. resetsAt Unix seconds. Select only quota fields needed; ignore account identifiers, credit inventory and reset actions. Terminate owned server on completion/abort/timeout. No threads, turns, login, purchases or reset-credit consumption. Actual local probe and result: codex-account-check.md.
- Antigravity: installed `agy -p "/usage" --output-format json`; structured command.data.groups[].buckets[], map window and remaining_fraction to used percent (1-fraction)*100; reset_time ISO timestamp. Preserve separate model groups, use short footer labels. Never use top-level token usage as account quota. Actual result: antigravity-account-check.md.
- Copilot: existing `gh api /copilot_internal/user`; select premium_interactions credits_used and provider reset metadata, experimental label in details. Current regular-member account access proven. No remaining/cost inference. No admin PAT or direct token extraction. Actual result: copilot-account-check.md.

## Snapshot/display contract
Each provider has identity, loading/error/availability info and optional last successful snapshot+timestamp; quota data preserves group, window, used percent and optional reset. Copilot carries credits consumed, not quota percent. All counters require finite, valid provider fields; missing is not zero.
- First failed read -> unavailable; missing executable/auth -> appropriate detail reason, no noisy notifications.
- Successful read followed by failure -> old successful data + stale indicator, last-success timestamp and safe reason in details.
- Success with no weekly bucket -> weekly unavailable/not applicable; never derive it from another window.
- AG Gemini and AG Claude/GPT do not sum or average into provider percentage.
- Copilot unlimited=true and percent_remaining=100 with credits_used=54386 -> show 54,386 consumed, not 0 used or a remaining balance.
- Used percentage rather than remaining is consistent across quota display. No total credits/cost across providers.

## Proposed operational defaults
- One active existing account per CLI; no extension-owned credentials or switching.
- All connected supported providers shown independent of Pi model. Missing tools/accounts omitted from footer and explained in details; a previously connected account that fails remains visible as unavailable/stale.
- Immediate async startup refresh then every 5 minutes; manual Refresh runs same path. No overlapping reader per provider, 30-second timeout each; independent successes even if another fails. No tight retry loop.
- Memory-only snapshots, no credentials/account IDs in logs or session transcripts. Only safe normalized quota output kept. Restart refreshes instead of loading persistent cache.
- Interactive TUI only; do not start monitor in print/JSON/RPC modes.

## Layout
Model right on first line; session context/tokens/cost stay left. Under model, right-align Codex, AG Gemini, AG Claude/GPT, Copilot as separate rows. Remove subagent on/off/running text, retain subagent billed accounting. Extra rows permitted. At narrow widths, stack provider rows below retained local totals; use Pi visibleWidth/truncateToWidth helpers, no ANSI/string-length width assumptions. Full labels/reset timestamps/last refresh/error status/experimental designation in `/provider-usage` details with Refresh and close keyboard paths.

## Evidence and tests
Already verified: all three live read-only paths, both Codex quota windows, both Antigravity group windows, regular-member Copilot credits.
Planned node:test seams under extensions/__tests__:
- sanitized fixtures for all three provider schemas, missing/null/invalid fields, correct units/window mapping/reset conversion, AG groups and Copilot unlimited behavior;
- injected process runner: exact safe commands, protocol handshake/id matching, timeout/abort/cleanup, no model-turn or reset actions;
- injected time: initial refresh, five-minute cadence, manual/timer overlap coalescing, independent failure, stale snapshot semantics, shutdown/off/on/reinstall lifecycle;
- mock ExtensionAPI command/event/UI calls: monitor -> footer redraw, same snapshots -> details, capability visibility registration;
- pure layout snapshots at wide/narrow widths including Unicode/ANSI, no subagent status, unchanged subagent cost inclusion.
Commands for implementation session (through run_tests, and durable supervisor for long runs):
`node --experimental-transform-types --test extensions/__tests__/provider-usage*.test.ts extensions/__tests__/usage-footer*.test.ts extensions/__tests__/capability-visibility.test.ts`
`npm run check`
Root vitest.config.ts includes Accordion tests only; do not rely on it to discover these node:test files.
Live smoke after implementation: read applicable verification guidance before user-facing changes; reload TUI, observe right-column/footer, open details/Refresh, resize and theme change, off/on, no CLI login prompts or agent turns.

## Domain/docs
Proposed glossary entries in CONTEXT.md: Provider Account Usage, Provider Quota Window, Copilot Credits Consumed. No ADR: small local reversible change, no architecture decision requiring a separate ADR.
