# Context Glossary

## Pair Program Tool

A deterministic Pi extension tool that coordinates an autonomous pair-programming run for one task. It is not an LLM agent. It owns turn order, transcript display, transcript persistence, completion checks, and message passing between the Driver Agent and Navigator Agent.

## Grill With Scouts Tool

A deterministic Pi extension tool that coordinates a planning-focused grilling session with selective scout subagents. It owns scout trigger checks, context checkpointing, scout display, scout transcript structure, and handoff packaging while the Lead Griller remains the only human-facing interviewer.

## Grill With Scouts Session

A managed planning session started by the Grill With Scouts Tool. The normal Pi conversation remains human-facing, while deterministic session state tracks accepted decisions, scout checks, checkpoints, and the final planning handoff.

## Scout-Grounded Handoff

A structured planning handoff produced by a Grill With Scouts Session. It carries accepted decisions, scout evidence, verified anchors, partial or unverified areas, do-not-reopen decisions, and delta verification instructions for PRD generation.

## Grill Artifact Store

The active target repository's `.scratch/grill-with-scouts/` directory. It owns Grill With Scouts Session transcripts, scout outputs, checkpoints, Scout-Grounded Handoffs, and related planning artifacts so downstream PRD and issue generation can continue from the same repository context.

## Delta Verification

The PRD generation mode used when a Scout-Grounded Handoff exists. Verified areas receive anchor spot-checks, partial areas receive targeted follow-up, unverified areas receive normal discovery, and contradictions between code and handoff stop PRD generation for repair.

## Tool-Enforced Verification

The rule that a Scout-Grounded Handoff marks an area as verified only when the Grill With Scouts Tool can derive that status from actual scout tool-call telemetry, such as file reads, searches, inspected paths, and recorded tool results, rather than from scout self-report alone.

## Anchor-Level Verification

The practical verification level for Scout-Grounded Handoffs. The Grill With Scouts Tool records tool-verified inspected paths from scout telemetry, records scout-claimed symbols or contracts as anchor claims, and instructs PRD generation to spot-check those anchor claims instead of repeating broad discovery.

## Engineering Skills MCP

The MCP server named `engineering-skills` that exposes reusable engineering skills and prompts, including `grill-with-docs`, `to-prd`, and `skill-tdd`. It is the contract source for planning, PRD handoff, and TDD workflow protocols that Pi tools should follow. Pair Program Tool runs in TDD mode should depend on this MCP capability rather than hardcoded skill file paths.

## Scout Profile

A canonical planning role definition owned by the Engineering Skills MCP. A Scout Profile describes the scope, trigger fit, evidence requirements, and verdict format for a specialized planning scout such as backend, frontend, QA, or runtime.

## Scout Gate

A deterministic decision checkpoint in a Grill With Scouts Session. It records whether a material planning decision crosses boundaries, changes contracts, introduces states or lifecycles, creates runtime risk, relies on unverified layer assumptions, or has meaningful failure cost, and determines which Scout Profiles must be consulted or why consultation is explicitly skipped.

## Scout Budget Policy

The Grill With Scouts Session rule for controlling scout token spend. High-risk Scout Gate triggers cause immediate scout calls, medium-risk triggers ask the human before calling scouts, and low-risk decisions may proceed with an explicit skip reason.

## Grill Checkpoint

A compact continuation record for a Grill With Scouts Session. It preserves the goal, current tier, accepted decisions, user-accepted assumptions, unresolved questions, durable scout findings, glossary deltas, ADR candidates, contract artifacts, and next question without replaying the full session transcript.

## Grill Respawn

The automatic continuation of a Grill With Scouts Session from a Grill Checkpoint when context pressure reaches the respawn threshold. It preserves the managed session state while avoiding degraded planning from an overfull context.

## Respawn Status Event

The Scout Room event shown when a Grill Respawn occurs. It reports that a checkpoint was created, a fresh Lead Griller continued the session, the current tier was preserved, and the next question is unchanged, with checkpoint details available on expansion.

## Durable Scout Finding

The compact part of a scout result kept in active Grill With Scouts Session state. It includes the scout verdict, durable constraints, blockers, verified anchors, required follow-up decisions, and confidence, while the full scout output is kept only in the audit transcript.

## Scout Gap

An explicit unverified planning gap recorded when a required scout fails, times out, is skipped by acknowledged budget choice, or returns unusable output. A Scout Gap prevents the affected area from being treated as verified in the Scout-Grounded Handoff.

## Scout Room

The Pi display surface for a Grill With Scouts Session. It shows the Lead Griller, available scouts, active Scout Gates, scout status, scout verdicts, context pressure, and handoff readiness so the human can see how planning decisions are being checked.

## Scout Room Summary

The persistent compact view inside the Scout Room. It shows the current tier, current decision, active scouts, scout verdicts, context pressure, and handoff readiness, while gate trigger fields, evidence anchors, and full scout outputs remain expandable.

## Driver Agent

The child Pi agent responsible for changing the workspace inside the task worktree. It reads code, edits files, runs tests, and reports evidence for each implementation cycle.

## Navigator Agent

The child Pi agent responsible for reviewing the Driver Agent's plan, evidence, and changes. It can inspect the workspace and run focused verification commands, but it does not edit or write files.

## Pair Run Memory

The compact working memory maintained by the Pair Program Tool during a run. It contains the task summary, accepted constraints, unresolved risks, current cycle objective, latest agent handoff, and current evidence. It is used instead of replaying the full transcript into every agent turn.

## Pair Transcript

The human-auditable record of Driver Agent and Navigator Agent communication during a pair-programming run. The full transcript is saved for review, but only compact Pair Run Memory is passed back into agent prompts.

## TDD Skill

The test-driven development workflow exposed by Engineering Skills MCP as `skill-tdd`. In TDD mode, Driver Agent and Navigator Agent are expected to use this skill for red-green-refactor behavior and evidence reporting.
