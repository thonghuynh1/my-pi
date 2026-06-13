# Pair Program Transcript

- Task: Implement the issue described in `f:\MyWork\my-pi\.scratch\grill-with-scouts\issues\01-add-scout-profiles-and-handoff-contract.md`.

**Summary**: Add Scout Profiles and Scout-Grounded Handoff contract to the Engineering Skills MCP (`F:/MyWork/PrecioHackathon/hackathon-grill-me`).

**What to build**:

1. **Scout Profiles** – Add canonical Scout Profiles for backend, frontend, QA, and runtime. Each profile must include: name, description, trigger fit, scope, evidence requirements, verdict format, and forbidden behaviors. Expose them through the MCP (either as a new content type via the loader/ContentRegistry or as skills using existing skill discovery). Keep profile bodies compact.

2. **Scout-Grounded Handoff contract** – Document the handoff format that the Grill With Scouts tool will consume, exposed through Engineering Skills MCP.

3. **`to-prd` Delta Verification** – Update `skills/to-prd/SKILL.md` to detect/accept a Scout-Grounded Handoff and apply Delta Verification rules:
   - `path-verified, anchor-claimed` → spot-check named anchors only
   - `partial` → targeted follow-up in the named area only
   - `unverified` or Scout Gap → normal discovery
   - contradiction → stop and report repair needed
   - Preserve do-not-reopen decisions unless verification contradicts handoff
   - Add PRD area-block fields for scout evidence and verification status
   - Avoid broad rediscovery for verified areas

**Key code anchors** (all in `F:/MyWork/PrecioHackathon/hackathon-grill-me`):
- `src/loader.ts` – content discovery
- `src/index.ts` – MCP tool registration
- `test/loader.test.ts` – loader tests
- `skills/grill-with-docs/SKILL.md` – planning skill extension
- `skills/to-prd/SKILL.md` – PRD workflow
- `prompts/grill-me.md` – base interrogation protocol

**Acceptance criteria**:
- Backend, frontend, QA, and runtime Scout Profiles available through MCP
- Each profile has trigger fit, scope, evidence requirements, verdict format, forbidden behaviors
- Scout-Grounded Handoff format documented in MCP contract
- `to-prd` supports Delta Verification without broad rediscovery for verified areas
- `to-prd` stops on handoff/code contradiction
- Loader or skill-discovery tests updated for Scout Profile exposure
- Tests pass: `npm test -- test/loader.test.ts` in `F:/MyWork/PrecioHackathon/hackathon-grill-me`
- Started: 2026-06-13T18:52:23.556Z
- Mode: tdd

---

## coordinator: start

skill-tdd prerequisite verified

---

## coordinator: initial_workspace

Initial workspace snapshot:
git status:
?? .scratch/pair-runs/
git diff stat: (no changes)
git diff: (no changes)

---

## navigator: preflight

Now I have a complete picture of the codebase. Let me formulate the plan.

---

## Acceptance Checklist

1. **[AC-1] Scout Profile content type in loader** — `ContentRegistry` gains `getScoutProfile(name)`, `listScoutProfiles()` methods that discover `.md` files from a `scouts/` directory (following the existing skill-directory-with-frontmatter pattern).
2. **[AC-2] Backend Scout Profile** — `scouts/backend/PROFILE.md` exists with frontmatter fields: name, description, trigger-fit, scope, evidence-requirements, verdict-format, forbidden-behaviors. Body is compact.
3. **[AC-3] Frontend Scout Profile** — `scouts/frontend/PROFILE.md` exists, same structure.
4. **[AC-4] QA Scout Profile** — `scouts/qa/PROFILE.md` exists, same structure.
5. **[AC-5] Runtime Scout Profile** — `scouts/runtime/PROFILE.md` exists, same structure.
6. **[AC-6] MCP exposure** — Scout Profiles are exposed via the MCP server (in `src/index.ts`), either as tools or resources, so Pi can load them deterministically.
7. **[AC-7] Scout-Grounded Handoff contract** — A documented handoff format (as an instruction, prompt, or skill in the MCP content tree) specifying the fields a Scout-Grounded Handoff must carry: scout name, area, verification-level (`path-verified`, `anchor-claimed`, `partial`, `unverified`), evidence block, anchors, gaps, and contradiction flags.
8. **[AC-8] `to-prd` Delta Verification** — `skills/to-prd/SKILL.md` updated: accepts a Scout-Grounded Handoff, applies delta verification rules (`path-verified`/`anchor-claimed` → spot-check; `partial` → targeted follow-up; `unverified`/gap → normal discovery; contradiction → stop and report).
9. **[AC-9] `to-prd` area-block fields** — PRD area-block template gains `scout-evidence` and `verification-status` fields.
10. **[AC-10] `to-prd` contradiction stop** — `to-prd` instructions explicitly say to stop PRD generation and report repair needed when handoff contradicts code.
11. **[AC-11] `to-prd` preserve do-not-reopen** — `to-prd` preserves do-not-reopen decisions unless verification contradicts handoff.
12. **[AC-12] Loader tests updated** — `test/loader.test.ts` has tests for scout profile discovery: discovers profiles, returns correct fields, returns undefined for unknown, `listScoutProfiles()` returns all four.
13. **[AC-13] Test fixtures** — `test/fixtures/scouts/` contains at least one fixture profile for testing.
14. **[AC-14] All tests pass** — `npm test -- test/loader.test.ts` passes green (existing 19 + new scout tests).

