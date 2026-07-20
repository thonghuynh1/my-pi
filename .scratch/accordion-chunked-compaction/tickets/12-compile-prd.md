---
labels: wayfinder:task
status: done
map: ../MAP.md
blocks: [11-draft-adr-0004]
assignee: wayfinder-agent
artifact: ../PRD.md
---

# Compile PRD via skill-to-prd

## Question

Turn the completed grill (all closed tickets 01–07 + the accepted ADR-0004 from ticket 11) into `.scratch/accordion-chunked-compaction/PRD.md` using the `engineering-skills` MCP `skill-to-prd` skill.

The PRD must be handoff-ready for `skill-to-issues` — precise enough that implementation tickets on a downstream map can be generated autonomously and each is verifiable by test.

Expected PRD contents (per `skill-to-prd`'s handoff shape):

- **Intent**: goal, users, success criteria, scope, non-goals — copied/normalized from the map's Destination and Out of scope.
- **Decisions**: every material accepted decision from tickets 02–07, grouped by concern (layout, rollover, broker, cache accounting, group representation, tool-pair integrity).
- **Contracts**: normative state shapes, message payloads, `ConductorView` / `Command` deltas, and rules (including the "at most one KV-cache-prefix break per rollover" invariant made testable).
- **How it will work**: entry points, data flow, modules, seams, side effects and failures — with pointers into `conductors/my-customize-conductor/` and `extension/cache-tracker.ts`.
- **Proof**: verification seams and commands a downstream implementer runs to enforce each contract.
- **Domain changes**: any glossary additions to `CONTEXT.md` and the path to accepted `docs/adr/0004-accordion-chunked-compaction.md`.
- **Unresolved gaps**: `None` (or map is not yet closable).

## Type rationale

`wayfinder:task` (HITL). Like ticket 11, no new decisions are made here — this is the mechanical composition of the PRD from resolved tickets + accepted ADR, with human confirmation of the handoff. Closing this ticket + closing 11 = the map's destination is reached.

## Follow-up (out of this map)

Implementation itself is out of scope for this map (see MAP.md ▸ Out of scope). A downstream effort keyed on this PRD will run `skill-to-issues` and drive the build.

## Comments

### Resolution (draft, awaiting human confirmation) — wayfinder-agent

Compiled `.scratch/accordion-chunked-compaction/PRD.md` from the accepted ADR-0004 plus the closed tickets 02–07 + 14 (α) using `engineering-skills` MCP `skill-to-prd` as the template guide, and the wayfinder MAP as the ledger analogue (the “READY_FOR_PRD handoff” in `skill-to-prd`’s language).

**Structural check (skill-to-prd readiness gate):**

- 12 required H2 sections present in the mandated order.
- 20 `DEC-###` entries in the Accepted Decision Register — every material accepted decision from the map's Decisions-so-far has an id.
- 5 `US-###` stories (developer-on-long-session, dashboard viewer, agent recall, operator diagnostics, small-context inert).
- 10 `RB-###` behaviours (no protocol change, tool-pair invariant, engine clamp bypass, immutability, byte-identical replay, JSONL block, `conductor/status`, small-context inertness, tail-append recall, verification invariant).
- 6 Implementation-Plan areas (conductor pre-group derivation, conductor digest emission + trim, conductor `attach(host)` + telemetry, engine `substOne` bypass, engine fold-code resolver policy branch, extension JSONL block). Every DEC/US/RB is referenced by ≥1 area's `Coverage`.
- `## Walking Skeleton` nominates `US-001` with a full-flow acceptance criterion.
- `## Unresolved Gaps: None`.

**Grounding pass:** a subagent verified every code anchor named in `Code anchors` clauses against `F:/MyWork/my-pi/vendor/accordion/` (`MyCustomizeConductor` class + `conduct()` signature; `substOne` + clamp lines; `resolveUnfold` + per-block match loop; `store.svelte.ts:824–847` protected-tail walk-back; `mapping.ts` `applyPlan` Phase A fixpoint; `digest.ts:198`; `cache-tracker.ts` diagnostics interface; `accordion.ts` JSONL author path; `GroupCommand` type; `CONDUCTOR_PROTOCOL_VERSION=3`). Anchors confirmed. Fresh identifiers (`constants.ts`, `attach(host)`, `preGroupTokens`) confirmed as new fabrications, correctly labelled in `Required edits` clauses.

**HITL confirmation received.** Human confirmed handoff-ready on close-out; ticket flipped to `done`; map updated; destination reached.

