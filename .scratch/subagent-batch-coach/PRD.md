# PRD: Subagent Workflow Custom Agents and Batch Coaching

Status: ready-for-agent

## Problem Statement

When `/subagent on` is enabled, pi exposes a subagent tool and rich workflow guidance, but the model still under-batches some independent work. Real Payroll session analysis showed the model correctly used parallel subagents for broad investigation, yet still wasted turns on sequential direct calls such as `git branch` → `gh --version` → `gh pr view`, sequential MCP playbook loads, and split `git diff --stat` / `git diff <file>` calls.

The user wants stronger model affordances for subagents and a targeted runtime nudge that catches the concrete failure mode: several consecutive single-tool turns that appear independent and should have been batched in one assistant message or chained inside one bash call.

## Solution

Keep `/subagent on` as the single opt-in switch. When it is off, pi behaves normally with no additional prompt cost or coaching. When it is on:

- The existing rich subagent workflow guidance remains active.
- Four project custom subagents are available and listed in the rich guidance block: `explore-fast`, `review-diff`, `find-callers`, and `test-runner`.
- A `turn_end` hook observes completed assistant turns and injects an evidence-grounded steering message when the model emits a repeated independent single-call pattern.
- The hook lives inside `extensions/subagents.ts` because it is intentionally coupled to `subagentModeEnabled`.

## User Stories

1. As a pi user, I want `/subagent off` to keep pi behavior unchanged, so that small sessions do not pay extra prompt or nudge cost.
2. As a pi user, I want `/subagent on` to enable all subagent workflow behavior, so that there is one simple master switch.
3. As a pi user, I want the model to see specialized custom subagents when subagent mode is enabled, so that it can delegate common investigation patterns proactively.
4. As a pi user, I want a fast read-only exploration agent, so that broad repo reconnaissance does not consume my main context with many reads and greps.
5. As a pi user, I want a fresh-context diff reviewer, so that missed rename stragglers or stale verification problems are caught before the model says done.
6. As a pi user, I want a caller-finding agent, so that refactors can identify definitions, imports, direct callers, and tests in one focused investigation.
7. As a pi user, I want a test-runner agent, so that long build/test logs are summarized rather than dumped into the parent context.
8. As a pi user, I want the model nudged when it emits several independent single bash probes sequentially, so that it learns to chain them with `&&`.
9. As a pi user, I want the model nudged when it says it will run work in parallel but then serializes it, so that self-narrated parallelism failures are corrected.
10. As a pi user, I want the nudge to cite the actual recent calls, so that the model receives specific corrective feedback rather than generic advice.
11. As a pi user, I want legitimate sequential dependencies such as `ls *.sln` → `dotnet build Payroll.sln` to avoid false-positive nudges, so that normal work is not interrupted.
12. As a pi maintainer, I want the detection logic contained in testable helpers, so that false positives can be tuned without rewriting extension wiring.
13. As a pi maintainer, I want project custom agents to be plain markdown, so that prompts can be refined without TypeScript changes.
14. As an AFK implementation agent, I want exact code anchors and contracts, so that I can implement without rereading the original grill conversation.

## Accepted Decision Register

- `MACRO-001`: Keep `/subagent on` as the single master opt-in switch.
  - Decision: When off, no rich guidance, no custom-agent visibility, and no batch-coach nudges. When on, all three are active.
  - Rationale: The user wants zero added prompt/nudge behavior unless subagent workflow is explicitly enabled.
  - Rejected alternatives: Always-on hook; separate `/batch-coach` toggle; default-on subagent mode.
  - Downstream impact: All new hook behavior must start with `if (!subagentModeEnabled) return;`.

- `MACRO-002`: Do not flip the default mode.
  - Decision: Preserve current default OFF behavior and existing `/subagent on/off` command semantics.
  - Rationale: Avoid the unconditional ~1200-token rich guidance cost.
  - Rejected alternatives: Default mode ON; auto-enable when custom agents exist.
  - Downstream impact: No change should make subagent guidance appear in normal sessions unless the session mode is enabled.

- `MACRO-003`: Ship four custom agents.
  - Decision: Add `explore-fast`, `review-diff`, `find-callers`, and `test-runner` as project agents.
  - Rationale: They map to repeated observed session patterns: broad recon, post-edit verification, refactor call-site discovery, and noisy test/build output.
  - Rejected alternatives: `pr-comments`, `docs-explorer`, and `e2e-test-driver` for v1 because they are narrower or already covered elsewhere.
  - Downstream impact: Create markdown files in `C:/my-pi/.pi/agents/`.

