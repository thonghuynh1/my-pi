Status: ready-for-agent

# PRD: Capability Visibility for my-pi Extensions

## Problem Statement

The user has a personal Pi extension package (`my-pi`) that loads multiple custom extensions. Some extension capabilities should be available for the agent to discover and call automatically, while other capabilities should stay hidden from the agent and only be exposed through explicit human slash commands.

Today, mixed extensions can register both tools and commands, but there is no package-level visibility contract in `my-pi` that says which tools are agent-visible, which tools are agent-hidden, and which commands should be enabled. This makes it hard to safely ship extensions like `frontend-coach`, where structured browser-recording tools are useful for the agent, but raw browser evaluation should be hidden by default.

## Solution

Add a JSON-based capability visibility system for `my-pi` custom extensions.

Each managed extension declares a stable `piExtension.id`. A package-level default config file, `pi.settings.json`, referenced from `package.json`, defines default tool and command visibility for the bundled `my-pi` extensions. Project and global Pi settings can override those defaults, with global/user settings as the final authority.

The first version applies only to custom extension capabilities in `my-pi`, not Pi built-in tools. Tools can be `agent-visible` or `agent-hidden`; commands can be `enabled` or `disabled`.

## User Stories

1. As a Pi user, I want some custom extension tools to be visible to the agent, so that the agent can use safe automation capabilities without me wiring them manually.
2. As a Pi user, I want some custom extension tools to be hidden from the agent, so that risky capabilities are not called automatically.
3. As a Pi user, I want hidden tools to still be registered internally, so that Pi can later support admin/debug/manual tool surfaces without losing metadata.
4. As a Pi user, I want slash commands to remain human-facing, so that private/manual workflows are only invoked when I explicitly type a command.
5. As a Pi user, I want to disable specific commands, so that commands I do not use do not appear in command lists.
6. As a Pi package maintainer, I want each extension to declare a stable ID, so that visibility settings do not depend on file paths.
7. As a Pi package maintainer, I want duplicate extension IDs to fail loudly, so that security-sensitive visibility settings cannot target an ambiguous extension.
8. As a Pi package maintainer, I want package defaults in `pi.settings.json`, so that `my-pi` ships safe defaults without bloating `package.json`.
9. As a Pi user, I want user/global settings to override project settings, so that project config cannot secretly expose or re-enable capabilities I globally hid.
10. As a Pi user, I want project settings to override package defaults, so that a project can opt into its preferred tools unless my global settings say otherwise.
11. As a Pi user, I want invalid config values to warn and be ignored, so that a typo does not crash Pi startup.
12. As a Pi user, I want unknown configured tool or command names to warn, so that typos are visible without making shared configs fragile.
13. As a Pi extension author, I want tools to declare `defaultVisibility`, so that safe defaults live near the capability implementation.
14. As a Pi extension author, I want missing `defaultVisibility` to warn only for managed extensions, so that old unmanaged extensions continue to behave like today.
15. As a Pi user, I want tools defaulting to `agent-hidden` to require an explicit unsafe override before becoming `agent-visible`, so that dangerous escalation is deliberate.
16. As a Pi user, I want invalid unsafe overrides to warn and keep the tool hidden, so that config mistakes fail safe.
17. As a Pi package maintainer, I want a starter `pi.settings.json` based on current `my-pi` extensions, so that the first rollout has concrete defaults.
18. As an implementation agent, I want a small shared visibility module, so that each extension does not reimplement config parsing and merge behavior.
19. As an implementation agent, I want focused tests for config parsing, merge priority, unsafe overrides, and registration filtering, so that behavior is proven without launching a full Pi session.
20. As a future maintainer, I want the design documented in the PRD and defaults file, so that later extension additions follow the same pattern.

## Accepted Decision Register

