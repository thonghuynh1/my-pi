---
status: ready-for-human
labels: ready-for-human
grill: .scratch/grills/6f2a9c1d8e4b/ledger.md
grounding: .scratch/grills/6f2a9c1d8e4b/grounding.md
---

# PRD — Adopt Accordion as a first-party `my-pi` extension

## Problem Statement

`my-pi` currently describes and stores Accordion as a third-party vendored repository under `vendor/accordion/`, even though Accordion is tracked directly in the `my-pi` Git repository, has extensive fork-specific changes, and already participates in first-party architecture through the Authoritative Accordion Folding Runtime, Global Accordion Dashboard, and Accordion Browser Broker.

The ownership label now disagrees with reality. Pi activation, installation, workspace membership, tests, broker asset serving, documentation, and active implementation artifacts all encode the old vendor path. The Browser Broker is also split into `packages/accordion-broker/` and reaches back into the vendor tree through hard-coded filesystem paths and mirrored contracts.

Affected actors are:

- Pi users who depend on `/accordion`, direct browser mode, broker-dashboard mode, desktop mode, folding, unfold, and recall behavior.
- The `my-pi` maintainer, who needs Accordion represented as owned source rather than an upstream-tracking dependency.
- Implementation agents and contributors, who need one current source location, working build commands, and valid code anchors.

The migration must correct ownership and locality without using the move as an opportunity to redesign runtime behavior, package contracts, or module interfaces.

## Solution

Move the complete Accordion fork into `extensions/accordion/`, following the existing first-party `extensions/frontend-coach/` pattern. Add `extensions/accordion/index.ts` as the stable Pi extension entry while preserving Accordion's cohesive internal `extension/`, `app/`, `conductors/`, tests, docs, license, brand, and asset layout.

Move the Accordion Browser Broker into `extensions/accordion/broker/`. It remains a detached singleton process shared by multiple Pi sessions. `/accordion` continues to start or reuse it, register and focus the current session, serve the same dashboard build, and retain the direct-session browser link and desktop launch behavior.

This is an atomic, behavior-preserving source relocation. After migration, `vendor/accordion/` and `packages/accordion-broker/` no longer exist, no compatibility shim remains, operational configuration and active tracker artifacts use current paths, and historical evidence explicitly notes any intentionally retained old path.

## User Stories

1. As a Pi user, I want First-Party Accordion to load through `my-pi`'s standard extension discovery and open my current session through `/accordion`, so that ownership changes without disrupting my workflow.
2. As a developer using Accordion's direct, broker-dashboard, or desktop modes, I want their session discovery, folding, recall, and failure behavior to remain unchanged, so that the source move introduces no runtime regression.
3. As a `my-pi` maintainer, I want Accordion's source, broker, build wiring, tests, and active documentation under one first-party extension directory, so that future work has one accurate ownership boundary and source location.

## Walking Skeleton

`US-001` — From a fresh installed/built checkout, load `extensions/accordion/index.ts` through the root Pi package, start a Pi session, invoke `/accordion`, start or reuse the broker from `extensions/accordion/broker/`, register the current session through the real `~/.accordion`-compatible temporary registry, serve the dashboard build, and observe the session through the broker session endpoint and WebSocket route. The same run must still expose the token-bearing direct-session URL. This flow uses the real extension entry, broker process, registry files, HTTP server, and WebSocket proxy; only the home directory and desktop executable are isolated for the test.

## Required Behaviors

