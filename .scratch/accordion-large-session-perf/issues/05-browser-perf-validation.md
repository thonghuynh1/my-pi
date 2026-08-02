---
Status: ready-for-human
---

## Parent

`.scratch/accordion-large-session-perf/PRD.md`

## What to build

Run the browser performance harness against the live Accordion app with all performance fixes applied. Execute all 6 built-in scenarios and confirm the dashboard stays responsive under the declared thresholds.

Covers: `US-003` (end-to-end validation), `US-001` (browser-level proof)

## Verification steps

1. Start the Accordion app locally: `cd extensions/accordion/app && npm run dev`
2. Run all scenarios:
   ```bash
   cd extensions/accordion/app/perf
   npm run perf
   ```
3. Confirm all 6 scenarios report `passed: true`:
   - `one-message-at-scale`: longest task < 200ms
   - `full-reset-at-scale`: longest task < 500ms
   - `rapid-fire-10`: longest task < 300ms
   - `ghost-idle`: longest task < 50ms, fps ≥ 30
   - `budget-drag`: longest task < 200ms
   - `group-large-range`: longest task < 200ms

4. If any threshold fails, record the actual values. Thresholds may need calibration — adjust in `scenarios.ts` only if the measured values indicate the fix is working but the threshold was set too tight for the test machine.

## Acceptance criteria

- [ ] All 6 browser scenarios pass their declared thresholds on a machine with the Accordion app running
  - Run: `cd extensions/accordion/app/perf && npm run perf`
  - Expected: All scenarios report `passed: true`; summary shows 6/6 pass

- [ ] No Long Task > 500ms observed in any scenario (hard ceiling regardless of per-scenario thresholds)
  - Run: Review `npm run perf` output
  - Expected: No single entry in `longestTask` exceeds 500ms across any scenario

## Blocked by

- `01-walking-skeleton-store-fix-and-benchmark.md` — provides the store performance fix
- `02-session-slots-apply-sync.md` — ensures broker mode is also fixed
- `03-ghost-partial-redraw.md` — ensures ghost-idle scenario can pass
- `04-browser-perf-harness.md` — provides the browser harness infrastructure