- `DEC-001`: Support mixed extensions that expose both agent tools and human commands. Rejected splitting every mixed extension into separate command-only/tool-only files. Implementation must distinguish tools from commands under the same extension ID.
- `DEC-002`: Keep config as JSON, not YAML. JSON is stricter, schema-friendly, and matches Pi settings.
- `DEC-003`: `my-pi` package defaults live in `pi.settings.json`, referenced from `package.json` as `pi.settings`.
- `DEC-004`: `my-pi/pi.settings.json` is defaults, not locked policy.
- `DEC-005`: Merge priority is package defaults, then project settings, then global/user settings as final authority. This intentionally differs from general Pi project-over-global behavior for this security-sensitive setting.
- `DEC-006`: Global/user settings are final authority for both tools and commands.
- `DEC-007`: Extensions opt into managed visibility by exporting `piExtension.id` metadata.
- `DEC-008`: Duplicate managed extension IDs are hard errors.
- `DEC-009`: Extensions without `piExtension.id` load normally but are unmanaged by `capabilityVisibility`.
- `DEC-010`: Tool visibility values are `agent-visible` and `agent-hidden`; not `user-only` or `both`.
- `DEC-011`: `agent-hidden` means registered internally but removed from the active LLM/tool schema.
- `DEC-012`: Commands use `enabled` and `disabled`.
- `DEC-013`: Commands default enabled unless settings disables them.
- `DEC-014`: Disabled commands are not registered and do not appear in command lists.
- `DEC-015`: Unknown configured tool/command names warn only.
- `DEC-016`: Invalid visibility values warn and are ignored.
- `DEC-017`: Missing tool visibility for managed extensions resolves by settings override, then tool `defaultVisibility`, then fallback `agent-visible` with warning.
- `DEC-018`: If a tool defaults to `agent-hidden`, exposing it as `agent-visible` requires `allowUnsafeOverride: true`.
- `DEC-019`: Invalid unsafe overrides warn and keep the tool hidden.
- `DEC-020`: First version applies only to custom extensions, not Pi built-in tools.
- `DEC-021`: `defaultVisibility` warnings apply only to managed extensions.

## Implementation Plan

### Area: Package Manifest and Package Defaults

- **Decision IDs**: `DEC-002`, `DEC-003`, `DEC-004`, `DEC-005`, `DEC-020`
- **Current code anchors**:
  - `package.json` `pi.extensions` loads `./node_modules/pi-mcp-adapter/index.ts`, `./node_modules/@ogulcancelik/pi-herdr/index.ts`, and `./extensions`.
  - `package.json` `pi.prompts` loads `./prompts`.
  - Pi docs confirm package metadata supports `extensions`, `skills`, `prompts`, `themes`, `video`, and `image`; package-level `pi.settings.json` is not an upstream Pi concept today.
- **Existing behavior**: `my-pi` declares extension and prompt resources through `package.json`; there is no package-default settings file.
- **Required edits**:
  - Add `"settings": "./pi.settings.json"` under the existing `package.json` `pi` object.
  - Create `pi.settings.json` at the repo root containing package-default `capabilityVisibility` for current managed `my-pi` extensions.
  - Treat this as a `my-pi` convention unless/until Pi core supports package-level settings.
- **Snippet(s)**:

```json
// current code anchor: package.json pi block, trimmed
{
  "pi": {
    "extensions": [
      "./node_modules/pi-mcp-adapter/index.ts",
      "./node_modules/@ogulcancelik/pi-herdr/index.ts",
      "./extensions"
    ],
    "prompts": ["./prompts"]
  }
}
```

```json
// decision artifact: package.json target shape, normative
{
  "pi": {
    "extensions": [
      "./node_modules/pi-mcp-adapter/index.ts",
      "./node_modules/@ogulcancelik/pi-herdr/index.ts",
      "./extensions"
    ],
    "prompts": ["./prompts"],
    "settings": "./pi.settings.json"
  }
}
```

- **Tests to extend**:
  - Add parser/loader tests under `extensions/__tests__/` for locating package defaults from `package.json` and `pi.settings.json`.
  - Run `npm run check`; expected clean `tsc --noEmit`.
  - Run the new focused test with `npx tsx extensions/__tests__/<new-visibility-test>.test.ts` or `node --test` if written in Node test style.
- **Wiring/build notes**: Since upstream Pi docs do not define package-level `pi.settings.json`, implement loading in `my-pi` shared code rather than assuming Pi core will load it.

### Area: Capability Visibility Types, Parser, and Merge Resolver

