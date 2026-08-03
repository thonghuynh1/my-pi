# Grounding — aiKnow × Subagents Cooperation

## Repository/domain docs
- `CONTEXT.md`: defines Engineering Skills MCP, Capability Visibility, Agent-Visible Tool, Managed Extension, and related first-party extension vocabulary.
- `docs/agents/domain.md`: use glossary vocabulary and flag gaps/ADR conflicts.

### GROUND-001 — aiKnow Pi adapter hybrid guidance
- Source: `C:/Hackathon/aiKnow/aiKnow/integrations/pi/aiknow/index.ts` → `HYBRID_GUIDELINES`, `aiknowExtension`
- Existing behavior: the aiKnow Pi adapter registers one `aiknow_search` Agent-Visible Tool. Its hybrid guidance tells the agent to use aiKnow for indexed discovery, then verify cited locations with native `read`, `grep`, `find`, and `ls`.
- Current excerpt:
  ```ts
  const HYBRID_GUIDELINES = [
    "Use aiknow_search once at the start of repository exploration to discover definitions, callers, tests, and callees.",
    ...
    "Verify the returned file:line locations and assertions with native read, grep, find, and ls. Avoid broad rediscovery.",
    "Stop after 1-2 aiknow_search calls. Search again only when the first result used the wrong seed or left a specific gap.",
  ];

  pi.registerTool({
    name: "aiknow_search",
    label: "aiKnow Hybrid Discovery",
    description: "Discover indexed definitions, callers, tests, callees, and impact before native source verification.",
    promptSnippet: "Use aiKnow for indexed discovery, then verify cited locations with native read, grep, find, and ls.",
    promptGuidelines: HYBRID_GUIDELINES,
    ...
  });
  ```
- Test prior art: `C:/Hackathon/aiKnow/aiKnow/package.json` → `npm run check:pi` TypeScript-checks the Pi integration; broader search behavior has Vitest prior art under `src/test/mcp-search-*.test.ts`.

### GROUND-002 — aiKnow adapter suppresses aiKnow-owned read calls
- Source: `C:/Hackathon/aiKnow/aiKnow/integrations/pi/aiknow/index.ts` → `adaptSearchContentForPi`, pointer-mode return path
- Existing behavior: aiKnow output is adapted away from `aiknow_read` language and toward native-tool verification. Pointer mode returns compact pointers/details and suggested reads as content/details, not executable nested tool calls.
- Current excerpt:
  ```ts
  export function adaptSearchContentForPi(content: ContentBlock[]): ContentBlock[] {
    return content.map(block => ({
      ...block,
      text: block.text
        .replace(/^next: aiknow_read /gm, "verify with native read: ")
        .replace(/use aiknow_read for/g, "use native read for"),
    }));
  }
  ```
- Test prior art: `C:/Hackathon/aiKnow/aiKnow/package.json` → `npm run check:pi`; existing search-output tests under `src/test/mcp-search-*.test.ts` can guide any new behavior-focused test.

### GROUND-003 — Subagents generic workflow guidance and smart-delegation rule
- Source: `C:/my-pi/extensions/subagents.ts` → `buildSubagentToolDef`
- Existing behavior: when Subagent workflow mode is enabled, the `subagent` tool metadata tells the agent to batch independent work in parallel, use subagents for multi-file/broad investigations, and keep single known-file or targeted checks in the main agent.
- Current excerpt:
  ```ts
  promptGuidelines: enabled
    ? [
      "**BATCH IN PARALLEL — this is the #1 rule.** Multiple `subagent` calls in the same assistant message execute concurrently. Before launching any subagent, ask: 'can I split this into 2–5 independent sub-questions?' If yes, emit them all in one message. Sequential one-by-one is almost always wrong.",
      ...
      "Direct read/grep/edit in the main agent stays appropriate for single-file edits, targeted lookups, and quick follow-ups on subagent results — don't use a subagent to read one known file.",
    ]
    : [],
  ```
- Test prior art: `C:/my-pi/package.json` → `npm run check`; `extensions/__tests__/subagents-defaults.test.ts` is existing pure-test prior art for Subagents configuration behavior.

### GROUND-004 — Subagent workflow mode soft-off and gating
- Source: `C:/my-pi/extensions/subagents.ts` → `subagentModeEnabled`, `setSubagentMode`, `session_start`, `turn_end`, `before_agent_start`
- Existing behavior: the `subagent` tool is still registered when workflow mode is off, but with bare prompting metadata. The Subagent system prompt and batch-coach nudge are gated by `subagentModeEnabled`.
- Current excerpt:
  ```ts
  let subagentModeEnabled = subagentModeEnvDefault;
  ...
  managed.registerTool({ ...buildSubagentToolDef(subagentModeEnabled), defaultVisibility: "agent-visible" as const });
  ...
  pi.on("turn_end", (event: TurnEndEvent) => {
    if (!subagentModeEnabled) return;
    ...
  });
  ...
  pi.on("before_agent_start", async (event, ctx) => {
    if (!subagentModeEnabled) return;
    ...
  });
  ```
- Test prior art: `C:/my-pi/package.json` → `npm run check`; manual `/subagent on|off|status` behavior is documented in `README.md`.

### GROUND-005 — Subagent child sessions are native-tool workers, not aiKnow callers
- Source: `C:/my-pi/extensions/subagents.ts` → `runSubagent`, `resolveRunConfig`
- Existing behavior: child sessions are created with `noExtensions: true`, `SessionManager.inMemory(cwd)`, and mode-specific native tool lists. `explore` uses `read`, `grep`, `find`, `ls`; `shell` adds `bash`.
- Current excerpt:
  ```ts
  resourceLoaderOptions: {
    // Keep child agents isolated and avoid recursively loading this extension.
    noExtensions: true,
    appendSystemPrompt: [config.prompt],
  },
  ...
  tools: config.tools,
  ```
- Test prior art: `C:/my-pi/package.json` → `npm run check`; `extensions/__tests__/subagents-defaults.test.ts` shows nearby unit-test style.

### GROUND-006 — my-pi aiKnow shim delegates to external aiKnow adapter
- Source: `C:/my-pi/extensions/aiknow/index.ts` → default extension loader
- Existing behavior: this repository's aiKnow extension is a thin loader. It imports the configured external adapter from `AIKNOW_PATH` or the default `C:/Hackathon/aiKnow/aiKnow/integrations/pi/aiknow/index.ts` when present.
- Current excerpt:
  ```ts
  const DEFAULT_AIKNOW_PATH =
    "C:/Hackathon/aiKnow/aiKnow/integrations/pi/aiknow/index.ts";

  const AIKNOW_PATH = process.env.AIKNOW_PATH ?? DEFAULT_AIKNOW_PATH;
  ...
  const mod = await import(AIKNOW_PATH);
  if (typeof mod.default === "function") {
    await mod.default(pi);
  }
  ```
- Test prior art: `C:/my-pi/package.json` → `npm run check`.

## Pi extension docs facts
- `C:/Users/920287/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`: `tool_call` fires before execution, can block, and `event.input` is mutable.
- `tool_call` return values only control blocking via `{ block: true, reason?: string }`.
- `tool_result` can modify results after execution.
