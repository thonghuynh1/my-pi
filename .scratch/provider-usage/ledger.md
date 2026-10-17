# Provider usage extension — decision ledger

Status: implemented and verified (user explicitly requested no PRD/issues)

## Intent
Show usage for the current user's configured providers (user examples: Claude, OpenAI, Muse, Antigravity, GitHub Copilot), fetching provider data where supported.

## Decisions
- Accepted D1: Fetch usage directly from the user's provider/product accounts and report it back. Not Pi-session accounting or checking only the currently selected Pi model. User explicitly clarified Claude, Codex, Muse, and GitHub Copilot. Exact available metrics remain subject to provider endpoint evidence.
  Agreed intent (not implemented): provider account -> provider-specific usage fetch -> usage report.
  Proposed seam: separate provider-specific fetching from the existing local-session `getTokenTotals()`; exact adapter contract remains open.
- Accepted D2: Muse means https://muse.ai/, explicitly supplied by user. Public site identifies itself as Muse — Your Personal AI Agent.
- Feasibility finding: no documented public account-usage API found in inspected public pages. /api, /docs, /llms.txt returned 401 without authentication; this does not establish endpoint existence.
- Accepted D3: Skip Muse, per explicit user instruction. Muse is outside the current extension scope; no Muse integration or support inquiry required. Remaining candidate products: Claude, Codex/OpenAI, Antigravity, GitHub Copilot. Availability and exact metrics remain unverified.

## Unresolved questions (not decisions)
- Muse API research deferred out of scope by D3.
- Accepted D4: Supported integrations scope: Codex official local app-server quota, Antigravity official CLI quota, and GitHub Copilot official AI-credit consumption reporting. User accepts credits used rather than remaining credits. Skip Claude entirely rather than a usage-page-only placeholder, because permitted automatic personal-quota retrieval is not verified. Muse remains excluded. Evidence: provider-feasibility.md. No authenticated integration tested.
  Agreed flow (not implemented): Codex signed-in app-server -> quota/reset; Antigravity signed-in CLI -> quota report; GitHub official billing API -> credits used -> unified report.
  Copilot does not promise remaining credits, exact reset, or instantaneous reporting. Legacy premium-request handling has not been accepted; do not relabel requests as credits.
- Accepted fact D5: Copilot subscription is employer/organization-funded (user confirmed).
- Verified official organization endpoint: GET /organizations/{org}/settings/billing/ai_credit/usage supports `user` username filter, year/month/day/model/product. Docs require organization administrator and fine-grained token Organization Administration read. Filtering does not narrow token authorization to self.
- Resolved fact D6: User is regular organization member. Official organization billing API access is not established and must not be assumed.
- Authenticated verification: existing gh login successfully read `/copilot_internal/user`; premium_interactions.credits_used=54386, unlimited=true, token_based_billing=true, quota_reset_date_utc=2026-11-01T00:00:00.000Z. See copilot-account-check.md. No credentials displayed or settings changed.
- Accepted D7: User explicitly authorizes using experimental `/copilot_internal/user` for Copilot consumed-credit reporting. Supersedes D4's official-billing-only Copilot route. Existing gh authentication successfully tested; no org-admin billing credential required for the verified account. Report `quota_snapshots.premium_interactions.credits_used`, and provider reset metadata when present. No remaining-credit/percentage/cost inference. Internal route may change; failure must not become zero consumption. No personal cap does not mean unlimited employer funding.
  Agreed flow (not implemented): existing authorized GitHub login -> read internal Copilot user endpoint -> consumed credits + reported reset -> unified report.
