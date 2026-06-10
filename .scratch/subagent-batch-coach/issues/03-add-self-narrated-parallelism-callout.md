# Add self-narrated parallelism detection and callout

Status: ready-for-agent

## What to build

Extend the batch-coach hook so that when the model visibly says it will batch or run work in parallel but then serializes same-tool calls, the steering message explicitly calls out that mismatch.

Decision IDs: `MESO-002`, `MESO-003`, `MESO-004`

## Implementation map

### Area: Batch-coach detection state and helpers

- **Decision IDs**: `MESO-001`, `MESO-002`, `MESO-003`, `MICRO-001`
- **Current code anchors**:
  - `C:/my-pi/extensions/subagents.ts` — batch-coach helper code from issue 02.
- **Existing behavior**: After issue 02, the extension detects base 3-turn same-tool independent single-call stretches and emits a base nudge. It does not yet special-case visible self-narrated batching intent.
- **Required edits**:
  - Scan visible assistant `text` content blocks only.
  - Do not scan thinking blocks.
  - Add the self-narration regex.
  - Pass matched phrase/context into nudge generation when applicable.
  - Keep base detection behavior intact.

```ts
// decision artifact — normative regex source
const SELF_NARRATED_BATCHING_RE =
	/\b(in parallel|concurrently|simultaneously|in one (call|message|turn)|batch (these|them|the)|batched)\b/i;
```

Normative: scan visible text only, not thinking blocks.

```ts
// decision artifact — illustrative turn record field
interface BatchCoachTurnRecord {
	turnIndex: number;
	visibleText: string;
	// other fields from issue 02 omitted
}
```

Illustrative: exact field names may vary, but visible text must be captured from assistant text blocks.

### Area: Batch-coach steering message

- **Decision IDs**: `MESO-004`, `MICRO-002`
- **Current code anchors**:
  - `C:/my-pi/extensions/subagents.ts` — nudge generation from issue 02.
- **Existing behavior**: Base nudge cites recent single-call probes and tells the model to batch future independent calls.
- **Required edits**:
  - When self-narration matched, prepend the callout line.
  - When no self-narration matched, preserve the base issue-02 nudge.
  - Do not dump full assistant text; include only the matched phrase or a short bounded excerpt.

```text
// decision artifact — self-narration callout, normative
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

Normative: include the first sentence only when self-narration matched.

### Area: Build and verification

- **Decision IDs**: `MICRO-002`
- **Current code anchors**:
  - `C:/my-pi/package.json` defines `"check": "tsc --noEmit"`.
- **Required edits**:
  - Run `npm run check`.
  - Manually verify with a controlled prompt that produces visible text such as “I’ll load these in parallel,” then sequential same-tool calls.

## Acceptance criteria

- [ ] Detection scans assistant visible `text` content only.
- [ ] Detection does not inspect thinking blocks.
- [ ] Regex matches phrases including `in parallel`, `concurrently`, `simultaneously`, `in one message`, `batch them`, and `batched`.
- [ ] Self-narration match adds the callout sentence to the nudge.
- [ ] Base nudge behavior from issue 02 still works when no self-narration matched.
- [ ] Runtime evidence captured: controlled repro showing self-narration callout appears in the steering message.
- [ ] `npm run check` succeeds.

## Blocked by

- `02-add-gated-batch-coach-turn-end-hook.md`
