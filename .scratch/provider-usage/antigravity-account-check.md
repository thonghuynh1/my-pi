# Antigravity authenticated quota check

Command: `agy -p "/usage" --output-format json`
Installed version: 1.3.6. Background job bg-1 completed exit 0.
Result SUCCESS, duration_seconds=0, num_turns=0, all token-usage fields zero, conversation_id empty.

Structured data is `command.data.groups[]`, each group `name`, `description`, `buckets[]` with `id`, `name`, optional `description`, `window`, `remaining_fraction`, `reset_time`.

Actual quota snapshot:
- Gemini Models (Gemini Flash, Gemini Pro):
  - gemini-weekly, window weekly, remaining_fraction 1, reset 2026-10-23T06:34:38Z.
  - gemini-5h, window 5h, remaining_fraction 1, reset 2026-10-16T11:34:38Z.
- Claude and GPT models (Claude Opus, Claude Sonnet, GPT-OSS):
  - 3p-weekly, window weekly, remaining_fraction 0.5174307823181152, reset 2026-10-21T20:04:23Z.
  - 3p-5h, window 5h, remaining_fraction 1, reset 2026-10-16T11:34:38Z.

Interpretation:
- Separate weekly and 5h windows verified for this account, per group, not one universal Antigravity counter.
- Derive used percentage as (1 - remaining_fraction) * 100; third-party group weekly used approximately 48.3%.
- Group labelled Claude and GPT is Antigravity's hosted-model quota, NOT a direct Claude.ai subscription integration; does not reopen excluded direct Claude integration.
- Use structured command.data, not rounded response text or top-level usage token counters.
- No inferred sum/average across independent groups. Each reset belongs to its own bucket.
- Codex local account windows not yet authenticated/verified in this session; docs establish app-server interface only.
