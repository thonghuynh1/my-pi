# Create reusable child-session runtime for Driver and Navigator roles

Status: ready-for-agent
Type: AFK
Source PRD: `F:/MyWork/my-pi/.scratch/pair-program-tool-prd.md`

## What to build

Create the reusable session/runtime helper needed by `pair_program`: persistent child sessions, role-specific tool allowlists, explicit model override fail-fast behavior, event subscription, final message extraction, abort/dispose handling, and role usage aggregation.

Decision IDs: `MACRO-001`, `MESO-001`, `MESO-002`, `MESO-003`, `MESO-005`, `MESO-015`, `MESO-014`, `MICRO-004`, `MICRO-006`.

## Implementation map

### Area: Child Session Runtime and Role Permissions

- **Decision IDs**: `MACRO-001`, `MESO-001`, `MESO-002`, `MESO-003`, `MESO-005`, `MESO-015`, `MICRO-004`, `MICRO-006`
- **Current code anchors**:
  - `extensions/subagents.ts`: `runSubagent()` uses `createAgentSessionServices()` and `createAgentSessionFromServices()`.
  - `extensions/subagents.ts`: child sessions use `SessionManager.inMemory(cwd)`.
  - `extensions/subagents.ts`: child sessions pass a tool allowlist.
  - `extensions/subagents.ts`: child session events are subscribed for text, tool calls, usage, and final messages.
  - `extensions/subagents.ts`: `selectSubagentModel()` resolves model overrides with fallback behavior.
- **Existing behavior**: `subagent` creates one child session per tool call, sends one prompt, and disposes it. It currently allows fallback from unavailable explicit model override to inherited model in some paths.
- **Required edits**:
  - Add `extensions/agent-session-utils.ts`.
  - Extract or adapt helpers for child session creation, final assistant text extraction, usage aggregation, model selection, and event subscription.
  - For pair runs, support creating Driver and Navigator sessions once and prompting them repeatedly.
  - Driver tools:
    - Dry run: `read`, `grep`, `find`, `ls`, `bash`.
    - Work mode: `read`, `grep`, `find`, `ls`, `bash`, `edit`, `write`.
  - Navigator tools: `read`, `grep`, `find`, `ls`, `bash`; never `edit` or `write`.
  - For explicit `driverModel` or `navigatorModel`, fail before starting if unavailable or unauthenticated. Do not silently fallback.
  - If no role model is provided, use inherited/current Pi model.
  - On abort, abort and dispose both child sessions.
- **Snippet(s)**:

```ts
// current code anchor - child session creation seam, normative pattern
const services = await createAgentSessionServices({
  cwd,
  modelRegistry: ctx.modelRegistry,
  resourceLoaderOptions: {
    noExtensions: true,
    appendSystemPrompt: [config.prompt],
  },
});

const createChildSession = (model: ActiveModel) =>
  createAgentSessionFromServices({
    services,
    sessionManager: SessionManager.inMemory(cwd),
    model,
    tools: config.tools,
    thinkingLevel: pi.getThinkingLevel(),
  });
```

```ts
// current code anchor - event subscription seam, illustrative
nextSession.subscribe((event) => {
  switch (event.type) {
  case "tool_execution_start": {
    toolCalls.push({ name: event.toolName, args: event.args });
    liveStatus.currentTool = event.toolName;
    publishStatus();
    break;
  }
  case "message_end": {
    const message = event.message as Message;
    applyAssistantUsage(liveStatus, message);
    publishStatus();
    break;
  }
  case "agent_end": {
    finalMessages = event.messages as Message[];
    publishStatus();
    break;
  }
  }
});
```

```ts
// decision artifact - role tools, normative
const DRIVER_DRY_RUN_TOOLS = ["read", "grep", "find", "ls", "bash"];
const DRIVER_WORK_TOOLS = ["read", "grep", "find", "ls", "bash", "edit", "write"];
const NAVIGATOR_TOOLS = ["read", "grep", "find", "ls", "bash"];
```

- **Tests to extend**:
  - Pure tests for explicit unavailable override fails fast.
  - Pure tests for missing override uses inherited model.
  - Pure tests for tool allowlist selection by role and `dryRun`.
  - Pure tests for usage aggregation from multiple assistant messages if extraction can be tested without live sessions.
- **Wiring/build notes**:
  - Existing `subagents.ts` uses `noExtensions: true` to avoid recursive extension loading. Pair Program Tool must revisit this because Driver needs `skill-tdd` access in TDD mode.
  - Keep helper interfaces small; do not build a broad subagent framework.

### Area: Usage Tracking and Live Display

- **Decision IDs**: `MESO-010`, `MESO-013`, `MESO-014`
- **Current code anchors**:
  - `extensions/subagents.ts`: `applyAssistantUsage()` aggregates assistant message usage into child status.
  - `extensions/subagents.ts`: `SubagentUsage` shape includes tokens, cost, and model id.
  - `extensions/subagents.ts`: global `__subagent` state contributes child usage to footer totals.
  - `extensions/tool-panel.ts`: records subagent usage from tool result details.
- **Existing behavior**: The existing subagent tool reports usage per child run and contributes totals to the footer/tool panel.
- **Required edits**:
  - Track Driver and Navigator usage separately across their persistent sessions.
  - Expose a helper shape usable by final `pair_program` result:
    - input tokens
    - output tokens
    - cache tokens
    - total tokens
    - cost USD
    - model id
  - Avoid double-counting with existing `__subagent` totals.
- **Snippet(s)**:

```ts
// current code anchor - subagent usage shape, illustrative
interface SubagentUsage {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  costUsd: number;
  modelId?: string;
}
```

```ts
// decision artifact - pair usage summary, normative shape
interface PairUsageSummary {
  driverUsage: RoleUsage;
  navigatorUsage: RoleUsage;
  totalUsage: {
    totalTokens: number;
    costUsd: number;
  };
}

interface RoleUsage {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  costUsd: number;
  modelId: string;
}
```

## Acceptance criteria

- [ ] Driver and Navigator child sessions can be created with persistent in-memory session managers.
- [ ] Driver dry-run and work-mode tool allowlists match the PRD.
- [ ] Navigator never receives `edit` or `write`.
- [ ] Explicit role model overrides fail fast if unavailable or unauthenticated.
- [ ] Missing role model override uses the inherited/current Pi model.
- [ ] Role usage can be accumulated separately without using `__subagent`.
- [ ] Child sessions are aborted/disposed on parent abort or cleanup.
- [ ] Runtime evidence captured: `npm run check`; plus focused helper tests if a test harness is added.

## Blocked by

None - can start immediately.
