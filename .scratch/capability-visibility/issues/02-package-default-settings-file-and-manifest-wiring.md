---
status: ready-for-agent
---
# Package default settings file and manifest wiring
Status: ready-for-agent

## Parent

- [PRD](../PRD.md)

## What to build

Wire `my-pi` package defaults by adding `pi.settings` to `package.json`, creating root `pi.settings.json`, and proving the new defaults parse through the capability visibility resolver.

Decision IDs: DEC-003, DEC-004, DEC-005, DEC-020.

User stories covered: 8, 10, 11, 17, 19, 20.

## Implementation map

### Areas cut through

- Package Manifest and Package Defaults
- Current my-pi Extension Defaults
- Capability Visibility Types, Parser, and Merge Resolver

### Current code anchors

- `package.json` currently has a `pi` block with `extensions` and `prompts` only.
- `pi.settings.json` does not exist yet.
- `extensions/__tests__/capability-visibility.test.ts` should already exist from issue 01.

### Existing behavior

`my-pi` declares extension and prompt resources through `package.json`; there is no package-default settings file.

### Required edits

- Add `"settings": "./pi.settings.json"` under the existing `package.json` `pi` object.
- Create root `pi.settings.json` with package-default `capabilityVisibility` for active managed custom extensions.
- The defaults are package defaults only, not locked policy.
- Do not manage Pi built-in tools in v1.

### Snippets

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
// decision artifact: target package.json pi block, normative
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

```json
// decision artifact: starter defaults, normative for frontend-coach
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

- Extend `extensions/__tests__/capability-visibility.test.ts` or add a focused package-default test.
- Test that `package.json` points to `./pi.settings.json`.
- Test that root `pi.settings.json` parses as valid capability visibility JSON.
- Test that `frontend-coach.browser_eval` resolves to `agent-hidden` from package defaults.

### Wiring/build notes

- Upstream Pi docs do not define package-level `pi.settings.json`; treat this as a `my-pi` convention for now.
- JSON cannot contain comments.

## Acceptance criteria

- [ ] `package.json` contains `pi.settings` with value `./pi.settings.json`. Proof: `node -e "const p=require('./package.json'); if(p.pi.settings!=='./pi.settings.json') throw new Error('missing pi.settings')"`. Expected: command exits 0.
- [ ] Root `pi.settings.json` exists and is valid JSON. Proof: `node -e "JSON.parse(require('fs').readFileSync('pi.settings.json','utf8')); console.log('valid pi.settings.json')"`. Expected stdout includes `valid pi.settings.json`.
- [ ] `pi.settings.json` configures `frontend-coach.tools.browser_eval` as `agent-hidden`. Proof: `npx tsx extensions/__tests__/capability-visibility.test.ts`. Expected: a named passing assertion for frontend-coach browser_eval package default.
- [ ] Package defaults do not configure Pi built-in tools such as `bash`, `read`, `edit`, `write`, `grep`, `find`, or `ls`. Proof: `npx tsx extensions/__tests__/capability-visibility.test.ts`. Expected: a named passing assertion for no built-in tool defaults.
- [ ] TypeScript still passes. Proof: `npm run check`. Expected: `tsc --noEmit` exits 0.

## Blocked by

- [01-capability-visibility-resolver-and-schema](01-capability-visibility-resolver-and-schema.md)
