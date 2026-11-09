# Claims and verification design

- **C1:** With the real ChatGPT account, treatment renders `  Reset credits: 0 available · 0 applicable` in the Codex detail view, with both values taken from the live `/backend-api/wham/usage` `rate_limit_reset_credits` field, and `resets 0` in the Codex compact row. Neither string appears in baseline rendered output.
- **C2:** In treatment, `x` followed by Enter on Codex issues exactly one GET to `/backend-api/wham/rate-limit-reset-credits` and displays `No reset credits available.` In baseline, `x` changes nothing and no such request occurs.
- **C3:** Neither experiment issues an HTTP POST.

## Design

Baseline is commit `92097a9d309c4a1095808d905ea21614bf4a3298` in a temporary detached worktree. Treatment is the clean extension source at working-tree HEAD `147a68720f46bbc9e713f06dcd7dadb7ff7dc0b3`. Existing unrelated modifications in `analyse/` were left untouched. The baseline worktree and its dependency junction were removed afterwards.

The same `C:/Users/920287/AppData/Local/Temp/verify-codex-reset/verify.mjs` drives actual imported reader, monitor, cache, panel and, for treatment, reset flow objects. Baseline uses its `providerReaders` and panel without a flow; treatment uses `providerReaderBundle` and the real flow wiring. The run selects only the built-in `codex` reader, to avoid unrelated provider CLI/network activity, and uses the unexpired `openai-codex` OAuth access token from Pi's auth file. It uses separate cold shared-cache roots under the temporary directory.

At width 100 and panel height 80, the harness refreshes, renders summary, presses `d` for detail, returns with `d`, presses `x`, then sends Enter as CR (U+000D). It renders immediately and after asynchronous inventory completion. It does not send `y`. `01`–`06` JSON files contain the panel's unmodified line arrays, including frame and padding. The expected two-leading-space detail content is inside the panel's `│ ` frame.

The wrapped global fetch records phase, method, endpoint and status, permits only GET to the two expected endpoints, rejects redirects, and immediately blocks and aborts on a non-GET or unexpected URL. The recorder clones the usage response solely to record the two numeric count fields; no token, account ID, or raw response body is written. `requests.json` records calls and `usage-counts.json` records those two selected fields. The panel and network are real but driven in-process, **not through a terminal PTY**.

One preliminary baseline/treatment pair was run before the recorded pair; both were also GET-only and produced the same outcomes. The final pair used freshly cleared, separate temp cache roots; its outputs are the artifacts here.
