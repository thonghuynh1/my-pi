# Work repos: merged tickets vs token cost (2026-11-09 06:02)

## Tickets

Main branch `origin/master`, author filter `all`, cutoff 2026-08-27.

| Era | Weeks | Merged tickets | Merged/week | Sessions (tstack) | Tokens (M) | Tokens per merged ticket (M) |
|---|---|---|---|---|---|---|
| before | 12.4 | 20 | 1.6 | 160 (0) | 365 | 18.2 |
| after | 10.6 | 18 | 1.7 | 585 (230) | 3667 | 203.7 |

Merged tickets that have agent sessions (lead = first session to merge):

| Group | Tickets | Median tokens (M) | Median lead (days) |
|---|---|---|---|
| after, main chat only | 1 | 2.3 | 117.0 |
| after, with tstack | 4 | 40.8 | 12.5 |
| before, main chat only | 2 | 6.6 | 27.0 |

Tickets with sessions but no merge found: 44 (tokens 1381M).

## Documents

Main branch `origin/master`, author filter `all`, cutoff 2026-08-27.

| Era | Weeks | Merged tickets | Merged/week | Sessions (tstack) | Tokens (M) | Tokens per merged ticket (M) |
|---|---|---|---|---|---|---|
| before | 12.4 | 7 | 0.6 | 56 (0) | 191 | 27.3 |
| after | 10.6 | 9 | 0.9 | 226 (155) | 1162 | 129.1 |

Merged tickets that have agent sessions (lead = first session to merge):

| Group | Tickets | Median tokens (M) | Median lead (days) |
|---|---|---|---|
| after, with tstack | 1 | 124.6 | 90.0 |

Tickets with sessions but no merge found: 34 (tokens 395M).

