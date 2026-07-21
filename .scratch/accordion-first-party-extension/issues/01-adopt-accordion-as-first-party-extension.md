---
status: ready-for-agent
labels: ready-for-agent
type: AFK
prd: ../PRD.md
---

# #01 — Adopt Accordion as a first-party extension with working broker dashboard

## Parent

Parent PRD: [`.scratch/accordion-first-party-extension/PRD.md`](../PRD.md)

## What to build

Atomically move the complete Accordion fork from its misleading vendor/package split into one First-Party Accordion subsystem at `extensions/accordion/`, then prove that the real Pi entry, `/accordion`, detached singleton broker, dashboard serving, watched-session registry, WebSocket proxy, direct-session fallback, app, and existing folding/runtime tests still work.

This is the PRD walking skeleton and the only implementation issue. It intentionally owns the whole source move, all caller/path migration, active documentation updates, and deletion of the old roots because `DEC-005` forbids an intermediate shim or dual source tree.

Coverage:

- **Decisions:** `DEC-001`, `DEC-002`, `DEC-003`, `DEC-004`, `DEC-005`
- **User stories:** `US-001` (walking skeleton), `US-002`, `US-003`
- **Required behaviors:** `RB-001`, `RB-002`, `RB-003`, `RB-004`, `RB-005`, `RB-006`, `RB-007`, `RB-008`, `RB-009`, `RB-010`, `RB-011`, `RB-012`, `RB-013`, `RB-014`

## Implementation map

### Accepted destination and migration contract

The final source topology is:

```text
extensions/accordion/
├── index.ts                         # stable Pi discovery entry
├── extension/                       # existing runtime implementation + smoke/tests
├── app/                             # existing Svelte/Tauri app
├── conductors/                      # existing conductor catalog
├── broker/                          # moved private singleton broker package
├── docs/
├── brand/
├── LICENSE
└── README.md
```

Normative entry:

```ts
// extensions/accordion/index.ts
export { default } from "./extension/accordion.ts";
```

Required migration rules:

1. Move all tracked content from `vendor/accordion/` beneath `extensions/accordion/`; preserve the internal `extension/`, `app/`, `conductors/`, docs, brand, license, and asset topology.
2. Move all tracked content from `packages/accordion-broker/` to `extensions/accordion/broker/`, including its manifest, lockfile, TypeScript/Vitest configuration, source, and tests.
3. Delete both old roots in the same implementation slice. Do not leave symlinks, wrappers, duplicate sources, old-path loaders, or compatibility directories.
4. Preserve package manifests, package-manager boundaries, mirrored broker types, protocols, endpoint shapes, registry schemas, product identity, license, and behavior. This issue is not authorized to consolidate or refactor them.
5. Do not add Capability Visibility or a `piExtension.id`; the default registrations and visibility remain unchanged.

### Pi discovery and root package wiring

Verified current anchors:

- `package.json` → `pi.extensions` explicitly lists `./vendor/accordion/extension/accordion.ts` and separately lists `./extensions`.
- `extensions/frontend-coach/index.ts` and `extensions/frontend-coach/package.json` prove the repository's nested first-party extension pattern.
- `package.json` → `accordion:install`, `accordion:build`, `accordion:update`, `accordion:broker` target old paths.
- `scripts/postinstall.mjs` checks and installs old app/runtime/broker paths.
- `pnpm-workspace.yaml`, root `vitest.config.ts`, and root `tsconfig.json` encode old or overly broad paths.

Required edits:

- Remove only the explicit vendor Accordion entry from `package.json`; keep generic `./extensions` discovery so `extensions/accordion/index.ts` loads exactly once.
- Preserve root script names and retarget them to:
  - app: `extensions/accordion/app`
  - runtime package: `extensions/accordion/extension`
  - broker: `extensions/accordion/broker`
- Retarget all `scripts/postinstall.mjs` existence checks, installs, and app-build checks.
- Retarget `pnpm-workspace.yaml` and root `vitest.config.ts` to the moved app/runtime tests.
- Exclude `extensions/accordion/**` from the generic root `tsconfig.json`. Accordion remains owned by its Svelte/Vitest/runtime/broker/Tauri gates; do not repair the unrelated existing root `extensions/subagents.ts:1193:4` `TS2353` in this issue.

### Runtime and `/accordion` path wiring

Verified current anchors in existing `vendor/accordion/extension/accordion.ts`:

- default extension factory `accordionLive`
- `resolveBrokerCwd()`
- `ensureBroker()`
- `repoAppCandidates()`
- nested `resolveClientRoot()`
- `pi.registerCommand("accordion")`

