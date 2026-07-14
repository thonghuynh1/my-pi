---
status: closed
---

# 02: Wire recall handler to resolve proactive-compression codes

## What to build

Connect the proactive-compression sidecar store to Accordion's recall resolution path so that when an agent calls `recall("code")`, it returns the full original content (the 2000-token version), not the compressed 200-token version that lives in `block.text`.

Covers: `DEC-005`, `US-002`, `RB-004`, `RB-005`.

## Implementation map

### Current recall path

- `app/src/lib/live/plan.ts` → `resolveRecall` reads `store.get(b.id)?.text`.
- But A1 operates at the payload level. The block store will contain the COMPRESSED text (since that's what the provider saw and what the context hook linearizes into blocks).
- So `block.text` for a proactively-compressed block = the 200-token compressed output, NOT the original.

### Required change

The recall resolution in the extension (`accordion.ts` context hook or the recall tool handler) must:

1. When `recall(code)` is called, first check the proactive-compression sidecar store (`getOriginal(code)` from issue 01).
2. If found → return the full original content.
3. If not found → fall back to existing behavior (`block.text` from the store).

### Integration point

- The sidecar store is exposed by `proactive-compress.ts` via `getOriginal(code)`.
- The recall tool handler in the extension needs to import and check this before the normal path.
- The recall code embedded in the compressed output (e.g. `recall("a3f8e2")`) must match the key used in the sidecar store.

### Contract

- `recall("a3f8e2")` for a proactively-compressed block → returns the full original (2000 tokens).
- `recall("b7c1d4")` for a conductor-folded block → returns `block.text` as before (existing behavior unchanged).
- The agent sees no difference in UX — `recall(code)` works for both types.

## Acceptance criteria

- [ ] **Recall of a proactively-compressed code returns full original**
  - Run: Integration test — compress a tool_result (stores original in sidecar), then simulate `recall(code)` call
  - Expected: Returns the full 2000-token original content, not the 200-token compressed version

- [ ] **Recall of a conductor-folded code still works (no regression)**
  - Run: Existing recall tests pass unchanged
  - Expected: All existing recall tests pass — conductor fold recall returns `block.text` as before

- [ ] **Recall code in compressed output matches sidecar store key**
  - Run: Unit test — compress content, extract the code from the recall marker in the output, query `getOriginal(extractedCode)`
  - Expected: Returns the original content

## Blocked by

- `01-proactive-compress-module.md` — depends on the sidecar store (`getOriginal`) being available.
