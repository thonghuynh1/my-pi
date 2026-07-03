---
id: "001"
title: "Skill Instruction — Prefer recall Over Repeating a Tool Call"
labels: [docs]
depends_on: []
status: closed
---

## What to build

A new section in `vendor/accordion/extension/skills/accordion-context-folding/SKILL.md` telling the model to check folded digests for an existing answer before calling a tool again, and to prefer `recall` over redoing the work. No code, no test, this is the soft layer ahead of the `tool_call` hook enforcement in issue 002.

**PRD decisions implemented**: none directly, this predates the decision register and motivated it.

## Implementation map

### Area: `skills/accordion-context-folding/SKILL.md`

- **Current code anchors**: the existing "What to unfold" section, end of file.
- **Existing behavior**: the skill tells the model when to `unfold` vs `recall` but says nothing about checking before calling a tool again.
- **Required edits**: added a new "Before repeating a tool call" section after "What to unfold", instructing the model to check whether a folded block already holds a tool's result before re-calling it, especially for tools with cost, side effects, or rate limits, and to prefer `recall` (or `unfold` for repeated need).

## Acceptance criteria

- [x] `SKILL.md` contains a "Before repeating a tool call" section.
  Verified by reading the file after the edit; no automated test exists for skill prose content.

## Blocked by

None. Shipped.
