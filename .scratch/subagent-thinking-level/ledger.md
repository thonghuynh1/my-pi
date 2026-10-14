# Ledger — subagent-thinking-level

Status: READY_FOR_PRD (user confirmed)

Requirement: in `/subagents-model` TUI, after picking a model, continue to pick a thinking level. Offered levels must match what the chosen model supports.

## Decisions

- D1 — Storage shape — **accepted: A** `provider/model:level` suffix in the existing string value (subagents.default, agents.<name>, defaultModel, agent frontmatter `model:`). No suffix = old behaviour. Parse: split on last `:` only when suffix is a valid level (pi parseModelPattern convention).
- D2/D3/D4 — Thinking picker contents — **accepted: A** only supported levels.
  ```
  model=inherit → skip step → "inherit"
  non-reasoning (getSupportedThinkingLevels = ["off"]) → skip → "provider/model"
  reasoning → picker: "inherit" + getSupportedThinkingLevels(model) → "provider/model" | "provider/model:<level>"
  thinking "inherit" = no suffix = parent pi.getThinkingLevel(), clamped by session
  ```
- D5 — Tool-call `params.model` — **accepted: A** level travels with its model string. `params.model ?? configured` is split by the same parser; `thinkingLevel = level ?? pi.getThinkingLevel()`. Tool `model` description mentions optional `:level`.
- D6 — Follow-up/resume reuse config stores the resolved level (not pi.getThinkingLevel()) — **default**, follows D1/D5.
- D7 — Saved level not valid for the model that actually runs — **accepted (user, superseded clamp default)**: use parent's `pi.getThinkingLevel()` instead; session clamps that only if the parent level is also unsupported.
  ```
  level ∈ getSupportedThinkingLevels(selectedModel) ? level : pi.getThinkingLevel()
  ```
  Covers: hand-edited level, model capabilities changed, fallback to inherited model (D8 now same rule).
- D8 — Override model fails and run falls back to inherited model — **default**: drop the suffix level, use parent's level (D5: level belongs to its model).
- D9 — Editor row shows full value e.g. `claude-sonnet-4.6:high` — **default**.
