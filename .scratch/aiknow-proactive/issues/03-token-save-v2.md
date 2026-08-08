---
Status: ready-for-agent
status: closed
---

# Issue 03: Token-Saved Estimates in Search Responses

**Label:** `ready-for-agent`

## Parent

`.scratch/aiknow-proactive/PRD.md`

## What to build

Add token-saved estimate fields (`tokensSaved`, `tokensSavedPercent`, `filesAvoided`) to every `aiknow_search` response. The calculation lives in the core engine's response assembly, uses 4 chars/tok approximation, and is always returned (even when savings = 0). The Pi integration formats a display string from the structured data.

**Covers:** US-004, RB-006, DEC-008

## Implementation map

### Core engine calculation (DEC-008)

**File:** `src/core/retrieval/retrieval.ts` → `buildMetrics` (line 883)

**Existing:** `buildMetrics` assembles `SearchMetrics` from search results. Does not include token estimates.

**Required edits:**
- Extend `SearchMetrics` type (or add sibling fields on response envelope) with:
  ```typescript
  tokensSaved: number;       // estimated tokens saved by not reading the files
  tokensSavedPercent: number; // percentage relative to reading all result files
  filesAvoided: number;       // count of files the agent didn't need to read
  ```
- Calculation logic (in `buildMetrics` or post-search assembly):
  ```typescript
  // Sum sizeBytes of all entry point files
  const totalFileTokens = entryPoints.reduce((sum, ep) => sum + (ep.sizeBytes ?? 0), 0) / 4;
  // Response tokens (the compact answer we returned instead)
  const responseTokens = responseText.length / 4;
  const tokensSaved = Math.max(0, Math.round(totalFileTokens - responseTokens));
  const tokensSavedPercent = totalFileTokens > 0
    ? Math.round((tokensSaved / totalFileTokens) * 100)
    : 0;
  const filesAvoided = entryPoints.length;
  ```
- Always return these fields, even when `tokensSaved = 0`

**Data source:** `RetrievalCandidate` has `sizeBytes` (from `FileRecord.sizeBytes` in the store, populated at index time from `files.size_bytes` column).

**Choices left to implementer:** Exact placement on the response type (inside `SearchMetrics` vs. top-level on response object). How to measure `responseText.length` (the formatted output string before returning to caller).

### Pi integration display

**File:** `integrations/pi/aiknow/index.ts` → `aiknow_search` tool handler response formatting

**Required edit:** After receiving the search response with structured estimate fields, format a display line. Example: `[~${tokensSaved} tokens saved, ${filesAvoided} files]`. Consumer decides display threshold (e.g., only show if tokensSaved > 0).

**Choices left to implementer:** Display threshold, exact format string.

## Acceptance criteria

- [ ] Token estimates returned on every search response
  - Run: `npx vitest run src/test/proactive-token-estimates.test.ts`
  - Test: `src/test/proactive-token-estimates.test.ts` → `includes token estimates on every response`
  - Expected: Response object contains `tokensSaved` (number ≥ 0), `tokensSavedPercent` (number 0–100), `filesAvoided` (number ≥ 0) on both zero-result and multi-result searches
  - Fails when: any of the three fields is undefined or missing

- [ ] Calculation uses 4 chars/tok approximation
  - Run: `npx vitest run src/test/proactive-token-estimates.test.ts`
  - Test: `src/test/proactive-token-estimates.test.ts` → `calculates savings using 4 chars per token`
  - Expected: For fixture with 3 files of 4000 bytes each (= 3000 tokens total), response of 400 chars (= 100 tokens), `tokensSaved` = 2900, `filesAvoided` = 3
  - Fails when: calculation uses a different divisor or rounds incorrectly

- [ ] Estimates present even when savings = 0
  - Run: `npx vitest run src/test/proactive-token-estimates.test.ts`
  - Test: `src/test/proactive-token-estimates.test.ts` → `returns zero estimates when no files found`
  - Expected: Zero-result search returns `{ tokensSaved: 0, tokensSavedPercent: 0, filesAvoided: 0 }`
  - Fails when: fields omitted or response throws on empty results

## Blocked by

None - can start immediately.