- `RB-001`: `vendor/accordion/` and `packages/accordion-broker/` are removed after their contents move; no symlink, forwarding directory, duplicated source tree, or compatibility loader remains.
- `RB-002`: The complete fork remains in scope: runtime extension, app, conductors, broker, tests, docs, license, brand, and supporting assets all live beneath `extensions/accordion/`.
- `RB-003`: Root Pi activation relies on the existing `./extensions` discovery entry and `extensions/accordion/index.ts`; the explicit `./vendor/accordion/extension/accordion.ts` manifest entry is removed.
- `RB-004`: `extensions/accordion/index.ts` is the stable default-export Pi entry and delegates to the existing runtime without changing tool, command, flag, hook, or Capability Visibility behavior.
- `RB-005`: The broker remains a detached singleton loopback process; it is not embedded in or owned by any one Pi session process.
- `RB-006`: Broker routes and filesystem contracts remain unchanged: `GET /__accordion/broker-meta`, `GET /__accordion/sessions`, `WS /ws/session/<sessionId>`, and the established `~/.accordion/` registry/watch/heartbeat files retain their current shapes and freshness rules.
- `RB-007`: Broker startup and watch registration remain best-effort. Broker failure must not remove the direct-session URL or alter provider-safe passthrough behavior.
- `RB-008`: The migration does not consolidate package manifests, deduplicate broker registry/protocol types, introduce new package interfaces, or refactor internal Accordion modules.
- `RB-009`: Root scripts, `postinstall`, workspace membership, test aggregation, broker asset resolution, desktop-app resolution, and browser-build resolution point to the new first-party locations.
- `RB-010`: The generic root TypeScript project excludes `extensions/accordion/**`; Accordion remains verified by its specialized app, runtime, broker, and Tauri quality gates.
- `RB-011`: Operational docs and active issue-tracker artifacts use `extensions/accordion/` and `extensions/accordion/broker/`. Historical decision evidence may retain old paths only with an explicit relocation note.
- `RB-012`: Existing Accordion identity, license, attribution, product documentation, and assets are preserved; first-party adoption is not a rebrand.
- `RB-013`: `/accordion`, folding, unfold, recall, direct static-file token gating, token-free desktop WebSocket attachment, desktop launch precedence, registry heartbeat, and shutdown cleanup remain observably unchanged.
- `RB-014`: The same app build continues to select broker mode through `/__accordion/broker-meta` and otherwise fall back to direct single-session mode.

## Accepted Decision Register

### `DEC-001` — Adopt the complete Accordion fork

- **Decision**: `my-pi` owns the complete Accordion fork as first-party source, including runtime, app, conductors, broker, tests, docs, license, and assets.
- **Rationale**: Fork-specific changes span these surfaces, and the runtime already imports app-engine and conductor source directly. Treating only the entry file as owned would create a false boundary.
- **Rejected alternatives**: Adopt only the runtime; keep upstream Accordion vendored with a first-party overlay.
- **Downstream impact**: Every retained surface moves together and all ownership language must stop describing Accordion as a vendored dependency.
- **Depends on**: None.
- **Decided implementation**: One First-Party Accordion subsystem under the `my-pi` repository.
- **Left to the implementer**: Mechanical move ordering only.

### `DEC-002` — Use the nested first-party extension shape

- **Decision**: Place the cohesive subsystem under `extensions/accordion/` and expose `extensions/accordion/index.ts` as its Pi entry, following `extensions/frontend-coach/`.
- **Rationale**: This matches an established repository convention while preserving locality among the runtime, app engine, and conductors.
- **Rejected alternatives**: A cohesive `packages/accordion/` subsystem; splitting runtime, app, engine, and conductors into new packages.
- **Downstream impact**: Root extension discovery replaces the explicit vendor-path registration. Internal source remains nested rather than flattened into the shared `extensions/` root.
- **Depends on**: `DEC-001`.
- **Decided implementation**: Stable `index.ts` discovery seam plus the existing internal Accordion topology beneath it.
- **Left to the implementer**: Equivalent private helper names and mechanical relative-path updates.

### `DEC-003` — Internal broker module, separate singleton process

- **Decision**: Move the Browser Broker to `extensions/accordion/broker/` while preserving its detached singleton process model.
- **Rationale**: This localizes broker code, dashboard assets, and tests without creating ownership and shutdown races among multiple Pi sessions.
- **Rejected alternatives**: Keep `packages/accordion-broker/`; run the broker inside an individual Pi extension process.
- **Downstream impact**: `/accordion` resolves the broker locally; broker static asset paths resolve sibling Accordion builds. Endpoints, registry files, and transport-only responsibility remain fixed.
- **Depends on**: `DEC-001`, `DEC-002`.
- **Decided implementation**: The extension starts/reuses an internal detached broker package; the broker continues to proxy frames without owning fold plans.
- **Left to the implementer**: Private broker helper organization.

