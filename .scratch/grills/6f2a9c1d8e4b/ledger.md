> Historical path note: Accordion was later relocated to `extensions/accordion/` and `extensions/accordion/broker/` by `.scratch/accordion-first-party-extension/issues/01-adopt-accordion-as-first-party-extension.md`.

# Grill ledger — adopt Accordion as a first-party extension

## D001 — First-party ownership boundary

- **Status:** accepted
- **Decision:** `my-pi` adopts the complete Accordion fork as first-party source: the Authoritative Accordion Folding Runtime, browser/desktop app, conductors, tests, and supporting docs/assets all remain in scope.
- **Rationale:** The fork is already evolved across these surfaces, and the runtime imports app-engine and conductor modules directly; treating only `accordion.ts` as owned would create a false boundary.
- **Evidence:** See `grounding.md` G001–G006; user selected the complete-fork option.
- **Dependencies:** None.
- **Decided:** Product ownership and retained capability scope.
- **Left to the implementer:** No ownership or scope choices; reversible file-level mechanics remain open pending later decisions.

## D002 — First-party module and repository shape

- **Status:** accepted
- **Decision:** Follow the `frontend-coach` ownership pattern: keep First-Party Accordion cohesive under `extensions/accordion/`, expose `extensions/accordion/index.ts` as its Pi entry, retain its app/conductors/tests/docs/assets beneath that owned directory, and do not split new cross-package interfaces during adoption.
- **Rationale:** This matches the repository's established first-party extension convention while preserving Accordion's current locality and relative integration. The larger product surface remains explicit inside the nested directory.
- **Evidence:** See `grounding.md` G003–G005 and G007–G010; user confirmed the proposed shape.
- **Dependencies:** D001.
- **Decided:** First-party home, Pi entry convention, and no package split during adoption.
- **Left to the implementer:** Exact private subfolder names and mechanical import-path updates, provided app/conductor/runtime locality and behavior remain intact.

## D003 — Browser Broker ownership and startup flow

- **Status:** accepted
- **Decision:** Move the Accordion Browser Broker into `extensions/accordion/broker/` as an internal First-Party Accordion module while preserving it as a detached singleton process shared by multiple Pi sessions.
- **Rationale:** This makes broker assets, contracts, tests, and path resolution local to First-Party Accordion without introducing multi-session ownership or shutdown races inside an individual Pi process.
- **Evidence:** See `grounding.md` G011–G014; user selected the internal-broker/separate-process option.
- **Dependencies:** D001, D002.
- **Decided:** Broker source ownership and process boundary; `/accordion` continues to start/reuse it and broker mode remains transport-only.
- **Left to the implementer:** Private broker file organization and equivalent local helpers; browser endpoints, filesystem contracts, startup/failure behavior, and singleton lifecycle are fixed.

## D004 — Adoption delivery boundary

- **Status:** accepted
- **Decision:** Adoption is a behavior-preserving source relocation only. It updates source locations, the Pi entry, broker location, imports, scripts, build paths, tests, and operational documentation without consolidating package manifests, redesigning shared contracts, or refactoring internal modules.
- **Rationale:** Keeping the diff dominated by moves and path updates makes regressions attributable and lets existing behavior-focused quality gates prove equivalence.
- **Evidence:** See `grounding.md` G004–G005, G008–G010, and G014; user selected relocation-only.
- **Dependencies:** D001, D002, D003.
- **Decided:** Migration scope and explicit deferral of package/contract cleanup.
- **Left to the implementer:** Mechanical move ordering and equivalent local path-helper implementation.

## D005 — Migration compatibility, documentation, and proof

- **Status:** accepted
- **Decision:** Perform one atomic source migration with no legacy source shim: `vendor/accordion/` and `packages/accordion-broker/` disappear after their contents move. Update all executable configuration, operational docs, and active issue-tracker artifacts to current paths. Preserve historical decision evidence, adding a relocation note where an old path is intentionally retained. Keep Accordion outside the root TypeScript compilation scope and verify it through its existing nested quality gates plus a Pi-entry smoke test.
- **Rationale:** This removes ambiguous dual ownership while preventing active instructions from sending agents to deleted paths. The nested Svelte/Tauri/runtime/broker toolchains are already the authoritative proof seams; pulling the entire app into the root `tsconfig` would be an unrelated build-system refactor.
- **Evidence:** `grounding.md` G001–G005, G009–G014; root `tsconfig.json` includes `extensions/**/*.ts`, while Accordion's existing `CONTRIBUTING.md`, app config, broker config, and extension smoke define specialized gates.
- **Dependencies:** D001–D004.
- **Decided:** No compatibility directory/symlink, active path-reference migration, historical-evidence policy, and verification ownership.
- **Left to the implementer:** Exact command orchestration in scripts, provided every accepted gate is runnable from the new paths.

## Provisional defaults

- Preserve current observable `/accordion`, folding, recall, broker-dashboard, and test behavior during any ownership/layout migration unless a later accepted decision explicitly changes it.

## Handoff confirmation

- **Status:** consumed
- **Result:** The user confirmed the decision-complete handoff with no unresolved gaps. `to-prd` published `.scratch/accordion-first-party-extension/PRD.md` with status `ready-for-agent`.
