# ADR 0001: Use a deterministic coordinator for pair programming

## Status

Accepted

## Context

The project needs a Pi pair-programming workflow where a Driver Agent and Navigator Agent can work together on a task without waiting for human input at every step. The human should still be able to observe important handoffs live and audit the full transcript afterward.

An LLM orchestrator agent would be able to interpret the conversation, but it would add token cost, another source of drift, and another model context that can misunderstand or overrule the two-role protocol.

## Decision

Implement pair programming as a deterministic Pi extension tool, not as a third LLM agent.

The Pair Program Tool creates and manages two persistent child Pi sessions:

- Driver Agent: owns workspace changes inside the current task worktree.
- Navigator Agent: reviews plans, evidence, diffs, and edge cases without edit/write tools.

The coordinator enforces turn order, role-specific tool permissions, max cycles, one correction packet per cycle, required Navigator decision lines, live handoff streaming, abort handling, and transcript persistence. It does not judge code quality or TDD evidence itself; those judgments belong to the Navigator Agent.

## Consequences

- Pair runs use two model contexts instead of three.
- Workflow control is predictable and cheaper than an AI orchestrator.
- The coordinator must implement enough state management to relay prompts, collect neutral evidence, save transcripts, and track usage.
- The Navigator Agent remains responsible for qualitative review, checklist coverage, and final approval.
- Future Ralph Loop integration can call the same tool without inheriting an extra orchestration model.
