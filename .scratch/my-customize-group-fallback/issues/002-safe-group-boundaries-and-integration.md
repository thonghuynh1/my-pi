---
id: "002"
title: "Harden My Customize group runs around protected and special messages"
labels: [ready-for-agent]
depends_on:
  - .scratch/my-customize-group-fallback/issues/001-non-frozen-group-fallback.md
status: closed
---
Status: ready-for-agent

# Harden My Customize group runs around protected and special messages

## What to build

Extend the non-frozen group fallback so groups are built only from safe contiguous non-MCP/non-user runs. Preserve MCP, recall, pstack identity/provenance, user, held, protected, and already-grouped blocks as hard boundaries. Allow non-MCP tool call/result content to participate where the host can safely snap the range to whole messages, and enforce the single-disposition invariant so no member is both grouped and folded/replaced in one plan.

This slice implements `DEC-004`, `DEC-005`, `DEC-006`, `DEC-007`, and `DEC-010`, and consumes issue 001's actual group command path.

User stories covered:

- MCP/pstack/recall recovery remains individually identifiable.
- User intent is never hidden inside an unrelated bloat group.
- Non-MCP tool-heavy regions can be grouped.
- Grouping never emits irreversible drop groups.

## Implementation map

### Safe contiguous group-run construction

**Code anchors:**

- `F:/MyWork/my-pi/vendor/accordion/conductors/my-customize-conductor/my-customize-conductor.ts`
  - `MyCustomizeConductor.conduct()`
  - the per-pass `pstackByBlockId` map
  - `isMcpResult()` and `isRecallResult()` handling
- `F:/MyWork/my-pi/vendor/accordion/conductors/contract/conductor.ts`
  - `ViewBlock`, `ConductorView`, `GroupCommand`
- `F:/MyWork/my-pi/vendor/accordion/app/src/lib/engine/conductor.my-customize-conductor.test.ts`

Add a pure local/helper boundary predicate or equivalent that walks `view.blocks` in order and flushes a run before any of the following:

```ts
function isGroupBoundary(b: ViewBlock): boolean {
  if (b.kind === "user") return true;
  if (b.held || b.protected || b.grouped) return true;
  const tool = (b.toolName ?? "").trim().toLowerCase();
  return tool === "mcp" || tool === "recall" || isPstackIdentityBlock(b);
}
```

`isPstackIdentityBlock` must use the existing per-pass pstack identity information, including `pstackByBlockId.has(b.id)` where appropriate. The MCP check must cover both `tool_result` and `tool_call` blocks; do not rely only on `isMcpResult()`, which is result-specific.

Non-MCP `tool_call` and `tool_result` blocks may be included in safe runs. The host's existing group application path remains responsible for whole-message snapping and tool-pair balance; do not duplicate store/wire logic in the conductor.

### Single disposition and host path

When a group is emitted, remove all of its member IDs from `fold` and `fold` with `breakFrozen` commands, and remove any replacement command for those IDs if the implementation planned replacement residue for a grouped member. A block ID must not occur in both a group and another structural command in the same returned batch.

Keep the default digest behavior from issue 001:

```ts
// No custom digest and no drop group.
{ kind: "group", ids: run.map((b) => b.id) }
```

The existing host paths are the verified integration seam:

- `F:/MyWork/my-pi/vendor/accordion/app/src/lib/engine/store.svelte.ts`: `groupCmd()`, `createGroup()`, `groupSummary()`, `isDropGroup()`
- `F:/MyWork/my-pi/vendor/accordion/app/src/lib/live/plan.ts`: `computeGroupOps(store)`
- `F:/MyWork/my-pi/vendor/accordion/app/src/lib/live/mapping.ts`: `applyPlan(messages, ops, groups)`

No direct store, live-plan, or mapping changes are expected. If implementation discovers a host mismatch, add a focused regression test and document the changed anchor rather than silently bypassing host safety.

### Existing-test adjustments

The current Poteto/pstack tests that assert there are no group commands globally must be scoped to the protected pstack IDs. They should assert that pstack IDs are not present in any group, while allowing unrelated safe groups. The no-drop assertion must continue to reject `digest: null` and `digest: ""` for every emitted My Customize group.

Extend the test helpers in `conductor.my-customize-conductor.test.ts` with group ID extraction as needed. The projected-token helper must account for groups.

## Acceptance criteria

- [ ] Running `cd F:/MyWork/my-pi/vendor/accordion/app && npx vitest run src/lib/engine/conductor.my-customize-conductor.test.ts` exits with code 0 and all boundary/integration tests in that file pass.
- [ ] A test with a user block between two otherwise eligible spans produces no group whose IDs cross the user block, and the user ID is absent from every group.
- [ ] A test with an MCP `tool_call` block between eligible blocks produces no group containing that MCP call ID or spanning across it.
- [ ] A test with an MCP `tool_result` block between eligible blocks produces no group containing that MCP result ID or spanning across it.
- [ ] A test with a recall block between eligible blocks produces no group containing the recall ID or spanning across it.
- [ ] A pstack identity/provenance test asserts the pstack identity block is absent from every group while unrelated eligible blocks may still be grouped.
- [ ] A test asserts held, protected, and already-grouped block IDs are each absent from every emitted group.
- [ ] A non-MCP tool call/result fixture asserts the eligible IDs can be included in a group after pressure remains above cap.
- [ ] A test asserts no block ID appears in both a group command and any fold or replace command in the same returned command list.
- [ ] A test asserts all emitted groups omit `digest` and that none is a drop group (`null` or empty string), proving the real host default-digest contract is preserved.
- [ ] The focused test command above exercises the returned conductor commands and fails if the implementation merely emits an empty group list or includes protected/special IDs.

## Blocked by

- `.scratch/my-customize-group-fallback/issues/001-non-frozen-group-fallback.md`
