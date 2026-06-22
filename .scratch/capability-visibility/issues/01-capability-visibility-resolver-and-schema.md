---
status: ready-for-agent
---
# Capability visibility resolver and schema
Status: ready-for-agent

## Parent

- [PRD](../PRD.md)

## What to build

Build the core JSON schema/parser/resolver for Capability Visibility. This slice must be independently verifiable without migrating any real extension yet.

Decision IDs: DEC-002, DEC-005, DEC-006, DEC-010, DEC-012, DEC-015, DEC-016, DEC-017, DEC-018, DEC-019, DEC-021.

User stories covered: 2, 9, 10, 11, 12, 13, 14, 15, 16, 18, 19.

## Implementation map

### Areas cut through

- Capability Visibility Types, Parser, and Merge Resolver
- Settings Source Loading and Trust Boundaries

### Current code anchors

- `extensions/subagents.ts` has existing JSON config helper precedent for layered model config and invalid JSON tolerance.
- `extensions/__tests__/subagents-defaults.test.ts` tests config layering and invalid JSON tolerance.
- New target module: `extensions/lib/capability-visibility.ts`.
- New target tests: `extensions/__tests__/capability-visibility.test.ts`.

### Required edits

Create `extensions/lib/capability-visibility.ts` owning:

- JSON-only parsing for `capabilityVisibility`.
- Tool values: `agent-visible`, `agent-hidden`, or object form `{ visibility, allowUnsafeOverride? }`.
- Command values: `enabled`, `disabled`.
- Merge order: package defaults -> project settings -> global settings, where later sources override matching keys.
- Warning collection for invalid values, missing managed defaults, unknown capability keys, and invalid unsafe overrides.
- Resolution rule: settings override -> tool `defaultVisibility` -> `agent-visible` with warning only for managed extensions.
- Unsafe rule: if extension default is `agent-hidden`, a settings override to `agent-visible` is valid only with `{ "visibility": "agent-visible", "allowUnsafeOverride": true }`; otherwise warn and keep hidden.

### Snippets

```ts
// decision artifact: normative type shape
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
// decision artifact: normative behavior, illustrative function name
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

```ts
// decision artifact: normative merge order
const effectiveCapabilityVisibility = mergeCapabilityVisibility(
  packageDefaults,
  projectSettings,
  globalSettings
);
// Later sources override earlier sources for matching extension/tool/command keys.
```

### Tests to extend

Add `extensions/__tests__/capability-visibility.test.ts` covering:

- package -> project -> global merge priority, with global winning.
- invalid tool value warns and is ignored.
- invalid command value warns and is ignored.
- unknown configured tool/command names warn only.
- missing default for managed tool resolves to `agent-visible` with warning.
- unmanaged tool does not warn for missing default.
- hidden default cannot become visible without `allowUnsafeOverride: true`.
- invalid unsafe override warns and keeps hidden.

Prior art: `extensions/__tests__/subagents-defaults.test.ts`, `extensions/__tests__/pair-program-params.test.ts`.

### Wiring/build notes

- Keep parser JSON-only; do not add YAML/JSONC.
- Do not change general Pi settings merge behavior outside this visibility resolver.
- This slice does not need real Pi extension registration.

## Acceptance criteria

- [ ] `extensions/lib/capability-visibility.ts` exports explicit types for tool visibility, command visibility, and settings shape. Proof: `npm run check`. Expected: `tsc --noEmit` exits 0.
- [ ] The merge resolver applies package defaults, then project settings, then global settings, with global winning for the same extension/tool key. Proof: `npx tsx extensions/__tests__/capability-visibility.test.ts`. Expected: a named passing assertion for global override precedence.
- [ ] Invalid tool visibility values are ignored and reported as warnings. Proof: `npx tsx extensions/__tests__/capability-visibility.test.ts`. Expected: a named passing assertion for invalid tool value warning.
- [ ] Invalid command visibility values are ignored and reported as warnings. Proof: `npx tsx extensions/__tests__/capability-visibility.test.ts`. Expected: a named passing assertion for invalid command value warning.
- [ ] A managed tool with no settings override and no `defaultVisibility` resolves to `agent-visible` and emits a warning. Proof: `npx tsx extensions/__tests__/capability-visibility.test.ts`. Expected: a named passing assertion for managed missing default fallback.
- [ ] An unmanaged tool with no `defaultVisibility` does not emit the managed fallback warning. Proof: `npx tsx extensions/__tests__/capability-visibility.test.ts`. Expected: a named passing assertion for unmanaged missing default behavior.
- [ ] A tool whose extension default is `agent-hidden` remains hidden when config tries to expose it without `allowUnsafeOverride: true`. Proof: `npx tsx extensions/__tests__/capability-visibility.test.ts`. Expected: a named passing assertion for unsafe override rejection.
- [ ] A tool whose extension default is `agent-hidden` becomes visible when config uses object form with `allowUnsafeOverride: true`. Proof: `npx tsx extensions/__tests__/capability-visibility.test.ts`. Expected: a named passing assertion for explicit unsafe override acceptance.

## Blocked by

None - can start immediately.
