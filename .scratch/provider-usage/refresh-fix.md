# Claude personal refresh fix

## Reproduction

On 27 October 2026, the production reader returned 84% five-hour and 74% weekly usage. Keeping one Claude 2.1.310 process alive proved that its usage endpoint returned HTTP 429, then replayed that failure during a 300-second cooldown. All four get_usage control replies nevertheless reported rate_limits_available=true with the same cached values. See refresh-race-evidence.json and stderr-order-evidence.json. A separate Pi TUI also labelled the cached values available after the five-hour reset time had passed. See refresh-before-tui.txt.

## Shape and decision

Keep ProviderReader.read(signal) and ProcessRunner unchanged. Add --debug-to-stderr to Claude's usage-only subprocess. At the process boundary, join the matching control response with recognized usage-fetch diagnostics. Represent freshness as waiting, fresh, or failed. Require a successful usage GET/200 or the native explicit snapshot fast path of at most 60 seconds. Treat 429, replayed cooldown, fetch failure, invalid endpoint bodies, and old snapshots as failures. Unknown diagnostics cannot authorize success. Preserve existing abort, timeout, output bounds, and cleanup behavior. Drain stderr during controlled termination before publishing a successful payload.

Two independent designs compared stderr validation against adapter-owned temporary debug files or persisted cache timestamps. A separate judge selected stderr validation. It avoids credential reads, new dependencies, disk-write races, shared-profile timestamps, and production diagnostic files. No graft from the alternatives was necessary. The existing monitor already retains last-known values as stale and preserves lastSuccess on errors. No monitor/footer production changes were needed.

The native binary source confirms that get_usage drops its internal seeded/failure status. Its normal snapshot fast path lasts 60 seconds, while its fallback can use persisted data for one hour. Its stderr logger returns before file writing when --debug-to-stderr is enabled.

## Verification

- Original regression failed before the fix with Missing expected rejection. red-test-output.txt records pass 7 / fail 1.
- All 69 provider tests passed after the fix. refresh-green-provider-tests.txt records pass 69 / fail 0.
- The added footer/details integration scenario passed. refresh-green-footer-tests.txt records pass 1 / fail 0. It drives manual r failure and automatic timer recovery to a literal 100%, preserving component instances and checking stale markers, timestamps, and both render subscriptions.
- The actual Pi TUI now reports Claude usage refresh rate limited rather than marking the old personal values available. Work initially returned current spend; a later rate-limited manual refresh preserved it with an explicit stale marker. See refresh-after-tui.txt and refresh-after-manual-tui.txt.
- The broader footer suite has seven existing subscription-cost failures. Running the untouched HEAD footer test file independently reproduced all seven, with pass 10 / fail 7. No pricing code or cost assertions changed.
- `npm run check` passed. The durable background job completed with exit code 0 after running `tsc --noEmit`.

## Review

Intent is to prevent failed upstream refreshes from being labelled successful, not to invent a quota percentage or bypass provider throttling.

Act on: the first diagnostic matcher omitted the native successful OAuth-refresh retry suffix. An added regression reproduced a timeout, then the matcher was extended to accept the source-verified suffix. Actual replayed-429 wording from the live probe is also covered.

Consider: this integration depends on experimental CLI diagnostic wording. Unknown versions fail closed rather than accepting cached usage. Revisit when Claude exposes explicit freshness metadata in its control response.

Dismissed: a generic repaint fix and model-specific limits were not supported by the live failure. Actual model-specific limits were null. No unrelated stop-notification or pricing changes were included.

The current provider 429 means a live up-to-date personal quota percentage remains unavailable. The code does not claim the account is at 100% from that HTTP status. Reload Pi extensions to activate the fix in an existing session. No commits, staging, push, or PR were performed.

## Compact RL footer follow-up

At the user's request, Personal usage-refresh throttling now renders `Claude-P 5h-RL wk-74%*` when a cached weekly measurement exists, or `Claude-P 5h-RL wk-?` before any successful read. RL describes the usage-fetch failure, not proof of an exhausted five-hour quota. Detailed error text remains in `/provider-usage`. Cached zero remains `wk-0%*`; successful recovery restores numeric percentages. Only Personal receives this shorthand. Work spend formatting is unchanged.

The added model regression failed before implementation. All 70 provider tests and the manual-failure/timer-recovery rendering scenario then passed. The real Pi TUI displayed `Claude-P 5h-RL wk-?`. See compact-rl-footer-tui.txt. A dedicated no-network extension, verify-compact-rl.ts, supplied a deterministic rate-limited reader to the production footer. `npm run check` passed with exit code 0 for this follow-up.
