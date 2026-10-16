# Provider account-usage feasibility

Documentation/source verification only; no local credentials read, authenticated calls, installed CLI checks, or account results verified.

## Codex
- Official documented local app-server JSON-RPC: `account/rateLimits/read`; optional `rateLimitsByLimitId`, windows `usedPercent`, `windowDurationMins`, `resetsAt`; notifications `account/rateLimits/updated`.
- https://developers.openai.com/codex/app-server (parent directly verified relevant docs).
- Use Codex's own account authentication; not ordinary OpenAI API keys. Percentage remaining is not absolute messages remaining.
- Internal HTTP `/backend-api/wham/usage` exists in official source but is not a supported public REST contract; prefer app-server.
- Separate API organization reporting: `/v1/organization/usage/completions`, `/v1/organization/costs`, Admin key. https://cookbook.openai.com/examples/completions_usage_api

## Antigravity
- Official CLI `agy -p "/usage" --output-format json`; recent version required. Changelog v1.1.11 documents read-only print-mode quota output, no agent turn/quota consumption/conversation creation.
- https://antigravity.google/docs/cli/commands/usage.md
- https://antigravity.google/docs/changelog.md (parent directly verified).
- Existing signed-in Google account required; schema still needs a real permitted sample.
- Internal Google cloudcode-pa `v1internal` routes evidenced in CodexBar, not supported public personal-quota HTTP contract. Prefer official CLI. Do not copy onboarding mutations into monitoring.

## Claude
- Official personal usage UI: https://claude.ai/settings/usage
- Undocumented quota routes: `/api/oauth/usage` at api.anthropic.com; claude.ai `/api/organizations/{orgId}/usage` with session cookies. Secondary evidence: https://github.com/steipete/CodexBar/blob/main/docs/claude.md
- Important official credential policy: https://code.claude.com/docs/en/legal-and-compliance (parent directly verified): third-party developers may not collect/store/intermediate Claude.ai credentials or session tokens; no third-party Claude.ai login. Do not propose copied subscription tokens/cookies as supported integration. Provider clarification needed.
- Official Anthropic organization reporting: `/v1/organizations/usage_report/messages` and `/v1/organizations/cost_report`, administrative credentials. Not personal subscription quota. https://platform.claude.com/docs/en/manage-claude/usage-cost-api

## GitHub Copilot
- Official personal historical billing endpoints: `/users/{username}/settings/billing/premium_request/usage`, `/users/{username}/settings/billing/ai_credit/usage`.
- https://docs.github.com/en/rest/billing/usage
- https://docs.github.com/en/billing/tutorials/automate-usage-reporting
- Consumption/cost reports, not plan allowance + remaining + reset. Personal-billed accounts only; organization-funded usage excluded. Auth documentation inconsistent between classic-PAT tutorial and fine-grained Plan-read reference; verify minimal credential on real account before promising.
- Internal `GET https://api.github.com/copilot_internal/user` exposes quota snapshots/reset/entitlements, evidenced in Microsoft clients, not public supported REST contract.
- Primary implementation sources: https://github.com/microsoft/vscode/blob/main/product.json and https://github.com/microsoft/vscode-copilot-chat/blob/main/src/platform/authentication/node/copilotTokenManager.ts
- Do not hard-code legacy premium-request entitlements; credit-based billing and legacy plans differ.

## Decision implications
- Strongest supported local account-quota integrations: Codex app-server, Antigravity CLI.
- Copilot official billing reporting can be included if clearly labelled consumption rather than live remaining allowance.
- Claude personal auto-fetch remains pending provider-permitted integration; settings link is safe fallback.
- No claim of working authenticated integration yet.
