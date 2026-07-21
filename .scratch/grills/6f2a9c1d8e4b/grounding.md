> Historical path note: Accordion was later relocated to `extensions/accordion/` and `extensions/accordion/broker/` by `.scratch/accordion-first-party-extension/issues/01-adopt-accordion-as-first-party-extension.md`.

# Repository grounding — adopt Accordion as a first-party extension

## G001 — Current ownership label and activation

- `README.md`, section `## Accordion`: explicitly says the repo "vendors" Accordion under `vendor/accordion`.
- `package.json`, `pi.extensions`: Pi activates `./vendor/accordion/extension/accordion.ts` directly.
- `package.json`, scripts `accordion:install`, `accordion:build`, `accordion:update`: all target `vendor/accordion/...`.

## G002 — Accordion is not an independently linked repository

- `git ls-files --stage vendor/accordion` shows ordinary tracked files, not a gitlink.
- No root `.gitmodules` exists.
- `git -C vendor/accordion rev-parse --show-toplevel` resolves to the `my-pi` root and its remote is the `my-pi` fork.

## G003 — Existing first-party layout conventions

- `extensions/` contains custom `my-pi` extensions and is loaded by `package.json` through `./extensions`.
- `packages/accordion-broker/` is already a first-party Accordion-related package.
- `pnpm-workspace.yaml` currently names `vendor/accordion/app` as its only workspace package.

## G004 — The runtime extension is coupled to the wider Accordion source tree

- `vendor/accordion/extension/accordion.ts` imports `linearize`, `applyPlan`, protocol, and registry modules from `../app/src/lib/live/*`.
- `vendor/accordion/extension/chunked-compaction-diagnostic.ts` imports both `../conductors/*` and `../app/*`.
- `vendor/accordion/extension/chunked-compaction-invariant.test.ts` integrates extension, conductor, and app engine code.
- Therefore moving only `accordion.ts` is not a path-only change; it requires either moving its supporting modules together or introducing stable package interfaces.

## G005 — Other first-party wiring assumes the vendor path

- `packages/accordion-broker/src/server.ts` resolves browser assets from `vendor/accordion/app/build` and `vendor/accordion/extension/dist/client`.
- Root `vitest.config.ts` extends `vendor/accordion/app/vitest.config.ts` and includes app/extension tests there.
- Root `pnpm-workspace.yaml` and README/build instructions also encode the current path.

## G006 — Accepted runtime boundary

- `docs/adr/0002-authoritative-accordion-folding-runtime.md` makes each activated Pi session extension the Authoritative Accordion Folding Runtime; the dashboard is optional.
- A layout migration must preserve that runtime ownership unless the ADR is explicitly superseded.

## G007 — Pi does not require first-party extension source to live under `extensions/`

- Pi `docs/packages.md`, `Creating a Pi Package`: a package manifest may explicitly declare any relative extension path under `pi.extensions`.
- Pi `docs/extensions.md`, `Extension Styles`: `extensions/<name>/index.ts` is supported for multi-file extensions, but that convention describes the loadable extension module, not an entire browser/desktop product.
- The root `package.json` is already the installed Pi package, so it can continue loading Accordion from an explicit first-party path.

## G008 — Splitting the fork would create new seams without established variation

- The app aliases `$conductors` directly to `../conductors` in `vendor/accordion/app/svelte.config.js` and `vite.config.js`.
- The extension imports app live-engine modules and conductor modules through relative paths (G004).
- No existing package interface separates runtime, app engine, and conductors. A split across multiple first-party packages would require designing and testing those interfaces rather than merely adopting ownership.
- `codebase-design` guidance favors preserving locality and avoiding a new seam until more than one adapter or caller proves real variation.

## G009 — Cohesive relocation is feasible

- Because the root manifest can name an explicit extension file (G007), the complete internal `extension/`, `app/`, `conductors/`, `docs/`, and asset layout can move together to a first-party home while retaining its relative imports.
- Root path consumers that must migrate are bounded: `package.json`, `scripts/postinstall.mjs`, `pnpm-workspace.yaml`, `vitest.config.ts`, `packages/accordion-broker/src/server.ts`, `packages/accordion-broker/src/types.ts`, and repository documentation.

## G010 — `frontend-coach` proves the nested first-party extension pattern