- `MACRO-004`: Ship the runtime batch-coach hook.
  - Decision: Add a `turn_end` listener that injects a steering message when repeated independent single-call turns are detected.
  - Rationale: Better subagent affordances do not fix non-subagent batching misses such as sequential bash probes or sequential MCP loads.
  - Rejected alternatives: Custom agents only; telemetry-only phase; C2 forced plan block.
  - Downstream impact: Implement detection and nudge generation in the extension.

- `MESO-001`: Keep batch-coach in `extensions/subagents.ts`.
  - Decision: Do not split into `batch-coach.ts` for v1.
  - Rationale: Under `MACRO-001`, the hook is runtime-coupled to `subagentModeEnabled`.
  - Rejected alternatives: Separate file with shared getter/state.
  - Downstream impact: Add helpers inside `subagents.ts`; comment that extraction is appropriate only if the hook becomes mode-independent.

- `MESO-002`: Use J3 detection.
  - Decision: Fire on three consecutive same-tool single-call turns from `{bash, read, grep, ls, mcp}` with dependency suppression, plus a self-narration exception.
  - Rationale: Balances false-positive risk with the observed Payroll failures.
  - Rejected alternatives: N=2 aggressive detection; N=3 only without self-narration exception; model-tier sensitivity.
  - Downstream impact: Implement ring-buffer state and helpers for same-tool detection, dependency suppression, and self-narration matching.

- `MESO-003`: Use visible assistant text only for self-narration.
  - Decision: Scan assistant `text` content blocks for parallel/batch wording; do not scan thinking.
  - Rationale: Visible text is a public commitment and is consistent across Opus, GLM, Qwen, and other models. Thinking is inconsistent and noisier.
  - Rejected alternatives: Thinking-only; text plus thinking.
  - Downstream impact: Regex must run only against message text blocks.

- `MESO-004`: Use M3 nudge wording.
  - Decision: Nudge includes evidence, corrective directive, and an extra self-narration callout when applicable.
  - Rationale: Generic prose already failed; the nudge must cite the specific calls and say what to do next.
  - Rejected alternatives: Minimal evidence-only nudge; evidence without self-narration callout.
  - Downstream impact: Implement a bounded nudge template with command summaries, not full outputs.

- `MICRO-001`: Suppress textual dependencies.
  - Decision: Do not nudge when the later tool input appears to use prior output; proposed substring threshold is `>= 6` characters.
  - Rationale: Avoid false positives on legitimate sequences like `ls *.sln` → `dotnet build Payroll.sln`.
  - Rejected alternatives: No suppression; LLM-judge dependency check.
  - Downstream impact: Keep short samples of prior tool outputs and compare them with later inputs.

- `MICRO-002`: Inject via `deliverAs: "steer"`.
  - Decision: Use `pi.sendMessage(..., { deliverAs: "steer" })` from `turn_end`.
  - Rationale: Pi guarantees steer messages are delivered after current tool calls finish and before the next LLM call.
  - Rejected alternatives: Modify provider payload directly; use `context` hook for v1.
  - Downstream impact: Nudge injection should be a custom message queued by the extension, not provider-specific payload mutation.

## Implementation Plan

### Area: Subagent mode and rich guidance integration

- **Decision IDs**: `MACRO-001`, `MACRO-002`, `MESO-001`
- **Current code anchors**:
  - `C:/my-pi/extensions/subagents.ts` — default export, `subagentModeEnabled`, `/subagent` command, `before_agent_start` rich guidance hook.
  - `C:/my-pi/package.json` — extension discovery via `"./extensions"`.
- **Existing behavior**: `subagentModeEnabled` starts false, can be toggled by `/subagent`, and the rich guidance block is appended only when the mode is enabled.
- **Required edits**:
  - Preserve default OFF behavior.
  - Preserve existing `/subagent on/off` command semantics.
  - Add the batch-coach hook in this same file and gate it on `subagentModeEnabled`.
  - Add a short code comment explaining that the hook lives here because it is intentionally gated by subagent mode.
- **Snippet(s)**:

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

```ts
// current code anchor — C:/my-pi/extensions/subagents.ts
pi.on("before_agent_start", async (event, ctx) => {
	if (!subagentModeEnabled) return;
	const customAgents = discoverCustomAgents(ctx.cwd)
		.slice(0, 20)
		.map((agent) => `- ${agent.name} (${agent.source}): ${agent.description || agent.filePath}`)
		.join("\n");
	const customAgentsText = customAgents.length > 0 ? customAgents : "- none discovered";
	return {
```

