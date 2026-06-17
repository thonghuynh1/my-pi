---
status: closed
---

# Capture role telemetry with sanitized proof IDs

Status: ready-for-agent

## Parent

- [PRD](../PRD.md)

## What to build

Record child-session tool telemetry for Driver and Navigator. Subscribe to Pi child `AgentSession` tool events, correlate starts and ends by `toolCallId`, normalize the action into proof kinds, redact unsafe details, and expose stable coordinator telemetry IDs for later proof maps.

Decision IDs: `DEC-003`, `DEC-014`, `DEC-015`, `DEC-016`, `DEC-017`.

User stories covered: 7, 13, 14.

## Implementation map

### Area: Role Sessions and Telemetry Capture

- **Decision IDs**: `DEC-003`, `DEC-014`, `DEC-015`, `DEC-016`, `DEC-017`
- **Current code anchors**:
  - `extensions/lib/agent-session-utils.ts` `RoleSession`
  - `extensions/lib/agent-session-utils.ts` `DRIVER_TOOLS`, `NAVIGATOR_TOOLS`
  - `extensions/lib/agent-session-utils.ts` `createRoleSession`
  - Pi SDK docs: `AgentSession.subscribe()` exposes `tool_execution_start`, `tool_execution_end`, and `turn_end`.
- **Existing behavior**: Role sessions are persistent child `AgentSession`s. Usage is accumulated from `message_end`. Tool telemetry is not recorded. Driver has write tools; Navigator has read/search/bash only.
- **Required edits**:
  - Extend `RoleSession` with telemetry storage and a per-role/per-phase active context.
  - Subscribe to `tool_execution_start` and `tool_execution_end` inside `createRoleSession` and correlate by `toolCallId`.
  - Normalize telemetry into `skill_load`, `file_read`, `search`, `command`, `file_write`, and `artifact_inspection`.
  - Persist sanitized summaries. Keep raw `toolCallId` internally; expose IDs such as `driver-c1-t3`, `nav-r2-t1`, and `nav-final-t2` in prompts and proof maps.
  - Redact commands and store command previews plus exit code, not full command strings.
  - Treat failed telemetry as attempt evidence only.
- **Snippet(s)**:

```ts
// current code anchor. Existing subscription proves child sessions can gather telemetry.
created.session.subscribe((event) => {
  if (event.type === "message_end") {
    const message = event.message as Message;
    roleSession.usage = accumulateUsage(roleSession.usage, message);
  }
});
```

```ts
// current code anchor. Navigator already has no write tools. Preserve this boundary.
export const DRIVER_TOOLS: readonly string[] = ["read", "grep", "find", "ls", "bash", "edit", "write"];
export const NAVIGATOR_TOOLS: readonly string[] = ["read", "grep", "find", "ls", "bash"];
```

```ts
// decision artifact. Normative telemetry summary shape.
interface PairTelemetrySummary {
  id: string;
  rawToolCallId: string;
  role: "driver" | "navigator";
  phase: string;
  cycle?: number;
  toolName: string;
  kind: "skill_load" | "file_read" | "search" | "command" | "file_write" | "artifact_inspection";
  targetPreview?: string;
  commandPreview?: string;
  redacted: boolean;
  success: boolean;
  exitCode?: number;
  timestamp: string;
}
```

- **Tests to extend**:
  - Unit tests for telemetry event correlation, ID generation, command redaction, failed-call semantics, and role/phase assignment.
  - Regression test that Navigator write-like telemetry cannot satisfy review proof.
- **Wiring/build notes**:
  - Pi docs verify `AgentSession.subscribe()` event names. No SDK API gap remains.

### Area: Pair Protocol State Machine

- **Decision IDs**: `DEC-004`, `DEC-005`, `DEC-008`, `DEC-010`, `DEC-011`, `DEC-012`, `DEC-023`, `DEC-027`
- **Required edits for this slice**:
  - Provide a way for the protocol runner to set the active telemetry phase and cycle before each role prompt.
  - Attach sanitized telemetry summaries to Pair Run State or a compatible transitional state until slice 3 lands.

## Acceptance criteria

- [ ] Driver and Navigator role sessions subscribe to `tool_execution_start` and `tool_execution_end`.
- [ ] Telemetry events are correlated by raw `toolCallId`.
- [ ] Telemetry summaries record role, phase, cycle, tool name, normalized kind, target or command preview, success/error, exit code when available, timestamp, and raw `toolCallId`.
- [ ] Exposed telemetry IDs use the accepted hybrid format, such as `driver-c1-t3`, `nav-r2-t1`, and `nav-final-t2`.
- [ ] Full raw command strings are not stored in Pair Run State; summaries store redacted previews and exit codes.
- [ ] Failed telemetry is retained as attempt evidence but marked unable to prove successful acceptance criteria.
- [ ] Navigator remains non-writing. Existing Navigator tool allowlist stays read/search/bash only.
- [ ] Tests cover telemetry correlation, ID generation, redaction, failure semantics, and role/phase assignment.
- [ ] Runtime evidence captured: run the new telemetry tests and `npm run check`, and include passing output in the implementation summary.

## Blocked by

None - can start immediately.
