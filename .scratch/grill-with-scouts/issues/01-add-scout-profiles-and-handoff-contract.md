# Add Scout Profiles and Scout-Grounded Handoff contract

Status: ready-for-agent

## What to build

Add the Engineering Skills MCP contract that the Grill With Scouts Tool will consume: canonical Scout Profiles, the Scout-Grounded Handoff format, and `to-prd` Delta Verification rules.

Decision IDs: `MACRO-003`, `MACRO-004`, `MACRO-005`, `MESO-007`, `MESO-008`, `MICRO-001`

## Implementation map

### Area: Engineering Skills MCP Scout Profiles

- **Decision IDs**: `MACRO-004`, `MACRO-005`
- **Current code anchors**:
  - `F:/MyWork/PrecioHackathon/hackathon-grill-me/skills/grill-with-docs/SKILL.md`: current planning skill extension over `grill-me`.
  - `F:/MyWork/PrecioHackathon/hackathon-grill-me/prompts/grill-me.md`: base single-question interrogation protocol.
  - `F:/MyWork/PrecioHackathon/hackathon-grill-me/src/loader.ts`: content discovery for skills, prompts, instructions, domain skills, and pstack skills.
  - `F:/MyWork/PrecioHackathon/hackathon-grill-me/src/index.ts`: MCP tool registration.
  - `F:/MyWork/PrecioHackathon/hackathon-grill-me/test/loader.test.ts`: loader test coverage.
- **Existing behavior**: Engineering Skills MCP exposes skills and prompts, but does not expose Scout Profiles or the Scout-Grounded Handoff contract.
- **Required edits**:
  - Add canonical Scout Profiles for backend, frontend, QA, and runtime.
  - Define each profile's scope, trigger fit, evidence requirements, verdict format, and forbidden behaviors.
  - Expose profiles through MCP in a way Pi can load deterministically.
  - Keep profile bodies small enough for repeated scout calls; the current Grill Checkpoint supplies project-specific context.
- **Snippet(s)**:

```ts
// current code anchor -- skills/prompts exposed as MCP tools
for (const tool of tools) {
  server.tool(tool.name, tool.description, async () => {
    if (tool.name.startsWith("skill-")) {
      const skillName = tool.name.replace(/^skill-/, "");
      const skill = getSkill(skillName);
```

Illustrative: Scout Profiles can be exposed with a similar loader/registration pattern or as instruction resources.

```text
// decision artifact -- Scout Profile fields, normative
Scout Profile:
- name
- description
- trigger fit
- scope
- evidence requirements
- verdict format
- forbidden behaviors
```

### Area: `to-prd` Delta Verification support

- **Decision IDs**: `MACRO-003`, `MESO-007`, `MESO-008`, `MICRO-001`
- **Current code anchors**:
  - `F:/MyWork/PrecioHackathon/hackathon-grill-me/skills/to-prd/SKILL.md`: current PRD workflow and code-grounding pass.
  - `F:/MyWork/PrecioHackathon/hackathon-grill-me/skills/review-implementation-readiness/SKILL.md`: readiness review checks for AFK implementability.
- **Existing behavior**: `to-prd` always performs a code-grounding pass if repo access exists. It does not distinguish areas already verified by a Scout-Grounded Handoff from areas needing normal discovery.
- **Required edits**:
  - Update `to-prd` to detect or accept a Scout-Grounded Handoff.
  - Add Delta Verification rules:
    - `path-verified, anchor-claimed`: spot-check named anchors only.
    - `partial`: targeted follow-up only in the named area.
    - `unverified` or Scout Gap: normal discovery or explicit unresolved gap.
    - contradiction: stop and report repair needed.
  - Preserve do-not-reopen decisions unless verification contradicts the handoff.
  - Add PRD area-block fields for scout evidence and verification status.
  - Avoid broad rediscovery for verified areas.
- **Snippet(s)**:

```md
<!-- current code anchor -- to-prd requires code grounding today -->
Before writing the PRD, perform a code-grounding pass. Inspect the files, tests, and wiring that are likely to change. Capture verified implementation anchors, not guesses:

- Target files and symbols that probably need edits.
- Existing call paths, state machines, interfaces, commands, handlers, components, or services the feature must connect to.
```

Normative change: this remains true only for areas without Scout-Grounded Handoff verification. Verified areas get Delta Verification.

```text
// decision artifact -- Delta Verification rules, normative
verified area -> spot-check claimed anchors
partial area -> targeted follow-up
unverified area -> normal discovery
contradiction -> stop PRD generation and report repair needed
```

### Global build and wiring notes

- `hackathon-grill-me` loader tests live in `test/loader.test.ts`.
- If Scout Profiles are implemented as a new content type, update `ContentRegistry`, `src/index.ts`, README/tool descriptions, and loader tests.
- If Scout Profiles are modeled as a skill, use the existing skill discovery path and avoid new loader plumbing.

## Acceptance criteria

- [ ] Backend, frontend, QA, and runtime Scout Profiles are available through Engineering Skills MCP.
- [ ] Each Scout Profile includes trigger fit, scope, evidence requirements, verdict format, and forbidden behaviors.
- [ ] Scout-Grounded Handoff format is documented in the Engineering Skills MCP contract.
- [ ] `to-prd` instructions support Delta Verification and do not require broad rediscovery for verified areas.
- [ ] `to-prd` explicitly stops on handoff/code contradiction.
- [ ] Loader or skill-discovery tests are updated for the chosen Scout Profile exposure mechanism.
- [ ] Runtime evidence captured: `npm test -- test/loader.test.ts` in `F:/MyWork/PrecioHackathon/hackathon-grill-me`, or the repo's equivalent focused test command.

## Blocked by

None - can start immediately
