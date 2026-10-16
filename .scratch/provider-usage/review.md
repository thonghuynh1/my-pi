# Parent review

Intent: report provider-account quota/credit usage in the existing footer and details using current local logins, preserve local accounting, and avoid blocking user input.

## Raw adversarial pass
- Consider monitor timeout cleanup ordering: monitor races a hung reader, so a timeout can clear pending before an abort-aware process finishes its bounded termination. A manual refresh within that short cleanup interval could overlap termination, not quota work. Underlying reader owns tree cleanup; a non-cooperative injected reader must not block the UI indefinitely.
- Consider internal Copilot endpoint and exact Antigravity group names are compatibility risks. No public stability contract for Copilot.
- Examine process-tree termination on Windows: taskkill targets the PID returned by this adapter; output and time limits bounded. Live readers all succeeded.
- Examine optional fields/model shape: distinct quota/credits variants, parsed at ingress. Missing counters never zero. Default provider missing fields omitted from footer and reported in detail. No actor/credential data stored.
- Examine status/time semantics: lastAttempt is labeled last refresh, with a separate last successful timestamp; error retains prior snapshot and stale marker.

## Self-filter
- Act on: none blocking found in implemented behavior after 48 passing tests and all three live adapter reads.
- Consider: bounded cleanup overlap after timeout is a narrow cancellation edge; tree is still explicitly owned and killed, no repeated quota polling. Keep current bounded timeout over indefinite waits on uncooperative readers.
- Noted: internal Copilot route and Antigravity schema drift; intentional experimental notice, strict parsing and stale/unavailable state avoid invented values.
- Dismissed: second-argument dependency injection in default extension factory is harmless; real Pi passes one argument and tests pass an injected monitor. No resources created by monitor constructor.

## Comment audit / code cleanup
Existing cost/subagent why-comments retained unchanged. Windows .cmd limitation and monitor microtask coalescing are non-obvious why-comments. Remove tree-cleanup narration (targeting invariant tested). No suppression comments or runtime any casts introduced. No extra dependencies, competing footer, unnecessary configuration knobs or token persistence.

## Evidence
- bg-3: 48 node:test tests passed, zero failures; npm run check passed; all three production adapters succeeded on real existing logins.
- Live isolated Pi TUI shows provider rows beneath model and no subagent status; details opens from actual /provider-usage. Evidence files beside this report.
- herdr watch unavailable in installed CLI (`unknown command: wait`); use action/read after concrete actions instead. No sleeps or job polling.
