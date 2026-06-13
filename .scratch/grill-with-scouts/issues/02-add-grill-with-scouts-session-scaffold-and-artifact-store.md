# Add Grill With Scouts session scaffold and artifact store

Status: ready-for-agent

## What to build

Add the first end-to-end Grill With Scouts path in `my-pi`: `/grill-with-scouts` starts a managed planning session, records deterministic session state, and writes canonical artifacts into the active repo's `.scratch/grill-with-scouts/` store. This slice does not need to execute scouts yet.

Decision IDs: `MACRO-001`, `MACRO-002`, `MACRO-003`, `MICRO-004`

## Implementation map

### Area: Pi managed session runtime

- **Decision IDs**: `MACRO-001`, `MACRO-002`
- **Current code anchors**:
  - `F:/MyWork/my-pi/extensions/subagents.ts`: registers the existing `subagent` tool, `/subagent`, `/subagents`, and model-selection commands.
  - `F:/MyWork/my-pi/extensions/engineering-skills.ts`: registers command handlers and status for Engineering Skills MCP.
  - `F:/MyWork/my-pi/package.json`: extension discovery uses `"./extensions"`.
- **Existing behavior**: Pi has an opt-in subagent workflow mode and extension commands, but no managed planning session.
- **Required edits**:
  - Add a new Grill With Scouts extension module under `extensions/`, or a scoped module if sharing helper code is necessary.
  - Register `/grill-with-scouts` to start or show a Grill With Scouts Session.
  - Maintain initial deterministic session state: session id, goal, current tier, current decision, accepted decisions, Scout Gates, Durable Scout Findings, Scout Gaps, context pressure, checkpoints, handoff readiness.
  - Keep the normal Pi conversation human-facing; this command starts managed mode rather than replacing the chat runtime.
- **Snippet(s)**:

```ts
// current code anchor -- command registration style
pi.registerCommand("engineering-skills-mcp-setup", {
  description: "Alias for /engineering-skill <path-to-engineering-skills-mcp-repo>.",
  handler: setupEngineeringSkills,
});
```

Illustrative: `/grill-with-scouts` should follow the existing command registration style.

### Area: Grill Artifact Store and handoff persistence

- **Decision IDs**: `MACRO-003`, `MICRO-004`
- **Current code anchors**:
  - `F:/MyWork/my-pi/.scratch/subagent-batch-coach/PRD.md`: existing local planning artifact pattern.
  - `F:/MyWork/my-pi/extensions/frontend-coach/records.ts`: writes structured JSON and Markdown records to disk.
- **Existing behavior**: The repo uses `.scratch/<feature>/PRD.md` and issue files. Grill With Scouts has no artifact store.
- **Required edits**:
  - Create `.scratch/grill-with-scouts/` in the active target repo when the first session artifact is written.
  - Persist initial `session.json`, `transcript.md`, and `handoff.md` under a session id.
  - Maintain `.scratch/grill-with-scouts/latest-handoff.md` as a pointer or copy for `to-prd`.
  - Ensure artifact writes are idempotent and safe to retry.
- **Snippet(s)**:

```text
// decision artifact -- normative artifact layout
.scratch/grill-with-scouts/
  latest-handoff.md
  sessions/
    <session-id>/
      session.json
      transcript.md
      handoff.md
      checkpoints/
        001.md
        latest.md
      scouts/
        <gate-id>-backend.md
        <gate-id>-frontend.md
        <gate-id>-qa.md
        <gate-id>-runtime.md
```

Normative: canonical planning artifacts live in the active target repo, not a Pi global data directory.

```ts
// current code anchor -- record persistence precedent
writeFileSync(paths.json, JSON.stringify(report, null, 2), "utf8");
writeFileSync(paths.md, renderMarkdown(report), "utf8");
```

Illustrative: the Grill Artifact Store should write both machine-readable JSON and human-readable Markdown artifacts.

### Global build and wiring notes

- `my-pi` verification command: `npm run check`.
- Use the active `ctx.cwd` as the target repo root.
- Do not write canonical Grill With Scouts planning artifacts to Pi global storage.

## Acceptance criteria

- [ ] `/grill-with-scouts <goal>` starts a managed Grill With Scouts Session.
- [ ] Starting a session creates `.scratch/grill-with-scouts/` in the active target repo.
- [ ] Session metadata is written to `sessions/<session-id>/session.json`.
- [ ] Human-readable `transcript.md` and `handoff.md` are initialized.
- [ ] `latest-handoff.md` is created or updated.
- [ ] Re-running or showing the command does not corrupt existing session artifacts.
- [ ] Runtime evidence captured: command transcript or manual Pi session showing `/grill-with-scouts` creates the expected artifact files, plus `npm run check`.

## Blocked by

None - can start immediately
