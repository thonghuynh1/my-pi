# PRD: Migrate Broker into Extension Package

## Problem Statement

The Accordion broker (`broker/`) is a separate npm package with its own `package.json`, `node_modules`, `tsconfig`, and `vitest.config`. This creates unnecessary maintenance overhead — two dependency trees to manage, two install steps, and a fragile path-resolution dance (`resolveBrokerCwd()` navigates `../broker` from `import.meta.url`). Since the broker's only runtime dependency (`ws`) is already present in the extension's `package.json`, the separation provides no isolation benefit.

## Solution

Absorb the broker source files into `extension/broker/`, remove the standalone `broker/` package entirely, and update the extension's spawn logic to point at the new location. Both the broker dashboard link and the direct session link continue to work unchanged. Users notice no difference.

## User Stories

1. As a pi user running `/accordion`, I want the broker to start reliably without depending on a sibling `broker/` package being installed separately, so that setup is simpler.
2. As a contributor, I want a single `package.json` for the extension + broker, so that I run one `npm install` and manage one dependency tree.

## Walking Skeleton

`US-001` — After migration, `/accordion` command starts the broker from `extension/broker/index.ts`, the broker dashboard link works, and the direct session link works. Acceptance: run `/accordion` in a pi session, observe both URLs are printed and reachable.

## Required Behaviors

- `RB-001`: The broker continues to run as a **detached background process** (singleton, outlives the spawning pi session).
- `RB-002`: Both output links (`Broker dashboard: ...` and `Direct session browser: ...`) remain in the `/accordion` command output.
- `RB-003`: Existing broker tests pass under the extension's test runner (`app/vitest.config.ts`).
- `RB-004`: The old `broker/` directory is fully removed (no leftover `package.json`, `node_modules`, configs).

## Accepted Decision Register

### DEC-001 — Broker files land in `extension/broker/`
- **Decision**: Move `broker/src/*.ts` → `extension/broker/` (drop the `src/` nesting)
- **Rationale**: Keeps broker grouped; mirrors the extension's existing flat-ish style; subfolder prevents clutter
- **Rejected alternatives**: Flat in `extension/` as `broker-*.ts` — less discoverable, mixes concerns
- **Downstream impact**: Relative imports inside broker files change from `./server.ts` to unchanged (still `./server.ts` since they stay siblings)
- **Depends on**: None
- **Decided implementation**: `extension/broker/index.ts`, `extension/broker/server.ts`, `extension/broker/registry.ts`, `extension/broker/types.ts`
- **Left to the implementer**: Internal refactoring of broker code (none required)

### DEC-002 — Single package.json, no new dependencies
- **Decision**: Delete `broker/package.json`; do not add deps to `extension/package.json` (all already present)
- **Rationale**: `ws` already in extension deps; dev tooling (`tsx`, `vitest`) comes from `app/` workspace
- **Rejected alternatives**: Keep a minimal `broker/package.json` for scripts only — adds confusion
- **Downstream impact**: `npm install` in `extension/` is sufficient; no separate broker install
- **Depends on**: DEC-001
- **Decided implementation**: Add script `"broker": "node --import tsx/esm broker/index.ts"` to `extension/package.json`
- **Left to the implementer**: Whether to add `tsx` to extension devDeps or rely on app's

### DEC-003 — Spawn path update in ensureBroker()
- **Decision**: Change `resolveBrokerCwd()` to resolve `./broker` (relative to extension dir) instead of `../broker`; validate `broker/index.ts` instead of `broker/src/index.ts`
- **Rationale**: Broker is now a subdirectory of extension, not a sibling
- **Rejected alternatives**: In-process broker — would die with the pi session, breaking multi-session
- **Downstream impact**: Spawn command becomes `["--import", "tsx/esm", "broker/index.ts"]` with `cwd: extensionDir` (or keep `cwd: brokerDir` and run `index.ts`)
- **Depends on**: DEC-001
- **Decided implementation**: Update `resolveBrokerCwd()` and the `spawn()` call args/cwd
- **Left to the implementer**: Exact cwd choice (extension root vs broker subfolder)

### DEC-004 — Tests absorbed by existing vitest config
- **Decision**: Move `broker/__tests__/*` → `extension/broker/__tests__/`; no new vitest config
- **Rationale**: `app/vitest.config.ts` already includes `../extension/**/*.test.ts`
- **Rejected alternatives**: Separate `extension/vitest.config.ts` — unnecessary duplication
- **Downstream impact**: Broker tests run with `cd app && vitest run`
- **Depends on**: DEC-001, DEC-002
- **Decided implementation**: Tests at `extension/broker/__tests__/broker.test.ts`, `extension/broker/__tests__/registry.test.ts`
- **Left to the implementer**: Adjusting import paths in test files if needed

