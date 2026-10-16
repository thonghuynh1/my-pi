# Grounding

## extensions/usage-footer.ts
- `getTokenTotals(ctx)` iterates `ctx.sessionManager.getBranch()`; exact line: `for (const entry of ctx.sessionManager.getBranch()) {`.
- Adds subagent totals from `getSubagentTotals()`; not account-wide provider quota retrieval.
- Live consumer: `installUsageFooter` -> render -> `getTokenTotals(ctx)`.
- Live registration: default `usageFooter` registers `session_start` and other handlers calling `installUsageFooter` and `/usage-footer` command.
- Existing display covers local branch tokens/cost and context usage, not subscription allowance/reset data.
- Provider account-fetch adapter and its tests not yet investigated; do not claim absence across repository.

## Root domain documents
- CONTEXT.md read; no provider-allowance term yet defined.
- Existing docs/adr list concerns Accordion and background jobs; no apparent quota decision.
