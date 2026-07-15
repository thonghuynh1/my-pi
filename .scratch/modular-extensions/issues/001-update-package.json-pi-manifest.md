# Issue: Update package.json pi manifest to list all 11 extensions individually

## What to build

Restructure `package.json`'s `pi.extensions` array to list all 11 extensions individually instead of the flat `./extensions` glob. This enables users to pick specific extensions via `settings.json` filtering.

**PRD Decision IDs**: DEC-001, DEC-003, DEC-004, DEC-005, DEC-006

**User Stories**: US-1, US-2, US-3, US-4, US-5

## Implementation map

### Area: package.json pi manifest

- **Decision IDs**: DEC-001 (single package with filtering), DEC-003 (frontend-coach first-class unit), DEC-004 (mandatory extensions), DEC-005 (accordion opt-in), DEC-006 (pi-herdr opt-in)
- **Current code anchors**: `F:/MyWork/my-pi/package.json` — `pi.extensions` array
- **Existing behavior**: All extensions loaded regardless of user preference via `./extensions` glob
- **Required edits**:
  - Replace `./extensions` glob with explicit list of all 12 extension paths
  - Keep `./prompts` and `./settings` as-is
- **Snippet(s)**:
  ```json
  // current code anchor — package.json pi.extensions
  "pi": {
    "extensions": [
      "./node_modules/pi-mcp-adapter/index.ts",
      "./node_modules/@ogulcancelik/pi-herdr/index.ts",
      "./vendor/accordion/extension/accordion.ts",
      "./extensions"
    ],
    "prompts": ["./prompts"],
    "settings": "./pi.settings.json"
  }
  ```
  ```json
  // decision artifact — new pi.extensions array
  "pi": {
    "extensions": [
      "./extensions/engineering-skills.ts",
      "./extensions/lavish-axi.ts",
      "./extensions/usage-footer.ts",
      "./extensions/tool-panel.ts",
      "./extensions/run-tests.ts",
      "./extensions/accordion.ts",
      "./extensions/herdr-agent-report.ts",
      "./extensions/subagents.ts",
      "./extensions/frontend-coach"
    ],
    "prompts": ["./prompts"],
    "settings": "./pi.settings.json"
  }
  ```
- **Tests to extend**: None — configuration change, not behavior change
- **Wiring/build notes**: No code changes; pi's package loader handles filtering automatically

## Acceptance criteria

- [ ] `package.json` `pi.extensions` array lists all 11 extensions individually
- [ ] `pi.prompts` and `pi.settings` remain unchanged
- [ ] No other files modified
- [ ] `pi install npm:my-pi@1.0.0` still works without filtering
- [ ] `pi install npm:my-pi@1.0.0` with `"extensions": ["*"]` still loads all 12
- [ ] `pi install npm:my-pi@1.0.0` with `"extensions": ["engineering-skills", "lavish-axi"]` loads only those 2

## Blocked by

None - can start immediately