## Risks

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| R1 | **Naming collision with existing `skills/` discovery** — Scout Profiles live in a `scouts/` dir but `discoverSkills` skips `domain/` explicitly; a new content type needs its own discovery function to avoid being accidentally picked up. | Medium | Use a separate `scouts/` directory at root level (peer to `skills/`, `prompts/`), with its own `discoverScoutProfiles()` function and `PROFILE.md` convention (not `SKILL.md`). |
| R2 | **ContentRegistry interface change breaks index.ts** — Adding methods to the `ContentRegistry` interface requires updating both the factory and the default-instance wrappers. | Low | Mechanical — follow the exact pattern used for pstack/domain. |
| R3 | **`to-prd` SKILL.md is pure prose** — No automated test validates the skill's markdown content. Delta Verification correctness depends on careful prose review. | Medium | Navigator reviews the prose edits carefully for completeness against AC-8/9/10/11. |
| R4 | **Scout Profile frontmatter field consistency** — Structured fields (trigger-fit, evidence-requirements, etc.) in YAML frontmatter must parse correctly via `gray-matter`. Nested or multiline YAML could trip up. | Low | Keep frontmatter values as simple strings or short lists. Test with fixtures. |
| R5 | **Fixture directory not created** — Test fixtures need a `scouts/` subdir under `test/fixtures/`. Forgetting this silently makes tests pass with empty results. | Medium | First cycle creates fixtures + failing tests before production code (TDD). |

## First Cycle Objective

**Goal: Red tests for Scout Profile discovery in the loader.**

1. Create the test fixture directory `test/fixtures/scouts/example-scout/PROFILE.md` with valid frontmatter (name, description, trigger-fit, scope, evidence-requirements, verdict-format, forbidden-behaviors).
2. Add failing tests to `test/loader.test.ts`:
   - `getScoutProfile("example-scout")` returns the profile with correct fields.
   - `getScoutProfile("nonexistent")` returns `undefined`.
   - `listScoutProfiles()` returns the fixture name.
   - `listTools()` or equivalent includes scout profile entries (if exposed as tools).
3. Confirm tests fail (RED) because `ContentRegistry` doesn't have `getScoutProfile` / `listScoutProfiles` yet.

This establishes the TDD contract for the new content type before any production code is written.

DECISION: PROPOSE_CYCLE – Driver writes RED tests: scout profile test fixtures + failing loader tests for `getScoutProfile` and `listScoutProfiles`.

---

## driver: cycle_1

All 4 new tests fail (RED) as expected, and all 19 existing tests still pass. The tests fail because `getScoutProfile`, `listScoutProfiles` don't exist on `ContentRegistry`, and `listTools` doesn't include scout entries.

## Changed Files

| File | Change |
|------|--------|
| `test/fixtures/scouts/example-scout/PROFILE.md` | **Created** – test fixture with all required frontmatter fields |
| `test/loader.test.ts` | **Modified** – added 4 failing tests in new `scout profile discovery` describe block |

## Tests Run

```
npm test -- test/loader.test.ts
Result: 4 failed | 19 passed (23 total)
```

**Failed (RED – expected):**
1. `discovers scout profile and returns correct fields` → `TypeError: registry.getScoutProfile is not a function`
2. `returns undefined for unknown scout profile name` → `TypeError: registry.getScoutProfile is not a function`
3. `listScoutProfiles returns discovered profile names` → `TypeError: registry.listScoutProfiles is not a function`
4. `listTools includes scout profile entries` → `AssertionError: expected 0 to be greater than 0`