- **Decision IDs**: `DEC-002`, `DEC-005`, `DEC-006`, `DEC-010`, `DEC-012`, `DEC-015`, `DEC-016`, `DEC-017`, `DEC-018`, `DEC-019`
- **Current code anchors**:
  - `extensions/subagents.ts` already contains JSON config helpers for `agents/models.json` layering: package → user → project, including invalid JSON tolerance.
  - `extensions/__tests__/subagents-defaults.test.ts` covers layered defaults, `inherit` clearing, and invalid JSON tolerance.
  - Pi docs confirm global settings path `~/.pi/agent/settings.json` and project settings path `.pi/settings.json`; project settings are trust-gated by Pi.
- **Existing behavior**: `my-pi` has config-reading precedent for subagent model defaults, but no capability visibility schema.
- **Required edits**:
  - Add a deep, testable module, likely `extensions/lib/capability-visibility.ts`, that owns JSON shape parsing, merge behavior, visibility resolution, unsafe override handling, and warning collection.
  - Validate unknown capability names after registration metadata is known.
- **Snippet(s)**:

```ts
// decision artifact: type shape, normative
export type ToolVisibility = "agent-visible" | "agent-hidden";
export type CommandVisibility = "enabled" | "disabled";

export type ToolVisibilityOverride =
  | ToolVisibility
  | {
      visibility: ToolVisibility;
      allowUnsafeOverride?: boolean;
    };

export interface CapabilityVisibilitySettings {
  capabilityVisibility?: Record<string, {
    tools?: Record<string, ToolVisibilityOverride>;
    commands?: Record<string, CommandVisibility>;
  }>;
}
```

```ts
// decision artifact: resolver contract, illustrative names but normative behavior
resolveToolVisibility({
  extensionId,
  toolName,
  configuredOverride,
  defaultVisibility,
  managed: true
})
// priority:
// 1. valid settings override
// 2. defaultVisibility
// 3. "agent-visible" + warning when managed
```

- **Tests to extend**:
  - Add `extensions/__tests__/capability-visibility.test.ts` covering merge priority, invalid values, unknown names, missing defaults, unmanaged behavior, and unsafe override handling.
  - Prior art: `extensions/__tests__/subagents-defaults.test.ts` and `extensions/__tests__/pair-program-params.test.ts`.
  - Run `npx tsx extensions/__tests__/capability-visibility.test.ts` and `npm run check`.
- **Wiring/build notes**: Use existing direct assertion style unless Node `--test` is a better fit. The repo has no `npm test` script.

### Area: Managed Extension Metadata and Registration Helpers

- **Decision IDs**: `DEC-001`, `DEC-007`, `DEC-008`, `DEC-009`, `DEC-011`, `DEC-013`, `DEC-014`, `DEC-017`, `DEC-021`
- **Current code anchors**:
  - `extensions/frontend-coach/index.ts` registers 7 tools and 12 commands in one mixed extension.
  - `extensions/pair-program.ts` registers `pair_program` and `/pair-program`.
  - `extensions/subagents.ts` registers `subagent` tool and `/subagent`, `/subagents`, `/subagents-model` commands.
  - `extensions/tool-panel.ts` re-registers built-in tools with quiet renderers and registers `/tool-panel`, `/tools`.
  - `extensions/grill-with-scouts.ts` contains tools and commands but is gated by `REGISTER_GRILL_WITH_SCOUTS = false`.
- **Existing behavior**: Extensions call `pi.registerTool(...)` and `pi.registerCommand(...)` directly. No extension declares `piExtension.id` today.
- **Required edits**:
  - Add `export const piExtension = { id: "..." }` to managed custom extensions.
  - Introduce helper functions that extensions can use instead of direct registration, for example `createManagedExtension(pi, { id })`, `managed.registerTool(...)`, and `managed.registerCommand(...)`.
  - The helper must skip disabled command registration.
  - The helper must make `agent-hidden` tools unavailable to the agent while preserving internal metadata if Pi API allows.
  - Duplicate IDs must be hard errors.
- **Snippet(s)**:

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

- **Tests to extend**:
  - Add unit tests with a fake `pi` object proving disabled commands are not registered, unlisted commands are registered, duplicate IDs throw, and hidden tools do not end up in active agent tools if using `pi.setActiveTools` or equivalent.
  - Run `npx tsx extensions/__tests__/capability-visibility.test.ts` and `npm run check`.
