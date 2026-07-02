---
id: "004"
title: "Live provider verification for cache-aware folding telemetry"
labels: [hitl]
depends_on: ["003"]
status: open
---

## What to build

Run a live verification pass after the local Accordion wiring lands to confirm which providers produce usable cache telemetry in practice.

This slice does not add new feature code. It verifies the already-wired `after_provider_response` → `event.usage` → `frozenFromIndex` path against real providers.

**PRD decisions implemented**: DEC-002, DEC-004, DEC-006, DEC-007, DEC-011

**User stories covered**: 1, 5, 6, 7, 12

## Implementation map

### Area: live provider verification — Anthropic and OpenAI/Codex

- **Decision IDs**: DEC-002, DEC-004, DEC-006, DEC-007, DEC-011
- **Current code anchors**:
  - `vendor/accordion/extension/cache-tracker.ts`
  - `vendor/accordion/extension/accordion.ts`
  - installed package anchors in `node_modules/@earendil-works/pi-coding-agent/dist/core/sdk.js` and `dist/core/extensions/types.d.ts`
- **Existing behavior**: Static inspection proves the hook shape. Unit tests prove provider extraction helpers and one Anthropic-style lifecycle path. A real provider session is still needed to confirm runtime telemetry behavior by provider.
- **Required edits**: No code change required in this area unless the live verification reveals a provider-specific parsing bug.
- **Tests to extend**: Manual live verification.
  - Anthropic. Start a live session, send two turns, inspect whether `frozenFromIndex` becomes non-zero on the second turn.
  - OpenAI/Codex. Start a live session, send two turns, inspect whether cached-token telemetry appears and whether behavior stays lag-one or zero without errors.
  - Unknown or no-telemetry path. Confirm that behavior stays at `frozenFromIndex = 0` without crashes.
- **Wiring/build notes**: This area is HITL by nature. The proof depends on real provider responses, not just repo-local headless tests.

## Acceptance criteria

- [ ] Anthropic live verification shows whether `frozenFromIndex` becomes non-zero after the second turn, and the outcome is recorded.
- [ ] OpenAI or Codex live verification shows whether cached-token telemetry appears, and the outcome is recorded.
- [ ] A no-telemetry provider path, if available, is checked for graceful fallback to `frozenFromIndex = 0` with no errors.
- [ ] Any provider-specific parsing bug found during the run is either fixed in a follow-up issue or recorded as a known limitation.

## Blocked by

- `003-consume-installed-pi-usage-hook-in-accordion.md`