**All 19 existing tests pass** – no regressions.

## Evidence

- **TDD RED phase confirmed**: All 4 new tests fail for the right reasons — the `ContentRegistry` interface has no `getScoutProfile` or `listScoutProfiles` methods, and `listTools` doesn't emit scout entries.
- **Test fixture created**: `test/fixtures/scouts/example-scout/PROFILE.md` contains all 7 required frontmatter fields (name, description, trigger-fit, scope, evidence-requirements, verdict-format, forbidden-behaviors) plus a body.
- **Existing tests unaffected**: 19/19 pre-existing tests pass.

## Acceptance Checklist Progress

| AC | Status | Notes |
|----|--------|-------|
| AC-1 | 🔴 RED | Tests written; `ContentRegistry` methods not yet implemented |
| AC-2–5 | ⬜ Not started | Real scout profiles not yet created |
| AC-6 | 🔴 RED | `listTools` test for scout entries failing |
| AC-7 | ⬜ Not started | Handoff contract doc not yet created |
| AC-8–11 | ⬜ Not started | `to-prd` updates not yet started |
| AC-12 | 🔴 RED | Loader tests written, failing as expected |
| AC-13 | ✅ Done | Test fixture created |
| AC-14 | 🔴 RED | 4 tests failing |

## Next Intent

**Cycle 2: GREEN – Implement `ScoutProfileEntry`, `discoverScoutProfiles()`, and add `getScoutProfile`/`listScoutProfiles` to `ContentRegistry`** in `src/loader.ts`, plus update `listTools` to include scout entries. Target: all 23 tests pass.

---

## navigator: review_1

## Cycle 1 Review

### TDD Rubric

| Criterion | Verdict |
|---|---|
| **RED before GREEN** | ✅ All 4 new tests fail; no production code touched. |
| **Failed for the intended reason** | ✅ Tests 1–3 fail with `TypeError: registry.getScoutProfile/listScoutProfiles is not a function` (method doesn't exist). Test 4 fails with `AssertionError: expected 0 to be greater than 0` (`listTools` doesn't emit scout entries). All correct RED signals. |
| **One behavior at a time** | ✅ All 4 tests target a single cohesive feature surface: scout profile discovery on `ContentRegistry`. |
| **Public behavior tests** | ✅ Tests exercise the public `ContentRegistry` interface methods, not internals. |
| **No horizontal slicing** | ✅ Tests define the full vertical contract (get, list, tool exposure) for a single content type. |
| **Existing tests unaffected** | ✅ 19/19 pre-existing tests still pass. |

### Fixture Quality

The `PROFILE.md` fixture is well-formed:
- All 7 required frontmatter fields present (name, description, trigger-fit, scope, evidence-requirements, verdict-format, forbidden-behaviors).
- Values are realistic and testable (not lorem ipsum).
- Body is compact.
- Uses hyphenated YAML keys (`trigger-fit`) which the test maps to camelCase (`triggerFit`) — this will force the Driver to handle key mapping in the production code. Good design pressure.

### Test Design Quality

- Tests assert each individual field by name, which locks down the `ScoutProfileEntry` interface shape.
- The `listTools` test expects `scout-` prefix convention, distinct from `skill-` and `prompt-`, which is a clean namespace.
- The `undefined` for unknown name test covers the negative path.

### Minor Observations (non-blocking)

- The `ScoutProfileEntry` type isn't imported in the test yet because it doesn't exist — the tests will naturally guide its creation in the GREEN phase. Fine.
- The `listTools` scout tool exposure test (test 4) couples scout profiles to `listTools()`. This is a design choice — scouts show up alongside skills and prompts in the tool list. Reasonable for MCP discovery.

### Checklist Progress Confirmed

| AC | Status |
|----|--------|
| AC-1 | 🔴 RED — interface contract defined by tests |
| AC-12 | 🔴 RED — loader tests written |
| AC-13 | ✅ — fixture created |

### Next Cycle Guidance

Cycle 2: GREEN. Implement `ScoutProfileEntry` interface, `discoverScoutProfiles()` function, add `getScoutProfile(name)` and `listScoutProfiles()` to `ContentRegistry`, and update `listTools()` to include `scout-` prefixed entries. All 23 tests should pass. Follow the exact patterns used for skills/prompts/instructions discovery — the key-mapping from hyphenated YAML (`trigger-fit`) to camelCase (`triggerFit`) is the only novel piece.

