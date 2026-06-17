---
status: closed
---

# Replace TDD contract with pstack registry gate

Status: ready-for-agent

## Parent

- [PRD](../PRD.md)

## What to build

Replace the public `pair_program` contract from TDD-only to pstack-driven pairing. Remove top-level `mode` and `testCommand`, rewrite user-facing descriptions, and replace `skill-tdd` prerequisite checks with a run-start `skill-pstack` registry snapshot from the `engineering-skills` MCP surface.

Decision IDs: `DEC-001`, `DEC-002`, `DEC-013`.

User stories covered: 1, 2, 17.

## Implementation map

### Area: Pair Program Tool Public Contract and Entrypoint

- **Decision IDs**: `DEC-001`, `DEC-002`, `DEC-013`
- **Current code anchors**:
  - `extensions/pair-program.ts` `PairProgramParams`
  - `extensions/pair-program.ts` `buildPairProgramToolDef`
  - `extensions/lib/pair-program-helpers.ts` `normalizeParams`
  - `extensions/__tests__/pair-program-params.test.ts`
- **Existing behavior**: The tool schema exposes `mode` and `testCommand`. Runtime rejects non-`tdd` mode and blocks if the engineering-skills MCP server is not configured for TDD.
- **Required edits**:
  - Remove `mode` and `testCommand` from `PairProgramParams`, `PairProgramRawParams`, and `PairProgramNormalizedParams`.
  - Rewrite tool descriptions, `promptSnippet`, prompt guidelines, slash command text, and result summary to say pstack-driven pair programming with Driver execution and review-only Navigator.
  - Replace skill-tdd-specific prerequisite language with an engineering-skills / `skill-pstack` registry prerequisite.
  - Snapshot allowed pstack registry once at run start from MCP tool metadata and block if unavailable.
- **Snippet(s)**:

```ts
// current code anchor. Normative seam to remove TDD-specific public API.
const PairProgramParams = Type.Object({
  task: Type.String({ description: "Task for the Driver/Navigator pair." }),
  mode: Type.Optional(
    StringEnum(["tdd"] as const, {
      description: "Pair workflow mode. MVP supports only tdd.",
    }),
  ),
  maxCycles: Type.Optional(Type.Number({ description: "Maximum Driver/Navigator cycles. Default: 4.", minimum: 1 })),
  testCommand: Type.Optional(Type.String({ description: "Test command to run during TDD red phase." })),
  driverModel: Type.Optional(Type.String({ description: "Model override for the Driver agent." })),
  navigatorModel: Type.Optional(Type.String({ description: "Model override for the Navigator agent." })),
});
```

```ts
// current code anchor. Normative seam to remove unsupported-mode rejection.
if (normalized.mode !== "tdd") {
  const errorResult: PairProgramDetails = {
    status: "error",
    summary: `Unsupported mode "${normalized.mode}". MVP only supports "tdd" mode.`,
    changedFiles: [],
    error: `Unsupported mode: ${normalized.mode}`,
  };
  return { content: [{ type: "text" as const, text: errorResult.summary }], details: errorResult, isError: true };
}
```

- **Tests to extend**:
  - Update `extensions/__tests__/pair-program-params.test.ts` to assert no `mode`, no `testCommand`, no unsupported-mode mapping, and new registry prerequisite behavior.
  - Add unit coverage for MCP pstack registry metadata parsing.
- **Wiring/build notes**:
  - Existing npm check command is `npm run check`.
  - Current pure helper test command is `npx tsx extensions/__tests__/pair-program-params.test.ts`.

### Area: Pstack Registry and Skill-load Validation

- **Decision IDs**: `DEC-011`, `DEC-012`, `DEC-013`, `DEC-015`
- **Current code anchors**:
  - `extensions/lib/pair-program-helpers.ts` `verifySkillTddAvailable`
  - MCP tool metadata for `engineering_skills_skill-pstack` lists available Skills and Playbooks.
- **Existing behavior**: Helper verification looks for `skill-tdd` in registered tools or engineering-skills MCP config. There is no pstack registry snapshot.
- **Required edits for this slice**:
  - Replace TDD prerequisite verification with pstack registry resolution.
  - Parse allowed names from MCP `skill-pstack` metadata. Normalize full playbook names like `poteto-mode/playbooks/bug-fix` and short slugs like `bug-fix` for human-facing structured output.
  - Block run if registry cannot be resolved.
- **Snippet(s)**:

```ts
// current code anchor. Existing helper shape can inspire registry verification, but TDD-specific names must go.
const SKILL_TDD_PATTERNS = [/skill[-_]tdd/i];

export function verifySkillTddAvailable(opts: SkillTddVerifierOptions): SkillTddVerificationResult {
  if (opts.getAllTools) {
    // registry lookup today
  }
  if (opts.isMcpConfigured) {
    // config fallback today
  }
  return { available: false, mechanism: "none" };
}
```

- **Tests to extend**:
  - Registry snapshot success and missing-registry block tests.
  - Slug normalization tests.
- **Wiring/build notes**:
  - The MCP metadata is canonical. Local file scanning is not part of the accepted default behavior.

## Acceptance criteria

- [ ] `pair_program` no longer accepts or normalizes `mode`.
- [ ] `pair_program` no longer accepts or uses top-level `testCommand`.
- [ ] Tool description, prompt snippet, prompt guidelines, slash command text, and result summary describe pstack-driven pair programming.
- [ ] Non-`tdd` unsupported-mode rejection path is removed because there is no mode parameter.
- [ ] TDD prerequisite checks are replaced with `skill-pstack` registry resolution.
- [ ] The pstack registry snapshot is frozen once per run and blocks the run if unavailable.
- [ ] Tests cover the updated public contract and pstack registry success/failure behavior.
- [ ] Runtime evidence captured: run `npx tsx extensions/__tests__/pair-program-params.test.ts` and `npm run check`, and include passing output in the implementation summary.

## Blocked by

None - can start immediately.