Normative: custom agents are visible through the existing rich guidance path only when mode is enabled.

- **Tests to extend**: No existing tests found. Add TypeScript helper functions that can be unit-tested later, and verify with `npm run check`.
- **Wiring/build notes**: `package.json` already registers `"./extensions"`; no new manifest wiring is needed if changes stay in `subagents.ts`.

### Area: Project custom subagent markdowns

- **Decision IDs**: `MACRO-003`
- **Current code anchors**:
  - `C:/my-pi/extensions/subagents.ts` — `discoverCustomAgents`, `loadCustomAgentsFromDir`, `CustomAgent` shape.
  - `C:/my-pi/README.md` — subagent custom-agent usage docs.
- **Existing behavior**: Agents are discovered from user `~/.pi/agent/agents` and nearest project `.pi/agents`; project agents override user agents by name.
- **Required edits**:
  - Create `C:/my-pi/.pi/agents/explore-fast.md`.
  - Create `C:/my-pi/.pi/agents/review-diff.md`.
  - Create `C:/my-pi/.pi/agents/find-callers.md`.
  - Create `C:/my-pi/.pi/agents/test-runner.md`.
  - Use supported comma-separated `tools` frontmatter format.
- **Snippet(s)**:

```ts
// current code anchor — C:/my-pi/extensions/subagents.ts
function discoverCustomAgents(cwd: string): CustomAgent[] {
	const userDir = path.join(getAgentDir(), "agents");
	const projectDir = findProjectAgentsDir(cwd);
	const byName = new Map<string, CustomAgent>();
	for (const agent of loadCustomAgentsFromDir(userDir, "user")) byName.set(agent.name, agent);
	if (projectDir) {
		for (const agent of loadCustomAgentsFromDir(projectDir, "project")) byName.set(agent.name, agent);
	}
	return [...byName.values()];
}
```

Normative: place project agents under `.pi/agents`; project names override user names.

```yaml
# decision artifact — frontmatter shape, normative
---
name: explore-fast
description: Fast read-only repo reconnaissance with concise evidence
tools: read, grep, find, ls
model: inherit
---
```

Normative: `tools` is a comma-separated string, not a YAML array, because the current loader splits strings on commas.

- **Tests to extend**: Use `/subagents` manually to verify discovery. Use `npm run check` for TypeScript changes; markdown changes do not need compilation.
- **Wiring/build notes**: Child custom agents default to `read, grep, find, ls` if `tools` is omitted. `test-runner` must explicitly include `bash`.

### Area: Batch-coach detection state and helpers

- **Decision IDs**: `MESO-001`, `MESO-002`, `MESO-003`, `MICRO-001`
- **Current code anchors**:
  - `C:/my-pi/extensions/subagents.ts` — no current top-level `turn_end` hook; existing child-session `turn_end` subscription is unrelated.
  - Installed pi extension docs/types verify top-level `turn_end` payload includes `turnIndex`, assistant `message`, and all `toolResults`.
- **Existing behavior**: The parent extension does not analyze completed turns for batching misses.
- **Required edits**:
  - Add a small ring buffer of recent assistant turns inside `subagents.ts`.
  - Summarize each `turn_end` into a typed record containing turn index, tool-call count, tool name, compact input summary, output sample, visible text, and error status.
  - Detect three consecutive same-tool single-call turns for tools in `{bash, read, grep, ls, mcp}`.
  - Detect J3 self-narration using visible assistant text only.
  - Suppress when textual dependency is detected between prior output and later input.
  - Reset or mark the buffer after firing to avoid repeated nudges for the same stretch.
- **Snippet(s)**:

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

Illustrative: exact field names may vary, but the state must be typed and bounded.

```ts
// decision artifact — normative regex source
const SELF_NARRATED_BATCHING_RE =
	/\b(in parallel|concurrently|simultaneously|in one (call|message|turn)|batch (these|them|the)|batched)\b/i;
```

Normative: scan visible text only, not thinking blocks.

- **Tests to extend**: Add pure helper tests if the repo gains a test runner later. For v1, validate manually against the Payroll JSONL patterns and run `npm run check`.
- **Wiring/build notes**: Avoid provider-specific APIs. Use the high-level extension event payload and message content blocks.

### Area: Batch-coach steering message

- **Decision IDs**: `MESO-004`, `MICRO-002`
- **Current code anchors**:
  - Installed pi docs/types confirm `pi.sendMessage(message, { deliverAs: "steer" })`.