DECISION: approve_next

---

## driver: cycle_2

Everything looks good. The implementation follows the exact same patterns as the existing content types.

## Changed Files

| File | Change |
|------|--------|
| `src/loader.ts` | **Modified** – Added `ScoutProfileEntry` interface, `discoverScoutProfiles()` function, `getScoutProfile`/`listScoutProfiles` to `ContentRegistry` interface & implementation, scout entries in `listTools()`, default instance wrappers |

## Tests Run

```
npm test -- test/loader.test.ts
Result: 23 passed (23 total) ✅ GREEN

npx tsc --noEmit
Result: Clean, no errors
```

## Evidence

- **TDD GREEN phase confirmed**: All 4 previously-RED scout profile tests now pass:
  - `discovers scout profile and returns correct fields` ✅ – all 7 frontmatter fields correctly mapped (hyphenated YAML → camelCase)
  - `returns undefined for unknown scout profile name` ✅
  - `listScoutProfiles returns discovered profile names` ✅
  - `listTools includes scout profile entries` ✅ – `scout-example-scout` appears with correct description
- **No regressions**: All 19 pre-existing tests still pass (23/23 total)
- **TypeScript clean**: `tsc --noEmit` reports no errors
- **Pattern consistency**: `discoverScoutProfiles()` follows same directory+frontmatter pattern as `discoverSkills()`, `discoverPrompts()`, `discoverInstructions()`; uses `PROFILE.md` convention to distinguish from `SKILL.md`

## Acceptance Checklist Progress

| AC | Status | Notes |
|----|--------|-------|
| AC-1 | ✅ GREEN | `ContentRegistry` has `getScoutProfile(name)`, `listScoutProfiles()`, scouts included in `listTools()` |
| AC-2–5 | ⬜ Not started | Real scout profiles (backend/frontend/QA/runtime) not yet created |
| AC-6 | ✅ GREEN | Scout profiles exposed via `listTools()` with `scout-` prefix |
| AC-7 | ⬜ Not started | Handoff contract doc not yet created |
| AC-8–11 | ⬜ Not started | `to-prd` Delta Verification updates not yet started |
| AC-12 | ✅ GREEN | 4 loader tests for scout profile discovery all pass |
| AC-13 | ✅ Done | Test fixture at `test/fixtures/scouts/example-scout/PROFILE.md` |
| AC-14 | ✅ GREEN | 23/23 tests pass |

## Next Intent

**Cycle 3: Create the four canonical Scout Profiles** (`scouts/backend/PROFILE.md`, `scouts/frontend/PROFILE.md`, `scouts/qa/PROFILE.md`, `scouts/runtime/PROFILE.md`) in the production content tree, plus the Scout-Grounded Handoff contract document. These are content-only files (no code changes needed since `discoverScoutProfiles` already handles the `scouts/` directory). Verify with a quick smoke check that the production registry discovers all four.

---

## navigator: review_2

All claims confirmed. 23/23 green, TypeScript clean. Let me review the implementation quality.

## Cycle 2 Review

### TDD Rubric

| Criterion | Verdict |
|---|---|
| **RED before GREEN** | ✅ Cycle 1 established RED; this cycle makes them GREEN. Proper sequence. |
| **RED failed for the intended reason** | ✅ Verified in Cycle 1: `TypeError: not a function` for missing methods, `AssertionError` for empty scout tool list. |
| **Minimal implementation** | ✅ Only the code needed to pass 4 tests was added. No speculative features. |
| **Public behavior tests** | ✅ All tests exercise the `ContentRegistry` public interface. |
| **No horizontal slicing** | ✅ Single vertical slice: scout profile discovery end-to-end (discover → get → list → tools). |
| **Passing-after evidence** | ✅ 23/23 pass, tsc clean — independently verified. |
| **No regressions** | ✅ Original 19 tests still pass. |

### Implementation Quality

