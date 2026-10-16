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

Quota result also includes credits/reset-credit inventory and account identity; those are not needed for this feature, should not be persisted into application state or shown in usage report. Never consume reset credits from a monitoring integration.

Outcome: authenticated dual-window read verified for this local account. Use windowDurationMins rather than assuming primary/secondary meanings for every plan. This is account quota, not message token/cost accounting.
