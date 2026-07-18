---
labels: wayfinder:grilling
status: done
claimed_by: pi-agent (grill session)
map: ../MAP.md
blocks: []
---

# Confirm destination shape: ADR + prototype vs ADR-only vs code-only

## Question (original)

The map's stated destination is **ADR-0004 + a flagged prototype in `my-customize-conductor`**. Confirm or narrow before other tickets fan out:

- Is a prototype patch actually in scope for v1, or does this map end at the ADR (with the prototype being a follow-up map)?
- If a prototype ships, what "done" looks like for it — a runnable path behind a feature flag, an in-repo test, or a full A/B against `the-conductor-v2`?
- If ADR-only, do we still stand up a throwaway `research/*` branch spike to inform the ADR?

The answer here fixes what "the way is clear" means for every other ticket, so it must resolve first.

## Resolution

**Destination redrawn: ADR-0004 accepted + PRD ready for `skill-to-issues`.**

Direct answers to the three sub-questions:

1. **Prototype patch in v1?** No. No code lands in `conductors/my-customize-conductor/` during this map.
2. **"Done" for the prototype?** N/A — no prototype ships.
3. **`research/*` spike to inform the ADR?** No. Downstream tickets resolve at **spec fidelity** — "the PRD will say X", "the ADR will document Y" — not "the code does X". No runnable proof is produced during planning; the KV-invariant and other quantitative claims are defended by specification precise enough that a downstream implementer can enforce them with a test.

## Consequences (applied to the map in the same turn)

- **Destination** rewritten: keeps the four-zone layout as the design being captured, but the artifact commitment becomes "ADR-0004 accepted **plus** `PRD.md` ready for `skill-to-issues` handoff" — the prototype clause is removed.
- **Notes** gains a standing preference: this map ends at ADR + PRD; no code lands in `my-customize-conductor/` during this map. Implementation is a downstream effort keyed on the PRD. Replaces the prior "prototype is a decision-locking exercise" line.
- **Out of scope** gains: any code merged to `conductors/my-customize-conductor/`.
- **New tickets** (create-then-wire): [11 Draft & accept ADR-0004](11-draft-adr-0004.md), blocked by 02–07; [12 Compile PRD via `skill-to-prd`](12-compile-prd.md), blocked by 11.
- **Frontier after this resolution**: 02, 04, 06 (unblocked by closing 01). 03/05/07 remain blocked. 11 blocked by all six architectural tickets; 12 blocked by 11.

## Ledger

Private grill ledger: `.scratch/grills/wayfinder-01-a/ledger.md` (decision D1 accepted).