The complete Accordion tree moves intact, so the runtime remains at planned `extensions/accordion/extension/accordion.ts`; sibling `../app` and `../conductors` topology remains valid. Update only invalidated path calculations:

- `resolveBrokerCwd()` must resolve planned sibling `extensions/accordion/broker/` and verify `src/index.ts` there.
- `ensureBroker()` must preserve `node --import tsx/esm src/index.ts`, detached process ownership, readiness polling, and best-effort failure results.
- `repoAppCandidates()` and runtime `resolveClientRoot()` retain their existing outcomes against sibling `app/`; adjust only if the move makes an existing calculation invalid.
- `/accordion` must still write focus/watch requests, start or reuse the broker, optionally launch the desktop app, report broker and token-bearing direct URLs, and leave direct mode/provider passthrough available on broker failure.
- Retarget `extension/build-client.mjs` and smoke imports/messages to the stable planned entry and moved paths.

Do not change tool names, command names, flags, event hooks, timeouts, authentication, fold plans, recall/unfold behavior, or provider-safety behavior.

### Broker path and process wiring

Verified current anchors:

- Existing `packages/accordion-broker/src/index.ts::startBroker()` owns loopback bind, registry heartbeat, watch consumption, stale pruning, and shutdown.
- `server.ts::{resolveClientRoot,createBrokerServer,proxySession}` serve the app and proxy browser frames.
- `registry.ts::{createDiskStore,consumeWatchRequests,pruneWatchedSessions}` own `~/.accordion` disk coordination.
- `types.ts` intentionally mirrors app registry/protocol constants; leave this duplication intact under `DEC-004`.

After the move:

- Broker static asset candidates resolve local sibling outputs:
  - `extensions/accordion/app/build`
  - `extensions/accordion/extension/dist/client`
- Preserve routes exactly:
  - `GET /__accordion/broker-meta`
  - `GET /__accordion/sessions`
  - `WS /ws/session/<sessionId>`
- Preserve the detached singleton model, transparent frame proxy, early-message buffering, watched/live session checks, heartbeat intervals, stale thresholds, rejection behavior, and close propagation.
- Preserve all `~/.accordion/` filenames and payload shapes.

### Dashboard behavior

Move app code without behavior edits. The following existing symbols remain authoritative at their new paths:

- `app/src/lib/live/brokerMode.ts::detectBrokerMode()`
- `app/src/lib/live/brokerIntegration.svelte.ts::{startBrokerDetection,pollBrokerSessions,handleBrokerFocus}`
- `app/src/lib/live/sessionSlots.svelte.ts`

The same app build must continue to detect broker mode through `/__accordion/broker-meta`, poll `/__accordion/sessions`, connect isolated slots through `/ws/session/<sessionId>`, and fall back to direct mode when broker metadata is unavailable.

### Adoption smoke — real blocking-edge proof

Add `extensions/accordion/extension/adoption-smoke.mjs` as a bounded headless harness. It owns the walking-skeleton proof and must:

1. Set a temporary `ACCORDION_HOME` before importing Accordion.
2. Import the real planned `extensions/accordion/index.ts` through jiti and instantiate the extension with a mock Pi API sufficient for session startup and `/accordion`.
3. Set an explicit missing `ACCORDION_APP_PATH` so no real desktop app launches.
4. Start the real per-session extension server and invoke the captured `/accordion` command without pre-seeding `browser-broker.json`.
5. Observe the real moved broker subprocess become ready via the temporary `browser-broker.json`.
6. Wait for the broker to consume the watch request and return the current session from `GET /__accordion/sessions`.
7. Assert `GET /__accordion/broker-meta` reports broker mode and the existing protocol version.
8. Assert broker `/` serves the already-built app `index.html`.
9. Connect through `WS /ws/session/<sessionId>` and observe the real upstream extension `hello` frame, proving the proxy is wired rather than stubbed.
10. Assert the `/accordion` notification still includes a token-bearing direct-session URL.
11. Shut down the extension, terminate the broker PID from the temporary registry, and remove temporary files even on failure.

Success line must be recognizable and include all crossing edges:

```text
ADOPTION SMOKE PASS — index-entry ✓ broker-start ✓ watched-session ✓ broker-meta ✓ broker-static ✓ broker-proxy ✓ direct-url ✓ cleanup ✓
```

Also retarget existing `extensions/accordion/extension/smoke.mjs` to import `../index.ts`; retain all its current runtime assertions and `SMOKE PASS` result.

Blocking-edge contract proved by the adoption smoke:

