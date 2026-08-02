# Pre-Group visibility issue coverage ledger

Status: closed

## Command validation

| Command | Working directory | Pre-publication result | Use |
|---|---|---|---|
| `npx vitest run src/lib/engine/conductor.compaction-naive.test.ts` | `extensions/accordion/app` | PASS — 111 tests | Issue 01 conductor proof |
| `npx vitest run src/lib/engine/store.host.test.ts src/lib/live/conductorClient.test.ts` | `extensions/accordion/app` | PASS — 64 tests | Issues 01 and 03 store/remote proof |
| `npx vitest run src/lib/ui/map/MapHeader.budget.test.ts src/lib/ui/map/drain.test.ts` | `extensions/accordion/app` | PASS — 13 tests | UI runner/Testing Library seam |
| `node --test smoke.test.mjs` | `extensions/accordion/conductors/tiered-relevance` | PASS | Issue 03 bundled wire proof |
| `node --test smoke.test.ts` | `extensions/accordion/conductors/the-conductor` | PASS | Issue 03 bundled wire proof |
| `node --test smoke.test.ts` | `extensions/accordion/conductors/the-conductor-v2` | PASS | Issue 03 bundled wire proof |
| `npm test` | `extensions/accordion/app` | BASELINE FAIL — three unrelated 5s timeouts in garbage-collector/Keel tests; relevant focused suites pass | Deferred as a non-discriminating global gate; each issue uses focused suites |
| `npm run check` | `extensions/accordion/app` | BASELINE FAIL before source checking: adapter-static is rejected as lacking `adapt` | Deferred; component tests compile changed Svelte files. Repairing repository adapter configuration is outside this PRD |

## ID coverage

| Obligation | State | Owner and falsifying criterion |
|---|---|---|
| `DEC-001` | covered by issue | `01-authoritative-pre-group-map.md` AC-01-21/22/23 fail unless exact and empty Map region states use authoritative membership |
| `DEC-002` | covered by issue | Issue 01 AC-01-05 through AC-01-15 separately falsify human fold/toggle/group, observation, conductor fold/replace/group, and rollover variants |
| `DEC-003` | covered by issue | `02-transcript-and-progress.md` AC-02-01 fails if Transcript does not mirror membership |
| `DEC-004` | covered by issue | Issue 02 AC-02-02/03/04/05 separately falsify Map accumulation, Transcript accumulation, waiting, and early-rollover states |
| `DEC-005` | covered by issue | Issue 01 AC-01-03/04/08/18/19/20 fail if metadata is invalid, status steers behavior, ownership broadens, or cleanup leaks |
| `DEC-006` | covered by issue | Issue 01 AC-01-01/02/14/15/16/17 fail if snapshots, empty/legacy/hold branches, or partial rollover differ |
| `US-001` walking skeleton | covered by issue | Issue 01 AC-01-23 runs actual `MyCustomizeConductor → AccordionStore → ContextMap` wiring and rollover |
| `US-002` | covered by issue | Issue 02 AC-02-01 proves Transcript membership and boundary |
| `US-003` | covered by issue | Issue 02 AC-02-02/03/04/05 prove both-lens accumulation, waiting, and early-rollover presentation |
| `RB-001` | covered by issue | Issue 01 AC-01-01/02 assert complete exact and explicit empty membership branches |
| `RB-002` | covered by issue | Issue 01 AC-01-14/15 and Issue 03 AC-03-02 prove local full/partial and remote atomic behavior |
| `RB-003` | covered by issue | Issue 01 AC-01-16 and Issue 03 AC-03-03 separately prove legacy and remote omitted metadata own no region |
| `RB-004` | covered by issue | Issue 01 AC-01-18/19/20 separately prove detach, replacement, and no-region cleanup |
| `RB-005` | covered by issue | Issue 01 AC-01-03/04 prove current-ID validation and no telemetry reconstruction |
| `RB-006` | covered by issue | Issue 01 AC-01-05/06/07/09/10 separately prove fold affordance, direct fold, toggle, group refusal, and inspection |
| `RB-007` | covered by issue | Issue 01 AC-01-11/12/13/14 separately prove fold, replace, group clamps, and allowed rollover |
| `RB-008` | covered by issue | Issue 01 AC-01-15 proves partial rollover residue |
| `RB-009` | covered by issue | Issue 01 AC-01-24/25/26/27/28 separately prove complete-turn, open-pair, early, escape-valve, and Atomic Budget Rebase variants |
| `RB-010` | covered by issue | Issue 01 AC-01-21/22 and Issue 02 AC-02-01 prove Map exact/empty and Transcript variants separately |
| `RB-011` | covered by issue | Issue 02 AC-02-02/03 separately prove canonical label and numeric progress in Map and Transcript |
| `RB-012` | covered by issue | Issue 02 AC-02-04/05 prove waiting above target and safe early rollover below target |
| `RB-013` | covered by issue | Issue 01 AC-01-22 proves empty membership preserves two-region Map; Issue 02 AC-02-08 proves Transcript fallback |
| `RB-014` | covered by issue | `03-remote-plan-protocol.md` AC-03-01 and AC-03-05 through AC-03-12 separately prove wire contract, canonical/bundled versions, result branches, and status docs |

