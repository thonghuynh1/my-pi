# Coverage ledger — Accordion first-party extension adoption

Parent PRD: `.scratch/accordion-first-party-extension/PRD.md`

## Slice plan

- **Issue 01 (AFK, walking skeleton):** atomic first-party source migration, broker relocation, Pi discovery, runtime/build/test wiring, operational and active-tracker path migration, and all available headless proof.
- **Issue 02 (HITL):** run the accepted native Tauri `cargo check` in an environment with Cargo installed.

The migration is intentionally one AFK implementation slice because `DEC-005` forbids a legacy shim or dual source root and requires source movement, caller migration, active docs, and legacy deletion to land atomically. Splitting those edits would leave either duplicate ownership or broken discovery/build paths. Issue 02 contains proof only and does not alter implementation.

## PRD ID coverage

| Obligation | State | Owner | Proving criterion |
|---|---|---|---|
| `DEC-001` | covered by issue | 01 | AC-01/AC-08: complete tree is under `extensions/accordion`, old roots absent, identity/license retained |
| `DEC-002` | covered by issue | 01 | AC-01/AC-02: stable `index.ts` is discovered once through `./extensions` |
| `DEC-003` | covered by issue | 01 | AC-03/AC-06: real moved singleton broker starts and broker suites pass |
| `DEC-004` | covered by issue | 01 | AC-07/AC-08: existing behavior gates pass and no unauthorized contract/package changes appear |
| `DEC-005` | covered by issue | 01 implementation + 02 native proof | AC-01–AC-11 and HITL AC-01 |
| `US-001` | covered by issue | 01 (walking skeleton) | AC-03: real index → `/accordion` → broker → watched session/static app/proxy flow |
| `US-002` | covered by issue | 01 implementation + 02 native proof | AC-03–AC-07; HITL AC-01 |
| `US-003` | covered by issue | 01 | AC-01/AC-08/AC-09: one owned location and current maintenance paths |
| `RB-001` | covered by issue | 01 | AC-01: old roots absent and no compatibility source |
| `RB-002` | covered by issue | 01 | AC-01/AC-08: complete tree and identity artifacts retained |
| `RB-003` | covered by issue | 01 | AC-02: generic discovery only; no explicit old/new duplicate entry |
| `RB-004` | covered by issue | 01 | AC-02/AC-03: index loads existing registrations and smoke passes |
| `RB-005` | covered by issue | 01 | AC-03/AC-06: detached broker path and singleton behavior exercised |
| `RB-006` | covered by issue | 01 | AC-03/AC-06: endpoint, registry, stale-session, and proxy tests |
| `RB-007` | covered by issue | 01 | AC-03: smoke retains direct URL and passthrough when broker path is unavailable/fails |
| `RB-008` | covered by issue | 01 | AC-08: package/contract inventory remains structurally unchanged except paths |
| `RB-009` | covered by issue | 01 | AC-04/AC-09: install/build/workspace/test/path wiring uses new roots |
| `RB-010` | covered by issue | 01 | AC-04/AC-11: root tsconfig exclusion plus no-new-root-diagnostics assertion; specialized gates own Accordion |
| `RB-011` | covered by issue | 01 | AC-09: operational and active tracker references migrate; historical refs annotated |
| `RB-012` | covered by issue | 01 | AC-08: license/brand/docs retained and no rebrand |
| `RB-013` | covered by issue | 01 implementation + 02 native proof | AC-03/AC-05/AC-07 and HITL AC-01 |
| `RB-014` | covered by issue | 01 | AC-05: broker/direct mode suites pass unchanged |

## Area edit ownership

| Planned file/symbol | Single editing owner | Proof |
|---|---|---|
| `extensions/accordion/index.ts` (new) | 01 | AC-02/AC-03 |
| Complete move `vendor/accordion/**` → `extensions/accordion/**` | 01 | AC-01/AC-05/AC-07/AC-08 |
| Complete move `packages/accordion-broker/**` → `extensions/accordion/broker/**` | 01 | AC-01/AC-06 |
| `extensions/accordion/extension/accordion.ts::{resolveBrokerCwd,ensureBroker}` | 01 | AC-03 |
| `extensions/accordion/broker/src/server.ts::resolveClientRoot` | 01 | AC-03/AC-06 |
| `extensions/accordion/extension/smoke.mjs` | 01 | AC-03 |
| Root `package.json` manifest/scripts | 01 | AC-02/AC-04 |
| `scripts/postinstall.mjs` | 01 | AC-04 |
| `pnpm-workspace.yaml` | 01 | AC-04 |
| Root `vitest.config.ts` | 01 | AC-05 |
| Root `tsconfig.json` | 01 | AC-04 |
| Root and nested operational docs | 01 | AC-09 |
| Active `.scratch/accordion-chunked-compaction/**` paths | 01 | AC-09 |
| Historical evidence relocation notes | 01 | AC-09 |
| Native Cargo verification | 02 (proof only; no edits) | HITL AC-01 |