- `extensions/frontend-coach/package.json` is a private extension package with its own runtime dependencies and `pi.extensions: ["./index.ts"]`.
- `extensions/frontend-coach/index.ts` is the Pi entry and keeps HTTP/WebSocket behavior plus helper modules and a browser asset local to the extension directory.
- `extensions/frontend-coach/README.md` explicitly treats `extensions/frontend-coach/` as its owned home.
- Root `package.json` already loads `./extensions`, so `extensions/accordion/index.ts` can follow the same discovery pattern and remove Accordion's separate explicit vendor-path registration.
- The scale differs: `frontend-coach` has 9 tracked files while Accordion has 365 and includes a Svelte/Tauri app, conductors, docs, and brand assets. The pattern is feasible, but Accordion must remain a cohesive nested subsystem rather than flattening all files into the shared `extensions/` root.

## G011 — Current `/accordion` broker startup flow

- `vendor/accordion/extension/accordion.ts::pi.registerCommand("accordion")` writes the one-shot focus request, calls `ensureBroker()`, writes `~/.accordion/watch-requests/<sessionId>.json`, optionally launches the desktop app, and reports both broker and direct-session URLs.
- `accordion.ts::ensureBroker()` accepts a live `~/.accordion/browser-broker.json`; otherwise it resolves `packages/accordion-broker`, spawns `node --import tsx/esm src/index.ts` detached, and polls readiness for two seconds.
- Broker registration is best-effort. If broker startup or watch registration fails, the direct per-session browser link and provider-safe passthrough behavior remain available.

## G012 — Browser Broker module responsibility

- `packages/accordion-broker/src/index.ts::startBroker()` owns one singleton loopback process, a random port, broker registry heartbeat, watch-request consumption, and stale-session pruning.
- `packages/accordion-broker/src/server.ts::createBrokerServer()` serves the built dashboard, exposes `GET /__accordion/broker-meta` and `GET /__accordion/sessions`, and proxies `WS /ws/session/<sessionId>` to each Pi session extension's ephemeral port.
- `server.ts::proxySession()` is a transparent bidirectional WebSocket adapter; it owns no folding plan or session engine state.
- `packages/accordion-broker/src/registry.ts` coordinates processes through `~/.accordion/{browser-broker.json,watch-requests/,watched-sessions.json,sessions/}` using atomic writes and heartbeat freshness.

## G013 — Dashboard broker-mode flow

- `vendor/accordion/app/src/lib/live/brokerMode.ts::detectBrokerMode()` probes `/__accordion/broker-meta`; success selects broker mode, while absence/network failure selects direct single-session mode.
- `vendor/accordion/app/src/lib/live/brokerIntegration.svelte.ts::startBrokerDetection()` polls `/__accordion/sessions` every two seconds.
- Each watched session gets an isolated slot and WebSocket connection through `/ws/session/<sessionId>`; the broker transports frames while each session's Authoritative Accordion Folding Runtime remains the source of folding behavior.

## G014 — Broker migration pressure

- The current separate package has hard-coded paths back to `vendor/accordion/app/build` and `vendor/accordion/extension/dist/client` in `packages/accordion-broker/src/server.ts::resolveClientRoot()`.
- `accordion.ts::resolveBrokerCwd()` derives the repository root from the old vendor depth and hard-codes `packages/accordion-broker`.
- `packages/accordion-broker/src/types.ts` mirrors registry/protocol constants from the Accordion app instead of importing the owned contract, creating drift risk.
- Moving the broker under `extensions/accordion/broker/` can preserve its separate singleton process while making dashboard assets and registry contracts local to First-Party Accordion. Keeping it at `packages/accordion-broker` is feasible but retains a cross-subsystem path and mirrored contract.

## G015 — Build and verification ownership after relocation

- Root `tsconfig.json` includes `extensions/**/*.ts`. Moving Accordion there would otherwise pull its Svelte/Tauri/app sources into the generic root compiler even though they use specialized aliases and tooling.
- `vendor/accordion/CONTRIBUTING.md`, section `Quality gate`, defines the existing behavior gates: app `npm run check`, `npm run test`, and `npm run build`; Tauri `cargo check`; extension `node smoke.mjs`.
- `vendor/accordion/app/vitest.config.ts` also includes extension tests and configures `$conductors` plus Svelte environments.
- `packages/accordion-broker/vitest.config.ts` owns broker HTTP, registry, and WebSocket proxy tests separately.
- A relocation-specific Pi-entry smoke must load `extensions/accordion/index.ts` through the root package discovery shape; the existing extension smoke already proves the real WebSocket, registry, focus, and shutdown contracts and should be retargeted to that entry.
- Therefore the root compiler should exclude the nested Accordion subsystem, while its package-specific gates remain mandatory.