- **`ScoutProfileEntry` interface**: Clean, all 7 structured fields plus `body`. Matches the test expectations exactly.
- **`discoverScoutProfiles()`**: Follows the exact `discoverSkills` pattern — directory iteration, `PROFILE.md` convention, `gray-matter` parsing, malformed-frontmatter fallback via `try/catch`. Correct hyphenated-key mapping (`parsed.data["trigger-fit"]` → `triggerFit`).
- **`ContentRegistry` additions**: `getScoutProfile`, `listScoutProfiles` correctly wired with lazy `ensureScouts()` cache.
- **`listTools()` update**: Scout entries appended with `scout-` prefix — clean namespace separation from `skill-` and `prompt-`.
- **Default-instance wrappers**: `getScoutProfile()` and `listScoutProfiles()` module-level functions added, matching the pattern for every other content type.
- **No `index.ts` changes yet**: Correct — MCP tool registration (AC-6) will follow when the actual scout profiles exist. `listTools()` integration in the loader is sufficient for now.

### Checklist Progress

| AC | Status |
|----|--------|
| AC-1 | ✅ GREEN |
| AC-6 | ✅ Partial (loader exposes via `listTools`; `index.ts` wiring deferred to when profiles exist) |
| AC-12 | ✅ GREEN |
| AC-13 | ✅ Done |
| AC-14 | ✅ GREEN (23/23) |

### Next Cycle Guidance

Cycle 3 should create the four production Scout Profiles (`scouts/backend/PROFILE.md`, `scouts/frontend/PROFILE.md`, `scouts/qa/PROFILE.md`, `scouts/runtime/PROFILE.md`) and the Scout-Grounded Handoff contract document. Since these are content files consumed by an already-tested discovery mechanism, no new loader code is needed — but the Driver should verify the production registry discovers all four (quick smoke test or a dedicated test). Also wire `index.ts` to handle `scout-` prefixed tools from `listTools()`.

DECISION: approve_next

---

## driver: cycle_3

## Changed Files

| File | Change |
|------|--------|
| `src/loader.ts` | **Modified** – Added `getScoutToolDescription()` to `ContentRegistry` interface, implementation (lazy-cached), and default wrapper |
| `src/index.ts` | **Modified** – Added `scout-` prefix branch to tool loop: imports `getScoutProfile`/`getScoutToolDescription`, returns full profile with structured fields |
| `test/loader.test.ts` | **Modified** – Added 2 new tests: `getScoutToolDescription` and body+fields integrity check |
| `scouts/backend/PROFILE.md` | **Created** – Backend scout profile with all 7 required frontmatter fields |
| `scouts/frontend/PROFILE.md` | **Created** – Frontend scout profile with all 7 required frontmatter fields |
| `scouts/qa/PROFILE.md` | **Created** – QA scout profile with all 7 required frontmatter fields |
| `scouts/runtime/PROFILE.md` | **Created** – Runtime scout profile with all 7 required frontmatter fields |
| `instructions/scout-handoff-contract.md` | **Created** – Scout-Grounded Handoff contract: fields, verification levels, evidence block format, consumer rules |

## Tests Run

```
npm test -- test/loader.test.ts
Result: 25 passed (25 total) ✅ GREEN

npx tsc --noEmit
Result: Clean, no errors

Production smoke test:
- listScoutProfiles() → ['backend', 'frontend', 'qa', 'runtime'] ✅
- getScoutToolDescription() → lists all 4 with descriptions ✅  
- getInstruction('scout-handoff-contract') → found with correct description ✅
```

## Evidence

- **TDD RED→GREEN**: `getScoutToolDescription` test failed RED (`TypeError: not a function`), then passed GREEN after implementation
- **All 4 Scout Profiles discovered in production**: `listScoutProfiles()` returns `['backend', 'frontend', 'qa', 'runtime']`
- **Each profile has all 7 required fields**: name, description, trigger-fit, scope, evidence-requirements, verdict-format, forbidden-behaviors (verified via frontmatter parsing and existing tests)
- **Handoff contract exposed as instruction**: `getInstruction('scout-handoff-contract')` returns the document with full spec: fields table, verification levels, evidence block format, consumer rules
- **MCP wiring complete**: `index.ts` handles `scout-` tools — returns structured frontmatter + body as formatted markdown
- **No regressions**: 25/25 tests pass, TypeScript clean

## Acceptance Checklist Progress

