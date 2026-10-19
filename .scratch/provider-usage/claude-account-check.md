# Claude account usage check

- Source: Claude Code's own `cachedUsageUtilization` in `~/.claude.json` (or `$CLAUDE_CONFIG_DIR/.claude.json`). Undocumented, so the reader is marked experimental.
- Refresh: `claude -p /usage --output-format json --no-session-persistence` runs as a local command (`local_command: "usage"`, 0 turns, $0 cost) and refreshes the cache. Verified live: `fetchedAtMs` advanced, about 10 s per read.
- Only `fetchedAtMs` and `utilization.{five_hour, seven_day, spend, extra_usage}` are kept. OAuth tokens, email, org and account IDs are never read into the snapshot.
- Enterprise usage-based seat: `spend.used/limit` (amount_minor, exponent). Footer shows `Claude $408/$500 82%`. `five_hour`/`seven_day` are null on this seat. On Pro/Max they map to 5h/week quota windows.
- Period/reset for the spend limit is not reported, so none is shown.
- Code: `extensions/lib/provider-usage/claude.ts`, `parseClaude` in `model.ts`. Tests: `extensions/__tests__/provider-usage-claude.test.ts`.