- **Wiring/build notes**: Pi docs mention `getActiveTools()`, `getAllTools()`, and `setActiveTools(names)`; prefer that route if available in this package version.

### Area: Current my-pi Extension Defaults

- **Decision IDs**: `DEC-001`, `DEC-003`, `DEC-010`, `DEC-012`, `DEC-013`, `DEC-020`
- **Current code anchors**:
  - `extensions/frontend-coach/index.ts` tools: `browser_highlight`, `browser_inspect`, `browser_record_test`, `coach_resolve_widget`, `coach_list_widgets`, `browser_record_for_widget`, `browser_eval`.
  - `extensions/frontend-coach/index.ts` commands: `/coach-inject-picker`, `/coach-launch-edge`, `/coach-edge-status`, `/coach-stop-edge`, `/coach-records`, `/coach-record`, `/coach-records-open`, `/coach-widgets`, `/coach-env`, `/coach-bookmarklet`, `/coach-status`, `/coach`.
  - `extensions/pair-program.ts` tool: `pair_program`; command: `/pair-program`.
  - `extensions/subagents.ts` tool: `subagent`; commands: `/subagent`, `/subagents`, `/subagents-model`.
  - `extensions/lavish-axi.ts` command: `/lavish`.
  - `extensions/engineering-skills.ts` commands: `/engineering-skill`, `/engineering-skills-mcp-setup`.
  - `extensions/usage-footer.ts` command: `/usage-footer`.
  - `extensions/herdr-agent-report.ts` command: `/herdr-agent`.
  - `extensions/tool-panel.ts` commands: `/tool-panel`, `/tools`; also wraps built-ins but built-ins are out of scope for v1.
  - `extensions/grill-with-scouts.ts` is currently inactive because `REGISTER_GRILL_WITH_SCOUTS = false`.
- **Existing behavior**: Current extensions register tools/commands without package-level visibility defaults.
- **Required edits**:
  - Create initial `pi.settings.json` entries for active custom extensions.
  - Set `frontend-coach.browser_eval` to `agent-hidden` by default. Keep structured frontend-coach tools agent-visible by default.
  - Keep current commands enabled by default unless there is a specific reason to disable one.
  - Do not manage Pi built-in wrappers in `tool-panel.ts` as core-tool policy in v1.
- **Snippet(s)**:

```json
// decision artifact: frontend-coach defaults, normative starter
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

- **Tests to extend**:
  - Add a test that loads actual `pi.settings.json` and validates configured extension/tool/command names against a static fixture or exported capability manifest.
  - At minimum, parser tests should cover `frontend-coach.browser_eval` resolving to hidden by default.
- **Wiring/build notes**: JSON cannot contain comments. Keep rationale in this PRD or docs, not inside `pi.settings.json`.

### Area: Settings Source Loading and Trust Boundaries

- **Decision IDs**: `DEC-004`, `DEC-005`, `DEC-006`, `DEC-016`, `DEC-020`
- **Current code anchors**:
  - Pi docs define global settings at `~/.pi/agent/settings.json` and project settings at `.pi/settings.json`.
  - Pi docs state project `.pi/settings.json` is trust-gated and only loaded after project trust is established.
  - Pi docs recommend using `CONFIG_DIR_NAME` instead of hardcoding `.pi` inside extension code.
  - `extensions/subagents.ts` imports Pi helpers such as `getAgentDir()` for user-level configuration paths.
- **Existing behavior**: General Pi settings merge project over global. The accepted visibility design requires global/user to be final authority for this one security-sensitive setting.
- **Required edits**:
  - Implement visibility-specific source loading: package defaults, project settings, then global settings.
  - Apply visibility-specific merge order where global wins.
  - Warn and ignore invalid JSON or invalid values without crashing startup.
  - Do not alter general Pi settings merge behavior outside `capabilityVisibility`.
- **Snippet(s)**:

```ts
// decision artifact: merge order, normative behavior
const effectiveCapabilityVisibility = mergeCapabilityVisibility(
  packageDefaults,
  projectSettings,
  globalSettings
);
// Later sources override earlier sources for matching extension/tool/command keys.
```

- **Tests to extend**:
  - Unit tests with temp directories for package/project/global settings.
  - Test that global hides a tool even when project exposes it with a valid unsafe override.
  - Test invalid project JSON warns and leaves package/global settings intact.
- **Wiring/build notes**: If project trust cannot be checked from the extension API, avoid reading project settings directly unless Pi has already made them available; document any fallback in code comments and tests.

### Area: Documentation and Visual Artifact

- **Decision IDs**: all decisions as applicable
- **Current code anchors**:
  - `.lavish/capability-visibility-plan.html` visually summarizes the plan and includes a proposed default config section based on current extensions.
  - `CONTEXT.md` is the repo glossary. It currently has terms for Pair Program, Grill With Scouts, Engineering Skills MCP, and related planning concepts, but not Capability Visibility.
- **Existing behavior**: The plan exists as a Lavish artifact and this PRD; glossary has no canonical term for the new feature.
- **Required edits**:
  - Optionally add glossary entries to `CONTEXT.md` for `Capability Visibility`, `Managed Extension`, `Agent-Visible Tool`, and `Agent-Hidden Tool` once implementation starts.
  - Keep `.lavish/capability-visibility-plan.html` as a human-facing planning artifact; do not treat it as normative source once code and `pi.settings.json` exist.
- **Snippet(s)**:

```md
// decision artifact: possible glossary entry, illustrative
## Capability Visibility