### `DEC-004` — Behavior-preserving relocation only

- **Decision**: Limit the effort to source movement and required path, discovery, build, test, and documentation updates.
- **Rationale**: A rename-dominated diff makes regressions attributable and lets existing behavior tests prove equivalence.
- **Rejected alternatives**: Relocation plus shared-contract cleanup; relocation plus package/build consolidation.
- **Downstream impact**: Mirrored broker types, existing package manifests, runtime interfaces, wire protocols, and module organization remain unchanged except where filesystem paths must move.
- **Depends on**: `DEC-001`, `DEC-002`, `DEC-003`.
- **Decided implementation**: No product or architecture refactor is bundled with adoption.
- **Left to the implementer**: Local path-helper implementation that preserves current outcomes.

### `DEC-005` — Atomic migration, current docs, specialized proof

- **Decision**: Remove old source roots without shims, update executable and active documentation paths, preserve historical evidence with relocation notes, exclude Accordion from root TypeScript compilation, and use nested quality gates plus a real Pi-entry smoke.
- **Rationale**: Dual paths would perpetuate ambiguous ownership, while compiling a Svelte/Tauri subsystem through the generic root project would introduce an unrelated build migration.
- **Rejected alternatives**: Temporary old-path forwarding; leaving active PRDs with stale anchors; forcing the full subsystem through root `tsc`.
- **Downstream impact**: Migration and proof must land atomically. Root and nested test commands have separate ownership.
- **Depends on**: `DEC-001`, `DEC-002`, `DEC-003`, `DEC-004`.
- **Decided implementation**: No old source directory survives; active references migrate; specialized app/runtime/broker/native tests remain authoritative.
- **Left to the implementer**: Exact script orchestration, provided every named gate is runnable from the new paths.

## Implementation Plan

### Area: Source topology and Pi discovery

- **Coverage**: `DEC-001`, `DEC-002`, `DEC-004`, `DEC-005`; `US-001`, `US-003`; `RB-001`, `RB-002`, `RB-003`, `RB-004`, `RB-008`, `RB-012`.
- **Contract**: Accordion has one owned source root, `extensions/accordion/`. Pi loads only its stable `index.ts` entry through the root package's existing `./extensions` discovery path.
- **Decision constraints**: Preserve the internal `app/`, `conductors/`, `extension/`, docs, brand, license, and assets. Do not create new package seams or retain the vendor tree.
- **Code anchors**: Existing `package.json` → `pi.extensions`; existing `extensions/frontend-coach/index.ts`; existing `extensions/frontend-coach/package.json`; existing `vendor/accordion/` tree.
- **Existing behavior**: Root activation explicitly lists the vendor entry and separately discovers first-party extensions. `frontend-coach` proves the nested `index.ts` pattern.
- **Required edits**:
  - Move the complete existing `vendor/accordion/` tree to planned `extensions/accordion/`.
  - Add planned `extensions/accordion/index.ts` as the stable default-export entry.
  - Remove the explicit vendor Accordion entry from root `package.json`; retain `./extensions`.
  - Preserve Accordion's license, attribution, docs, brand, and assets beneath the new root.
  - Remove the old source tree in the same change.
- **Normative snippet**:

```ts
// extensions/accordion/index.ts
export { default } from "./extension/accordion.ts";
```

```text
extensions/accordion/
├── index.ts
├── extension/
├── app/
├── conductors/
├── broker/
├── docs/
├── brand/
├── LICENSE
└── README.md
```

- **Test seam**: Retarget the existing extension smoke to import `../index.ts`; loading must produce the current command/tool/hook registrations and complete with its existing success result.
- **Wiring**: Root Pi package discovery finds `extensions/accordion/index.ts` through `./extensions`; no second manifest entry or compatibility adapter outside the subsystem is allowed.
- **Grounding evidence**: `GROUND-001`, `GROUND-002`, `GROUND-003`.

