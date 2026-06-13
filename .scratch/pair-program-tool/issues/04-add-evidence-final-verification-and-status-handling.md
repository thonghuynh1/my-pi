# Add workspace evidence, final verification, and completion status handling

Status: ready-for-agent
Type: AFK
Source PRD: `F:/MyWork/my-pi/.scratch/pair-program-tool-prd.md`

## What to build

Extend the dry-run pair loop into a practical TDD coordinator: collect neutral workspace evidence, pass git evidence to Navigator reviews, support one correction packet per cycle, support one Driver clarification path, run final verification when configured or requested, and produce correct `success | blocked | incomplete | error` statuses.

Decision IDs: `MESO-006`, `MESO-008`, `MESO-009`, `MESO-011`, `MESO-012`, `MESO-013`, `MICRO-002`, `MICRO-003`, `MICRO-004`, `MICRO-005`.

## Implementation map

### Area: Workspace Evidence, Final Verification, and Transcripts

- **Decision IDs**: `MESO-010`, `MESO-011`, `MESO-012`, `MESO-013`, `MICRO-004`, `MICRO-005`
- **Current code anchors**:
  - `extensions/subagents.ts`: uses `onUpdate` to stream child-agent progress.
  - `extensions/subagents.ts`: returns `content` and `details` from a tool.
  - `extensions/subagents.ts`: listens to `ctx.signal`.
  - `extensions/tool-panel.ts`: shows compact usage/status patterns for tool UI.
  - `.scratch/` exists and is already used by project workflows.
- **Existing behavior**: `subagent` streams progress but does not save pair transcripts. Tool panel and usage footer already display tool/session usage patterns.
- **Required edits**:
  - At run start, snapshot initial workspace state:
    - `git status --short`
    - `git diff --stat`
    - optionally truncated `git diff` if small enough.
  - Before Navigator review, collect current neutral evidence:
    - `git status --short`
    - `git diff --stat`
    - truncated `git diff`.
  - Do not attempt exact attribution of pair-created vs pre-existing changes in MVP.
  - Driver owns per-cycle test runs. Coordinator runs `testCommand` only for final verification or when Navigator requests verification.
  - Choose final verification command by priority:
    1. `pair_program({ testCommand })`
    2. task metadata if later provided
    3. Navigator preflight recommendation
    4. repo default detection, such as `package.json` scripts.
  - Tool result returns practical summary only, not full cycle audit.
- **Snippet(s)**:

```ts
// current code anchor - live update and tool result pattern, illustrative
execute: async (toolCallId, params, _signal, onUpdate, ctx) => {
  const result = await runSubagent(pi, ctx, toolCallId, params, onUpdate as any, (status) => {
    if (status) activeSubagents.set(toolCallId, status);
    else activeSubagents.delete(toolCallId);
    refreshSubagentStatusWidget(ctx);
  });

  if (result.status === "error") {
    return {
      content: [{ type: "text", text: `Subagent ${result.type}:${result.name} failed: ${result.error}` }],
      details: { ...result },
    };
  }

  return {
    content: [{ type: "text", text: truncateForToolResult(result.output) }],
    details: { ...result },
  };
}
```

```ts
// decision artifact - transcript result, normative shape
interface PairProgramResult {
  status: "success" | "blocked" | "incomplete" | "error";
  summary: string;
  finalNavigatorDecision?: string;
  changedFiles: string[];
  finalVerification?: {
    command: string;
    exitCode: number;
    summary: string;
  };
  transcriptMarkdownPath: string;
  transcriptJsonPath: string;
  usage: PairUsageSummary;
}
```

- **Tests to extend**:
  - Unit tests for git evidence truncation helpers.
  - Unit tests for final verification status mapping.
  - Manual verification that abort writes partial transcript once issue 05 transcript files exist.
- **Wiring/build notes**:
  - Use safe command execution for git/test evidence; avoid destructive commands.

### Area: Pair Protocol, Memory, and Prompt Contracts

- **Decision IDs**: `MESO-004`, `MESO-005`, `MESO-006`, `MESO-007`, `MESO-008`, `MESO-009`, `MESO-016`, `MICRO-002`
- **Current code anchors**:
  - `extensions/subagents.ts`: one-shot prompt assembly and `session.prompt(prompt)` usage.
- **Existing behavior**: Issue 03 should provide the basic dry-run loop.
- **Required edits**:
  - Implement `DECISION: request_revision` correction flow:
    - require `## Correction Packet` and `## Required Evidence`;
    - send one correction turn to Driver;
    - send revised evidence to Navigator once.
  - Implement Driver `## Clarification Needed` flow:
    - send one targeted clarification to Navigator;
    - allow `## Checklist Amendment` only when explicitly marked.
  - If final verification fails, send the failure to Navigator for classification.
  - Do not infer `blocked`; only Navigator can declare `blocked`.

## Acceptance criteria

- [ ] Initial git status/diff snapshot is captured and included in pair memory/prompts.
- [ ] Current git status/diff snapshot is captured before Navigator review.
- [ ] Evidence is truncated/summarized so large diffs do not flood prompts.
- [ ] One correction packet per cycle is enforced.
- [ ] Driver clarification path allows one Navigator answer and then continues the same cycle.
- [ ] Final verification runs from `testCommand` when provided.
- [ ] Failed final verification is sent to Navigator for classification.
- [ ] `blocked` only occurs when Navigator says `DECISION: blocked`.
- [ ] Abort returns `incomplete` or `error` and does not leave child sessions running.
- [ ] Runtime evidence captured: `npm run check`; plus manual dry-run and one work-mode tiny task showing evidence collection and final verification behavior.

## Blocked by

- 03-implement-dry-run-pair-loop