```text
extensions/accordion/index.ts
  → extension/accordion.ts::/accordion
  → extension/accordion.ts::ensureBroker
  → extensions/accordion/broker/src/index.ts
  → ~/.accordion watch/session registry
  → broker HTTP + WS proxy
  → per-session Authoritative Accordion Folding Runtime
```

Removing or stubbing any crossing edge must make the adoption smoke fail.

### Operational docs and active tracker anchors

Update current instructions and active execution artifacts, not product history:

- Root `README.md` must call this **First-Party Accordion**, point to `extensions/accordion/`, and retain working setup/build/broker commands.
- Moved Accordion `README.md` and `CONTRIBUTING.md` must use their nested `my-pi` paths where instructions depend on checkout location.
- Update executable source anchors in `.scratch/accordion-chunked-compaction/PRD.md`, its map, issues, and tickets from `vendor/accordion/...` to `extensions/accordion/...`; do not implement or otherwise revise that feature.
- Historical grill ledgers/grounding and prior completed evidence may retain the old observed path only when the file contains a concise note that Accordion was later relocated to `extensions/accordion/` by this migration.
- Preserve Accordion's LICENSE, attribution, brand, and product name.

Grounding evidence: `.scratch/grills/6f2a9c1d8e4b/grounding.md`, especially `GROUND-001` through `GROUND-008`.

### Verification baseline discovered before publication

- App Vitest: passed.
- Broker Vitest: 20/20 passed.
- Runtime smoke: passed.
- Broker TypeScript check: passed.
- App production build: passed.
- App Svelte check: 0 errors and 20 existing accessibility warnings, all in `MapHeader.svelte`. Do not make this migration responsible for unrelated warning cleanup; introduce no new warnings.
- Root `npm run check`: already fails only at `extensions/subagents.ts:1193:4` with `TS2353` because `modelRegistry` is not in `CreateAgentSessionServicesOptions`. Do not fix it here; introduce no Accordion diagnostics or additional root errors.
- Cargo: unavailable in the publishing environment. Native verification is split into blocked human issue `02-verify-tauri-native-build.md`.

## Acceptance criteria

- [ ] **AC-01 — One source root with no compatibility copy.** The complete Accordion tree and broker exist only under `extensions/accordion/`; both old roots are absent.
  - Run: `node -e "const fs=require('fs'); const must=['extensions/accordion/index.ts','extensions/accordion/extension/accordion.ts','extensions/accordion/app/package.json','extensions/accordion/conductors/index.ts','extensions/accordion/broker/src/index.ts','extensions/accordion/LICENSE']; const absent=['vendor/accordion','packages/accordion-broker']; if(must.some(p=>!fs.existsSync(p))||absent.some(p=>fs.existsSync(p))) process.exit(1); console.log('accordion topology: ok')"`
  - Expected: prints `accordion topology: ok`; neither old directory exists.

- [ ] **AC-02 — Pi discovers Accordion exactly once through the stable first-party entry.** Root manifest retains `./extensions`, has no explicit Accordion entry, and `index.ts` default-exports the runtime.
  - Run: `node -e "const fs=require('fs'); const p=require('./package.json'); const e=p.pi.extensions; const idx=fs.readFileSync('extensions/accordion/index.ts','utf8'); if(!e.includes('./extensions')||e.some(x=>/accordion/i.test(x))||!idx.includes('./extension/accordion.ts')) process.exit(1); console.log('accordion discovery: ok')"`
  - Expected: prints `accordion discovery: ok`; no duplicate explicit registration can double-load hooks or commands.

- [ ] **AC-03 — Walking skeleton crosses the real entry, command, broker, registry, static app, proxy, and session runtime.**
  - Run: `npm run build --prefix extensions/accordion/app && node extensions/accordion/extension/adoption-smoke.mjs`
  - Expected: exits 0 and prints exactly the success markers `index-entry ✓ broker-start ✓ watched-session ✓ broker-meta ✓ broker-static ✓ broker-proxy ✓ direct-url ✓ cleanup ✓`; the harness leaves no broker process or temporary registry behind.

- [ ] **AC-04 — Root install/workspace/test/compiler wiring targets the new subsystem without absorbing it into generic root TypeScript.** Existing script names remain, each targets `extensions/accordion`, workspace/test paths are current, and root `tsconfig.json` excludes `extensions/accordion/**`.
  - Run: `node -e "const fs=require('fs'); const p=require('./package.json'); const scripts=Object.entries(p.scripts).filter(([k])=>k.startsWith('accordion:')).map(([,v])=>v).join('\n'); const post=fs.readFileSync('scripts/postinstall.mjs','utf8'); const ws=fs.readFileSync('pnpm-workspace.yaml','utf8'); const vt=fs.readFileSync('vitest.config.ts','utf8'); const ts=require('./tsconfig.json'); const all=scripts+post+ws+vt; if(/vendor\/accordion|packages\/accordion-broker/.test(all)||!all.includes('extensions/accordion')||!(ts.exclude||[]).includes('extensions/accordion/**')) process.exit(1); console.log('accordion wiring: ok')"`
  - Expected: prints `accordion wiring: ok`; the unchanged pre-existing root `TS2353` is not expanded by Accordion diagnostics.