### Area: Runtime entry, direct browser mode, and desktop launch

- **Coverage**: `DEC-002`, `DEC-004`, `DEC-005`; `US-001`, `US-002`; `RB-004`, `RB-007`, `RB-009`, `RB-013`.
- **Contract**: The existing Accordion runtime remains the implementation behind the new `index.ts` entry. Direct static serving, authentication, WebSocket behavior, desktop launch precedence, lifecycle hooks, and safe passthrough are unchanged.
- **Decision constraints**: The wrapper is a discovery adapter only. Do not rename tools/commands, opt into Capability Visibility, change timeouts, alter token gating, or change folding logic.
- **Code anchors**: Existing `vendor/accordion/extension/accordion.ts` → default export `accordionLive`, `resolveBrokerCwd()`, `ensureBroker()`, `repoAppCandidates()`, nested `resolveClientRoot()`, `pi.registerCommand("accordion")`; existing `vendor/accordion/extension/build-client.mjs`.
- **Existing behavior**: The runtime serves `dist/client` or sibling `app/build`, launches an installed or sibling Tauri binary, advertises one ephemeral per-session server, and passes messages through safely when no usable plan exists.
- **Required edits**:
  - Preserve the existing `extension/` subtree under the new Accordion root.
  - Retarget only path calculations invalidated by broker relocation.
  - Retarget `build-client.mjs`, smoke imports, messages, and setup instructions to current paths.
  - Keep sibling app and conductor relative topology unchanged wherever possible.
- **Test seam**: Planned Pi-entry smoke loads `extensions/accordion/index.ts`; existing `extensions/accordion/extension/smoke.mjs` assertions continue to cover registry advertisement, focus, direct HTTP token behavior, real WebSocket sync/plan application, recall/unfold, and shutdown cleanup.
- **Wiring**: `index.ts` default export reaches the unchanged runtime factory; runtime session hooks continue to own the Authoritative Accordion Folding Runtime.
- **Grounding evidence**: `GROUND-002`, `GROUND-004`, `GROUND-007`.

### Area: Browser Broker relocation and startup

- **Coverage**: `DEC-003`, `DEC-004`, `DEC-005`; `US-001`, `US-002`, `US-003`; `RB-005`, `RB-006`, `RB-007`, `RB-008`, `RB-009`.
- **Contract**: `extensions/accordion/broker/` remains an independently spawned private Node package and singleton loopback process. Its routes, `BrokerStore` interface, filesystem state, freshness rules, and transparent proxy behavior remain byte- and behavior-compatible.
- **Decision constraints**: Do not embed broker state in a Pi session, redesign the registry contract, or replace mirrored types with a new shared contract in this effort.
- **Code anchors**: Existing `packages/accordion-broker/src/index.ts` → `startBroker()`; `server.ts` → `resolveClientRoot()`, `createBrokerServer()`, `proxySession()`; `registry.ts` → `createDiskStore()`, `consumeWatchRequests()`, `pruneWatchedSessions()`; existing runtime `resolveBrokerCwd()` and `ensureBroker()`.
- **Existing behavior**: `/accordion` discovers or starts the package through `node --import tsx/esm src/index.ts`; the broker writes a heartbeat registry, consumes watch requests, serves the dashboard, and proxies only live watched sessions.
- **Required edits**:
  - Move the package intact to planned `extensions/accordion/broker/`, including package manifest, lockfile, TypeScript config, Vitest config, and tests.
  - Resolve the broker from the Accordion root rather than repository-root `packages/`.
  - Resolve broker static assets from sibling `app/build` and sibling `extension/dist/client`.
  - Preserve the detached spawn, readiness polling, heartbeat, watch polling, stale pruning, rejection, and close behavior.
  - Delete `packages/accordion-broker/` after the move.
- **Normative snippet**:

```text
Pi session extension --spawn/reuse--> extensions/accordion/broker/
Browser --HTTP/WS--> singleton broker --WS proxy--> per-session extension port
```

