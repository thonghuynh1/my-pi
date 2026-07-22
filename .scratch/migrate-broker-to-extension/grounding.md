# Grounding — Migrate Broker into Extension Package

### GROUND-001 — resolveBrokerCwd()
- Source: `extension/accordion.ts` → `resolveBrokerCwd()` (lines 277–287)
- Existing behavior: Resolves `../broker` relative to `import.meta.url`, validates `broker/src/index.ts` exists
- Current excerpt:
  ```ts
  const here = path.dirname(fileURLToPath(import.meta.url));
  const brokerDir = path.resolve(here, "..", "broker");
  if (fs.statSync(path.join(brokerDir, "src", "index.ts")).isFile()) return brokerDir;
  ```
- Test prior art: None (no direct test for this function)

### GROUND-002 — ensureBroker()
- Source: `extension/accordion.ts` → `ensureBroker()` (lines 288–313)
- Existing behavior: Checks registry, spawns `node --import tsx/esm src/index.ts` in `brokerCwd` as detached process, polls for 2s
- Current excerpt:
  ```ts
  spawn(process.execPath, ["--import", "tsx/esm", "src/index.ts"], {
      cwd: brokerCwd, detached: true, stdio: "ignore", shell: false,
  });
  ```
- Test prior art: None (no direct test)

### GROUND-003 — Broker source layout
- Source: `broker/src/index.ts`, `broker/src/server.ts`, `broker/src/registry.ts`, `broker/src/types.ts`
- Existing behavior: 4 files with relative `.ts` imports between them (`./server.ts`, `./registry.ts`, `./types.ts`)
- Test prior art: `broker/__tests__/broker.test.ts`, `broker/__tests__/registry.test.ts`

### GROUND-004 — Broker package.json
- Source: `broker/package.json`
- Existing behavior: `name: accordion-broker`, deps: `ws ^8.21.0`, devDeps: `tsx`, `typescript`, `vitest`, `@types/node`, `@types/ws`
- Runtime dep `ws` is already in `extension/package.json`

### GROUND-005 — Extension package.json
- Source: `extension/package.json`
- Existing behavior: `name: @a-fig/accordion`, deps: `ws ^8.18.0`, `typebox ^1.1.24`, devDeps: `jiti ^2.7.0`
- No `test` script; tests picked up by `app/vitest.config.ts` via `include: ["../extension/**/*.test.ts"]`

### GROUND-006 — App vitest config includes extension tests
- Source: `app/vitest.config.ts`
- Existing behavior: `include: ["src/lib/**/*.test.ts", "../extension/**/*.test.ts"]`
- Tests under `extension/` are automatically picked up with `node` environment

### GROUND-007 — /accordion command handler
- Source: `extension/accordion.ts` → `pi.registerCommand("accordion", ...)` (lines 1438–1463)
- Existing behavior: Calls `ensureBroker()`, outputs both broker dashboard URL and direct session browser URL
- Both links are independent — broker URL from broker's port, direct URL from extension's own port
