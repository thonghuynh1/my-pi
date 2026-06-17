---
status: closed
---

# Add markdown prompt renderer and structured output parser

Status: ready-for-agent

## Parent

- [PRD](../PRD.md)

## What to build

Add the prompt and structured-output foundation for the new pair protocol. Extract pair prompts into phase-specific markdown files with named insertion markers. Add deterministic section parsing with canonical heading normalization and section-specific validator scaffolding. This slice does not need to complete the full pstack run behavior; it creates the reusable prompt/render/parse/repair primitives used by later slices.

Decision IDs: `DEC-023`, `DEC-024`, `DEC-025`, `DEC-026`.

User stories covered: 15, 16.

## Implementation map

### Area: Prompt Files and Renderer

- **Decision IDs**: `DEC-024`, `DEC-025`, `DEC-026`
- **Current code anchors**:
  - `extensions/lib/pair-protocol.ts` `buildNavigatorPreflightPrompt`
  - `extensions/lib/pair-protocol.ts` `buildDriverCyclePrompt`
  - `extensions/lib/pair-protocol.ts` `buildDriverCorrectionPrompt`
  - `extensions/lib/pair-protocol.ts` `buildNavigatorReviewPrompt`
  - `extensions/pair-program.ts` `buildRoleSystemPrompt`
  - Existing prompt directory: `extensions/prompts/` currently contains `lead-griller.md` and `scout-dispatch.md`.
- **Existing behavior**: Pair prompts are inline TypeScript template strings. There are no pair-specific markdown prompt files.
- **Required edits**:
  - Add prompt files such as `pair-shared.md`, `navigator-preflight.md`, `driver-first-turn.md`, `driver-cycle.md`, `driver-correction.md`, `navigator-review.md`, and `navigator-decision-repair.md`.
  - Use named markdown insertion markers such as `<!-- TASK -->`, `<!-- RUN_STATE -->`, `<!-- TELEMETRY_SUMMARY -->`, and phase-specific markers.
  - Rendering fails fast if a required marker is missing.
  - Inject phase-specific compact state blocks, not full run state every turn.
- **Snippet(s)**:

```md
<!-- decision artifact. Normative marker style for extracted prompt files. -->
# Navigator Review

<!-- TASK -->

<!-- RUN_STATE -->

<!-- DRIVER_REPORT -->

<!-- TELEMETRY_SUMMARY -->

<!-- DECISION_CONTRACT -->
```

- **Tests to extend**:
  - Unit tests for marker rendering, missing-marker failures, and per-phase payload selection.
  - Snapshot-style tests may be useful for rendered prompt shape, but keep them focused to avoid brittle prose diffs.
- **Wiring/build notes**:
  - Prompt loader should resolve files relative to the extension package, not the current user repo.

### Area: Markdown Output Parsing and Validation

- **Decision IDs**: `DEC-004`, `DEC-012`, `DEC-018`, `DEC-020`, `DEC-022`, `DEC-023`, `DEC-025`, `DEC-026`
- **Current code anchors**:
  - `extensions/lib/pair-protocol.ts` `parseNavigatorDecision`
  - `extensions/lib/pair-protocol.ts` `extractHeadingBody`
  - `extensions/lib/pair-protocol.ts` `buildNavigatorDecisionRepairPrompt`
- **Existing behavior**: The parser only enforces one `DECISION:` line and has a simple exact heading extractor. Malformed Navigator decisions get one repair pass. There is no structured validation for preflight, Driver startup, or final proof maps.
- **Required edits for this slice**:
  - Add a deterministic markdown section parser that normalizes headings by trimming, lowercasing, and removing trailing punctuation.
  - Add section-specific validator scaffolding for structured phase outputs.
  - Add a reusable one-repair-pass result shape that runtime can use later.
- **Snippet(s)**:

```ts
// current code anchor. Existing extractor is too exact and should be replaced/generalized.
function extractHeadingBody(markdown: string, heading: string): string | null {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start < 0) return null;
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) break;
    body.push(lines[i]);
  }
  return body.join("\n").trim() || null;
}
```

```ts
// current code anchor. Preserve exact one-decision-line contract, but add stricter section validation around it.
export function parseNavigatorDecision(text: string): NavigatorDecision {
  const matches = [...text.matchAll(/^\s*DECISION:\s*(\S+)\s*$/gim)];
  if (matches.length === 0) return { kind: "malformed", reason: "Missing DECISION line." };
  if (matches.length > 1) return { kind: "malformed", reason: "Multiple DECISION lines." };
  // ...
}
```

- **Tests to extend**:
  - Heading normalization tests.
  - Section-specific validation tests.
  - One-repair-pass tests for generic structured outputs.
- **Wiring/build notes**:
  - Keep validators pure. Runtime should call validators and decide whether to repair, block, or continue.

## Acceptance criteria

- [ ] Pair prompt files exist for shared, preflight, Driver first turn, Driver cycle, Driver correction, Navigator review, and Navigator decision repair phases.
- [ ] Prompt renderer inserts markdown blocks under required named markers.
- [ ] Prompt renderer fails fast when a required marker is absent.
- [ ] Renderer supports phase-specific compact state payloads.
- [ ] Markdown parser normalizes headings by trimming, lowercasing, and removing trailing punctuation.
- [ ] Parser preserves the exact one-`DECISION:`-line rule.
- [ ] Validator scaffolding supports section-specific deterministic checks.
- [ ] Tests cover marker rendering, missing marker failure, heading normalization, and section validation scaffolding.
- [ ] Runtime evidence captured: run the new prompt/parser unit tests and `npm run check`, and include passing output in the implementation summary.

## Blocked by

None - can start immediately.