## Choices left to implementers

| Choice | State | Owner | Constraint |
|---|---|---|---|
| Mechanical move ordering | covered by issue | 01 | Final result is atomic; no old shim or duplicate source survives |
| Equivalent local path helpers | covered by issue | 01 | Must preserve broker/app/client resolution and failure behavior |
| Exact smoke organization | covered by issue | 01 | May extend `smoke.mjs` or add adjacent helper, but command and real seams remain documented |
| Script orchestration | covered by issue | 01 | Existing script names remain and every specialized gate is runnable from new paths |
| Private helper/subfolder names | covered by issue | 01 | Existing internal topology is retained; no new package/interface split |

## Test and command validation

Validation date: current pre-migration checkout. Post-migration issues use the corresponding new paths.

| Command | Working directory | Pre-publication result | Issue use |
|---|---|---|---|
| `npm test --prefix vendor/accordion/app` | repo root | PASS via `run_tests`; all tests passed in 103.7s | 01 AC-05, retargeted path |
| `npm test --prefix packages/accordion-broker` | repo root | PASS via `run_tests`; 20/20 tests passed | 01 AC-06, retargeted path |
| `node vendor/accordion/extension/smoke.mjs` | repo root | PASS via `run_tests`; zero exit in 2.6s | 01 AC-03, retargeted and extended |
| `npm run check --prefix vendor/accordion/app` | repo root | PASS with 0 errors and 20 existing accessibility warnings, all in `MapHeader.svelte` | 01 AC-07, retargeted; require no new warnings/errors |
| `npm run build --prefix vendor/accordion/app` | repo root | PASS; adapter-static wrote `app/build` | 01 AC-07, retargeted |
| `npm run check --prefix packages/accordion-broker` | repo root | PASS; zero TypeScript errors | 01 AC-06, retargeted |
| `npm run check` | repo root | BASELINE FAIL: one unrelated existing `TS2353` at `extensions/subagents.ts:1193:4` (`modelRegistry`) | Rejected as a green AFK gate; AC-04 checks exclusion and AC-11 wraps the command to require the exact unchanged baseline |
| `cargo check --manifest-path vendor/accordion/app/src-tauri/Cargo.toml` | repo root | UNAVAILABLE: `cargo: command not found` | 02 HITL, retargeted path |
| root-baseline Node wrapper around `npm run check` | repo root | PASS; wrapper verified exactly the one known `TS2353` and no Accordion diagnostic | 01 AC-11 |
| obsolete-path `git grep` | repo root | Discriminator confirmed: finds current operational old paths before migration | 01 AC-01/AC-09, expected no operational matches after migration |

## Review findings

| Finding | Resolution | Evidence |
|---|---|---|
| App quality gate currently emits 20 warnings despite contribution text saying zero warnings | incorporated | Issue 01 requires 0 errors and no new warnings; warning set must remain limited to the current `MapHeader.svelte` accessibility diagnostics. Fixing them is out of scope. |
| Root TypeScript check is already red for unrelated `subagents.ts` API drift | incorporated | Do not force unrelated repair into Accordion adoption. Issue 01 proves the new exclusion directly and requires the root check to introduce no additional errors. |
| Cargo is unavailable in the current environment | HITL | Issue 02 is a separate `ready-for-human` proof slice blocked by Issue 01. |
| Atomic no-shim migration resists further AFK slicing | incorporated | One implementation issue owns all source movement, caller updates, legacy deletion, and walking-skeleton proof; no overlapping editors or broken intermediate root. |

## Blocking edges

- **01 → 02**
  - Producer output: Issue 01 moves the unchanged Tauri project to `extensions/accordion/app/src-tauri/Cargo.toml` and completes all headless relocation proof.
  - Consumer input: Issue 02 runs Cargo against that exact manifest.
  - Crossing contract: unchanged Rust/Tauri project at its accepted new path.
  - Wiring owner: Issue 01 owns the move; Issue 02 owns only human execution of the native check.
  - Proof: Issue 02's command fails if the manifest was not moved or native dependencies no longer resolve.

## Deferred / out of scope

All PRD `## Out of Scope` items are `deferred/out of scope` for the reasons accepted in `DEC-004`: runtime/algorithm/protocol/auth changes, package consolidation, mirrored-type deduplication, rebranding, Capability Visibility, embedded broker ownership, vendor overlays/shims, and unrelated Accordion PRD implementation.

## Audit result

- Walking skeleton owner: exactly Issue 01.
- AFK issues: 1.
- HITL issues: 1.
- Unowned planned files/symbols: none.
- Unproven blocking edges: none.
- Coverage gaps: None.