- **Existing behavior**: No steering message is injected after repeated sequential tool use.
- **Required edits**:
  - From the gated `turn_end` hook, call `pi.sendMessage` only when detection fires.
  - Use `customType: "subagent-batch-coach"` or similar.
  - Prefer `display: false` unless the implementer confirms hidden custom messages are still included in model context. If hidden messages are not model-visible, use `display: true` with concise text.
  - Keep nudge bounded; summarize inputs and never dump full stdout.
- **Snippet(s)**:

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
// decision artifact — normative nudge template
You wrote "{matched phrase}" but then executed the calls sequentially.

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

Normative: include self-narration callout only when J3 matched; otherwise omit the first sentence.

- **Tests to extend**: Manual session test with `/subagent on`, then reproduce three single bash probes and confirm a steering message affects the next assistant turn.
- **Wiring/build notes**: `turn_end` return value is ignored; do not try to return context from the handler.

### Area: Build and verification

- **Decision IDs**: `MICRO-002`
- **Current code anchors**:
  - `C:/my-pi/package.json` defines `"check": "tsc --noEmit"`.
  - `C:/my-pi/tsconfig.json` includes `extensions/**/*.ts`.
- **Existing behavior**: There is no `npm test` script and no discovered test files.
- **Required edits**:
  - Run `npm run check` after TypeScript changes.
  - Manually verify custom-agent discovery with `/subagents` and rich prompt behavior with `/subagent on`.
- **Snippet(s)**:

```json
// current code anchor — C:/my-pi/package.json
"scripts": {
  "check": "tsc --noEmit"
}
```

Normative: `npm run check` is the required compile gate.

- **Tests to extend**: None existing. If adding tests becomes in scope, test pure helper functions for detection/suppression rather than full extension runtime.
- **Wiring/build notes**: Markdown agent files are loaded dynamically and do not require a build step.

## Global Build & Wiring Notes

- Extensions are discovered through `package.json` under `pi.extensions`, currently including `"./extensions"`.
- Project custom agents are discovered from the nearest `.pi/agents/` directory walking up from `cwd`.
- Project custom agents override user custom agents with the same name.
- `tools` frontmatter is currently parsed as a comma-separated string. Do not use YAML array syntax unless the loader is extended.
- Use `npm run check` as the compile gate.
- Local issue tracker for this PRD is `.scratch/subagent-batch-coach/PRD.md`.

## Testing Decisions

- Test behavior through public extension behavior, not implementation details.
- For TypeScript changes, `npm run check` is mandatory.
- Detection logic should be written as pure helpers so future tests can cover:
  - Three independent single bash turns produce a nudge.
  - `ls *.sln` → `dotnet build Payroll.sln` is suppressed by dependency detection.
  - Visible text containing "in parallel" triggers the J3 callout.
  - Thinking-only batching language does not trigger J3.
  - `/subagent off` prevents all hook behavior.
- Manual verification should include:
  - `/subagent on` lists the four custom agents in the rich guidance path.
  - `/subagent off` leaves normal behavior unchanged.
  - A controlled three-turn same-tool sequence produces a steering message before the next LLM call.

## Out of Scope

- Defaulting `/subagent` mode to ON.
- Separate `/batch-coach` command or separate batch-coach toggle.
- Model-tier sensitivity for Opus/Sonnet/DeepSeek/GLM/Qwen.
- LLM-judge dependency classification.
- GitHub Issues publication; this PRD uses the repository's local `.scratch/` tracker convention.
- Fixing unrelated output-truncation habits such as `dotnet test | tail -6` beyond what `test-runner` may help with.
- Adding a general telemetry-only phase before nudging.

## Unresolved Gaps

- Exact textual-dependency threshold is proposed as substring length `>= 6`, but may need tuning after real use.
- Need to confirm whether `display: false` custom steer messages are model-visible. If not, use `display: true` with concise wording.
- No existing automated test harness for extensions was found; implementation may rely on `npm run check` plus manual verification.

## Further Notes

This PRD intentionally keeps the batch-coach hook inside `extensions/subagents.ts`. If a future decision makes the hook active even when `/subagent` mode is off, extract it into a separate extension file because the runtime coupling will no longer exist.

The code-grounding pass verified that pi already packs parallel tool results correctly into a single Anthropic `user` message in `@earendil-works/pi-ai/dist/providers/anthropic.js:861-893`, so no provider-message-format patch is required.
