# Issue 04: Escalation Nudges on Low-Result Searches

**Label:** `ready-for-agent`

## Parent

`.scratch/aiknow-proactive/PRD.md`

## What to build

When `aiknow_search` returns ≤2 results, append a prescriptive escalation nudge to the response guiding the agent toward alternative actions. Zero results get a specific template interpolating the search term; 1–2 results get a broadening suggestion. Nudges are self-contained (no cross-reference with codebase map or other features).

**Covers:** US-005, RB-007, DEC-006

## Implementation map

### Nudge logic (DEC-006)

**File:** `integrations/pi/aiknow/index.ts` → `aiknow_search` tool handler, response formatting section

**Existing:** Tool handler formats search results and returns them. No nudge logic exists.

**Required edits:**
- Add helper function (inline or separate file):
  ```typescript
  function formatEscalationNudge(query: string, resultCount: number): string | null {
    if (resultCount === 0)
      return `[aiknow] No indexed results for "${query}". Try grep, or the symbol may be in an unindexed file.`;
    if (resultCount <= 2)
      return `[aiknow] Only ${resultCount} result(s) for "${query}". Try broadening your search or using grep for unindexed files.`;
    return null;
  }
  ```
- In the response formatting path, after determining `entryPoints.length`:
  ```typescript
  const nudge = formatEscalationNudge(query, entryPoints.length);
  if (nudge) responseText += "\n\n" + nudge;
  ```

**Decision constraints:**
- Trigger: ≤2 results ONLY (not confidence-based)
- Wording: prescriptive (direct commands like "Try grep")
- Zero-result template: must interpolate the search term for agent reuse
- Self-contained: no references to codebase map or other injected context

**Choices left to implementer:** Exact 1–2 result nudge wording (the template above is normative but minor word changes acceptable). Placement of helper (inline vs. separate module).

## Acceptance criteria

- [ ] Zero-result searches get interpolated nudge
  - Run: `npx vitest run src/test/proactive-escalation-nudge.test.ts`
  - Test: `src/test/proactive-escalation-nudge.test.ts` → `appends zero-result nudge with interpolated term`
  - Expected: When search returns 0 results for query "FooBar", response contains `[aiknow] No indexed results for "FooBar". Try grep, or the symbol may be in an unindexed file.`
  - Fails when: nudge missing, or search term not interpolated (shows placeholder instead of "FooBar")

- [ ] 1–2 result searches get broadening nudge
  - Run: `npx vitest run src/test/proactive-escalation-nudge.test.ts`
  - Test: `src/test/proactive-escalation-nudge.test.ts` → `appends broadening nudge for 1-2 results`
  - Expected: When search returns 1 result for query "Widget", response contains `[aiknow] Only 1 result(s) for "Widget"` and mentions grep
  - Fails when: nudge absent for 1 or 2 results

- [ ] 3+ result searches have no nudge
  - Run: `npx vitest run src/test/proactive-escalation-nudge.test.ts`
  - Test: `src/test/proactive-escalation-nudge.test.ts` → `no nudge for 3+ results`
  - Expected: When search returns 5 results, response does NOT contain `[aiknow]` nudge text
  - Fails when: nudge appears on normal result counts

- [ ] Nudge is self-contained (no map references)
  - Run: `npx vitest run src/test/proactive-escalation-nudge.test.ts`
  - Test: `src/test/proactive-escalation-nudge.test.ts` → `nudge does not reference codebase map`
  - Expected: Nudge text does not contain "codebase map", "proactive", or "## Codebase Map"
  - Fails when: nudge cross-references other proactive features

## Blocked by

None - can start immediately.