## Implementation Plan

### Area: File relocation

- **Coverage**: DEC-001, DEC-002, DEC-004, US-002, RB-004
- **Code anchors**: `broker/src/index.ts`, `broker/src/server.ts`, `broker/src/registry.ts`, `broker/src/types.ts`, `broker/__tests__/broker.test.ts`, `broker/__tests__/registry.test.ts`, `broker/package.json`, `broker/tsconfig.json`, `broker/vitest.config.ts`
- **Existing behavior**: Standalone package with own install/build/test lifecycle
- **Required edits**:
  - Move `broker/src/*.ts` → `extension/broker/` (US-002)
  - Move `broker/__tests__/*` → `extension/broker/__tests__/` (DEC-004)
  - Delete `broker/package.json`, `broker/tsconfig.json`, `broker/vitest.config.ts`, `broker/node_modules/` (RB-004)
  - Add `"broker": "node --import tsx/esm broker/index.ts"` to `extension/package.json` scripts (DEC-002)
- **Test seam**: `cd app && npx vitest run` — broker tests appear in results
- **Wiring**: None beyond file moves
- **Grounding evidence**: GROUND-003, GROUND-004, GROUND-005, GROUND-006

### Area: Spawn path update

- **Coverage**: DEC-003, US-001, RB-001, RB-002
- **Code anchors**: `extension/accordion.ts` → `resolveBrokerCwd()` (line 277), `ensureBroker()` (line 288)
- **Existing behavior**: Resolves `../broker`, validates `broker/src/index.ts`, spawns with `cwd: brokerDir` and arg `src/index.ts`
- **Required edits**:
  - `resolveBrokerCwd()`: change `path.resolve(here, "..", "broker")` → `path.resolve(here, "broker")`; change validation from `path.join(brokerDir, "src", "index.ts")` → `path.join(brokerDir, "index.ts")`
  - `ensureBroker()` spawn args: change `"src/index.ts"` → `"index.ts"` (since cwd is now `extension/broker/`)
- **Normative snippet**:
  ```ts
  function resolveBrokerCwd(): string | null {
      try {
          const here = path.dirname(fileURLToPath(import.meta.url));
          const brokerDir = path.resolve(here, "broker");
          if (fs.statSync(path.join(brokerDir, "index.ts")).isFile()) return brokerDir;
      } catch { return null; }
      return null;
  }
  ```
- **Test seam**: Manual — run `/accordion`, verify both URLs printed and reachable
- **Wiring**: None
- **Grounding evidence**: GROUND-001, GROUND-002, GROUND-007

### Area: Broker internal imports

- **Coverage**: DEC-001
- **Code anchors**: `broker/src/index.ts` imports `./server.ts`, `./registry.ts`, `./types.ts`
- **Existing behavior**: Relative imports between sibling files in `broker/src/`
- **Required edits**: **None** — files remain siblings in `extension/broker/`, relative imports stay `./server.ts` etc.
- **Test seam**: Broker tests passing confirms imports resolve
- **Grounding evidence**: GROUND-003

## Global Build & Wiring Notes

- The broker process uses `tsx` for TypeScript execution at runtime (`--import tsx/esm`). Ensure `tsx` is available — it's currently a devDep in `broker/package.json`. After deletion, the spawn relies on `tsx` being resolvable from `extension/broker/`. If `app/node_modules/tsx` is hoisted or `extension/` gets `tsx` as a devDep, this works. Verify or add `tsx` to `extension/package.json` devDeps.

## Testing Decisions

- **Broker unit tests** (`broker.test.ts`, `registry.test.ts`): Move to `extension/broker/__tests__/`, run via `cd app && npx vitest run`. Expected: all pass without config changes since `app/vitest.config.ts` includes `../extension/**/*.test.ts`.
- **Integration test**: After migration, run `/accordion` in a pi session. Verify broker starts (check `~/.accordion/browser-broker.json` appears), both links print, broker dashboard responds at its URL.
- No new tests required — existing coverage is sufficient for a file relocation.

## Out of Scope

- Refactoring broker internals (server logic, registry logic, protocol)
- Changing the broker's runtime behavior (still a detached singleton daemon)
- Modifying the app-side broker detection code (`app/src/lib/live/brokerMode.ts`)
- Merging broker HTTP server into the extension's HTTP server (different lifecycle)

## Unresolved Gaps

None.

## Further Notes

Grounding file: `.scratch/migrate-broker-to-extension/grounding.md`
