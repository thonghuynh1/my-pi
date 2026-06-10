# Add gated batch-coach turn_end hook with base detection

Status: ready-for-agent

## What to build

Add a `turn_end` listener inside `extensions/subagents.ts` that is active only when `/subagent on` is enabled. It should track recent completed assistant turns, detect three consecutive same-tool single-call turns that appear independent, and inject a concise steering message before the next LLM call.

Decision IDs: `MACRO-001`, `MACRO-004`, `MESO-001`, `MESO-002`, `MESO-004`, `MICRO-001`, `MICRO-002`

## Implementation map

### Area: Subagent mode and rich guidance integration

- **Decision IDs**: `MACRO-001`, `MACRO-002`, `MESO-001`
- **Current code anchors**:
  - `C:/my-pi/extensions/subagents.ts` — default export, `subagentModeEnabled`, `/subagent` command, `before_agent_start` rich guidance hook.
  - `C:/my-pi/package.json` — extension discovery via `"./extensions"`.
- **Existing behavior**: `subagentModeEnabled` starts false, can be toggled by `/subagent`, and the rich guidance block is appended only when the mode is enabled.
- **Required edits**:
  - Preserve default OFF behavior.
  - Preserve existing `/subagent on/off` command semantics.
  - Add batch-coach hook in this same file and gate it on `subagentModeEnabled`.
  - Add a short code comment explaining that the hook lives here because it is intentionally gated by subagent mode.

```ts
// current code anchor — C:/my-pi/extensions/subagents.ts
export default function (pi: ExtensionAPI) {
	let subagentModeEnabled = false;
	const activeSubagents = new Map<string, RunningSubagentStatus>();

	const subagentState = ((globalThis as any).__subagent ??= {
		enabled: false,
		active: 0,
		label: "off",
```

Normative: `subagentModeEnabled` remains the master gate for new behavior.

### Area: Batch-coach detection state and helpers

- **Decision IDs**: `MESO-001`, `MESO-002`, `MESO-003`, `MICRO-001`
- **Current code anchors**:
  - `C:/my-pi/extensions/subagents.ts` — no current top-level `turn_end` hook.
  - Installed pi extension API exposes `turn_end` with `turnIndex`, assistant `message`, and all `toolResults`.
- **Existing behavior**: The parent extension does not analyze completed turns for batching misses.
- **Required edits**:
  - Add a bounded ring buffer of recent assistant turns inside `subagents.ts`.
  - Summarize each `turn_end` into a typed record containing turn index, tool-call count, tool name, compact input summary, output sample, visible text, and error status.
  - Detect three consecutive same-tool single-call turns for tools in `{bash, read, grep, ls, mcp}`.
  - Suppress when textual dependency is detected between prior output and later input.
  - Reset or mark the buffer after firing to avoid repeated nudges for the same stretch.
  - Do not implement self-narrated parallelism callout here; that is issue 03.

```ts
// decision artifact — illustrative helper shape
type BatchCoachToolName = "bash" | "read" | "grep" | "ls" | "mcp";

interface BatchCoachTurnRecord {
	turnIndex: number;
	toolCallCount: number;
	toolName?: string;
	inputSummary?: string;
	outputSample?: string;
	visibleText: string;
	isError: boolean;
}
```

Illustrative: exact field names may vary, but state must be typed and bounded.

### Area: Batch-coach steering message

- **Decision IDs**: `MESO-004`, `MICRO-002`
- **Current code anchors**:
  - Pi API supports `pi.sendMessage(message, { deliverAs: "steer" })`.
- **Existing behavior**: No steering message is injected after repeated sequential tool use.
- **Required edits**:
  - From the gated `turn_end` hook, call `pi.sendMessage` only when detection fires.
  - Use `customType: "subagent-batch-coach"` or similar.
  - Keep nudge bounded; summarize inputs and never dump full stdout.
  - Use base M3 nudge without self-narration line in this slice.

```ts
// current code anchor — installed pi extension API shape
sendMessage<T = unknown>(
  message: Pick<CustomMessage<T>, "customType" | "content" | "display" | "details">,
  options?: {
    triggerTurn?: boolean;
    deliverAs?: "steer" | "followUp" | "nextTurn";
  }
): void;
```

Normative: use `deliverAs: "steer"` for before-next-LLM-call delivery.

```text
// decision artifact — base nudge template, normative
Your last turns were independent single-call probes:
1. {tool}({summary})
2. {tool}({summary})
3. {tool}({summary})

Before your next tool call, plan the next 2–3 calls together. If independent, batch them via:
- one chained bash command: `cmd1 && cmd2`
- multiple tool calls in the same assistant message
- a focused subagent when the work spans several files

Continue your work — but batched.
```

### Area: Build and verification

- **Decision IDs**: `MICRO-002`
- **Current code anchors**:
  - `C:/my-pi/package.json` defines `"check": "tsc --noEmit"`.
  - `C:/my-pi/tsconfig.json` includes `extensions/**/*.ts`.
- **Required edits**:
  - Run `npm run check` after TypeScript changes.

```json
// current code anchor — C:/my-pi/package.json
"scripts": {
  "check": "tsc --noEmit"
}
```

## Acceptance criteria

- [ ] `extensions/subagents.ts` registers a top-level `pi.on("turn_end", ...)` handler.
- [ ] Handler returns immediately when `subagentModeEnabled` is false.
- [ ] Handler detects 3 consecutive same-tool single-call turns for `{bash, read, grep, ls, mcp}`.
- [ ] Handler suppresses obvious dependencies such as later input containing meaningful prior output text.
- [ ] Handler injects a bounded steering message with `pi.sendMessage(..., { deliverAs: "steer" })`.
- [ ] Hook avoids repeated nudges for the same detected stretch.
- [ ] Runtime evidence captured: manual `/subagent on` repro with three same-tool independent single-call turns and observed next-turn steering behavior.
- [ ] Runtime evidence captured: `/subagent off` repro showing no steering behavior.
- [ ] `npm run check` succeeds.

## Blocked by

None - can start immediately
