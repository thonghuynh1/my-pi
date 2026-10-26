# Claude usage freshness fix

## Personal profile follow-up, verified 23 October

Personal usage is now available. Claude's own auth status initially reported `loggedIn:false` and `authMethod:none`. A personal-only `claude auth login --claudeai` restored a Pro subscription. This alone did not repair usage retrieval.

The remaining cause was the inherited `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` environment flag. Installed Claude v2.1.307 blocks `/api/oauth/usage` locally under this flag, even though the control response says `rate_limits_available:true`. The reader now removes this flag only from its usage subprocess and sets `DISABLE_TELEMETRY=1`, `DISABLE_ERROR_REPORTING=1` and `DISABLE_AUTOUPDATER=1`. The parent process and other subprocesses retain their environment. This permits first-party requests in that child, not a network allowlist limited strictly to usage.

Live proof in `personal-usage-network-evidence.json` recorded:

```text
2026-10-23T07:38:41.498Z [DEBUG] fetchUtilization: GET /api/oauth/usage (attempt 1)
2026-10-23T07:38:43.350Z [DEBUG] fetchUtilization: 200 after 1 attempt(s)
```

The subsequent production reader returned both personal windows and footer `Claude-P 5h-6% wk-10%`. Work still returned $500/$500. See the updated `claude-control-evidence.txt`. All 57 provider tests and `npm run check` passed. A new regression failed before the environment fix, with five passing and one failing test. A real Node subprocess test proves the traffic flag and API key are actually absent, all three privacy opt-outs are set, and the parent environment is unchanged.

A fresh Pi TUI launched with the traffic restriction explicitly set also showed Personal available, at 7% five-hour and 10% weekly usage. See `claude-control-tui-evidence.txt`. Its temporary pane was closed after verification.

The earlier unavailable result below is historical. No further sign-in is needed after this successful repair.

## Original result

The extension no longer treats yesterday's Claude disk cache as current account usage. It uses the Claude CLI experimental `get_usage` control request. No model prompt, OAuth-token read, SDK dependency, or automatic sign-in is added.

Live verification on 23 October returned Claude Work at $500/$500. Claude Personal returned no account limits, so it is unavailable rather than the cached 52% five-hour figure from 22 October. The cause of that profile's unavailable account limits is not established. Login/profile scope should be checked in Claude itself.

## Root cause

The old command `claude -p /usage --output-format json --no-session-persistence` succeeded with `local_command: usage`, zero turns and zero cost. Its output was session information, not account utilization. Neither profile cache timestamp advanced. The extension nevertheless read the old cache and marked the read successful.

The live personal cache timestamp before and after that command was `2026-10-22T12:11:01.867Z`. The work cache timestamp was `2026-10-22T12:11:01.542Z`. Opening the interactive work /usage screen updated the work cache on 23 October. That confirmed the old automatic command was not equivalent to the interactive account-usage screen.

## Choice

Compared retaining the command with an age guard against replacing the transport. An age guard would stop the lie but would not request current usage. Compared adding the SDK against using its control protocol through the installed CLI. Reused the existing bounded subprocess runner to avoid another dependency.

The adapter projects only five-hour, seven-day, spend and extra-usage fields. A missing account response fails safely. No fallback reads the disk cache. No provider fetch timestamp is invented. Claude itself may return a recent cached fallback; this fix does not promise every request performs a network fetch. The control API is experimental and requires a CLI version that supports it.

## Verification

- All 55 provider-usage tests passed.
- `npm run check` passed.
- Production reader exercised both actual Claude profiles. See `claude-control-evidence.txt` and rerun `node --experimental-strip-types .scratch/provider-usage/verify-claude-control.ts`.
- Fresh isolated Pi TUI showed the work amount and a personal unavailable reason. See `claude-control-tui-evidence.txt`. The probe pane was closed afterward.
- The broader provider/footer run passed 65 of 72 tests. All seven failures concern unchanged subscription cost estimates. An extracted untouched HEAD version of the footer suite reproduced the same seven failures, with 10 passing and seven failing. No unrelated assertions were weakened or production cost code changed.
- No commits, staging, push or PR performed.

Failing UI-metadata regression before the final one-line model fix, verbatim:

```text
# tests 5
# suites 0
# pass 4
# fail 1
```

Passing provider suite, verbatim:

```text
✅ All tests passed (2.5s)
```

Production result, verbatim:

```text
Claude Work
  available · last refresh: 10/23/2026, 9:15:24 AM
  Last success: 10/23/2026, 9:15:26 AM
  Usage credits: $500.00 used of $500.00 limit · 100% · critical
  Spend period/reset not reported by Claude Code.

Claude Personal
  error · last refresh: 10/23/2026, 9:15:26 AM
  Last success: unavailable
  Reason: Claude usage unavailable; check CLI login
  Usage unavailable (no successful read)
```

## Review

Intent was to stop old account measurements appearing fresh while preserving provider-owned authentication and the existing footer.

Adversarial finding was that the panel still printed `Claude Code cache fetched: unavailable` after disk-cache removal. Acted on it by hiding that line when no source timestamp exists, with a failing-then-passing regression. No remaining blocking findings in the changed code. The null personal result remains an explicit live limitation, not a successful current-usage verification for that account.

Safety depends on the runner sending no user/model prompt, matching control-response IDs and stages, and preserving existing process bounds and cleanup. Tests exercise those facts, including split frames, wrong IDs, permission denial, protocol errors, premature EOF, timeout, cancellation, output limits and cleanup once. The Codex protocol tests still pass.

Fix Root Causes led to replacing the non-refreshing print command rather than just hiding its cache. Smallest Safe Change led to deleting cache I/O and reusing the installed CLI and runner. Model the Domain kept the control exchange as an explicit initialize/usage state and retained the existing normalized quota/spend shape. Prove It Works led to real CLI and Pi TUI checks rather than declaring success from fixtures alone. Two new narrating test comments were removed during the comment audit.

## Use

Reload Pi with `/reload`, then open `/provider-usage`. Repair the personal Claude profile's login or account scope if Claude itself still cannot report its usage. Do not copy tokens or interpret unavailable usage as zero.