- **Test seam**: Move and retain broker HTTP/registry/proxy suites. Commands: `npm run check --prefix extensions/accordion/broker` and `npm test --prefix extensions/accordion/broker`; success is zero TypeScript errors and all broker/registry tests passing.
- **Wiring**: `/accordion` writes the same focus/watch files and starts/reuses the broker at its new local path. Root `accordion:broker` script invokes the moved package.
- **Grounding evidence**: `GROUND-004`, `GROUND-005`.

### Area: Dashboard direct/broker mode

- **Coverage**: `DEC-001`, `DEC-003`, `DEC-004`; `US-001`, `US-002`; `RB-006`, `RB-013`, `RB-014`.
- **Contract**: One app build continues to detect broker mode at runtime, maintain isolated session slots keyed by session ID, and fall back to direct mode when broker metadata is absent or unavailable.
- **Decision constraints**: No protocol, polling, slot-state, focus, fold-plan, or UI behavior change is part of adoption.
- **Code anchors**: Existing `vendor/accordion/app/src/lib/live/brokerMode.ts` → `detectBrokerMode()`; `brokerIntegration.svelte.ts` → `startBrokerDetection()`, `pollBrokerSessions()`, `handleBrokerFocus()`; `sessionSlots.svelte.ts` → slot lifecycle.
- **Existing behavior**: The app probes broker metadata, polls watched sessions every two seconds, connects each slot through `/ws/session/<sessionId>`, and selects direct mode on an unavailable broker endpoint.
- **Required edits**: Move the app intact and update only source/documentation/test paths. Preserve protocol constants, endpoints, slot identity, and mode fallback.
- **Test seam**: Moved `brokerMode.test.ts`, `brokerSessions.test.ts`, and `sessionSlots.test.ts` run in the app Vitest suite; success is all existing mode, normalization, slot, and identity assertions passing.
- **Wiring**: Broker serves the moved app build; the browser continues to derive API and WebSocket addresses from its own origin.
- **Grounding evidence**: `GROUND-005`, `GROUND-006`.

### Area: Install, build, workspace, and compiler wiring

- **Coverage**: `DEC-002`, `DEC-003`, `DEC-004`, `DEC-005`; `US-001`, `US-003`; `RB-003`, `RB-008`, `RB-009`, `RB-010`.
- **Contract**: Existing root script names and automatic setup behavior remain available, but all paths target `extensions/accordion/`. Root `tsc` continues checking ordinary first-party extensions without absorbing Accordion's specialized app/runtime/broker project.
- **Decision constraints**: Preserve separate app, extension, and broker manifests and lockfiles. Do not convert package managers or create a consolidated workspace architecture.
- **Code anchors**: Existing root `package.json` → `scripts`, `pi.extensions`; `scripts/postinstall.mjs`; `pnpm-workspace.yaml`; `vitest.config.ts`; `tsconfig.json`.
- **Existing behavior**: Root postinstall installs app/runtime and broker dependencies and builds the browser app when absent. Workspace and root Vitest point into the vendor tree. Root TypeScript includes all `extensions/**/*.ts`.
- **Required edits**:
  - Retarget `accordion:install`, `accordion:build`, `accordion:update`, and `accordion:broker` without renaming them.
  - Retarget postinstall existence checks and installs for app, runtime, broker, and browser build.
  - Change workspace membership and root Vitest imports/globs to `extensions/accordion/...`.
  - Add `extensions/accordion/**` to root `tsconfig.json` exclusions; nested gates remain mandatory.
  - Move lockfiles with their packages and avoid dependency-version changes unrelated to path viability.
- **Test seam**: Root `npm run check` retains only the documented unrelated `extensions/subagents.ts:1193:4` `TS2353` baseline and reports no Accordion diagnostic; nested app/runtime/broker gates succeed from their new paths; root install on a checkout without nested `node_modules` produces the browser build at `extensions/accordion/app/build/index.html`.
- **Wiring**: Root `postinstall` remains the automatic setup entry. `pi install F:/MyWork/my-pi` continues to prepare Accordion without manual path registration.
- **Grounding evidence**: `GROUND-001`, `GROUND-007`, `GROUND-008`.

