Status: ready-for-agent

## Parent

`.scratch/accordion-authoritative-runtime/PRD.md`

## What to build

Add deterministic, local performance proof for the accepted heavy-session cold and warm targets. Cover `DEC-014` and `RB-007`.

## Implementation map

- Consume the real cold worker path and incremental delta path from `05-incremental-warm-calculation.md`; do not benchmark a standalone stub or browser conductor.
- Add seeded deterministic fixtures representing 500k estimated tokens across 5,000 durable blocks with realistic user/text/thinking/tool-call/tool-result pairing and protected/frozen zones.
- Cold measurement includes worker startup/initialization, snapshot transfer, conductor calculation, plan return, and matching ready revision. Target: at most 2,000 ms.
- Warm measurement begins from the ready cold worker, appends exactly 20 committed blocks (not over 20k tokens), includes worker IPC and ready revision, runs enough samples to calculate p95, and targets at most 100 ms.
- Exclude model/tool/network/external-conductor time. Report sample count, median, p95, max, fixture identity, and calculation path on failure.
- Add structural assertions alongside wall time: warm payload contains only the delta and warm operation counters show no full-history serialization/recompute. This keeps proof discriminating on variable hardware.
- Grounding: `GROUND-004`, `GROUND-006`, `GROUND-016`.

## Acceptance criteria

- [ ] The deterministic fixture always creates byte-equivalent IDs, block kinds, token totals, boundaries, and tool pairs.
  - Run: `npx vitest run vendor/accordion/extension/runtime/runtime.performance.test.ts --pool=forks --maxWorkers=1`
  - Expected: fixture-repeatability test passes for 5,000 blocks and approximately 500k tokens.
- [ ] A cold authoritative `my-customize` calculation reaches matching ready state within 2,000 ms.
  - Run: `npx vitest run vendor/accordion/extension/runtime/runtime.performance.test.ts --pool=forks --maxWorkers=1`
  - Expected: cold threshold test passes and prints cold duration/path metrics.
- [ ] Warm 20-block delta calculations complete at p95 no greater than 100 ms.
  - Run: `npx vitest run vendor/accordion/extension/runtime/runtime.performance.test.ts --pool=forks --maxWorkers=1`
  - Expected: warm threshold test passes and prints sample count, median, p95, and max.
- [ ] The warm benchmark fails if the host sends a full snapshot or invokes the full serialization/recompute counters.
  - Run: `npx vitest run vendor/accordion/extension/runtime/runtime.performance.test.ts --pool=forks --maxWorkers=1`
  - Expected: structural warm-path assertions pass against the real worker protocol.

## Blocked by

- `05-incremental-warm-calculation.md`
