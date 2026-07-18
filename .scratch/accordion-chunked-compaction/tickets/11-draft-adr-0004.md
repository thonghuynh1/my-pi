---
labels: wayfinder:task
status: done
map: ../MAP.md
blocks: [02-four-zone-layout, 03-rollover-trigger-policy, 04-broker-model-integration, 05-cache-invalidation-accounting, 06-group-representation, 07-tool-call-pair-integrity, 13-summarizer-llm-choice]
artifact: ../../../docs/adr/0004-accordion-chunked-compaction.md
---

# Draft & accept ADR-0004: Accordion chunked compaction

## Question

Once every architectural ticket (02–07, 13) is resolved, consolidate their decisions into `docs/adr/0004-accordion-chunked-compaction.md` and take it through the ADR review cycle to `accepted`.

Scope of the ADR (derived from the map's Destination and Notes):

- The four-zone context layout — precise zone definitions, precedence rules, and interaction with `frozenFromIndex` / `protectedFromIndex` (from ticket 02).
- The rollover trigger and batch policy that gives the "at most one KV-cache-prefix break per rollover" invariant (from ticket 03).
- Broker-dashboard integration: mode targeting (direct + broker), where the summary computation lives, dashboard surfacing of group summaries, cross-session isolation, persistence contract (from ticket 04).
- Summarizer LLM: backend selection, async pattern (`host.complete()` + `host.requestRerun()`), prompt shape, fallback policy, and cost/latency ceilings (from ticket 13).
- The cache-invalidation cost model backing the trigger policy (from ticket 05).
- The group representation on the wire — reuse of `GroupCommand` vs additive protocol change — and `recall` semantics (from ticket 06).
- Tool-call/tool-result pair-integrity rules across zone boundaries (from ticket 07).
- Immutability of group summaries and irreversibility of any DROP.
- Non-goals (level-2 rollover, cross-conductor coordination, GUI treatment — currently listed under **Not yet specified**).

Format: follow `skill-domain-modeling` ADR-FORMAT.md. Cite the closed tickets 02–07 and 13 as the decision record and the closed findings tickets 08/09/10 as evidence.

## Type rationale

`wayfinder:task` (HITL). No new decisions are made here — every architectural choice is already resolved on the seven blocking tickets. This ticket is the mechanical write-up + human acceptance of the ADR. Unblocks ticket 12 (PRD compilation), which cites the accepted ADR.

## Resolution

ADR-0004 drafted at `docs/adr/0004-accordion-chunked-compaction.md` and **accepted** by the human on 2026-07-18. Seven sections cover T02/T03/T04/T05/T06/T07 + T14 (α no-LLM) plus the §5 `substOne` engine tweak (frozen-region clamp bypass for `group` with non-null `digest`) — the sole load-bearing engine change. Follows local house style (`## Context / Decision / Considered Options / Consequences`, YAML front-matter with `status: accepted`, no ADR-FORMAT.md exists in this repo). Cites closed tickets 02–07 + 14 as decision record and findings 08/09/10 as evidence. Non-goals section preserves the Not-yet-specified map entries (level-2 rollover, code-skeleton interaction, `session_before_compact`, deterministic-body composition rule) and the Out-of-scope entries verbatim. Ticket 12 (compile PRD) is now unblocked and is the sole open frontier ticket.
