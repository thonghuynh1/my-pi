---
status: closed
---

Status: ready-for-agent

# Recall provenance for folded pstack leaves

## Parent

PRD: `F:/MyWork/my-pi/.scratch/pstack-folded-recall-routing/PRD.md`

## What to build

Extend pstack folded recall routing so folded `recall` tool results inherit pstack identity from the single folded block they recalled. This makes repeated recall cycles self-identifying without parsing full pstack skill content.

Decision IDs: `DEC-001`, `DEC-015`, `DEC-016`, `DEC-017`, `DEC-020`.

User stories / required behaviors covered: 3, 5, 6, 7, 13.

## Implementation map

### Area: Recall provenance and folded digest identity parsing

- **Decision IDs**: `DEC-015`, `DEC-016`, `DEC-017`.
- **Current code anchors**:
  - `vendor/accordion/conductors/my-customize-conductor/mcp-summary.ts` — current defensive parsing style.
  - `vendor/accordion/conductors/my-customize-conductor/my-customize-conductor.ts` — access to all `ViewBlock`s and paired calls.
  - `vendor/accordion/conductors/contract/conductor.ts` — `ViewBlock` is the conductor input type; conductors operate on view text and metadata.
- **Existing behavior**: Recall results are not currently pstack-aware. The conductor has no persistent semantic metadata store and should remain stateless for MVP.
- **Required edits**:
  - Implement stateless recomputation from current view:
    1. Derive identities for original MCP result blocks from paired calls. This depends on issue 01's pstack identity parser.
    2. Parse current digest text lines containing `skill-pstack(name="...")` or `Contains: skill-pstack(name="...")`.
    3. Extract fold code from `{#<code> FOLDED}` in digest text and map it to the identity.
    4. For recall result blocks, parse the paired local `recall` tool call exactly when `toolName === "recall"` and args shape is `{"codes":["abc123"]}`.
    5. If exactly one code maps to a known pstack identity, enrich the recall result with that identity.
    6. If multiple codes or no known identity, use generic recall digest.
  - Do not parse full recalled skill content for MVP.
  - Pstack-enriched recall digests omit the source recalled code.
  - Generic single-code recall digests include the source code.

`decision artifact` — provenance precedence, normative:

```text
Identity derivation precedence:
1. Original MCP result → paired tool_call args.
2. Existing folded/replaced block → parse current digest text.
3. Recall result → paired recall args single code → fold-code identity map.
```

`decision artifact` — recall matching, normative:

```text
Only exact local recall shape participates:
toolName === "recall"
args: { "codes": ["abc123"] }

Multiple codes => generic recall digest.
Unknown code => generic recall digest.
```

`decision artifact` — target folded recall body, normative. Do not include `{#<code> FOLDED}` manually; `recoverable: true` makes the host add the official fold tag.

```text
tool_result:recall
Contains: skill-pstack(name="principle-prove-it-works")
Label: Prove It Works principle
Full result preserved. Use recall({"codes":["<code>"]}), not unfold, to re-read this exact pstack leaf.
```

### Area: MCP and pstack summary helpers

- **Decision IDs**: `DEC-001`, `DEC-005`, `DEC-006`, `DEC-015`, `DEC-016`.
- **Current code anchors**:
  - `vendor/accordion/conductors/my-customize-conductor/mcp-summary.ts`
  - Symbols from issue 01: pstack identity parser, label formatter, pstack summary formatter, generic recall formatter.
- **Existing behavior after issue 01**: Original pstack MCP results can be recognized and formatted. Generic recall formatting may still be absent or basic.
- **Required edits**:
  - Add or expose helper(s) that format pstack recall bodies separately from original MCP pstack bodies.
  - Add generic recall formatter for single-code unknown recall.
  - Ensure pstack recall wording says `to re-read this exact pstack leaf`, not `before re-calling this exact MCP tool`.

### Area: Direct conductor tests

- **Decision IDs**: `DEC-020`.
- **Current code anchors**:
  - `vendor/accordion/app/src/lib/engine/conductor.my-customize-conductor.test.ts`
  - Helpers: `vb`, `makeView`, `foldIdsOf`, `replaceOf`, `projected`
- **Existing behavior**: Direct tests assert emitted `Command[]` from synthetic `ConductorView` instances.
- **Required edits**:
  - Add tests that include an existing folded pstack digest with a fold code, a paired local `recall` call, and the recall result.
  - Assert the recall result is replaced recoverably with `tool_result:recall`, `Contains: skill-pstack(name="...")`, and the correct pstack label.
  - Assert multi-code and unknown-code recall stay generic.

### Global build / wiring notes

- This slice is blocked by issue 01 because it consumes pstack identity parsing and label formatting.
- Keep the conductor stateless. Do not add module-level maps that survive attach/detach.
- `ReplaceCommand.recoverable: true` is still required for recall replacements.

## Acceptance criteria

- [ ] Single-code recall inherits pstack identity from a folded digest. Run: `cd vendor/accordion/app && npm test -- conductor.my-customize-conductor.test.ts`. Expected: a test named like `enriches single-code recall results from folded pstack provenance` passes and asserts replacement content contains `tool_result:recall`, `Contains: skill-pstack(name="principle-prove-it-works")`, and `Label: Prove It Works principle`.
- [ ] Pstack-enriched recall omits the source recalled code. Run: `cd vendor/accordion/app && npm test -- conductor.my-customize-conductor.test.ts`. Expected: a test named like `omits source code in pstack recall digest` passes and asserts the pstack recall replacement content does not contain `code="abc123"` when `abc123` was the recalled source.
- [ ] Pstack recall uses semantic re-read wording. Run: `cd vendor/accordion/app && npm test -- conductor.my-customize-conductor.test.ts`. Expected: a test named like `uses pstack leaf wording for pstack recall digests` passes and asserts content contains `to re-read this exact pstack leaf` and does not contain `before re-calling this exact MCP tool`.
- [ ] Multi-code recall remains generic. Run: `cd vendor/accordion/app && npm test -- conductor.my-customize-conductor.test.ts`. Expected: a test named like `keeps multi-code recall generic` passes and asserts content does not contain `Contains: skill-pstack` when recall args include two codes.
- [ ] Unknown-code recall remains generic and includes the source code when single-code. Run: `cd vendor/accordion/app && npm test -- conductor.my-customize-conductor.test.ts`. Expected: a test named like `formats unknown single-code recall generically` passes and asserts content contains `tool_result:recall code="missing123"`.
- [ ] This slice consumes issue 01's pstack identity parser through real conductor wiring. Run: `cd vendor/accordion/app && npm test -- conductor.my-customize-conductor.test.ts`. Expected: the single-code recall test uses an existing folded digest generated in issue 01's canonical `skill-pstack(name="...")` format and passes without hard-coded result text parsing.

## Blocked by

- `01-pstack-aware-mcp-folded-summaries.md`
