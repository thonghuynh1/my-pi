Status: ready-for-agent

## Parent

`.scratch/accordion-authoritative-runtime/PRD.md`

## What to build

Introduce the additive, Pi-owned configuration and session-state contracts that every later runtime slice consumes. Cover `DEC-005`, `DEC-019`, `RB-008`, and `RB-009`.

The initial default conductor is `my-customize-conductor`. Do not import or migrate `accordion.conductor.active` or `accordion.conductors.configured` from browser `localStorage`. Display-only preferences and browser secrets remain browser-local.

## Implementation map

- Add dependency-free runtime types under `vendor/accordion/extension/runtime/`:
  - `AccordionDefaults { schemaVersion: 1; conductorId; budgetPolicy: { kind: "context-aware"; cap: number }; externalConductors[] }`
  - `EffectiveFoldingSettings { enabled; conductorId; budget; protectTokens }`
  - `FoldingRuntimeStatus` and `FoldingRuntimeSnapshot` from the PRD contract.
- Add a settings store that reads/writes `~/.accordion/defaults.json`, honoring `ACCORDION_HOME`, using temp-file plus rename atomicity. Missing, malformed, or unsupported files fall back safely to `my-customize-conductor` and the existing `min(contextWindow, 100_000)` budget policy.
- Extend `vendor/accordion/app/src/lib/live/registry.ts` → `SessionEntry` with complete effective settings and runtime snapshot fields. Extend `vendor/accordion/extension/accordion.ts` → `buildEntry()`/`writeEntry()` so each active `~/.accordion/sessions/<sessionId>.json` is independently understandable.
- Saving defaults changes only `defaults.json`; it must not mutate any active session snapshot. Session shutdown still removes only that session file.
- Keep `HEARTBEAT_INTERVAL_MS`, `STALE_AFTER_MS`, and existing discovery fields compatible. Bump/mirror `REGISTRY_PROTOCOL` only if the chosen shape is intentionally reader-breaking.

## Acceptance criteria

- [ ] Missing, malformed, and unsupported-version defaults resolve to `my-customize-conductor` and the context-aware capped budget.
  - Run: `npx vitest run vendor/accordion/extension/runtime/settings-store.test.ts`
  - Expected: named fallback tests pass using isolated `ACCORDION_HOME` directories.
- [ ] Defaults writes are atomic and a saved default affects a newly created session but not an already-created session snapshot.
  - Run: `npx vitest run vendor/accordion/extension/runtime/settings-store.test.ts`
  - Expected: atomic-write and future-session-only tests pass; no temporary files remain.
- [ ] Two active sessions persist complete, isolated effective settings and deleting one session does not alter the other.
  - Run: `npx vitest run vendor/accordion/extension/runtime/session-entry.test.ts`
  - Expected: multi-session isolation and shutdown-deletion tests pass.
- [ ] Legacy conductor `localStorage` values are never read into Pi-owned defaults.
  - Run: `npx vitest run vendor/accordion/extension/runtime/settings-store.test.ts`
  - Expected: clean-cutover test proves default state is independent of browser storage.

## Blocked by

None - can start immediately.
