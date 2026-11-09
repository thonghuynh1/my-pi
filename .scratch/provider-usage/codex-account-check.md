# Codex authenticated quota check

Read-only research probe: check-codex-quota.py; installed codex-cli 0.163.0.
Background job bg-2 completed exit 0.
Protocol: initialize -> initialized -> account/rateLimits/read -> terminate app-server process tree. No thread/start or turn/start, login, credit/reset consumption, or settings mutations requested.

Observed quota window:
- planType: plus
- primary.usedPercent: 69
- primary.windowDurationMins: 300 (5 hours)
- primary.resetsAt: 1792138480 (Unix seconds)
- secondary.usedPercent: 16
- secondary.windowDurationMins: 10080 (7 days)
- secondary.resetsAt: 1792676195 (Unix seconds)

The user has since authorized displaying reset-credit counts and explicit consumption from `/provider-usage`, superseding the earlier prohibition. The ordinary usage snapshot retains counts only. The inventory and account identity remain transient and are never persisted or logged. Consumption requires a slot and credit selection followed by explicit `y` confirmation; it never occurs automatically, on a timer, during refresh or when opening/rendering the panel. An uncertain request can only be retried explicitly with the same request id.

After an accepted or uncertain request, the acting slot's shared cache is invalidated. Other running Pi processes keep their in-memory snapshots until their next refresh. Slots authenticated to the same ChatGPT account use separate scope keys, so only the acting slot is invalidated. Consume schema and server-side idempotency remain unverified by a live consumption.

Outcome: authenticated dual-window read verified for this local account. Use windowDurationMins rather than assuming primary/secondary meanings for every plan. This is account quota, not message token/cost accounting.
