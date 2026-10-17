# Cursor integration evidence

User approved experimental internal API support and a footer row like `Cursor month 42% used`, with billing-cycle reset in details.

## Source verification
Installed Cursor Agent runtime: 2026.10.16-e3cb207.
- index.js: DashboardService descriptor and GetCurrentPeriodUsage response definitions.
- 3479.index.js, usage-data.ts: empty GetCurrentPeriodUsage request; totalPercentUsed or includedSpend/limit*100; billingCycleEnd epoch milliseconds.
- POST https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage using Connect JSON and Bearer accessToken.
- Existing CLI file credentials: Windows APPDATA/Cursor/auth.json; Linux XDG_CONFIG_HOME/cursor/auth.json (default ~/.config); explicit macOS file store ~/.cursor/auth.json.
- Active team from cli-config.json authInfo.activeTeamId, positive numeric IDs only.
- Interactive /usage exists; print /usage is NOT a safe usage-only command and is never invoked.

## Auto/API category follow-up
User requested the different Cursor pools too. Read-only production check bg-2 succeeded: totalPercentUsed=44.81058201058201, autoPercentUsed=42.044444444444444, apiPercentUsed=100. Footer now displays `Cursor month 44.8% · Auto 42% · API 100% used`. Source usage-pager.tsx labels these categories Auto and API. Preserve optional presence; do not infer missing zero, add percentages or assume external API billing/model membership. No distinct category reset fields are provided; details label the shared timestamp as billing-cycle end. On-demand display remains excluded. All 44 provider/footer tests plus TypeScript and diff checks passed.

## Constraints
Read existing access token only, in memory; no credential writes, refresh/exchange/login, subprocess chat or bundle execution. macOS default Keychain and memory stores unsupported. Expired login and absent included quota are unavailable, never inferred zero. Optional proto3 scalar defaults follow the verified schema, not missing messages. HTTP redirects disabled; errors sanitized; bounded files/responses, timeout and cancellation.

No real credential contents were inspected for research. Read-only live verification succeeded using the production adapter and existing login (bg-1, exit 0): Cursor month 44.7% used; billing reset epoch milliseconds 1793115999000. Only normalized usage was emitted; no credentials or identity data logged. All 43 provider/footer fixture tests passed; npm run check and git diff --check passed. Broader capability-visibility test could not load under Node 26 due to existing unsupported TypeScript syntax; no actual TUI smoke performed.