- Accepted D8: Panel plus persistent summary (Option B). Extend existing `extensions/usage-footer.ts` owner, right-align provider-account usage below model; remove subagent on/off/running field produced by `getSubagentLine()` from footer. Do NOT disable subagents or remove their usage/cost from `getTokenTotals()`. Existing session/context/model totals retained. User explicitly requested position and field removal. Existing `installUsageFooter` renders model on line1 right, tokens line2 left, total line3 left and subagent status right; `padRight` is existing alignment seam. Exact narrow-width behavior remains open.
- Accepted D9: Show all connected supported providers regardless of selected Pi model (user chose A).
- Accepted D10: User requests Codex and Antigravity 5-hour and weekly usage + resets. Display windows where actually reported; no absolute guarantee for plans without them. Do not hard-code primary=5h or secondary=weekly; map actual duration/scope. No fabricated counters or deriving weekly usage from short-window usage.
- Verified Antigravity authenticated result: official CLI exposes `command.data.groups[].buckets[]` with `window` 5h/weekly, `remaining_fraction`, `reset_time`. Both windows present for Gemini Models and Claude and GPT models groups. Gemini 0% used in both; third-party group 0% 5h used, ~48.3% weekly used. See antigravity-account-check.md. No turns or tokens consumed. Preserve independent groups rather than inventing a provider-wide total. Direct Claude.ai remains excluded; Antigravity hosted Claude/GPT group is in scope.
- Verified local executable versions: agy 1.3.6, codex-cli 0.163.0. Official Antigravity docs describe five-hour + weekly limits for Pro/Ultra and weekly quota for non-Pro/Ultra; official Codex pricing states plan-specific limits, including some plans with no five-hour limit. Render unavailable/not applicable distinctly rather than 0%.
- Accepted D11: User approves displayed footer layout: right-column Codex 5h/week, separate AG Gemini and AG Claude/GPT 5h/week, Copilot consumed credits; retain model above, remove subagent status. Details panel carries reset times. Narrow-width behavior remains to define.
- Accepted D12: Reuse existing authenticated Codex/Antigravity CLI and gh interfaces only (user chose A). No extension-owned copied tokens/cookies, credential store, or new sign-in flow. Provider-owned refresh remains provider responsibility. Missing/expired auth should be surfaced, not trigger a new login automatically.
- Verified Codex authenticated response: app-server `account/rateLimits/read` returned Plus primary 300min/69% used and secondary 10080min/16% used plus reset timestamps. See codex-account-check.md. Do not expose irrelevant account identifiers/reset-credit inventory; do not invoke reset-credit mutations.
- Accepted D13: User chose automatic refresh on session start then every 5 minutes plus manual refresh in details. Fetches never run in render or block input. Independent failures preserve last successful snapshot marked stale. Shutdown/reload cancels timers and processes.
- Accepted D14 (user confirmed full walkthrough): operational defaults: use active account in each existing CLI; no account switching by extension; installed/authenticated accounts appear in footer, absent tools/logins explained in details. In-memory snapshots only, one in-flight refresh per provider, 30-second timeout per provider, next retry on manual refresh or next scheduled interval. First failure shows unavailable; a failed refresh after success shows last value and stale marker. No inferred zero/percentage/cost, no raw credential/error-body logging. Narrow layout retains session totals, moves provider lines below them when columns cannot fit, uses terminal-column-aware truncation; full names/details available in panel. Footer off stops monitor; on restarts it.
- Accepted D15 (user confirmed full walkthrough): integrate monitor into existing usage-footer owner, not a second footer extension. New helper under extensions/lib/provider-usage/ owns adapters/state and injected process/time seams; existing installUsageFooter consumes immutable cached snapshots. Managed `/provider-usage` command opens detail panel with Refresh and close; no model-callable tool. TUI session lifecycle owns start/stop; capture requestRender from footer factory. node:test fixture/runner/timer/layout tests plus typecheck and live TUI smoke are proof seams. Local helpers/file splitting left to implementer.
- User confirmed walkthrough and explicitly requested immediate implementation in this session without PRD/issues. Implementation is complete; verification bg-3 passed 48 tests, typecheck and all three production live readers. Actual isolated Pi TUI footer and details verified. See implementation.md/review.md and *-evidence.txt.

## Cursor extension (2026-10-17)
- User approved adding experimental Cursor internal usage retrieval after being shown monthly included-plan percentage and billing-cycle reset semantics.
- Uses existing Cursor Agent file-store accessToken in memory only; no writes, token refresh, login or inference. This explicitly extends D12 beyond subprocess-only transport for Cursor.
- Cursor footer: `Cursor month N% used`; details: monthly included plan, reset and freshness/errors. No on-demand-spend or Pi-session-token inference.
- IDE-only, default macOS Keychain and memory stores unsupported; expired CLI access token remains unavailable until renewed in Cursor Agent.
- Evidence and limitations: cursor-account-check.md.

## Compact three-line footer
- User requested exactly three footer lines after the provider list grew too tall. Supersedes D14 narrow stacking and D11 per-provider rows/reset summaries.
- Preserve context/tokens/billed costs on the left; model top right, combined Codex/Antigravity second right, Copilot/Cursor third right. Whole-percent and compact credit summaries; stale `*` indicator. Full precision/reset times remain in `/provider-usage`.
- Narrow widths truncate the summaries, never add rows. Missing providers remain absent, not zero.

## Copilot credit-equivalent format
- User requested `29.5k` credits be displayed as `$295` in the compact footer: convert actual consumed credits at 100 credits per dollar, then round to whole dollars. This supersedes credits-only summary formatting in D7/D11, not the underlying consumed-credit metric.
- This is a user-requested dollar equivalent, not verified invoiced spending. Details retain exact reported credits and explain the conversion.

## Constraints
- User explicitly superseded planning-only flow: implement now, no PRD/issues. No commits/pushes made.
- No promise that all providers expose a supported account-usage API.
- Do not conflate session cost estimates with account quotas or provider billing.