## Implementation-area and left-choice coverage

| Item | State | Owner/proof |
|---|---|---|
| Contract types and legacy normalization | covered by issue | Issue 01 owns `PreGroupRegion`, `ConductorPlan`, `ConductorResult`; AC-01-01/02/16/17 |
| MyCustomize plan production and all return paths | covered by issue | Issue 01; AC-01-01/02/14/15/24–30 |
| Store membership representation/helper names | covered by issue | Issue 01; local reversible naming allowed, AC-01-03/04/05 enforce behavior |
| Store human and conductor enforcement | covered by issue | Issue 01; AC-01-05 through AC-01-14 |
| Map hierarchy and reversible visual polish | covered by issue | Issue 01 owns region hierarchy; AC-01-21/22/23. Styling details remain implementer-local |
| Transcript icon/accessible wording | covered by issue | Issue 02; AC-02-01/06/07/08. Exact icon is local but accessible “Pre-Group” text is required |
| Progress number formatting and tooltip placement | covered by issue | Issue 02; AC-02-02/03/04/05. Formatting is local but values/status must be asserted |
| Remote message, runner, protocol version | covered by issue | Issue 03; AC-03-01/02/03/04/05 |
| Bundled wire conductor migration and docs | covered by issue | Issue 03; AC-03-06 through AC-03-12 |
| Domain glossary and architectural ADR | covered by issue | Already published by grill; Issue 03 AC-03-05 keeps developer docs aligned |
| Full `npm test` gate | deferred/out of scope | Existing unrelated timeout failures make it non-discriminating; focused affected suites are validated and required |
| `npm run check` gate | deferred/out of scope | Existing adapter configuration fails before source analysis; issue component tests compile affected Svelte sources |

## Blocking edges

| Producer → consumer | Crossing contract | Consumer wiring and proof |
|---|---|---|
| Issue 01 → Issue 02 | `AccordionStore` authoritative membership helpers plus `preGroupTokens`, `preGroupTargetTokens`, `preGroupFillPct`, and phase telemetry | Issue 02 consumes them in `ContextMap.svelte`; AC-02-01/02 runs real store/component wiring |
| Issue 01 → Issue 03 | `PreGroupRegion`, `ConductorPlan`, result normalizer, and store complete-plan application | Issue 03 adds the same optional metadata to `ConductorCommandsMessage` and feeds it through `RemoteRunner`; AC-03-01/02 proves real message-to-store wiring |

## File ownership

- Issue 01 owns contract creation in `conductors/contract/conductor.ts`, store region semantics, `MyCustomizeConductor` plan production, and the Map section.
- Issue 02 is a blocked consumer that may edit `ContextMap.svelte` only for Transcript/progress refinements after Issue 01’s Map hierarchy lands.
- Issue 03 owns `protocol.ts`, `conductorClient.svelte.ts`, remote tests, bundled remote version migrations, and conductor developer documentation.

## Audit

- Walking skeleton owner: Issue 01 only; no blockers.
- HITL work: None. All visual requirements have headless DOM/accessibility assertions.
- Intentional deferrals: two pre-existing global command failures recorded above; neither is used as proof.
- Coverage gaps: None.
