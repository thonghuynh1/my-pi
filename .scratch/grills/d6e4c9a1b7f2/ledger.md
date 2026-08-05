# Grill ledger — large Accordion session broker freeze

Map: `.scratch/accordion-large-session-perf/PRD.md`
Ticket: `.scratch/accordion-large-session-perf/issues/05-browser-perf-validation.md`
Type: `wayfinder:grilling` (HITL)
Claim: `pi-agent (grill session)`

## Grounding

See [`grounding.md`](./grounding.md), GROUND-001 through GROUND-007.

## Decision plan

- D1 — Define the repair boundary and proof obligation for the reported large-session freeze.
- D2 — Decide whether any remaining broker-specific sync changes are required after D1.
- D3 — Set the browser and store regression seams for delivery.

## Decisions

### D1 — open

Question: Should this repair treat the existing store/reactivity/canvas fixes as the implementation baseline and finish with broker-specific sync coverage plus the browser performance harness, rather than reopen the authoritative runtime or add unrelated broker UI behavior?

Evidence: GROUND-001 through GROUND-006.

Dependencies: D2, D3.

## Session status

Open. Waiting for the human's D1 answer.