A my-pi configuration layer that controls which managed custom extension tools are exposed to the agent and which managed commands are registered for human slash-command use.
```

- **Tests to extend**: Not applicable beyond docs review.
- **Wiring/build notes**: None.

## Global Build & Wiring Notes

- Current `package.json` has `"check": "tsc --noEmit"` and no `npm test` script.
- `npm run check` currently passes cleanly.
- Existing test files live under `extensions/__tests__/` and are run individually with `npx tsx` or `node --test` depending on test style.
- The repo currently has 953 passing tests across the existing test files per the grounding run.
- Upstream Pi docs do not currently define package-level `pi.settings.json`. This feature should implement that convention inside `my-pi` unless paired with a Pi core change.
- Pi project settings are trust-gated. Any direct read of project `.pi/settings.json` must respect trust or use a Pi-provided settings surface if available.
- First version must not manage Pi built-in tools, including the quiet wrappers in `extensions/tool-panel.ts` for `read`, `bash`, `edit`, `write`, `grep`, `find`, and `ls`.

## Testing Decisions

- Test external behavior of the visibility resolver and registration helpers, not incidental implementation details.
- Add focused unit tests for JSON parsing and validation, merge priority, tool visibility resolution, command enable/disable resolution, unsafe override behavior, warning collection, duplicate extension ID hard error, and disabled commands not being registered.
- Prior art: `extensions/__tests__/subagents-defaults.test.ts` for layered config and invalid JSON tolerance; `extensions/__tests__/pair-program-params.test.ts` for direct assertion style and focused helper testing.
- Required verification commands:
  - `npm run check`
  - `npx tsx extensions/__tests__/capability-visibility.test.ts` once added.
  - Existing targeted tests for any modified extension, for example `npx tsx extensions/__tests__/subagents-defaults.test.ts` if config helpers are reused.

## Out of Scope

- Managing Pi built-in tools such as `read`, `bash`, `edit`, `write`, `grep`, `find`, and `ls`.
- Implementing YAML or JSONC settings.
- Creating a generic manual `/tool-run` command for hidden tools.
- Enforcing locked enterprise policy that user/project settings cannot override package defaults.
- Changing upstream Pi core behavior unless a later implementation explicitly chooses to upstream the package-level settings concept.
- Managing third-party package extensions from `pi-mcp-adapter` or `@ogulcancelik/pi-herdr` in the first version.
- Re-enabling `grill-with-scouts`; its visibility defaults may be prepared, but activation is separate.

## Unresolved Gaps

None.

## Further Notes

The Lavish visual summary lives at `.lavish/capability-visibility-plan.html`. It is useful for human review, but the normative implementation contract is this PRD plus the accepted decisions above.
