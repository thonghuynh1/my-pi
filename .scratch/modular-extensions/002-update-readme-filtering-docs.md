# Issue: Update README with extension filtering documentation + lib/ auto-inject model

## What to build

Add documentation to `README.md` explaining how users select which extensions to include, the mandatory vs opt-in model, and how `lib/` helpers are auto-injected.

**PRD Decision IDs**: DEC-002, DEC-007

**User Stories**: US-1, US-2, US-3, US-4, US-5

## Implementation map

### Area: settings.json documentation + extension dependency model

- **Decision IDs**: DEC-002 (lib/ auto-injected), DEC-007 (filter syntax patterns)
- **Current code anchors**: `F:/MyWork/my-pi/README.md` — package documentation
- **Existing behavior**: No filtering documentation exists
- **Required edits**:
  - Add "Extensions" section with full list of 12 extensions
  - Add "How to select" section with filter examples
  - Add "Mandatory vs opt-in" explanation
  - Add "lib/ auto-inject" explanation
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
  ```json
  // decision artifact — exclude specific
  {
    "packages": [{
      "source": "npm:my-package@1.0.0",
      "extensions": ["*"],
      "extensions": ["!run-tests", "!herdr-agent-report"]
    }]
  }
  ```
- **Tests to extend**: None — documentation change
- **Wiring/build notes**: Update README.md only; no code changes

## Acceptance criteria

- [ ] README.md contains "Extensions" section listing all 12 extensions with descriptions
- [ ] README.md contains "How to select" section with three filter examples (all, specific, exclude)
- [ ] README.md contains "Mandatory vs opt-in" explanation
- [ ] README.md contains "lib/ auto-inject" explanation
- [ ] No code changes to package.json or extensions

## Blocked by

None - can start immediately