### Area: Documentation and tracker migration

- **Coverage**: `DEC-001`, `DEC-004`, `DEC-005`; `US-003`; `RB-001`, `RB-002`, `RB-011`, `RB-012`.
- **Contract**: Current operational instructions and active implementation contracts point to the first-party source. Historical evidence remains honest about the path that existed when recorded.
- **Decision constraints**: Do not rewrite product history, remove attribution, or silently alter the meaning of accepted historical decisions.
- **Code anchors**: Existing `README.md` → `## Accordion`; moved Accordion `README.md` and `CONTRIBUTING.md`; active `.scratch/accordion-chunked-compaction/PRD.md`, map, issues, and tickets; historical `.scratch/grills/**` and prior grounding files.
- **Existing behavior**: Root docs call Accordion vendored; active ready-for-agent material contains executable old-path anchors; historical evidence also names the old source location.
- **Required edits**:
  - Describe Accordion as First-Party Accordion under `extensions/accordion/`.
  - Update setup, build, test, desktop, broker, and source-anchor paths in operational docs.
  - Update active issue-tracker artifacts that downstream agents may execute.
  - Add a concise relocation note to intentionally retained historical path evidence rather than changing what that evidence originally observed.
  - Preserve LICENSE, attribution, branding, and product identity.
- **Test seam**: A deterministic grep over operational code/config/docs returns no obsolete `vendor/accordion` or `packages/accordion-broker` references. Review the remaining repository-wide matches; every retained match must be in explicitly historical evidence with a relocation note.
- **Wiring**: Root README commands remain copy-pasteable from the repository root; nested contribution commands use the moved paths.
- **Grounding evidence**: `GROUND-001`, `GROUND-008`.

### Area: Migration verification

- **Coverage**: `DEC-004`, `DEC-005`; `US-001`, `US-002`, `US-003`; `RB-001` through `RB-014`.
- **Contract**: Verification proves both the new ownership path and unchanged observable behavior through existing real seams plus one bounded adoption smoke.
- **Decision constraints**: Test interfaces and observable outcomes, not private path-helper implementation. Do not accept a test-only compatibility copy of either old source root.
- **Required edits**:
  - Retarget the runtime smoke to the stable `index.ts` entry.
  - Add or extend a bounded adoption smoke that starts the actual moved broker against a temporary `ACCORDION_HOME`, invokes `/accordion`, verifies broker metadata/session listing/static serving/WebSocket routing, and cleans up the spawned broker by its registry PID.
  - Run every existing nested quality gate from the moved paths.
  - Assert removal of obsolete operational paths and source roots.
- **Test seam**: Commands and expected results are listed under `## Testing Decisions`.
- **Wiring**: The adoption smoke uses the real extension entry and broker package; only home state and desktop launch are isolated.
- **Grounding evidence**: `GROUND-004`, `GROUND-005`, `GROUND-006`, `GROUND-007`, `GROUND-008`.

## Global Build & Wiring Notes

- Preserve root script names: `accordion:install`, `accordion:build`, `accordion:update`, and `accordion:broker`. Only their target paths change.
- Preserve the existing package-manager boundaries and lockfiles. This PRD does not authorize workspace or dependency consolidation.
- Build the app before any adoption smoke that asserts broker or direct static serving.
- The root Pi manifest must contain only the existing generic `./extensions` entry for First-Party Accordion; adding a second explicit Accordion entry would double-load commands and hooks.
- `extensions/accordion/index.ts` is the public Pi discovery seam. `extensions/accordion/extension/accordion.ts` remains the runtime implementation during this behavior-preserving move.
- The broker process remains separately installable/runnable through its private package manifest even though its source is internal to Accordion.
- Move files in a way Git can recognize as renames where practical; this is repository-history hygiene, not a runtime contract.

## Testing Decisions

