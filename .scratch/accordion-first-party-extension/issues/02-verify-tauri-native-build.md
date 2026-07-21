---
status: ready-for-human
labels: ready-for-human
type: HITL
prd: ../PRD.md
---

# #02 — Verify the relocated Tauri native project with Cargo

## Parent

Parent PRD: [`.scratch/accordion-first-party-extension/PRD.md`](../PRD.md)

## What to build

No product code is built in this issue. Run the accepted native Tauri verification after Issue 01 has moved the unchanged desktop project to `extensions/accordion/app/src-tauri/`.

This proof is split from the AFK implementation because Cargo is not installed in the current agent environment (`cargo: command not found`). It verifies the native half of `US-002` without forcing Issue 01 to mix autonomous implementation with unavailable human-environment proof.

Coverage:

- **Decision:** `DEC-005`
- **User story:** `US-002`
- **Required behaviors verified:** `RB-002`, `RB-012`, `RB-013`

## Implementation map

Issue 01 produces this exact output:

```text
extensions/accordion/app/src-tauri/Cargo.toml
extensions/accordion/app/src-tauri/Cargo.lock
extensions/accordion/app/src-tauri/src/
extensions/accordion/app/src-tauri/tauri.conf.json
```

The producer moves the Tauri project without changing native behavior or dependency contracts. This issue consumes the moved `Cargo.toml` directly through Cargo's `--manifest-path` interface.

Blocking-edge details:

- **Producer:** `01-adopt-accordion-as-first-party-extension.md`
- **Producer output:** unchanged Tauri package rooted at `extensions/accordion/app/src-tauri/Cargo.toml`
- **Consumer:** local stable Rust/Cargo toolchain
- **Crossing contract:** the manifest, lockfile, Rust sources, Tauri configuration, and relative frontend/native paths remain internally consistent after relocation
- **Wiring owner:** Issue 01 owns every file move and path edit; this issue owns execution and recording of the native check only
- **Discriminating failure:** the command fails if the manifest is missing, paths were moved inconsistently, dependencies cannot resolve, or Rust code no longer compiles

Prerequisites:

- Stable Rust and Cargo installed and available on `PATH`.
- Tauri platform prerequisites installed for the current OS. On Windows, run from a shell where `%USERPROFILE%\.cargo\bin` is on `PATH`.
- Issue 01 completed in the same checkout.

Do not edit Rust/Tauri code to silence unrelated warnings or change desktop behavior. If the check exposes a relocation-caused path error, return it to Issue 01. If it exposes a pre-existing native defect unrelated to relocation, record the evidence instead of expanding this issue's scope.

## Acceptance criteria

- [ ] **AC-01 — The relocated native Accordion project resolves and compiles through its real manifest.**
  - Run: `cargo check --manifest-path extensions/accordion/app/src-tauri/Cargo.toml`
  - Expected: exits 0 and prints Cargo's successful `Finished dev profile` result for the moved Tauri package; no reference to `vendor/accordion` or `packages/accordion-broker` appears.

## Blocked by

- `01-adopt-accordion-as-first-party-extension.md`
