# Authenticated Copilot read-only check

Used existing GitHub CLI authentication; no token values read or displayed, no configuration changes.

Commands:
- `gh api user --jq '{login: .login}'`
- `gh api /copilot_internal/user --jq '{copilot_plan: .copilot_plan, token_based_billing: .token_based_billing, quota_reset_date: .quota_reset_date, quota_reset_date_utc: .quota_reset_date_utc, quota_snapshots: .quota_snapshots}'`

Success for the user's existing account. Selected response:
- copilot_plan: enterprise
- token_based_billing: true
- quota_snapshots.premium_interactions.credits_used: 54386
- quota_snapshots.premium_interactions.unlimited: true
- quota_snapshots.premium_interactions.entitlement: 0
- quota_snapshots.premium_interactions.percent_remaining: 100
- quota_reset_date_utc: 2026-11-01T00:00:00.000Z
- snapshot timestamp: 2026-10-16T06:28:19.076Z

Interpretation:
- Internal endpoint works with this regular-member account and current gh authentication, unlike official organization billing API.
- Use reported credits consumed; do NOT show 100% remaining, zero usage, an inferred personal cap, or dollar conversion.
- Microsoft VS Code source directly verified: `chatEntitlementService.ts` interface `creditsUsed` is aggregate consumed credits for users whose org sets no user-level budget; unlimited branch surfaces CreditsUsed, not a percentage. Source https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/chat/common/chatEntitlementService.ts
- Internal/undocumented endpoint remains experimental; success is account-specific, not a public API guarantee.
- User has not yet accepted changing the supported-only scope to an experimental integration.