## G016 — Active path-reference migration

- Root executable wiring with old paths exists in `package.json`, `scripts/postinstall.mjs`, `pnpm-workspace.yaml`, `vitest.config.ts`, and the current broker source.
- Root `README.md` still describes Accordion as vendored.
- `.scratch/accordion-chunked-compaction/PRD.md` is marked `ready-for-agent` and contains old source anchors, so active tracker artifacts must be rewritten to the new path rather than left as historical text.
- Historical grill ledgers and grounding files are evidence of decisions made against the old layout; when retained, they need an explicit relocation note instead of silently pretending the original path was different.

## Current test seams

- Root `vitest.config.ts` aggregates app engine and extension tests.
- `vendor/accordion/app/vitest.config.ts` is the underlying Vitest configuration.
- `vendor/accordion/extension/chunked-compaction-invariant.test.ts` exercises the cross-tree runtime path.

## PRD grounding register

### GROUND-001 — Pi package activation and current ownership path
- Finding status: incorporated
- Source: `package.json` → `pi.extensions`, `scripts.accordion:*`
- Existing behavior: the root Pi package explicitly loads `./vendor/accordion/extension/accordion.ts`; install, build, update, and broker scripts target the two old source roots.
- Current excerpt: `"./vendor/accordion/extension/accordion.ts"`, `npm install --prefix vendor/accordion/app`, `npm run start --prefix packages/accordion-broker`.
- Test prior art: root `npm run check`; package installation via root `postinstall`.

### GROUND-002 — Cohesive Accordion source dependencies
- Finding status: incorporated
- Source: `vendor/accordion/extension/accordion.ts` → top-level imports; `vendor/accordion/app/vite.config.js` → `$conductors` alias
- Existing behavior: the runtime imports mapping, protocol, and registry source from `../app/src/lib/live/*`, while the app compiles conductors from `../conductors`; extension integration tests cross all three trees.
- Current excerpt: `import { linearize, applyPlan } from "../app/src/lib/live/mapping"`; `$conductors: path.resolve(__dirname, "../conductors")`.
- Test prior art: `vendor/accordion/extension/chunked-compaction-invariant.test.ts`; `vendor/accordion/app/vitest.config.ts`.

### GROUND-003 — First-party nested extension discovery
- Finding status: incorporated
- Source: `extensions/frontend-coach/index.ts` → default extension export; `extensions/frontend-coach/package.json` → `pi.extensions`; root `package.json` → `pi.extensions`
- Existing behavior: `frontend-coach` is a multi-file first-party extension rooted under `extensions/<id>/index.ts`, and the root package already discovers `./extensions`.
- Current excerpt: `"pi": { "extensions": ["./index.ts"] }`; root manifest includes `"./extensions"`.
- Test prior art: root `npm run check`; normal Pi `/reload` discovery used by `extensions/frontend-coach/README.md`.

### GROUND-004 — `/accordion` command and direct-mode fallback
- Finding status: incorporated
- Source: `vendor/accordion/extension/accordion.ts` → `resolveBrokerCwd()`, `ensureBroker()`, `pi.registerCommand("accordion")`, `resolveClientRoot()`
- Existing behavior: `/accordion` writes focus and watch requests, starts or reuses the detached broker, optionally launches the desktop app, and reports broker plus direct-session URLs. Broker failure is best-effort; direct static serving remains token-gated and provider requests retain passthrough safety.
- Current excerpt: `spawn(process.execPath, ["--import", "tsx/esm", "src/index.ts"], { detached: true })`; `writeBrokerWatchRequest(sessionId)`; direct URL uses `?token=${webToken}`.
- Test prior art: `vendor/accordion/extension/smoke.mjs` exercises real registry, HTTP, WebSocket, `/accordion`, focus, and shutdown behavior.

