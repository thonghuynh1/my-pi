# Migrate broker tests and remove old broker package

## Parent

`.scratch/migrate-broker-to-extension/PRD.md`

## What to build

Move the broker's test files into `extension/broker/__tests__/`, verify they pass under `app/vitest.config.ts`, and delete the entire old `broker/` directory (package.json, tsconfig, vitest.config, node_modules, and any remaining files).

Covers: `DEC-004`, `RB-003`, `RB-004`.

## Implementation map

### File moves

| From | To |
|------|-----|
| `broker/__tests__/broker.test.ts` | `extension/broker/__tests__/broker.test.ts` |
| `broker/__tests__/registry.test.ts` | `extension/broker/__tests__/registry.test.ts` |

### Import path adjustments in test files

Tests currently import from `../src/index.ts`, `../src/server.ts`, `../src/registry.ts`. After the move they import from `../index.ts`, `../server.ts`, `../registry.ts` (one level up, no `src/`).

Example — in `broker.test.ts`:
```ts
// Before
import { createBrokerServer } from "../src/server.ts";
import { createDiskStore } from "../src/registry.ts";

// After
import { createBrokerServer } from "../server.ts";
import { createDiskStore } from "../registry.ts";
```

### Delete old broker directory

Remove entirely:
- `broker/package.json`
- `broker/tsconfig.json`
- `broker/vitest.config.ts`
- `broker/node_modules/`
- `broker/src/` (now empty after issue #01 moved the files)
- `broker/__tests__/` (now empty after this move)
- `broker/` directory itself

### Test runner

Tests are picked up automatically by `app/vitest.config.ts` which includes `../extension/**/*.test.ts`. No config changes needed. Tests use `node` environment (the default for non-UI, non-Svelte files).

## Acceptance criteria

- [ ] Broker tests pass under the app vitest runner
  - Run: `cd app && npx vitest run --reporter=verbose 2>&1 | grep -E "(broker|registry)\.test"`
  - Expected: `broker.test.ts` and `registry.test.ts` both show ✓ PASS

- [ ] Old broker directory is fully removed
  - Run: `ls broker/ 2>&1`
  - Expected: Error/no such directory

- [ ] No leftover `broker/package.json` anywhere
  - Run: `find . -path "*/broker/package.json"`
  - Expected: No results

## Blocked by

- `01-move-broker-source-and-update-spawn.md`
