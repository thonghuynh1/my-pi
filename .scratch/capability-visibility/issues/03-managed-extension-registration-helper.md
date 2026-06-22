---
status: ready-for-agent
---
# Managed extension registration helper
Status: ready-for-agent

## Parent

- [PRD](../PRD.md)

## What to build

Create the managed registration layer that extensions can use to apply Capability Visibility when registering tools and commands. This slice proves behavior with fake Pi registration objects before migrating real extensions.

Decision IDs: DEC-001, DEC-007, DEC-008, DEC-009, DEC-011, DEC-013, DEC-014, DEC-017, DEC-021.

User stories covered: 1, 2, 3, 4, 5, 6, 7, 13, 14, 18, 19.

## Implementation map

### Areas cut through

- Managed Extension Metadata and Registration Helpers
- Capability Visibility Types, Parser, and Merge Resolver

### Current code anchors

- `extensions/frontend-coach/index.ts` registers multiple tools and commands directly.
- `extensions/pair-program.ts` registers `pair_program` and `/pair-program` directly.
- `extensions/subagents.ts` registers `subagent` and commands directly.
- `extensions/tool-panel.ts` re-registers built-in tools and registers `/tool-panel`, `/tools`.
- New or existing target module: `extensions/lib/capability-visibility.ts`.
- Target tests: `extensions/__tests__/capability-visibility.test.ts`.

### Existing behavior

Extensions call `pi.registerTool(...)` and `pi.registerCommand(...)` directly. No extension declares `piExtension.id` today.

### Required edits

- Add helper API in the shared visibility module. Names may differ, but behavior must match:
  - `createManagedExtension(pi, { id, visibility })`
  - `managed.registerTool({ name, defaultVisibility, ... })`
  - `managed.registerCommand(name, { ... })`
- Detect duplicate managed extension IDs and throw a hard error.
- Skip `pi.registerCommand` for disabled commands.
- Register enabled/unlisted commands normally.
- Apply tool visibility resolution for managed tools.
- Ensure `agent-hidden` tools are unavailable to the agent while preserving internal metadata if the Pi API allows. Pi docs mention `getActiveTools()`, `getAllTools()`, and `setActiveTools(names)`; prefer that route if available.
- Do not force unmanaged extensions into this helper.

### Snippets

```ts
// decision artifact: extension metadata, normative
export const piExtension = {
  id: "frontend-coach"
};
```

```ts
// decision artifact: managed registration style, illustrative helper names
export default function extension(pi) {
  const managed = createManagedExtension(pi, { id: "frontend-coach" });

  managed.registerTool({
    name: "browser_eval",
    defaultVisibility: "agent-hidden",
    // existing schema/execute/render fields stay here
  });

  managed.registerCommand("coach-launch-edge", {
    description: "Launch a controlled Microsoft Edge window...",
    handler: async (args, ctx) => {
      // existing command implementation
    }
  });
}
```

### Tests to extend

Use fake `pi` objects in `extensions/__tests__/capability-visibility.test.ts` to prove:

- disabled commands are not passed to `pi.registerCommand`.
- enabled/unlisted commands are registered.
- duplicate IDs throw.
- hidden tools do not end up active/agent-visible.
- managed tools without defaults warn; unmanaged/direct registration does not.

### Wiring/build notes

- This issue should not migrate real extensions yet; it creates the helper and tests the behavior.
- Preserve current built-in tool behavior; do not manage Pi core tools in v1.

## Acceptance criteria

- [ ] A managed registration helper exists in `extensions/lib/capability-visibility.ts` or a sibling shared module. Proof: `npm run check`. Expected: `tsc --noEmit` exits 0.
- [ ] Disabled commands are not registered through the helper. Proof: `npx tsx extensions/__tests__/capability-visibility.test.ts`. Expected: a named passing assertion for disabled command skip.
- [ ] Commands not listed in settings are registered by default. Proof: `npx tsx extensions/__tests__/capability-visibility.test.ts`. Expected: a named passing assertion for command default enabled.
- [ ] Duplicate managed extension IDs throw a hard error. Proof: `npx tsx extensions/__tests__/capability-visibility.test.ts`. Expected: a named passing assertion for duplicate extension ID error.
- [ ] Managed `agent-hidden` tools are not exposed as active agent tools by the helper or visibility seam. Proof: `npx tsx extensions/__tests__/capability-visibility.test.ts`. Expected: a named passing assertion for hidden tool excluded from active tools.
- [ ] The helper does not make unmanaged/direct extension registration fail. Proof: `npx tsx extensions/__tests__/capability-visibility.test.ts`. Expected: a named passing assertion for unmanaged compatibility.

## Blocked by

- [01-capability-visibility-resolver-and-schema](01-capability-visibility-resolver-and-schema.md)
