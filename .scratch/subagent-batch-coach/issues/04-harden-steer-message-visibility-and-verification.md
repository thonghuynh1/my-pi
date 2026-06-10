# Harden steer-message visibility and verification

Status: ready-for-agent

## What to build

Resolve the remaining steer-message visibility gap and document a reliable manual verification path. Confirm whether `display: false` steer custom messages are visible to the model. If not, use concise `display: true` for batch-coach nudges.

Decision IDs: `MESO-004`, `MICRO-002`

## Implementation map

### Area: Batch-coach steering message

- **Decision IDs**: `MESO-004`, `MICRO-002`
- **Current code anchors**:
  - `C:/my-pi/extensions/subagents.ts` — batch-coach nudge injection from issue 02/03.
  - Pi docs/types for `pi.sendMessage(message, { deliverAs: "steer" })`.
- **Existing behavior**: After issue 02, steering messages are queued via `deliverAs: "steer"`; the PRD left one unresolved gap around whether `display: false` custom messages are model-visible.
- **Required edits**:
  - Verify whether `display: false` steer messages are included in the next model context.
  - If hidden messages are model-visible, keep `display: false` to avoid UI noise.
  - If hidden messages are not model-visible, switch batch-coach nudges to concise `display: true`.
  - Keep nudge content bounded and avoid dumping stdout.

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

Normative: use `deliverAs: "steer"`; only the `display` value is under investigation in this slice.

### Area: Build and verification

- **Decision IDs**: `MICRO-002`
- **Current code anchors**:
  - `C:/my-pi/package.json` defines `"check": "tsc --noEmit"`.
  - `C:/my-pi/tsconfig.json` includes `extensions/**/*.ts`.
- **Existing behavior**: No automated extension tests are present; verification is `npm run check` plus manual runtime repro.
- **Required edits**:
  - Add or update developer-facing comments/docs near the hook with the exact manual verification recipe.
  - Run `npm run check`.
  - Capture runtime evidence from a manual session.

```json
// current code anchor — C:/my-pi/package.json
"scripts": {
  "check": "tsc --noEmit"
}
```

### Global Build & Wiring Notes

- Extensions are discovered through `package.json` under `pi.extensions`, currently including `"./extensions"`.
- Use `npm run check` as the compile gate.
- Markdown agent files are loaded dynamically and do not require a build step.

## Acceptance criteria

- [ ] The implementation confirms whether `display: false` steer messages are model-visible.
- [ ] If `display: false` is not model-visible, batch-coach nudges use concise `display: true`.
- [ ] A comment or local note documents why the chosen `display` value is correct.
- [ ] Manual verification recipe is documented near the hook or in an implementation note.
- [ ] Runtime evidence captured: `/subagent on` followed by a controlled batching miss causes the next model turn to react to the nudge.
- [ ] Runtime evidence captured: `/subagent off` followed by the same pattern causes no nudge.
- [ ] `npm run check` succeeds.

## Blocked by

- `02-add-gated-batch-coach-turn-end-hook.md`
