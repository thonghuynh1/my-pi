---
status: closed
---

# Move broker source into extension and update spawn path

## Parent

`.scratch/migrate-broker-to-extension/PRD.md`

## What to build

Move the broker's 4 source files from `broker/src/` into `extension/broker/`, update `extension/package.json` with a broker script, and patch `resolveBrokerCwd()` + `ensureBroker()` to spawn from the new location. After this issue, `/accordion` starts the broker from `extension/broker/index.ts` and both the broker dashboard link and direct session link work.

Covers: `US-001`, `US-002`, `DEC-001`, `DEC-002`, `DEC-003`, `RB-001`, `RB-002`.

## Implementation map

### File moves

| From | To |
|------|-----|
| `broker/src/index.ts` | `extension/broker/index.ts` |
| `broker/src/server.ts` | `extension/broker/server.ts` |
| `broker/src/registry.ts` | `extension/broker/registry.ts` |
| `broker/src/types.ts` | `extension/broker/types.ts` |

Relative imports inside broker files (`./server.ts`, `./registry.ts`, `./types.ts`) remain unchanged — files stay siblings.

### extension/package.json — add script

```json
"scripts": {
  "build:client": "node ./build-client.mjs",
  "broker": "node --import tsx/esm broker/index.ts"
}
```

Add `tsx` to devDependencies if not already resolvable:
```json
"devDependencies": {
  "jiti": "^2.7.0",
  "tsx": "^4.0.0"
}
```

### resolveBrokerCwd() — extension/accordion.ts (line 277)

Current:
```ts
function resolveBrokerCwd(): string | null {
    try {
        const here = path.dirname(fileURLToPath(import.meta.url));
        const brokerDir = path.resolve(here, "..", "broker");
        if (fs.statSync(path.join(brokerDir, "src", "index.ts")).isFile()) return brokerDir;
    } catch { return null; }
    return null;
}
```

New:
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

### ensureBroker() spawn — extension/accordion.ts (line 298)

Current:
```ts
spawn(process.execPath, ["--import", "tsx/esm", "src/index.ts"], {
    cwd: brokerCwd, detached: true, stdio: "ignore", shell: false,
});
```

New:
```ts
spawn(process.execPath, ["--import", "tsx/esm", "index.ts"], {
    cwd: brokerCwd, detached: true, stdio: "ignore", shell: false,
});
```

The `cwd` is now `extension/broker/` (resolved by the updated `resolveBrokerCwd()`), so the spawn target is just `index.ts`.

### Choices left to implementer

- Whether to also update `broker/src/server.ts` static-file serving paths (if it references `../../app/build` — verify and adjust to `../../app/build` or `../app/build` as needed from new location).

## Acceptance criteria

- [ ] Broker source files exist at `extension/broker/index.ts`, `extension/broker/server.ts`, `extension/broker/registry.ts`, `extension/broker/types.ts`
  - Run: `ls extension/broker/`
  - Expected: All 4 `.ts` files present

- [ ] `resolveBrokerCwd()` resolves to `extension/broker/`
  - Run: In a pi session, execute `/accordion`
  - Expected: No `"not-found"` error; broker starts or is already running

- [ ] Both links appear in `/accordion` output
  - Run: `/accordion` in a pi session
  - Expected: Output contains both `Broker dashboard: http://127.0.0.1:<port>/` and `Direct session browser: http://127.0.0.1:<port>/?token=<token>`

- [ ] Broker runs as detached process and outlives the spawning session
  - Run: `/accordion`, then check `~/.accordion/browser-broker.json`
  - Expected: File exists with valid `port`, `pid`, `heartbeatAt` within last 15 seconds

## Blocked by

None - can start immediately.
