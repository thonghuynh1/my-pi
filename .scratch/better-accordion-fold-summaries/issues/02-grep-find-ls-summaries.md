---
status: closed
---

Status: ready-for-agent

# Add rich folded summaries for `grep`, `find`, and `ls`

## What to build

Extend the recoverable tool-result summary path from Slice 1 to filesystem discovery/search tools: `grep`, `find`, and `ls`.

PRD decisions: `DEC-001`, `DEC-002`, `DEC-004`, `DEC-005`, `DEC-006`, `DEC-007`, `DEC-008`, `DEC-010`, `DEC-011`.

User stories covered: folded `grep` results show query identity and notable matches; folded `find` results show glob/root and listing shape; folded `ls` results show directory identity and listing shape; summaries include exact recall codes; normal and broker paths receive the same conductor substitution.

## Implementation map

### Area: Custom conductor summary selection

- **Current code anchors**:
  - `vendor/accordion/conductors/my-customize-conductor/my-customize-conductor.ts`
    - `MyCustomizeConductor.conduct()`
    - local `callById` map
    - local `applyCandidate()`
  - Summary helper introduced/extended by issue 01.
- **Existing behavior after issue 01**: `applyCandidate()` should already try MCP summaries, recall summaries, and at least a `read` non-MCP summary before falling back to plain fold.
- **Required edits**:
  - Extend the target-tool formatter to recognize `grep`, `find`, and `ls` tool results.
  - Keep the selection order: MCP first, recall second, target non-MCP summaries third.
  - Preserve fold fallback when summary is absent or not smaller than the source block.

### Area: Recoverable summary formatting helpers

- **Current code anchors**:
  - `vendor/accordion/conductors/my-customize-conductor/mcp-summary.ts` or helper module introduced by issue 01.
  - Existing parser/preview helpers from issue 01.
- **Required edits**:
  - Add `grep` summary:
    - identity includes pattern/query and compacted path/root when available;
    - content signals are capped notable result lines or file/match hints;
    - shape includes line count and approximate tokens;
    - recall hint says to recall before repeating the same search.
  - Add `find` summary:
    - identity includes root/path and glob/pattern when available;
    - content signals are capped representative paths or categories;
    - shape includes item/line count and approximate tokens;
    - recall hint says to recall before repeating the same file discovery.
  - Add `ls` summary:
    - identity includes compacted path when available;
    - content signals are capped entries/categories;
    - shape includes item/line count and approximate tokens;
    - recall hint says to recall before repeating the same listing.
  - Use exact recall code from `foldCode(result.id)`.
  - Keep all extraction deterministic and capped.

```txt
# normative summary shape
tool_result:<tool> <identity>
Contains: <deterministic capped signals>
Shape: <lines/items/matches> · ~<tokens> tok
Full result preserved. Use recall({"codes":["<actual-code>"]}) before repeating this <search/listing/discovery>.
```

### Area: Normal and broker Accordion wire path compatibility

- **Current code anchors**:
  - `vendor/accordion/app/src/lib/engine/store.svelte.ts`: `substOne()` owns fold-tag insertion.
  - `vendor/accordion/app/src/lib/live/plan.ts`: `computeFoldOps(store)` consumes `store.digestOf(b)`.
- **Required edits**:
  - Emit these summaries as recoverable `replace` commands.
  - Do not add UI, broker, or `plan.ts` formatting logic.

## Acceptance criteria

- [ ] A `grep` result emits a recoverable `replace` summary when it saves tokens.
- [ ] The `grep` summary includes pattern/query identity, compacted path/root when available, capped result signals, `Shape:`, and exact recall code.
- [ ] A `find` result emits a recoverable `replace` summary when it saves tokens.
- [ ] The `find` summary includes root/path and glob/pattern identity when available, capped listing signals, `Shape:`, and exact recall code.
- [ ] An `ls` result emits a recoverable `replace` summary when it saves tokens.
- [ ] The `ls` summary includes compacted path identity when available, capped listing signals, `Shape:`, and exact recall code.
- [ ] Each new filesystem summary uses recall-only wording and does not mention `unfold`.
- [ ] MCP/pstack and recall/pstack behavior from issue 01 still takes priority over generic target-tool formatting.
- [ ] Runtime evidence produced. Run:
  ```sh
  cd vendor/accordion/app && npx vitest run src/lib/engine/conductor.my-customize-conductor.test.ts
  ```
  Expected: Vitest reports `conductor.my-customize-conductor.test.ts` passed with zero failed tests, including tests named for `grep`, `find`, and `ls` summaries.

## Blocked by

- `.scratch/better-accordion-fold-summaries/issues/01-exact-code-mcp-pstack-and-read-summaries.md`