- [ ] **AC-05 — Existing app, engine, broker-mode, session-slot, conductor, and extension integration tests still pass from the moved path.**
  - Run: `npm test --prefix extensions/accordion/app`
  - Expected: exits 0; all moved Vitest suites pass, including `brokerMode`, `brokerSessions`, `sessionSlots`, mapping/engine, chunked-compaction, cache-tracker, and proactive-compression coverage.

- [ ] **AC-06 — The moved broker preserves its typed contract and all HTTP/registry/WebSocket behavior.**
  - Run: `npm run check --prefix extensions/accordion/broker && npm test --prefix extensions/accordion/broker`
  - Expected: TypeScript reports zero errors and Vitest reports 20/20 passing tests, including watched/stale rejection, metadata/session routes, text/binary relay, early buffering, and close propagation.

- [ ] **AC-07 — Existing runtime smoke and app quality gates remain at baseline or better.**
  - Run: `node extensions/accordion/extension/smoke.mjs && npm run check --prefix extensions/accordion/app && npm run build --prefix extensions/accordion/app`
  - Expected: runtime prints `SMOKE PASS`; Svelte check reports 0 errors and no warnings outside the existing `MapHeader.svelte` accessibility set (20 or fewer); build exits 0 and writes `extensions/accordion/app/build/index.html`.

- [ ] **AC-08 — Adoption preserves identity and package/contract structure.** LICENSE, brand, docs, app, conductors, extension manifest, and broker manifest remain present; no new shared-contract package, Capability Visibility registration, or package consolidation is introduced.
  - Run: `node -e "const fs=require('fs'); const must=['extensions/accordion/LICENSE','extensions/accordion/brand','extensions/accordion/docs','extensions/accordion/app/package.json','extensions/accordion/extension/package.json','extensions/accordion/broker/package.json','extensions/accordion/conductors']; if(must.some(p=>!fs.existsSync(p))) process.exit(1); const idx=fs.readFileSync('extensions/accordion/index.ts','utf8'); if(/piExtension|createManagedExtension/.test(idx)) process.exit(1); console.log('accordion identity and boundaries: ok')"`
  - Expected: prints `accordion identity and boundaries: ok`.

- [ ] **AC-09 — No operational or active-tracker instruction points to deleted paths.** Historical references are explicitly annotated rather than silently rewritten as contemporary evidence.
  - Run: `! git grep -nE 'vendor/accordion|packages/accordion-broker' -- package.json scripts pnpm-workspace.yaml vitest.config.ts tsconfig.json README.md extensions packages docs .scratch/accordion-chunked-compaction`
  - Expected: exits 0 with no matches. Any old-path match elsewhere in `.scratch/` is in historical evidence containing a relocation note to `extensions/accordion/`.

- [ ] **AC-10 — Root package setup remains automatic from the new paths.** The retargeted install/build scripts and broker package installation complete and produce the browser build consumed by direct and broker modes.
  - Run: `npm run accordion:install && npm install --prefix extensions/accordion/broker && npm run accordion:build`
  - Expected: exits 0; app, runtime, and broker dependencies resolve from `extensions/accordion/**`, and `extensions/accordion/app/build/index.html` exists. `scripts/postinstall.mjs` encodes the same three dependency/build checks, and no old path is recreated.

- [ ] **AC-11 — Generic root TypeScript gains no Accordion or migration error.** The only root compiler failure remains the verified unrelated pre-existing `subagents.ts` API drift.
  - Run: `node -e "const {spawnSync}=require('child_process'); const r=spawnSync('npm',['run','check','--','--pretty','false'],{encoding:'utf8',shell:true}); const out=(r.stdout||'')+(r.stderr||''); const errors=out.split(/\\r?\\n/).filter(x=>/error TS\\d+/.test(x)); if(errors.length!==1||!errors[0].includes('extensions/subagents.ts(1193,4)')||!errors[0].includes('TS2353')||errors[0].includes('accordion')){console.error(out);process.exit(1)} console.log('root TypeScript baseline: unchanged')"`
  - Expected: wrapper exits 0 and prints `root TypeScript baseline: unchanged`; no compiler diagnostic references `extensions/accordion/`.

## Blocked by

None - can start immediately.