| AC | Status | Notes |
|----|--------|-------|
| AC-1 | ✅ Done | `ContentRegistry` has `getScoutProfile`, `listScoutProfiles`, `getScoutToolDescription` |
| AC-2 | ✅ Done | `scouts/backend/PROFILE.md` created |
| AC-3 | ✅ Done | `scouts/frontend/PROFILE.md` created |
| AC-4 | ✅ Done | `scouts/qa/PROFILE.md` created |
| AC-5 | ✅ Done | `scouts/runtime/PROFILE.md` created |
| AC-6 | ✅ Done | `index.ts` handles `scout-` tools with full profile output |
| AC-7 | ✅ Done | `instructions/scout-handoff-contract.md` with fields, levels, evidence block, consumer rules |
| AC-8 | ⬜ Not started | `to-prd` Delta Verification update |
| AC-9 | ⬜ Not started | `to-prd` area-block fields |
| AC-10 | ⬜ Not started | `to-prd` contradiction stop |
| AC-11 | ⬜ Not started | `to-prd` preserve do-not-reopen |
| AC-12 | ✅ Done | 6 loader tests for scout profiles (25/25 pass) |
| AC-13 | ✅ Done | Test fixture at `test/fixtures/scouts/example-scout/PROFILE.md` |
| AC-14 | ✅ Done | 25/25 tests pass |

## Next Intent

**Cycle 4: Update `skills/to-prd/SKILL.md` with Delta Verification rules** — AC-8 through AC-11. This is a prose-only change: add Scout-Grounded Handoff acceptance, delta verification dispatch table, area-block template with `scout-evidence` and `verification-status` fields, contradiction-stop rule, and do-not-reopen preservation. No code changes needed (pure skill content), so verify with a read-back review.

---

## navigator: review_3

All files verified. Let me now do the full assessment.

## Cycle 3 Review

### TDD Rubric

| Criterion | Verdict |
|---|---|
| **RED before GREEN** | ✅ Driver reports RED→GREEN for `getScoutToolDescription` (new test). The 4 production profiles + handoff contract are content files consumed by already-tested discovery, which is acceptable. |
| **Failed for intended reason** | ✅ `TypeError: not a function` for `getScoutToolDescription` — correct RED signal. |
| **Minimal implementation** | ⚠️ See note below — this cycle bundled multiple deliverables. |
| **Public behavior tests** | ✅ All tests exercise `ContentRegistry` public API. |
| **No regressions** | ✅ 25/25 pass, tsc clean — independently confirmed. |

### Scope Concern (non-blocking)

This cycle did a lot: 4 production scout profiles, handoff contract instruction, `index.ts` MCP wiring, `getScoutToolDescription`, and 2 new tests. Strictly, TDD prefers smaller slices. However:
- The 4 profiles are pure content files with no code changes (the discovery mechanism was already tested in cycle 2).
- The handoff contract is an instruction file consumed by the already-tested `discoverInstructions` path.
- `getScoutToolDescription` did go through RED→GREEN properly.
- `index.ts` scout branch is mechanical (follows the exact `skill-`/`prompt-` pattern).

The bundling is acceptable because most of the work is content, not logic.

### Content Quality Review

**Scout Profiles** — All 4 are well-crafted:
- Each has distinct, domain-appropriate `trigger-fit`, `scope`, and `forbidden-behaviors`.
- Verdict format is consistent across all 4 (`path-verified | anchor-claimed | partial | unverified`).
- Investigation protocols are concrete and actionable. Bodies are compact (~20 lines).
- No copy-paste mistakes between profiles.

**Handoff Contract** — Thorough and well-structured:
- All required fields documented with types and required/optional markers.
- Verification levels table with clear downstream actions.
- Evidence block format with a concrete YAML example.
- Consumer rules section directly maps to the Delta Verification rules from the issue.
- `do-not-reopen` field included with correct preservation semantics.

**MCP Wiring** — `index.ts` scout branch returns formatted markdown with all structured fields exposed. Follows existing patterns cleanly.

### Checklist Progress

| AC | Status |
|----|--------|
| AC-1 | ✅ Done |
| AC-2 | ✅ Done |
| AC-3 | ✅ Done |
| AC-4 | ✅ Done |
| AC-5 | ✅ Done |
| AC-6 | ✅ Done |
| AC-7 | ✅ Done |
| AC-8–11 | ⬜ Remaining — `to-prd` Delta Verification |
| AC-12 | ✅ Done (6 tests) |
| AC-13 | ✅ Done |
| AC-14 | ✅ Done (25/25) |

### Next Cycle Guidance

Cycle 4: Update `skills/to-prd/SKILL.md` with Delta Verification. This is prose-only (no loader code). The Driver must:
1. Add a section that detects/accepts a Scout-Grounded Handoff **before** the code-grounding pass.
2. Embed the delta dispatch table (verification levels → actions) inline in the skill.
3. Add `scout-evidence` and `verification-status` to the area-block template.
4. Add explicit contradiction-stop rule.
5. Add do-not-reopen preservation clause.
6. Ensure the existing code-grounding pass is conditional: only for `unverified`/gap areas.

