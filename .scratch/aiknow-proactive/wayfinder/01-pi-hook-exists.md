# 01 — Does Pi's `before_agent_start` hook exist today?

Type: research
Status: resolved

## Question

The scratch file claims Pi provides `pi.on("before_agent_start", async ({ cwd, userPrompt }) => { return { inject: "..." } })`. Does this hook actually exist in the current Pi extension API? If not, what's the closest equivalent — and what would it take to get injection working (system prompt append, custom tool preamble, etc.)?

This is the single integration point for Features 1-3. If the hook doesn't exist, the entire approach changes.

## Answer

**Yes, `before_agent_start` exists and is fully typed in Pi's extension API.**

- Defined at `types.d.ts:882`: `on(event: "before_agent_start", handler: ExtensionHandler<BeforeAgentStartEvent, BeforeAgentStartEventResult>): void;`
- Event provides: `prompt` (user text), `systemPrompt` (current, chainable), `systemPromptOptions` (includes `cwd`)
- Return options:
  - `{ systemPrompt: string }` — replaces/chains the system prompt for this turn
  - `{ message: { customType, content, display } }` — injects a persistent session message sent to the LLM
- Multiple extensions chain: each handler sees prior handlers' modifications
- aiKnow's current Pi extension (`integrations/pi/aiknow/index.ts`) uses only `registerTool()` with `promptSnippet` and `promptGuidelines` — zero hooks today
- The hook fires after skill/template expansion, before the agent sees the prompt

**Implication**: The scratch file's design is directly implementable. Use `systemPrompt` append for the proactive injection (codebase map + ranking + recent changes). The `message` mechanism is an alternative if we want the injection visible in TUI and stored in session history.

**Key detail**: `event.systemPromptOptions` exposes `cwd` — so detecting the repo root is straightforward without separate logic.
