# Persist full transcripts and report role usage/live handoffs

Status: ready-for-agent
Type: AFK
Source PRD: `F:/MyWork/my-pi/.scratch/pair-program-tool-prd.md`

## What to build

Finish the MVP observability surface: persist full Markdown and JSON transcripts, stream important handoffs live through Pi tool updates/status UI, report practical final results, and include Driver/Navigator/total usage without double-counting existing subagent usage.

Decision IDs: `MESO-010`, `MESO-013`, `MESO-014`, `MICRO-004`.

## Implementation map

### Area: Workspace Evidence, Final Verification, and Transcripts

- **Decision IDs**: `MESO-010`, `MESO-011`, `MESO-012`, `MESO-013`, `MICRO-004`, `MICRO-005`
- **Current code anchors**:
  - `extensions/subagents.ts`: uses `onUpdate` to stream child-agent progress.
  - `extensions/subagents.ts`: returns `content` and `details` from a tool.
  - `extensions/subagents.ts`: listens to `ctx.signal`.
  - `extensions/tool-panel.ts`: shows compact usage/status patterns for tool UI.
  - `.scratch/` exists and is already used by project workflows.
- **Existing behavior**: `subagent` streams progress but does not save pair transcripts.
- **Required edits**:
  - Persist full transcript to:
    - `.scratch/pair-runs/<task-id-or-timestamp>.md`
    - `.scratch/pair-runs/<task-id-or-timestamp>.json`
  - Create `.scratch/pair-runs` lazily.
  - Save partial transcripts on abort/error where possible.
  - Tool result returns practical summary only, not full cycle audit.
- **Snippet(s)**:

```ts
// decision artifact - transcript JSON, illustrative shape
interface PairTranscript {
  task: string;
  mode: "tdd";
  status: "success" | "blocked" | "incomplete" | "error";
  startedAt: string;
  endedAt?: string;
  cycles: PairCycleRecord[];
  initialWorkspace: WorkspaceSnapshot;
  finalWorkspace?: WorkspaceSnapshot;
  finalVerification?: FinalVerificationRecord;
  usage: PairUsageSummary;
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
  - Unit tests for transcript path generation and JSON shape.
  - Manual verification that abort writes partial transcript.
- **Wiring/build notes**:
  - Use native Node filesystem APIs for transcript writes.

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
  - Report usage by role and total in final result:
    - input tokens
    - output tokens
    - cache tokens
    - total tokens
    - cost USD
    - model id
  - Consider adding global `__pairProgram` state or extending existing usage footer integration only if needed for live totals.
  - Live UI should show compact phase/cycle/role status and important handoffs, not raw full transcripts.
  - Avoid double-counting pair child usage with existing `__subagent` totals.
- **Snippet(s)**:

```ts
// current code anchor - subagent total accumulation, illustrative
if (u) {
  subagentState.totalCostUsd += u.costUsd ?? 0;
  subagentState.totalInputTokens += u.inputTokens ?? 0;
  subagentState.totalOutputTokens += u.outputTokens ?? 0;
  subagentState.totalCacheTokens += u.cacheTokens ?? 0;
  subagentState.totalTokens +=
    u.totalTokens ??
    (u.inputTokens ?? 0) + (u.outputTokens ?? 0) + (u.cacheTokens ?? 0);
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

- [ ] Markdown transcript is saved for each run.
- [ ] JSON transcript is saved for each run.
- [ ] Partial transcript is saved on abort/error when possible.
- [ ] Live Pi output streams important handoffs: Navigator preflight, Driver evidence, Navigator decisions, correction packets, blockers, final result.
- [ ] Final tool result includes status, summary, final Navigator decision, changed files, final verification result, transcript paths, usage by role, and total usage.
- [ ] Driver and Navigator usage are reported separately.
- [ ] Pair usage does not double-count with existing `__subagent` totals.
- [ ] Runtime evidence captured: `npm run check`; plus a manual `pair_program` run showing transcript files exist, contain cycle records, and final output includes usage.

## Blocked by

- 04-add-evidence-final-verification-and-status-handling
