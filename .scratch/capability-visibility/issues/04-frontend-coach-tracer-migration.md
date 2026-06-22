---
status: ready-for-agent
---
# Frontend Coach tracer migration
Status: ready-for-agent

## Parent

- [PRD](../PRD.md)

## What to build

Migrate `frontend-coach` as the first real mixed managed extension. It should declare a stable extension ID, use the managed registration helper for tools and commands, keep structured tools agent-visible, and hide raw browser eval from the agent by default.

Decision IDs: DEC-001, DEC-007, DEC-010, DEC-011, DEC-012, DEC-013, DEC-014, DEC-018, DEC-019.

User stories covered: 1, 2, 3, 4, 5, 6, 13, 15, 16, 17, 19.

## Implementation map

### Areas cut through

- Managed Extension Metadata and Registration Helpers
- Current my-pi Extension Defaults
- Package Manifest and Package Defaults

### Current code anchors

- `extensions/frontend-coach/index.ts` tools:
  - `browser_highlight`
  - `browser_inspect`
  - `browser_record_test`
  - `coach_resolve_widget`
  - `coach_list_widgets`
  - `browser_record_for_widget`
  - `browser_eval`
- `extensions/frontend-coach/index.ts` commands:
  - `/coach-inject-picker`
  - `/coach-launch-edge`
  - `/coach-edge-status`
  - `/coach-stop-edge`
  - `/coach-records`
  - `/coach-record`
  - `/coach-records-open`
  - `/coach-widgets`
  - `/coach-env`
  - `/coach-bookmarklet`
  - `/coach-status`
  - `/coach`
- `pi.settings.json` from issue 02.
- `extensions/__tests__/capability-visibility.test.ts`.

### Existing behavior

`frontend-coach` directly registers all tools and commands. The agent currently sees all registered frontend-coach tools, including `browser_eval`.

### Required edits

- Add `export const piExtension = { id: "frontend-coach" }` to `extensions/frontend-coach/index.ts`.
- Use the managed registration helper for frontend-coach tool and command registration.
- Set `browser_eval` default visibility to `agent-hidden`.
- Keep structured frontend coach tools agent-visible:
  - `browser_highlight`
  - `browser_inspect`
  - `browser_record_test`
  - `coach_resolve_widget`
  - `coach_list_widgets`
  - `browser_record_for_widget`
- Keep frontend-coach commands enabled by default unless disabled in settings.
- Ensure an invalid unsafe override trying to expose `browser_eval` warns and leaves it hidden.

### Snippets

```ts
// decision artifact: normative metadata
export const piExtension = {
  id: "frontend-coach"
};
```

```json
// decision artifact: normative frontend-coach default
{
  "capabilityVisibility": {
    "frontend-coach": {
      "tools": {
        "browser_highlight": "agent-visible",
        "browser_inspect": "agent-visible",
        "browser_record_test": "agent-visible",
        "coach_resolve_widget": "agent-visible",
        "coach_list_widgets": "agent-visible",
        "browser_record_for_widget": "agent-visible",
        "browser_eval": "agent-hidden"
      },
      "commands": {
        "coach-launch-edge": "enabled",
        "coach-stop-edge": "enabled"
      }
    }
  }
}
```

### Tests to extend

- Extend `extensions/__tests__/capability-visibility.test.ts` to include frontend-coach fixture/manifest assertions.
- Prove `browser_eval` resolves hidden from package defaults.
- Prove an explicit unsafe override can expose `browser_eval` only with `allowUnsafeOverride: true`.
- Prove at least one frontend-coach command remains enabled by default.

### Wiring/build notes

- This is the tracer migration. Do not migrate all extensions in this slice.
- Keep existing frontend-coach tool schemas, descriptions, execute behavior, and command handlers intact.

## Acceptance criteria

- [ ] `extensions/frontend-coach/index.ts` exports `piExtension.id` equal to `frontend-coach`. Proof: `npx tsx extensions/__tests__/capability-visibility.test.ts`. Expected: a named passing assertion for frontend-coach extension ID.
- [ ] `frontend-coach.browser_eval` resolves to `agent-hidden` from defaults and is not active for the agent. Proof: `npx tsx extensions/__tests__/capability-visibility.test.ts`. Expected: a named passing assertion for browser_eval hidden in frontend-coach.
- [ ] A structured frontend-coach tool such as `browser_record_test` resolves to `agent-visible`. Proof: `npx tsx extensions/__tests__/capability-visibility.test.ts`. Expected: a named passing assertion for browser_record_test visible.
- [ ] A frontend-coach command such as `coach-launch-edge` remains enabled by default. Proof: `npx tsx extensions/__tests__/capability-visibility.test.ts`. Expected: a named passing assertion for coach-launch-edge command enabled.
- [ ] Invalid unsafe override for `browser_eval` warns and keeps it hidden. Proof: `npx tsx extensions/__tests__/capability-visibility.test.ts`. Expected: a named passing assertion for frontend-coach unsafe override rejection.
- [ ] Existing TypeScript behavior is preserved. Proof: `npm run check`. Expected: `tsc --noEmit` exits 0.

## Blocked by

- [01-capability-visibility-resolver-and-schema](01-capability-visibility-resolver-and-schema.md)
- [02-package-default-settings-file-and-manifest-wiring](02-package-default-settings-file-and-manifest-wiring.md)
- [03-managed-extension-registration-helper](03-managed-extension-registration-helper.md)
