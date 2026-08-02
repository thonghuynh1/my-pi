---
Status: ready-for-agent
status: closed
---

## Parent

`.scratch/accordion-large-session-perf/PRD.md`

## What to build

Create a parameterized browser performance harness in `extensions/accordion/app/perf/browser/` that validates end-to-end dashboard responsiveness via WebSocket injection of large sessions. The harness defines scenarios as data, connects as a fake extension, and measures Long Task API entries against configurable thresholds.

Covers: `DEC-006`, `DEC-007`, `DEC-008`, `US-003`, `RB-007`

## Implementation map

### Folder structure

All under `extensions/accordion/app/perf/` (created by issue #01 for store tests; this issue adds the `browser/` subtree):

```
perf/
  browser/
    scenarios.ts        ← PerfScenario type + built-in scenario definitions
    inject.ts           ← WS client: connects as fake extension, sends hello + sync
    run.ts              ← Playwright runner: launch browser, inject session, measure
    report.ts           ← Result formatting, threshold check, summary output
    scenarios.test.ts   ← Headless validation: scenarios type-check, inject protocol correctness
```

Add to `perf/package.json` (from #01): `@playwright/test` in devDependencies, script `"perf": "npx playwright test browser/"` or `"perf": "tsx browser/run.ts"`.

### PerfScenario interface (DEC-007)

```ts
export interface PerfScenario {
  name: string;
  setup: {
    blockCount: number;
    tokensPerBlock?: number;       // default 150
    groups?: number;               // pre-existing folded groups
    foldedPct?: number;            // % of older blocks to fold initially
  };
  action:
    | { type: "append"; blocks: number }
    | { type: "full-reset" }
    | { type: "rapid-fire"; messages: number; intervalMs: number }
    | { type: "budget-drag"; from: number; to: number; steps: number }
    | { type: "idle-with-ghosts"; durationMs: number }
    | { type: "group-range"; blockCount: number };
  thresholds: {
    maxLongTask?: number;          // ms — longest single main-thread task
    maxTotalBlocking?: number;     // ms — sum of all long tasks during action
    minFPS?: number;               // minimum observed fps (ghost/drag scenarios)
    maxMemoryDelta?: number;       // MB — heap growth during action
  };
}

export interface PerfResult {
  scenario: string;
  passed: boolean;
  longestTask: number;
  totalBlocking: number;
  fps?: number;
  memoryDelta?: number;
  details: string;
}
```

### Built-in scenarios (DEC-007)

```ts
export const SCENARIOS: PerfScenario[] = [
  {
    name: "one-message-at-scale",
    setup: { blockCount: 982 },   // real fixture size
    action: { type: "append", blocks: 1 },
    thresholds: { maxLongTask: 200, maxTotalBlocking: 300 },
  },
  {
    name: "full-reset-at-scale",
    setup: { blockCount: 982 },
    action: { type: "full-reset" },
    thresholds: { maxLongTask: 500, maxTotalBlocking: 800 },
  },
  {
    name: "rapid-fire-10",
    setup: { blockCount: 500 },
    action: { type: "rapid-fire", messages: 10, intervalMs: 100 },
    thresholds: { maxLongTask: 300, maxTotalBlocking: 1000 },
  },
  {
    name: "ghost-idle",
    setup: { blockCount: 800, foldedPct: 40 },
    action: { type: "idle-with-ghosts", durationMs: 2000 },
    thresholds: { maxLongTask: 50, minFPS: 30 },
  },
  {
    name: "budget-drag",
    setup: { blockCount: 982 },
    action: { type: "budget-drag", from: 120000, to: 60000, steps: 20 },
    thresholds: { maxLongTask: 200, maxTotalBlocking: 1500 },
  },
  {
    name: "group-large-range",
    setup: { blockCount: 600 },
    action: { type: "group-range", blockCount: 50 },
    thresholds: { maxLongTask: 200, maxTotalBlocking: 400 },
  },
];
```

### WS injection (DEC-008)

`inject.ts` implements a fake extension that:
1. Connects to the app's WS endpoint (default `ws://localhost:5173` or configurable port)
2. Sends a protocol-correct `hello` frame:
   ```ts
   { type: "hello", protocolVersion: 1, sessionId: "perf-bench", meta: { title: "Perf Benchmark", cwd: "/tmp", model: "benchmark", contextWindow: 200000 } }
   ```
3. Sends a `sync` frame with the setup blocks:
   ```ts
   { type: "sync", reqId: 1, full: true, blocks: generateBlocks(scenario.setup), contextWindow: 200000, harness: mockHarness }
   ```
4. Awaits `plan` reply to confirm the app processed the session
5. Executes the action (e.g., sends one more sync with 1 new block for "append")
6. Reports timing/errors

`generateBlocks(setup)` creates synthetic `WireBlock[]` using the same `blk()` pattern from `perf/fixtures/helpers.ts`. Optionally loads real `sample-session.jsonl` blocks for the 982-block scenarios.

### Runner (`run.ts`)

```ts
export async function runScenario(
  scenario: PerfScenario,
  opts?: { headed?: boolean; port?: number }
): Promise<PerfResult>
```

1. Launch Playwright browser (headed or headless)
2. Navigate to app URL
3. Inject performance observer via `page.evaluate`:
   ```ts
   window.__perfEntries = [];
   new PerformanceObserver((list) => {
     window.__perfEntries.push(...list.getEntries());
   }).observe({ type: "longtask", buffered: true });
   ```
4. Connect inject client and execute scenario
5. Collect `window.__perfEntries` via `page.evaluate`
6. Compute results against thresholds
7. Return `PerfResult`

### Headless validation test (`scenarios.test.ts`)

Validates without a running app:
- All scenarios in `SCENARIOS` have valid structure (TypeScript compilation is the primary check)
- `inject.ts` can serialize valid `hello` and `sync` frames (test against a mock WS server that validates protocol shape)
- `generateBlocks(setup)` produces well-formed WireBlock arrays matching setup parameters
- `report.ts` correctly evaluates pass/fail against sample PerfResult data

### Isolation (RB-007)

- `perf/package.json` declares its own dependencies — Playwright and any test utils
- No import from `perf/` into `app/src/` or `extension/`
- `perf/tsconfig.json` extends app tsconfig for shared types but is not referenced by app builds
- `perf/browser/` is excluded from the main app's vitest include glob

### Blocking-edge contract from #01

- **Producer**: Issue #01 creates `perf/package.json`, `perf/vitest.config.ts`, `perf/fixtures/helpers.ts`
- **Consumer**: This issue adds `perf/browser/` alongside the existing `perf/store/`
- **Contract**: Shared fixtures (`blk()`, `loadSampleSession()`, `makeStore()`) from `../fixtures/helpers.ts`
- **Wiring**: Relative import from `browser/inject.ts` → `../fixtures/helpers.ts`

## Acceptance criteria

- [ ] `PerfScenario` type and 6 built-in scenarios compile without errors
  - Run: `cd extensions/accordion/app/perf && npx tsc --noEmit`
  - Expected: Zero TypeScript errors

- [ ] `inject.ts` produces protocol-correct WS frames
  - Run: `cd extensions/accordion/app/perf && npx vitest run browser/scenarios.test`
  - Expected: Test asserts `hello` frame has `type: "hello"`, `protocolVersion: 1`, valid `meta`; `sync` frame has `type: "sync"`, `full: true`, `blocks` array with correct length matching `setup.blockCount`

- [ ] `generateBlocks(setup)` produces valid WireBlock arrays
  - Run: `cd extensions/accordion/app/perf && npx vitest run browser/scenarios.test`
  - Expected: Test asserts blocks have required fields (`id`, `kind`, `turn`, `order`, `text`, `tokens`), correct count, unique IDs

- [ ] `report.ts` correctly evaluates thresholds
  - Run: `cd extensions/accordion/app/perf && npx vitest run browser/scenarios.test`
  - Expected: Test asserts `{ longestTask: 100 }` passes `{ maxLongTask: 200 }` and `{ longestTask: 300 }` fails it

- [ ] `perf/package.json` exists with Playwright dependency, isolated from app and pi root
  - Run: `cat extensions/accordion/app/perf/package.json | grep playwright`
  - Expected: `@playwright/test` appears in devDependencies

- [ ] Harness fails gracefully when app is not running
  - Run: `cd extensions/accordion/app/perf && npx tsx browser/run.ts --scenario one-message-at-scale 2>&1 || true`
  - Expected: Output contains a clear error message like "Could not connect" or "App not running", exits non-zero without crash/hang

## Blocked by

- `01-walking-skeleton-store-fix-and-benchmark.md` — provides `perf/` folder structure, `package.json`, `vitest.config.ts`, and shared `fixtures/helpers.ts`