### GROUND-005 — Singleton Browser Broker process and transport seam
- Finding status: incorporated
- Source: `packages/accordion-broker/src/index.ts` → `startBroker()`; `packages/accordion-broker/src/server.ts` → `createBrokerServer()`, `proxySession()`; `packages/accordion-broker/src/registry.ts` → `createDiskStore()`
- Existing behavior: one detached loopback process owns broker heartbeat/watch bookkeeping, serves the dashboard, and transparently proxies `/ws/session/<sessionId>` to live watched session ports without owning folding state.
- Current excerpt: routes `GET /__accordion/broker-meta`, `GET /__accordion/sessions`, and `WS /ws/session/<sessionId>`; registry files live under `~/.accordion/`.
- Test prior art: `packages/accordion-broker/__tests__/broker.test.ts`; `packages/accordion-broker/__tests__/registry.test.ts`; command `npm test --prefix packages/accordion-broker`.

### GROUND-006 — Dashboard broker-mode detection and session slots
- Finding status: incorporated
- Source: `vendor/accordion/app/src/lib/live/brokerMode.ts` → `detectBrokerMode()`; `vendor/accordion/app/src/lib/live/brokerIntegration.svelte.ts` → `startBrokerDetection()`, `pollBrokerSessions()`
- Existing behavior: the same app build selects broker mode by probing `/__accordion/broker-meta`, polls `/__accordion/sessions`, and connects one isolated slot per session through the broker WebSocket route; missing broker metadata falls back to direct mode.
- Current excerpt: `setInterval(() => void pollBrokerSessions(), 2_000)` and `connectSlot(slot, ... "/ws/session/" + encodeURIComponent(entry.sessionId))`.
- Test prior art: `vendor/accordion/app/src/lib/live/brokerMode.test.ts`; `brokerSessions.test.ts`; `sessionSlots.test.ts`.

### GROUND-007 — Specialized build and verification seams
- Finding status: incorporated
- Source: `tsconfig.json` → `include`; `vendor/accordion/CONTRIBUTING.md` → `Quality gate`; `vendor/accordion/app/vitest.config.ts`; `packages/accordion-broker/vitest.config.ts`
- Existing behavior: root TypeScript checks all `extensions/**/*.ts`, while Accordion uses specialized Svelte/Vitest/Tauri/runtime and broker configurations. Moving the app beneath `extensions/` would accidentally add it to the generic root compiler unless explicitly excluded.
- Current excerpt: root `include: ["extensions/**/*.ts"]`; app gates are `npm run check`, `npm run test`, `npm run build`; native gate is `cargo check`; runtime gate is `node smoke.mjs`.
- Test prior art: the named commands in `vendor/accordion/CONTRIBUTING.md` and broker `package.json`.

### GROUND-008 — Operational and tracker path consumers
- Finding status: incorporated
- Source: `scripts/postinstall.mjs`; `pnpm-workspace.yaml`; `vitest.config.ts`; `README.md`; `.scratch/accordion-chunked-compaction/PRD.md`
- Existing behavior: installation checks, workspace membership, root test aggregation, user instructions, and an active `ready-for-agent` PRD all point at `vendor/accordion`; broker serving points back across `packages/accordion-broker`.
- Current excerpt: `packages: - vendor/accordion/app`; root Vitest imports `./vendor/accordion/app/vitest.config.ts`; README says the repo vendors Accordion.
- Test prior art: deterministic repository grep for obsolete operational paths after migration.

### GROUND-009 — Pre-issue verification baseline
- Finding status: incorporated; native Cargo proof split to HITL
- Source: current quality-gate commands executed before issue publication
- Existing behavior: app Vitest passes; broker Vitest passes 20/20; runtime smoke passes; app build and broker TypeScript check pass. App Svelte check exits successfully with 0 errors and 20 existing `MapHeader.svelte` accessibility warnings. Root `npm run check` has one unrelated existing `TS2353` at `extensions/subagents.ts:1193:4`. Cargo is not installed in the current environment.
- Current excerpt: `modelRegistry` is not in `CreateAgentSessionServicesOptions`; shell reports `cargo: command not found`.
- Test prior art: Issue 01 preserves the verified headless baselines and adds a real adoption smoke; Issue 02 owns `cargo check --manifest-path extensions/accordion/app/src-tauri/Cargo.toml` as `ready-for-human` proof.
