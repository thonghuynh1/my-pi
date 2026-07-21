---
labels: wayfinder:task
status: done
map: ../MAP.md
blocks: []
findings: ./10-findings.md
---

# Locate existing hierarchical-grouping notes in accordion roadmap

## Question

The initial reconnaissance surfaced a comment that "hierarchical groups are on the roadmap" in accordion. Find where that thinking lives so we don't reinvent it:

- Scan `F:/MyWork/my-pi/extensions/accordion/conductors/README.md`, `VISION.md`, and any `docs/roadmap*` for the hierarchical / multi-level summary note.
- Also grep the repo for `hierarchical`, `group.*summary`, `tier.*summary`.
- Capture: (a) direct quotes with file:line references, (b) whether any prior design work exists, (c) any linked issues.

Deliverable: a short comment on this ticket with the findings, then close. If prior design work exists, mention it explicitly so the grilling tickets can cite it.

## Resolution

Findings written to `./10-findings.md`. **Not a clean slate** — this concept maps onto accordion's already-designed **Milestone C4 "The Archivist"** (nested groups / eras) built on top of flat **Milestone C2.5 "Auto-Coalesce"**. Key artifacts: `docs/conductor-plan.md` §C2.5+§C4, `docs/conductor-rework-roadmap.md` §C4, `VISION.md:100-102` ("Folding the folds"), `docs/adr/0006-multiblock-folds.md:205` (explicit flat-only current scope). Recoverable prior code on branch `claude/busy-bose-bd815d:app/src/lib/engine/coalesce.ts` (`findCoalesceRuns`, `findEraRuns`, `ancestorChain`). Existing flat implementation at `app/src/lib/engine/store.svelte.ts:1546` (`groupSummary()`). **Open contract question surfaced**: should the `Command` union get an `era` variant (protocol bump) or should era formation be host-automatic? This directly bears on ticket 06 (group representation). Recommend re-titling MAP.md tickets to accordion's vocabulary (coalesce, era, episode, Archivist) rather than the invented "chunked / pre-group / broker".
