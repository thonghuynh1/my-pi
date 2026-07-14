# PRD: Modular Extension Package for my-pi

## Problem Statement

The `my-pi` package currently bundles all ~12 extensions in a flat `extensions/` directory, forcing every user to receive everything. Users want to opt-in to only the extensions they need — reducing bundle size, dependency overhead, and surface area for unwanted functionality.

## Solution

Restructure `my-pi` as a selectable extension package where users pick which extensions to include via `settings.json` filtering. Mandatory extensions ship with every install; opt-in extensions require explicit selection.

## User Stories

1. As a power user, I want only engineering-skills, lavish-axi, usage-footer, tool-panel, and run-tests so that I get core functionality without bloat
2. As a planner, I want to add herdr-agent-report so that I can do planning workflows
3. As a frontend developer, I want to include frontend-coach so that I get browser automation tools
4. As a minimal install user, I want the smallest possible extension set so that pi loads faster and uses fewer tokens
5. As a user, I want lib/ helpers always available so that all extensions share utilities without redeclaring dependencies

## Accepted Decision Register

| ID | Decision | Lens | Rationale | Rejected | Downstream Impact |
|----|----------|------|-----------|----------|-------------------|
| DEC-001 | Single package with filtering (not separate sub-packages) | strategy | Matches pi's native package filtering; one tarball, one dep set, no version conflicts | Separate sub-packages per extension | Filter via `"extensions": ["plan-mode", "todo"]` in settings |
| DEC-002 | lib/ is auto-injected, always available | contract | Shared utilities need to be accessible to all extensions without dependency declaration | lib/ as selectable unit | lib/ modules always loaded; extensions import freely |
| DEC-003 | frontend-coach is first-class selectable unit | scope | Cohesive frontend tool suite with bundled deps; can't meaningfully split | Split into individual files | Users get full frontend-coach/ or nothing |
| DEC-004 | Mandatory extensions: engineering-skills, lavish-axi, usage-footer, tool-panel, run-tests | scope | Core product functionality; every user needs these | All extensions mandatory | These ship with default install |
| DEC-005 | Accordion is opt-in, not mandatory | scope | Requires Accordion app + broker; not core functionality | Accordion mandatory | Users must explicitly select accordion |
| DEC-006 | pi-herdr is opt-in, not mandatory | scope | Reporting feature; separate pi package; dependency cost not universal | pi-herdr mandatory | Users must explicitly select herdr |
| DEC-007 | Filter syntax: `"extensions": ["*"]` for all, specific names for subset, `["*", "!pattern"]` for exclusion | contract | pi's native filtering supports all three patterns | Custom filtering logic | Users can express any subset via settings |

## Implementation Plan

### Area: package.json pi manifest

- **Decision IDs**: DEC-001, DEC-007
- **Current code anchors**: `F:/MyWork/my-pi/package.json` — `pi.extensions` currently lists everything flat
- **Existing behavior**: All extensions loaded regardless of user preference
- **Required edits**: 
  - List all 12 extensions individually in `pi.extensions` array
  - Each entry is a string path to an extension file
  - Users filter via `settings.json` object-form package entry
- **Snippet(s)**:
  ```json
  // current code anchor — package.json pi.extensions
  "pi": {
    "extensions": [
      "./node_modules/pi-mcp-adapter/index.ts",
      "./node_modules/@ogulcancelik/pi-herdr/index.ts",
      "./vendor/accordion/extension/accordion.ts",
      "./extensions"
    ]
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
      "./extensions/pair-program.ts",
      "./extensions/subagents.ts",
      "./extensions/frontend-coach"
    ],
    "prompts": ["./prompts"],
    "settings": "./pi.settings.json"
  }
  ```
- **Tests to extend**: None — this is a configuration change, not behavior change
- **Wiring/build notes**: No code changes; pi's package loader handles filtering automatically

### Area: settings.json documentation

- **Decision IDs**: DEC-001, DEC-007
- **Current code anchors**: `F:/MyWork/my-pi/README.md` — package documentation
- **Existing behavior**: No filtering documentation exists
- **Required edits**: Add usage examples showing how users pick subsets
- **Snippet(s)**:
  ```json
  // decision artifact — minimal install
  {
    "packages": [{
      "source": "npm:my-package@1.0.0",
      "extensions": ["engineering-skills", "lavish-axi", "usage-footer", "tool-panel", "run-tests"]
    }]
  }
  ```
  ```json
  // decision artifact — full install (default)
  {
    "packages": [{
      "source": "npm:my-package@1.0.0",
      "extensions": ["*"]
    }]
  }
  ```
- **Tests to extend**: None
- **Wiring/build notes**: Document in README.md; no code changes

### Area: extension dependency model

- **Decision IDs**: DEC-002, DEC-003
- **Current code anchors**: `F:/MyWork/my-pi/extensions/` — extension files; `F:/MyWork/my-pi/extensions/lib/` — shared helpers
- **Existing behavior**: lib/ modules are available to all extensions via import
- **Required edits**: No code changes; document the auto-inject model
- **Snippet(s)**:
  ```typescript
  // decision artifact — lib/ auto-inject model
  // lib/ modules are always loaded; extensions import freely
  import { agentSessionUtils } from "my-pi/lib/agent-session-utils";
  ```
- **Tests to extend**: None
- **Wiring/build notes**: lib/ is part of package root, not selectable

## Global Build & Wiring Notes

- Pi's package filtering is handled automatically by the loader
- No code changes required; this is a configuration/documentation update
- `pi-herdr` is installed via `dependencies` but only loaded if selected
- `accordion.ts` requires Accordion app + broker; graceful fallback if missing

## Testing Decisions

- No behavioral tests needed; this is a packaging configuration change
- Manual verification: install with different filter configs and confirm only selected extensions load

## Out of Scope

- Refactoring extension code itself
- Adding new extensions
- Changing extension APIs

## Unresolved Gaps

None

## Further Notes

- This PRD is meant for documentation and issue generation via `to-issues`
- Implementation is purely configuration/documentation; no code edits required