1. **Walking-skeleton adoption smoke**
   - Entry: `extensions/accordion/index.ts`.
   - Real seams: Pi extension factory registration, per-session server, temporary filesystem registry, `/accordion`, moved broker subprocess, broker HTTP endpoints, dashboard static build, watched-session listing, and broker WebSocket proxy.
   - Required assertions: broker starts from the new internal path; session appears; dashboard root is served; proxied WebSocket connects; direct URL is still reported; spawned process and temporary files are cleaned up.
   - Command: `node extensions/accordion/extension/smoke.mjs` if the existing smoke is extended, or an equivalently named adjacent smoke documented by the implementation. Success must be a zero exit code and the existing recognizable smoke success line with the new broker assertions included.

2. **App behavior and build**
   - Commands:
     - `npm run check --prefix extensions/accordion/app`
     - `npm test --prefix extensions/accordion/app`
     - `npm run build --prefix extensions/accordion/app`
   - Expected result: zero Svelte/type errors, no warnings outside the existing 20 `MapHeader.svelte` accessibility warnings, all app/engine/live/extension tests pass, and `extensions/accordion/app/build/index.html` exists.

3. **Broker behavior**
   - Commands:
     - `npm run check --prefix extensions/accordion/broker`
     - `npm test --prefix extensions/accordion/broker`
   - Expected result: zero TypeScript errors; all metadata, session listing, registry, stale-session rejection, text/binary proxy, buffering, and close-propagation tests pass.

4. **Native desktop surface**
   - Command: `cargo check --manifest-path extensions/accordion/app/src-tauri/Cargo.toml`.
   - Expected result: Cargo completes successfully without changing the desktop launch contract.

5. **Root package wiring**
   - Command: the AC-11 baseline wrapper in `.scratch/accordion-first-party-extension/issues/01-adopt-accordion-as-first-party-extension.md`.
   - Expected result: the wrapper accepts only the documented unrelated `extensions/subagents.ts:1193:4` `TS2353` error and rejects any Accordion diagnostic or additional root error; the specialized Accordion subtree is not compiled through the generic root project.
   - Installation check: with nested dependency/build outputs absent, root `npm install` completes postinstall and creates the app browser build under the new path.

6. **Migration hygiene**
   - Assert `vendor/accordion/` and `packages/accordion-broker/` do not exist.
   - Assert operational files contain no obsolete path:

```bash
! git grep -nE 'vendor/accordion|packages/accordion-broker' -- \
  package.json scripts pnpm-workspace.yaml vitest.config.ts tsconfig.json README.md extensions packages docs
```

   - Review any repository-wide remaining matches. Only explicitly annotated historical evidence is allowed.

## Out of Scope

- Changing Accordion's runtime behavior, folding algorithms, conductors, protocol versions, endpoint shapes, registry schemas, timeouts, or authentication model.
- Consolidating package manifests, package managers, workspaces, lockfiles, or dependency versions beyond path viability.
- Deduplicating the broker's mirrored protocol/registry types or creating a new shared-contract package.
- Rebranding Accordion or removing its license, attribution, documentation, desktop app, brand assets, or conductors.
- Adding Capability Visibility integration or a new `piExtension.id` as part of this relocation.
- Embedding the singleton broker in a Pi session process.
- Maintaining an upstream-vendor overlay, subtree, submodule, symlink, or old-path compatibility shim.
- Implementing unrelated active Accordion PRDs while updating their source anchors.

## Unresolved Gaps

None.

## Further Notes

- Domain glossary: `CONTEXT.md` defines **First-Party Accordion**.
- Governing architecture: `docs/adr/0002-authoritative-accordion-folding-runtime.md`, `docs/adr/0003-proactive-content-compression.md`, and `docs/adr/0004-accordion-chunked-compaction.md` remain accepted and are not superseded by this layout migration.
- Grounding evidence: `.scratch/grills/6f2a9c1d8e4b/grounding.md`.
- Confirmed decision ledger: `.scratch/grills/6f2a9c1d8e4b/ledger.md`.
