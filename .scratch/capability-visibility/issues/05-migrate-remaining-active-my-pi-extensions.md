---
status: ready-for-agent
---
# Migrate remaining active my-pi extensions to managed metadata/defaults
Status: ready-for-agent

## Parent

- [PRD](../PRD.md)

## What to build

After the frontend-coach tracer proves the pattern, migrate the remaining active `my-pi` custom extensions to managed extension metadata and package defaults. Keep Pi built-in tools out of scope.

Decision IDs: DEC-001, DEC-007, DEC-008, DEC-009, DEC-012, DEC-013, DEC-020.

User stories covered: 4, 5, 6, 7, 8, 17, 20.

## Implementation map

### Areas cut through

- Managed Extension Metadata and Registration Helpers
- Current my-pi Extension Defaults
- Documentation and Visual Artifact

### Current code anchors

Active custom extensions and commands/tools:

- `extensions/pair-program.ts`
  - tool: `pair_program`
  - command: `/pair-program`
- `extensions/subagents.ts`
  - tool: `subagent`
  - commands: `/subagent`, `/subagents`, `/subagents-model`
- `extensions/lavish-axi.ts`
  - command: `/lavish`
- `extensions/engineering-skills.ts`
  - commands: `/engineering-skill`, `/engineering-skills-mcp-setup`
- `extensions/usage-footer.ts`
  - command: `/usage-footer`
- `extensions/herdr-agent-report.ts`
  - command: `/herdr-agent`
- `extensions/tool-panel.ts`
  - commands: `/tool-panel`, `/tools`
  - also wraps built-in tools `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`; those built-in wrappers are out of scope for v1 policy.
- `extensions/grill-with-scouts.ts`
  - contains tools/commands but is currently inactive because `REGISTER_GRILL_WITH_SCOUTS = false`.
- `CONTEXT.md` contains glossary terms for Capability Visibility, Managed Extension, Agent-Visible Tool, and Agent-Hidden Tool.

### Existing behavior

Most active custom extensions directly register tools/commands and do not declare `piExtension.id`.

### Required edits

- Add stable `piExtension.id` metadata to remaining active managed custom extensions:
  - `pair-program`
  - `subagents`
  - `lavish-axi`
  - `engineering-skills`
  - `usage-footer`
  - `herdr-agent-report`
  - `tool-panel` for commands only
- Use the managed registration helper where command enable/disable or tool visibility applies.
- Extend `pi.settings.json` with defaults for the migrated extensions.
- Keep commands enabled by default unless a setting disables them.
- Do not manage Pi built-in tools in `tool-panel.ts` in this slice.
- Do not re-enable `grill-with-scouts`; if adding metadata/defaults for it, keep it inactive and clearly covered by tests as inactive/future.

### Snippets

```ts
// decision artifact: normative metadata shape
export const piExtension = {
  id: "pair-program"
};
```

```json
// decision artifact: illustrative defaults for non-frontend extensions
{
  "capabilityVisibility": {
    "pair-program": {
      "tools": {
        "pair_program": "agent-visible"
      },
      "commands": {
        "pair-program": "enabled"
      }
    },
    "subagents": {
      "tools": {
        "subagent": "agent-visible"
      },
      "commands": {
        "subagent": "enabled",
        "subagents": "enabled",
        "subagents-model": "enabled"
      }
    },
    "lavish-axi": {
      "commands": {
        "lavish": "enabled"
      }
    }
  }
}
```

### Tests to extend

- Extend `extensions/__tests__/capability-visibility.test.ts` or add a focused manifest/defaults test that validates configured extension IDs and command/tool names.
- Prove `pair_program` and `subagent` remain agent-visible by default.
- Prove at least one command-only extension command, e.g. `lavish`, is enabled by default.
- Prove built-in tool names are not configured/managed by package defaults.
- Run targeted existing tests for changed extensions when touched:
  - `npx tsx extensions/__tests__/pair-program-params.test.ts` if `pair-program.ts` changes beyond metadata/wrapping.
  - `npx tsx extensions/__tests__/subagents-defaults.test.ts` if `subagents.ts` config behavior changes.

### Wiring/build notes

- First version must not manage Pi built-in tools, including quiet wrappers in `extensions/tool-panel.ts`.
- Upstream third-party extensions from `pi-mcp-adapter` and `@ogulcancelik/pi-herdr` are out of scope.

## Acceptance criteria

- [ ] `pair-program`, `subagents`, `lavish-axi`, `engineering-skills`, `usage-footer`, `herdr-agent-report`, and `tool-panel` have stable managed extension IDs or an explicit test-documented reason for remaining unmanaged. Proof: `npx tsx extensions/__tests__/capability-visibility.test.ts`. Expected: named passing assertions for remaining extension IDs/coverage.
- [ ] `pair_program` resolves `agent-visible` by default. Proof: `npx tsx extensions/__tests__/capability-visibility.test.ts`. Expected: a named passing assertion for pair_program visible.
- [ ] `subagent` resolves `agent-visible` by default. Proof: `npx tsx extensions/__tests__/capability-visibility.test.ts`. Expected: a named passing assertion for subagent visible.
- [ ] A command-only extension command such as `lavish` resolves enabled by default. Proof: `npx tsx extensions/__tests__/capability-visibility.test.ts`. Expected: a named passing assertion for lavish command enabled.
- [ ] Package defaults do not manage built-in tool names `read`, `bash`, `edit`, `write`, `grep`, `find`, or `ls`. Proof: `npx tsx extensions/__tests__/capability-visibility.test.ts`. Expected: a named passing assertion for built-ins excluded.
- [ ] TypeScript still passes. Proof: `npm run check`. Expected: `tsc --noEmit` exits 0.
- [ ] Existing focused tests for changed pair-program/subagent behavior still pass when those files are touched. Proof: run applicable commands, e.g. `npx tsx extensions/__tests__/pair-program-params.test.ts` and/or `npx tsx extensions/__tests__/subagents-defaults.test.ts`. Expected: all assertions pass and exit 0.

## Blocked by

- [04-frontend-coach-tracer-migration](04-frontend-coach-tracer-migration.md)
