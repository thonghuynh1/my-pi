---
status: closed
---
# Subagent thinking level in /subagents-model

Acceptance criterion: in `/subagents-model`, picking a reasoning model continues to a thinking-level picker that only offers `inherit` + `getSupportedThinkingLevels(model)`; the choice is saved as `provider/model[:level]` and the child session runs at that level (falling back to the parent's level when absent or unsupported).

Decisions: see `../ledger.md` (D1–D9). Grounding: `../grounding.md`.

## Checklist
- [x] `splitModelThinking(value)` — split on last `:` only when suffix is a valid level.
- [x] Thinking picker step after model picker (skip for `inherit` and non-reasoning models).
- [x] Runtime: `thinkingLevel = level supported by resolved model ? level : pi.getThinkingLevel()`; same for fallback-to-inherited and reuse config.
- [x] Tool `model` param description mentions optional `:level`.
- [x] Tests: parser cases, writer round-trip, createSession receives level / parent level for unsupported.
- [x] `npm run check` passes.
