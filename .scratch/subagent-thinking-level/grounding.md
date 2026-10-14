# Grounding — subagent-thinking-level

- `extensions/subagents.ts` `parseModelPreference(value)` — accepts a string only; `"inherit"` → `{kind:"inherit"}`, else `{kind:"model", value}`.
- `extensions/subagents.ts` `readSubagentTypeDefaults` — reads `subagents.default` across package → user → project `models.json`.
- `extensions/subagents.ts` `readCustomAgentModelConfig` — reads `agents.<name>` and `defaultModel` (strings).
- `extensions/subagents.ts` `writeSubagentDefaultModel`, `writeCustomAgentModelChoices` — write plain strings.
- `extensions/subagents.ts` `SubagentModelsEditor` (SettingsList) → `SubagentModelPicker` submenu; `done(value)` sets the row's string value. No thinking step: missing.
- `extensions/subagents.ts` `createChildSession` — `thinkingLevel: control?.config.thinkingLevel ?? pi.getThinkingLevel()` → child always uses parent's level today.
- `extensions/subagents.ts` launch (≈L2028) — reuse config stores `thinkingLevel: pi.getThinkingLevel()`.
- `extensions/lib/subagent-context.ts` L85 — validates thinkingLevel in {off,minimal,low,medium,high,xhigh,max}.
- `@earendil-works/pi-ai` `getSupportedThinkingLevels(model)`, `clampThinkingLevel(model, level)` — exist (models.d.ts:267-268).
- pi `AgentSession._clampThinkingLevel` — session clamps unsupported levels itself.
- pi `model-resolver.d.ts` `parseModelPattern` — pi's convention `"provider/model:level"` (split on last colon, suffix must be a valid level).
- Current files: `~/.pi/agent/agents/models.json` = `{subagents:{default:"github-copilot/gpt-6-luna"}}`; `agents/models.json` has `subagents.default` + `defaultModel`.
- Tests: `extensions/__tests__/subagents-defaults.test.ts` (defaults read/write seam).