Since this is prose, no automated test applies — I'll review the content carefully for AC-8/9/10/11 completeness.

DECISION: approve_next

---

## driver: cycle_4

## Summary

Cycle 4: Updated `skills/to-prd/SKILL.md` with Delta Verification rules (AC-8 through AC-11). This is a prose-only change — no code modifications. The `to-prd` skill now detects Scout-Grounded Handoffs, applies verification-level-dependent code-grounding, stops on contradictions, preserves do-not-reopen decisions, and includes `scout-evidence` and `verification-status` fields in area block templates.

## Changed Files

| File | Change |
|------|--------|
| `skills/to-prd/SKILL.md` | **Modified** — Added Scout-Grounded Handoff Detection section (delta verification dispatch table, do-not-reopen preservation, contradiction stop rule, conditional code-grounding pass), and added `scout-evidence` + `verification-status` fields to area block template |

## Tests Run

```
npm test -- test/loader.test.ts
Result: 25 passed (25 total) ✅ GREEN

npx tsc --noEmit
Result: Clean, no errors
```

## Evidence

- **AC-8 Delta Verification** ✅ — Dispatch table added with all 6 verification levels mapped to actions:
  - `path-verified` → spot-check named anchors only (line 46)
  - `anchor-claimed` → spot-check named anchors only (line 47)
  - `partial` → targeted follow-up in named gaps only (line 48)
  - `unverified` → normal full discovery (line 49)
  - Scout Gap → normal full discovery (line 50)
  - `contradiction: true` → stop immediately (line 51)
- **AC-9 Area-block fields** ✅ — `Scout evidence` field (line 143) and `Verification status` field (line 144) added to area block template, with values `path-verified | anchor-claimed | partial | unverified | no-handoff | contradiction`
- **AC-10 Contradiction stop** ✅ — Explicit contradiction stop rule (line 55): halt PRD generation, emit `## Contradiction Report` block, name contradicting evidence
- **AC-11 Do-not-reopen preservation** ✅ — Preservation clause (line 53): do not revisit closed areas unless contradiction directly impacts the closed decision
- **Conditional code-grounding** ✅ — Grounding pass instructions (line 57) now conditional: spot-check for verified, gaps-only for partial, full pass for unverified/no-handoff
- **No regressions**: 25/25 tests pass, TypeScript clean

## Acceptance Checklist Progress

| AC | Status | Notes |
|----|--------|-------|
| AC-1 | ✅ Done | `ContentRegistry` has `getScoutProfile`, `listScoutProfiles`, `getScoutToolDescription` |
| AC-2 | ✅ Done | `scouts/backend/PROFILE.md` |
| AC-3 | ✅ Done | `scouts/frontend/PROFILE.md` |
| AC-4 | ✅ Done | `scouts/qa/PROFILE.md` |
| AC-5 | ✅ Done | `scouts/runtime/PROFILE.md` |
| AC-6 | ✅ Done | `index.ts` handles `scout-` tools |
| AC-7 | ✅ Done | `instructions/scout-handoff-contract.md` |
| AC-8 | ✅ Done | Delta Verification dispatch table in `to-prd` |
| AC-9 | ✅ Done | `scout-evidence` + `verification-status` in area-block template |
| AC-10 | ✅ Done | Contradiction stop rule with `## Contradiction Report` |
| AC-11 | ✅ Done | Do-not-reopen preservation clause |
| AC-12 | ✅ Done | 6 loader tests for scout profiles |
| AC-13 | ✅ Done | Test fixture |
| AC-14 | ✅ Done | 25/25 tests pass |

## Next Intent

**All 14 acceptance criteria are complete.** The implementation is ready for Navigator final review. No further cycles needed unless the Navigator identifies gaps.

---

## navigator: review_4

25/25 pass, tsc clean. Now let me do the careful prose review of AC-8/9/10/11 against the `to-prd` content.

## Cycle 4 Final Review

### TDD Note
This is a prose-only cycle (skill markdown, no code). No RED/GREEN applies. Tests confirm no regressions.

### AC-8: Delta Verification — ✅ Complete

The dispatch table at lines 38–51 covers all required levels:
- `path-verified` → spot-check anchors only, no broad rediscovery ✅
- `anchor-claimed` → spot-check anchors only, no broad rediscovery ✅
- `partial` → targeted follow-up in named gaps only ✅
- `unverified` → normal full discovery ✅
- Scout Gap → normal full discovery ✅
- `contradiction: true` → stop immediately ✅

The conditional code-grounding pass (starting "Before writing the PRD, perform a code-grounding pass...") correctly branches by verification level. This directly replaces the previous unconditional full-pass instruction.

### AC-9: Area-block fields — ✅ Complete

The area block template now includes:
- **Scout evidence** — scout name, verification level, key anchors from handoff.
- **Verification status** — with valid values: `path-verified | anchor-claimed | partial | unverified | no-handoff | contradiction`.
- Clear instruction that for verified areas, code anchors come from handoff + spot-check.

### AC-10: Contradiction stop — ✅ Complete

Explicit rule: "halt PRD generation for that area and emit a `## Contradiction Report` block instead of an area block. The report must name the contradicting evidence and the claim it contradicts. Do not proceed past contradiction."

### AC-11: Do-not-reopen preservation — ✅ Complete

"If the handoff includes `do-not-reopen` entries, preserve those decisions in the PRD. Do not revisit or rediscover closed areas unless a contradiction is found that directly impacts the closed decision."

### Prose Quality Assessment

The Delta Verification section is well-placed — it sits between step 2 (explore repo) and the code-grounding pass, which is the natural insertion point. The flow reads cleanly:
1. Check for handoffs
2. Apply delta verification table
3. Perform conditional grounding (scoped by verification level)

The area-block template additions are non-disruptive — they slot in after `Decision IDs` and before `Current code anchors`, which is the right position since they determine how much grounding was done.

### Full Acceptance Checklist — Final

| AC | Status | Verified |
|----|--------|----------|
| AC-1 | ✅ | Cycle 2: `ContentRegistry` has `getScoutProfile`, `listScoutProfiles`, `getScoutToolDescription` |
| AC-2 | ✅ | Cycle 3: `scouts/backend/PROFILE.md` — all 7 fields |
| AC-3 | ✅ | Cycle 3: `scouts/frontend/PROFILE.md` — all 7 fields |
| AC-4 | ✅ | Cycle 3: `scouts/qa/PROFILE.md` — all 7 fields |
| AC-5 | ✅ | Cycle 3: `scouts/runtime/PROFILE.md` — all 7 fields |
| AC-6 | ✅ | Cycle 3: `index.ts` handles `scout-` tools with structured output |
| AC-7 | ✅ | Cycle 3: `instructions/scout-handoff-contract.md` — fields, levels, evidence, consumer rules |
| AC-8 | ✅ | Cycle 4: Delta Verification dispatch table in `to-prd` |
| AC-9 | ✅ | Cycle 4: `scout-evidence` + `verification-status` in area-block template |
| AC-10 | ✅ | Cycle 4: Contradiction stop + `## Contradiction Report` |
| AC-11 | ✅ | Cycle 4: Do-not-reopen preservation clause |
| AC-12 | ✅ | Cycle 2-3: 6 loader tests for scout profiles |
| AC-13 | ✅ | Cycle 1: Test fixture at `test/fixtures/scouts/example-scout/PROFILE.md` |
| AC-14 | ✅ | 25/25 tests pass, tsc clean |

All 14 acceptance criteria are satisfied. Tests green. TypeScript clean. No regressions.

DECISION: final_approve

---

## coordinator: final_verification

Final verification:
command: cd F:/MyWork/PrecioHackathon/hackathon-grill-me && npm test -- test/loader.test.ts
exit code: 0
summary: > engineering-skills-mcp@1.0.0 test
> vitest run test/loader.test.ts


[1m[30m[46m RUN [49m[39m[22m [36mv4.1.5 [39m[90mF:/MyWork/PrecioHackathon/hackathon-grill-me[39m

 [32m✓[39m test/loader.test.ts [2m([22m[2m25 tests[22m[2m)[22m[32m 21[2mms[22m[39m

[2m Test Files [22m [1m[32m1 passed[39m[22m[90m (1)[39m
[2m      Tests [22m [1m[32m25 passed[39m[22m[90m (25)[39m
[2m   Start at [22m 02:04:11
[2m   Duration [22m 276ms[2m (transform 38ms, setup 0ms, import 108ms, tests 21ms, environment 0ms)[22m

---

